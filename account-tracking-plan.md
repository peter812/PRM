# Account tracking — plan

PRM-stories grows from "watch the tray every evening" into the one Instagram
scraper PRM has: it also refreshes an account's profile, scrolls its follower
and following lists, and pulls its posts, on a schedule PRM derives from an
**interest level** on every social account. Results are applied straight to
the account — no pending-import review queue. The Chrome extension's post
import goes away; the extension keeps its follower/profile scraping for now.

Companion documents: `instagram-stories-plan.md` (the service this extends;
its auth, run rows, human pacing and tripwires are reused as-is), and the
memory note that follower imports cap at 10,000 — that cap is kept here.

**As built (2026-09-16)** — everything below is implemented; deviations from the
text:

- Tracking runs reuse the stories run row and manifest route
  (`story_scrape_runs.kind = 'tracking'`, `POST /api/v1/stories/runs`);
  there is no separate `/api/v1/tracking/runs`. Jobs finish through
  `POST /api/v1/tracking/jobs/:id/result`; when a run's manifest ends, any
  job it never reported is failed (`failUnfinishedJobs`).
- Job claiming (`claimTrackingJobs` in `server/tracking.ts`) reads due
  accounts with one SQL and filters blocked ones (private, over 10,000
  follows) in JS with the same `trackingBlocker()` the account page shows.
  Blocked accounts stay "due" and are simply never claimed; the page says why.
- Manual jobs run at once when an importer can take them
  (`kickManualTrackingJobs`, debounced 5 s, 60-minute budget); a busy service
  answers `already_running` and they wait for the morning.
- `resolveScrapedAccounts` stays in `task-worker.ts` (exported) and takes an
  explicit owner, since a tracking run applies as system: new neighbours
  belong to whoever owns the tracked account.
- The service (`PRM-stories/src/track.ts`) delivers each job as it finishes
  and keeps no retry queue on disk; a failed delivery fails the job and the
  account comes due again. Run directories are `runs/<date>T<HHMM>-track/`.
- The settings page has no sort-by-level on the accounts list (the filter
  covers it); the level badge shows in the table view only.
- Bulk queues (the Tracking page, the accounts list's selection) and the
  morning claim skip accounts whose same-kind check ran in the last 24 h;
  `tracking_skip_recent = "false"` in `app_settings` (Settings → Tracking)
  turns that off. A single account's "run now" never skips.
- The service drops its `running` flag *before* posting a run's closing
  manifest: PRM asks for the next run of a draining batch the moment the
  manifest lands, and used to be told `already_running` — which stalled every
  batch after its first 40. PRM's manual kick now also waits while a run it
  minted is still open, and retries a minute later on `already_running`.
- Posts are keyed by `social_account_posts.instagram_pk` (2026-09-16). Posts
  imported before that column existed — by the extension or the earlier
  LQ/HQ job kinds — were dropped on boot and come back at full quality on
  the next posts check.

Decisions made while writing this (2026-09-15):

| Question | Answer |
|---|---|
| high / very high / extreme cadences | Same as medium to start; every level's cadences are editable in Settings |
| "follower/following refresh" | The full list scroll, applied as a snapshot. The header count comes free with every info refresh |
| Post refresh variants | One `posts` job (2026-09-16 rewrite): the grid down to a scan limit, every new post in full. No LQ/HQ, no recent/all |
| tracking-freq | Per-account override of the level's defaults (null = inherit) |
| When tracking runs | A morning window per importer, separate from the evening stories run |
| Post detail | All slides full-res, like/comment counts, tagged users, location, music, and the video; comments only when the Posts settings tab enables them |
| "Me" rule | Only ever raises an account from none → medium; a level set by hand is never touched |
| Extension post import | Removed on both sides: PRM routes and the PRM-chrome popup/service-worker job |
| Spreading checks over days | Randomised first due date + jitter on every reschedule + a per-run job cap (see §2.3) |

---

## 1. Interest level and cadence

### 1.1 Levels

Six levels, stored as text on `social_accounts.interest_level`:

| Level | Value | Colour (Tailwind) | Scheduled? |
|---|---|---|---|
| None | `none` | `slate-400` | no — only stories, if the account is in a tray |
| Low | `low` | `sky-500` | yes |
| Medium | `medium` | `emerald-500` | yes |
| High | `high` | `amber-500` | yes |
| Very high | `very_high` | `orange-600` | yes |
| Extreme | `extreme` | `red-600` | yes |

`shared/interest-level.ts` exports `INTEREST_LEVELS` (ordered), a label and a
colour per level, and `TRACKING_KINDS = ["info", "follows", "posts"]`. Both
sides import it; nothing hard-codes a level string elsewhere.

### 1.2 Default cadences (days)

Global, one JSON value in `app_settings` under `tracking_level_defaults`,
editable on the settings page (§5.3). Seeded on boot when the key is absent:

| Level | Info | Follows | Posts |
|---|---|---|---|
| none | — | — | — |
| low | 30 | 30 | 60 |
| medium | 7 | 30 | 30 |
| high | 7 | 30 | 30 |
| very_high | 7 | 30 | 30 |
| extreme | 7 | 30 | 30 |

`resolveCadence(account, defaults)` returns `{ info, follows, posts }` in days
or `null` per kind: the account's own override column when set, else the
level's default, else `null` (level none). The three upper levels exist now so
accounts can be graded before the numbers are tuned; nothing else in the code
treats them differently.

### 1.3 Per-account overrides

Three nullable integer columns on `social_accounts`: `info_every_days`,
`follows_every_days`, `posts_every_days`. Null means "inherit from the level".
Changing the level clears all three, so a level change always means "use that
level's defaults" — the UI says so next to the select.

---

## 2. Scheduling

### 2.1 State on the account

`social_accounts` gains, per kind, a last-checked and a next-due timestamp:
`info_checked_at` / `info_due_at`, `follows_checked_at` / `follows_due_at`,
`posts_checked_at` / `posts_due_at`. `last_scraped_at` stays as "any direct
scrape" (the extension and XML import keep writing it).

`*_due_at` is the scheduler's only per-account state. It is set:

- when the level leaves `none` or an override changes → `now + rand(1, cadence)`
  days — uniform across the whole cadence window, so 3,000 accounts on a
  30-day cadence come due at ~100 a day rather than all at once;
- after every completed (or skipped-as-private) check → `now + cadence ×
  rand(0.9, 1.1)`, so accounts that started together drift apart;
- to `null` when the level becomes `none`.

This is what "assign different accounts different days" becomes: instead of
fixed weekdays (which only spread a 7-day cadence), the due date itself is
randomised at every step. The per-run cap in §2.3 is the backstop for the day
the randomness clumps.

### 2.2 Jobs

New table `tracking_jobs` — the queue and the log in one:

```
tracking_jobs
  id                 varchar pk
  social_account_id  varchar → social_accounts(id) on delete cascade
  kind               text     'info' | 'follows' | 'posts'
  origin             text     'schedule' | 'manual'
  status             text     'queued' | 'running' | 'completed' | 'failed' | 'skipped'
  requested_by       integer  → users(id), null for schedule
  importer_id        varchar  → story_importers(id) on delete set null
  run_id             varchar  → story_scrape_runs(id) on delete set null
  result             jsonb    per-kind counts, or { reason } for skipped/failed
  error              text
  created_at, started_at, finished_at
  index (status), index (social_account_id, created_at)
```

The same three kinds are scheduled and can be queued by hand from the
account page (§5.1). Only Instagram-type accounts
(`type_id = 00000000-0000-0000-0001-000000000001`) with a username are ever
eligible; the level select is hidden for other types.

### 2.3 The morning tick

`story_importers` gains `tracking_enabled` (default false), `tracking_window`
(default `07:00-10:00`), `tracking_max_jobs` (default 40) and
`next_tracking_run_at`. `stories-scheduler.ts` already ticks every importer
each minute; the tick grows a second branch for the tracking window, reusing
`parseWindow`, `randomTimeInWindow`, `skip_day_probability` and the
rate-limit backoff.

When an importer's tracking run is due:

1. Plan the next one first (tomorrow's window), exactly like stories.
2. Claim jobs, up to `tracking_max_jobs`:
   - queued **manual** jobs with no importer yet, oldest first;
   - then accounts with any `*_due_at <= now` that have no queued/running job
     of that kind, most overdue first. One `schedule` job row per due kind.
   - Private accounts (`is_private = true`, see §4.1) are only claimed for
     `info`; their follows/posts due dates roll forward without a job.
   - Accounts whose `reported_followers_count` or `reported_following_count`
     is above 10,000 are not claimed for `follows`; the run would hit the cap
     and be non-authoritative anyway. The account page says so and offers
     the header count instead.
3. Mint a `story_scrape_runs` row with `kind = 'tracking'` and a token (same
   TTL, same `hashToken`), mark the claimed jobs `running` with the run id,
   and `POST <service>/track` with `{ runId, token, jobs: [{ id, kind,
   username }], budgetMinutes }`.
4. On a declined start (`needs_login`, `checkpoint`, `already_running`,
   `unreachable`): schedule jobs are deleted (they are re-derived tomorrow),
   manual jobs go back to `queued` with no importer. `already_running` retries
   in 30 minutes while still inside the window.

`budgetMinutes` is the window length minus the minutes already elapsed, so a
run never spills into the day. Jobs the service did not reach come back
`skipped { reason: "budget" }`; schedule ones simply stay due, manual ones are
re-queued once.

`story_scrape_runs.kind` (`'stories'` default) is the only change to the run
table; the run's `items` holds the job summaries for a tracking run. The
auth route, `runForToken`, and the runs list are reused untouched — the
settings page just gains a *Kind* column.

### 2.4 Manual "run now"

The account page's buttons insert a `manual` job (queued). If an enabled
importer is idle (no run in the last few minutes, not inside a stories run),
PRM triggers a tracking run immediately with just the manual jobs, using the
same code path as the tick; otherwise the job waits for the next morning
window and the page says "queued for tomorrow morning".

### 2.5 The "me" rule

A *me* account is a `social_accounts` row whose `owner_uuid` is a `people` row
with `user_id` set. `social_accounts.interest_level_manual` (boolean, default
false) records that a person chose the level.

- **Boot migration** (once, in `db-init.ts`): every account on either side of
  a `social_follows` edge with a me account, currently `none` and not manual,
  becomes `medium` with `*_due_at` spread as in §2.1.
- **Ongoing**, at the end of `applySnapshot()`: for every added edge whose
  follower or followed side is a me account, the other side gets the same
  treatment. Nothing ever lowers a level; setting an account to `none` by
  hand sets `interest_level_manual` and the rule leaves it alone thereafter.

---

## 3. PRM-stories: the tracking run

### 3.1 Entry point

`POST /track` alongside `/run` in `index.ts`, guarded by the same `running`
flag (a tracking run and a stories run never overlap; the caller gets
`already_running`). Same handshake: confirm the token with
`GET /api/v1/stories/auth`, open instagram.com, `sessionState`,
`loggedInUsername`, answer `{ ok, username }` or `{ ok: false, reason }`, then
work in the background. `src/track.ts` owns the loop; each job kind is a
function in `src/jobs/<kind>.ts` that takes the page, the `Capture`, and the
job, and returns what to deliver.

Between jobs: 20–60 s idle, and every 5–9 jobs a wander (home feed, one
scroll, 15–40 s) so the session doesn't look like a profile-crawl. Inside a
job, scrolling reuses `Human` (ghost-cursor moves, 1.5–4 s between scrolls,
an 8–20 s idle every 25–40 scrolls). A wall-clock budget from PRM ends the
run early; the remaining jobs are reported `skipped: budget`.

Tripwires are the stories ones: a 429 / "wait a few minutes" ends the run
`rate_limited` (PRM backs off 48 h for **both** kinds of run on that
importer), a checkpoint page ends it `checkpoint`, a `/accounts/login` redirect
`needs_login`.

Output on disk: `runs/<date>-track/` with `run.json` (manifest: jobs, per-job
outcome, PRM verdict), `raw/` (every intercepted JSON, as today), and
`<username>/` holding what was fetched. Delivery is per job, as soon as it
finishes, through the routes in §4; `deliverPending` learns to walk
`-track` directories too. Retention as today.

### 3.2 `info` — Get account info

Navigate to `/<username>/`. The profile page's own request
(`PolarisProfilePageContentQuery` / `xdt_api__v1__users__web_profile_info`)
carries everything except the join date:

| Field | Source | PRM column |
|---|---|---|
| display name | `user.full_name` | `nickname` |
| bio | `user.biography` | `bio` |
| bio URL | `user.bio_links[0].url`, else `external_url` | `account_url` |
| 1080p picture | `user.hd_profile_pic_url_info.url`, fetched in-page (`fetchInPage`) | `image_url` via `storeProfileImage` (hash-compared, §4.1) |
| counts | `follower_count`, `following_count`, `media_count` | `reported_followers_count`, `reported_following_count`, `reported_posts_count` |
| private | `is_private` | `is_private` |
| date joined | *About this account* dialog: profile `…` menu → "About this account" → "Date joined <Month Year>" — read from the dialog's response if one is intercepted, else the dialog's text | `joined_at` (first of that month) |

The dialog is opened only when PRM's job says `needJoinedAt: true` (the
column is still null); a join date never changes, so most info refreshes are
one page load. "Account based in <country>" from the same dialog fills
`location` when the account has none.

A profile that 404s → `skipped: not_found` (PRM records it on the job and
rolls the due date; it does not delete anything).

### 3.3 `follows` — Get follower / following

Navigate to `/<username>/`, click **followers**. The dialog's list is loaded
page by page from `/api/v1/friendships/<pk>/followers/?count=12&max_id=…`
(or its GraphQL twin); intercept every page and accumulate `{ pk, username,
full_name, is_private, profile_pic_url }`. Scroll the dialog with `Human`
until a page arrives without `next_max_id` (complete) or the cap is hit —
`MAX_FOLLOWS` (10,000) per direction or the job's share of the budget. Close,
click **following**, repeat.

Deliver one JSON blob: `{ username, reported: { followers, following },
followers: [...], following: [...], complete: { followers, following } }`.
Only a **complete** direction is authoritative; PRM maps `complete` onto
`captureScope` (§4.2), which is what keeps a capped scroll from reading as a
mass unfollow.

A private account the logged-in user doesn't follow shows no list →
`skipped: private` and PRM sets `is_private`.

### 3.4 `posts` — Get posts

The grid is fed by `PolarisProfilePostsQuery`
(`xdt_api__v1__feed__user_timeline_graphql_connection`), 12 posts a page.
Each item is a full media object: `pk`, `code`, `taken_at`, `media_type`
(1 image, 2 video, 8 carousel), `caption.text`, `like_count`,
`comment_count`, `image_versions2.candidates`, `carousel_media[]` (each with
its own candidates and `usertags`), `video_versions`, `usertags`, `location`,
`clips_metadata` (music), `coauthor_producers`, `timeline_pinned_user_ids`.
So the grid alone is a full-quality import; a post page is needed only for
comments and the video file.

PRM sends its Posts settings (§5.4) with every tracking run:
`{ comments, commentLimit, scanLimit, videos }`.

1. Scroll the grid, in its own order (pinned first, then newest to oldest),
   until it ends (`complete: true`) or `scanLimit` nodes are on the wire
   (`complete: false`, default 100). The budget can cut this short: the job
   is then `skipped: budget` and nothing below happens.
2. `POST /api/v1/tracking/jobs/:id/posts/check` with every pk seen →
   `{ existing: [pk] }`. Posts PRM already has are left alone entirely.
3. For every new post: when comments are on, or the post is a video and
   videos are on, open
   `/p/<code>/` (human pacing: 5–15 s on the post) and take the first page
   of comments from `xdt_api__v1__media__media_id__comments__connection`,
   pressing "load more" until `commentLimit` (10 / 20 / 100 = "all"), and the
   video from `video_versions[0].url` in-page, capped at `MAX_VIDEO_MB`.
   Otherwise everything comes from the grid node. Fetch the largest
   candidate of every slide in-page and post one multipart per post (meta +
   one file per slide + the video).
4. The result carries `seenPks`, `complete` and `oldestSeenAt` (the
   `taken_at` of the last grid node scanned) so PRM can mark deletions
   (§4.3) within what was measured.

---

## 4. PRM ingest

All routes live in a new `server/routes/tracking.ts`, authenticated with the
run token (`authedRun` from `stories.ts`, moved to a shared helper); a job id
in the path must belong to that run. Everything runs as system, like stories.
Media goes through `stories_image_storage` (local/S3), which the settings page
now labels "Instagram media storage".

| Route | Body | Effect |
|---|---|---|
| `POST /api/v1/tracking/runs` | run manifest `{ runId, status, jobs: [...] }` | upsert `story_scrape_runs` (kind tracking); mirrors job outcomes onto `tracking_jobs` |
| `POST /api/v1/tracking/jobs/:id/info` | multipart: `meta` JSON + optional `image` | §4.1 |
| `POST /api/v1/tracking/jobs/:id/follows` | JSON blob (§3.3) | §4.2 |
| `POST /api/v1/tracking/jobs/:id/posts/check` | `{ pks: [] }` | `{ existing: [pk] }` |
| `POST /api/v1/tracking/jobs/:id/posts` | multipart: `meta` JSON + `slide_<n>` files + optional `video` | §4.3, one post |
| `POST /api/v1/tracking/jobs/:id/result` | `{ status, result, error, seenPks?, complete?, oldestSeenAt? }` | finish the job: status, `*_checked_at`, reschedule `*_due_at`, deletions (§4.3) |

### 4.1 Applying account info

1. Image: build a `FetchedProfileImage` from the upload, run
   `shouldReplaceProfileImage` (hash + resolution guard) and, when it says
   replace, `storeProfileImage` → `recordProfileImageChange`. The 1080p
   upload will replace every 150 px picture the extension ever stored, once.
2. Everything else in one `applySnapshot({ scope: "profile", source:
   "prm-stories", profile: { nickname, bio, accountUrl,
   reportedFollowersCount, reportedFollowingCount } })` so the history
   journal records what changed. `ChangeSource` gains `"prm-stories"`.
3. Direct column writes for the new fields: `joined_at`,
   `reported_posts_count`, `is_private`, `location` (only when null).

### 4.2 Applying follows

`resolveScrapedAccounts` moves from `task-worker.ts` into
`server/social-account-resolve.ts` (exported, otherwise unchanged; the
creation type string becomes a parameter — `"prm-stories"` here). Then
`applySnapshot` with `scope` = `both` when both directions are complete,
`followers` / `following` when one is, `profile` (reported counts only) when
neither. `source: "prm-stories"`, `isInitialCapture` as today. The me rule
(§2.5) runs inside the same call.

### 4.3 Applying posts

Post rows keep the extension's shape so every reader stays as it is:

- `id` = `generateDeterministicUuid("instagram:post:<pk>")`; `instagramPk`
  = the pk itself, which `posts/check` and deletion marking key on;
- `socialAccountId` = Instagram's listed author (`meta.author`), the primary
  poster — not necessarily the account whose grid the post came from;
  `coauthorAccountIds` = the other posters of a collab post, resolved to
  accounts (created if unknown) the way follows are. A collab post is one row
  that every poster's profile lists (`postedBy()` in storage); a delivery from
  an account that is neither poster is refused (409). Deletion marking stays
  keyed on the primary: a coauthor can leave a collab post without it going;
- `postType` `post` / `video` / `carousel`; `content` = stored slide urls;
  `description` = caption; `likeCount`, `commentCount`; comments in
  `social_post_comments`; `mentionedAccounts` = usertags per slide in the
  existing `[{ imageIndex, accounts }]` form; `postedAt`; `scrapedFrom`;
- `metadata` = `{ code, detail: { comments, videoSupport }, mediaType,
  productType, isPinned, location, music, author, coauthors, videoDuration, videoUrl,
  videoError }`. `detail.comments` says comments were fetched for this post;
  `detail.videoSupport` that the video file itself was stored (false for
  image posts and for a video over `MAX_VIDEO_MB` or unreachable, which keep
  the cover frame).

Each slide is registered in `photos` with `prmLocation = post:<id>` and
`syncEntityInBackground("image", …)`, exactly as the extension route did.
A redelivery of a post PRM already has updates its row and never re-uploads
slides.

Deletions: when a `posts` job completes, every non-story post of the account
that the scan should have seen but didn't gets `isDeleted = true` (never
deleted from disk; the existing `isDeleted` filter hides it). "Should have
seen" is every post when `complete`, otherwise only posts with `postedAt`
after `oldestSeenAt` — older ones are out of the scan's range, not gone. An
empty grid on an account whose `reported_posts_count` isn't 0 marks nothing
(`deletionsSkipped: empty_scan`), and neither does a run that ran out of
budget. The job result records `complete` so an incomplete scan is visible.
`currentPosts` / `deletedPosts` on `social_accounts` are
left alone — nothing reads them for this.

---

## 5. PRM frontend

### 5.1 Social account page

A **Tracking** card under the profile header (Instagram accounts only):

- Level: a select rendered as the coloured badge from §1.1; changing it
  patches `interestLevel` (which also sets `interestLevelManual` and clears
  the overrides) and shows "overrides reset" inline. A small "set
  automatically" hint appears when the me rule chose the level.
- Three rows — *Profile info*, *Followers & following*, *Posts* — each with:
  cadence input (placeholder `inherit · 7 d`), last checked, next due, and a
  **Refresh now** button that queues the manual job of that kind. The
  follows and posts rows are disabled with a reason for private accounts,
  follows also for accounts over 10,000 either way.
- Queued / running jobs for this account as chips; the last ten finished
  jobs in a collapsible list (kind, when, outcome).

New endpoints for it, all session-authenticated:
`PATCH /api/social-accounts/:id` accepts the new columns;
`POST /api/social-accounts/:id/tracking-jobs { kind }`;
`GET /api/social-accounts/:id/tracking-jobs`.

### 5.2 Social accounts list

An interest-level badge on every row, a level filter, and sort by level.
`GET /api/social-accounts/paginated` gains `interestLevel` as a filter.

### 5.3 Settings → Import & Export → Instagram

`stories-settings.tsx` is renamed in the nav from "Instagram Stories" to
"Instagram" and grows:

- On each importer card, a **Tracking** section: enabled switch, window,
  max jobs per run, next run, "Run tracking now".
- An **Interest level defaults** card: a 5 × 3 grid of day inputs writing
  `tracking_level_defaults`.
- The runs table gets a *Kind* column, and a tracking run expands to its job
  list (account, kind, outcome).
- A **Tracking jobs** card: the last 100 jobs across accounts with status
  filter, so a failed morning is visible without opening accounts.

### 5.4 Settings → Instagram → Posts

`instagram-posts.tsx` (2026-09-16): four `app_settings` keys, admin-only,
applying to every importer and sent with each tracking run (§3.4):

- `posts_scan_limit` — posts scanned per check, default 100;
- `posts_import_comments` — default off; opening every new post makes a
  check slower;
- `posts_comment_limit` — 10 / 20 / 100 ("all"; 100 is the hard cap);
- `posts_download_videos` — default on; off keeps only the cover frame of
  video posts and skips their post page.

---

## 6. Removing the extension's post import

PRM (`server/routes/social-media.ts`): delete `importInstagramPostHandler`,
`checkPostDuplicatesHandler`, their four `app.post` registrations
(`/api/posts/instagram/import`, `/api/v1/posts/import`,
`/api/posts/instagram/check`, `/api/v1/posts/check`) and
`importInstagramPostSchema`. `generateDeterministicUuid` stays (stories and
§4.3 use it). Nothing in `client/` references these routes.

PRM-chrome (separate repo, not in this session's working set — listed so the
change is complete): the *Import Posts to PRM* / *Add Most Recent Post*
button in `popup/index.html`, its handlers and status polling in
`popup/js/popup.js` (~lines 555–820), the post job in
`background/service-worker.js` (~lines 420–620, `/api/v1/posts/check` and
`/api/v1/posts/import`), and whatever `content/scraper.js` collected only for
posts. The follower / profile scraping and `pending-imports` stay.

---

## 7. Schema summary

`social_accounts` — new columns (all via `addColumnIfNotExists` in
`db-init.ts`, plus the Drizzle definitions):

```
interest_level            TEXT NOT NULL DEFAULT 'none'
interest_level_manual     BOOLEAN NOT NULL DEFAULT false
info_every_days           INTEGER
follows_every_days        INTEGER
posts_every_days          INTEGER
info_checked_at           TIMESTAMP
info_due_at               TIMESTAMP
follows_checked_at        TIMESTAMP
follows_due_at            TIMESTAMP
posts_checked_at          TIMESTAMP
posts_due_at              TIMESTAMP
joined_at                 DATE
reported_posts_count      INTEGER
is_private                BOOLEAN
index (interest_level); partial indexes on each *_due_at WHERE NOT NULL
```

`story_importers`: `tracking_enabled`, `tracking_window`,
`tracking_max_jobs`, `next_tracking_run_at`.
`story_scrape_runs`: `kind TEXT NOT NULL DEFAULT 'stories'`.
`tracking_jobs`: new table (§2.2).
`app_settings`: `tracking_level_defaults`.

---

## 8. Files

PRM

- `shared/interest-level.ts` — levels, colours, kinds, `resolveCadence`.
- `shared/schema.ts` — columns above, `trackingJobs`, types.
- `server/db-init.ts` — columns, table, defaults seed, me-rule migration.
- `server/stories-scheduler.ts` — tracking tick, job claiming, `/track`
  trigger, manual run-now.
- `server/routes/tracking.ts` — §4 routes.
- `server/routes/stories.ts` — `authedRun` shared; runs list carries `kind`.
- `server/social-account-history.ts` — `"prm-stories"` source; me rule hook.
- `server/social-account-resolve.ts` — `resolveScrapedAccounts` moved here.
- `server/routes/social-media.ts` — patch accepts new columns; tracking-jobs
  routes; extension post routes removed.
- `client/src/pages/social-account-profile.tsx` — Tracking card.
- `client/src/components/interest-level-badge.tsx` — badge/select.
- `client/src/pages/social-accounts-list.tsx` — badge, filter, sort.
- `client/src/pages/stories-settings.tsx` — §5.3.

PRM-stories

- `src/index.ts` — `POST /track`.
- `src/track.ts` — job loop, budget, pacing between jobs.
- `src/jobs/info.ts`, `follows.ts`, `posts.ts`.
- `src/intercept.ts` — matchers for profile, friendships, timeline, post and
  comments responses; `Capture` gains maps for them.
- `src/deliver.ts` — the `/api/v1/tracking/*` calls; `deliverPending` walks
  `-track` dirs.
- `src/config.ts` — `MAX_FOLLOWS`, `MAX_VIDEO_MB`.
- `README.md` — the new endpoint and run directory.

---

## 9. Build order

Each step leaves both repos working and shippable.

1. **Levels, cadences, me rule, UI** — schema, settings key and card,
   account-page Tracking card (buttons disabled with "no importer runs
   tracking yet"), list badge/filter, boot migration. No scraping.
2. **Tracking runs + `info`** — `tracking_jobs`, importer columns, morning
   tick, `/track`, the info job, `/info` and `/result` ingest, run-now.
   Proves the whole loop on the cheapest job.
3. **`follows`** — dialog scrolling, the blob, `resolveScrapedAccounts` move,
   snapshot scope mapping.
4. **Posts** — grid interception down to the scan limit, precheck, slide
   upload, post page for comments and video, windowed deletions.
5. **Extension post import removal** — PRM routes, then PRM-chrome.

---

## 10. Open risks

- **Query names drift.** Instagram renames GraphQL operations; the matchers
  in `intercept.ts` should key on payload shape (`user.hd_profile_pic_url_info`,
  `users[].pk`, `edges[].node.code`) rather than operation names, and every
  raw response is kept so a fix is a data-only patch, as with stories.
- **Follower scrolls are slow.** ~12 users a page at 2–4 s a page puts a
  5,000-follower account at ~20–30 min per direction. The job cap, the
  10,000 limit and skipping accounts over it keep a morning bounded; the
  settings page shows how many follows jobs are pending so the cap can be
  raised knowingly.
- **Morning + evening = more activity.** Two daily sessions is a visible
  change in the account's rhythm. Start with `tracking_max_jobs` low (40),
  keep `skip_day_probability` applying to both, and watch for
  `rate_limited` / `checkpoint` in the first weeks.
- **Date joined needs a click** into the About dialog; its markup and its
  request are less stable than the profile query. It is fetched once per
  account and failure is non-fatal (`joined_at` stays null, job still
  completes).
- **Deletion marking** trusts `complete`. If Instagram stops paging before
  the true end (it sometimes hides older posts behind a login-wall or a
  block), a complete-but-short scan would mark real posts deleted. Guard:
  refuse to mark deletions when `seenPks.length < reported_posts_count × 0.9`
  and flag the job `completed { deletionsSkipped: "short_scan" }`.
