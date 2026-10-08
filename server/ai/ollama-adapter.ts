import type { AiAdapter, AiMessage, AiToolCall, ChatRequest } from "./provider";
import { getJson, postJson, readLines } from "./http";

// Native Ollama API: /api/tags, /api/chat (NDJSON), /api/embeddings.

function chatBody(req: ChatRequest, stream: boolean) {
  return {
    model: req.model,
    messages: req.messages.map((m: AiMessage) => ({ ...m, ...(m.role === "tool" && m.name ? { tool_name: m.name } : {}) })),
    stream,
    options: { num_predict: -1 },
    ...(req.tools?.length ? { tools: req.tools } : {}),
    ...(req.format ? { format: req.format } : {}),
    ...(req.think !== undefined ? { think: req.think } : {}),
  };
}

type OllamaChatLine = { message?: { content?: string; tool_calls?: AiToolCall[] }; error?: string };

export const ollamaAdapter: AiAdapter = {
  async listModels(p) {
    const data = await getJson<{ models?: { name: string; details?: { parameter_size?: string } }[] }>(p, "/api/tags");
    return (data.models ?? []).map((m) => ({ name: m.name, parameterSize: m.details?.parameter_size ?? null }));
  },

  async chat(p, req) {
    const resp = await postJson(p, "/api/chat", chatBody(req, false), req.signal);
    const data = (await resp.json()) as OllamaChatLine;
    if (data.error) throw new Error(data.error);
    return { content: data.message?.content ?? "", toolCalls: data.message?.tool_calls ?? [] };
  },

  async *chatStream(p, req) {
    const resp = await postJson(p, "/api/chat", chatBody(req, true), req.signal);
    for await (const line of readLines(resp)) {
      let parsed: OllamaChatLine;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (parsed.error) throw new Error(parsed.error);
      const msg = parsed.message;
      if (msg?.tool_calls?.length) yield { toolCalls: msg.tool_calls };
      else if (msg?.content) yield { content: msg.content };
    }
  },

  async embed(p, model, text, signal) {
    const resp = await postJson(p, "/api/embeddings", { model, prompt: text }, signal ?? AbortSignal.timeout(30000));
    const data = (await resp.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error(`${p.name} returned an empty embedding. The selected model may not support embeddings.`);
    }
    return data.embedding;
  },
};
