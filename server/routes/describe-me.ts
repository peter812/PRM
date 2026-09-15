/**
 * Describe Me game: serve a random person (90-day cooldown), turn a spoken
 * description into bullet points with Ollama, and save them as a note.
 * Transcription itself reuses POST /api/daily-notes/transcribe.
 */
import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { syncEntityInBackground } from "../vector-universal";
import { extractJsonObject } from "../family-tree-ai";
import { buildOllamaChatContext, getOllamaTextModel } from "./people-groups";

const MAX_BULLETS = 30;
const TIMEOUT_MS = 2 * 60 * 1000;

const SYSTEM_PROMPT = `You turn a spoken, informal description of a person into concise bullet points for their contact profile.
Respond with ONLY a JSON object, no prose: {"bullets": string[]}
Each bullet is one concrete fact or trait about the person, written in third person, present tense, without filler.
Keep the speaker's specific wording (names, places, numbers). Do not repeat a fact. Drop anything that is not about the person.`;

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

  // POST /api/describe-me/extract — transcript → bullet points
  app.post("/api/describe-me/extract", async (req, res) => {
    try {
      const { personId, transcript } = z.object({ personId: z.string().min(1), transcript: z.string().trim().min(1) }).parse(req.body);
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
        headers: ollama.headers,
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `The person being described is ${person.firstName} ${person.lastName}.\n\nDescription:\n${transcript}` },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`Ollama returned ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);

      const raw = extractJsonObject((await resp.json())?.message?.content ?? "") as { bullets?: unknown } | null;
      if (!raw || !Array.isArray(raw.bullets)) throw new Error("The model did not return a usable answer");
      const bullets = raw.bullets
        .filter((b): b is string => typeof b === "string")
        .map((b) => b.trim().replace(/^[-•*]\s*/, ""))
        .filter(Boolean)
        .slice(0, MAX_BULLETS);
      res.json({ bullets });
    } catch (error: any) {
      console.error("Error extracting bullets:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: error?.message || "Failed to extract bullet points" });
    }
  });

  // POST /api/describe-me/save — write the note and start the cooldown in one request
  app.post("/api/describe-me/save", async (req, res) => {
    try {
      const { personId, bullets } = z.object({
        personId: z.string().min(1),
        bullets: z.array(z.string().trim().min(1)).min(1).max(MAX_BULLETS),
      }).parse(req.body);
      if (!(await storage.getPersonById(personId))) return res.status(404).json({ error: "Person not found" });

      const note = await storage.createNote({
        personId,
        userId: req.user!.id,
        content: `${bullets.map((b) => `- ${b}`).join("\n")}\n\n(describe me)`,
      });
      await storage.updatePerson(personId, { lastDescribedAt: new Date() });
      syncEntityInBackground("note", note.id);
      res.status(201).json({ note });
    } catch (error: any) {
      console.error("Error saving description:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: "Failed to save description" });
    }
  });
}
