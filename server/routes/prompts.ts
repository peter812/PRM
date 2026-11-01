import type { Express } from "express";
import { z } from "zod";
import { PROMPT_SECTIONS, isPromptKey, listPrompts, setPrompt } from "../prompts";
import { invalidateSummarySettingsCache } from "../summary-queue";

export function registerPromptRoutes(app: Express) {
  app.get("/api/prompts", async (_req, res) => {
    try {
      res.json({ sections: PROMPT_SECTIONS, prompts: await listPrompts() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load prompts" });
    }
  });

  app.put("/api/prompts/:key", async (req, res) => {
    try {
      const { key } = req.params;
      if (!isPromptKey(key)) return res.status(404).json({ error: "Unknown prompt" });
      const parsed = z.object({ value: z.string().trim().min(1).max(20_000) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Prompt text is required (up to 20,000 characters)" });
      await setPrompt(key, parsed.data.value);
      // Summary runs read their prompts through the cached summary settings.
      invalidateSummarySettingsCache();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save prompt" });
    }
  });
}
