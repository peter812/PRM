import type { Request, Response, NextFunction } from "express";
import { getPrmS3Config, presignPrmS3PublicUrl, normalizeEndpointUrl, type PrmS3Config } from "../prm-s3";

/**
 * PRM-S3 direct delivery.
 *
 * The database only ever stores proxy paths (/api/prm-s3/images/<name>,
 * /api/prm-s3/media/<name>). In direct mode this middleware:
 *
 *  - rewrites those paths inside every JSON API response into presigned GET
 *    URLs on the public PRM-S3 endpoint, so the browser (and API-key
 *    consumers) load media straight from PRM-S3 without touching PRM;
 *  - maps any presigned public URL found in an inbound JSON body back to its
 *    proxy path, so a client echoing a URL it was given never persists a
 *    signed, expiring URL.
 *
 * Signing is synchronous and memoised (see presignPrmS3PublicUrl), so the
 * rewrite adds no PRM-S3 traffic and no DB reads per response.
 */

const PROXY_PATH_RE = /\/api\/prm-s3\/(images|media)\/([A-Za-z0-9_.-]+)/g;

// JSON endpoints whose payloads must keep raw storage paths.
const EXCLUDED_PREFIXES = ["/api/image-storage/"];

/**
 * Applies `mapString` to every string containing `needle` anywhere in a JSON
 * value. Copy-on-write: untouched subtrees are shared, so cached response
 * objects are never mutated. Only plain objects/arrays are walked; Dates,
 * Buffers, streams etc. pass through.
 */
function mapStrings(value: unknown, needle: string, mapString: (s: string) => string): unknown {
  if (typeof value === "string") {
    return value.includes(needle) ? mapString(value) : value;
  }
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const v = mapStrings(value[i], needle, mapString);
      if (v !== value[i]) {
        out ??= value.slice();
        out[i] = v;
      }
    }
    return out ?? value;
  }
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    let out: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(value)) {
      const nv = mapStrings(v, needle, mapString);
      if (nv !== v) {
        out ??= { ...(value as Record<string, unknown>) };
        out[k] = nv;
      }
    }
    return out ?? value;
  }
  return value;
}

export function rewriteProxyPathsToPublicUrls(body: unknown, cfg: PrmS3Config): unknown {
  return mapStrings(body, "/api/prm-s3/", (s) =>
    s.replace(PROXY_PATH_RE, (_m, kind: string, name: string) => presignPrmS3PublicUrl(cfg, `${kind}/${name}`)),
  );
}

let inboundRe: RegExp | null = null;
let inboundReKey = "";

function getInboundRegex(cfg: PrmS3Config): RegExp {
  const key = `${cfg.publicEndpoint}|${cfg.bucket}`;
  if (!inboundRe || inboundReKey !== key) {
    const base = new URL(normalizeEndpointUrl(cfg.publicEndpoint, "https"));
    const prefix = `${base.protocol}//${base.host}${base.pathname.replace(/\/+$/, "")}/${cfg.bucket}`;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    // The query stops at whitespace, quotes or a backslash (URLs inside JSON-encoded strings).
    inboundRe = new RegExp(`${escaped}/(images|media)/([A-Za-z0-9_.-]+)(?:\\?X-Amz-[^\\s"'\\\\<>]*)?`, "g");
    inboundReKey = key;
  }
  return inboundRe;
}

export function normalizePublicUrlsToProxyPaths(body: unknown, cfg: PrmS3Config): unknown {
  if (!cfg.publicEndpoint) return body;
  const re = getInboundRegex(cfg);
  return mapStrings(body, `/${cfg.bucket}/`, (s) => s.replace(re, "/api/prm-s3/$1/$2"));
}

export async function prmS3DirectMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.path.startsWith("/api/") || EXCLUDED_PREFIXES.some((p) => req.path.startsWith(p))) {
    next();
    return;
  }

  let cfg: PrmS3Config;
  try {
    cfg = await getPrmS3Config();
  } catch {
    next();
    return;
  }

  if (req.body && typeof req.body === "object") {
    req.body = normalizePublicUrlsToProxyPaths(req.body, cfg);
  }

  if (cfg.directDelivery) {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      return originalJson(rewriteProxyPathsToPublicUrls(body, cfg));
    };
  }

  next();
}
