# Tagged posts: plan

A new tracking job kind, **`tagged`**. It opens an account's Tagged tab on Instagram, collects every
post other accounts tagged that account in, and imports those posts into PRM along with the accounts
that posted them. This is the Instagram-only part of `PRM-stories/imginn-tagged-plan.md` §3. imginn
is out of scope.

## Decisions (2026-10-28)

| # | Question | Decision |
|---|---|---|
| 1 | Comments | **Off for now.** The `comments` flag is built end to end (job → PRM-stories → `applyPost`), but every queue path sends `false` and the UI has no switch for it. |
| 2 | Scan limit | Reuse `posts.scanLimit` (`POSTS_SCAN_LIMIT_KEY`, default 150). No separate setting. |
| 3 | Schedule | **Manual only.** `tagged` is not part of `scan`, and there is no cadence, no `tagged_due_at` and no column on the Tracking page. |
| 4 | Poster accounts | New posters are created at interest level **`none`** (the column default). Existing accounts' levels are never touched. No `info` job is queued, and the "me" rule is not run on them. |
| 5 | Where a post shows up | One row under its **poster**. When account B posts a photo that tags account A, the post shows in **A's Tagged tab** (through the link table) and in **B's Posts tab** (it is B's post). |
| 6 | Faces | Auto-recognition runs on every new tagged post, the same as on own posts (`enqueueAutoRecognition`). |

> **Check on 5:** the answer read "A mentions B → A's tagged, B's posts". This plan uses the reading
> above (poster → Posts, tagged account → Tagged), which is how Instagram's tabs work. Say if the
> other way round was meant.

---

## Phase 0: Capture the Instagram tagged payload (PRM-stories)

Nothing under `runs/*/raw` has a Tagged-tab response yet, so the parser can't be written blind.

1. Add `scripts/explore-tagged.ts`, modeled on `scripts/explore-viewer.ts`. It launches the logged-in
   profile, `openProfile(<user>)`, clicks the **Tagged** tab (`a[href$="/tagged/"]`), presses `End` a
   few times, and saves every intercepted response to `runs/<stamp>-tagged/raw/`.
2. Run it on three accounts: a public account with many tags, a private account the profile follows,
   and an account with an empty Tagged tab.
3. Record the following in a short note at the top of `src/track.ts`'s tagged reader:
   - the feed's route or GraphQL `doc_id`/friendly name, for example `usertags`;
   - where the node list and the cursor/`more_available` sit;
   - whether each node already carries `user.profile_pic_url`, `full_name`, `carousel_media`,
     `video_versions` and `usertags` (that is, whether `postMeta` can run on it unchanged);
   - what the empty and private states look like.

**Done when:** raw payloads are saved for all three cases and the fields above are known.

---

## Phase 1: PRM schema and shared constants

**`shared/schema.ts`**

```ts
export const socialAccountPostTags = pgTable("social_account_post_tags", {
  postId: varchar("post_id").notNull().references(() => socialAccountPosts.id, { onDelete: "cascade" }),
  socialAccountId: varchar("social_account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }), // the tagged account
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  removedSeenAt: timestamp("removed_seen_at"), // a complete scan no longer showed it; null while tagged
}, (t) => [
  primaryKey({ columns: [t.postId, t.socialAccountId] }),
  index("social_account_post_tags_account_idx").on(t.socialAccountId),
]);
```

- `socialAccounts` gains `taggedCheckedAt: timestamp("tagged_checked_at")`. It only records the last
  run; there is no due date.
- Add the relations and the insert/select types next to `socialAccountPosts`.

**`server/db-init.ts`**: an idempotent `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`,
following the migration-ledger pattern.

**`shared/interest-level.ts`**

- `TRACKING_KINDS` gains `"tagged"`, and `TRACKING_KIND_LABEL.tagged = "Tagged posts"`.
- Audit every `TRACKING_KINDS` loop. `account-tracking.tsx` lists the kinds with a "last checked"
  column (`highlights: "highlightsCheckedAt"`), so `tagged` maps to `taggedCheckedAt`. Anything that
  computes cadence or due dates per kind must skip `tagged`, because it is manual only.

**Done when:** `npm run check` passes and the migration applies cleanly against the dev DB.

---

## Phase 2: PRM import backend

All of this is in `server/routes/tracking.ts` and `server/tracking.ts`.

### 2.1 Queueing

- `queueManualJob(accountId, "tagged")` builds a job with `comments: false`.
  `server/tracking.ts:274` today sets `comments` only for `posts`, so extend it with an explicit
  `tagged → false`. The flag stays wired through so it can be switched on later.
- The job payload sent to PRM-stories carries the same `posts` settings object (scan limit, videos).
- `POST /api/social-accounts/:id/tracking-jobs` already validates against `TRACKING_KINDS`, so it
  needs no change.

### 2.2 `applyPost` gains a mode

```ts
applyPost(ctx, meta, slides, video, opts?: { taggedAccountId?: string })
```

- When `taggedAccountId` is set, skip the 409 "post belongs to @x, not the tracked account" check.
  The post is still stored under the resolved poster (`primaryId`).
- **Poster account:** `resolveScrapedAccounts([{ username, full_name }], INSTAGRAM_TYPE_ID, "prm-stories tagged")`.
  - It creates missing accounts with no `interestLevel`, so the column default `none` applies.
  - Existing accounts are only looked up; their level, `interestLevelManual` and `scanDueAt` are untouched.
  - Do **not** call `applyMeRule` or `queueMentioned`-style info queueing for the poster.
    `queueMentioned` for slide usertags stays as it is, because it is governed by its own setting.
- **Poster LQ picture:** when `meta.poster.profilePicUrl` is set and the poster has no
  `currentProfile.imageUrl`, call `queueSocialProfileImage(posterId, url, …)`, the same path follower
  imports use. A poster that already has a picture is left alone, so an HQ picture is never replaced
  by an LQ one.
- Everything else is unchanged: slides, video, `upsertComments` (empty while comments are off) and
  **`enqueueAutoRecognition`**, which already runs for every new post (decision 6).

`postMetaSchema` gains an optional `poster: { username, fullName?, profilePicUrl? }`.

### 2.3 Service routes

| Route | Body | Does |
|---|---|---|
| `POST /api/v1/tracking/jobs/:id/tagged/check` | `{ pks }` | `{ existing, linkOnly }`. `existing`: PRM holds the post and it is linked to this account. `linkOnly`: PRM holds the post (for example from the poster's own posts job) but it isn't linked yet. |
| `POST /api/v1/tracking/jobs/:id/tagged` | multipart, same as `/posts` | `applyPost(..., { taggedAccountId: job.account })`, then upsert the link. Returns `{ outcome, postId }`. |
| `POST /api/v1/tracking/jobs/:id/tagged/link` | `{ pks }` | Upsert links for held posts and bump `lastSeenAt`. Returns `{ linked }`. |
| `POST /api/v1/tracking/jobs/:id/result` | `seenPks`, `complete` | For `kind === "tagged"`: bump `lastSeenAt` on every seen link. If `complete`, stamp `removedSeenAt` on links not in `seenPks`, and clear `removedSeenAt` on any that came back. Then `markChecked(account.id, "tagged")`. |

Link upsert: `INSERT … ON CONFLICT (post_id, social_account_id) DO UPDATE SET last_seen_at = now(), removed_seen_at = NULL`.

`removedSeenAt` is only ever set by a complete scan. A scan that stopped at the scan limit vouches
for nothing older than its last node, the same rule `applyPostsSection` uses.

### 2.4 Read route for the UI

`GET /api/social-accounts/:id/tagged-posts?includeRemoved=true`

- Selects posts joined through `social_account_post_tags` for this account, excluding `postType = 'story'`.
- Each row is the usual `SocialAccountPost` plus `poster: { id, username, imageUrl }` (from the
  poster's current profile) and `tag: { firstSeenAt, removedSeenAt }`.
- Sorting follows the Posts tab's `?sort=` options.

**Done when:** a hand-built multipart request (or the Phase 3 dry run piped through) stores a post
under a new poster at level `none`, creates the link, queues the LQ picture and starts recognition;
and `/link` and `/check` behave as specified.

---

## Phase 3: PRM-stories `tagged` job

| File | Change |
|---|---|
| `src/track.ts` | `JOB_KINDS` gains `"tagged"`. Add `collectTagged()` and `jobTagged()`. Dispatch in `trackOnce` next to `posts`. |
| `src/index.ts` | `parseJobs` already passes `comments` through. Add `npm run tagged -- <user>` (dry run to `runs/<stamp>-tagged/`, no PRM), like `npm run highlights`. |
| `src/deliver.ts` | `tracking.checkTagged(jobId, pks)`, `tracking.tagged(jobId, meta, slides, video)` and `tracking.linkTagged(jobId, pks)`. |
| `package.json` | the `tagged` script. |
| `README.md` | a **Tagged posts** paragraph next to Highlights. |

**`collectTagged(page, human, wire, username, limit, deadline)`**

- Starts from the profile page that `openProfile` loaded, then clicks the Tagged tab and pauses with
  `human`.
- `ingest()` already files media nodes into `wire.media`. `collectTagged` keeps **its own ordered pk
  list and its own `moreAvailable`**, filled only from the tagged-feed responses identified in
  Phase 0, so a timeline response arriving in the background can't add posts or end the scan.
- Scrolls with `End` the way `collectGrid` does, until `limit`, the end of the feed, or the deadline.
- Returns `{ nodes, complete }`. An empty tab returns `{ nodes: [], complete: true }`. Private and
  not followed returns `Private`, like `jobPosts`.

**`jobTagged`**

1. `collectTagged` → pks.
2. `checkTagged` → `linkTagged(linkOnly)` in one call. Drop `existing` and `linkOnly` from the targets.
3. For each remaining target, run the same per-post path as `jobPosts`: `postMeta` plus `slideBytes`.
   Open the viewer only for video (and for comments when `job.comments` is true, which it isn't
   for now). Add `poster: { username, fullName, profilePicUrl }` from `owner(node)`.
4. `tracking.tagged(...)` per post, counting stored, duplicate and failed posts as `jobPosts` does.
5. `finish(job, "completed", { status: "completed", seenPks, complete, counts })`.

Factor out the shared per-post loop of `jobPosts` (fetch, deliver, count) into a helper that both
jobs call, instead of copying ~60 lines.

**Done when:** `npm run tagged -- <user>` writes a sensible manifest, and a live run through PRM
stores new posts, links already-held ones, and reports `complete`.

---

## Phase 4: Frontend

### 4.1 History tab dropdown

`client/src/components/social-account-history-tab.tsx`: the *Update from PRM Stories* menu maps over
`TRACKING_KINDS`, so **Tagged posts** appears once Phase 1 lands. It queues with comments off, which
is the server default. There is no comments switch in the UI yet (decision 1). Check the item's
disabled and in-flight state and the "Queued" toast.

### 4.2 Shared posts grid

Pull the Posts tab's grid out of `social-account-profile.tsx` (the loading skeleton, the cards, the
deleted styling, the click that opens `post-detail-dialog`) into `components/social-posts-grid.tsx`.
It takes a `renderBadge?: (post) => ReactNode` prop. The Posts tab uses it unchanged.

### 4.3 Tagged tab

`client/src/pages/social-account-profile.tsx`

- `VALID_TABS` gains `"tagged"`. A `TabsTrigger` goes after **Posts**, labelled *Tagged*.
- The query `["/api/social-accounts", uuid, "tagged-posts?includeRemoved=true"]` is enabled only on that tab.
- The header shows *Tagged posts (n)*, the same Sort select, and a **Retrieve tagged posts** button
  that queues `tagged`. It works like *Retrieve Posts* and shows "Queued" while a job is open.
- Each card's badge is the **poster**: the LQ avatar plus `@username`, linking to
  `/social-accounts/<poster.id>`. Posts whose tag was removed are dimmed, with "Tag removed".
- When the job finishes, the history tab's existing open-jobs effect invalidates the account. Make
  sure it also invalidates `tagged-posts`.

### 4.4 Person page mirror

Per the person-page rule, if `person-profile.tsx` (and `me-profile.tsx`) embed the account Posts
view, add the Tagged view there too. Otherwise nothing changes.

**Done when:** in the browser preview, an account's History dropdown queues *Tagged posts*, the job
runs, and the Tagged tab shows the imported posts with poster badges. Opening a post shows its
detail, and the poster's own Posts tab shows the same post.

---

## Phase 5: Verification

- `npm run check` in PRM and `npx tsc --noEmit` in PRM-stories.
- One end-to-end run on each of the three Phase 0 accounts. Confirm:
  - new posters are at level `none`, and existing posters' levels are unchanged;
  - LQ pictures were queued only for posters with no picture;
  - face recognition tasks appeared for the new posts;
  - a second run downloads nothing (everything is `existing`);
  - a post first imported by the poster's own posts job is `linkOnly` and not re-downloaded.
