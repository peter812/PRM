# Voice Sessions — Implementation Plan

Live dictation from the top menu → saved voice note → AI analysis (summary, context,
linked people) → Postgres + Qdrant, readable by AI agents. Private notes are recorded
and transcribed locally but never analyzed, never vectorized, and PIN-gated to view.

## Decisions locked in

| Question | Decision |
|---|---|
| Live view while recording | Chunked live transcript (~5s cumulative re-transcribe against the existing Whisper server) |
| Raw audio retention | Kept, with a user-toggleable setting (default on) |
| Data model | New `voice_sessions` tables, mirroring the `daily_notes` shape |
| Private means | Not vectorized, not AI-read, no AI summary/links — **and** PIN-gated to view |
| People linking | LLM extracts names → vector/name match → high confidence auto-links, low confidence shows as suggested chips to accept/reject |
| Analysis timing | Background task on save, plus a manual **Re-analyze** button |
| Multiuser | `userId` FK on every voice table; all queries and vector payloads scoped |
| Privacy toggle | Immutable at save time (no public↔private transitions) |
| Entry point | Standalone Mic icon in the header (+ mobile bottom nav) |
| Editing | Transcript editable, delete, re-analyze; audit log like daily notes |
| Navigation | Voice Notes tab in Me + detail route `/voice-notes/:id` |

## What already exists (reuse, don't rebuild)

- [daily-note-modal.tsx:279](client/src/components/daily-note-modal.tsx:279) — working
  `MediaRecorder` capture with webm/ogg fallback, permission error handling, and
  unmount cleanup. The voice modal is an expansion of this, not a from-scratch build.
- [ai-vector.ts:2696](server/routes/ai-vector.ts:2696) — `POST /api/daily-notes/transcribe`
  already forwards multipart audio to an OpenAI-compatible `/v1/audio/transcriptions`
  endpoint with optional basic auth and a 120s timeout.
- [intelligence-settings.tsx:651](client/src/pages/intelligence-settings.tsx:651) —
  Whisper server URL + model settings card (`whisper_api_url`, `whisper_model`,
  `whisper_auth_required`, `whisper_username`, `whisper_password`).
- [vector-universal.ts:22](server/vector-universal.ts:22) — `UniversalEntityType` union,
  `composeTextForEntity` / `isVectorizable` / `getTitleForEntity`, and
  `syncEntityInBackground` — adding a type is a well-worn path.
- [ai-vector.ts:2915](server/routes/ai-vector.ts:2915) — `daily_notes_pin` scrypt
  verify. Voice notes reuse the same PIN, not a second one.
- [task-worker.ts:2857](server/task-worker.ts:2857) — task dispatch switch and the
  `tasks` table for background work with progress.
- [local-storage.ts:79](server/local-storage.ts:79) / [s3.ts:77](server/s3.ts:77) —
  `uploadMediaLocally` / `uploadMediaToS3` already handle non-image media.

---

## Phase 1 — Schema and migrations

**[shared/schema.ts](shared/schema.ts)** (insert after the daily-notes block, ~line 452)

```ts
export const voiceSessions = pgTable("voice_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),          // AI-generated, user-editable
  transcript: text("transcript").notNull().default(""),
  summary: text("summary").notNull().default(""),      // AI; empty for private
  context: text("context").notNull().default(""),      // AI; 1-2 lines of situational context
  isPrivate: boolean("is_private").notNull().default(false), // immutable after insert
  audioUrl: text("audio_url"),                         // null when retention is off
  audioMimeType: text("audio_mime_type"),
  durationMs: integer("duration_ms").notNull().default(0),
  analysisStatus: text("analysis_status").notNull().default("pending"),
    // 'pending' | 'running' | 'done' | 'failed' | 'skipped_private'
  analysisError: text("analysis_error"),
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
}, (t) => [
  index("voice_sessions_user_id_idx").on(t.userId),
  index("voice_sessions_created_at_idx").on(t.createdAt),
]);

export const voiceSessionParties = pgTable("voice_session_parties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  voiceSessionId: varchar("voice_session_id").notNull()
    .references(() => voiceSessions.id, { onDelete: "cascade" }),
  partyType: text("party_type").notNull(),   // 'person' | 'social_account' | 'group'
  refId: varchar("ref_id").notNull(),
  mentionText: text("mention_text").notNull().default(""), // the name as spoken
  confidence: real("confidence").notNull().default(0),
  status: text("status").notNull().default("suggested"),   // 'confirmed' | 'suggested' | 'rejected'
}, (t) => [
  index("voice_session_parties_session_id_idx").on(t.voiceSessionId),
  index("voice_session_parties_ref_id_idx").on(t.refId),
]);

export const voiceSessionAuditLogs = pgTable("voice_session_audit_logs", { /* action, timestamp, pinUsed */ });
```

Plus: `relations()` for all three, `insertVoiceSessionSchema` / `insertVoiceSessionPartySchema`
(omit `id`/`createdAt`), and `VoiceSession` / `VoiceSessionParty` / `VoiceSessionAuditLog`
`$inferSelect` types near line 1327. Add the three tables to the export/import bundle type
at line 1499 so XML backup keeps working.

**Migration**: `npm run db:push`, then commit the generated file under `migrations/`.

> Design note: `isPrivate` is deliberately written once at insert and never updated —
> no code path should `SET is_private`. This keeps "private text never reached the
> embedder" a provable property rather than a runtime invariant to defend.

---

## Phase 2 — Server: transcription, CRUD, storage

### 2a. Extract the Whisper client

New **`server/whisper.ts`**: move the body of the existing transcribe handler into
`transcribeAudio(buffer, filename, mimeType): Promise<string>` — settings lookup, basic
auth, multipart build, timeout, error mapping. Then rewrite
[ai-vector.ts:2696](server/routes/ai-vector.ts:2696) to call it (behavior-identical), and
have voice sessions call it too. One place to add streaming/model changes later.

### 2b. New route module `server/routes/voice-sessions.ts`

Registered from [routes.ts](server/routes.ts). Every handler starts with
`if (!req.isAuthenticated()) return 401` and scopes by `req.user.id`.

| Route | Behavior |
|---|---|
| `POST /api/voice-sessions/transcribe-chunk` | multipart audio → `transcribeAudio` → `{ text }`. Used for the live view. Rate-limited (existing `middleware/rate-limit.ts`), max ~25MB. |
| `POST /api/voice-sessions` | multipart: `audio` + `transcript` + `isPrivate` + `durationMs`. Stores audio if retention on, inserts row, audit `created`. If public → enqueue `analyze_voice_session` task; if private → `analysisStatus = 'skipped_private'`. Returns the row immediately. |
| `GET /api/voice-sessions` | List for the current user, newest first, with parties joined. **Private rows return metadata only** (timestamp, duration, `isPrivate: true`) — transcript/summary omitted until unlocked. |
| `GET /api/voice-sessions/:id` | Full row. If private, requires a verified-PIN flag in `req.session` (see 2c), else `403 { pinRequired: true }`. |
| `PUT /api/voice-sessions/:id` | Edit `title` / `transcript`. Clears `vectorSyncedAt`, re-syncs vector (public only), audit `edited`. Rejects any attempt to change `isPrivate`. |
| `DELETE /api/voice-sessions/:id` | Deletes the vector point via `deleteEntityVector`, deletes the stored audio blob, then the row (cascades parties + logs). |
| `POST /api/voice-sessions/:id/reanalyze` | 400 if private. Resets `analysisStatus` to `pending`, enqueues the task. |
| `POST /api/voice-sessions/:id/parties/:partyId` | `{ status: 'confirmed' \| 'rejected' }` for the accept/reject chips. Confirming re-syncs the vector so the link is searchable. |
| `GET /api/voice-sessions/:id/audio` | Streams stored audio; same PIN gate as the detail route. |

### 2c. PIN

Extract `verifyNotesPin(pin): Promise<boolean>` from
[ai-vector.ts:2915](server/routes/ai-vector.ts:2915) into a shared helper.
`POST /api/voice-sessions/unlock` verifies and sets `req.session.voiceUnlockedUntil =
Date.now() + 15*60_000`. Handlers check that window rather than taking a PIN per request.

**Edge case to handle explicitly:** if no `daily_notes_pin` is set, "Save privately" must
still work — the note is stored private and un-analyzed, and the UI prompts the user to
set a PIN. Do *not* silently leave private notes unprotected without saying so.

### 2d. Audio storage

New setting `voice_audio_retention` (`'true'`/`'false'`, default `'true'`). When on, the
uploaded blob goes through the same local-vs-S3 branch the image pipeline uses
(`uploadMediaLocally` / `uploadMediaToS3`) under a `voice/` prefix; `audioUrl` is stored.
When off, `audioUrl` stays null and the buffer is dropped after transcription.

---

## Phase 3 — AI analysis pipeline

**New `server/voice-analysis.ts`** — `analyzeVoiceSession(id)`:

1. Load the row. **Bail immediately if `isPrivate`** (defense in depth — the task should
   never be enqueued for one).
2. Ollama call using the same `buildOllamaChatContext()` + `format` JSON-schema pattern as
   [generate-events](server/routes/ai-vector.ts:2610), with a new
   `voice_summary_prompt` setting (falls back to a built-in default), constrained to:
   ```json
   { "title": "…", "summary": "…", "context": "…",
     "mentions": [{ "name": "…", "kind": "person|group|social_account", "quote": "…" }] }
   ```
3. For each mention: exact/fuzzy name lookup against `people` / `groups` /
   `socialAccounts` (scoped to `userId`), then `searchUniversal` as a fallback.
   - score ≥ 0.85 and a single candidate → `status: 'confirmed'`
   - otherwise → `status: 'suggested'` (top candidate only, shown as a chip to accept)
   - no candidate → skipped (the mention text still lives in the transcript, so vector
     search finds it regardless)
4. Write `voice_session_parties`, set `analysisStatus = 'done'`, then
   `syncEntityInBackground("voice_session", id)`.

Failures set `analysisStatus = 'failed'` + `analysisError`; the UI shows a retry.

**[server/task-worker.ts](server/task-worker.ts)** — add a `case "analyze_voice_session"`
to the dispatch switch (~line 2857) with progress steps (transcript finalize 25 →
summary 60 → people match 85 → vectorize 100).

**[server/vector-universal.ts](server/vector-universal.ts)** — add `"voice_session"` to
`UniversalEntityType` (line 22) and handle it in:
- `composeTextForEntity` — title + summary + context + transcript + confirmed party names
- `isVectorizable` — **`return !data.isPrivate && data.transcript?.trim().length > 0`**
- `getTitleForEntity` — title, falling back to `Voice note — {createdAt}`
- the entity fetch in `syncEntityInBackground`, `bulkSyncAll`, and `getUniversalStatus`
- payload gains `userId` so search can filter per user

**[server/ai-tools.ts](server/ai-tools.ts)** — any tool that reads notes directly from
Postgres (not via Qdrant) must add `eq(voiceSessions.isPrivate, false)`. Grep for every
new reference before shipping; the vector exclusion alone is not sufficient.

**[server/vector-app-knowledge.ts:200](server/vector-app-knowledge.ts:200)** — resolve
`/voice-notes` and `/voice-notes/:id` URLs so AI answers can deep-link, public only.

---

## Phase 4 — Client: the recording modal

**New `client/src/components/voice-session-modal.tsx`** — the largest piece of work.

State machine: `idle → requesting → denied → recording ⇄ paused → finalizing → saving → done`

- **Permission**: call `navigator.mediaDevices.getUserMedia({ audio: true })` on open.
  `NotAllowedError` → a dedicated "Microphone blocked" panel with per-browser re-enable
  instructions and a Retry button (not a toast that vanishes).
- **Capture**: `MediaRecorder` with `start(1000)` timeslice, mime fallback chain copied
  from [daily-note-modal.tsx:284](client/src/components/daily-note-modal.tsx:284).
- **Live transcript**: every 5s, build a Blob from **all chunks so far** and POST it to
  `/transcribe-chunk`, replacing the displayed text.
  - *Why cumulative, not incremental:* only the first webm chunk carries the container
    header, so a later chunk alone is undecodable by Whisper.
  - Guard with an in-flight ref — skip a tick if the previous request hasn't returned.
  - Back off the interval as audio grows (5s → 10s → 20s past ~3 min) so upload cost
    doesn't grow quadratically on long sessions.
  - The live text is a *preview*; on stop, one final full-audio transcription produces
    the authoritative transcript.
- **Visual**: elapsed timer, a `AnalyserNode`-driven level bar, and the live transcript in
  a scrolling auto-pinned pane with a subtle "catching up…" indicator during a tick.
- **Actions**: Pause/Resume, Cancel (discard, with confirm if >10s recorded),
  **Save**, **Save privately** (with a tooltip: "AI will never read or index this note").
- Cleanup on unmount: stop recorder, stop all tracks, close the AudioContext, abort
  in-flight chunk requests.

**[client/src/App.tsx](client/src/App.tsx:236)** — add a `Mic` header button next to
`UniversalAddButton`, `data-testid="header-button-voice-session"`, wired to
`isVoiceSessionModalOpen`. Add a matching entry in
[mobile-bottom-nav.tsx](client/src/components/mobile-bottom-nav.tsx). Register the route
`/voice-notes/:id`.

---

## Phase 5 — Client: Voice Notes tab and detail page

**[client/src/pages/me-profile.tsx](client/src/pages/me-profile.tsx:259)** — new
`TabsTrigger value="voice-notes"` (Mic icon) after `messages`, and a `TabsContent` listing
cards, newest first:
- relative + absolute timestamp, duration, AI title
- summary + context lines
- linked-party chips → `/people/:id`, `/groups/:id`, `/social-accounts/:id`; suggested
  ones render with ✓/✗ buttons
- private notes render as a locked card: timestamp + duration + a Lock badge, "Enter PIN
  to view"; no AI fields, because none exist
- `analysisStatus` states: "Analyzing…" spinner / "Analysis failed — Retry"

**New `client/src/pages/voice-note-detail.tsx`** (`/voice-notes/:id`), modeled on
[daily-note-detail.tsx](client/src/pages/daily-note-detail.tsx): full transcript in an
editable textarea with save, audio player when `audioUrl` exists, party management,
Re-analyze, Delete, and the audit log.

**[client/src/pages/intelligence-settings.tsx](client/src/pages/intelligence-settings.tsx:651)**
— extend the existing Whisper card: an audio-retention switch and the voice summary prompt
textarea, plus a note that the Whisper server also powers voice sessions.

---

## Verification

1. `npm run check` clean.
2. Dev server via the preview tooling; record a 30s note naming two known contacts.
3. Confirm: live text appears within ~6s; the saved transcript differs from (and is better
   than) the last live preview; the task row completes; summary + chips populate; the note
   comes back from super-search.
4. Save a private note: assert **no** Qdrant point exists for it (`/api/vector/...` status
   count unchanged), `analysisStatus = 'skipped_private'`, list endpoint omits its
   transcript, and detail 403s until PIN unlock.
5. Deny microphone permission and confirm the modal shows recovery instructions.
6. Long-session check: 10-minute recording — confirm the interval backoff holds and memory
   is stable.

## Risks

- **Cumulative re-transcription cost** — a 10-minute session re-uploads a growing blob
  every tick. The backoff caps this; if the Whisper box is slow, the fallback is to drop
  to waveform-only past a duration threshold.
- **Whisper not configured** — the mic button should be visible but explain and link to
  Intelligence settings rather than failing at save time.
- **Private-leak surfaces** — vector sync, `ai-tools` DB queries, XML export, app-knowledge
  URL resolution, and the list endpoint each need an explicit `isPrivate` check. This is
  the highest-value review target in the whole feature.
- **`daily_notes` has no `userId`** — voice notes will be scoped while daily notes aren't.
  Intentional per the decision above, but worth a follow-up to align them.
