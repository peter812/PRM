import type { Request, Response, NextFunction } from "express";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function extractOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(req: Request): Set<string> {
  const allowed = new Set<string>();

  const host = req.get("host")?.trim();
  if (host) {
    for (const protocol of ["http", "https"]) {
      try {
        allowed.add(new URL(`${protocol}://${host}`).origin);
      } catch {
        // Ignore malformed Host header
      }
    }
  }

  for (const envUrl of [process.env.APP_BASE_URL, process.env.PUBLIC_URL]) {
    const trimmed = envUrl?.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        allowed.add(parsed.origin);
      }
    } catch {
      // Ignore malformed configured URL
    }
  }

  return allowed;
}

function isTokenAuthenticated(req: Request): boolean {
  const authHeader = req.get("authorization");
  if (authHeader && /^Bearer\s+\S+/i.test(authHeader)) {
    return true;
  }
  if (req.get("x-api-key")?.trim()) {
    return true;
  }
  if (req.get("x-stories-token")?.trim()) {
    return true;
  }
  if (req.get("x-extension-token")?.trim()) {
    return true;
  }
  return false;
}

/**
 * CSRF protection for cookie-authenticated state-changing requests under /api.
 * Rejects cross-site / cross-origin POST, PUT, PATCH, and DELETE requests
 * based on Sec-Fetch-Site and Origin/Referer headers, while skipping
 * token-authenticated (Bearer, x-api-key, x-stories-token, x-extension-token)
 * and unauthenticated requests.
 */
export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  if (isTokenAuthenticated(req)) {
    next();
    return;
  }

  if (typeof req.isAuthenticated === "function" && !req.isAuthenticated()) {
    next();
    return;
  }

  const secFetchSite = req.get("sec-fetch-site")?.trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    res.status(403).json({ error: "Cross-site request blocked" });
    return;
  }

  const rawOrigin = req.get("origin");
  const rawReferer = req.get("referer");
  const headerToCheck = rawOrigin !== undefined ? rawOrigin : rawReferer;

  if (headerToCheck !== undefined) {
    const requestOrigin = extractOrigin(headerToCheck);
    if (!requestOrigin) {
      res.status(403).json({ error: "Invalid request origin" });
      return;
    }

    const allowedOrigins = getAllowedOrigins(req);
    if (!allowedOrigins.has(requestOrigin)) {
      res.status(403).json({ error: "Cross-origin request blocked" });
      return;
    }
  }

  next();
}
