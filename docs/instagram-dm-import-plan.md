# Implementation Plan: Instagram DM Import + Messages UI

Imports Meta/Instagram data-export message threads (`message_N.json` + `photos/` + `videos/` + `audio/`) into PRM's existing `conversations`/`messages` tables, adds video/audio media support end-to-end, and builds an Instagram-style two-column messages UI.

Reference fixture: `Downloads\instagram-zeroturnpete-2026-06-29-I5qDTVQw\your_instagram_activity\messages\inbox\laylabug_587235216244212\`
(1,068 messages, 41 photos, 7 videos, 9 audio clips — mostly expired CDN URLs, 24 calls, 158 shares, reactions, mojibake text).

---

## Phase 1 — Media storage: `uploadMediaLocally` + `/api/media` route ✅ DONE

**Goal:** PRM can store and stream non-image media (mp4 video, m4a/mp4 audio) with seek support.

### 1.1 `server/local-storage.ts`
Add alongside the existing image functions (same `uploads/` dir, nanoid filenames):

```ts
const SAFE_MEDIA_EXTENSIONS = new Set(["mp4", "m4a", "mp3", "webm", "mov", "ogg", "wav"]);
const SAFE_MEDIA_MIMETYPES = new Set([
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-m4a",
]);

export async function uploadMediaLocally(buffer, originalFilename, mimeType): Promise<string>
  // validates against media whitelists, writes uploads/<nanoid>.<ext>, returns "/api/media/<file>"
export async function deleteMediaLocally(mediaUrl: string): Promise<void>
export function getLocalMediaPath(fileName: string): string | null   // path.basename guard, same as getLocalImagePath
export function isLocalMediaUrl(url: string): boolean                // startsWith("/api/media/")
```

### 1.2 Serving route — `server/routes/auth-setup.ts`
Next to `GET /api/images/:filename` (auth-setup.ts:100):

```ts
app.get("/api/media/:filename", (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json(...);
  const filePath = getLocalMediaPath(req.params.filename);
  if (!filePath) return res.status(404).json(...);
  res.sendFile(filePath);   // Express `send` handles Range/206 + Accept-Ranges natively
});
```

Note: `res.sendFile` already implements HTTP Range requests (needed for `<video>` seeking) — no manual byte-range code required. Content-Type is inferred from extension by `send`.

### 1.3 S3 twin — `server/s3.ts`
`uploadMediaToS3(buffer, originalFilename, mimeType)` mirroring `uploadImageToS3` but with the media whitelists. The import task picks local vs S3 via `storage.getImageStorageMode(userId)`, same as `/api/prm-face/img/add-interactive` (ai-vector.ts:383-401).

### 1.4 Verification (no test framework in repo — use a script)
`scripts/test-media-storage.ts` (run with `npx tsx`): write a small mp4 buffer via `uploadMediaLocally`, assert file exists and URL shape; reject a `.exe`/`application/octet-stream`. Manual: `curl -H "Range: bytes=0-99" http://localhost:<port>/api/media/<file>` → expect `206` + `Content-Range`.

**Done when:** an mp4 uploaded through the function plays and seeks in a browser `<video>` tag.

---

## Phase 2 — Parser module: `server/instagram-dm-import.ts` ✅ DONE

**Goal:** pure, side-effect-free parsing of an export thread folder into a normalized shape. No DB, no fs (caller passes file contents) — trivially unit-testable.

### 2.1 Types

```ts
export interface ParsedThread {
  threadId: string;            // "587235216244212" from folder name
  username: string;            // "laylabug" from folder name
  title: string | null;        // decoded JSON `title`
  participants: string[];      // decoded display names
  ownerName: string | null;    // participant matching the export owner, if caller provides it
  messages: ParsedMessage[];   // ascending by sentAt
}

export interface ParsedMessage {
  externalId: string;          // "<threadId>:<timestamp_ms>:<senderSlug>[:n]" (n = same-ms collision index)
  senderName: string;          // decoded
  sentAt: Date;                // from timestamp_ms
  content: string | null;      // decoded; null for media-only
  media: ParsedMedia[];        // photos + videos + audio_files, normalized
  share?: { link: string; text?: string };
  reactions: { actor: string; emoji: string }[];
  callDurationSec?: number;    // present for call entries
  isSystemNoise: boolean;      // "Liked a message" / "Reacted ... to your message"
}

export interface ParsedMedia {
  kind: "photo" | "video" | "audio";
  uri: string;                 // relative path inside export, or absolute https:// (expired CDN)
  isRemote: boolean;           // true for https:// URIs → unrecoverable, don't download
  creationTimestamp?: number;
}
```

### 2.2 Functions

```ts
export function decodeMetaString(s: string): string
  // Buffer.from(s, "latin1").toString("utf8") — fixes Meta's mojibake ("ð" → 🐞)
export function parseThreadFolderName(folder: string): { username: string; threadId: string }
  // "laylabug_587235216244212" → { username: "laylabug", threadId: "587235216244212" }
export function parseInstagramThread(
  files: { name: string; json: unknown }[],   // all message_N.json of one thread, any order
  folderName: string,
): ParsedThread
```

`parseInstagramThread` responsibilities: merge files, sort ascending by `timestamp_ms`, decode all strings, classify media (relative vs remote URI), detect noise messages, synthesize call content is NOT done here (presentation concern), generate collision-safe `externalId`s.

### 2.3 Tests
- `test/fixtures/instagram-thread/` — a trimmed (~30-message) fixture copied from the real laylabug file covering: plain text, emoji mojibake, photo (with + without extension), video, remote audio, local audio, share, reactions, call_duration, "Liked a message".
- `scripts/test-instagram-parser.ts` (tsx): asserts count, ordering, decoded emoji, externalId uniqueness, media classification. Also run once against the full real file (path via env var, skipped if absent) asserting 1,068 in → no throw, all externalIds unique.

**Done when:** parser round-trips the real file with zero throws and stable output.

---

## Phase 3 — Task handler `processImportInstagramMessages` + route + dedup ✅ DONE

**Goal:** upload a ZIP of a thread folder → background task imports conversation, messages, and media, idempotently.

### 3.1 Dependency
Add `adm-zip` (simple, sync, fine for task-worker context) for extraction.

### 3.2 Route — `server/routes/social-media.ts`
Follow the `POST /api/tasks/import-xml` pattern (social-media.ts:1470):

```
POST /api/tasks/import-instagram-messages
  multipart: zip (multer diskStorage → temp dir, limit ~2 GB; do NOT use memoryStorage)
  body: socialAccountId? (preselected account), options: { skipNoise?: boolean, importMedia?: boolean }
  → creates task { type: "import_instagram_messages", payload: { userId, zipPath, socialAccountId, options } }
  → triggerTaskWorker(); returns { taskId }
```

### 3.3 Task handler — `server/task-worker.ts`
New case `"import_instagram_messages"` beside `import_instagram` (task-worker.ts:2419). `processImportInstagramMessages(taskId, payload)`:

1. **Extract** zip to a temp dir; locate thread folder(s) — support both a single thread folder zip and a zip containing `your_instagram_activity/messages/inbox/*` (import every thread found, or just the matching one if `socialAccountId` given — start with single-thread; multi-thread is a loop).
2. **Parse** via Phase 2 module (read `message_*.json`, pass to `parseInstagramThread`).
3. **Resolve social account:** by username from folder name against Instagram-type accounts (pattern from `processImportInstagram`, task-worker.ts:1715-1719); create if missing (`internalAccountCreationType: "dm import"`).
4. **Resolve conversation:** look up existing conversation where `metadata->>'igThreadId' = threadId` (new storage helper `getConversationByIgThreadId`). Create if absent: `channelType: "instagram"`, `title`, `socialAccountId`, `metadata: { igThreadId, threadPath }`, `importUuid` (one uuid per import run), `importDate`. Add `conversationParticipants`: owner (personId null / self) + the social account.
5. **Dedup:** new storage helper `getMessageExternalIds(conversationId): Promise<Set<string>>`; skip any parsed message whose `externalId` is present.
6. **Insert messages** ascending, batches of 100; per batch: `isTaskCancelled(taskId)` check + progress update on the task record. Mapping:
   - sender = owner → `senderPersonId: null` (self convention, message-conversation.tsx:167); other → `senderSocialAccountId`
   - `content` decoded; call messages get `content: "📞 Call (Xm Ys)"` + `metadata.callDurationSec`
   - `metadata: { reactions, share }` when present
   - noise messages skipped when `options.skipNoise`
   - `messageRecipients` row for the other party
7. **Media** (when `options.importMedia`, default true):
   - **photos:** read file, MIME-sniff magic bytes for extensionless files (JPEG `FF D8 FF`, PNG, WEBP, HEIC), SHA-256 hash; skip upload if a `photos` row with same `fileHash` exists (dedup on re-import) and reuse its id. Otherwise `uploadImageLocally`/`uploadImageToS3` + `storage.insertPhoto({ location, prmLocation: "message:<messageId>", fileHash, ogMetadata: { source: "instagram-export", originalUri } })`. Photo id → `messages.imageUuids`.
   - **videos/local audio:** `uploadMediaLocally`/`uploadMediaToS3` → append to `messages.attachments`: `{ type: "video"|"audio", url, originalUri, mimeType, sizeBytes, creationTimestamp }`.
   - **remote (expired CDN) audio:** no download attempt; `{ type: "audio", unavailable: true, reason: "expired-cdn-url", originalUri }`.
   - **missing file on disk:** insert message, attachment marked `unavailable: true, reason: "file-missing"`.
8. **Finalize:** set `conversations.lastMessageAt` to max sentAt, delete temp dir (also in a `finally`), return JSON summary `{ conversationId, inserted, skippedDuplicates, skippedNoise, photosImported, videosImported, audioImported, mediaUnavailable }`.

### 3.4 Storage additions — `server/storage.ts` (+ interface)
- `getConversationByIgThreadId(threadId: string)`
- `getMessageExternalIds(conversationId: string): Promise<Set<string>>`
- `updateMessage(id, { imageUuids, attachments })` if not already present (needed because photo `prmLocation` wants the messageId — insert message first, then patch media refs; or upload media first and create message with refs, using a placeholder prmLocation of `message:pending` → simpler: upload media first, create message with `imageUuids`/`attachments`, then patch the photos rows' `prmLocation`. Choose: **create message first, then upload media, then `updateMessage`** — one extra update, no placeholder states).

### 3.5 Verification
Run the real laylabug zip end-to-end: expect 1,068 minus noise inserted, 41 photos, 7 videos, 1 local audio, 8 unavailable audio, 24 call messages. Re-run same zip → 0 inserted (all dupes). Task detail page shows progress/summary.

---

## Phase 4 — Client rendering: video / audio / reactions / shares ✅ DONE

**Goal:** `client/src/pages/message-conversation.tsx` (and later the split view, Phase 7) renders everything the import produces.

Extract a shared `client/src/components/message-bubble.tsx` from the current inline rendering (message-conversation.tsx:~330-360) so Phase 7 reuses it. It renders:

- **Images:** existing `imageUuids` grid (unchanged).
- **Video:** `attachments.type === "video"` → `<video controls preload="metadata" className="max-w-xs rounded-lg" src={att.url} />`
- **Audio:** `<audio controls src={att.url} />`
- **Unavailable media:** muted chip — `🎤 Voice message (no longer available)` / `📎 Attachment missing`.
- **Share:** `metadata.share.link` → compact link card (Instagram icon, hostname, external-link icon, `target="_blank"`).
- **Reactions:** `metadata.reactions` → small overlapping emoji badge pinned to the bubble's bottom corner (Instagram style), tooltip shows actor names.
- **Call:** `metadata.callDurationSec` → centered pill chip (`Phone` icon + duration) instead of a bubble.

Type the shapes in `shared/schema.ts`: export `MessageAttachment` and `MessageMetadata` interfaces so server import + client rendering share one contract.

**Done when:** the imported laylabug conversation scrolls end-to-end with playable video, playable local audio, share cards, reaction badges, and call chips.

---

## Phase 5 — Import UI on the Messages page ✅ DONE

**Goal:** user can run the import without curl.

- New `client/src/components/import-instagram-dm-dialog.tsx`:
  - Step 1: file drop/picker for the ZIP (explain what to zip: the thread folder from the Meta export).
  - Step 2: options — "Skip 'Liked a message' noise" (default on), "Import media" (default on).
  - Step 3: optional social-account preselect (combobox of Instagram accounts; blank = auto-match by folder name).
  - Submit → `POST /api/tasks/import-instagram-messages` (FormData) → toast with link to `/settings/tasks/:id` (existing task-detail page), close.
- `client/src/pages/messages-list.tsx`: "Import" button (Upload icon) next to the existing "New" button opening the dialog.
- Conversation list auto-refresh: invalidate `/api/conversations/paginated` when the user returns; live progress remains on the task page (existing SSE).

---

## Phase 6 — Messages on the Instagram account page ✅ DONE

**Goal:** the existing Messages tab on `client/src/pages/social-account-profile.tsx` (tab at line 981, backed by `client/src/components/messages-tab.tsx`) becomes useful for DM archives.

- **Enhance `MessagesTab`:**
  - Add an "Import Instagram DMs" button (renders the Phase 5 dialog with `socialAccountId` prefilled) shown when the profile's account type is Instagram.
  - Conversation cards gain a last-message preview + count. Backing change: extend `storage.getConversationsPaginated` to include `lastMessagePreview` (latest message content truncated, or "📷 Photo"/"🎥 Video" when media-only) and `messageCount` via a lateral/subquery — one query, no N+1.
- Clicking a conversation opens the Phase 7 split view (on the Messages page route `/messages?conversation=<id>`), or — if only one conversation exists for the account (the common DM case) — the tab embeds the thread directly using the Phase 7 right-column component.

---

## Phase 7 — Instagram-style split-pane Messages page ✅ DONE

**Goal:** `/messages` becomes a two-column, Instagram-DM-style experience on desktop (stacked navigation on mobile).

### 7.1 Layout — rework `client/src/pages/messages-list.tsx` (desktop ≥ `md:`)

```
┌────────────────────┬──────────────────────────────────┐
│ Conversations      │  Thread header (avatar, name,    │
│  [search] [+][⬆]   │  channel badge, ⋯ menu)          │
│ ┌────────────────┐ │──────────────────────────────────│
│ │ ◉ laylabug     │ │      …older messages (infinite   │
│ │   You: Yeah ·2d│ │       up-scroll pagination)      │
│ ├────────────────┤ │   ┌─────────────┐                │
│ │ ◉ other convo  │ │   │ their bubble│                │
│ │   preview · 5d │ │   └─────────────┘                │
│ └────────────────┘ │            ┌──────────────┐      │
│  channel filter    │            │ my bubble  ❤️│      │
│  tabs (All/IG/…)   │            └──────────────┘      │
│                    │──────────────────────────────────│
│                    │  [＋media] [message input] [send] │
└────────────────────┴──────────────────────────────────┘
```

### 7.2 Components
- `client/src/components/conversation-list-pane.tsx` — search box, channel filter tabs (reuse `CHANNEL_FILTER_TABS`), avatar rows (participant social-account/person image via existing image-link helpers), preview line ("You: " prefix when last sender is self), relative time, active-row highlight, infinite scroll (existing offset pagination).
- `client/src/components/conversation-thread-pane.tsx` — extracted from `message-conversation.tsx`:
  - messages ascending, grouped: consecutive same-sender bubbles tightened; timestamp separators when gap > 1 h (Instagram behavior)
  - own messages right-aligned (primary/blue bubble), others left-aligned (muted bubble) with small avatar on first bubble of a group
  - `MessageBubble` from Phase 4 for content
  - **up-scroll pagination:** load newest page first (requires `getMessagesByConversation` to support `order=desc` + reverse client-side), prepend older pages on scroll-top, preserve scroll position
  - composer (existing send + image upload flow) pinned bottom
- Selection state via query param (`/messages?c=<id>`) so deep links work; `/messages/:id` route redirects into the split view on desktop and renders the existing full-page `message-conversation.tsx` on mobile.

### 7.3 Server tweak
`GET /api/conversations/:id/messages` gains `order=asc|desc` (default asc, keeps current callers working); desc + limit gives "newest page first".

### 7.4 Mobile
`< md:` shows list pane only; tapping a conversation navigates to the existing `/messages/:id` page (unchanged behavior). No new mobile work beyond hiding panes.

---

## Build order & dependencies

```
Phase 1 (media storage)  ──┐
Phase 2 (parser)         ──┼─→ Phase 3 (task import) ─→ Phase 5 (import dialog)
                           │
Phase 4 (MessageBubble) ───┴─→ Phase 7 (split view) ─→ Phase 6 (account tab embed)
```

Phases 1+2 are independent — do first, each with its verification script. Phase 4 can proceed in parallel with 3. Phase 6 lands last since it reuses both the import dialog (5) and thread pane (7).

## Risks / notes
- **Zip size:** exports with video can exceed memory — multer must use disk storage for this route (the global `upload` in social-media.ts is memoryStorage; create a route-local disk-storage multer).
- **`attachments`/`metadata` are untyped jsonb** — the shared TS interfaces in schema.ts are the only contract; keep server writer and client reader in one PR per phase to avoid drift.
- **Same-ms message collisions** are real in the fixture (rapid-fire likes) — externalId suffix indexing is required, not theoretical.
- **HEIC photos** may appear in newer exports — image whitelist already covers heic/heif; browsers won't render them; acceptable for now (shows broken image, note in follow-ups).
- **Group threads** parse fine (participants array), sender→account matching is name-based and may leave `senderSocialAccountId` null; store raw `senderName` in message `metadata.senderName` as a fallback display value (cheap insurance, do it in Phase 3).
