# Inbox notes plan

Keep a copy of the **notes** people post on Instagram: the short text bubbles,
sometimes carrying a song, shown along the top of `/direct/inbox/`. A note
lives 24 h, so each nightly stories run reads them and PRM keeps every note on
the poster's social account, with the time of every run that saw it. Spans PRM
and prm-stories.

Decisions (2026-10-26):
- Storage: one jsonb column, `social_accounts.sent_notes`. No new table.
- Inbox: the run **does** open `/direct/inbox/`. This changes the seen-by plan's
  "never open the inbox" rule, but only the list view: no thread is ever
  clicked, so nothing is marked read.
- Timing: at the **start** of the run, after the session check and before the
  warm-up and the tray. Notes get captured even when the run later hits its
  deadline or a tripwire.
- Unknown posters: **create** the social account, the way face review does.
- Dedupe: **display only**. Every sighting is stored, and the page collapses
  repeats. Nothing is merged or deleted in the data.
- Page: Social Accounts → **Notes** (`/social-accounts/notes`). It is named apart
  from the existing Daily Notes.

## Discovery findings (2026-10-26, `zeroturnpete`)

Captured by `prm-stories/scripts/explore-notes.ts`; the body is
`runs/2026-10-26T0725-notes/raw/002.json`.

- Opening the inbox from the nav link fires one `POST /api/graphql` right away
  (under 1 s). Its body is `data.response.inbox_tray_items[]`. That is
  **not** under an `xdt_get_inbox_tray_items` key: the home and archive pages
  answer under that key, with an empty list. Match the list by its shape, not
  by the key name.
- The capture had 22 items: 20 `inbox_tray_item_type: "note"` and 2
  `"ambient_data"`. Ambient items have `note_dict: null`, so they are skipped.
- One note item:
  ```
  inbox_tray_item_id: "17997471252033549"          ← the note id
  pog_info.pog_users[0]: { id, username, full_name, profile_pic_url… }   ← poster
  note_dict: {
    text: "…"                 ← "" on a song-only note (11 of 20)
    created_at: 1792989441    ← unix seconds
    author_id: "61030753548"  ← = pog_users[0].id on every note
    audience: 0, note_style: 0 | 1, is_emoji_only, custom_theme (object | null)
    note_response_info: {
      music_note_response_info: { music_info: { music_asset_info: {
        title, display_artist, audio_cluster_id, is_explicit, cover_artwork_uri, … } } } | absent
      note_pog_video_response_info: null          ← video notes exist, none in this sample
    }
  }
  ```
- 15 of the 20 notes carried a song. `note_style` was 1 on every song note and
  0 on every text-only note.
- **There is no `expires_at`.** The note dict has only `created_at`, so
  `expiresAt` was dropped from `SentNote`.
- Our own note did not show up (`zeroturnpete` had none posted). How an own note is marked is still unknown.
- All 20 notes came in that one response, with no paging. Whether a longer tray pages is unknown.
- **Still to confirm:** that `inbox_tray_item_id` stays the same from one run
  to the next. Rerun the script while the same notes are still live and
  compare the ids. Until that is confirmed, the page's collapse (same
  account, text and song) covers any id churn.
- The `media_notes` field in the tracking dumps is something else (notes left
  on posts). The collector ignores it.

## Data shape

```ts
// shared/schema.ts
sentNotes: jsonb("sent_notes").$type<SentNote[]>().notNull().default(sql`'[]'::jsonb`),

export interface SentNote {
  noteId: string;                                  // inbox_tray_item_id
  text: string;                                    // "" for a song-only note
  song: { title: string; artist: string } | null;  // music_asset_info title / display_artist
  createdAt: string;                               // ISO, from created_at
  seenAt: string[];                                // ISO, one per run that saw it, oldest first
}
```

- The column is added by `server/db-init.ts`, like `seen_by`.
- Each `noteId` appears once per account. A run that sees it again adds its
  time to `seenAt`, unless that time is already there (a retried delivery).
  Nothing else changes on a repeat.
- A note reposted with the same text gets a new id and so a new entry. Folding
  repeats together is left to the page.

## prm-stories

- `intercept.ts`: `cap.notes: Map<noteId, raw>`, filled from
  any body with an `inbox_tray_items[]` that holds `note_dict`s (found with
  `deepFind`, since the wrapper key differs by page). Each such body is kept in `raw/`.
- `normalize.ts`: `normalizeNote(raw)` returns
  `{ noteId, text, song, createdAt, user: { pk, username, fullName } }`, or
  null for an item with no `note_dict` (ambient).
- `notes.ts`: `captureNotes(page, human, cap, m, deadline)`, best effort (a
  failure is logged, not thrown):
  1. Click the nav's inbox link, falling back to `goto /direct/inbox/`, then
     dismiss the notifications prompt if it shows.
  2. Wait up to about 15 s for the tray payload.
  3. No sideways scroll: one response carried all 20 notes in discovery.
  4. Push the normalized notes to `m.notes` and set `counts.notesSeen`.
  5. Go back to the home feed (nav link) so the warm-up and tray run as before.
- `run.ts`: call it right after `onSession("ok", …)`, before the warm-up.
  The manifest is written straight after, and a tripwire hit in the inbox
  ends the run there with the notes kept.
- `manifest.ts`: `notes?: (InboxNote & { delivered?: boolean; prmOutcome?: string })[]`.
- `deliver.ts`: `deliverNotes(runDir, m)` posts each undelivered note. It runs
  from `deliver()`, so `deliverPending` retries it later. `postManifest`
  counts a run as delivered only once its notes are. A reply without an
  `outcome` counts as a failure, because a PRM without the route answers 200
  with its HTML app.
- `npx tsx scripts/explore-notes.ts` runs only the notes capture and prints
  what it read (verified 2026-10-26: 20 notes, 15 with songs).

## PRM

- `POST /api/v1/stories/runs/:runId/notes` (`server/routes/stories.ts`) is
  authorised by the run token, like `/items` and `/seen-by`. The body is one
  normalized note, plus `seenAt` = the run's start time.
  1. Find the Instagram social account by username, case-insensitive.
  2. If there is none, create it as `face-review.ts:408` does:
     `internalAccountCreationType: "inbox notes"`, `nickname` = full name,
     `accountUrl` = `https://instagram.com/<username>`.
  3. In one transaction, add the note to `sent_notes` or append `seenAt` to its entry.
  4. Answer `{ outcome: "stored" | "seen_again" | "created_account" }`. That
     answer goes into the run's manifest.
- `GET /api/inbox-notes` (`/api/notes` is already the person notes table) returns every note across accounts, flattened, newest
  `createdAt` first:
  `{ socialAccountId, username, imageUrl, ownerUuid, ownerName, ...SentNote }`.
  It reads only accounts whose `sent_notes` is not empty (`jsonb_array_length > 0`).
  At the 10k-account ceiling no index is needed.

## Notes page (`client/src/pages/notes.tsx`)

- Route `/social-accounts/notes`, plus a sidebar sub-item under Social Accounts.
- Each row shows the avatar, @username (links to the social account page), the
  owner's name (links to the person page), the note text, 🎵 title — artist,
  the created time, and the first and last seen times.
- **Collapse repeats** (on by default): rows from the same account with the
  same text and same song become one row with a "seen on N days" badge, where
  N counts the distinct days across every `seenAt` in the group. The row
  expands to show each underlying note and its sightings. Turned off, every
  note is its own row. It only changes the display.
- There is a text search (note text, song, username) and an account filter.

## Checks

- prm-stories: run `npm run check`, then one `npm run now`. Confirm
  `run.json` has `notes` and the stories pass still runs after the inbox detour.
- PRM: type check, then one delivered run. Confirm `sent_notes` fills, that a
  second run appends `seenAt` without a duplicate entry, and that an unknown
  poster gets an account.
- Page: preview it with collapse turned on and off.

## Out of scope

- Notes on the person page or the social account page.
- Replies or likes on notes, and notes left on posts (`media_notes`).
- Downloading the song audio. Only the title and artist are kept.
