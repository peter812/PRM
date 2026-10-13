# AI Chat — Person / Social Account Context Plan

Let a new AI chat start with one or more **people** and/or **social accounts** pinned to it, and add a **"Chat about account"** button to the person and social account home pages.

## Decisions (confirmed)
| Question | Decision |
|---|---|
| How the entity reaches the model | **Reference only.** Only identity (type, UUID, name/handle, platform) goes in the system prompt. The model uses its existing tools (`person_pull`, `get_social_account`, …) to fetch details. |
| When entities can be added | **Only at start.** The `+` button shows only while the chat has no messages. After the first message, the context is locked. |
| Depth | **Profile only.** The reference block names the entity. The prompt tells the model to pull the profile first, and to fetch posts, messages, and relationships only when the question needs them. |
| "Chat about account" button | **New chat, empty input.** Creates a chat with that entity pinned, opens it, and focuses the composer. |

## What exists today
- `ai_chats` (`shared/schema.ts:856`): `systemMessage`, `messages` jsonb, `agentMode`, and so on. Columns are added through the `ai_chats` block in `server/db-init.ts:712`.
- `POST /api/ai-chats` (`server/routes/ai-vector.ts:1999`) creates a chat. `PATCH /api/ai-chats/:id` updates one. `POST /api/ai-chats/:id/branch` copies one.
- `buildChatMessages()` (`server/routes/ai-vector.ts:1404`) builds the system message for every message, regenerate, and stream path. This is the **single injection point**.
- Tools are global, not agent-mode only. `activeToolNames()` in `runStreamingChatWithTools` decides the set. `person_pull` and `get_social_account` already exist in `server/ai-tools.ts`.
- The chat page `client/src/pages/ai-chat-demo.tsx` already has pending-attachment chips, a Paperclip button, and `?message=` deep-link handling (`:573`).
- `/api/mega-search` (used by `global-search.tsx`) already searches people and social profiles with `includePeople` / `includeSocialProfiles`.
- Profile headers have an actions dropdown: `person-profile.tsx:284` and `social-account-profile.tsx:714`.

---

## 1. Data (`shared/schema.ts`, `server/db-init.ts`)
- Add the column `ai_chats.context_entities JSONB NOT NULL DEFAULT '[]'` to both the `ai_chats` column-migration map and the `CREATE TABLE` at `db-init.ts:1208`.
- Add the type next to `AiChatAttachment`:
  ```ts
  export type AiChatContextEntity = {
    type: "person" | "social_account";
    id: string;          // people.id / social_accounts.id
    label: string;       // display name or @handle at time of pinning (chip text only)
    platform?: string;   // social accounts only
  };
  ```
- Limit: **10 entities** per chat. Dedupe on `type + id`.

## 2. Server (`server/routes/ai-vector.ts`)
1. **Sanitizer:** add `sanitizeContextEntities(input)`, modeled on `sanitizeAttachments`. It validates `type`, trims strings, dedupes, and caps the list.
2. **Create:** `POST /api/ai-chats` accepts `contextEntities`. The server **re-resolves each ID** with `storage.getPersonById` or the social-account lookup. It drops unknown IDs and writes the canonical `label` and `platform`, so the client can't inject arbitrary prompt text through labels.
3. **Lock:** `PATCH /api/ai-chats/:id` accepts `contextEntities` **only while `messages` is empty**. Otherwise it returns `409 "Context is locked after the first message"`.
4. **Inject:** in `buildChatMessages`, when `chat.contextEntities.length > 0`, append a block to the system message:
   ```
   This conversation is about the following PRM records. Fetch their profile with the
   tools before answering (person → person_pull, social account → get_social_account);
   only pull posts/messages/relationships if the question needs them.
   - Person: Jane Doe (uuid: …)
   - Social account: @jdoe on instagram (uuid: …)
   ```
   Wrap labels with the existing `asData()` helper so the names are treated as data. Only the stored ID and label are used, so no DB reads happen per turn.
5. **Branch:** copy `contextEntities` in `POST /api/ai-chats/:id/branch`.
6. **Clear:** `POST /api/ai-chats/:id/clear` keeps the entities. Once the messages are empty, they can be edited again, which follows from the lock rule with no extra code.
7. **Tool-availability guard:** if `person_pull` or `get_social_account` is disabled in the active tool set, the block falls back to *"tools are unavailable — tell the user to enable them"* so the model doesn't invent profile data. One `activeToolNames()` check, done inside `buildChatMessages`' caller.

## 3. Chat UI (`client/src/pages/ai-chat-demo.tsx`)
1. **`+` button** in the composer row next to the Paperclip. It shows only when `activeChat.messages.length === 0` and no stream is in flight. It opens a `Popover` + `Command` search box:
   - The query hits `/api/mega-search?q=…&includePeople=true&includeSocialProfiles=true` with everything else set to false, debounced.
   - Results are grouped as **People** and **Social accounts**, with avatar, name or @handle, and platform icon.
   - Selecting a result adds it. The popover stays open for multi-select.
   - Extract this as `client/src/components/chat-context-picker.tsx` (~100 lines) to keep the 1,348-line page from growing.
2. **Chips:** render `contextEntities` as chips above the composer, in the same style as the pending-attachment chips but with a `User` or `AtSign` icon. Clicking a chip opens `/person/:id` or `/social-accounts/:uuid`. The remove `X` shows only while the chat is unlocked.
3. **Persistence:** adding or removing an entity calls `PATCH /api/ai-chats/:id { contextEntities }` and updates the chat query cache. If no chat exists yet (the empty `/ai-chat-demo` state), call `createChatMutation` with `{ contextEntities }` first.
4. **After lock:** chips stay visible at the top of the conversation (read-only) as a reminder of what the chat is about. The `+` button is hidden.
5. **Chat list:** optional small "N pinned" badge. Skip in v1 unless it's free.

## 4. "Chat about account" buttons
- Each profile header has a button that navigates to `/ai-chat-demo?person=<id>` or `/ai-chat-demo?socialAccount=<id>`. The chat page strips the param, creates the chat with that pin through `createChatMutation`, and focuses the composer, so there's no separate hook.
- The buttons are `button-chat-about-person` in `person-profile.tsx` and `button-chat-about-account` in `social-account-profile.tsx`.

## Implementation notes (as built)
- `AiChatContextEntity` has no `platform`. Accounts are labeled `@username`.
- There's no separate tool-availability check. The prompt tells the model to say so if the tools are unavailable.
- Adding the first pin with no chat open creates the chat. Every later edit is a `PATCH`.
- Chips stay above the composer in one place: they're editable before the first message and read-only after it.

## 5. Edge cases
- **Deleted person or account after pinning:** the chip still shows the stored label. The tool returns `not_found`, and the model says so. When the chat loads, the chip greys out if the entity no longer resolves. This is a cheap check on `GET /api/ai-chats/:id`, so skip it in v1 unless it's trivial.
- **Person merge:** out of scope for v1. The old UUID behaves as deleted.
- **Vector sync / search of chats:** unchanged. Labels aren't indexed.
- **Model without tool support:** covered by the 2.7 fallback text.

## 6. Out of scope (explicitly)
- Adding entities mid-conversation.
- Preloading posts, messages, or interactions into the prompt.
- Groups, notes, or other entity types. The `type` union leaves room for them later, but nothing is built for them now.

## 7. Verification
- `npm run check` (tsc).
- Manual check in the preview:
  1. Start a new chat, pin 1 person and 2 social accounts, ask "who are these?". The tool trace shows `person_pull` and `get_social_account` calls, and the answer uses real data.
  2. Send a message. The `+` button disappears, chips become read-only, and `PATCH` with entities returns 409.
  3. The person page button opens a new chat with a chip and a focused, empty composer. Repeat for a social account.
  4. Branching the chat keeps its chips.

## Files touched
| File | Change |
|---|---|
| `shared/schema.ts` | `contextEntities` column + `AiChatContextEntity` type |
| `server/db-init.ts` | column migration + CREATE TABLE |
| `server/routes/ai-vector.ts` | sanitize/resolve, create, patch-lock, branch, `buildChatMessages` injection |
| `client/src/components/chat-context-picker.tsx` | **new** — search popover |
| `client/src/pages/ai-chat-demo.tsx` | `+` button, chips, `?person=` / `?socialAccount=` deep link |
| `client/src/pages/person-profile.tsx` | "Chat about person" button |
| `client/src/pages/social-account-profile.tsx` | "Chat about account" button |
