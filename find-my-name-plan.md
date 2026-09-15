# Find My Name — plan

Attach a person to an unlinked phone number in a conversation, using the first
messages ever exchanged (where people introduce themselves) plus an AI guess,
without scrolling to the top of the thread.

## Where it lives

- **Trigger**: a "Find my name" (`UserSearch` icon) button in the
  `ConversationThreadPane` header, next to the media button. Shown only when
  `conversation.channelType === "phone"` and at least one address in
  `metadata.addresses` has no linked person.
  - *Unlinked* = address not in the cleaned `phone`/`additionalPhones` of any
    `participants[].person`. Computed client-side from data the conversation
    endpoint already returns; no new API for the badge.
  - One unlinked number → button opens the modal on it directly.
  - Several → the modal opens with a `Select` of the unlinked numbers
    (formatted for display) at the top.
- **Modal**: new `client/src/components/find-my-name-dialog.tsx`, built on the
  same `Dialog` + people-search pattern as `link-person-dialog.tsx`.

## Modal flow

1. **Number picker** (only when >1 unlinked number).
2. **Evidence** — the earliest N messages of the thread (N = 30, oldest
   first), rendered compactly (sender label + text + date). For group threads,
   messages from other linked people are still shown for context but the
   selected number's messages are highlighted. If the backup carried a
   `contactName`, show it as a banner ("Phone contact name: Mom") — it is the
   strongest hint and the AI receives it too.
3. **AI guess** — a "Guess name" button (not automatic: the first messages
   often make it obvious and Ollama calls are slow). Shows: guessed first/last
   name, confidence (high/medium/low), a one-line reason, and the message
   snippets it relied on. Re-clicking re-runs it; changing the number clears
   it. Handles: AI disabled / no model configured / timeout with an inline
   message — the rest of the modal works without AI.
4. **Matches in PRM** — a search box (same as LinkPersonDialog) over
   `/api/people`, pre-filled with the guessed name once the AI returns, so
   candidates appear without a server-side matcher. Each row: avatar + name +
   existing phone(s).
5. **Call to action**
   - **Link to `<person>`** — primary when a match is selected.
   - **Create new person** — opens the existing `PersonDialog` with a new
     `initialValues` prop (`{ firstName, lastName, phone }` from the guess and
     the selected number). Its `onPersonCreated` callback then calls
     `link-phone` with the new person's id — the person already carries the
     phone, so the link step only has to add participants and backfill.

After success: toast, close, invalidate `/api/conversations/:id`,
`/api/conversations/:id/messages`, `/api/conversations/paginated`, `/api/people`.

## Server

### `GET /api/conversations/:id/messages/first?address=<e164>&limit=30`
Oldest-first page for the evidence panel. Same shape as the existing messages
endpoint (`{ messages, total }`), via a new `storage.getFirstMessagesByConversation`
that reuses the enrichment in `getMessagesByConversation` but orders ascending.
(Alternative: add `order=asc` to the existing endpoint — one route, one param.
Prefer this if the enrichment code is easy to share.)

### `POST /api/conversations/:id/find-name`
Body: `{ address }`. Steps:
1. Load conversation, verify `address ∈ metadata.addresses`.
2. Load the first 30 messages (ascending). Label each line as
   `[me]`, `[<address>]`, or `[<other linked person name>]`.
3. Prompt Ollama (`buildOllamaChatContext()`, model = `ollama_text_model`
   → `ollama_model` fallback, same resolution as family-tree AI, single
   non-streaming `/api/chat` call, no tools, JSON-only response):
   ```
   { "firstName": string|null, "lastName": string|null,
     "confidence": "high"|"medium"|"low", "reason": string,
     "evidenceMessageIds": string[] }
   ```
   Include `metadata.contactName` in the prompt when present.
4. Return `{ guess }`. Candidate matching happens in the modal's people
   search (the client already has `/api/people` loaded for it).

Put the prompt + parsing in a new `server/find-name-ai.ts` (mirrors
`family-tree-ai.ts`); the route stays thin. Reuse `extractJsonObject` from
family-tree-ai (export it) rather than writing another one.

### `POST /api/conversations/:id/link-phone`
Body: `{ address, personId }`. Does everything the import would have done had
the number matched:
1. Add `address` to the person: `phone` if empty, else append to
   `additionalPhones` (skip if already present).
2. For **every** phone conversation whose `metadata.addresses` contains the
   address (not just the one the modal was opened from):
   - `addConversationParticipant` (role `participant`) if missing.
   - Backfill `messages.senderPersonId = personId` for messages whose
     `metadata.senderName` equals `contactName` (1:1 thread) or
     `formatPhoneNumberForDisplay(address)` — i.e. the labels the importer
     wrote. Clear `metadata.senderName` on those rows so `isSelfMessage` and
     the bubbles treat them like any linked sender.
   - Backfill `message_recipients` for owner messages (add `personId`) so
     "conversations by person" stays complete.
   - If every address is now linked, set `title = null` so the header names
     the participants like fully-matched threads do.
4. Return `{ person, conversationsUpdated, messagesUpdated }`.
5. `syncEntityInBackground("message", …)` is skipped for backfills — nothing
   in the vector text changes. (Verify before deciding.)

### Importer hardening (small, same PR)
`processImportSms` writes `metadata.senderAddress` alongside `senderName` on
every non-owner message. Backfill then matches on `senderAddress` first and
falls back to the `senderName` heuristic for messages imported before this
change. Also add `senderAddress?: string` to `MessageMetadata` in
`shared/schema.ts`.

## Files

| File | Change |
|---|---|
| `client/src/components/find-my-name-dialog.tsx` | new modal |
| `client/src/components/conversation-thread-pane.tsx` | header button + unlinked-address derivation |
| `client/src/components/person-dialog.tsx` | `initialValues` prop spread into the create-mode `form.reset` |
| `server/find-name-ai.ts` | prompt, Ollama call, JSON parse |
| `server/routes/messages.ts` | 3 routes above |
| `server/storage.ts` | `getFirstMessagesByConversation`, `getPhoneConversationsByAddress`, `linkPhoneToPerson` (or inline in route if small) |
| `server/task-worker.ts` | write `senderAddress` |
| `shared/schema.ts` | `MessageMetadata.senderAddress` |
| `server/family-tree-ai.ts` | export `extractJsonObject` |

## Out of scope (possible follow-ups)
- Running this in bulk from the import result's `unmatchedNumbers` list.
- Instagram threads — unlinked senders there are social accounts and already
  have `LinkPersonDialog`.
- A dedicated `ollama_find_name_model` setting (reuse the text model for now).

## Decisions (2026-09-14)
- Linking applies to every phone conversation containing the number.
- New person goes through the full `PersonDialog` (with prefill), not an inline form.
- AI evidence = first 30 messages + backup `contactName`; one Ollama call.
- AI runs on click ("Guess name"), not on open.
