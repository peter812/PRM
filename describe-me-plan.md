# Describe Me — plan

A game page that picks a random person, has you describe them out loud, turns
the recording into bullet points, and saves those bullets as a note on the
person. Goal: deepen each profile with personal detail (and give the AI more
to work with). A person can be served at most once every **90 days**.

## Where it lives

- Route `/describe-me` and sidebar entry already exist
  (`client/src/App.tsx:170`, `app-sidebar.tsx:135`); `client/src/pages/describe-me.tsx`
  is a "Coming Soon" stub to replace.
- Add a card to `client/src/pages/games.tsx` next to ELO / Guess the Sex.

## Page flow

One person on screen at a time, like Guess the Sex. State machine:

1. **loading** — `GET /api/describe-me/next`.
   - `{ person: null }` → empty state: "Everyone has been described in the
     last 90 days" (plus `nextEligibleAt` if any).
2. **ready** — person card: avatar, name, company / title, tags. No existing
   notes shown (they would bias the description). Buttons:
   - **Record** (mic) — primary.
   - **Skip** — session-only: id goes into a client-side `exclude` set and is
     sent as `?exclude=` on the next fetch. Not counted as described.
3. **recording** — same MediaRecorder flow as the daily-note dictation
   (`daily-note-modal.tsx:280-320`); button turns into **Stop**. Elapsed
   timer so you can tell it is live.
4. **transcribing** — `POST /api/daily-notes/transcribe` (existing, generic
   Whisper proxy; reused as-is).
5. **extracting** — `POST /api/describe-me/extract` with the transcript →
   bullets.
6. **review** — bullet list, each row an editable input with a remove
   button, plus "Add bullet". Below it a collapsed "Show transcript" so a
   bad bullet can be checked against what was said. Buttons:
   - **Save note** — primary.
   - **Re-record** — back to step 2 (transcript and bullets discarded).
7. **saving** → toast "Note added to *Name*" → back to step 1 for the next
   person.

Mic only (no typed fallback). On mount, `GET /api/ollama/settings`; if
`whisperApiUrl` is empty, show an inline notice linking to
Settings → Intelligence instead of the Record button. Same treatment if
`enabled` is false / no text model (the extract endpoint returns the exact
message, surfaced in a toast).

Recording logic is ~60 lines duplicated between this page and the daily-note
modal, so extract it into `client/src/hooks/use-dictation.ts`
(`{ status, start, stop, toggle }` + `onTranscript` callback, owns the
`MediaRecorder` / stream refs, cleanup on unmount, mimeType fallback,
`NotAllowedError` toast) and have `daily-note-modal.tsx` use the hook. Small,
mechanical refactor; the modal's behaviour does not change.

## Data

### `people.last_described_at TIMESTAMP NULL`
- `shared/schema.ts`: `lastDescribedAt: timestamp("last_described_at")` on
  `people`. `insertPersonSchema` picks it up automatically (nullable, no
  default needed).
- `server/db-init.ts`: add `last_described_at: "TIMESTAMP"` to
  `schemaDefinitions.people` — the existing `addColumnIfNotExists` loop
  handles the migration.
- Global per person (not per user): once anyone describes someone, they are
  off the board for 90 days for everybody.

### Note content
```
- Grew up in Duluth, moved to Minneapolis for college
- Runs marathons; did Grandma's Marathon three years running
- Always brings her dog Milo to the cabin

(describe me)
```
Bullets only, `(describe me)` trailer on its own line so the note is
recognisable in the person's notes list. Notes render as plain
`whitespace-pre-wrap` text (`person-flow-tab.tsx:214`), so no markdown needed.

## Server

All three routes in a new `server/routes/describe-me.ts` (registered like the
other route modules in `server/routes.ts`); AI prompt + parsing in
`server/describe-me-ai.ts` (mirrors `find-name-ai.ts`).

### `GET /api/describe-me/next?exclude=id,id`
New `storage.getRandomDescribablePerson(excludeIds)` — same shape as
`getRandomPeoplePair` (`storage.ts:1385`):
```
WHERE (last_described_at IS NULL OR last_described_at < now() - interval '90 days')
  AND (user_id IS NULL OR user_id <> <me>)      -- don't describe yourself
  AND id <> ALL(exclude)
  AND visibleShared(...)
ORDER BY RANDOM() LIMIT 1
```
Returns `{ person }`; when none, `{ person: null, nextEligibleAt }` where
`nextEligibleAt` = `min(last_described_at) + 90 days` over the otherwise
eligible rows (one extra query, only on the empty path).

### `POST /api/describe-me/extract`
Body `{ personId, transcript }`. Checks `ollama_enabled`,
`buildOllamaChatContext()`, model = `ollama_text_model` → `ollama_model`
(identical block to `messages.ts:281-287` — pull it into a small
`resolveTextModel()` helper in `people-groups.ts` next to
`buildOllamaChatContext` so it is not copied a third time). Calls
`extractBulletsFromTranscript({ ollama, model, personName, transcript })`
→ `{ bullets: string[] }`.

Prompt (system): you are given a spoken description of *Name*; return
`{"bullets": string[]}` — each bullet one concrete fact or trait about them,
third person, present tense, no filler, no duplicates, keep the speaker's
wording where it is specific (names, places, numbers). Drop anything that is
not about the person. `format: "json"`, non-streaming, 2-minute timeout,
`extractJsonObject` for parsing (already exported from `family-tree-ai.ts`).
Validation: array of non-empty strings, trimmed, leading "-"/"•" stripped,
capped at 30.

### `POST /api/describe-me/save`
Body `{ personId, bullets: string[] }` (zod: 1–30 non-empty strings).
1. `storage.getPersonById` → 404 if missing / not visible.
2. `storage.createNote({ personId, userId, content })` with the content
   format above.
3. `storage.updatePerson(personId, { lastDescribedAt: new Date() })`.
4. `syncEntityInBackground("note", note.id)` (same as `POST /api/notes`).
5. Return `{ note }`.

Not using `POST /api/notes` from the client because the timestamp must be
set in the same request as the note; two client calls could leave a note
without the cooldown.

## Client

`client/src/pages/describe-me.tsx`, rewritten. Uses `useQuery` for
`/api/describe-me/next` (keyed on the exclude list, `refetchOnWindowFocus:
false`), `useMutation` for extract and save, `useDictation` for the mic.
After save: invalidate `/api/people`, `/api/notes`, and refetch next. Bullet
editing is local state only.

## Files

| File | Change |
|---|---|
| `shared/schema.ts` | `people.lastDescribedAt` |
| `server/db-init.ts` | `last_described_at` in `schemaDefinitions.people` |
| `server/storage.ts` | `getRandomDescribablePerson(excludeIds)` |
| `server/describe-me-ai.ts` | new — prompt, Ollama call, bullet parsing |
| `server/routes/describe-me.ts` | new — `next`, `extract`, `save` |
| `server/routes.ts` | register the module |
| `server/routes/people-groups.ts` | export `resolveTextModel()`; `messages.ts` find-name uses it too |
| `client/src/hooks/use-dictation.ts` | new — MediaRecorder hook |
| `client/src/components/daily-note-modal.tsx` | use the hook (no behaviour change) |
| `client/src/pages/describe-me.tsx` | the page |
| `client/src/pages/games.tsx` | Describe Me card |

## Out of scope (possible follow-ups)
- Per-user cooldowns.
- Showing the person's previous "(describe me)" notes before recording.
- A dedicated model / prompt setting for bullet extraction (reuse text model).
- Weighting never-described people ahead of stale ones (pure random for now).
- Renaming `/api/daily-notes/transcribe` to something generic.

## Decisions (2026-09-14)
- Cooldown is 90 days, global per person, stored on `people.last_described_at`.
- Skip is session-only; it does not touch the timestamp.
- Note = bullets only, `(describe me)` trailer at the bottom.
- Mic only; no typed transcript fallback. Bullets are editable at the review step.
- Your own "Me" person is never offered (same rule as ELO).
