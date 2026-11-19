import type { Request, Response, NextFunction } from "express";
import { getPrmS3Config, presignPrmS3PublicUrl, normalizeEndpointUrl, type PrmS3Config } from "../prm-s3";
import { allBuckets } from "../prm-s3-buckets";

/**
 * PRM-S3 direct delivery.
 *
 * The database only ever stores proxy paths (/api/prm-s3/images/<name>,
 * /api/prm-s3/media/<name>, /api/prm-s3/faces/<name> for PRM-compute's face
 * crops). In direct mode this middleware:
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

const PROXY_PATH_RE = /\/api\/prm-s3\/(images|profiles|posts|stories|media|faces|references)\/([A-Za-z0-9_.-]+)/g;

// JSON endpoints whose payloads must keep raw storage paths or are heavy bulk/ingest/export routes.
const EXCLUDED_PREFIXES = [
  "/api/image-storage/",
  "/api/v1/tracking/jobs/",
  "/api/export",
  "/api/import",
  "/api/backups",
];

const PROXY_PATH_PREFIX = "/api/prm-s3/";

/**
 * Applies `mapString` to every string anywhere in a JSON value.
 * Copy-on-write: untouched subtrees are shared, so cached response
 * objects are never mutated. Only plain objects/arrays are walked; Dates,
 * Buffers, streams etc. pass through.
 */
function mapStrings(value: unknown, mapString: (s: string) => string): unknown {
  if (typeof value === "string") {
    return mapString(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item !== "string" && (!item || typeof item !== "object")) continue;
      const v = mapStrings(item, mapString);
      if (v !== item) {
        out ??= value.slice();
        out[i] = v;
      }
    }
    return out ?? value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const record = value as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const k in record) {
    if (!Object.prototype.hasOwnProperty.call(record, k)) continue;
    const v = record[k];
    if (typeof v !== "string" && (!v || typeof v !== "object")) continue;
    const nv = mapStrings(v, mapString);
    if (nv !== v) {
      out ??= { ...record };
      out[k] = nv;
    }
  }
  return out ?? value;
}

export function rewriteProxyPathsToPublicUrls(body: unknown, cfg: PrmS3Config): unknown {
  return mapStrings(body, (s) =>
    s.includes(PROXY_PATH_PREFIX)
      ? s.replace(PROXY_PATH_RE, (_m, kind: string, name: string) => presignPrmS3PublicUrl(cfg, `${kind}/${name}`))
      : s,
  );
}

const PROXY_SIZED_RE = /\/api\/prm-s3\/(images|profiles|posts|stories|media|faces|references)\/([A-Za-z0-9_.-]+)(?:[?&]s=[^\s"'\\<>]+)/g;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

let inbound: { re: RegExp; needle: string } | null = null;
let inboundKey = "";

function getInbound(cfg: PrmS3Config): { re: RegExp; needle: string } {
  // Unprefixed names too: a URL signed before the bucket prefix was set can
  // still come back from a client.
  const names = Array.from(new Set([...allBuckets(cfg), ...allBuckets({ ...cfg, bucketPrefix: "" })]));
  const key = `${cfg.publicEndpoint}|${names.join("|")}`;
  if (!inbound || inboundKey !== key) {
    const base = new URL(normalizeEndpointUrl(cfg.publicEndpoint, "https"));
    const needle = `${base.protocol}//${base.host}${base.pathname.replace(/\/+$/, "")}/`;
    const escaped = `${escapeRegex(needle)}(?:${names.map(escapeRegex).join("|")})`;
    // The query stops at whitespace, quotes or a backslash (URLs inside JSON-encoded strings).
    // Swallows SigV4 parameters and any ?s= / &s= size parameters.
    const re = new RegExp(`${escaped}/(images|profiles|posts|stories|media|faces|references)/([A-Za-z0-9_.-]+)(?:\\?[^\\s"'\\\\<>]*)?`, "g");
    inbound = { re, needle };
    inboundKey = key;
  }
  return inbound;
}

export function normalizePublicUrlsToProxyPaths(body: unknown, cfg: PrmS3Config): unknown {
  const inboundInfo = cfg.publicEndpoint ? getInbound(cfg) : null;
  return mapStrings(body, (s) => {
    let out = s;
    if (inboundInfo && out.includes(inboundInfo.needle)) {
      out = out.replace(inboundInfo.re, "/api/prm-s3/$1/$2");
    }
    if (out.includes(PROXY_PATH_PREFIX)) {
      out = out.replace(PROXY_SIZED_RE, "/api/prm-s3/$1/$2");
    }
    return out;
  });
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
