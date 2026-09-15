# Insights + Auto OSINT Network Scans — Implementation Plan

Source: transcript (2026-09-13) + follow-up answers.

## Goal

1. A generic **Insights** store: any piece of information gleaned from a
   non-human source (OSINT tool output today; other automated sources later),
   attached to one or more people and/or social accounts.
2. An **Insights tab** on the social-account profile and the person profile
   that lists every insight applying to that entity (type + raw text for now).
3. An **OSINT scan queue** that automatically drips scans (~1 every 3 min)
   across every account the "Me" user's social accounts follow, and writes
   each result back as an Insight.

## Decisions already made

| Question | Answer |
|---|---|
| What is a scan | PRM-osint username scan. It is one *type* of insight, not the only one. |
| Trigger | Automatic, gated on: PRM-osint configured **and** auto-scans enabled in settings. Fires when a social account is added to the Me person, or a Me-owned social account is updated. |
| Scope | Every account the Me account **follows** (following list). Followers optional via setting, default off. |
| Rate | Slow drip, 1 scan per ~3 minutes (configurable), to protect the OSINT endpoint. |
| Queue model | New `osint_scan_queue` table with per-row status; survives restarts, resumable. |
| Re-scans | Append. Every scan inserts a new insight row; tab shows newest first. |

## Assumptions (flag if wrong)

- **Settings are instance-level** (`app_settings`, admin-editable) like the
  existing PRM-osint URL/key, not per-user. All Me users on the instance share
  the toggle.
- **Auto-enqueue has a cooldown** (default 30 days per account+tool). Without
  it every PATCH of a Me account would re-queue thousands of rows. Manual
  "Scan now" ignores the cooldown. History is still appended — the cooldown
  only limits *automatic* enqueueing.
- The Me account itself is not scanned, only its network.
- Default tool list is `["sherlock"]`; user can add maigret/socialscan/etc.
- Insight visibility inherits from the social account it was collected for.
- Insights are **not** added to XML export/import in v1.

---

## 1. Schema — `shared/schema.ts`

### `insights`

```ts
export const insights = pgTable("insights", {
  ...sharedOwnership(),
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),            // e.g. "osint_accounts"
  source: text("source"),                  // e.g. "osint:sherlock" — finer than type
  collectedAt: timestamp("collected_at").notNull().defaultNow(),
  rawText: text("raw_text"),               // human-readable summary shown in the tab
  data: jsonb("data").notNull().default(sql`'[]'::jsonb`), // the "big array" of insight data
  applicablePeopleIds: text("applicable_people_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  applicableSocialAccountIds: text("applicable_social_account_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("insights_type_idx").on(t.type),
  index("insights_collected_at_idx").on(t.collectedAt),
  index("insights_people_gin").using("gin", t.applicablePeopleIds),
  index("insights_social_accounts_gin").using("gin", t.applicableSocialAccountIds),
  index("insights_visibility_idx").on(t.visibility),
]);
```

Arrays + GIN rather than join tables: matches the transcript ("applicable
accounts and applicable social accounts" on the row), and `people.socialAccountUuids`
already uses the same pattern. Deleting a person/account does **not** cascade
into the arrays — an insight simply stops resolving to that entity. Acceptable
for v1; a cleanup query can be added later.

### `osint_scan_queue`

```ts
export const osintScanQueue = pgTable("osint_scan_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  socialAccountId: varchar("social_account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
  username: text("username").notNull(),     // snapshot at enqueue time
  tool: text("tool").notNull(),             // "sherlock" | "maigret" | ...
  status: text("status").notNull().default("pending"), // pending | running | done | failed | skipped
  reason: text("reason").notNull(),         // me_account_added | me_account_updated | follow_added | manual
  requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  remoteJobId: text("remote_job_id"),       // PRM-osint scan id while running
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  insightId: varchar("insight_id").references(() => insights.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("osint_scan_queue_status_created_idx").on(t.status, t.createdAt),
  index("osint_scan_queue_social_account_idx").on(t.socialAccountId),
  // One live row per account+tool. Partial so done/failed history doesn't block re-queues.
  uniqueIndex("osint_scan_queue_live_uniq").on(t.socialAccountId, t.tool)
    .where(sql`status IN ('pending','running')`),
]);
```

Add `insertInsightSchema`, `insertOsintScanQueueSchema`, and the `Insight` /
`OsintScanQueueRow` types next to the other zod/insert exports.

### `server/db-init.ts`

`db:push` only runs on a full reset, so both tables need `CREATE TABLE IF NOT
EXISTS` blocks in the existing-database path (same pattern as
`pending_social_account_imports` at db-init.ts:600). Include the indexes.

### Settings keys (`app_settings`)

| key | default | meaning |
|---|---|---|
| `osint_auto_scan_enabled` | `"false"` | master toggle |
| `osint_auto_scan_tools` | `'["sherlock"]'` | JSON array of tool slugs |
| `osint_auto_scan_interval_seconds` | `"180"` | drip spacing |
| `osint_auto_scan_cooldown_days` | `"30"` | skip auto-enqueue if an insight for account+tool is newer than this |
| `osint_auto_scan_include_followers` | `"false"` | also scan accounts that follow the Me account |

---

## 2. Storage — `server/storage.ts`

Insights:
- `createInsight(data)`
- `getInsightsForSocialAccount(accountId)` — `applicable_social_account_ids @> ARRAY[$1]`, newest first
- `getInsightsForPerson(personId)` — person id in `applicable_people_ids` **OR** any of the person's owned account ids (`social_accounts.owner_uuid = person` ∪ `people.social_account_uuids`) overlaps `applicable_social_account_ids`
- `getInsightById(id)`, `deleteInsight(id)`
- `hasRecentInsight(accountId, source, sinceDate)` — cooldown check

Queue:
- `enqueueOsintScans(rows[])` — `INSERT ... ON CONFLICT DO NOTHING` against the partial unique index
- `claimNextOsintScan()` — oldest `pending` → `running`, sets `startedAt`, increments `attempts` (single `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`)
- `completeOsintScan(id, { insightId })`, `failOsintScan(id, error, retry: boolean)` (retry → back to `pending`, else `failed`)
- `getOsintQueue({ status?, page, pageSize })`, `getOsintQueueCounts()`
- `deleteOsintQueueRow(id)`, `clearOsintQueue(status?)`

All existing-database queries must respect visibility the same way the
social-account reads do.

---

## 3. Enqueue logic — new `server/osint-scan-queue.ts`

```
enqueueNetworkScansForMeAccount(meAccountId, reason, opts?: { onlyAccountIds?: string[] })
  1. cfg = loadOsintConfig(); if !isConfigured(cfg) → return { skipped: "not_configured" }
  2. settings = loadAutoScanSettings(); if !enabled → return { skipped: "disabled" }
  3. account = getSocialAccountById(meAccountId)
     owner = getPersonById(account.ownerUuid); if !owner?.userId → return { skipped: "not_me" }
  4. targets = opts.onlyAccountIds ?? getFollowingIds(meAccountId)
     if includeFollowers: targets ∪= getFollowerIds(meAccountId)
  5. for each tool in settings.tools, for each target:
       skip if hasRecentInsight(target, `osint:${tool}`, now - cooldownDays)   // only for non-manual reasons
       push { socialAccountId, username, tool, reason, requestedByUserId: owner.userId }
  6. enqueueOsintScans(rows)  // ON CONFLICT DO NOTHING handles live duplicates
  7. log counts; return { enqueued, skippedCooldown, skippedDuplicate }
```

Helper `isMeOwnedAccount(accountId)` → `{ isMe, userId }` reused by every hook.

### Hook points

| Where | When | Call |
|---|---|---|
| `POST /api/social-accounts` (social-media.ts:527) | created with `ownerUuid` that is a Me person | `enqueue(..., "me_account_added")` |
| `PATCH /api/social-accounts/:id` (social-media.ts:543) | account owner is Me | `enqueue(..., "me_account_updated")` |
| `POST /api/account-matching/connect` (social-media.ts:1235) | `personId` is a Me person | `enqueue(..., "me_account_added")` |
| `POST /api/social-accounts/:id/network-state` (social-media.ts:821) | account is Me, after `addFollows` | `enqueue(..., "follow_added", { onlyAccountIds: newlyAddedFollowingIds })` — only the delta, not the whole list |
| `POST /api/osint/settings` | auto-scan flipped **on** | enqueue for every Me-owned account on the instance (initial backfill) |

All calls are fire-and-forget (`void enqueue(...).catch(log)`) so the HTTP
response isn't delayed by a 5k-row insert.

---

## 4. Drip runner — `server/osint-scan-queue.ts` (started from `server/index.ts` next to the task worker)

Separate from `task-worker.ts`: the task worker drains back-to-back, this
needs a fixed cadence.

```
startOsintScanRunner()
  loop every `interval_seconds` (re-read from settings each tick so changes apply live):
    if !configured || !autoScanEnabled || paused → continue
    row = claimNextOsintScan(); if !row → continue
    try:
      job = POST {osint}/api/v1/scans { tool, target: username, target_type: "username" }
      poll GET /scans/{id} every 5s, up to 10 min (reuse osintFetch from routes/osint.ts — move it to a shared module)
      if job.status == "done":
        insight = createInsight(buildInsightFromOsintResult(row, account, job.result))
        completeOsintScan(row.id, { insightId })
      else:
        failOsintScan(row.id, job.error ?? job.status, retry: row.attempts < 3)
    catch err:
      failOsintScan(row.id, err.message, retry: row.attempts < 3)
```

- Exactly one scan in flight at a time. The interval starts when the previous
  scan *finishes*, so a slow tool can't stack requests.
- Reuse the existing `isPaused` semantics: `POST /api/tasks/pause` also pauses
  the drip (export a `setOsintRunnerPaused` or read the same flag).
- On startup, reset any `running` rows to `pending` (crashed mid-scan).

### `buildInsightFromOsintResult(row, account, result)`

```ts
{
  type: "osint_accounts",
  source: `osint:${row.tool}`,
  collectedAt: now,
  data: result.sites ?? result.platforms ?? result.modules ?? result,   // same shape sniffing as osint-demo.tsx ResultView
  rawText: `${row.tool} found ${n} account(s) for @${account.username}:\n` + hits.map(h => `• ${h.site ?? h.name}: ${h.url}`).join("\n"),
  applicableSocialAccountIds: [account.id],
  applicablePeopleIds: account.ownerUuid ? [account.ownerUuid] : [],
  createdByUserId: row.requestedByUserId,
  visibility: account.visibility,
}
```

Breach hits (user-scanner) go in `data` too; `rawText` gets a `Breaches: …` line.

---

## 5. API routes

New `server/routes/insights.ts`, registered in `server/routes/index` alongside the others:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/insights?socialAccountId=` | list, newest first |
| GET | `/api/insights?personId=` | list via person + owned accounts |
| GET | `/api/insights/:id` | |
| DELETE | `/api/insights/:id` | |
| GET | `/api/osint/scan-queue?status=&page=` | paginated rows + counts |
| POST | `/api/osint/scan-queue` | `{ socialAccountId, tools? }` manual enqueue, reason `manual`, no cooldown |
| POST | `/api/osint/scan-queue/enqueue-network` | `{ socialAccountId }` manual full-network enqueue for a Me account |
| DELETE | `/api/osint/scan-queue/:id` | |
| DELETE | `/api/osint/scan-queue?status=failed\|done\|pending` | bulk clear (admin) |
| GET/POST | `/api/osint/settings` | extend existing handlers with the five auto-scan keys |

---

## 6. Client

### `client/src/components/insights-tab.tsx`

Props: `{ socialAccountId?: string; personId?: string }`. Query
`["/api/insights", { socialAccountId | personId }]`.

Each row: type badge, source (muted), `collectedAt` relative time, `rawText`
in `whitespace-pre-wrap`, and a collapsed "Raw data" `<pre>` of `data`.
Newest first. Empty state: "No insights yet." plus, on social accounts when
PRM-osint is configured, a **Scan now** button (`POST /api/osint/scan-queue`).
Delete via row menu.

### Tabs

- `client/src/pages/social-account-profile.tsx` — add `<TabsTrigger value="insights">` after `history` (~line 630) and a `<TabsContent value="insights">` (~line 1347) rendering `<InsightsTab socialAccountId={id} />`.
- `client/src/pages/person-profile.tsx` — same after the last trigger (~line 393); `<InsightsTab personId={id} />`.

Use the existing `Sparkles` (or `Lightbulb`) lucide icon for consistency with the other tab triggers.

### Settings — `client/src/pages/experimental-features.tsx` (PRM-osint section)

Under the existing enable/URL/key form, add an **Automatic scans** block:
- Switch: Auto-scan Me network
- Multi-select chips from `OSINT_TOOLS` (username-capable only)
- Interval (seconds) number input, min 60
- Cooldown (days) number input
- Switch: Include followers
- Disabled with a hint when PRM-osint isn't configured.

### Queue view — new `client/src/pages/osint-scan-queue.tsx` (route `/settings/osint-queue`)

Counts row (pending / running / done / failed), next-run countdown, table of
rows with status badge, username → link to account, tool, reason, attempts,
error, and a delete action. Bulk "Clear failed" / "Retry failed". Link to it
from the PRM-osint card on `settings-home.tsx` (there is already a `Scan` icon
imported there).

---

## 7. Implementation order

1. Schema + db-init `CREATE TABLE IF NOT EXISTS` + storage methods. Run `npm run check`.
2. `insights` routes + `InsightsTab` + both tab wirings. Seed one row by hand and verify both tabs render it.
3. Settings keys + settings UI.
4. `osint-scan-queue.ts`: enqueue logic + hooks. Verify rows appear when a Me account's network-state is posted.
5. Drip runner + insight builder. Verify against a live PRM-osint with interval temporarily set to 60s.
6. Queue page + Scan-now button.
7. Test: `scripts/test-osint-enqueue.ts` covering not-Me skip, cooldown skip, live-duplicate skip, follow-delta only.

## 8. Risks / things to watch

- **Volume.** A Me account following 3k accounts × 1 tool at 3 min ≈ 6 days
  for one pass. Counts + next-run countdown on the queue page make that
  visible. Do not try to parallelize — the endpoint throttle is the point.
- **PRM-osint job lifetime.** If the remote purges finished jobs quickly, the
  poll may 404 — treat 404 after a `running` observation as `failed` (retry).
- **Live duplicate index.** Relies on Postgres partial unique index; the
  db-init path must create it too or `ON CONFLICT` will error.
- **Hook coverage.** Any future route that changes a Me account's following
  edges must call the enqueue helper; `applySnapshot` is the single writer of
  edges today, so hooking there (or right after it) covers it.

## Open questions

1. Instance-level settings (assumed) or per-user in `user_settings`?
2. Default cooldown 30 days OK, or should auto-enqueue never re-scan an account already scanned?
3. Should the Me account itself get scanned, not just its network?
4. Any PRM-osint concurrency/queue limits on the server side we should respect beyond the 3-minute drip?
