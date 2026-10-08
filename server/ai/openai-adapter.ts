import type { AiAdapter, AiMessage, AiToolCall, ChatRequest } from "./provider";
import { getJson, postJson, readLines } from "./http";

// OpenAI-compatible API: /models, /chat/completions (SSE), /embeddings.
// The provider's base URL includes the version prefix (e.g. https://api.openai.com/v1).

type OpenAiToolCall = { id?: string; index?: number; type?: string; function?: { name?: string; arguments?: string } };

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function fromOpenAiToolCalls(calls: OpenAiToolCall[] | undefined): AiToolCall[] {
  return (calls ?? []).map((c) => ({
    id: c.id,
    function: { name: c.function?.name ?? "", arguments: parseArgs(c.function?.arguments) },
  }));
}

/**
 * Convert canonical (Ollama-shaped) messages. Histories recorded against
 * Ollama may lack tool-call ids, which OpenAI requires, so missing ids are
 * minted and handed to the following tool messages in order.
 */
function toOpenAiMessages(messages: AiMessage[]) {
  const pendingIds: string[] = [];
  return messages.map((m, i) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.tool_call_id || pendingIds.shift() || `call_${i}`, content: m.content };
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      pendingIds.length = 0;
      const tool_calls = m.tool_calls.map((tc, j) => {
        const id = tc.id || `call_${i}_${j}`;
        pendingIds.push(id);
        return { id, type: "function", function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments ?? {}) } };
      });
      return { role: "assistant", content: m.content || "", tool_calls };
    }
    if (m.images?.length) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          ...m.images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

function chatBody(req: ChatRequest, stream: boolean) {
  return {
    model: req.model,
    messages: toOpenAiMessages(req.messages),
    stream,
    ...(req.tools?.length ? { tools: req.tools } : {}),
    ...(req.format === "json" ? { response_format: { type: "json_object" } } : {}),
    ...(req.format && req.format !== "json"
      ? { response_format: { type: "json_schema", json_schema: { name: "response", schema: req.format } } }
      : {}),
  };
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  return (err as { message?: string })?.message ?? JSON.stringify(err);
}

export const openaiAdapter: AiAdapter = {
  async listModels(p) {
    try {
      const data = await getJson<{ data?: { id: string }[] }>(p, "/models");
      return (data.data ?? []).map((m) => ({ name: m.id, parameterSize: null })).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err: any) {
      // Some servers don't implement /models; the model box still accepts typed names.
      if (/ returned 404/.test(err?.message ?? "")) return [];
      throw err;
    }
  },

  async chat(p, req) {
    const resp = await postJson(p, "/chat/completions", chatBody(req, false), req.signal);
    const data = (await resp.json()) as { choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }[]; error?: unknown };
    if (data.error) throw new Error(errorText(data.error));
    const msg = data.choices?.[0]?.message;
    return { content: msg?.content ?? "", toolCalls: fromOpenAiToolCalls(msg?.tool_calls) };
  },

  async *chatStream(p, req) {
    const resp = await postJson(p, "/chat/completions", chatBody(req, true), req.signal);
    // Tool-call deltas arrive in fragments keyed by index; assemble, then emit once.
    // Some servers omit `index` on follow-up fragments: those continue the
    // current call, and an unindexed fragment with a new id starts the next one.
    const calls: { id?: string; name: string; args: string }[] = [];
    let current = 0;
    for await (const line of readLines(resp)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") break;
      let parsed: { choices?: { delta?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }[]; error?: unknown };
      try { parsed = JSON.parse(payload); } catch { continue; }
      if (parsed.error) throw new Error(errorText(parsed.error));
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) yield { content: delta.content };
      for (const tc of delta?.tool_calls ?? []) {
        if (tc.index !== undefined) current = tc.index;
        else if (tc.id && calls[current]?.id && calls[current].id !== tc.id) current = calls.length;
        const slot = (calls[current] ??= { name: "", args: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }
    const toolCalls = calls.filter(Boolean).map((c) => ({ id: c.id, function: { name: c.name, arguments: parseArgs(c.args) } }));
    if (toolCalls.length) yield { toolCalls };
  },

  async embed(p, model, text, signal) {
    const resp = await postJson(p, "/embeddings", { model, input: text }, signal ?? AbortSignal.timeout(30000));
    const data = (await resp.json()) as { data?: { embedding?: number[] }[] };
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`${p.name} returned an empty embedding. The selected model may not support embeddings.`);
    }
    return embedding;
  },
};
