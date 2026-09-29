/**
 * Describe Me game: serve a random person (90-day cooldown), turn a spoken
 * description into rich potential interactions, notes, and tags using LLM tools/hooks,
 * and selectively apply them to the person's profile.
 * Transcription itself reuses POST /api/daily-notes/transcribe.
 */
import type { Express } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { syncEntityInBackground } from "../vector-universal";
import { extractJsonObject } from "../family-tree-ai";
import { buildOllamaChatContext, getOllamaTextModel } from "./people-groups";
import {
  applyDescribeMeSchema,
  isAdminRole,
  type PotentialInteraction,
  type PotentialNote,
  type PotentialTag,
  type DescribeMeExtractionResult,
} from "@shared/schema";

const TIMEOUT_MS = 2 * 60 * 1000;

export const DESCRIBE_ME_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_potential_interaction",
      description:
        "Propose an interaction, event, meeting, call, meal, or conversation that occurred with or involved this person. Call this whenever a specific event or past encounter is mentioned in the description.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short summary/title of the interaction (e.g. 'Coffee at Starbucks', 'Catch-up phone call', 'Lunch meeting').",
          },
          date: {
            type: "string",
            description: "ISO-8601 date string (YYYY-MM-DD or full timestamp) when the interaction took place. If relative (e.g. 'yesterday' or 'last Tuesday'), resolve against today's date.",
          },
          description: {
            type: "string",
            description: "Detailed summary of what was discussed, what happened, or key takeaways.",
          },
          type: {
            type: "string",
            description: "Optional interaction type (e.g. 'Meeting', 'Call', 'Coffee', 'Meal', 'Event', 'Chat').",
          },
        },
        required: ["title", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_potential_note",
      description:
        "Propose a note (facts, background information, personal traits, preferences, career, family details) about this person to add to their profile.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Optional title or category for the note (e.g. 'Background & Hobbies', 'Career', 'Preferences').",
          },
          content: {
            type: "string",
            description: "Note body or bullet points written in third person, concise, present tense, without conversational filler.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_potential_tags",
      description:
        "Propose relevant keyword tags or labels for this person based on what was described (e.g. skills, hobbies, locations, roles, affiliations).",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Array of concise keyword tags (e.g. ['marathon', 'ux-designer', 'duluth', 'dog-lover']).",
          },
        },
        required: ["tags"],
      },
    },
  },
];

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0];
  return `You analyze a spoken, informal description of a person and extract structured information for their contact profile.
Today's date is ${today}.

You have 3 tools to propose updates for this person:
1. create_potential_interaction: Call for any interactions, meetings, conversations, or events mentioned (resolve relative dates like "yesterday", "last weekend" using today's date: ${today}).
2. create_potential_note: Call for general facts, personal background, preferences, hobbies, and traits (write in third person, concise, no conversational filler).
3. create_potential_tags: Call to propose keyword tags (skills, roles, locations, hobbies).

Call all relevant tools. If your environment does not support native function/tool calling, respond with ONLY a JSON object:
{
  "interactions": [ { "title": "...", "date": "YYYY-MM-DD", "description": "...", "type": "..." } ],
  "notes": [ { "title": "...", "content": "..." } ],
  "tags": [ "tag1", "tag2" ]
}`;
}

export function parseExtractionResponse(rawResponse: any, transcript: string): DescribeMeExtractionResult & { bullets: string[] } {
  const potentialInteractions: PotentialInteraction[] = [];
  const potentialNotes: PotentialNote[] = [];
  const potentialTags: PotentialTag[] = [];

  const rawToolCalls = rawResponse?.message?.tool_calls;
  if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
    for (const tc of rawToolCalls) {
      const fnName = tc.function?.name;
      let args = tc.function?.arguments;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      if (!args || typeof args !== "object") continue;

      if (fnName === "create_potential_interaction") {
        const title = typeof args.title === "string" ? args.title.trim() : "";
        const date = typeof args.date === "string" && args.date.trim() ? args.date.trim() : new Date().toISOString().split("T")[0];
        const description = typeof args.description === "string" ? args.description.trim() : "";
        const type = typeof args.type === "string" ? args.type.trim() : undefined;
        if (title || description) {
          potentialInteractions.push({
            id: crypto.randomUUID(),
            title: title || "Interaction",
            date,
            description,
            type,
            selected: true,
          });
        }
      } else if (fnName === "create_potential_note") {
        const content = typeof args.content === "string" ? args.content.trim() : "";
        const title = typeof args.title === "string" ? args.title.trim() : undefined;
        if (content) {
          potentialNotes.push({
            id: crypto.randomUUID(),
            title: title || undefined,
            content,
            selected: true,
          });
        }
      } else if (fnName === "create_potential_tags") {
        const tags = Array.isArray(args.tags) ? args.tags : [];
        for (const t of tags) {
          if (typeof t === "string" && t.trim()) {
            potentialTags.push({
              id: crypto.randomUUID(),
              tag: t.trim().toLowerCase(),
              selected: true,
            });
          }
        }
      }
    }
  }

  // Also check message.content if tool calls were empty or returned nothing
  const contentStr = rawResponse?.message?.content ?? "";
  if (potentialInteractions.length === 0 && potentialNotes.length === 0 && potentialTags.length === 0 && contentStr) {
    const json = extractJsonObject(contentStr) as any;
    if (json && typeof json === "object") {
      // Check if json contains tool_calls
      if (Array.isArray(json.tool_calls)) {
        return parseExtractionResponse({ message: { tool_calls: json.tool_calls } }, transcript);
      }
      // Check interactions
      if (Array.isArray(json.interactions)) {
        for (const item of json.interactions) {
          if (item && typeof item === "object") {
            const title = typeof item.title === "string" ? item.title.trim() : "";
            const date = typeof item.date === "string" && item.date.trim() ? item.date.trim() : new Date().toISOString().split("T")[0];
            const description = typeof item.description === "string" ? item.description.trim() : "";
            const type = typeof item.type === "string" ? item.type.trim() : undefined;
            if (title || description) {
              potentialInteractions.push({
                id: crypto.randomUUID(),
                title: title || "Interaction",
                date,
                description,
                type,
                selected: true,
              });
            }
          }
        }
      }
      // Check notes
      if (Array.isArray(json.notes)) {
        for (const item of json.notes) {
          if (item && typeof item === "object") {
            const content = typeof item.content === "string" ? item.content.trim() : "";
            const title = typeof item.title === "string" ? item.title.trim() : undefined;
            if (content) {
              potentialNotes.push({
                id: crypto.randomUUID(),
                title: title || undefined,
                content,
                selected: true,
              });
            }
          } else if (typeof item === "string" && item.trim()) {
            potentialNotes.push({
              id: crypto.randomUUID(),
              content: item.trim(),
              selected: true,
            });
          }
        }
      }
      // Check tags
      if (Array.isArray(json.tags)) {
        for (const t of json.tags) {
          if (typeof t === "string" && t.trim()) {
            potentialTags.push({
              id: crypto.randomUUID(),
              tag: t.trim().toLowerCase(),
              selected: true,
            });
          }
        }
      }
      // Check bullets (legacy compatibility)
      if (potentialNotes.length === 0 && Array.isArray(json.bullets)) {
        const bullets = json.bullets.filter((b: any): b is string => typeof b === "string" && b.trim().length > 0);
        if (bullets.length > 0) {
          potentialNotes.push({
            id: crypto.randomUUID(),
            content: bullets.map((b: string) => `- ${b.trim().replace(/^[-•*]\s*/, "")}`).join("\n"),
            selected: true,
          });
        }
      }
    }
  }

  // Deduplicate tags by tag name
  const seenTags = new Set<string>();
  const uniqueTags: PotentialTag[] = [];
  for (const pt of potentialTags) {
    const lower = pt.tag.toLowerCase();
    if (!seenTags.has(lower)) {
      seenTags.add(lower);
      uniqueTags.push(pt);
    }
  }

  // Fallback: if nothing was extracted at all, provide a single note proposal with the transcript
  if (potentialInteractions.length === 0 && potentialNotes.length === 0 && uniqueTags.length === 0 && transcript.trim()) {
    potentialNotes.push({
      id: crypto.randomUUID(),
      content: transcript.trim(),
      selected: true,
    });
  }

  const legacyBullets = potentialNotes.flatMap((n) =>
    n.content
      .split("\n")
      .map((line) => line.trim().replace(/^[-•*]\s*/, ""))
      .filter(Boolean)
  );

  return {
    potentialInteractions,
    potentialNotes,
    potentialTags: uniqueTags,
    transcript,
    bullets: legacyBullets,
  };
}

export function registerRoutes(app: Express) {
  // GET /api/describe-me/next?exclude=id,id — random eligible person, or null when everyone is on cooldown
  app.get("/api/describe-me/next", async (req, res) => {
    try {
      const exclude = String(req.query.exclude ?? "").split(",").filter(Boolean);
      const person = await storage.getRandomDescribablePerson(exclude);
      res.json({ person: person ?? null });
    } catch (error) {
      console.error("Error picking person to describe:", error);
      res.status(500).json({ error: "Failed to pick a person" });
    }
  });

  // POST /api/describe-me/extract — transcript → potential interactions, notes, and tags
  app.post("/api/describe-me/extract", async (req, res) => {
    try {
      const { personId, transcript } = z.object({
        personId: z.string().min(1),
        transcript: z.string().trim().min(1),
      }).parse(req.body);

      const person = await storage.getPersonById(personId);
      if (!person) return res.status(404).json({ error: "Person not found" });

      if ((await storage.getAppSetting("ollama_enabled")) !== "true") {
        return res.status(400).json({ error: "AI is disabled in settings" });
      }
      const ollama = await buildOllamaChatContext();
      if (!ollama) return res.status(400).json({ error: "Ollama API URL is not configured" });
      const model = await getOllamaTextModel();
      if (!model) return res.status(400).json({ error: "No AI model configured. Set one at Settings → Intelligence." });

      const resp = await fetch(`${ollama.base}/api/chat`, {
        method: "POST",
        headers: { ...ollama.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          tools: DESCRIBE_ME_TOOLS,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: `The person being described is ${person.firstName} ${person.lastName}.\n\nDescription:\n${transcript}` },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!resp.ok) {
        throw new Error(`Ollama returned ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
      }

      const rawJson = await resp.json();
      const result = parseExtractionResponse(rawJson, transcript);
      res.json(result);
    } catch (error: any) {
      console.error("Error extracting description details:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: error?.message || "Failed to extract details from description" });
    }
  });

  // POST /api/describe-me/apply and POST /api/describe-me/save — write approved notes/interactions/tags and start cooldown
  const handleApply = async (req: any, res: any) => {
    try {
      const data = applyDescribeMeSchema.parse(req.body);
      const person = await storage.getPersonById(data.personId);
      if (!person) return res.status(404).json({ error: "Person not found" });

      if (person.createdByUserId && person.createdByUserId !== req.user?.id && !isAdminRole((req.user as any)?.role)) {
        return res.status(403).json({ error: "Not authorized to update this person" });
      }

      const userId = req.user?.id;
      const mePerson = userId ? await storage.getMePerson(userId) : undefined;
      const allIntTypes = await storage.getAllInteractionTypes();

      let notesCount = 0;
      let interactionsCount = 0;
      let tagsCount = 0;

      // 1. Create notes
      for (const note of data.notes) {
        if (!note.content?.trim()) continue;
        const noteContent = note.title
          ? `${note.title}\n\n${note.content.trim()}\n\n(describe me)`
          : `${note.content.trim()}\n\n(describe me)`;
        const created = await storage.createNote({
          personId: data.personId,
          userId,
          content: noteContent,
        });
        syncEntityInBackground("note", created.id);
        notesCount++;
      }

      // Legacy bullets support
      if (data.bullets && data.bullets.length > 0) {
        const created = await storage.createNote({
          personId: data.personId,
          userId,
          content: `${data.bullets.map((b) => `- ${b}`).join("\n")}\n\n(describe me)`,
        });
        syncEntityInBackground("note", created.id);
        notesCount++;
      }

      // 2. Create interactions
      for (const interaction of data.interactions) {
        let typeId = interaction.typeId;
        if (!typeId && interaction.type) {
          const match = allIntTypes.find((t) => t.name.toLowerCase() === interaction.type!.toLowerCase());
          if (match) typeId = match.id;
        }

        const peopleIds = [data.personId];
        if (mePerson && mePerson.id !== data.personId) {
          peopleIds.push(mePerson.id);
        }

        const dateObj = new Date(interaction.date);
        const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;

        const created = await storage.createInteraction({
          peopleIds,
          date: validDate,
          title: interaction.title?.trim() || undefined,
          description: interaction.description?.trim() || undefined,
          typeId: typeId || undefined,
          createdByUserId: userId,
        });
        syncEntityInBackground("interaction", created.id);
        interactionsCount++;
      }

      // 3. Update tags
      let updatedTags = person.tags || [];
      if (data.tags && data.tags.length > 0) {
        const existingSet = new Set((person.tags || []).map((t) => t.toLowerCase()));
        const merged = [...(person.tags || [])];
        for (const t of data.tags) {
          const trimmed = t.trim();
          if (trimmed && !existingSet.has(trimmed.toLowerCase())) {
            existingSet.add(trimmed.toLowerCase());
            merged.push(trimmed);
            tagsCount++;
          }
        }
        updatedTags = merged;
      }

      // Always update person cooldown timestamp (and merged tags)
      await storage.updatePerson(data.personId, {
        tags: updatedTags,
        lastDescribedAt: new Date(),
      });

      res.status(200).json({
        success: true,
        applied: {
          notes: notesCount,
          interactions: interactionsCount,
          tags: tagsCount,
        },
      });
    } catch (error: any) {
      console.error("Error applying describe me:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: error?.message || "Failed to apply description" });
    }
  };

  app.post("/api/describe-me/apply", handleApply);
  app.post("/api/describe-me/save", handleApply);
}

