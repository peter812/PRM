# Instagram highlights — PRM handoff

prm-stories can now read an account's **story highlights** as a fourth tracking
job kind, `highlights`, next to `info`, `follows` and `posts`. The service side
is built and tested (`PRM-stories/src/track.ts`, `jobHighlights`); this is what
PRM needs to build for it. Companion: `account-tracking-plan.md` (the job
machinery this plugs into) and `instagram-stories-plan.md` (the story rows
highlight items become).

## 1. What a highlight is

A highlight is a set of **saved stories**. Every item in it keeps the pk of the
story it was saved from, with the same shape as a live story item. So:

- **A highlight item is a story row.** It is stored exactly like a story from the
  nightly run: `social_account_posts`, `postType: "story"`, id
  `storyPostId(pk)`. If the nightly run already caught the story while it was
  live, the row already exists and nothing is uploaded.
- **A highlight is metadata:** an Instagram id, a title, a cover, and an
  ordered list of item pks. That goes in a new `instagram_highlights` table.
- One story can sit in several highlights (seen in testing: one pk in both
  "cooloutdoorstuff" and "videos"). It is still one story row, and each
  highlight lists it.

## 2. How a job flows

```
PRM                                   prm-stories
 │ POST /track {jobs:[{kind:"highlights",…}], highlights:{videos}}
 │ ────────────────────────────────────▶ open profile, read tray,
 │                                       open the viewer, collect every reel
 │ ◀── POST …/jobs/:id/highlights/check {pks:[all distinct item pks]}
 │ ──▶ {existing:[…]}
 │ ◀── POST …/jobs/:id/highlights/items   (once per pk NOT in existing)
 │ ◀── POST …/jobs/:id/highlights         (once per highlight: meta + maybe cover)
 │ ◀── POST …/jobs/:id/result {status, result, seenHighlightIds, complete}
```

Items always go up before the highlights that list them, so by the time a
highlight arrives, every item it names exists. The one exception is an item
that failed to upload (see §5).

## 3. Why you won't see duplicates

| Where a duplicate could come from | What stops it |
|---|---|
| A story already caught live by the nightly run | `highlights/check` answers `existing` for it, so the service never downloads or sends it. |
| The same pk in two highlights | The service keys items by pk for the whole job, so each is checked and sent at most once. |
| The same highlights job run again | Every pk comes back `existing`, so 0 items are sent. Each highlight's meta is resent, but it is a replace-in-place upsert, so it is a no-op when nothing changed. |
| A redelivery or race (the nightly run storing the pk mid-job) | The item insert keeps `onConflictDoNothing` on `storyPostId(pk)` and answers `duplicate`. |
| The cover image | It is almost always a crop of one of the highlight's own items, so the service sends `coverPk` and **no bytes**. Only a custom cover (one not from any item) comes as a file, deduped by `fileHash` like any image. |

Tested on @zeroturnpete (7 highlights, 43 entries, 42 distinct pks). The first
job sent 42 items and 7 highlights with 0 cover files. An immediate rerun
found 42 existing and sent 0 items.

## 4. Endpoint reference

All routes are job-scoped and authenticated with `jobFor(req, res)`, like the
other `/api/v1/tracking/jobs/:id/*` routes.

### `POST /api/v1/tracking/jobs/:id/highlights/check`

```json
{ "pks": ["3904514919721794501", "3737901873403796767", "…"] }
```
→ `{ "existing": ["3737901873403796767"] }`

Look these up the way `/api/v1/stories/check` does: by `storyPostId(pk)` on
`social_account_posts.id`, not by `instagramPk`. That way a story row from the
nightly run counts.

### `POST /api/v1/tracking/jobs/:id/highlights/items`

Multipart. The fields match `/api/v1/stories/runs/:runId/items`:
- `meta`: JSON, the same `StoryMeta` a stories run sends (`storyPk`, `code`,
  `username`, `userPk`, `takenAt`, `expiresAt`, `mediaType`, stickers,
  `isStaticVideo`, `scrapedFrom`, …).
- `image`: JPEG.
- `video` (optional): MP4. It is only present when `highlights.videos` is on,
  the item is a video, it is under `MAX_VIDEO_MB`, and it isn't a static image
  with audio.

→ `{ "outcome": "stored" | "duplicate", "postId": "<uuid>" }`

Pull the body of the stories item handler (`server/routes/stories.ts` around
the `runs/:runId/items` route) into a shared function and call it from both
routes. The only difference is that there is no stories run row: attribute it
to the tracking job and its account. `expiresAt` is in the past for highlight
items, so don't treat that as "expired, skip".

### `POST /api/v1/tracking/jobs/:id/highlights`

Multipart:
- `meta`: JSON (below).
- `cover` (optional): JPEG. It is only sent when `coverPk` is null.

```json
{
  "highlightId": "18042422108256753",
  "username": "zeroturnpete",
  "title": "cooloutdoorstuff",
  "coverPk": "2646874368164478209",
  "coverUrl": "https://scontent-…cdninstagram.com/…_n.jpg?stp=c0.248.640.640a_…",
  "latestReelMedia": "2025-06-14T18:22:05.000Z",
  "itemPks": ["2646874368164478209", "…22 in viewer order…"],
  "scrapedFrom": "frames.by.zero"
}
```
→ `{ "outcome": "created" | "updated" | "unchanged" }`

Upsert on `(social_account_id, instagram_id)`. Replace `title`, `cover_pk`,
`item_pks` and `latest_reel_media`, set `last_seen_at = now()`, and clear
`is_deleted`. `coverUrl` is a signed CDN link that expires within days; keep
it for debugging only and never hotlink it. Display the cover from
`storyPostId(coverPk)`'s image, or from the uploaded `cover`.

Zod:

```ts
const highlightMetaSchema = z.object({
  highlightId: z.string().regex(/^\d+$/),
  username: z.string(),
  title: z.string().nullable(),
  coverPk: z.string().nullable(),
  coverUrl: z.string().nullable(),
  latestReelMedia: z.string().datetime().nullable(),
  itemPks: z.array(z.string()),
  scrapedFrom: z.string(),
});
```

### `POST /api/v1/tracking/jobs/:id/result` (existing route, two new fields)

```json
{
  "status": "completed",
  "result": { "highlights": 7, "loaded": 7, "highlightsSent": 7, "items": 42, "existing": 0, "stored": 42, "duplicate": 0, "failed": 0 },
  "seenHighlightIds": ["18108917227945489", "…"],
  "complete": true
}
```

When `status === "completed" && job.kind === "highlights" && complete`, mark
this account's highlights whose `instagram_id` is not in `seenHighlightIds` as
`is_deleted = true`. If `complete` is false (budget ran out, a highlight
couldn't be opened, or `MAX_HIGHLIGHT_ITEMS` was hit), delete nothing. Don't
delete the story rows of a removed highlight either: they are stories and
stand on their own.

Skipped reasons are the same as the other kinds: `private`, `not_found`,
`budget`, `needs_login`. An account with no highlights completes with
`{ highlights: 0 }` and `seenHighlightIds: []`, and with `complete: true` that
marks any old ones deleted.

## 5. What to build

1. **Table `instagram_highlights`:**
   - Columns: `id uuid pk`, `social_account_id` (FK), `instagram_id text`,
     `title text null`, `cover_pk text null`, `cover_image_id` (FK to images,
     null; only for an uploaded cover), `cover_url text null`,
     `item_pks jsonb` (ordered string array), `latest_reel_media timestamptz null`,
     `first_seen_at`, `last_seen_at`, `is_deleted bool default false`.
   - Unique index on `(social_account_id, instagram_id)`.
   - Store pks, not post ids: an item that failed to upload is still listed,
     and it resolves once a later job uploads it. Resolve at read time with
     `storyPostId(pk)`.
2. **Kinds (`shared/interest-level.ts`):**
   - Add `"highlights"` to `TRACKING_KINDS`, `TRACKING_KIND_LABEL`
     (`"Highlights"`) and every row of `DEFAULT_LEVEL_CADENCES` (suggested:
     none `null`, low `90`, others `30`).
   - Add the matching `highlightsDueAt`, `highlightsCheckedAt` and
     `highlightsEveryDays` columns on social accounts.
   - Add them to the `DUE_COLUMN`, `CHECKED_COLUMN`, `OVERRIDE_COLUMN` and the
     `*_SQL_COLUMN` maps in `server/tracking.ts`, and to the settings UI that
     edits cadences.
   - `parseJobs` on the service already accepts the kind.
3. **`/track` body (`triggerTrackingRun` in `server/stories-scheduler.ts`):**
   add `highlights: { videos: boolean }`. If it's absent, the service follows
   `posts.videos`. A separate setting is optional.
4. **The routes in §4**, plus the `result` branch.
5. **UI (your call):** a Highlights row on the account page, with bubbles
   (cover + title) that open the highlight's stories in order in the existing
   story viewer.

Edge cases:
- **A highlight renamed, re-covered, or items added, removed or reordered:**
  the upsert replaces everything. Nothing to diff.
- **An item pk whose story row belongs to a different account** (a reshare
  saved to a highlight): keep the row under its first owner and still list
  it here.
- **An account gone private:** the job is skipped `private`, same as posts.
- **A job cut short:** `complete: false`. Items that did go up are stored,
  every loaded highlight's membership is still sent, and the rest comes on
  the next job (`existing` makes that cheap).

## 6. How to test

1. On the prm-stories machine, run this disk-only job (it writes to
   `runs/<stamp>-hl/`: `highlights.json` has every meta in the §4 shape, and
   `<user>/<pk>.json|.jpg|.mp4` has every item):
   ```
   npm run highlights -- zeroturnpete --videos
   ```
   Running it twice shows the dedupe: the second run logs `42 already in PRM,
   0 to send`.
2. In PRM, queue a `highlights` job for @zeroturnpete from the account page.
   Expect 7 highlights created, ≤ 42 items stored (fewer if the nightly run
   already had some) and 0 cover files.
3. Queue it again. Expect `existing` = every pk, 0 items stored, and 7
   upserts answering `unchanged`.
4. Archive a highlight on the test account and rerun. Its row should be marked
   `is_deleted`, and its stories should stay.
