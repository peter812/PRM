import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 100; // 100 requests per window

function getClientKey(req: Request): string {
  // Use user ID if authenticated, otherwise fall back to IP
  if (req.isAuthenticated() && req.user) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  const keys = Array.from(rateLimitStore.keys());
  for (const key of keys) {
    const entry = rateLimitStore.get(key);
    if (entry && now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply to /api routes
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }

  const key = getClientKey(req);
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    entry = {
      count: 0,
      resetAt: now + WINDOW_MS,
    };
    rateLimitStore.set(key, entry);
  }

  entry.count++;

  const resetEpochSeconds = Math.ceil(entry.resetAt / 1000);
  const remaining = Math.max(0, MAX_REQUESTS - entry.count);

  // Always set rate limit headers
  res.setHeader("X-RateLimit-Limit", MAX_REQUESTS.toString());
  res.setHeader("X-RateLimit-Remaining", remaining.toString());
  res.setHeader("X-RateLimit-Reset", resetEpochSeconds.toString());

  if (entry.count > MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader("Retry-After", retryAfterSeconds.toString());
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
        details: {
          retryAfter: retryAfterSeconds,
          limit: MAX_REQUESTS,
          windowMs: WINDOW_MS,
        },
        request_id: req.headers["x-request-id"] as string || `req_${Date.now().toString(36)}`,
      },
    });
    return;
  }

  next();
}
