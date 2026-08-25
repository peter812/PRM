import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * ETag caching for the handful of read-mostly API endpoints that benefit from
 * it. Generates an ETag from the response body and honours If-None-Match,
 * returning 304 Not Modified when the client already has the current body.
 *
 * Deliberately an ALLOWLIST, not "every GET under /api/v1/". A blanket rule
 * swept in mutable list endpoints such as /api/v1/pending-imports, where a
 * conditional revalidation that reaches application code surfaces as a bare
 * 304 — and the client's apiRequest() treats any non-2xx as a failure, so the
 * page throws instead of rendering. Only add a path here if its response is
 * safe to serve from a cache the server cannot invalidate.
 */

/** Exact paths that may be conditionally cached, by method (GET / HEAD only). */
const ETAG_GET_PATHS: ReadonlySet<string> = new Set([
  "/api/v1/ping",
  "/api/v1/url-list",
]);

export function etagMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply to safe, idempotent GET/HEAD routes that benefit from caching
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
    res.setHeader("Vary", "Cookie, Authorization");
    res.setHeader("Cache-Control", "private, no-cache");

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
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  return ETAG_GET_PATHS.has(req.path);
}
