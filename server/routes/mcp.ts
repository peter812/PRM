// MCP server route module - mcp.ts
//
// Exposes the AI_TOOLS registry (the same tools the in-app chat uses) to
// external MCP clients (Claude Code, Claude Desktop via mcp-remote, Cursor, ...)
// over Streamable HTTP at POST /api/mcp. Stateless: a fresh Server + transport
// per request, so there is no session map and restarts don't drop clients.
//
// Auth is a bearer API key of keyType "mcp" (created on Settings → API → MCP
// Server). The path is in PUBLIC_API_PATHS (auth-setup.ts) so the browser
// session gate lets it through; mcpAuth below does the real check.
// See Guides/mcp-server-plan.md.
import type { Express, NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { storage } from "../storage";
import { AI_TOOLS } from "../ai-tools";
import { MCP_EXCLUDED_TOOLS, readMcpSettings } from "./ai-vector";

const INSTRUCTIONS =
  "PRM is a personal relationship manager. People are identified by `uuid`: " +
  "call `person_search` to find someone's uuid before calling `person_pull` or other per-person tools.";

// Last-used timestamps are written at most once a minute per key.
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedWrites = new Map<string, number>();

async function mcpAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if ((await storage.getAppSetting("mcp_enabled")) !== "true") {
      return res.status(503).json({ error: "MCP server is disabled" });
    }

    // Block DNS rebinding: browsers send Origin, CLI clients don't.
    const origin = req.get("origin");
    if (origin) {
      let host: string | null = null;
      try { host = new URL(origin).host; } catch { /* malformed */ }
      if (host !== req.get("host")) return res.status(403).json({ error: "Origin not allowed" });
    }

    const bearer = req.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const rawKey = (bearer ?? req.get("x-api-key"))?.trim();
    const apiKey = rawKey
      ? await storage.getApiKeyByKey(crypto.createHash("sha256").update(rawKey).digest("hex"))
      : undefined;
    if (!apiKey || apiKey.keyType !== "mcp") {
      return res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Invalid or missing MCP API key" });
    }

    const now = Date.now();
    if (now - (lastUsedWrites.get(apiKey.id) ?? 0) > LAST_USED_THROTTLE_MS) {
      lastUsedWrites.set(apiKey.id, now);
      storage.updateApiKeyLastUsed(apiKey.id).catch(() => {});
    }

    // Lets the rate limiter key by user.
    const user = await storage.getUser(apiKey.userId);
    if (!user) return res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Key owner not found" });
    req.user = user;
    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

/** The tools an MCP client may see and call; one list serves both handlers so a hidden tool can't be called. */
function exposedTools(settings: Awaited<ReturnType<typeof readMcpSettings>>) {
  return AI_TOOLS.filter(
    (t) => !MCP_EXCLUDED_TOOLS.has(t.name) && settings.perTool[t.name] && (!t.write || settings.allowWrites),
  );
}

function buildServer(tools: ReturnType<typeof exposedTools>) {
  const server = new Server(
    { name: "prm", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.label,
      description: t.description,
      inputSchema: t.parameters as any,
      annotations: { title: t.label, readOnlyHint: !t.write, destructiveHint: false, openWorldHint: false },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `Unknown or disabled tool: ${req.params.name}` }] };
    }
    try {
      const result = await tool.handler(req.params.arguments ?? {}, { signal: extra.signal });
      return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
    } catch (e: any) {
      return { isError: true, content: [{ type: "text", text: e?.message ?? String(e) }] };
    }
  });

  return server;
}

export function registerMcp(app: Express) {
  app.post("/api/mcp", mcpAuth, async (req, res) => {
    try {
      const server = buildServer(exposedTools(await readMcpSettings()));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: error.message }, id: null });
      }
    }
  });

  // Stateless mode: no SSE stream to GET and no session to DELETE.
  app.all("/api/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
}
