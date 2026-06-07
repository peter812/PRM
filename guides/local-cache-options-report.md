# Local Cache & DB Optimization Options Report

A practical look at how the PRM app currently talks to its database, where
those calls hurt us, what we can cache locally, and whether bringing in Redis
is actually worth the operational cost.

The current stack is:

- **Postgres** (external, `pbe.im`) via `pg` Pool + Drizzle ORM
  (`server/db.ts`, pool size 20)
- **Express** API (`server/routes.ts`, ~6,900 LOC, ~30 direct `db.*` calls
  plus everything routed through `server/storage.ts` which has ~95)
- **TanStack Query** on the client (`client/src/lib/queryClient.ts`) with
  `staleTime: Infinity` and `refetchOnWindowFocus: false`
- **Qdrant** for vectors, **S3 / local disk** for images, an `app_settings`
  KV table, and an in-process `task-worker.ts`

That context matters: a lot of the "cache" question is already partially
answered by TanStack Query on the front end and the Postgres pool on the
back end. The real wins are in the middle.

---

## 1. Reducing & Optimizing DB Calls

These are ordered roughly by effort vs. payoff. Most are pure code changes,
no new infrastructure.

### 1.1 Kill N+1 patterns in `storage.ts`

`server/storage.ts` is the single biggest source of DB traffic. Anywhere we
fetch a list and then loop to fetch related rows (contacts → notes,
contacts → tags, contacts → social accounts, tasks → assignees, etc.) is a
candidate for:

- **Drizzle relational queries** (`db.query.contacts.findMany({ with: { … } })`)
  which emit a single SQL statement with joins/aggregations.
- **`IN (...)` batch loads** when relational queries don't fit — collect all
  parent IDs, issue one `WHERE parentId IN (...)` query, group in memory.
- A **DataLoader-style per-request batcher** for hot relations so multiple
  call sites in the same request collapse into one query.

This alone typically removes 50–90% of round trips on list endpoints.

### 1.2 Select only what you need

Audit `select * from contacts` style calls. For list views the client only
needs id, name, avatar, a few flags. Returning `notes` text or large JSON
columns inflates row size, network time, and JSON parse cost. Use Drizzle's
`columns: { … }` projection.

### 1.3 Pagination & cursors everywhere

Any endpoint that returns "all" of something needs a hard cap. Prefer
**keyset / cursor pagination** (`WHERE id < :cursor ORDER BY id DESC LIMIT
:n`) over `OFFSET` once tables grow — `OFFSET` re-scans rows and gets slow
fast.

### 1.4 Indexes & `EXPLAIN ANALYZE`

Run `EXPLAIN ANALYZE` against the slowest list/search queries (contacts
search, task lists, AI chat history). Likely missing or improvable:

- Composite indexes on `(user_id, updated_at DESC)` for "my recent X"
- Trigram (`pg_trgm`) GIN indexes for ILIKE name/email search
- Partial indexes for common filters (e.g. `WHERE archived = false`)
- Foreign-key columns that are joined a lot but not indexed

### 1.5 Consolidate startup & schema work

`server/db-init.ts` runs `CREATE TABLE IF NOT EXISTS` and validation on
boot. That's fine for cold start, but make sure none of those checks run
per-request. Anything that depends on schema metadata should be cached in
process memory after the first run.

### 1.6 Connection pool & prepared statements

The pool is already configured (`max: 20`). Two small tunings:

- Make sure long-running tasks in `task-worker.ts` don't hold pool clients
  across `await` boundaries that do non-DB work.
- Use Drizzle's `prepare()` for hot queries to skip re-parsing SQL.

### 1.7 Move read-mostly aggregations off the hot path

Dashboard counters, "graph stats", relationship counts, etc., don't need to
be recomputed on every page load. Options:

- A periodic job in `task-worker.ts` that writes aggregates to a
  `dashboard_stats` table (or to `app_settings`).
- Postgres **materialized views** with `REFRESH MATERIALIZED VIEW
  CONCURRENTLY` on a timer for heavier rollups.

### 1.8 Batch writes & debounce

For UI patterns that fire many small updates (drag-to-reorder, autosave,
bulk tag toggles), batch them client-side and accept arrays server-side.
One transaction with 50 updates is dramatically cheaper than 50 round
trips.

### 1.9 Read replicas (later)

If/when read load actually exceeds what the primary can serve, route
read-only handlers to a replica. Drizzle supports separate read/write
clients. This is premature today.

---

## 2. Storing TMP / Local Data to Reduce DB Hits

Several layers of "local" exist. Use the cheapest one that works.

### 2.1 Client-side: lean on TanStack Query harder

`queryClient.ts` already has `staleTime: Infinity`, which is great — but
that only helps within a session. We can do more:

- **Per-query `staleTime`/`gcTime`**: long for reference data (tags, user
  settings, lookups), short for live data (tasks, AI chat).
- **`queryClient.setQueryData` after mutations** so we don't refetch lists
  we just updated. Today many mutations probably invalidate broad keys.
- **`persistQueryClient` + IndexedDB** (via
  `@tanstack/react-query-persist-client`) to survive reloads. This is the
  single biggest "local cache" win for the front end and removes the cold
  reload DB stampede entirely for reference data.
- **Service Worker / HTTP cache headers** on truly static GETs (avatars,
  uploaded images served by `local-storage.ts`). Set `Cache-Control:
  public, max-age=…, immutable` on `/api/images/:hashedName` since
  filenames are content-addressed via `nanoid`.

### 2.2 Server-side in-process cache (LRU)

For data that is read constantly and changes rarely, an in-process LRU
(`lru-cache` package) is the highest ROI cache we can add. Good
candidates:

- **`app_settings` / Ollama settings** (`getOllamaSetting` / model
  configuration) — these are read on most AI requests but change manually.
- **User session → user record** lookups in middleware.
- **Tag list, category list, enum-like lookup tables.**
- **Schema-validated config** computed at startup.

Rules:

- TTL based (30s–5min) so stale data self-heals.
- Wrap the setter (e.g. `setOllamaSetting`) to invalidate the entry.
- Keys must include `userId` for any per-user data — never share across
  tenants.
- Bound the size; LRU prevents leaks.

This costs zero new infrastructure and gives Redis-like wins for the 80%
case.

### 2.3 Request-scoped cache

A `WeakMap`/`Map` attached to `req` (or `AsyncLocalStorage`) to memoize
"get current user", "get user permissions", "get setting X" within a
single request. Cheap, no invalidation problem (dies with the request),
and removes a surprising amount of duplicate work in handlers that call
helpers that re-fetch the same row.

### 2.4 Disk / filesystem cache

We already use the local filesystem for uploads (`server/local-storage.ts`,
`uploads/` dir). Extend that pattern for:

- **Generated thumbnails / resized images** — compute once, write to disk,
  serve via static route. Don't store image bytes in Postgres.
- **AI embeddings & responses** keyed by content hash, before they go to
  Qdrant. Saves repeated embedding generation, which is far more expensive
  than the DB anyway.
- **Exported CSV / report files** — store under `exports/`, return a URL,
  let the client download directly.

Filesystem caches need cleanup. A nightly job in `task-worker.ts` that
deletes files older than N days is enough.

### 2.5 SQLite as a local "hot store" (optional)

For things like AI chat scratch state, draft notes, or queued background
tasks, a local SQLite file (via `better-sqlite3`) gives you transactional
local storage without touching Postgres. Useful if/when we ship a desktop
or fully-offline mode. Today it's overkill.

### 2.6 What NOT to cache

- Anything security-sensitive (auth decisions) without an explicit, short
  TTL and clear invalidation.
- Lists where "freshness" is the whole product (task list, AI chat
  stream).
- Anything keyed only by a non-tenant value when the data is per-user.

---

## 3. Should We Use Redis?

**Short answer: not yet.** Add it when we hit a specific wall, not
prophylactically.

### 3.1 What Redis would actually buy us

Redis becomes valuable when one of these is true:

1. **We run more than one app instance.** An in-process LRU cache on each
   node will diverge; Redis gives a shared cache and shared invalidation.
2. **We need a shared session store** across instances (today
   `connect-pg-simple` is in `package.json`, sessions live in Postgres —
   that's fine for one instance, slow at scale).
3. **We need rate limiting, distributed locks, or pub/sub** — e.g. to
   coordinate `task-worker.ts` across multiple workers, or to fan out AI
   streaming events.
4. **We have hot keys** (e.g. global "trending" or graph aggregates) read
   thousands of times per second where even a fast Postgres query is too
   much.
5. **Queueing**: BullMQ on Redis would replace the in-process
   `task-worker.ts` cleanly if we ever need durable, multi-worker jobs.

### 3.2 What Redis does NOT fix

- N+1 queries. A bad query cached is still a bad query the first time, on
  every cold key, and after every invalidation. Fix the queries first.
- Schema/index problems. Redis can't make a missing index fast.
- Per-request duplicate work. Request-scoped memoization is simpler.
- Front-end refetch storms. TanStack Query + persistence solves that
  without server changes.

### 3.3 Cost vs. benefit today

We're on a **single Node process** with a **single Postgres**. In that
topology:

- An in-process LRU + TanStack Query persistence covers ~90% of what
  Redis would do for us.
- Redis adds: another service to run (Docker, prod), another failure mode,
  cache-invalidation complexity, and a serialization boundary.
- The DB pool (`max: 20`) is nowhere near saturated for typical PRM
  workloads, so we are not currently DB-bound in a way Redis fixes.

### 3.4 Recommendation

**Phase 1 — do these first (no Redis):**

1. Fix top N+1s in `storage.ts` and add the missing indexes.
2. Add an in-process LRU for `app_settings`, user lookups, and tag/lookup
   tables, with explicit invalidation in setters.
3. Add request-scoped memoization for "current user" and "current user's
   settings".
4. Turn on `persistQueryClient` (IndexedDB) on the client and tune
   per-query `staleTime`.
5. Add `Cache-Control` headers to content-addressed image URLs.

**Phase 2 — adopt Redis when any of these is true:**

- We deploy more than one app instance / move behind a load balancer.
- We need durable background jobs across workers (replace
  `task-worker.ts` with BullMQ).
- We need cross-instance rate limiting, locks, or pub/sub.
- Profiling shows specific hot reads where an in-process cache isn't
  enough (e.g. shared aggregates needing strong cross-node consistency).

When we do bring Redis in, start narrow: session store + job queue. Only
expand to a general object cache after we've measured a real hit-rate
benefit and have a clear invalidation story per key.

---

## TL;DR

- Most of our DB pain is **N+1 + missing indexes + over-fetching**, not
  raw QPS. Fix that first; it's free.
- A small **in-process LRU** plus **TanStack Query persistence** will
  feel like 80% of a Redis cache at 0% of the operational cost.
- **Use Redis when we go multi-instance or need a real job queue** — not
  before.
