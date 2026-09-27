# Account issues — plan

An Instagram account that changes its username, gets deleted, or goes private
breaks every check PRM runs on it. Today the scraper reports this correctly —
a 404 comes back as `skipped { reason: "not_found" }`, a hidden follower list
as `skipped { reason: "private" }` — and PRM writes it on the `tracking_jobs`
row, stamps the account as checked and **rolls the due date forward**
(`server/routes/tracking.ts`, the result handler). Nothing surfaces it: the
account 404s again next cycle, burns a slot in the run, and the person
looking at PRM sees a profile that quietly stopped updating.

This plan adds an **Issues** page under Social Accounts: one row per account
PRM can no longer check, with what went wrong, and two ways out — fix it
(rename and re-check) or delete the account. While an issue is open the
scheduler leaves that account alone.

Companion documents: `account-tracking-plan.md` (jobs, claiming, skip
reasons) and `stories-queue-plan.md` (how runs reach the service).

Decisions (2026-09-21):

| Question | Answer |
|---|---|
| What is an issue | `not_found` (renamed / deleted / deactivated) and `private` (follows and posts can't be read). Failed jobs are not issues — they're transient and already visible under Settings → Social Tasks |
| What "rectify" does | Edit the username on the **existing** row (it keeps its followers, posts and history), queue a profile check, and close the issue when that check succeeds. If the new name is already a row, offer to merge it in (`account-merge-plan.md`) |
| Scheduler while open | Paused: an account with an open `not_found` issue is excluded from scheduled claims until it's resolved or deleted. Manual jobs still run — that's how the re-check gets through |
| Where | Sidebar: Social Accounts → Issues (`/social-accounts/issues`), with an open-count badge |

---

## 1. Why this is not just a query over `tracking_jobs`

The latest job per account already says `not_found`, so the list *could* be
derived. It's a table anyway because an issue has state the jobs don't:

- **It's resolved or dismissed by a person**, and must stay that way even
  though the old job row still says `not_found`.
- **The scheduler reads it** on every claim; a partial index on
  `(social_account_id) WHERE status = 'open'` is one cheap `NOT EXISTS`, where
  "latest job per account is not_found" is a window function over the
  busiest table in the tracking system.
- **It carries the fix**: the username it was renamed from, who resolved it,
  when.

## 2. Schema

### 2.1 `social_account_issues` (new, `shared/schema.ts`)

```ts
export const socialAccountIssues = pgTable("social_account_issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  socialAccountId: varchar("social_account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),                   // 'not_found' | 'private'
  status: text("status").notNull().default("open"), // open | resolved | dismissed
  /** The job that raised (or last re-raised) it, and what it was doing. */
  jobId: varchar("job_id").references(() => trackingJobs.id, { onDelete: "set null" }),
  jobKind: text("job_kind"),                      // TrackingKind of that job
  /** Times a job hit the same wall while the issue stayed open. */
  timesSeen: integer("times_seen").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  /** How it closed: 'renamed' | 'recheck_ok' | 'dismissed' | 'became_public'. */
  resolution: text("resolution"),
  previousUsername: text("previous_username"),    // set on 'renamed'
  resolvedBy: integer("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at"),
}, (t) => [
  uniqueIndex("social_account_issues_open_uniq").on(t.socialAccountId, t.kind).where(sql`status = 'open'`),
  index("social_account_issues_account_idx").on(t.socialAccountId),
]);
```

One open issue per account and kind — a second `not_found` bumps
`timesSeen` / `lastSeenAt` on the existing row instead of adding one.

No `visibility` columns: an issue is visible exactly when its account is, so
the list query joins `social_accounts` and applies `visibleShared` there.

### 2.2 `server/db-init.ts`

`CREATE TABLE IF NOT EXISTS social_account_issues (…)` plus the two indexes,
next to the `tracking_jobs` block (existing databases only ever get columns
added by the loop above it, so the table has to be created here as well as
in the schema; a fresh database gets it from `drizzle-kit push`). No
migration file — `tracking_jobs` and its neighbours have none either.

### 2.3 Backfill

The accounts that are broken today already have a `not_found` job as their
latest. One idempotent statement after the table is created, run on every
boot (it's a no-op once the rows exist):

```sql
INSERT INTO social_account_issues (social_account_id, kind, job_id, job_kind, first_seen_at, last_seen_at)
SELECT j.social_account_id, 'not_found', j.id, j.kind, j.finished_at, j.finished_at
FROM tracking_jobs j
WHERE j.status = 'skipped' AND j.result->>'reason' = 'not_found'
  AND j.id = (SELECT id FROM tracking_jobs WHERE social_account_id = j.social_account_id ORDER BY finished_at DESC NULLS LAST LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM social_account_issues i WHERE i.social_account_id = j.social_account_id AND i.kind = 'not_found');
```

`private` is not backfilled from history: `is_private = true` is already on
the account and shown on its page; the issue opens next time a follows or
posts job actually hits the wall.

## 3. Raising and closing — `server/account-issues.ts` (new)

Three functions, called from the job result handler in
`server/routes/tracking.ts`:

```ts
/** A job hit a wall: open the issue for that kind, or bump the open one. */
export async function raiseIssue(accountId: string, kind: IssueKind, job: { id: string; kind: TrackingKind }): Promise<void>
/** A job on this account got through: close the open issues that proves wrong. */
export async function resolveIssues(accountId: string, kinds: IssueKind[], resolution: Resolution): Promise<void>
/** A person closed it. Returns nothing when the issue isn't open. */
export async function closeIssue(id: string, resolution: Resolution, userId: number, previousUsername?: string): Promise<SocialAccountIssue | undefined>
```

`raiseIssue` is an `INSERT … ON CONFLICT (social_account_id, kind) WHERE
status = 'open' DO UPDATE SET times_seen = times_seen + 1, last_seen_at =
now(), job_id = …, job_kind = …`.

What closes what:

| Job outcome | Effect |
|---|---|
| any kind, `skipped: not_found` | raise `not_found` |
| `follows` or `posts`, `skipped: private` | raise `private` (the existing `isPrivate = true` write stays) |
| any kind, `completed` | resolve open `not_found` (`recheck_ok`) — the username works again |
| `follows` or `posts`, `completed` | resolve open `private` (`recheck_ok`) — the list was readable |
| `info`, `completed` with `isPrivate: false` | resolve open `private` (`became_public`) — in the profile-info handler, where `isPrivate` is written |

The result handler today does `markChecked` for `not_found` — that stays
(the account isn't due; the pause below is what keeps it off the schedule),
so nothing else in the tracking flow changes.

## 4. The pause — `server/tracking.ts`

`claimTrackingJobs`, the schedule branch, gains one condition next to the
existing `NOT EXISTS (… tracking_jobs … queued/running)`:

```sql
AND NOT EXISTS (SELECT 1 FROM social_account_issues i
                WHERE i.social_account_id = sa.id AND i.kind = 'not_found' AND i.status = 'open')
```

Only `not_found` pauses. A `private` account already gets info checks only
(the `k.kind = 'info' OR sa.is_private IS NOT TRUE` clause), and those must
keep running — they're how PRM notices it went public again.

The manual branch is untouched, so "Re-check" from the Issues page runs.

The account page's tracking block fetches `/api/account-issues?accountId=`
and shows "Paused — profile not found" with a link to the Issues page.
`trackingBlocker` is left alone: it also disables "Refresh now", and a manual
re-check is exactly what a paused account still needs.

## 5. API — `server/routes/account-issues.ts` (new, mounted from `routes.ts`)

All under `requireAuth`. Paths avoid `/api/social-accounts/:id` so they
can't be swallowed by that wildcard.

| Route | Does |
|---|---|
| `GET /api/account-issues?status=open` | Issues joined to their account (`username`, `nickname`, `imageUrl`, `isPrivate`, `interestLevel`, `ownerUuid` + owner name) and the account's open tracking job if any (`{ kind, status }`), newest `lastSeenAt` first; filtered by `visibleShared` on the account. `status=resolved` gives history. |
| `GET /api/account-issues/count` | `{ open: n }` for the sidebar badge (same visibility filter). |
| `POST /api/account-issues/:id/rename` `{ username }` | The rename. See below. |
| (re-check) | No new route — the page posts to the existing `POST /api/social-accounts/:id/tracking-jobs` with `info` for `not_found`, `follows` for `private`; it already 409s on an open check and kicks the importer. |
| `POST /api/account-issues/:id/dismiss` | `closeIssue(id, "dismissed")`. For `private` this is the normal exit ("I know, I'm not going to follow them"). For `not_found` it un-pauses the schedule, so the response text says so. |
| (delete) | No new route — the page calls the existing `DELETE /api/social-accounts/:id`; the cascade removes the issue. |

### 5.1 The rename

```
1. Trim, strip a leading @, lowercase. Empty or unchanged → 400.
2. Another Instagram account already has that username → 409
   { error, duplicate: { id, username } }. Merging is out of scope, so the
   UI links to it and says: delete one of the two, or choose differently.
3. storage.updateSocialAccount(id, { username, accountUrl: instagram url })
   + recordAccountProfileChanges(id, { username }, existing) — the same two
   calls PATCH /api/social-accounts/:id makes, so the journal gets
   previousUsername and the history page shows the rename.
4. closeIssue(id, "renamed", user, { previousUsername }).
5. queueManualJob(account, "info", user) — the re-check. If Instagram
   404s on the new name too, the result handler raises a fresh issue
   (times_seen 1, the old one stays resolved with its rename) and the row is
   back on the page.
6. sseManager.broadcast("social_account.updated", { id }) and return
   { account, job }.
```

The issue closes at step 4, not when the check succeeds, because the
person's fix is the rename; the check is confirmation. Closing on success
instead would need a "verifying" state, a job-id to watch, and a timeout for
a run that never comes. If the check fails, a new issue tells them.

## 6. UI

### 6.1 `client/src/pages/social-accounts-issues.tsx` (new)

Modelled on `social-tracking.tsx`: a header, then a card list. Empty state:
"Every tracked account is reachable." Per issue:

```
[avatar] @old_username · Display Name · owner person link         3 × since 12 Sep
         Profile not found — the info check on 20 Sep 404'd.
         [ Rename… ] [ Re-check ] [ Dismiss ] [ Delete account ]      ↻ info check queued
```

- **Rename…** — inline input pre-filled with the current username; Enter
  or Save posts `/rename`. A 409 with a `duplicate` renders the message with
  a link to the other account.
- **Re-check** — queues the manual job; the row then shows its status from
  the list query (`queued` / `running`), polling every 10 s while any row has
  an open job, else 60 s (same pattern as the Tracking page).
- **Dismiss** — no confirm for `private`; for `not_found` a one-line
  confirm since it resumes scheduling.
- **Delete account** — `AlertDialog` with the same copy the accounts list
  uses, then `DELETE /api/social-accounts/:id`.

`private` rows read "Went private — follows and posts can't be read. Follow
them from your account and re-check, or dismiss." with the same buttons minus
Rename.

A "Resolved" tab (or toggle) lists `status=resolved|dismissed` with the
resolution and who did it, so a rename can be found again.

### 6.2 Wiring

- `client/src/App.tsx`: `<ProtectedRoute path="/social-accounts/issues" …>`
  **above** `/social-accounts/:uuid`, as `pending-imports` and `tracking` are.
- `client/src/components/app-sidebar.tsx`: sub-item `{ title: "Issues", url:
  "/social-accounts/issues", icon: AlertTriangle }`; the sub-item renderer
  gets the same badge span the Unknown Faces item has, fed by
  `useQuery(["/api/account-issues/count"])`. The query is invalidated on the
  `social_account.updated` SSE event the page already listens for.
- `account-tracking.tsx`: with an open `not_found` issue, "Paused — profile
  not found. Fix it on the [Issues](/social-accounts/issues) page." under
  the Edit tracking button.

## 7. Files

| File | Change |
|---|---|
| `shared/schema.ts` | `socialAccountIssues` table, types, insert schema |
| `server/db-init.ts` | create table + indexes; backfill statement |
| `server/account-issues.ts` | new: `raiseIssue`, `resolveIssues`, `closeIssue` |
| `server/routes/tracking.ts` | result handler calls raise/resolve; profile-info handler resolves `private` on `isPrivate: false` |
| `server/tracking.ts` | pause clause in `claimTrackingJobs` |
| `server/routes/account-issues.ts` | new: list, count, rename, dismiss |
| `server/routes.ts` | mount it |
| `client/src/pages/social-accounts-issues.tsx` | new page |
| `client/src/App.tsx` | route |
| `client/src/components/app-sidebar.tsx` | sub-item + badge |
| `client/src/components/account-tracking.tsx` | paused notice, from `GET /api/account-issues?accountId=` |
| `account-tracking-plan.md` §3.2 | one line: `not_found` now opens an issue and pauses the schedule |

Order of work: schema + db-init + backfill → `account-issues.ts` + result
handler hooks → pause → routes → page + sidebar → profile notice. Each step
is runnable on its own; after the third, the scheduler already stops
re-hitting dead accounts even with no UI.

## 8. Out of scope, and one thing worth doing next

- **Merging two account rows** — done, see `account-merge-plan.md`. When
  the rename finds the new name is already a row, the page offers to merge
  it into this one.
- **Detecting renames automatically.** Instagram's follower pages carry a
  stable `pk` per user, and the scraper already accumulates it
  (`account-tracking-plan.md` §3.3) but PRM only keeps the username. Storing
  `instagram_pk` on `social_accounts` and resolving scraped accounts by pk
  before username would turn most `not_found` issues into an automatic
  rename — and is what would make the merge case above stop happening. Worth
  a plan of its own; it changes `resolveScrapedAccounts`, which every import
  path goes through.

## 9. Assumptions made here (say so if any is wrong)

- The Issues list is scoped by account visibility (`visibleShared`), not by
  who queued the job — anyone who can see the account can fix or delete it.
- Dismissing a `not_found` issue resumes scheduled checks; the next 404
  simply reopens it. If you'd rather a dismissed account stay paused, the
  pause clause checks `status IN ('open','dismissed')` instead.
- `failed` jobs stay where they are (Settings → Social Tasks). If the same
  account fails three runs in a row that probably *is* an issue; easy to add
  later as a third kind once we see what those errors look like.
