import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

const REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Middleware that assigns a unique request ID to every API request.
 * If the client sends a valid X-Request-ID header, it is preserved;
 * otherwise a new server-side UUID is generated.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }

  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && REQUEST_ID_REGEX.test(incoming)
      ? incoming
      : randomUUID();

  // Store on request for use by other middleware/handlers
  (req as any).requestId = requestId;

  // Echo the request ID back in the response
  res.setHeader("X-Request-ID", requestId);

  next();
}
