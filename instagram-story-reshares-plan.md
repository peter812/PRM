# Instagram story reshares

Goal: a story that reshares someone else's **story** is detected automatically, shown in PRM, and
counted toward the connection score between the poster and the reshared author. Reshared
posts and reels already work (`story_feed_media`).

## Findings

- `PRM-stories/src/normalize.ts` `reshareOf()` only recognised a story reshare when Instagram sent
  `reshared_story_media_author`. Instagram sends it for some reshares and not others, in the same run.
  Of 1,839 saved story payloads, 55 carried it; replaying with the fallback below finds 193.
- Every reshare has a full-size `ig_mention` sticker dead centre (`story_bloks_stickers`: x=y=0.5,
  width=height=0.5, rotation 0): the card with the author's avatar and name. Sampled detections that
  lacked the author field were all real reshares.
- The payload gives no media id or pk for the original story, only its author. So PRM shows the
  author, not a link to a specific story or PRM's copy of it.
- Connection scoring (`server/connection-strength.ts` `mentionedIn()`) already scores everyone in a
  story's `mentionedAccounts` as a `story_mention` from the poster. Putting the reshared author
  in `mentions` is therefore the whole scoring change.

## Decisions

- Show the owner only; no link to the original story in PRM.
- The reshared author is treated as a mentioned person, so the poster → author connection score updates.
- Sticker-only detections look identical to confirmed ones.
- Existing stories are backfilled.

## Changes

### PRM-stories
- `src/normalize.ts`: new `resharedStoryOwner()` (author field, else the centred mention sticker);
  `reshareOf()` uses it; `normalize()` adds the owner to `mentions`.
- `scripts/export-reshares.ts` (`npm run export-reshares`): replays every `runs/*/raw` payload through
  `normalize()` and writes `reshares.json` (storyPk → resharedPost + mentions).

### PRM
- No server or client change: the stories route already stores `resharedPost` in metadata and
  `mentions` in `mentionedAccounts`, the Stories tab already renders "Reshared story", and
  `mentionedIn()` already scores it.
- `scripts/backfill-story-reshares.ts`: applies `reshares.json` to stories already stored (sets
  `metadata.resharedPost`, adds the author to `mentionedAccounts`). Idempotent; `--dry-run` supported.

## Rollout

1. In PRM-stories: `npm run export-reshares`.
2. In PRM: `npx tsx scripts/backfill-story-reshares.ts <path>/reshares.json --dry-run`, then without `--dry-run`.
3. Connection scores pick the new mentions up on their next calculation.

## Known gaps

- Stories not in `runs/raw` (older runs, or where raw capture was off) can't be backfilled.
- **Separate finding:** `normalize()` reads mentions only from `reel_mentions`. Many stories carry
  `@mentions` only as `story_bloks_stickers` `ig_mention` entries (for example `mentions: []` with
  three mention stickers). Those mentions are not captured at all. Same fix pattern, but out of
  scope here.
- A large centred mention that is not a reshare would be a false positive. None found in samples.
