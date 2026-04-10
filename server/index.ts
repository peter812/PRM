import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { setupAuth } from "./auth";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db-init";
import { startTaskWorker } from "./task-worker";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { etagMiddleware } from "./middleware/etag-cache";
import { requestIdMiddleware } from "./middleware/request-id";

const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

// --- Upgrade #10: Response compression (gzip/br) ---
// Compress responses with body size >= 1KB
app.use(compression({ threshold: 1024 }));

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// --- Upgrade #8 (partial): Request ID middleware ---
app.use(requestIdMiddleware);

// --- Upgrade #3: Rate limiting headers ---
app.use(rateLimitMiddleware);

// --- Upgrade #4: ETag / If-None-Match caching ---
app.use(etagMiddleware);

// Setup auth after body parsers
setupAuth(app);

// Middleware to bypass auth if DISABLE_AUTH is set
app.use((req, res, next) => {
  if (process.env.DISABLE_AUTH === 'true') {
    // Mock authenticated user for development
    if (!req.isAuthenticated()) {
      (req as any).user = { id: 1, username: 'dev', name: 'Developer', nickname: 'Dev' };
    }
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize database (reset if no users exist)
  await initializeDatabase();

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const requestId = (_req as any).requestId || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Use structured error format for API requests
    if (_req.path.startsWith("/api")) {
      res.status(status).json({
        error: {
          code: status === 404 ? "NOT_FOUND" : status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
          message,
          details: {},
          request_id: requestId,
        },
      });
    } else {
      res.status(status).json({ message });
    }
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    startTaskWorker();
  });
})();
