/**
 * Find My Name — asks an Ollama LLM who an unlinked phone number belongs to,
 * from the first messages of a thread (where people tend to introduce
 * themselves). Pure guess; the caller decides what to do with it.
 */
import { extractJsonObject } from "./family-tree-ai";

export interface NameGuess {
  firstName: string | null;
  lastName: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

const TIMEOUT_MS = 2 * 60 * 1000;

const SYSTEM_PROMPT = `You identify the real name of the person behind an unknown phone number from the opening messages of a text conversation.
Look for introductions ("Hi, it's Sarah from the gym"), sign-offs, how the owner addresses them, and names others use for them.
Respond with ONLY a JSON object, no prose:
{"firstName": string|null, "lastName": string|null, "confidence": "high"|"medium"|"low", "reason": string}
Use null for any part of the name the messages do not support. Keep "reason" to one sentence quoting the decisive message.`;

export async function guessNameFromMessages(params: {
  ollama: { base: string; headers: Record<string, string> };
  model: string;
  /** Messages already rendered as "[sender]: text" lines, oldest first */
  lines: string[];
  /** Name the backup owner's phone had saved for the number, if any */
  contactName: string | null;
}): Promise<NameGuess> {
  const { ollama, model, lines, contactName } = params;
  const userPrompt = [
    `Unknown number label: "[them]". The owner of the phone is "[me]".`,
    contactName ? `The owner's phone had this number saved as "${contactName}".` : null,
    "",
    "First messages of the conversation:",
    ...lines,
  ].filter((l) => l !== null).join("\n");

  const resp = await fetch(`${ollama.base}/api/chat`, {
    method: "POST",
    headers: { ...ollama.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Ollama returned ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);

  const raw = extractJsonObject((await resp.json())?.message?.content ?? "") as Partial<NameGuess> | null;
  if (!raw) throw new Error("The model did not return a usable answer");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    firstName: str(raw.firstName),
    lastName: str(raw.lastName),
    confidence: raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low",
    reason: str(raw.reason) ?? "",
  };
}
