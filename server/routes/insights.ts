// Insights route module - insights.ts
//
// Read/delete access to the insights table for the Insights tab on person and
// social-account profiles. Insights are only ever written by automated
// collectors (see osint-scan-queue.ts), so there is no create endpoint.
import type { Express } from "express";
import { storage } from "../storage";

export function registerRoutes(app: Express) {
  app.get("/api/social-accounts/:id/insights", async (req, res) => {
    try {
      res.json(await storage.getInsightsForSocialAccount(req.params.id));
    } catch (error) {
      console.error("Error fetching insights:", error);
      res.status(500).json({ error: "Failed to fetch insights" });
    }
  });

  app.get("/api/people/:id/insights", async (req, res) => {
    try {
      res.json(await storage.getInsightsForPerson(req.params.id));
    } catch (error) {
      console.error("Error fetching insights:", error);
      res.status(500).json({ error: "Failed to fetch insights" });
    }
  });

  app.delete("/api/insights/:id", async (req, res) => {
    try {
      if (!(await storage.deleteInsight(req.params.id))) {
        return res.status(404).json({ error: "Insight not found" });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting insight:", error);
      res.status(500).json({ error: "Failed to delete insight" });
    }
  });
}
