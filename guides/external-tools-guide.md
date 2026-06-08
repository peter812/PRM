# External Tools Guide

A path forward for letting the LLM inside PRM make calls to systems **outside** of PRM — custom HTTP APIs, n8n webhooks, automation platforms, and other third-party services. This complements the existing built-in tool system (see `server/ai-tools.ts` and the **Intelligence → Tools** settings page) which only operates on PRM's own data.

The goal of this document is not to prescribe a final implementation, but to lay out the problem space, the design options, and a recommended phased rollout so that work can start incrementally without painting ourselves into a corner.

---

## 1. Why "external tools"?

The existing AI tools let the model read and write PRM data (people, notes, interactions, etc.). Users have asked for the model to also be able to:

- Hit a custom REST/GraphQL endpoint they host themselves.
- Trigger an [n8n](https://n8n.io/) webhook (or Zapier / Make / Pipedream / Home Assistant / etc.) so a chat message can kick off a workflow.
- Pull live data from third-party services (calendar, weather, CRM, knowledge base, vector store) into a conversation.
- Send notifications (email, push, SMS, Slack/Discord) on the user's behalf.

All of these reduce to the same primitive: **"give the LLM a typed, named, user-configured HTTP call it can choose to invoke."**

---

## 2. Where this fits in the current architecture

Relevant pieces already in the codebase:

- `server/ai-tools.ts` — registry of built-in tools exposed to the model, with metadata (name, label, category, write/read flag) and JSON-schema input.
- `server/routes.ts` — `/api/ai-tools` and `/api/ai-tools/settings` endpoints, plus the chat completion path that actually feeds tools to Ollama.
- `client/src/pages/intelligence-tools-settings.tsx` — UI for enabling/disabling individual tools and choosing an execution mode (`off` / `auth` / `open`).
- `app_settings` key-value table (see `server/db-init.ts`) — used today for Ollama settings; can be reused for global flags.
- Drizzle schema in `shared/schema.ts` — where any new tables (e.g. `external_tools`, `external_tool_runs`) should be declared, with mirrored `CREATE TABLE IF NOT EXISTS` statements in `server/db-init.ts` `validateAndSyncSchema()`.

External tools should plug into the **same** pipeline that surfaces built-in tools to the model, so that the user's per-tool toggles, execution-mode auth prompt, and audit trail all behave consistently.

---

## 3. Categories of external calls to support

Implementations should be designed so that all of these are expressible with a single "external tool" record:

1. **Custom HTTP API call (generic REST)**
   - Method (GET/POST/PUT/PATCH/DELETE), URL, headers, query params, JSON body template.
   - Auth: none, bearer token, API key header, HTTP Basic, or OAuth2 client-credentials.
2. **n8n webhook**
   - A specialization of the generic HTTP call: POST to a webhook URL with a JSON body.
   - Optional support for n8n's `Respond to Webhook` node so the result flows back to the model.
3. **Other webhook-style platforms** — Zapier, Make.com, Pipedream, IFTTT, Home Assistant, GitHub Actions `repository_dispatch`. Same shape as n8n.
4. **GraphQL endpoint** — POST with `{ query, variables }`; treat as a typed variant of the generic HTTP call.
5. **Server-Sent Events / streaming endpoints** — out of scope for v1, but the schema should not preclude them.
6. **MCP servers** ([Model Context Protocol](https://modelcontextprotocol.io/)) — strongly recommended as a later phase: any MCP server can advertise its own tools and PRM can re-expose them, getting a whole ecosystem "for free."

---

## 4. Data model

Suggested new tables (Drizzle in `shared/schema.ts`, plus raw SQL in `server/db-init.ts`):

### `external_tools`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid / serial | primary key |
| `name` | text, unique | machine name exposed to the LLM (snake_case, validated) |
| `label` | text | human-readable name shown in UI |
| `description` | text | description shown to the LLM — this is what teaches the model when to call it |
| `kind` | text enum | `http` \| `n8n_webhook` \| `graphql` \| `mcp` (future) |
| `enabled` | boolean | per-tool master toggle |
| `write` | boolean | does this tool have side effects? Drives the auth prompt |
| `endpoint_url` | text | base URL or webhook URL |
| `method` | text | for `http`/`graphql`; ignored for webhooks |
| `headers_json` | jsonb | static headers (templated values allowed) |
| `query_json` | jsonb | static query params (templated) |
| `body_template` | text | JSON template using `{{var}}` placeholders for inputs |
| `input_schema_json` | jsonb | JSON Schema for arguments the LLM must supply |
| `output_handling` | text enum | `raw` \| `json_path` \| `summarize` |
| `output_json_path` | text | optional JSONPath to extract a sub-value |
| `timeout_ms` | integer | per-call timeout (default 15s) |
| `auth_kind` | text enum | `none` \| `bearer` \| `api_key_header` \| `basic` \| `oauth2_cc` |
| `auth_secret_id` | uuid \| null | FK to `external_tool_secrets` (never inline secrets in this table) |
| `created_at` / `updated_at` | timestamps | |

### `external_tool_secrets`

Secrets are stored separately and **encrypted at rest** using a key derived from an env var (mirroring how Ollama credentials are handled today). Columns: `id`, `kind`, `ciphertext`, `iv`, `created_at`. The plaintext never leaves the server.

### `external_tool_runs` (audit log)

Every invocation: `id`, `tool_id`, `chat_id`, `request_summary`, `status_code`, `latency_ms`, `truncated_response`, `error`, `approved_by_user` (boolean), `created_at`. Capped at e.g. last 1000 rows per user to bound storage.

---

## 5. Security model

External tools are higher-risk than built-in tools because they exfiltrate data to URLs the user (or, worse, a prompt-injected page) chose. Non-negotiables:

1. **Reuse the existing execution-mode gate.** Any tool with `write = true`, **and** any tool with `kind != http` regardless of `write`, must respect the chat's execution mode (`off` / `auth` / `open`). When the mode is `auth`, the user gets the same accept/examine/reject prompt that built-in write tools use today.
2. **SSRF protection.** Reject (or warn loudly about) URLs that resolve to private/loopback ranges by default — `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`. Provide an opt-in "allow private network" flag per tool for users who genuinely want to hit `localhost:5678` for n8n or a LAN service. Resolve DNS once and re-validate before connecting to mitigate DNS-rebinding.
3. **Allow-list of schemes**: `https` only by default, `http` only when "allow private network" is on or the host is `localhost`/`127.0.0.1`.
4. **Outbound size and time limits.** Hard cap request and response bodies (e.g. 1 MB request, 256 KB response shown to the model), enforce `timeout_ms`, and never follow redirects to a different host without re-validating against the SSRF rules.
5. **Secret hygiene.** Secrets are write-only from the UI (POST creates/updates, GET returns `hasSecret: true` only — same pattern as Ollama auth password today). Templating must redact secret values from the run log and from anything ever shown to the model.
6. **Prompt-injection awareness.** Document clearly that *response bodies* from external tools are untrusted text the model will read. Consider stripping or summarizing responses (`output_handling = summarize`) before they re-enter the conversation, and never auto-chain another tool call from a response without user approval when execution mode is `auth`.
7. **Per-tool rate limiting.** Simple token-bucket per `tool_id` to stop a runaway loop from hammering an endpoint or burning through a paid API quota.
8. **Audit log is mandatory and append-only** for any `write` tool.

---

## 6. Server-side wiring

1. **Tool registry extension.** In `server/ai-tools.ts`, expose a function that returns built-in tools **plus** enabled rows from `external_tools` adapted to the same `ToolMetadata` shape. The chat handler that builds the tool list for Ollama already iterates over `getEnabledTools()` (or equivalent) and won't need to know the difference.
2. **Argument validation.** Validate the LLM's tool arguments against `input_schema_json` (Zod or Ajv) before any HTTP work. Reject and feed the error message back to the model so it can self-correct.
3. **Templating engine.** Use a tiny, sandboxed `{{var}}` substitution — **not** a full Mustache/Handlebars/Jinja, and never `eval`/`new Function`. Allow only top-level keys from the validated arguments plus a small set of safe helpers (`{{now}}`, `{{user.id}}`).
4. **HTTP client.** Use the existing `fetch` (Node 20+) with `AbortSignal.timeout(...)` for the timeout. Centralize the SSRF check in one place and call it from every code path that takes a user-supplied URL.
5. **Response post-processing.** Apply `output_json_path` if set; otherwise return the raw body trimmed to the response cap. For `output_handling = summarize`, run a second small Ollama prompt to summarize the response into ≤ 500 tokens before handing it back to the model — useful for huge JSON blobs.
6. **Endpoints to add** (mirroring existing patterns in `server/routes.ts`):
   - `GET    /api/external-tools` — list (no secrets)
   - `POST   /api/external-tools` — create
   - `PATCH  /api/external-tools/:id` — update
   - `DELETE /api/external-tools/:id`
   - `POST   /api/external-tools/:id/test` — run with sample args, never persisted to a chat
   - `GET    /api/external-tools/:id/runs` — paginated audit log
7. **Feature flag.** Gate the whole feature behind an `app_settings` row (e.g. `external_tools_enabled`) defaulting to `false`, so the page can ship in a "Coming Soon" state and be flipped on once the backend is ready.

---

## 7. Client-side UX

Replace the "Coming Soon" page at **Intelligence → External Tools** with, in order:

1. A master switch ("Enable external tools") wired to the feature-flag setting.
2. A list of configured external tools — same card style as `intelligence-tools-settings.tsx`, with the same write-badge, per-tool toggle, and "disabled by execution mode" copy where relevant.
3. A "+ New external tool" button opening a multi-step dialog:
   - Step 1: pick a preset (`Custom HTTP`, `n8n Webhook`, `GraphQL`, `MCP server` later). Presets pre-fill sensible defaults.
   - Step 2: endpoint + auth.
   - Step 3: input schema (free-form JSON Schema editor + a "describe the parameters in plain English" helper that writes the schema for you using the configured Ollama model).
   - Step 4: dry-run with sample arguments, show the request that will be sent (with secrets redacted) and the response.
4. A per-tool "Recent runs" drawer that reads `/api/external-tools/:id/runs`.

The chat UI's existing "AI wants to use tool X" approval popup needs no changes beyond a new icon for external calls (suggest `Plug` from `lucide-react`, already imported).

---

## 8. Recommended phased rollout

The implementation can be split so each phase ships value on its own:

1. **Phase 0 (this PR): scaffolding.** Settings page exists, says "Coming Soon," and the route is wired. ✅ done in the same change that added this guide.
2. **Phase 1: read-only custom HTTP.** Schema, registry hook, single `kind = http` with `method = GET`, no secrets, no templating beyond URL query params from arguments. Proves out the model-facing plumbing end-to-end.
3. **Phase 2: write/POST + secrets + auth modes.** Adds POST/PUT/PATCH/DELETE, the `external_tool_secrets` table, encrypted-at-rest secrets, and full integration with the existing execution-mode auth prompt.
4. **Phase 3: n8n / generic webhook preset.** Mostly UX — a wizard that pre-fills the right defaults — plus the "Respond to Webhook" round-trip.
5. **Phase 4: response post-processing.** `output_json_path`, `output_handling = summarize`, response size caps tuned with real usage.
6. **Phase 5: MCP client.** Add `kind = mcp`, connect to user-specified MCP servers, and dynamically expose their tools through the same pipeline. This is where we get the biggest ecosystem lift for the least incremental code.

Each phase should land behind the existing feature flag and behind the per-tool enable switch, so partial deploys are safe.

---

## 9. Open questions

- Should external tools be scoped per-user, per-chat, or global? (Suggested: global definitions, per-chat enable list, mirroring how built-in tools work today.)
- Do we want to support **importing** OpenAPI / Swagger definitions to auto-generate a tool? Big UX win, non-trivial validation work.
- How do we expose tool *cost* (paid APIs) to the user? At minimum, a free-text "this call may incur cost" warning shown in the auth prompt.
- For n8n specifically, do we want a tighter integration that imports a workflow's input schema directly via the n8n REST API? (Phase 3+.)

---

## 10. References in this codebase

- Built-in tool registry and metadata: `server/ai-tools.ts`
- Tool settings API: `server/routes.ts` (`/api/ai-tools`, `/api/ai-tools/settings`)
- Tool settings UI: `client/src/pages/intelligence-tools-settings.tsx`
- Settings page wiring: `client/src/pages/settings-layout.tsx`
- App-wide key/value settings + schema sync pattern: `server/db-init.ts` `validateAndSyncSchema()` and `app_settings` table; Ollama settings helpers in `server/routes.ts` are the closest existing pattern to copy.
