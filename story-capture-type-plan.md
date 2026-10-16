# Story capture type: plan

> **Done (2026-10-13):** the cutoff is 48 h. The backfill set 218 stories to highlight and 3,911 to daily, 9 of the daily ones being pinned stories caught live. The script was then deleted.

Every story gets a **capture type** that says how PRM first got it:

- `daily`: caught live from the story tray by the nightly prm-stories run.
- `highlight`: first stored by a highlights tracking job, which reads a highlight set on the profile.

Decisions (2026-10-13):
- Capture type records **how the story was first captured**. A story the nightly run caught live
  and that was later pinned to a highlight stays `daily`. It is never switched afterwards; highlight
  membership is already shown separately by the chips, rings and the "Highlights" row.
- New stories get the type when they're stored, and a one-time script backfills existing stories.
- It's shown in the story dialog's info (ⓘ) tooltip only. There's no filter or chip.

## 1. Schema (`shared/schema.ts`, `server/db-init.ts`)

`social_account_posts.capture_type text`, nullable. It's `'daily' | 'highlight'` on stories and
null on posts and reels.

- Next to the column: `export const STORY_CAPTURE_TYPES = ["daily", "highlight"] as const;` and
  `export type StoryCaptureType = typeof STORY_CAPTURE_TYPES[number];`, typed through
  `.$type<StoryCaptureType>()`.
- Add the column to `schemaDefinitions` in `db-init.ts` so `addColumnIfNotExists` creates it on
  boot, the same way `seen_by` and the other later post columns were added.
- No index: nothing filters on it yet.
- Add it to the `omit` list of `insertSocialAccountPostSchema`, next to `seenBy`. Only ingest writes it.

## 2. Ingest (`server/routes/stories.ts`)

`ingestStoryItem` already knows the path from `run.groupKind`. Both `tracking_job` callers
(`tracking.ts:709` scan results and `tracking.ts:935` the highlights item route) are highlight
items. Every `story_run` caller is the nightly tray. So the insert at `stories.ts:222` sets:

```ts
captureType: run.groupKind === "tracking_job" ? "highlight" : "daily",
```

A duplicate (`existing` row) is untouched, so a highlights job that sees a story the nightly run
already stored leaves it `daily`, as decided.

## 3. One-time script (`scripts/backfill-story-capture-type.ts`)

```
npx tsx scripts/backfill-story-capture-type.ts [--dry-run]
```

Same style as `scripts/backfill-story-reshares.ts` (dotenv, `db`/`pool`, prints counts, then
closes the pool). It only touches stories whose `capture_type IS NULL`, so it's safe to re-run, and
it never overwrites a type that ingest has set.

**Rule.** A story is `highlight` when both of these hold:
1. Its `instagram_pk` has **any** row in `instagram_highlight_memberships` (ever: open or closed
   stints, live or deleted sets).
2. PRM stored it **after it had already expired**: `created_at > posted_at + interval '48 hours'`.
   The nightly run reads only the live tray, so a story stored more than 48 h after posting (own stories can be read for up to 48 h) can only have
   come from a highlight.

Every other story is `daily`. That includes pinned stories the nightly run caught while they were live.

```sql
UPDATE social_account_posts sap
SET capture_type = CASE
  WHEN EXISTS (SELECT 1 FROM instagram_highlight_memberships m WHERE m.story_pk = sap.instagram_pk)
   AND sap.created_at > sap.posted_at + interval '48 hours'
  THEN 'highlight' ELSE 'daily' END
WHERE sap.post_type = 'story' AND sap.capture_type IS NULL
RETURNING capture_type;
```

`--dry-run` runs the `SELECT` form of the same CASE and prints:
- the counts per type;
- **in a set but `daily`**: pinned stories the nightly run caught live. This is the expected overlap;
- **not in a set but stored late**: should be 0. Anything here is a story stored by some other
  path, and it's listed by id for a look;
- stories with a null `instagram_pk` or `posted_at`. These fall to `daily`.

The script needs no schema step of its own: run it after the server has booted once with the new
column (§1).

**Known edge:** a story pinned and then picked up by a highlights job *before* the nightly run saw
it, and still inside 48 h, gets `daily` from the script. Ingest gets these right from now on.
No stored record tells us which run stored the row first, so the backfill can't do better.

## 4. UI: the story dialog's info tooltip (`client/src/components/stories-tab.tsx:206`)

Add a line to the existing `button-story-provenance` tooltip:

```
Scraped from @user
Captured from the daily story tray        ← daily
Captured from a highlight                  ← highlight
```

Show nothing extra when `captureType` is null. `GET` for the account's stories already returns
whole post rows, so check that the column comes through and that the client `Story` type includes it.

## 5. Build order
1. Schema + db-init column (§1). Boot the server once.
2. Ingest (§2).
3. Script: `--dry-run`, review the numbers, then run it for real (§3).
4. Tooltip (§4).

## 6. Verification
- `npm run check` passes.
- Dry run on the real DB: the "not in a set but stored late" count is 0, and the "in a set but
  daily" count is plausible against @zeroturnpete's 43 stints.
- After the real run: `SELECT count(*) FROM social_account_posts WHERE post_type='story' AND capture_type IS NULL` = 0.
  A second run updates 0 rows.
- Run a highlights job on an account with a new pinned story: the new row is `highlight`. The next
  nightly run's new rows are `daily`.
- Browser preview: the ⓘ tooltip shows the right line for one of each type.
