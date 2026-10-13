# Pinned stories (Instagram highlights): plan

Instagram lets an account pin stories into named sets called **highlights**. This plan imports
them into PRM, records **when each story was placed in a set, when it left, and when the set was
deleted** (each timestamp is when PRM *learned* it), and reworks the account Stories tab around
them.

This plan supersedes `instagram-highlights-plan.md` (last committed in `4bd89a5`). That handoff's
service contract stays the same. What changes is how PRM stores it: the old design replaced
`item_pks` in place, so history was lost. This one compares each incoming list against what PRM
holds and records the differences.

> **As built (2026-10-12), simpler than below:**
> - No cover columns (`cover_pk`, `cover_image_id`, `cover_url`, `latest_reel_media`). Chips don't
>   show covers, so the `cover` file and those meta fields are accepted and ignored.
> - No `stories-scheduler.ts` change: prm-stories falls back to `posts.videos` when `/track` has no
>   `highlights` field.
> - No `story_pk` index on memberships: the UI loads stints by set.
> - The color popover offers the palette swatches only, with no free `<input type="color">`.
> - Card tooltips are replaced by the set titles shown under the date.
> - The story ingest is shared: `storeStoryItem` and `runImageTaskGroup` in `server/routes/stories.ts`
>   serve story runs, highlight items and posts.

Decisions (2026-10-12):
- The UI goes on the **account Stories tab** (`client/src/components/stories-tab.tsx`). There is
  no global stories page.
- A story in several sets gets a **segmented ring**: the thin outline is split into one colored
  arc per set.
- Set colors are **auto-assigned and user-editable**.
- The grid shows **current membership only**. All history (placed, left, set deleted) appears in
  the story dialog.

---

## 0. What already exists

- **prm-stories: done.** The `highlights` job kind is in `PRM-stories/src/track.ts` (`jobHighlights`).
  Per job it sends:
  1. `POST …/jobs/:id/highlights/check {pks}`, answered with `{existing}`.
  2. `POST …/jobs/:id/highlights/items`, once per pk PRM doesn't have (StoryMeta + image + optional video).
  3. `POST …/jobs/:id/highlights`, once per loaded highlight (title, coverPk, `itemPks` in order, optional cover file).
  4. `POST …/jobs/:id/result` with `seenHighlightIds` and `complete`.

  **The service needs no changes.** It already sends the full ordered list on every job, which is
  all PRM needs to work out the differences.
- **PRM: nothing yet.** There's no table, no routes, and no `highlights` tracking kind.
- A highlight item has the pk of the story it was saved from, so **a highlight item is a story
  row** (`social_account_posts`, `postType: "story"`, id `storyPostId(pk)`). If the nightly
  stories run already caught it while it was live, the row already exists.

## 1. Data model (`shared/schema.ts`)

### `instagram_highlights`: one row per set, holding its current state

| column | notes |
|---|---|
| `id` uuid pk | |
| `social_account_id` FK → social_accounts, cascade | |
| `instagram_id` text | e.g. `18042422108256753` |
| `title` text null | replaced on every upsert |
| `color` text not null | hex. Auto-assigned on insert (§3.4), changeable from the UI |
| `cover_pk` text null | display the cover from `storyPostId(cover_pk)`'s image |
| `cover_image_id` FK → images null | only for a custom cover uploaded as a file |
| `cover_url` text null | signed CDN link. Debugging only, never hotlinked |
| `latest_reel_media` timestamptz null | |
| `first_seen_at` timestamptz | when PRM first learned the set existed |
| `last_seen_at` timestamptz | the last job that saw it |
| `deleted_seen_at` timestamptz null | when PRM learned the user deleted the set. Null means live |

Unique index on `(social_account_id, instagram_id)`.

### `instagram_highlight_memberships`: one row per stint of a story in a set

| column | notes |
|---|---|
| `id` uuid pk | |
| `highlight_id` FK → instagram_highlights, cascade | |
| `story_pk` text | store the pk, not the post id: a pk whose upload failed still counts, and it resolves once a later job uploads it. Resolve with `storyPostId(pk)` at read time |
| `position` integer | 0-based order in the set. Updated while the stint is open |
| `placed_seen_at` timestamptz | when PRM learned it was in the set |
| `last_confirmed_at` timestamptz | the last job that saw it still in the set |
| `left_seen_at` timestamptz null | when PRM learned it was gone. Null means a current member |
| `left_reason` text null | `'removed'` (taken out of a live set) or `'set_deleted'` |

Indexes:
- Partial unique index on `(highlight_id, story_pk) WHERE left_seen_at IS NULL`, so a story has at
  most one open stint per set.
- An index on `story_pk`, for the story dialog lookup.

Why there's no separate events table: each stint *is* the history. "Placed" is `placed_seen_at`,
"left" is `left_seen_at` + `'removed'`, and "set deleted" is `left_seen_at` + `'set_deleted'`. A
story that is removed and re-added gets a second row. `last_confirmed_at` → `left_seen_at` gives
the window in which the change actually happened.

**First-import caveat:** Instagram doesn't say when an item was added. On the first scan, every
item is already in its set, so `placed_seen_at = first_seen_at` of the set. The UI shows that as
"already in set when first seen", not as a placement date (§4.3). No extra column is needed.

Migration: `npm run db:push` (drizzle-kit), the same way existing tables were added.

## 2. Tracking kind plumbing

- `shared/interest-level.ts`:
  - Add `"highlights"` to `TRACKING_KINDS`.
  - Add `TRACKING_KIND_LABEL.highlights = "Highlights"`.
  - Add `highlights` to every row of `DEFAULT_LEVEL_CADENCES`: none `null`, low `90`, others `30`.
  - Add it to the cadence resolver (around line 115).
- `shared/schema.ts` social_accounts:
  - Add `highlightsEveryDays`, `highlightsDueAt` and `highlightsCheckedAt`.
  - Add a partial due index, the same as `posts_due_idx`.
- `server/tracking.ts`: add `highlights` to `DUE_COLUMN`, `CHECKED_COLUMN`, `OVERRIDE_COLUMN` and the
  `*_SQL_COLUMN` maps.
- Skip the highlights kind for `skipStories` accounts. Highlight items are stories, and the item
  handler would refuse them anyway.
- `server/stories-scheduler.ts` `triggerTrackingRun`: add `highlights: { videos }` to the `/track`
  body, using the same value as `posts.videos`. There's no separate setting.
- The settings UI that edits cadences and the account page's "run job now" menu get the new kind.
  Both read `TRACKING_KINDS`, so check that the new kind renders.

## 3. Server routes

### 3.1 Extract the story-item insert
Move the body of `POST /api/v1/stories/runs/:runId/items` (`server/routes/stories.ts:185`) into
`storeStoryItem({ meta, image, video, runId | jobId })` → `{ outcome, postId }`. The stories route
and the new highlights route both call it. The only difference is where the row is attributed:
a run, or a tracking job. Don't treat a past `expiresAt` as "expired, skip".

### 3.2 New job-scoped routes (`server/routes/tracking.ts`, auth via `jobFor`)
- `POST /api/v1/tracking/jobs/:id/highlights/check {pks}` → `{existing}`. Look the pks up by
  `storyPostId(pk)`, the same way `/api/v1/stories/check` does. Reuse that lookup.
- `POST /api/v1/tracking/jobs/:id/highlights/items` (multipart `meta`, `image`, `video?`) → `storeStoryItem`.
- `POST /api/v1/tracking/jobs/:id/highlights` (multipart `meta`, `cover?`) → `upsertHighlight` (§3.3).

### 3.3 `upsertHighlight(accountId, meta, cover, now)`: the comparison
Run it in a single transaction:
1. Upsert the set on `(social_account_id, instagram_id)`:
   - Set `title`, `cover_*`, `latest_reel_media` and `last_seen_at = now`.
   - On insert, set `first_seen_at = now` and `color = nextColor(account)`.
   - If `deleted_seen_at` was set, the set has come back (for example after an archive and
     restore, or a false deletion). Clear `deleted_seen_at`. Its earlier stints stay closed, and
     the steps below open new ones.
2. Load the open stints: `left_seen_at IS NULL`.
3. Compare them with `meta.itemPks` (deduplicate the list first and keep the first position):
   - A pk in the list with no open stint → **insert** (`placed_seen_at = now`, `last_confirmed_at = now`, `position`).
   - A pk in both → **update** `position` and `last_confirmed_at = now`.
   - An open stint not in the list → **close** it: `left_seen_at = now`, `left_reason = 'removed'`.
4. Answer `created` | `updated` | `unchanged`. It's `unchanged` when nothing was inserted or
   closed, no position changed, and the title and cover are the same.

A rerun with the same list only touches `last_seen_at` and `last_confirmed_at`, so it's idempotent.

### 3.4 Colors
- `HIGHLIGHT_PALETTE` in `shared/`: about 10 hues that work in light and dark mode.
- `nextColor` picks the first palette color not used by the account's live sets. If every color
  is taken, it falls back to `count % length`.
- The color is stored on the row, so it never shifts when sets come and go.

### 3.5 `result` branch (the existing route, `tracking.ts:463`)
When `status === "completed" && job.kind === "highlights" && complete`:
1. Set `deleted_seen_at = now` on the account's live sets whose `instagram_id` is not in `seenHighlightIds`.
2. Close their open stints with `left_reason = 'set_deleted'`.

If `complete` is false, delete nothing, and set `result.deletionsSkipped = "incomplete"` the same
way posts does. Never delete story rows: they stand on their own.

### 3.6 UI routes
- `GET /api/social-accounts/:id/highlights` →
  `[{ id, instagramId, title, color, coverImage, firstSeenAt, lastSeenAt, deletedSeenAt, stints: [{ storyPk, postId, position, placedSeenAt, lastConfirmedAt, leftSeenAt, leftReason }] }]`.
  - It returns every stint, including closed ones and those of deleted sets. The client works out
    current membership and history from this one response.
  - Size is small (hundreds of rows per account), so there's no paging.
- `PATCH /api/instagram-highlights/:id { color }`: validate a hex color. This is the only user edit.

## 4. UI: account Stories tab (`stories-tab.tsx`)

`StoriesTab` gets `accountId` and fetches `/api/social-accounts/:id/highlights` next to the posts
it already gets. It derives:
- `liveSets`: sets where `deletedSeenAt` is null, in the account's tray order (`firstSeenAt`).
- `currentSetsByPostId`: postId → the live sets with an open stint for that story.

### 4.1 Chip bar (top of the tab, above the existing buttons)
- `All (n)` first, then one chip per live set.
- Each chip has a color dot (the set's color), the title (or "Untitled") and a count.
- It scrolls horizontally on narrow screens.
- Click a chip to filter. Click it again, or `All`, to clear.
- One set is selected at a time.
- The color dot opens a small popover with the palette swatches and a native `<input type="color">`.
  Choosing a color calls `PATCH` and invalidates the highlights query.
- Hidden when the account has no live sets.

### 4.2 Grid
- **All view:** same as today. A story with current sets gets a **segmented ring**: the card is
  wrapped in a 2px-padded container whose background is a `conic-gradient` with one equal arc per
  set color, and the inner card keeps its rounded corners. With one set, the ring is a solid
  color. A story in no live set gets no ring.
- A hover tooltip on a ringed card lists the set titles.
- **Filtered view:** shows only that set's current members, ordered by `position` (Instagram's
  order). The sort toggle reverses that order.
  - If some pks have no story row yet (their upload failed), the header says "N not downloaded yet".
- **Combine daily** still works. A day card's ring is the union of the sets of its stories.
- The ring follows the current color, so a color change shows right away.

### 4.3 Story dialog: a "Highlights" row
List every stint for that story's pk, across all sets (including deleted ones), newest first. One
line per stint:
- `● Title`, then **Placed**: "learned Oct 3, 2026". If `placedSeenAt` equals the set's
  `firstSeenAt`, it reads "already in set when first seen Oct 3, 2026" instead.
- **Left**: "learned Oct 10 · last seen in set Oct 3".
- **Set deleted**: "learned Oct 10 · last seen in set Oct 3". The title is struck through.

Leave the row out when the story has never been in a set.

### 4.4 Account page
Pass `accountId` into `<StoriesTab>` (`social-account-profile.tsx:1768`). Nothing else changes.

## 5. Edge cases
- **A set renamed or re-covered:** the row is replaced in place. Title history is out of scope.
- **A story reordered within a set:** only `position` changes. That isn't recorded as history.
- **The same pk twice in one list:** deduplicated before the comparison.
- **A pk whose story row belongs to another account** (rare): the stint is kept. It doesn't show
  on this account's grid, because the grid shows only this account's stories, but the "not
  downloaded" count must not include it. Count only pks with no row at all.
- **The account went private:** the job is skipped as `private`, same as posts. Nothing is closed.
- **An empty tray on an account with live sets, and `complete: true`:** every set is marked
  deleted. If that turns out to be a broken scan rather than a real deletion, the next sighting
  restores each set (§3.3 step 1), and the record shows a gap in history but loses nothing.
  Watch for this in the first runs. If it happens, add an `empty_tray` guard like posts'
  `empty_scan`.

## 6. Build order
1. Schema, kind plumbing and `db:push` (§1, §2).
2. Extract `storeStoryItem` (§3.1). The nightly stories run must behave exactly as before.
3. The highlights routes, `upsertHighlight` and the result branch (§3.2–3.5).
4. The read and patch routes (§3.6).
5. The Stories tab chips, ring, filter, color picker and dialog row (§4).

## 7. Verification
- `npm run check` passes.
- **First job** on @zeroturnpete (start it from the account page):
  - 7 sets are created, each with a distinct color.
  - There are 43 open stints (one pk is in two sets).
  - At most 42 story rows are stored.
- **Immediate rerun:** every pk comes back `existing`, 0 items are stored, and every upsert
  answers `unchanged`. No stints are inserted or closed; only `last_confirmed_at` moves.
- **Remove one story from a set on the test account, then rerun:** that stint closes with
  `'removed'`. The story drops out of the set's filter view and its ring loses that arc. The
  dialog shows "Left · learned …".
- **Re-add it and rerun:** a second stint opens.
- **Delete a set and rerun:** the set gets `deleted_seen_at`, all its stints close with
  `'set_deleted'`, its chip disappears, and its stories remain.
- **UI** (in the browser preview, light and dark):
  - Chips filter the grid, and the filtered view is in `position` order.
  - Rings are thin, and a story in two sets has two arcs.
  - The color picker persists after a reload.
  - The chip bar works at phone width.
