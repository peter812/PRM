# Story "Seen by" plan

Keep who viewed, liked and replied to **the logged-in account's own stories**.
Instagram drops the list 48 h after posting, so we keep a copy. Spans PRM and
prm-stories.

Decisions (2026-10-12):
- Storage: one jsonb column on the story's `social_account_posts` row. No new table.
- DMs: never open the inbox. Replies show in the story's viewer sheet.
- Timing: the user first asked for the nightly run **plus** a near-expiry pass.
  Discovery made the second pass unnecessary (see below), so it was not built.

## Discovery findings (2026-10-12, `zeroturnpete`)

- The list comes from `GET /api/v1/media/<storyPk>/list_reel_media_viewer/`,
  paged with `next_max_id` (null on the last page). The body has
  `total_viewer_count` and `viewers[]` = `{ user, has_liked, reply_text,
  is_spam_viewer }`. `user` has pk, username, full_name and an expiring
  `profile_pic_url`, which is not kept.
- A like is `has_liked`. A reply (text, or presumably a quick-reaction emoji) is
  `reply_text`. A top-level `reactions[]` was empty in the sample. The raw
  bodies stay in `runs/<date>/raw/` so it can be parsed later if it turns up.
- The web **story archive** (`/archive/stories/`) still shows "Seen by N" and the
  full sheet for 48 h. A story that expired 21 h earlier listed all 124 viewers.
  Tiles are newest first. The archive viewer steps to older stories with
  ArrowRight, and older stories have no "Seen by" button. The archive url id is
  **not** the story pk: the pk is only in the sheet's request.

**Why no near-expiry pass:** views only happen while the story is live (24 h),
and the archive keeps the list until 48 h. So the nightly run reads the archive,
and every story gets a read at 24–48 h old, when the list is final. A skipped
night (the scheduler's random day off) leaves only the earlier, partial read.

## prm-stories

- `intercept.ts`: `cap.seenBy: Map<storyPk, { total, complete, viewers: Map<userPk, raw> }>`,
  filled from `list_reel_media_viewer` pages, with each body dumped to `raw/`.
- `normalize.ts`: `normalizeSeenBy(raw viewers) → SeenByViewer[]`. Spam viewers are dropped.
- `seen-by.ts`: `captureSeenBy(page, human, cap, m, deadline)` does the following:
  1. Open the archive and click the newest tile.
  2. For each story, click "Seen by" and take the pk from the request that arrives.
  3. Wheel-scroll the sheet until the last page arrives, or nothing new arrives for three scrolls.
  4. Push `{ storyPk, viewerCount, viewers }` to `m.seenBy`.
  5. Close the sheet and press ArrowRight.
  6. Stop at the first story without the button, the deadline, a tripwire, or 30 stories.
- `run.ts`: called once after the tray passes (after `queue.idle()`).
- `deliver.ts`: `deliverSeenBy` posts each undelivered entry. It runs from `deliver()`,
  so `deliverPending` sends it at the end of the run and retries it later. A run
  only counts as delivered once its `seenBy` entries are.

## PRM

- `shared/schema.ts`: `socialAccountPosts.seenBy` (`seen_by jsonb`) with the
  `StorySeenBy` / `SeenByViewer` types. The column is added by `server/db-init.ts`.
  ```ts
  StorySeenBy  { capturedAt: string; viewerCount: number; viewers: SeenByViewer[] }
  SeenByViewer { pk: string; username: string; fullName: string | null; liked: boolean; reply: string | null }
  ```
- `POST /api/v1/stories/runs/:runId/seen-by` (`server/routes/stories.ts`) is
  authorised by the run token, like `/items`.
  - No story row: `202 { outcome: "no_story" }`.
  - Otherwise it merges by viewer pk. A newer capture updates a viewer and keeps
    their older reply if the new one is null. Viewers only an older capture
    listed are kept.
  - Returns `{ outcome: "stored", viewers }`.
- `StoryDialog` (`client/src/components/stories-tab.tsx`): a "Seen by N" section
  appears only when there are viewers. It shows the capture time, plus "x listed"
  when the list is short. Liked or replied viewers come first; each has an
  Instagram link, full name, ❤️ and the reply text. The posts endpoint already
  returns every column, so retrieval needed no change.

## Verification

- `npm run check` in prm-stories and `tsc` in PRM both pass.
- `npx tsx scripts/explore-seen-by.ts` (capture only, nothing delivered), 2026-10-12:
  the newest archived story gave 124/124 viewers over 4 pages, with 3 likes. It
  stopped at story 2 (1 week old, no "Seen by").
- Still to check live:
  - the next nightly run's `log.txt` (`seen-by:` lines) and `run.json` `seenBy`;
  - then the section in the story's dialog in PRM.

## Out of scope

- Reading the DM inbox.
- Viewer data for other accounts' stories (Instagram doesn't expose it).
- Linking viewers to PRM social accounts (they link to Instagram for now).
- Feeding views into connection strength.
