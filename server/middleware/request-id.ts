import type { Request, Response, NextFunction } from "express";

/**
 * Middleware that assigns a unique request ID to every API request.
 * If the client sends an X-Request-ID header, it is preserved;
 * otherwise a new one is generated.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }

  const requestId = (req.headers["x-request-id"] as string) ||
    `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Store on request for use by other middleware/handlers
  (req as any).requestId = requestId;

  // Echo the request ID back in the response
  res.setHeader("X-Request-ID", requestId);

  next();
}
