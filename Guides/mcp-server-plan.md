# PRM MCP Server — Plan

Expose PRM to MCP clients (Claude Code, Claude Desktop, Cursor, VS Code, …) so an
external assistant can search people, read messages, pull family trees and — when
allowed — write notes and interactions, using the same tools the in-app chat uses.

Settings UI: **Settings → API Documentation → MCP Server** (`/settings/api/mcp`,
`client/src/pages/mcp-settings.tsx`). Settings page and server are both built (see "Done" below).

---

## What already exists (reuse, don't rebuild)

| Piece | Where | How MCP uses it |
|---|---|---|
| Tool registry (name, description, JSON-schema params, handler, `write` flag) | `server/ai-tools.ts` → `AI_TOOLS` | Becomes the MCP tool list 1:1. No new handlers. |
| Tool settings pattern (`app_settings` JSON per-tool map) | `server/routes/ai-vector.ts` → `readPerTool()` | MCP has its own `mcp_*` keys read the same way. |
| API keys table + CRUD | `api_keys`, `/api/api-keys` in `server/routes/auth-setup.ts` | New `keyType: "mcp"`; MCP keys are managed on the MCP page. |
| `/api` auth gate + public-path allowlist | `server/routes/auth-setup.ts` → `PUBLIC_API_PATHS` | `/mcp` is listed as public; the route does its own bearer auth. |
| Rate limiter (`/api/*`, 600 req/min) | `server/middleware/rate-limit.ts` | Applies automatically because the endpoint lives at `/api/mcp`. |
| SHA-256 token lookup pattern | `authenticateExtensionToken` in `server/auth.ts` | Same O(1) lookup for MCP keys. |

### Gap found while planning

API keys were **never verified anywhere** — no middleware reads `X-API-Key` or
`Authorization`, even though `api-docs.tsx` documents `X-API-Key`. They were also
scrypt-hashed with a random salt, so a key could not be looked up without scanning
every row. **Done:** new keys are now stored as SHA-256 hex (same as extension
tokens), so `storage.getApiKeyByKey(sha256(token))` is a single indexed lookup.
Keys created before this change cannot authenticate and must be recreated (nothing
used them, so nothing breaks).

---

## Done (this change)

- `POST /api/api-keys` accepts `keyType: "mcp"` and hashes new keys with SHA-256.
- `GET/POST /api/mcp/settings` in `server/routes/ai-vector.ts`:
  - `mcp_enabled` (default **false**): master switch.
  - `mcp_allow_writes` (default **false**): when off, `write` tools are hidden from `tools/list` and refused on `tools/call`.
  - `mcp_per_tool` (JSON map, default every tool on).
  - Response also carries `tools` (the AI tool metadata minus tools that cannot run over MCP, i.e. `ask_user`).
- The settings page, with three tabs:
  - **Auth**: create, list and revoke MCP keys (shown once on creation), plus last-used time.
  - **Options**: master switch, write access, per-tool toggles grouped by category, and the endpoint URL.
  - **Guides**: copy-ready config for Claude Code, Claude Desktop, Cursor, VS Code and a curl smoke test.
- The server, `server/routes/mcp.ts` (`registerMcp`, registered before `registerMessages`; `/mcp` in `PUBLIC_API_PATHS`), built as described below with `@modelcontextprotocol/sdk` 1.32.

---

## Server design (built)

### 1. Dependency

```bash
npm install @modelcontextprotocol/sdk
```

Use the **low-level `Server`** class (not `McpServer`): `AI_TOOLS` already carries
raw JSON Schema, and `McpServer.tool()` wants zod shapes. The low-level API takes
JSON Schema as-is.

### 2. Transport: Streamable HTTP, stateless

- Endpoint `POST /api/mcp` (also answer `GET`/`DELETE` with 405, since there's no SSE stream or sessions in stateless mode).
- Create a fresh `Server` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request, `await transport.handleRequest(req, res, req.body)`, and close both on `res.on("close")`. Stateless means no session map, no sticky routing, and it survives restarts.
- The JSON body is already parsed by the default `express.json({ limit: "5mb" })`.
- stdio is **not** needed: Claude Desktop reaches remote servers through `mcp-remote` (see the Guides tab).

### 3. New file `server/routes/mcp.ts` (~120 lines)

```ts
export function registerMcp(app: Express) {
  app.post("/api/mcp", mcpAuth, async (req, res) => { /* build server, handle */ });
  app.all("/api/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
}
```

**`mcpAuth` middleware**
1. If `mcp_enabled !== "true"`, respond `503 { error: "MCP server is disabled" }`.
2. Read `Authorization: Bearer <key>` (also accept `X-API-Key` for symmetry with the docs).
3. Look up `storage.getApiKeyByKey(sha256(key))` and require `keyType === "mcp"`, otherwise `401` with `WWW-Authenticate: Bearer`.
4. Call `storage.updateApiKeyLastUsed(id)` fire-and-forget, throttled to once per minute per key with an in-memory `Map<id, ts>`.
5. Set `req.user = await storage.getUser(apiKey.userId)` so the rate limiter keys by user.
6. **Origin check**: when an `Origin` header is present and not the app's own origin, respond `403`. The MCP spec requires this to block DNS rebinding. CLI clients send no Origin.

**Tool wiring** (reuse `readMcpSettings()` from `ai-vector.ts`, exported):

```ts
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: exposedTools(settings).map((t) => ({
    name: t.name,
    title: t.label,
    description: t.description,
    inputSchema: t.parameters,
    annotations: { readOnlyHint: !t.write, destructiveHint: false, openWorldHint: false },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const tool = exposedTools(settings).find((t) => t.name === req.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown or disabled tool: ${req.params.name}` }] };
  try {
    const result = await tool.handler(req.params.arguments ?? {}, { signal: extra.signal });
    return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
  } catch (e: any) {
    return { isError: true, content: [{ type: "text", text: e.message }] };
  }
});
```

`exposedTools(settings)` = `AI_TOOLS` minus `MCP_EXCLUDED_TOOLS`, minus disabled
per-tool entries, minus `write` tools unless `allowWrites`. One helper serves both
handlers, so a hidden tool can never be called.

`askUser` is not passed in the context, so `ask_user` stays excluded. MCP clients
do their own approval prompts for tool calls, so the chat's `auth` execution mode
has no MCP equivalent: writes are simply on or off.

Server info: `{ name: "prm", version: package.json version }`, with
`instructions` = a short paragraph telling the model that people are identified by
`uuid` and to call `person_search` before `person_pull`.

### 4. Registration

In `server/routes.ts`, call `registerMcp(app)` **before** `registerMessages(app)`,
next to `registerTps`. `registerMessages` mounts a catch-all `/api` router that
401s non-session requests, which would otherwise shadow `/api/mcp`. Add `"/mcp"` to
`PUBLIC_API_PATHS` so the session gate lets bearer requests through.

### 5. Docs cleanup

`client/src/pages/api-docs.tsx` advertises `X-API-Key` for the REST API, but nothing
enforces it. Either drop that card, or (separately, out of scope here) add a general
API-key middleware for `keyType: "full"` using the same lookup as `mcpAuth`.

---

## Phase 2 (only if needed)

- **OAuth 2.1** so PRM can be added as a custom connector in claude.ai and the Claude apps, which need OAuth or an authless server rather than a static bearer header. That means the protected-resource metadata at `/.well-known/oauth-protected-resource`, plus an authorization server (consent page backed by the existing session login) and dynamic client registration. Large; do it only when bearer-key clients aren't enough.
- **Resources** (for example `prm://person/{uuid}` as markdown) and **prompts** ("summarize my week"). Both are skipped until a client actually needs them.

---

## Test plan

1. `npm run check` passes.
2. With MCP disabled, `POST /api/mcp` returns 503. Enabled with no key returns 401, and with a `full` key also 401.
3. Run the curl from the Guides tab: `initialize` returns `serverInfo.name === "prm"`.
4. `npx @modelcontextprotocol/inspector`: connect over Streamable HTTP with the bearer header. `tools/list` matches the Options tab, and toggling a tool off removes it on the next request.
5. With writes off, `create_note` is absent and calling it directly gives `isError`. With writes on, it creates a note visible in the app.
6. Claude Code: `claude mcp add …` from the Guides tab, then ask "who is in my family tree?" and check that it calls `family_tree_pull`.
7. Revoke the key on the Auth tab, and the next call returns 401.

## Files

| File | Change |
|---|---|
| `server/routes/mcp.ts` | **new**: auth middleware, per-request server, tool handlers |
| `server/routes.ts` | register before `registerMessages` |
| `server/routes/auth-setup.ts` | `"/mcp"` in `PUBLIC_API_PATHS` (key type and SHA-256 are already done) |
| `server/routes/ai-vector.ts` | export `readMcpSettings` and `MCP_EXCLUDED_TOOLS` (settings endpoints are already done) |
| `package.json` | `@modelcontextprotocol/sdk` |
