import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * ETag caching middleware for specific API endpoints.
 * Generates an ETag from the response body and supports If-None-Match
 * for conditional requests, returning 304 Not Modified when appropriate.
 */
export function etagMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply to routes that benefit from caching
  if (!shouldApplyEtag(req)) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    // Generate ETag from the response body
    const bodyStr = JSON.stringify(body);
    const hash = crypto.createHash("sha256").update(bodyStr).digest("hex").slice(0, 32);
    const etag = `"${hash}"`;

    res.setHeader("ETag", etag);

    // Check If-None-Match header
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.status(304).end();
      return res;
    }

    return originalJson(body);
  };

  next();
}

function shouldApplyEtag(req: Request): boolean {
  // Apply to GET and POST requests on specific v1 endpoints
  const etagPaths = [
    "/api/v1/social-accounts/search",
    "/api/v1/ping",
  ];

  // Also apply to any GET request on /api/v1/
  if (req.method === "GET" && req.path.startsWith("/api/v1/")) {
    return true;
  }

  // Apply to specific POST endpoints
  if (req.method === "POST" && etagPaths.includes(req.path)) {
    return true;
  }

  return false;
}
