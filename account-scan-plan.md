# Account scans (lite / full): plan

Today a tracking run works four separate job kinds per account (`info`, `follows`, `posts`,
`highlights`), each with its own cadence and due date per interest level. This plan replaces the
scheduled ones with **one `scan` job per account**. A scan works the account top to bottom in a
single profile visit, as the Obsidian canvas lays out:

- **Lite scan** (interest level **low**): profile info, plus the date joined if PRM doesn't have it.
- **Full scan** (level **medium and above**, and **every user-triggered scan** at any level):
  1. Profile info: display name, bio, website, follower/following counts. Date joined if missing.
  2. Posts:
     - PRM has never got posts for this account → **full posts scan**.
     - Otherwise → **recent posts scan**: only the posts the profile loads without scrolling.
       New ones are imported. If a post PRM holds is missing from that window (a deletion), the
       scan falls through to a **full posts scan**.
     - In either posts scan, **comments are fetched only at level high and above**.
  3. Highlights, **only at level high and above**: all of them on the first read, changes after
     that.
- **Followers/following** are no longer scheduled at all. They run only when a person asks:
  account page, accounts-list selection, Tracking page batch, the new-account dialog, the Issues page.

Level `none` gets no scheduled scans (unchanged).

> Decisions taken while planning are listed at the end.

---

## 0. What already exists

- **prm-stories** (`PRM-stories/src/track.ts`) already has every piece a scan needs, as separate
  jobs: `jobInfo` (with `needJoinedAt` → About dialog), `jobPosts` (grid walk to `scanLimit`,
  `posts/check` dedupe, optional comments and videos), `jobHighlights` (tray, reels, item dedupe,
  membership upsert). `trackOnce` dispatches on `job.kind`.
- **PRM** (`server/tracking.ts`, `server/routes/tracking.ts`, `shared/interest-level.ts`):
  - `DEFAULT_LEVEL_CADENCES` holds days per level per kind; `social_accounts` has
    `{info,follows,posts,highlights}_{due_at,checked_at,every_days}`.
  - `claimTrackingJobs` / `upcomingChecks` share `dueAt()`, which cross-joins the four kinds.
  - `/jobs/:id/result` does the posts deletion pass and the highlights deletion pass keyed on
    `job.kind`, then `markChecked(kind)`.
- **Highlights already "scan for changes":** `jobHighlights` reads the whole tray every time but
  only downloads items PRM lacks, and `upsertHighlight` diffs membership. The tray carries no
  `latest_reel_media`, so there's no cheaper "unchanged" check. **The "get all" and "scan for
  changes" branches of the canvas are the same code path**; the scan only has to decide whether to
  run highlights at all.

## 1. Data model (`shared/schema.ts`, `shared/interest-level.ts`)

### Job kind

`TRACKING_KINDS` becomes `["scan", "info", "posts", "highlights", "follows"]`. `scan` is the
only kind the **schedule** creates. `info`, `posts`, `highlights` and `follows` become
**manual-only**: they stay as single-section buttons next to the new **Full scan** option
(decided 2026-10-13).

A scan job row gets one new column:

| column | notes |
|---|---|
| `tracking_jobs.scan_mode` text null | `lite` \| `full`; null for `follows` and legacy rows |

### Cadence

One cadence per level instead of four (decided 2026-10-13):

```ts
DEFAULT_SCAN_CADENCE: Record<InterestLevel, number | null> = {
  none: null, low: 30, medium: 7, high: 7, very_high: 7, extreme: 7,
};
SCAN_MODE: Record<InterestLevel, "lite" | "full" | null> = {
  none: null, low: "lite", medium: "full", high: "full", very_high: "full", extreme: "full",
};
DEEP_LEVELS = ["high", "very_high", "extreme"]; // comments + highlights
```

`social_accounts` columns:

- **Add** `scan_due_at`, `scan_checked_at`, `scan_every_days` (override).
- **Keep** `info_checked_at`, `posts_checked_at`, `highlights_checked_at`, `follows_checked_at`.
  Each section stamps its own, since the account page and the Tracking page show them, and
  `posts_checked_at IS NULL` is how a scan knows "PRM has never got posts".
- **Drop** `info/follows/posts/highlights_due_at` and `*_every_days`, plus the
  `social_accounts_follows_due_idx` index. Manual single-section jobs don't need due dates.

Migration (`db-init.ts`): `scan_due_at = LEAST(info_due_at, posts_due_at, highlights_due_at)` so
nobody jumps the queue or falls off it; `scan_every_days = info_every_days` where set. Queued
`schedule` jobs of the old kinds are deleted (they're re-derived as scans). Queued `manual` jobs
stay as they are.

`tracking_level_defaults` in app_settings changes shape to `{ level: days }`; `parseLevelCadences`
reads the old shape by taking `info` as the scan days.

## 2. Scheduling (`server/tracking.ts`)

- `dueAt()` loses the `CROSS JOIN LATERAL` over kinds: one row per account where
  `scan_due_at <= at`. The follows `MAX_FOLLOWS` and `skip_stories` conditions move out of the due
  query (follows aren't scheduled; `skip_stories` only turns highlights off inside the job).
- `claimTrackingJobs` inserts `kind = 'scan'`, `scan_mode` from the level, and returns a richer
  `ClaimedJob`:

  ```ts
  type ClaimedJob = {
    id: string; kind: "scan" | "follows"; username: string;
    needJoinedAt: boolean;              // joined_at IS NULL
    posts?: "recent" | "full";          // full scan only; "full" when posts_checked_at IS NULL
    comments?: boolean;                 // level in DEEP_LEVELS
    highlights?: boolean;               // level in DEEP_LEVELS && !skip_stories
  };
  ```

  A scan job also carries `known`, the posts and story pks PRM already holds (§3.1).
  The plan is computed from the account **at claim time**, so a manual scan of a low account still
  gets `posts`, but no comments and no highlights.
- `applyMeRule`, `applyBigAccountRule`, `updateTracking`, `rollForwardDueDates`, `markChecked`:
  work on the single scan due date. `markChecked(accountId, section)` stamps the section's
  `*_checked_at`; a new `markScanned(accountId)` stamps `scan_checked_at` and rolls `scan_due_at`.
- Batches (`queueBatch`, `queueFollowingRefresh`, `queueAccountsRefresh`, `followingCounts`) accept
  `scan` alongside the existing kinds. `skipRecent` uses `scan_checked_at` for scans.
- A single-section manual job (`info` / `posts` / `highlights`) stamps its section's
  `*_checked_at` but **does not** roll `scan_due_at`. Only a scan does. A manual `posts` job keeps
  today's behaviour: full grid walk to `scanLimit`, comments per the level rule.
- `postSettings()` keeps `commentLimit`, `scanLimit` and `videos`. The global "Import comments"
  switch (`POSTS_COMMENTS_KEY`) is removed; the level decides (decided 2026-10-13).
- **Time budget scales with the work** (decided 2026-10-13). Each claimed job has a weight in
  minutes: lite scan 2, full scan 6, full scan at a deep level 10, single-section job 2,
  follows 10. `server/stories-scheduler.ts`:
  - `manualBudgetMinutes(jobs)` becomes the sum of weights, clamped to 60–300 (300 stays under
    the run token's 6 h TTL).
  - The morning run's budget becomes `max(minutes left in the window, sum of weights)`, capped at
    300. A run that needs it overruns its window instead of cutting scans short.
  - `trackingMaxJobs` keeps counting jobs, so one scan counts as one job (decided 2026-10-13).

## 3. One call per scan: the contract

A scan talks to PRM exactly **twice**: the existing `POST /jobs/:id/start` (kept, decided
2026-10-13) and one new **`POST /jobs/:id/scan`** that carries everything the scan found. No
`info`, `posts/check`, `posts`, `highlights/*` or `result` calls happen during a scan.
Single-section jobs (`info`, `posts`, `highlights`) and `follows` keep today's per-call routes
unchanged (decided 2026-10-13: "Scan only").

### 3.1 What PRM sends up front (the `/track` payload)

The mid-job checks (`posts/check`, `highlights/check`) are replaced by data the claim already
carries, so the service decides on its own:

```ts
type ScanJob = ClaimedJob & {
  kind: "scan";
  known: {
    posts: { pk: string; postedAt: string; pinned: boolean }[]; // not deleted, not stories, newest first
    storyPks: string[];        // highlight-item dedupe (what highlights/check answers today)
    highlightIds: string[];    // sets PRM holds, so the service can tell new from changed
  };
};
```

`known.posts` comes from `social_account_posts` (`posted_at`, `metadata->>'isPinned'`), and
`known.storyPks` from the account's story posts, both in `claimTrackingJobs`. These lists are a
few thousand pks at most, which is fine in JSON.

### 3.2 The bundle (`POST /jobs/:id/scan`)

One `multipart/form-data` request: a `manifest` field (JSON) and files whose **field names are
paths** that the manifest refers to.

```ts
manifest = {
  status: "completed" | "failed",          // the service's view; PRM recomputes from sections
  error?: string,
  sections: {
    info: { status, reason?, meta?: InfoMeta, image?: "info/profile.jpg" },
    posts?: { status, reason?, mode: "recent" | "full", escalated?: "deleted" | "gap",
              seenPks, complete, oldestSeenAt?,
              items: { meta: PostMeta /* comments inline */, slides: string[], video?: string }[] },
    highlights?: { status, reason?, seenHighlightIds, complete,
                   items: { meta: StoryMeta, image: string, video?: string }[],
                   sets:  { meta: HighlightMeta, cover?: string }[] },
  },
  result: { ...counts },
}
// files: info/profile.jpg, posts/<pk>/slide_<n>.jpg, posts/<pk>/video.mp4,
//        highlights/items/<pk>/image.jpg|video.mp4, highlights/sets/<id>/cover.jpg
```

`InfoMeta`, `PostMeta`, `StoryMeta` and `HighlightMeta` are the exact `meta` objects the
per-call routes take today, so PRM validates them with the same zod schemas. Only posts and
items that aren't in `known` carry files. Known posts appear only in `seenPks`.

### 3.3 Answers

- **202** `{ received: true }`: the bundle is on PRM's disk. The service deletes its copy.
- **200** `{ received: true, duplicate: true }`: PRM already has a bundle for this job (a retry
  after a lost response). Treated like 202.
- **404/409**: the job isn't this run's or isn't `running`. The service logs it and drops the
  bundle.
- **5xx / network error**: retried (§4.3).

## 4. prm-stories rewrite (`PRM-stories/src/track.ts`, `src/deliver.ts`)

### 4.1 Sections write to a bundle, not to PRM

The section functions stop calling `tracking.*` directly. They take a **sink**, generalising the
existing `HighlightSink` (which already has a PRM sink and a disk sink):

```ts
interface ScanSink {
  isKnown(pks: string[], kind: "post" | "story"): Promise<string[]>;
  info(meta: InfoMeta, image: Buffer | null): Promise<void>;
  post(meta: PostMeta, slides: Buffer[], video: Buffer | null): Promise<void>;
  storyItem(meta: StoryMeta, image: Buffer, video: Buffer | null): Promise<void>;
  highlight(meta: HighlightMeta, cover: Buffer | null): Promise<void>;
}
```

- **`prmSink(jobId)`**: today's calls, one per item, with `isKnown` answered by `posts/check` /
  `highlights/check`. Used by the single-section jobs, so they behave exactly as now.
- **`bundleSink(dir, known)`**: writes the files to `runs/<stamp>-track/<jobId>/` under the §3.2
  path names and builds the manifest; `isKnown` answers from `job.known`. Used by `jobScan` and
  by the `npm run scan` CLI, which stops before the upload, so it is a real scan minus the
  upload. The existing disk `HighlightSink` folds into it.

### 4.2 `jobScan`

`Job` gains `posts`, `comments`, `highlights` and `known`. `trackOnce` gets a `scan` branch that
runs the sections on **one** profile load into a `bundleSink`:

1. **Info.** `jobInfo`'s scrape (with `needJoinedAt` → About dialog). If the account is private
   and not followed, or not found, the other sections are `skipped` with that reason.
2. **Posts** (when `job.posts` is set):
   - `"full"`: `collectGrid` down to `scanLimit`, as `jobPosts` does today. `scanLimit`'s default
     goes from 100 to **150** (decided 2026-10-13).
   - `"recent"`: read the grid nodes already on the wire after the profile load. **No `End`
     press.** Compare them with `known.posts` locally:
     - **new** = loaded pks not in `known` → imported.
     - **deleted** = known posts that aren't pinned, are newer than the oldest *non-pinned*
       loaded post, and aren't loaded. Pinned posts are left out of the window both ways
       because they can be years old.
     - **gap** = none of the loaded non-pinned posts is known (decided 2026-10-13).
     - A non-empty `deleted` list or `gap` escalates: `collectGrid` carries on from where it
       stands, now a full posts scan, `escalated: "deleted" | "gap"`.
   - `comments` comes from `job.comments`, not the run's post settings.
3. **Highlights** (when `job.highlights`): `jobHighlights` as-is, using the open profile.

A budget cut or error inside a section marks that section `failed` / `skipped: budget`, keeps
what it already wrote, and moves on to write the manifest. One section failing doesn't stop the
next unless the page itself is gone (SessionLost).

### 4.3 Delivery (`deliver.ts`)

- `tracking.scan(jobId, dir)` builds the `FormData` from the manifest with `fs.openAsBlob()`
  (Node 22) for each file, so large bundles stream from disk instead of sitting in memory.
- **Uploads overlap scraping.** A finished scan's bundle goes onto an upload queue (one upload
  at a time) and the loop moves on to the next job. Before the run's final `tracking.run(...)`
  the queue is awaited, so every scan is delivered before PRM ends the run.
- **Retries:** 3 attempts per bundle with backoff (10 s, 60 s, 5 min). Each attempt sends the
  same bundle; PRM's duplicate answer makes this safe.
- **Not delivered:** the bundle stays on disk for `RETAIN_DAYS` for debugging and the job
  reports `failed: undelivered` in the run manifest. There's no cross-run redelivery: PRM
  fails the job when the run ends (`failUnfinishedJobs`), `scan_due_at` doesn't roll, and the
  account comes due again on the next run.
- The "One call per delivery, no on-disk retry" comment above `trackingCall` is updated: scans
  are the exception.

### 4.4 Also in prm-stories

- **CLI:** `npm run scan -- <username> [--lite] [--recent] [--deep]` runs one scan into
  `runs/<stamp>-scan/` using the bundle sink. With no PRM it has no `known` list, so it reads
  `known` from the latest earlier bundle for that username, the same way `npm run highlights`
  dedupes today.
- **README** "Tracking runs" paragraph: scans by level, one upload per scan, follows only on
  request.

## 5. PRM: the `/scan` route and ingest (`server/routes/tracking.ts`, `server/tracking.ts`)

### 5.1 Receiving

- New `scanUpload` multer instance with **`diskStorage`** into `data/tracking-scans/<jobId>/`
  (keeping the field-name paths), 50 MB per file (as today), and a 400-file cap.
- `jobFor(req, res)` auth as for the other routes. If `tracking_jobs.scan_received_at` is
  already set, answer 200 duplicate and delete the new upload.
- Otherwise set `scan_received_at`, answer **202**, and start the ingest in the background. The
  job stays `running` until the ingest ends.
- The Node server's `requestTimeout` (default 5 min) is raised for this route, since a full deep
  scan can be a few hundred MB. Otherwise slow links fail mid-upload.

New column: `tracking_jobs.scan_received_at` timestamp null.

### 5.2 Ingest (`ingestScan(jobId)`)

Before anything else, the per-call handlers are refactored into request-free cores that both the
old routes and the ingest call:

| core | today inside |
|---|---|
| `applyInfo(job, account, meta, image)` | `/info` |
| `applyPost(job, account, meta, slides, video)` | `/posts` |
| `ingestStoryItem(meta, image, video, run)` | `storeStoryItem` (routes/stories.ts) |
| `upsertHighlight(...)` | `/highlights` (already a function) |
| `applyPostsSection(job, account, section)` | `/result` posts deletion pass |
| `applyHighlightsSection(job, account, section)` | `/result` highlights deletion pass |

The cores take buffers: the old routes pass `file.buffer`, the ingest reads each file from disk
as it goes. Then `ingestScan`:

1. Reads and validates the manifest. If it's invalid, the job fails with the zod error.
2. Info → `applyInfo`, `markChecked(account, "info")`, and issue raise/resolve from its reason.
3. Posts items → `applyPost` each. If the section `completed`, run `applyPostsSection` (deletions
   from `seenPks` / `complete` / `oldestSeenAt`, unchanged logic) and `markChecked("posts")`.
4. Highlights items → `ingestStoryItem`; sets → `upsertHighlight`; then
   `applyHighlightsSection` and `markChecked("highlights")`.
5. `markScanned(account)` rolls `scan_due_at`. Failed or budget-cut sections get
   `queueManualJob(account, section)` (skipped if that kind is already open), and
   `kickManualTrackingJobs()` (decided 2026-10-13). `private` / `not_found` aren't retried.
6. The job ends `completed` if any section completed, else `failed`. `result` gets the counts
   and `retries`. The bundle dir is deleted.

An item that fails to store (bad image, storage error) is counted in `result.errors` and doesn't
fail the section, the same as the per-call routes behave today.

**Idempotent:** every step is an upsert or a diff (posts by id, stories by pk,
`upsertHighlight` membership, `markChecked` stamps), so re-running an ingest is safe.

### 5.3 Ending runs and restarts

- `failUnfinishedJobs` skips jobs with `scan_received_at` set: the service is done with them and
  their ingest finishes on its own.
- **Boot sweep:** on server start, every `running` job with `scan_received_at` set re-runs
  `ingestScan`. A bundle dir with no matching running job is deleted.
- `/start`, `/follows` and the single-section routes are unchanged. `/result` is no longer used
  by scans, but stays for the other kinds, now calling the same section cores.

## 6. UI (`client/`)

- **Settings → Tracking cadence table** (`setup-stages/stage-tracking.tsx`,
  `pages/instagram-tracking.tsx`): one column, "Scan every (days)", plus a read-only column showing
  what each level gets (Lite / Full / Full + comments + highlights).
- **Account page tracking dialog** (`components/account-tracking.tsx`): a scan row on top (last
  scanned, next due, override days, **Full scan** button). Below it, one row per section (info /
  posts / highlights / followers) with last checked and its existing **Run now** button. No due
  dates on those rows.
- **History tab** run buttons (`social-account-history-tab.tsx`): **Full scan** added before the
  existing kind buttons.
- **Accounts list selection** (`social-accounts-list.tsx`) and **Tracking page batch**
  (`social-tracking.tsx`): **Full scan** added to the kind choices.
- **Tracking page "Next to get updated"**: one row per account, with the mode badge.
- **New account dialog** (`social-account-dialog.tsx`): a **Full scan** checkbox added; the
  existing ones stay.
- **Issues page** recheck: unchanged (it queues a manual `follows` / `info`).
- **Social Tasks** filter and labels: "Scan (lite)" / "Scan (full)" added. A running scan with
  `scan_received_at` set shows "Importing…". A scan with retries shows "2 parts retried" and
  links to those jobs.
- **Posts tab settings**: the "Import comments" switch is removed. The comment limit stays, with a
  note that comments are fetched for accounts at level High and above. The scan limit's default
  changes to 150.
- `ai-tools.ts` and the backup XML in `task-worker.ts`: swap the per-kind cadence fields for
  `scanEveryDays` / `scanDueAt` and keep reading the old tags on import.

---

## Stages

Each stage leaves both repos working. Follows-removal ships first because it stands alone.

| # | Repo | Stage | Done when |
|---|---|---|---|
| 1 | PRM | **Unschedule follows.** `dueAt()` drops the follows row; `applyMeRule` / `updateTracking` / `rollForwardDueDates` stop setting `follows_due_at`; the cadence tables hide follows. Manual follows unchanged. | No `schedule` job of kind `follows` is ever claimed; Tracking page "next" shows none. |
| 2 | PRM | **Request-free cores** (§5.2 table). The old routes become thin wrappers; no behaviour change. | Existing single-section tracking jobs and a stories run work exactly as before. |
| 3 | PRM-stories | **Sinks** (§4.1): `ScanSink`, `prmSink`, `bundleSink`. Single-section jobs run through `prmSink`; `npm run highlights` through `bundleSink`. No behaviour change. | A tracking run of info/posts/highlights jobs matches today's results; `npm run highlights` still dedupes against earlier runs. |
| 4 | PRM | **Schema + scheduling** (§1, §2, §3.1): `scan` kind, `scan_mode`, `scan_received_at`, scan columns, migration, claim payload with `known`, `markScanned`, batches. The schedule now creates scans, which a service without `jobScan` would fail, so this deploys together with 5 and 6. | `upcomingChecks` lists one scan per due account with the right mode and flags; the claim payload is checked per level. |
| 5 | PRM-stories | **`jobScan` + delivery** (§4.2 full posts mode only, §4.3): bundle written, uploaded via `openAsBlob`, upload queue, retries. `npm run scan` CLI. | `npm run scan -- zeroturnpete --deep` writes a complete bundle; stopping PRM mid-upload retries and then reports `undelivered`. |
| 6 | PRM | **`/scan` route + ingest** (§5.1–5.3): disk upload, 202/duplicate, `ingestScan`, retry jobs, `failUnfinishedJobs` skip, boot sweep, raised timeout, weighted budget (§2). | A run scans an account end to end in one upload: info/posts/highlights checked dates set, deletions marked, `scan_due_at` rolled once. Resending the same bundle answers duplicate. A forced highlights failure queues one manual `highlights` job immediately. Restarting PRM mid-ingest finishes the ingest on boot. |
| 7 | PRM-stories | **Recent posts scan** (§4.2 recent): no-scroll read, local `deleted` / `gap` check against `known.posts`, escalation. | On an account with posts, a rerun imports only new ones without scrolling. Hide a post on a test account and the scan escalates and marks it deleted. |
| 8 | PRM-stories | **README** (§4.4). | Docs match behaviour. |
| 9 | PRM | **UI** (§6), `ai-tools` / backup fields. | Full scan is offered everywhere a kind can be queued; settings show one cadence column. |

Stages 4, 5 and 6 share the scan contract (§3), so they are tested together in one tracking run
before any of them is deployed. Stages 2 and 3 are pure refactors that make 5 and 6 small.

## Decisions (2026-10-13)

- Manual tracking keeps the single-section buttons; **Full scan** is added as a new option.
- One scan cadence per level.
- A full posts scan walks `scanLimit` posts, default now 150.
- A recent scan with no known post in its window escalates to a full posts scan.
- Comments follow the level; the global switch goes.
- Failed or budget-cut sections are retried at once as their own manual jobs. The budget scales
  with the scans claimed.
- `trackingMaxJobs` counts a scan as one job.
- **A scan is one API call** (`/jobs/:id/scan`) after the kept `/start`. Only scans use it;
  single-section and follows jobs keep their per-call routes.
- The service gets PRM's known posts and story pks in the job payload instead of asking mid-scan.
- PRM stores the bundle to disk, answers 202 and ingests in the background; ingest is idempotent
  and resumes on boot.
- No cross-run redelivery: an undelivered scan fails and the account comes due again.
