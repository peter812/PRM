import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerRoutes as registerAuthSetup } from "./routes/auth-setup";
import { registerRoutes as registerPeopleGroups } from "./routes/people-groups";
import { registerRoutes as registerSocialMedia } from "./routes/social-media";
import { registerRoutes as registerAiVector } from "./routes/ai-vector";
import { registerRoutes as registerFamily } from "./routes/family";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register sub-route modules
  registerAuthSetup(app);
  registerPeopleGroups(app);
  registerSocialMedia(app);
  registerAiVector(app);
  registerFamily(app);

  const httpServer = createServer(app);
  return httpServer;
}
