# Multiple AI Providers (Ollama + OpenAI-compatible)

> **Status: implemented.** Code lives in `server/ai/` (`provider.ts`, `http.ts`, `ollama-adapter.ts`, `openai-adapter.ts`, `describe.ts`), `server/routes/ai-providers.ts`, and on the client `components/provider-model-picker.tsx` + `components/ai-providers-card.tsx`. Adapter tests: `npx tsx scripts/test-ai-providers.ts`.

## Goal

Replace the single hard-wired Ollama connection with a list of **AI providers**.
Each provider is either:

- **Ollama**: native API (`/api/tags`, `/api/chat`, `/api/embeddings`), behaving exactly as today.
- **OpenAI-compatible**: `/models`, `/chat/completions`, `/embeddings` under a user-supplied base URL
  (OpenAI, OpenRouter, LM Studio, vLLM, llama.cpp server, LiteLLM, Groq, or Ollama's own `/v1`).

Every model dropdown becomes a **provider dropdown + model combobox** pair.

### Decisions (confirmed)

| Topic | Decision |
|---|---|
| Wire protocol | Two native adapters (Ollama, OpenAI) behind one interface |
| Scope | Everything that currently hits Ollama: vision describe, text tasks, AI chat (streaming + tool loop), embeddings. **Whisper is not in scope.** It keeps its own `whisper_api_url`. |
| Model picker | Lists the provider's models **and** accepts typed-in model names |
| Migration | Automatic: the existing Ollama config becomes provider #1 and the default |

### Defaults I picked (veto any of them)

- Providers live in a **new `ai_providers` table**, not as JSON in `app_settings`.
- **Auth:** `none | basic | bearer` for both kinds. Secrets are stored in plain text in the DB, as `ollama_password` is today. The API never returns them, only a `hasSecret` flag.
- **OpenAI base URL includes `/v1`**, matching the OpenAI SDK convention (e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1`).
- **No per-provider enable flag.** A single global `ai_enabled` switch replaces `ollama_enabled`.
- **Remove the hard-coded model fallbacks** (`"llava"`, `"llama3"`). They're Ollama names and are meaningless on other providers. With no model set you get a clear "No model configured" error instead.
- **No OpenAI SDK dependency.** Both adapters use plain `fetch`, like the rest of the codebase.

---

## 1. Data model

### New table `ai_providers` (in `shared/schema.ts` and `server/db-init.ts`)

```sql
CREATE TABLE ai_providers (
  id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,                       -- "Home Ollama", "OpenRouter"
  kind       TEXT NOT NULL,                       -- 'ollama' | 'openai'
  base_url   TEXT NOT NULL,
  auth_type  TEXT NOT NULL DEFAULT 'none',        -- 'none' | 'basic' | 'bearer'
  username   TEXT NOT NULL DEFAULT '',
  secret     TEXT NOT NULL DEFAULT '',            -- password or API key
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_external BOOLEAN NOT NULL DEFAULT FALSE,   -- data leaves the local network (auto-detected from the URL, overridable)
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Model selections = (provider, model) pairs

Each model setting gets a sibling provider setting. The keys are renamed off the `ollama_` prefix, because they may now point anywhere:

| Old key | New model key | New provider key |
|---|---|---|
| `ollama_model` (vision) | `ai_vision_model` | `ai_vision_provider` |
| `ollama_text_model` | `ai_text_model` | `ai_text_provider` |
| `ollama_events_model` | `ai_events_model` | `ai_events_provider` |
| `ollama_sex_guess_model` | `ai_sex_guess_model` | `ai_sex_guess_provider` |
| `ollama_family_tree_model` | `ai_family_tree_model` | `ai_family_tree_provider` |
| `vector_embedding_model` | (unchanged) | `vector_embedding_provider` |
| `ollama_prompt` / `ollama_events_prompt` | `ai_vision_prompt` / `ai_events_prompt` | none |
| `ollama_enabled` / `ollama_auto_describe_images` | `ai_enabled` / `ai_auto_describe_images` | none |

- An empty provider value means the default provider.
- **Fallback rule:** a task with no model (events, sex guess, family tree) falls back to the text model's **pair**. It never mixes one task's provider with another task's model.
- `ai_chats` gets a new column `provider_id TEXT NOT NULL DEFAULT ''`, next to `model`. The task-worker XML export/import (`server/task-worker.ts` ~L805, ~L1542) round-trips it.

### Migration (idempotent, in `db-init.ts`)

It runs only when `ai_providers` is empty **and** `ollama_api_url` is non-empty:

1. Insert provider `{ name: "Ollama", kind: "ollama", base_url: ollama_api_url, auth_type: ollama_auth_required ? "basic" : "none", username, secret: ollama_password, is_default: true }`.
2. Copy each old key to its new key, and set every `*_provider` key to the new id.
3. `UPDATE ai_chats SET provider_id = <id> WHERE model <> ''`.
4. Delete the old `ollama_*` keys.

---

## 2. Server: one provider module, two adapters

### `server/ai/provider.ts` (new)

```ts
export type AiTask = "vision" | "text" | "events" | "sexGuess" | "familyTree" | "embedding";
export type ResolvedModel = { provider: AiProvider; model: string };

listProviders(), getProvider(id), getDefaultProvider()
resolveModel(task: AiTask, override?: { providerId?: string; model?: string }): Promise<ResolvedModel>
adapterFor(provider): AiAdapter
```

`resolveModel` replaces all of the following:

- `getOllamaTextModel()` in `people-groups.ts`
- the four copies of `chatModel || textModel || ollama_model || DEFAULT_CHAT_MODEL` in `ai-vector.ts` (~L2356, 2475, 2554, 2659)
- the events and sex-guess fallbacks (~L2778, ~L3603)
- `ai-tools.ts` ~L806

### `AiAdapter` interface

```ts
// Canonical message = Ollama's shape, so the Ollama adapter is a near pass-through.
type AiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];                                   // base64
  tool_calls?: { id?: string; function: { name: string; arguments: Record<string, unknown> } }[];  // Ollama shape
  tool_call_id?: string;
  name?: string;
};
type ChatChunk = { content?: string; toolCalls?: AiMessage["tool_calls"] };

interface AiAdapter {
  listModels(p): Promise<{ name: string; parameterSize: string | null }[]>;
  chat(p, req: { model; messages: AiMessage[]; tools?; format?; signal? }): Promise<{ content: string; toolCalls }>;
  chatStream(p, req): AsyncIterable<ChatChunk>;
  embed(p, model: string, text: string, signal?): Promise<number[]>;
}
// Connection tests are one shared testProvider() built on listModels().
```

### `server/ai/ollama-adapter.ts`

Lift the existing code as-is:

| Method | Ollama endpoint |
|---|---|
| `listModels` | `/api/tags` |
| `test` | `/api/tags` |
| `chat` / `chatStream` | `/api/chat` (NDJSON, `options.num_predict: -1`) |
| `embed` | `/api/embeddings` |

Vision moves from `/api/generate` to `/api/chat` with `images` on the user message. That's still the native API and lets every task share one path.

### `server/ai/openai-adapter.ts`

| Concern | Translation |
|---|---|
| Models / test | `GET {base}/models` → `data[].id`. A 404 still counts as "connected, can't list" (type-in covers it). |
| Auth | `bearer` → `Authorization: Bearer <secret>`; `basic` as today |
| Images | `images[]` → content parts `[{type:"text"}, {type:"image_url", image_url:{url:"data:image/jpeg;base64,…"}}]` |
| Tool calls out | `arguments` object → `JSON.stringify`; ensure every call has an `id` |
| Tool results | `role:"tool"` + `tool_call_id` (already sent today) |
| Tool calls in | `JSON.parse(function.arguments)`; on streaming, accumulate `delta.tool_calls[i]` fragments by `index` until `finish_reason` |
| Streaming | SSE `data: {…}` lines, terminated by `data: [DONE]` |
| Thinking | `delta.reasoning_content` or `delta.reasoning` → `thinking` (dropped, as today) |
| Embeddings | `POST {base}/embeddings {model, input}` → `data[0].embedding` |
| Tools array | `buildOllamaToolsArray` already emits the OpenAI `{type:"function", function:{…}}` shape. Rename it to `buildToolsArray`. |

### Shared helpers that dedupe current copies

- `describeImage(buffer | photoId)` in `server/ai/describe.ts` replaces `describeImageWithOllama` (`ai-vector.ts` ~L463), the inline duplicate in `auth-setup.ts` ~L196–240, and `/api/ollama/describe`.
- The tool loop (`ai-vector.ts` ~L1966–2200) consumes `adapter.chatStream()` instead of parsing NDJSON itself.

---

## 3. Call sites to migrate

| File | What changes |
|---|---|
| `server/routes/ai-vector.ts` | settings/models/test routes (~L1436–1590), describe (~L463, ~L1591), chat context (~L1693), tool loop (~L1966), chat message routes ×4 (~L2350–2700), events (~L2775), embedding-models (~L3192), sex guess (~L3603); delete the duplicate `getOllamaSetting` helpers (~L88, ~L1438) |
| `server/vector.ts` | `embedText` → `resolveModel("embedding")` + `adapter.embed`; delete `getOllamaBase`/`getOllamaAuthHeaders` |
| `server/ai-tools.ts` ~L789 | summarization → `resolveModel("text")` + `adapter.chat` |
| `server/routes/people-groups.ts` | delete `buildOllamaChatContext` and `getOllamaTextModel` |
| `server/find-name-ai.ts` | take `ResolvedModel` instead of `{ ollama, model }` |
| `server/routes/describe-me.ts`, `messages.ts` | use `resolveModel("text")` |
| `server/routes/auth-setup.ts` ~L196 | upload auto-describe → `describeImage()` |
| `server/routes/setup-services.ts` ~L111 | health check iterates providers (`adapter.test`) |
| `server/task-worker.ts` | ai_chats XML includes `provider_id` |
| `server/routes/ai-vector.ts` vector settings ~L3166 | re-vectorize reset also fires when the embedding **provider** changes |

---

## 4. API

| Route | Purpose |
|---|---|
| `GET /api/ai/providers` | list (no secrets; `hasSecret`) |
| `POST /api/ai/providers` | create |
| `PATCH /api/ai/providers/:id` | update (empty `secret` = keep) and set default |
| `DELETE /api/ai/providers/:id` | 409 if it's the default, the last provider, or referenced by a setting/chat (response lists usages) |
| `POST /api/ai/providers/test` | test unsaved form values (or `{id}` for a saved one) |
| `GET /api/ai/providers/:id/models` | model list for the combobox |
| `GET/POST /api/ai/settings` | replaces `/api/ollama/settings`; model fields become `{ providerId, model }` pairs; whisper fields pass through unchanged |
| `POST /api/ai/describe` | replaces `/api/ollama/describe`; accepts `providerId` + `model` |

Removed: `/api/ollama/settings`, `/api/ollama/models`, `/api/ollama/test`, `/api/ollama/describe`, `/api/vector/embedding-models`.
Update `client/src/pages/api-docs.tsx` and `Guides/PRM-external-API-guide.md` (~L1955, ~L2204).

---

## 5. Client

### Provider management

Replace the Ollama connection card on `intelligence-settings.tsx` with an **AI Providers** card:

- a list of providers (name, kind badge, URL, default star)
- an add/edit dialog (name, kind, base URL with a per-kind placeholder, auth type, username, secret, **Test** button)
- set default, and delete (surfaces the 409 usage list)

### `<ProviderModelPicker>` (new shared component)

```tsx
<ProviderModelPicker
  value={{ providerId, model }}
  onChange={setPair}
  fallbackLabel="Use text model"   // optional: adds a "fallback" choice that clears both
/>
```

- **Provider:** a `Select`, populated from `/api/ai/providers`. The default provider is marked.
- **Model:** a `Popover` + `Command` combobox (both already in `components/ui`), filled from `/api/ai/providers/:id/models` (one query key per provider) and filterable. Free text can be committed as a model name.
- Changing the provider clears the model.

### Dropdowns to convert

| File | Pickers |
|---|---|
| `pages/intelligence-settings.tsx` | text, events, sex guess (family tree model removed with that feature) |
| `pages/intelligence-images-settings.tsx` | vision |
| `pages/vector-settings.tsx` | embedding |
| `pages/ai-chat-demo.tsx` | per-chat model, branch model (+ header badge shows `provider · model`) |
| `components/setup-stages/stage-ai.tsx` | providers card, then text, vision, events, embedding |
| `pages/ocr-demo.tsx` | reads settings only, so it passes `providerId` to `/api/ai/describe` |

Copy: change generic "Ollama" wording to "AI" (e.g. `photo-upload-dialog.tsx` "Ollama Scene Description"), and keep "Ollama" only where it really is Ollama-specific (e.g. the `ollama pull` hint shown for Ollama providers in setup).

---

## 6. Phases

1. **Foundation, Ollama only.** Add the table, migration, `server/ai/provider.ts` and the Ollama adapter, and move every call site in §3 onto it. Nothing user-visible changes, so this phase is a safe checkpoint. Verify describe, chat (stream + tools), events, sex guess, find-name, describe-me, people-groups and embeddings against your Ollama.
2. **OpenAI adapter.** Do `listModels`/`test`/`chat`/`embed` first, then `chatStream` and the tool loop. **Test trick:** point an `openai` provider at the same Ollama's `http://host:11434/v1`. That exercises the whole adapter against models you already have.
3. **API + UI.** Provider routes, `/api/ai/settings`, the provider management card, `ProviderModelPicker` everywhere, and the chat `provider_id`.
4. **Cleanup.** Delete the old `/api/ollama/*` routes and helpers. Update api-docs, the external API guide, QUICKSTART and the setup wizard copy. Add `scripts/test-ai-providers.ts` to smoke-test both adapters (chat, stream, tools, vision, embed) against a configured provider.

## 7. Watch-outs

- **Embedding dimensions:** a different embedding model can produce a different vector size. Implemented as a block: `ensureCollection` refuses to write vectors of a different size into an existing collection, and *Test connection* reports the mismatch. Nothing is deleted automatically.
- **Tool-calling support varies** on OpenAI-compatible servers. If a server rejects `tools`, surface its error as-is. Don't build silent fallbacks.
- **Vision support varies.** A text-only model given an image errors on the provider side. Show that error; don't pre-validate.
- **Privacy:** hosted providers receive personal data (messages, journal text, photos). Providers flagged `is_external` show an amber **External** badge (with an explanatory tooltip) in the provider list, next to every model picker that targets them, and in the AI chat header; the add/edit dialog shows a warning box when the flag is on.
