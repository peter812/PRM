/**
 * Find My Name — asks the text model who an unlinked phone number belongs to,
 * from the first messages of a thread (where people tend to introduce
 * themselves). Pure guess; the caller decides what to do with it.
 */
import { extractJsonObject } from "./json-extract";
import { asData, chat, DATA_TAGS_NOTE, type ResolvedModel } from "./ai/provider";
import { getPrompt } from "./prompts";

export interface NameGuess {
  firstName: string | null;
  lastName: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

const TIMEOUT_MS = 2 * 60 * 1000;

export async function guessNameFromMessages(params: {
  resolved: ResolvedModel;
  /** Messages already rendered as "[sender]: text" lines, oldest first */
  lines: string[];
  /** Name the backup owner's phone had saved for the number, if any */
  contactName: string | null;
}): Promise<NameGuess> {
  const { resolved, lines, contactName } = params;
  const userPrompt = [
    `Unknown number label: "[them]". The owner of the phone is "[me]".`,
    contactName ? `The owner's phone had this number saved as:\n${asData("contact_name", contactName)}` : null,
    "",
    "First messages of the conversation:",
    asData("messages", lines.join("\n")),
  ].filter((l) => l !== null).join("\n");

  const { content } = await chat(resolved, {
    format: "json",
    messages: [
      { role: "system", content: `${await getPrompt("findName")}\n${DATA_TAGS_NOTE}` },
      { role: "user", content: userPrompt },
    ],
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = extractJsonObject(content) as Partial<NameGuess> | null;
  if (!raw) throw new Error("The model did not return a usable answer");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    firstName: str(raw.firstName),
    lastName: str(raw.lastName),
    confidence: raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low",
    reason: str(raw.reason) ?? "",
  };
}
