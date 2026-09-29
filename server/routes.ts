import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerRoutes as registerAuthSetup } from "./routes/auth-setup";
import { registerRoutes as registerPeopleGroups } from "./routes/people-groups";
import { registerRoutes as registerSocialMedia } from "./routes/social-media";
import { registerRoutes as registerAiVector } from "./routes/ai-vector";
import { registerRoutes as registerFamily } from "./routes/family";
import { registerRoutes as registerMessages } from "./routes/messages";
import { registerRoutes as registerOsint } from "./routes/osint";
import { registerRoutes as registerInsights } from "./routes/insights";
import { registerRoutes as registerTps } from "./routes/tps";
import { registerPendingImportsRoutes } from "./routes/pending-imports";
import { registerStories } from "./routes/stories";
import { registerTracking } from "./routes/tracking";
import { registerAccountIssues } from "./routes/account-issues";
import { registerFaceReview } from "./routes/face-review";
import { registerFaces } from "./routes/faces";
import { registerConnections } from "./routes/connections";
import { registerRoutes as registerBackups } from "./routes/backups";
import { registerRoutes as registerDescribeMe } from "./routes/describe-me";
import { registerRoutes as registerDemosMap } from "./routes/demos-map";
import { registerRoutes as registerDemosWordCloud } from "./routes/demos-word-cloud";
import { registerSetupServicesRoutes } from "./routes/setup-services";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register sub-route modules.
  // IMPORTANT: registerAuthSetup MUST stay first — it installs the global
  // app.use("/api", ...) authentication gate that protects every /api route in
  // all modules registered after it (including family, which has no gate).
  registerAuthSetup(app);
  // Family before people-groups: its static /api/family-tree/potential-families
  // would otherwise be captured by people-groups' /api/family-tree/:personId.
  registerFamily(app);
  registerPeopleGroups(app);
  registerSocialMedia(app);
  // TPS and pending-imports use extension-token auth (no browser session), so they MUST be registered
  // before registerMessages — that module mounts a catch-all router at
  // app.use("/api", ...) whose gate rejects any non-session request with 401
  // "Unauthorized", which would otherwise shadow every /api/v1/* route.
  registerTps(app);
  registerPendingImportsRoutes(app);
  registerStories(app);
  registerTracking(app);
  registerAccountIssues(app);
  registerFaceReview(app);
  registerFaces(app);
  registerConnections(app);
  registerAiVector(app);
  registerMessages(app);
  registerOsint(app);
  registerInsights(app);
  registerBackups(app);
  registerDescribeMe(app);
  registerDemosMap(app);
  registerDemosWordCloud(app);
  registerSetupServicesRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
