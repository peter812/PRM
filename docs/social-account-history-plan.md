# Implementation Plan: Social Account History Tab + Import Rework

Adds a **History** tab to the social account profile (after Account / Follow / Posts / Messages), backed by a
reverse-delta journal of every ingest. Reworks the PRM Chrome import so each scrape produces an accurate,
auditable record of what changed: followers gained/lost, following gained/lost, bio / display name / profile
image / location changes.

**Reference files:** [`server/task-worker.ts:2450`](../server/task-worker.ts) (`processImportSocial`),
[`server/routes/pending-imports.ts`](../server/routes/pending-imports.ts),
[`client/src/pages/social-account-profile.tsx:605`](../client/src/pages/social-account-profile.tsx) (tab list),
[`shared/schema.ts:381`](../shared/schema.ts) (`socialAccounts`).

## Status

| Phase | State |
|---|---|
| 0 · Schema | ✅ done — `shared/schema.ts` |
| 1 · Migration + baseline | ✅ done — `server/db-init.ts`; run against the live DB: 30,374 accounts, 30,374 baselines, 0 count mismatches |
| 2 · Diff engine | ✅ done — `server/social-account-history.ts`; `scripts/test-history-diff.ts` 32/32 passing |
| 3 · Import rework | ✅ done — `processImportSocial` rewritten onto `applySnapshot`; shared image helper extracted to `server/profile-image.ts`; `scripts/test-import-social.ts` 37/37 passing |
| 4 · Extension contract | ✅ done — one field (`capture_scope`); `scripts/test-import-social.ts` 44/44 passing |
| 5–8 | not started |

The legacy tables are still standing. `social_profile_versions` and `social_network_changes` are read by
~214 server references and 21 client files, so Phase 1 flattens and backfills but does **not** drop them.
The drop happens once Phase 3 and the route/UI work repoint those readers.

---

## Design decisions (settled)

| # | Decision | Consequence |
|---|---|---|
| 1 | **Reverse-delta journal.** Current state lives on `social_accounts`; `social_account_history` stores only *what it was before* | Small rows; reconstructing an old value means walking the journal backwards |
| 2 | **Flatten profile onto `social_accounts`**, migrate and **drop `social_profile_versions`** | ~214 server refs + 21 client files to repoint; one row is the truth |
| 3 | **Scrapes are always authoritative** — an edge absent from the CSV is deleted, regardless of `social_follows.source` | Manual/XML edges can be wiped; every removal is journaled so it stays auditable |
| 4 | **Hard-delete follow edges**; the journal is the only record of past follows | `social_follows` stays lean; no `active` flag, no PK collision on re-follow |
| 5 | **JSONB id arrays** for gained/lost lists, on a single history table | One table; count columns are separate so the list query never reads the JSONB |
| 6 | **Inline download + hash** for the scraped account's own profile image | Accurate image diffing in one shot; graph images stay on the async queue |
| 7 | **Every affected account gets its own history entry** (`neighbor` kind) | A 10k import writes 10k tiny neighbor rows — batching is mandatory |
| 8 | **Synthetic baseline** for existing accounts; first scrape is `initial capture`, not `+5,000 gained` | Growth numbers stay clean |
| 9 | **Toggle + distinct styling** for direct vs neighbor entries | Direct = bright/large; neighbor = dim/compact |

---

## Phase 0 — Schema

### 0.1 Flatten the current profile onto `social_accounts` — `shared/schema.ts`

Today `nickname`/`bio`/`accountUrl`/`imageUrl` live on `social_profile_versions` (where `is_current = true`),
and there is nowhere at all to put the `accountLocationArea` / `accountWebsite` / `accountEmail` / `accountPhone`
the extension already scrapes — `processImportSocial` silently drops all four today.

```ts
export const socialAccounts = pgTable("social_accounts", {
  ...sharedOwnership(),
  id, username, ownerUuid, groupId, typeId,            // unchanged
  internalAccountCreationDate, internalAccountCreationType,
  lastScrapedAt, currentPosts, deletedPosts, isSimple,
  vectorId, vectorSyncedAt, createdAt,                  // unchanged

  // ── Current profile (was social_profile_versions, is_current = true) ──
  nickname: text("nickname"),
  bio: text("bio"),
  accountUrl: text("account_url"),
  imageUrl: text("image_url"),                       // PRM/S3 CDN url — stable, safe to render
  externalImageUrl: text("external_image_url"),      // last signed IG url; a lead for the fetcher, never a display source
  location: text("location"),

  // ── Denormalized current counts (the "10 and 6") ──
  followersCount: integer("followers_count").notNull().default(0),   // edges we actually hold
  followingCount: integer("following_count").notNull().default(0),
  reportedFollowersCount: integer("reported_followers_count"),       // what the profile page claims
  reportedFollowingCount: integer("reported_following_count"),
}, (t) => [ ...existing indexes ]);
```

> **No `image_file_hash` column.** An earlier draft added one. It was cut on discovering that
> `processDownloadImgInstagram` ([`task-worker.ts:123`](../server/task-worker.ts)) already sha256-hashes every
> profile image and stores it on `photos.fileHash`, reachable from `imageUrl` via
> `storage.getPhotoByLocation`. A second copy would only have given the two a chance to disagree.
>
> **No `email` / `phone` / `website` either.** The import does scrape and discard those three, but only bio,
> display name, and location were asked for — the rest is scope that has not been requested.

`followersCount`/`followingCount` are maintained by the diff engine (Phase 2) as the single writer, so they
cannot drift. `reported*` is what Instagram prints on the profile — it diverges from what we captured, and
that divergence is itself worth showing in the History tab.

### 0.2 New table — `social_account_history`

```ts
export const socialAccountHistory = pgTable("social_account_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  socialAccountId: varchar("social_account_id").notNull()
    .references(() => socialAccounts.id, { onDelete: "cascade" }),

  // ── Provenance ──
  batchId: varchar("batch_id").notNull(),        // one per ingest run; ties the direct entry to all its neighbor entries
  entryKind: text("entry_kind").notNull(),       // 'direct' | 'neighbor' | 'baseline'
  changeSource: text("change_source").notNull(), // 'extension' | 'xml-import' | 'csv-import' | 'manual' | 'migration'
  captureScope: text("capture_scope").notNull().default("none"), // 'both' | 'followers' | 'following' | 'profile' | 'none'
  isInitialCapture: boolean("is_initial_capture").notNull().default(false),
  // Soft link only. Pending import rows are user-deletable (bulk-delete exists), so this
  // must not be an FK — the history has to outlive the row that produced it.
  pendingImportId: varchar("pending_import_id"),
  // For entryKind 'neighbour': whose scrape revealed this change.
  observedViaAccountId: varchar("observed_via_account_id")
    .references((): AnyPgColumn => socialAccounts.id, { onDelete: "set null" }),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),

  // ── Count deltas. Plain columns so the LIST query never touches the jsonb. ──
  // No `*Before` column: it is after - added + lost.
  followersAfter:  integer("followers_after").notNull().default(0),
  followersAdded:  integer("followers_added").notNull().default(0),
  followersLost:   integer("followers_lost").notNull().default(0),
  followingAfter:  integer("following_after").notNull().default(0),
  followingAdded:  integer("following_added").notNull().default(0),
  followingLost:   integer("following_lost").notNull().default(0),
  reportedFollowersAfter: integer("reported_followers_after"),
  reportedFollowingAfter: integer("reported_following_after"),

  // Authoritative list of which profile fields changed. NULL in a previous* column is
  // ambiguous (unchanged, or genuinely changed to null), so this array is what the UI reads.
  profileFieldsChanged: text("profile_fields_changed").array().default(sql`ARRAY[]::text[]`),

  // ── Reverse delta: the values as they were BEFORE this entry ──
  previousNickname:  text("previous_nickname"),
  previousBio:       text("previous_bio"),
  previousLocation:  text("previous_location"),
  previousImageUrl:  text("previous_image_url"),   // stable PRM/S3 url — the modal renders it directly

  // ── The heavy part. TOASTed; read ONLY when the modal opens. ──
  // { followersAdded: string[], followersLost: string[],
  //   followingAdded: string[], followingLost: string[] }
  delta: jsonb("delta"),
}, (t) => [
  index("social_account_history_account_idx").on(t.socialAccountId, t.detectedAt),
  index("social_account_history_kind_idx").on(t.socialAccountId, t.entryKind, t.detectedAt),
]);
```

> **No `posts_deleted_count`, and no `postsDeleted` key.** Both were reserved for Phase 8. A jsonb column
> gains a key with no migration at all, so reserving space in advance bought nothing. `previousAccountUrl`
> went too — `accountUrl` is derived from the username and never independently changes — along with the
> `batchId` index, which no query in Phase 5 uses.

**Neighbor entries carry no JSONB.** A neighbor entry's whole story is "`observedViaAccountId` gained/lost
me as a follower" — fully described by `observedViaAccountId` plus the four count columns. Leaving `delta`
null on 10,000 neighbor rows is the difference between ~2 MB and ~20 MB per large import.

**Reconstructing a past value** (needed by the modal and any future timeline):

> `value_at(T)` = the `previous<Field>` of the **oldest entry after T** whose `profileFieldsChanged`
> contains that field. If no entry after T changed it, the value is the current one on `social_accounts`.

Worth a comment in the code — it is the non-obvious cost of reverse deltas, and it is why
`profileFieldsChanged` exists rather than relying on null checks.

### 0.3 Fold in `social_network_changes`

`social_network_changes` (`changeType` follow/unfollow, `direction`, `targetAccountId`, `batchId`) now means
exactly what `social_account_history.delta` means. Two tables for one concept will drift. Migrate its rows
into history entries (`changeSource: 'migration'`) and drop it, same as `social_profile_versions`.

Writers to retire: [`server/task-worker.ts:1470`](../server/task-worker.ts) (XML import) and the manual
`POST /api/social-accounts/:id/network-state` ([`social-media.ts:822`](../server/routes/social-media.ts)).

---

## Phase 1 — Migration + baseline backfill

All of this goes in [`server/db-init.ts`](../server/db-init.ts), using the established
`addColumnIfNotExists` / `columnExists` / `tableExists` helpers so it is idempotent on every boot.

> **`migrateSocialAccountsToHistorical` had to be deleted, not merely left unused.**
> That function migrated the *other* direction — flat columns into `social_profile_versions` — and keyed off
> two conditions: "`social_profile_versions` is missing" and "`social_accounts.nickname` exists". Re-adding
> `nickname` satisfies the second, and dropping the legacy table would satisfy the first. On the next boot it
> would have recreated the versions table, copied the flattened data back into it, and then **dropped
> `nickname`, `account_url` and `image_url` off `social_accounts`** — silently destroying the migration.
> `migrateSocialAccountsToJournal` replaces it outright.

Everything after the column and table creation is **first-run only**, gated on there being no `baseline`
entry yet. Those steps are full-table statements — a flatten `UPDATE ... FROM`, a count seed with two
correlated subqueries, and one `INSERT ... SELECT` per account — and none of them has any business running
on every boot. The baseline rows are written last, which is what makes that gate correct.

1. `addColumnIfNotExists("social_accounts", ...)` for all 13 new columns from §0.1.
2. `CREATE TABLE IF NOT EXISTS social_account_history (...)` + its three indexes.
3. **Copy current profiles down** (guarded by `columnExists("social_profile_versions", ...)`):
   ```sql
   UPDATE social_accounts sa SET
     nickname = spv.nickname, bio = spv.bio, account_url = spv.account_url,
     image_url = spv.image_url, external_image_url = spv.external_image_url
   FROM social_profile_versions spv
   WHERE spv.social_account_id = sa.id AND spv.is_current = true;
   ```
4. **Seed the counts** from the live edge table:
   ```sql
   UPDATE social_accounts sa SET
     followers_count = (SELECT COUNT(*) FROM social_follows WHERE followed_id = sa.id),
     following_count = (SELECT COUNT(*) FROM social_follows WHERE follower_id  = sa.id);
   ```
5. **Convert non-current profile versions** into `entryKind: 'baseline'`, `changeSource: 'migration'`
   history rows ordered by `detected_at`, each holding the *next* version's predecessor values.
6. **Convert `social_network_changes`** rows into history entries grouped by `batch_id`.
7. **Write one synthetic baseline per account** — `entryKind: 'baseline'`, empty delta arrays,
   `followersAfter`/`followingAfter` = the seeded counts, `detectedAt` = `lastScrapedAt ?? createdAt`.
   This is what stops the tab being empty on day one and what makes the *next* real scrape a true diff.
8. Only after 1–7 succeed: `DROP TABLE social_profile_versions`, `DROP TABLE social_network_changes`.

> Run step 8 as a separate guarded step that verifies the new columns are populated for every account that
> had a current profile version. A failed flatten that still drops the source table is unrecoverable
> without a backup.

---

## Phase 2 — The diff engine — `server/social-account-history.ts` (new)

One module, one writer for `social_follows` + the denormalized counts + the journal. Everything else calls
into it. This is what makes decision #3 safe: removals only ever happen in one place, and that place always
journals them.

```ts
export type CaptureScope = "both" | "followers" | "following" | "profile" | "none";

export interface IngestSnapshot {
  socialAccountId: string;
  scope: CaptureScope;
  /** Resolved account ids. Present only for the directions named by `scope`. */
  followerIds?: string[];
  followingIds?: string[];
  profile?: {
    nickname?: string | null; bio?: string | null; accountUrl?: string | null;
    location?: string | null; website?: string | null; email?: string | null; phone?: string | null;
    imageUrl?: string | null; imageFileHash?: string | null;   // already downloaded + hashed (Phase 3.2)
    reportedFollowersCount?: number | null; reportedFollowingCount?: number | null;
  };
  source: "extension" | "xml-import" | "csv-import" | "manual";
  pendingImportId?: string | null;
  taskId?: string | null;
}

/**
 * Applies a scrape to the database and journals what changed.
 *
 * The scrape is authoritative: any follow edge in a captured direction that is
 * absent from the snapshot is deleted, whatever its original source. Every
 * removal lands in the journal, so an overwritten manual edge stays recoverable.
 */
export async function applySnapshot(snap: IngestSnapshot): Promise<SocialAccountHistoryEntry>;
```

### 2.1 Algorithm

```
batchId = randomUUID()

BEGIN TRANSACTION
  before = SELECT followers_count, following_count, nickname, bio, image_url, image_file_hash, ...
           FROM social_accounts WHERE id = $1 FOR UPDATE
  isInitial = NOT EXISTS (history WHERE social_account_id = $1 AND entry_kind <> 'baseline')
              AND the account currently holds no edges

  for each captured direction:
     existing = SELECT ids FROM social_follows WHERE ...         -- one query
     added    = snapshot − existing                              -- set ops in JS on id arrays
     removed  = existing − snapshot
     INSERT INTO social_follows ... added                        -- ONE multi-row insert
     DELETE FROM social_follows WHERE ... IN removed             -- ONE delete
  -- uncaptured directions are left completely untouched

  profileFieldsChanged = fields where the snapshot value differs from `before`
                         (image compares imageFileHash, never the URL)
  UPDATE social_accounts SET <changed profile fields>,
         followers_count = ..., following_count = ..., last_scraped_at = now()

  INSERT direct history entry (previous* = `before` values for changed fields only,
                               delta = the four id arrays, isInitialCapture = isInitial)
  INSERT neighbor entries      -- ONE multi-row insert, delta = null,
                               -- observed_via_account_id = snap.socialAccountId
  UPDATE neighbor followers_count/following_count   -- one UPDATE ... FROM (VALUES ...)
COMMIT
```

**On `isInitialCapture`**, the delta arrays are still written (you want to know *who* the first 5,000 were)
but the entry is typed as initial, and the UI renders "5,000 followers captured" rather than "+5,000".
Neighbor entries generated by an initial capture are typed the same way.

### 2.2 Performance — this is the rewrite that matters

**Followers and following combined never exceed 10,000 for a single account.** That is the design ceiling;
nothing here needs to scale past it, and future work should not be built as though it does. Measured at that
ceiling against the live database, `applySnapshot` takes **2.5s** for 10,000 edges.

Chunking is nonetheless load-bearing rather than speculative, because Postgres caps a statement at 65,535
bound parameters and the neighbour-entry insert writes ~12 columns per row:

| statement | at 10,000 rows | |
|---|---|---|
| neighbour history insert | 12 × 10,000 = 120,000 params | **exceeds the cap — must chunk** |
| follow-edge insert | 3 × 10,000 = 30,000 params | under |
| account insert | 6 × 10,000 = 60,000 params | under |


Today `processImportSocial` runs **two `SELECT`s and up to two `INSERT`s per CSV row**
([`task-worker.ts:2543-2578`](../server/task-worker.ts)) — a 10,000-follower import is ~30,000 round trips.
The rework must be set-based:

- Resolve every scraped username to an id in **one** `SELECT ... WHERE username = ANY($1)`.
- Create the missing accounts in **one** multi-row `INSERT ... ON CONFLICT (username) DO NOTHING RETURNING`.
- Diff, insert, delete as three statements per direction.
- Insert neighbor history rows in chunks of ~1,000.

Progress reporting moves from per-row to per-phase, which is also what makes the whole thing safe to wrap in
a single transaction.

> **The indexes the schema declares did not exist.** `social_accounts` was carrying nothing but its primary
> key — none of the five indexes in [`shared/schema.ts`](../shared/schema.ts) had ever been created, because
> the tables are built from raw `CREATE TABLE` in `db-init.ts` and `drizzle-kit push` has never run against
> this database. `EXPLAIN` on a username lookup returned `Seq Scan ... cost=4000.69`, over 30k rows — and the
> old importer did one of those *per CSV row*.
>
> Phase 1 now creates the two the ingest path depends on, `social_accounts (username)` and
> `social_follows (follower_id)`. The same lookup plans as `Index Scan ... cost=8.30`. The other
> declared-but-absent indexes (visibility, owner_uuid, group_id, type_id) affect other pages and are
> deliberately left alone.

---

## Phase 3 — Rework `processImportSocial` — `server/task-worker.ts:2450`

### 3.1 Shape

The function becomes: parse → resolve → build `IngestSnapshot` → `applySnapshot` → broadcast.
Everything about edges, counts, and journaling moves into Phase 2's module.

New behaviour beyond the diff:
- `record.accountWebsite` / `accountEmail` / `accountPhone` / `accountLocationArea` are **now stored** —
  today they are parsed into the pending row and then dropped on the floor.
- `captureScope` is derived from what actually arrived:
  `importType === "account"` → `'profile'`; a followers CSV only → `'followers'`; both → `'both'`.
  **Only captured directions are diffed** — a profile-only refresh must never look like an unfollow of everyone.

### 3.2 Inline image download + hash

Instagram's profile-picture URLs are signed and rotate on every scrape, so comparing URLs would report a
changed avatar on every single import. The bytes are the only honest signal.

**That comparison already exists.** `processDownloadImgInstagram`
([`task-worker.ts:123`](../server/task-worker.ts)) downloads, sha256-hashes, looks up the account's current
photo via `storage.getPhotoByLocation`, and returns `{ skipped: true, reason: "same_hash" }` when the bytes
match — it even declines to replace a higher-resolution image with a lower one. So this phase does not write
new hashing logic; it extracts what is there:

```ts
// server/profile-image.ts — extracted from processDownloadImgInstagram
export async function fetchProfileImage(url): Promise<{ buffer, contentType, ext, fileHash, dims } | null>
export async function storeProfileImage(fetched, socialAccountId): Promise<{ cdnUrl, photoId }>
//   honours getImageStorageMode(); inserts the photos row; syncs the vector
```

Three call sites then share one implementation: `processDownloadImgInstagram` (the queue path),
`processImportSocial` (inline, for the scraped account only), and — deleted outright — `processGetImgTask`.

> **`processGetImgTask` ([`task-worker.ts:349`](../server/task-worker.ts)) is dead and worse.** It is a third
> near-copy that never hashes, never creates a `photos` row, and uploads straight to S3 ignoring
> `getImageStorageMode`. Nothing anywhere creates a `get_img` task and the table holds zero such rows, so it
> and its `switch` case go. Its client-side display-label mappings are harmless and stay.

`includeGraphImages` neighbours **stay on the async image queue** — inline-fetching 10,000 avatars would
serialize the whole import behind Instagram's CDN, and those images take no part in change detection anyway.

---

## Phase 4 — Extension payload contract v2

One new field. The server stays fully backward compatible: a payload without it behaves
exactly as before.

### The field

`POST /api/v1/pending-imports` accepts `capture_scope` (or `captureScope`):

```jsonc
{
  "account_username": "johnny",
  "account_bio": "...",
  "account_followers": "username,full_name
bob,Bob R
...",   // unchanged
  "account_followers_count": 10,

  "capture_scope": "both"    // "both" | "followers" | "following" | "profile"
}
```

**What it means:** the lists the extension *finished* collecting. Not what it attempted —
what it completed. If the follower scroll was cut short by a rate limit, a private
account, or the user closing the tab, the honest value is `profile`, or `following` if
only that list completed.

**Why the server needs it.** A scrape is authoritative: an account missing from a
captured list is unfollowed and its edge deleted. A truncated follower list and a
genuinely short one produce the identical CSV, and nothing on the server can tell them
apart. Declaring `profile` on a truncated pull turns what would have been hundreds of
invented unfollows into a profile-only update. This is the single highest-value field in
the contract.

Unrecognised values are treated as absent. `/api/v1/scrape-results` tab extractions are
recorded as `profile` server-side, since they only ever read the profile header.

**Fallback for older builds:** with no declaration the server infers scope from which
CSVs arrived non-empty — `both`, `followers`, `following`, else `profile` — which is what
it did before this contract existed.

### `GET /api/v1/account-status`

Gains three read-only fields so the popup can show whether a rescrape is worth it:

| field | meaning |
|---|---|
| `lastChangeAt` | when PRM last recorded an actual change, versus `lastScrapedAt` — when it last looked |
| `followersCount` / `followingCount` | edges currently held; free, since they are denormalized onto the account |

### Deliberately not in this contract

`post_ids` belongs to Phase 8 and is added when that feature is built — a column reserved
now would sit empty and unread. `extension_version` had no reader. `captured_at` was
already covered: `timestamp_added` is set from the payload's `timestamp` and has been all
along. Structured `followers` / `following` arrays were dropped too — the CSV path works,
carries `full_name` and `profile_pic_url` already, and a second wire format would mean two
parsers for one job.

## Phase 5 — API

Replaces `GET /api/social-accounts/:id/profile-versions` and `.../network-changes`, both of which die with
their tables.

| Route | Returns |
|---|---|
| `GET /api/social-accounts/:id/history?kind=direct\|neighbor\|all&page=&limit=` | Paginated list. **Never selects `delta`** — counts and `profileFieldsChanged` only. Includes `observedVia: { id, username, imageUrl }` for neighbor rows. |
| `GET /api/social-accounts/history/:entryId` | One entry with `delta` resolved: each id array hydrated into `{ id, username, nickname, imageUrl }` for chip rendering. Paginate the arrays (`?listLimit=200`) — a first capture can hold 10k ids. |
| `GET /api/social-accounts/:id/history/summary` | Counts by kind, first/last entry dates. Drives the tab badge and the toggle's counts. |

Storage layer ([`server/storage.ts`](../server/storage.ts), near the retired `getProfileVersions` at 3695):
`getAccountHistory`, `getHistoryEntry`, `getHistorySummary`, `createHistoryEntries`.

---

## Phase 6 — UI

### 6.1 The tab — `client/src/pages/social-account-profile.tsx`

Add a fifth trigger after `messages` at line 633, and a `<TabsContent value="history">` after line 1375,
matching the existing `mt-0 flex-1 min-h-0 overflow-y-auto` pattern.

New components:
- `client/src/components/social-account-history-tab.tsx` — the list
- `client/src/components/social-account-history-modal.tsx` — the detail dialog

### 6.2 List — direct vs neighbor

A segmented toggle at the top: **All · This account · Observed elsewhere**, defaulting to *All*.

**Direct entries** — bright, full-width cards: the date prominent, an avatar-change thumbnail pair when the
image changed, and a summary line built from the count columns —
`+5 followers · −2 following · bio changed`. Gains in the theme's positive colour, losses in the destructive
colour. Clickable.

**Neighbor entries** — visually recessed: roughly half the vertical space, muted foreground, smaller type, a
left border rather than a full card, prefixed with the source avatar —
`via @alice — started following you`. Reads as marginalia against the direct entries, which is the point.

Both share a vertical timeline rail so the chronology stays legible when the toggle is on *All*.

### 6.3 Modal

Opens on a direct entry, fetching `GET /api/social-accounts/history/:entryId`. Sections, each rendered only
when that entry actually changed something:

1. **Header** — date, source badge (`PRM Chrome` / `XML import` / `manual`), capture scope, and the
   `initial capture` badge where applicable.
2. **Profile image** — before/after side by side from `previousImageUrl` and the current `imageUrl`.
3. **Display name** and **Bio** — before/after, bio diffed inline.
4. **Location / website** — before/after rows.
5. **Followers** — `10 → 15 (+5, −2)`, with two expandable lists, *Added* and *Lost*, rendering account
   chips (avatar + @username, linking to that account's profile). Virtualized: a first capture can hold
   thousands.
6. **Following** — the same, in the other direction.
7. **Posts deleted** — rendered only when `postsDeletedCount > 0`. **Always empty until Phase 8** —
   the section is built and wired now so the layout does not shift when the feature lands.

Where `reportedFollowersAfter` diverges meaningfully from `followersAfter`, show a quiet note —
"Instagram reports 12,400; 9,830 captured" — since that gap is the honest signal about scrape completeness.

---

## Phase 7 — XML export/import

Six sites emit or parse `<social_profile_version>` blocks
([`auth-setup.ts:1122`/`1714`](../server/routes/auth-setup.ts),
[`social-media.ts:250`/`434`](../server/routes/social-media.ts),
[`task-worker.ts:880`/`1424`](../server/task-worker.ts)).

- **Export:** profile fields now come off `social_account` itself (new child tags: `<bio>`, `<location>`,
  `<website>`, `<image_file_hash>`, `<followers_count>`, ...). Add a `<social_account_history>` section
  emitting journal entries, with the delta arrays as `<account_id>` lists.
- **Import:** keep parsing `<social_profile_version>` and `<social_network_change>` from **older backups**
  and fold them into history entries with `changeSource: 'xml-import'` — old backup files must keep restoring.
  New `<social_account_history>` blocks import directly.
- The XML importer's own follow-edge writes route through `applySnapshot` with
  `source: 'xml-import'` so a restore is journaled like anything else.

---

## Phase 8 — Post deletion (future — NOT in this change)

Recorded so the seams exist now:

- `pending_social_account_imports.post_ids` (Phase 4) captures the visible post list per scrape.
- The diff engine gains a fifth direction: post ids present in `social_accounts.currentPosts` but absent from
  the scrape move to `deletedPosts`, `social_account_posts.isDeleted = true`, and the ids land in
  `delta.postsDeleted` with `postsDeletedCount` set.
- The modal's section 7 is already built and will simply start rendering.

Nothing in Phases 0–7 needs to change when this lands.

---

## Verification

No test framework in this repo — use `npx tsx` scripts under `scripts/`, matching the existing convention.

1. **`scripts/test-history-diff.ts`** — seed an account with 5 followers / 8 following, apply a snapshot of
   10 / 6, assert: `social_accounts` reads 10 and 6; one direct entry with `followersAdded: 5`,
   `followingLost: 2`; the delta arrays name the right accounts; 7 neighbor entries exist.
2. **Scope isolation** — apply a `'profile'`-scope snapshot to that account, assert **zero** edges removed
   and `followersAdded/Lost` all 0.
3. **Image hashing** — apply the same image bytes under two different signed URLs, assert only one history
   entry records an image change and only one upload occurred.
4. **Authoritative deletion** — insert a `source: 'manual'` edge, scrape without it, assert the edge is gone
   and appears in `delta.followersLost`.
5. **Idempotent boot** — run `db-init` twice against a populated database, assert no duplicate columns,
   no duplicate baseline entries, and account counts unchanged.
6. **Migration fidelity** — on a copy of a real database, snapshot `social_profile_versions` +
   `social_network_changes` row counts before, and assert every one is represented in history after.
7. **Ceiling** — 10,000 edges is the maximum a real account reaches. Measured: `applySnapshot` 2.5s,
   22 statements. Note when profiling that a cascading `DELETE FROM social_accounts` in test teardown costs
   ~80s at that size, since most FK columns referencing it are unindexed — that is harness cost and says
   nothing about the import.
8. **Round-trip** — export XML, wipe, import, assert the History tab renders identically.

---

## Sequencing

Phases 0 → 1 → 2 land together (schema, migration, and the single writer are meaningless apart).
Phase 3 next, at which point history starts accruing for real. Phases 5 → 6 make it visible.
Phase 4 (extension contract) and Phase 7 (XML) can proceed in parallel once Phase 2 is stable.
