# Profile checks with intents — plan

Profile checks (`info` jobs) become the only way PRM visits an Instagram
profile page for anything but follower lists. A check always records the
**current post count**, now journaled. PRM attaches **intents** to a check to
ask for extra work while the scraper is on the page. The separate monthly
`posts` job kind goes away; posts are collected when PRM asks for them with
`{update-posts}`.

Builds on `account-tracking-plan.md` (jobs, runs, cadences, ingest routes).
`instagram-highlights-plan.md` adds a `highlights` kind. It is untouched here,
but see §7.

Decisions (2026-10-04):

| Question | Answer |
|---|---|
| Post count history | A journal column, `social_account_history.reported_posts_after`, next to `reported_followers_after` |
| Who decides to scrape posts | PRM, when it builds the job (§3). The scraper does what the intent says |
| Detecting added and deleted posts | PRM sends the post ids (and dates) it already holds with the intent. The scraper diffs the grid against them; new posts are imported and missing ones marked deleted (§4) |
| Simplification | Drop the `posts` job kind (pros and cons in §8) |

---

## 1. Current post count, journaled

`media_count` is already read on every info check and written to
`social_accounts.reported_posts_count`, outside the journal. This change
makes it historical:

- `social_account_history.reported_posts_after INTEGER` (nullable), added via
  `addColumnIfNotExists` in `db-init.ts` and in `shared/schema.ts`.
- `IngestSnapshot.profile` gains `reportedPostsCount`. `applySnapshot`
  writes it to `social_accounts` with the reported follower counts and
  stamps `reportedPostsAfter: p.reportedPostsCount ?? before.reportedPostsCount`
  on the direct entry.
- `recordPostsCapture`, `recordProfileImageChange` and
  `recordAccountProfileChanges` carry the account's current
  `reported_posts_count` into `reported_posts_after`. The column stays
  continuous on every entry, like the follower columns.
- The info route (`server/routes/tracking.ts`) passes `reportedPostsCount`
  into `applySnapshot` and drops it from the direct "fields the journal
  doesn't track" update. Only `isPrivate` stays there.
- There's no backfill. History starts at the first check after deploy, and
  older entries read null.
- UI: `social-account-history-modal.tsx` shows the posts count beside the
  reported followers. The history tab's timeline gets a "posts" line or
  column where it shows reported counts.

## 2. Intents

An info job carries a list of intents. The scraper always does the base check
(profile JSON, picture, counts, privacy) and then each intent:

| Intent | Replaces | PRM sets it when | Scraper does |
|---|---|---|---|
| `get-account-age` | `needJoinedAt: true` | `joined_at` is null | Opens the About dialog → `joinedAt`, `basedIn` (unchanged code) |
| `update-posts` | the `posts` job kind | §3 | Scrolls the grid, diffs it against `knownPosts`, imports new posts, reports deleted ones (§4) |

Wire format (the `/track` body's `jobs[]`):

```ts
{
  id: string;
  kind: "info" | "follows" | "highlights";
  username: string;
  intents?: ("get-account-age" | "update-posts")[];
  /** With update-posts: what PRM already holds for this account, newest first. */
  knownPosts?: { pk: string; takenAt: string; pinned?: boolean }[];
}
```

`needJoinedAt` is removed on both sides. Both repos deploy together, so
there's no transition shim.

`tracking_jobs` gains `intents TEXT[] NOT NULL DEFAULT '{}'`, so a queued
manual job remembers what it was asked to do. `knownPosts` is not stored. It
is read fresh when the job is claimed, so it reflects what PRM holds at run
time.

Intents are additive on one open job. A manual "Refresh posts" on an account
that already has an info job queued adds `update-posts` to that job instead of
answering 409. A manual "Refresh info" on one already queued stays a 409.

## 3. When PRM sets `update-posts`

The decision happens in `claimTrackingJobs` (and the same SQL in
`upcomingChecks`, so the preview can't drift). An info job gets
`update-posts` when the account is not private and any of these holds:

1. **Never collected.** `posts_checked_at` is null.
2. **Count moved.** `reported_posts_count` (from the last check) differs from
   `posts_count_at_check`, a new column holding the reported count when posts
   were last collected. Any change counts, up or down: a drop is a deletion.
3. **Stale.** `posts_checked_at` is older than the account's posts refresh
   interval: the existing `posts` cadence column, now relabeled "Full post
   refresh every N days" and defaulting to 90 (low 180). This catches what a
   count can't: a delete and an add that cancel out, edited captions, drifting
   like counts.
4. **Asked for.** A manual or bulk "Refresh posts" (§5).

Trade-off of deciding ahead of time: rule 2 compares against the count from
the *previous* check, so a new post is noticed one info check late
(≈ one info cadence: 7 days at medium). If that lag matters, see §9.

`posts_count_at_check` is written in the result handler when an
`update-posts` intent completes, from the count that same check read.

## 4. The scan and the diff

### 4.1 What PRM sends

`knownPosts` holds the account's posts PRM holds (non-deleted, not stories,
`postedBy(account)` so collabs count), newest first, limited to
`posts_scan_limit` (default 100). Every known pinned post is added on top,
since pinned posts sit first in the grid regardless of age. That's a few KB
per job.

### 4.2 What the scraper does

1. Scroll the grid as `collectGrid` does today, until whichever comes first:
   - the grid ends (`complete: true`);
   - `scanLimit` nodes;
   - a non-pinned node older than the oldest `knownPosts` entry *and* every
     non-pinned known id has been seen. The rest is already held.

   With an empty `knownPosts` (first collection), the stop rules are
   unchanged.
2. Diff locally. **New** = grid pks not in `knownPosts`. **Deleted** = known
   pks whose `takenAt` falls inside the scanned window (newer than the oldest
   non-pinned node seen, or anywhere when `complete`) and that the grid didn't
   show. Known pinned posts count as seen only if seen.
3. Import each new post through the existing `POST
   /api/v1/tracking/jobs/:id/posts` (unchanged: slides, video, comments per
   Posts settings).
4. Report in the job result: `posts: { seenPks, newPks, deletedPks,
   complete, oldestSeenAt }`.

`POST /api/v1/tracking/jobs/:id/posts/check` is removed. `knownPosts`
replaces the round trip.

### 4.3 What PRM does with the result

The `/result` handler's posts branch moves from `job.kind === "posts"` to
"the result carries `posts`". It keeps every existing guard:

- PRM recomputes deletions itself from `seenPks`, `complete` and
  `oldestSeenAt` with today's windowed rule, rather than trusting
  `deletedPks`. The scraper's list goes into the job result for comparison
  only. Guards stay: `empty_scan`, `no_window`, and the `short_scan` guard
  from the tracking plan's risks (`seenPks < reported × 0.9` on a "complete"
  scan).
- `recordPostsCapture` journals added/deleted as today.
- It stamps `posts_checked_at` and `posts_count_at_check`.

A private profile, or a budget cut mid-scroll, completes the info part and
marks the posts part `postsSkipped: "private" | "budget"`. Then
`posts_checked_at` isn't stamped, so rule 3 or 2 brings it back next time.

## 5. Scheduling changes

- `TRACKING_KINDS` becomes `["info", "follows"]` (plus `highlights` when that
  plan lands). `TRACKING_KIND_LABEL`, the `dueAt` VALUES list, `DUE_COLUMN`,
  `CHECKED_COLUMN`, `OVERRIDE_COLUMN` and `rollForwardDueDates` lose `posts`.
- `posts_due_at` is no longer read or written. It's dropped in `db-init.ts`
  once nothing references it. `posts_checked_at` and `posts_every_days` stay
  with their new meanings (§3).
- `Cadence` keeps three numbers. `posts` now means "full refresh every". The
  level-defaults grid on the settings page relabels that column. Defaults:
  low 180, the rest 90. Existing stored values (30/60) are reset once by a
  boot migration, since 30 under the new meaning would force a scan almost
  every check.
- The info cadence is now the post-detection cadence. Medium stays 7 days.
  Consider bringing low from 30 down to 14 if posts on low accounts should
  surface faster. Your call; nothing in the code depends on it.
- Bulk and manual "Refresh posts" (Tracking page, accounts list selection,
  account page) queue **info** jobs with `update-posts`. The batch helpers
  take `{ kind, intents }`. The "skip recently checked" rule for a posts
  refresh keys on `posts_checked_at`.
- Boot migration: queued `posts` jobs become `info` jobs with `update-posts`
  (merged into an existing queued info job if there is one). Finished
  `posts` jobs stay as history. The UI labels the old kind "Posts (legacy)".

## 6. Files

PRM

- `shared/schema.ts`, `server/db-init.ts`: `reported_posts_after`,
  `posts_count_at_check`, `tracking_jobs.intents`, the migrations above.
- `shared/interest-level.ts`: kinds, labels, defaults, an `INTENTS` list.
- `server/social-account-history.ts`: `reportedPostsCount` in the snapshot,
  `reportedPostsAfter` on every entry.
- `server/tracking.ts`: intents in the claim and the preview (§3),
  `knownPosts` loading, batch/manual queueing with intents.
- `server/routes/tracking.ts`: info route journals the count; `/posts/check`
  removed; `/result` posts branch keyed on the result; manual queue merges
  intents.
- `server/stories-scheduler.ts`: sends `intents` and `knownPosts` in `/track`.
- `client/src/components/account-tracking.tsx`,
  `client/src/pages/social-account-profile.tsx`: the Posts row shows "last
  collected", the full-refresh interval and "Refresh posts" (an info job with
  the intent); job chips show intents.
- `client/src/pages/social-tracking.tsx`, `social-accounts-list.tsx`: bulk
  posts refresh → info + intent.
- `client/src/components/social-account-history-modal.tsx`,
  `social-account-history-tab.tsx`: posts count.
- `account-tracking-plan.md`: an "As changed (2026-10)" note pointing here.

PRM-stories

- `src/track.ts`: `Job.intents`, `Job.knownPosts`; `jobInfo` runs
  `aboutAccount` on `get-account-age` and the posts scan (`jobPosts`' body,
  minus its own `openProfile`) on `update-posts`; known-id stop rule in
  `collectGrid`; the `posts` branch in the job loop is removed.
- `src/index.ts`: parse `intents` and `knownPosts`; drop `needJoinedAt`.
- `src/deliver.ts` (or wherever `tracking.checkPosts` lives): remove
  `checkPosts`.
- `README.md`: the job shape.

## 7. Build order

1. **Post count history.** §1 only. Ships on its own and starts the series
   accumulating.
2. **Intents plumbing with `get-account-age`.** `tracking_jobs.intents`, the
   wire format, replace `needJoinedAt`. No behaviour change.
3. **`update-posts` on info jobs.** Scraper path, `knownPosts`, the diff, the
   `/result` branch. Both kinds work side by side here, so it can be tested
   on single accounts by hand.
4. **Retire the `posts` kind.** §3 rules in the claim, cadence relabel and
   reset, the migration of queued jobs, the UI, removal of `/posts/check` and
   the scraper's posts branch.

Highlights: the same reasoning applies (one profile visit, read the tray,
diff against known highlight ids). Once step 4 is in, `highlights` could
become a third intent rather than a fourth kind. That's left for the
highlights plan to decide.

## 8. Dropping the `posts` job kind — pros and cons

**Pros**

- **One visit per profile.** Today a medium account gets ~4 info visits and 1
  posts visit a month, each loading the same profile page. Folding posts into
  info removes the duplicate loads, which are the profile-crawl pattern the
  tripwires watch for.
- **Posts follow activity, not the calendar.** An account that hasn't posted
  in a year is no longer scrolled monthly. One that posts daily is scanned as
  often as it's checked.
- **Less scheduler surface.** One fewer kind in `dueAt`, the claim, the
  preview, roll-forward, batch queues, the account card and the settings
  grid; one fewer due column; no `/posts/check` round trip.
- **Fewer morning jobs.** The per-run cap (`tracking_max_jobs`) stops being
  shared between two jobs for the same account.
- **Deletions get noticed sooner.** A count drop now triggers a scan instead
  of waiting up to 30 days.

**Cons**

- **Less predictable job length.** An info job used to be one page load
  (~10 s). With `update-posts` it can be a full grid scroll plus post
  uploads. The run's time budget still bounds a run, but job count stops
  being a good proxy for run length; expect more `budget` skips at first.
- **One-check lag on new posts** (§3, rule 2) under "PRM decides ahead of
  time". Up to one info cadence late.
- **Count-blind changes rely on the slow refresh.** A delete-plus-add swap,
  caption edits and like counts wait for rule 3 (every 90 days by default)
  instead of 30.
- **Failure coupling.** A grid scroll that breaks (Instagram changes the
  timeline query) now fails inside the info job. The plan contains this with
  `postsSkipped`, so the info part still lands, but the code path is more
  tangled than two independent kinds.
- **Migration and UI churn.** Legacy `posts` jobs in history, the relabeled
  cadence column (same number, new meaning, which is easy to misread), and
  every bulk "Refresh posts" button re-plumbed.
- **No standalone "just posts" job.** "Refresh posts" now also refreshes the
  profile. That's harmless but slightly slower than a posts-only job would be.

Net: the simplification is real (one kind, one visit, one fewer route). The
costs are mostly the lag and the less predictable run length, and both can be
tuned (§9).

## 9. Open risks and knobs

- **The lag.** If seeing posts within one check matters, the cheapest fix
  doesn't change the model. Send `update-posts` on every check of a
  `high`-or-above account, and let the known-id stop rule end the scan after
  the first grid page (12 posts, about one extra request) when nothing is new.
- **Collab posts.** The grid shows posts where the account is a coauthor.
  `knownPosts` uses `postedBy()` so they aren't re-imported, and deletion
  marking stays keyed on the primary poster, as it is today.
- **Pinned posts.** Old pinned posts appear first. They're sent explicitly in
  `knownPosts` so they don't read as new. A newly pinned old post PRM never
  had is imported like any new one.
- **The known-id stop rule** trusts grid order (newest first after pins). If
  Instagram reorders, the rule degrades to the scan limit, which is today's
  behaviour, not a wrong result.
