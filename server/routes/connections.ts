// The Connections tab on a social account (connection-strength-plan.md).
import type { Express } from "express";
import { requireAuth } from "../auth";
import { getConnections } from "../connection-strength";

export function registerConnections(app: Express) {
  app.get("/api/social-accounts/:id/connections", requireAuth, async (req, res) => {
    try {
      const result = await getConnections(req.params.id);
      if (!result) return res.status(404).json({ error: "Social account not found" });
      res.json(result);
    } catch (error) {
      console.error("Connections: failed to score:", error);
      res.status(500).json({ error: "Failed to load connections" });
    }
  });
}
