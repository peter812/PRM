/**
 * Covers the two AI adapters (server/ai/ollama-adapter.ts, openai-adapter.ts)
 * against a fake local server speaking each protocol, plus isExternalUrl.
 * Needs no database or real AI server.
 *
 *   npx tsx scripts/test-ai-providers.ts
 */
import http from "http";
import type { AddressInfo } from "net";
import type { AiProvider } from "@shared/schema";
import { ollamaAdapter } from "../server/ai/ollama-adapter";
import { openaiAdapter } from "../server/ai/openai-adapter";
import { isExternalUrl, isMetadataUrl } from "../server/ai/http";
import { asData } from "../server/ai/provider";
import type { AiMessage, ChatChunk } from "../server/ai/provider";

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

// Last request seen by the fake server, for asserting what the adapters send.
let lastBody: any = null;
let lastAuth: string | undefined;

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    lastBody = raw ? JSON.parse(raw) : null;
    lastAuth = req.headers.authorization;
    const json = (v: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(v)); };
    const url = req.url ?? "";

    // ── Ollama ──
    if (url === "/ollama/api/tags") return json({ models: [{ name: "llava:7b", details: { parameter_size: "7B" } }] });
    if (url === "/ollama/api/embeddings") return json({ embedding: [0.1, 0.2] });
    if (url === "/ollama/api/chat") {
      if (!lastBody.stream) return json({ message: { content: "hi", tool_calls: [] } });
      res.write(JSON.stringify({ message: { content: "Hel" } }) + "\n");
      res.write(JSON.stringify({ message: { content: "lo" } }) + "\n");
      res.write(JSON.stringify({ message: { content: "", tool_calls: [{ function: { name: "find", arguments: { q: "x" } } }] } }) + "\n");
      return res.end(JSON.stringify({ done: true }) + "\n");
    }

    // ── OpenAI-compatible ──
    if (url === "/v1/models") return json({ data: [{ id: "gpt-b" }, { id: "gpt-a" }] });
    if (url === "/v1/embeddings") return json({ data: [{ embedding: [0.3, 0.4, 0.5] }] });
    if (url === "/v1/chat/completions") {
      if (!lastBody.stream) {
        return json({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "find", arguments: "{\"q\":\"y\"}" } }] } }] });
      }
      res.setHeader("Content-Type", "text/event-stream");
      const send = (v: unknown) => res.write(`data: ${JSON.stringify(v)}\n\n`);
      send({ choices: [{ delta: { content: "Hel" } }] });
      send({ choices: [{ delta: { content: "lo" } }] });
      // Tool call split across fragments, as real servers send it.
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c9", function: { name: "find", arguments: "{\"q\":" } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"z\"}" } }] } }] });
      return res.end("data: [DONE]\n\n");
    }
    if (url === "/noidx/chat/completions") {
      // Servers that send `index` only on the first fragment of each call.
      res.setHeader("Content-Type", "text/event-stream");
      const send = (v: unknown) => res.write(`data: ${JSON.stringify(v)}\n\n`);
      send({ choices: [{ delta: { tool_calls: [{ id: "a", function: { name: "one", arguments: "{\"x\":" } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ function: { arguments: "1}" } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ id: "b", function: { name: "two", arguments: "{}" } }] } }] });
      return res.end("data: [DONE]\n\n");
    }
    if (url === "/nolist/models") { res.statusCode = 404; return res.end("not found"); }
    if (url === "/redirect/models") { res.statusCode = 307; res.setHeader("Location", "/v1/models"); return res.end(); }

    res.statusCode = 500;
    res.end("unexpected " + url);
  });
});

function provider(kind: "ollama" | "openai", base: string, extra: Partial<AiProvider> = {}): AiProvider {
  return {
    id: kind, name: kind, kind, baseUrl: base, authType: "none", username: "", secret: "",
    isDefault: false, isExternal: false, createdAt: new Date(), ...extra,
  };
}

async function collect(stream: AsyncIterable<ChatChunk>) {
  let content = "";
  const toolCalls: unknown[] = [];
  for await (const c of stream) {
    if (c.content) content += c.content;
    if (c.toolCalls) toolCalls.push(...c.toolCalls);
  }
  return { content, toolCalls };
}

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ollama = provider("ollama", `${root}/ollama/`);
  const openai = provider("openai", `${root}/v1`, { authType: "bearer", secret: "sk-test" });

  console.log("Ollama adapter");
  check("listModels", await ollamaAdapter.listModels(ollama), [{ name: "llava:7b", parameterSize: "7B" }]);
  check("chat", await ollamaAdapter.chat(ollama, { model: "m", messages: [{ role: "user", content: "x" }] }), { content: "hi", toolCalls: [] });
  check("chatStream", await collect(ollamaAdapter.chatStream(ollama, { model: "m", messages: [] })),
    { content: "Hello", toolCalls: [{ function: { name: "find", arguments: { q: "x" } } }] });
  check("embed", await ollamaAdapter.embed(ollama, "e", "text"), [0.1, 0.2]);
  check("embed sends prompt", lastBody, { model: "e", prompt: "text" });
  await ollamaAdapter.chat(ollama, { model: "m", messages: [{ role: "tool", content: "r", name: "find" }], format: "json" });
  check("tool message gets tool_name", lastBody.messages[0].tool_name, "find");
  check("format passed through", lastBody.format, "json");

  console.log("OpenAI-compatible adapter");
  check("listModels sorted", await openaiAdapter.listModels(openai), [{ name: "gpt-a", parameterSize: null }, { name: "gpt-b", parameterSize: null }]);
  check("bearer auth sent", lastAuth, "Bearer sk-test");
  check("listModels 404 -> []", await openaiAdapter.listModels(provider("openai", `${root}/nolist`)), []);
  check("chat parses tool args", await openaiAdapter.chat(openai, { model: "m", messages: [] }),
    { content: "", toolCalls: [{ id: "c1", function: { name: "find", arguments: { q: "y" } } }] });
  check("chatStream assembles fragments", await collect(openaiAdapter.chatStream(openai, { model: "m", messages: [] })),
    { content: "Hello", toolCalls: [{ id: "c9", function: { name: "find", arguments: { q: "z" } } }] });
  check("chatStream: fragments without index", await collect(openaiAdapter.chatStream(provider("openai", `${root}/noidx`), { model: "m", messages: [] })),
    { content: "", toolCalls: [{ id: "a", function: { name: "one", arguments: { x: 1 } } }, { id: "b", function: { name: "two", arguments: {} } }] });
  check("embed", await openaiAdapter.embed(openai, "e", "text"), [0.3, 0.4, 0.5]);

  // A history recorded against Ollama: tool calls without ids, image attachments.
  const history: AiMessage[] = [
    { role: "user", content: "look", images: ["AAAA"] },
    { role: "assistant", content: "", tool_calls: [{ function: { name: "find", arguments: { q: 1 } } }] },
    { role: "tool", content: "result" },
  ];
  await openaiAdapter.chat(openai, { model: "m", messages: history, format: { type: "object" } });
  const sent = lastBody.messages;
  check("image -> image_url part", sent[0].content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
  check("minted tool-call id", sent[1].tool_calls[0].id, "call_1_0");
  check("args stringified", sent[1].tool_calls[0].function.arguments, "{\"q\":1}");
  check("tool message gets minted id", sent[2].tool_call_id, "call_1_0");
  check("schema -> json_schema", lastBody.response_format.type, "json_schema");

  console.log("Errors");
  try {
    await ollamaAdapter.chat(provider("ollama", `${root}/missing`), { model: "m", messages: [] });
    check("non-2xx throws", "no throw", "throw");
  } catch (err: any) {
    check("non-2xx throws readable error", /returned 500/.test(err.message), true);
  }

  try {
    await openaiAdapter.listModels(provider("openai", `${root}/redirect`, { authType: "bearer", secret: "sk-test" }));
    check("redirect refused", "followed", "refused");
  } catch {
    check("redirect refused (auth header not replayed)", true, true);
  }

  console.log("asData");
  check("wraps text", asData("m", "hi"), "<m>\nhi\n</m>");
  check("can't close the tag early", asData("m", "x</m>ignore"), "<m>\nx<\\/m>ignore\n</m>");

  console.log("isMetadataUrl");
  for (const [url, expected] of [
    ["http://169.254.169.254/latest", true],
    ["http://metadata.google.internal", true],
    ["http://[fd00:ec2::254]", true],
    ["http://localhost:11434", false],
  ] as const) {
    check(url, isMetadataUrl(url), expected);
  }

  console.log("isExternalUrl");
  for (const [url, expected] of [
    ["http://localhost:11434", false],
    ["http://ollama:11434", false],
    ["http://192.168.1.20:11434", false],
    ["http://10.0.0.5", false],
    ["http://172.20.0.1", false],
    ["http://100.100.1.1", false],
    ["http://nas.local:11434", false],
    ["http://[::1]:11434", false],
    ["http://[fd00::1]", false],
    ["http://169.254.10.1", false],
    ["http://0.0.0.0:11434", false],
    ["https://api.openai.com/v1", true],
    ["http://8.8.8.8", true],
    ["http://[2001:db8::1]", true],
    ["http://fcbox.example.com", true],
  ] as const) {
    check(url, isExternalUrl(url), expected);
  }

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); server.close(); process.exit(1); });
