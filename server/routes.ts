import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerRoutes as registerAuthSetup } from "./routes/auth-setup";
import { registerRoutes as registerPeopleGroups } from "./routes/people-groups";
import { registerRoutes as registerSocialMedia } from "./routes/social-media";
import { registerRoutes as registerAiVector } from "./routes/ai-vector";
import { registerRoutes as registerFamily } from "./routes/family";
import { registerRoutes as registerMessages } from "./routes/messages";
import { registerRoutes as registerOsint } from "./routes/osint";
import { registerRoutes as registerTps } from "./routes/tps";
import { registerRoutes as registerBackups } from "./routes/backups";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register sub-route modules.
  // IMPORTANT: registerAuthSetup MUST stay first — it installs the global
  // app.use("/api", ...) authentication gate that protects every /api route in
  // all modules registered after it (including family, which has no gate).
  registerAuthSetup(app);
  registerPeopleGroups(app);
  registerSocialMedia(app);
  // TPS uses extension-token auth (no browser session), so it MUST be registered
  // before registerMessages — that module mounts a catch-all router at
  // app.use("/api", ...) whose gate rejects any non-session request with 401
  // "Unauthorized", which would otherwise shadow every /api/v1/tps/* route.
  registerTps(app);
  registerAiVector(app);
  registerFamily(app);
  registerMessages(app);
  registerOsint(app);
  registerBackups(app);

  const httpServer = createServer(app);
  return httpServer;
}
