import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListBucketsCommand, CreateBucketCommand, ListObjectsV2Command, CopyObjectCommand } from "@aws-sdk/client-s3";
import { withImageSize, type ImageSize } from "@shared/image-size";
import { newUploadName, type UploadKind, type ImageCategory } from "./upload-names";
import crypto from "crypto";
import { Readable } from "stream";
import dns from "node:dns/promises";
import net from "node:net";
import { storage } from "./storage";

/** The only key prefixes this app writes; deletes and sweeps never reach outside them. */
export const STORAGE_KEY_PREFIXES = ["images/", "profiles/", "posts/", "stories/", "media/", "faces/"];

/** A referenced object that no longer exists in PRM-S3: dead, not retryable. */
export class ObjectMissingError extends Error {}

// PRM-S3 is reachable at two addresses (see PRM-s3/config.example.toml):
//   ENDPOINT        internal/LAN address used by this server and other tools
//                   for uploads, deletes and reads (e.g. http://192.168.0.70:9000)
//   PUBLIC_ENDPOINT public domain the browser loads presigned image URLs from
//                   (e.g. https://prm-cdn.example.com)
export const PRM_S3_KEYS = {
  ENDPOINT: "prm_s3_endpoint",
  PUBLIC_ENDPOINT: "prm_s3_public_endpoint",
  BUCKET: "prm_s3_bucket",
  REGION: "prm_s3_region",
  ACCESS_KEY: "prm_s3_access_key",
  SECRET_KEY: "prm_s3_secret_key",
  DELIVERY_MODE: "prm_s3_delivery_mode",
};

// direct: API responses carry presigned URLs on the public endpoint and the
//         browser fetches media straight from PRM-S3 (no per-image PRM request).
// proxy:  media is streamed PRM-S3 -> PRM -> browser via /api/prm-s3/*.
export type PrmS3DeliveryMode = "direct" | "proxy";

export const PRM_S3_DEFAULTS = {
  ENDPOINT: process.env.PRM_S3_ENDPOINT || "http://localhost:9000",
  // Empty means "no public endpoint": images are proxied through this server
  // instead of the browser fetching them from PRM-S3 directly.
  PUBLIC_ENDPOINT: process.env.PRM_S3_PUBLIC_ENDPOINT || "",
  BUCKET: process.env.PRM_S3_BUCKET || "images",
  REGION: process.env.PRM_S3_REGION || "us-east-1",
  ACCESS_KEY: process.env.PRM_S3_ACCESS_KEY || "PRM0CDED7B21AD5BF229",
  SECRET_KEY: process.env.PRM_S3_SECRET_KEY || "/PqaiJ2Dmd5xOZeARnZY5JhRsJnzmpMJdL/Kmnuc",
  DELIVERY_MODE: "direct" as PrmS3DeliveryMode,
};

// Lifetime of presigned URLs handed to the browser. Must not exceed
// presign.max_expiry in the PRM-S3 config.
export const PRM_S3_PUBLIC_URL_TTL_SECONDS = 24 * 60 * 60;
// Signing time is rounded down to this window so every URL for the same
// object is byte-identical within the window (browser cache hits) and any
// URL we hand out stays valid for at least this long.
export const PRM_S3_PRESIGN_WINDOW_SECONDS = PRM_S3_PUBLIC_URL_TTL_SECONDS / 2;

export type PrmS3Config = {
  endpoint: string;
  publicEndpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  deliveryMode: PrmS3DeliveryMode;
  /** Direct mode is only effective once a public endpoint is configured. */
  directDelivery: boolean;
  isConfigured: boolean;
};

let cachedClient: S3Client | null = null;
let cachedClientKey = "";
let configPromise: Promise<PrmS3Config> | null = null;

export function normalizeEndpointUrl(endpoint: string, defaultScheme: "http" | "https"): string {
  if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
    return `${defaultScheme}://${endpoint}`;
  }
  return endpoint;
}

export function isValidEndpointUrl(endpoint: string, defaultScheme: "http" | "https"): boolean {
  try {
    const url = new URL(normalizeEndpointUrl(endpoint, defaultScheme));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function loadPrmS3Config(): Promise<PrmS3Config> {
  const endpoint = ((await storage.getAppSetting(PRM_S3_KEYS.ENDPOINT)) || PRM_S3_DEFAULTS.ENDPOINT).trim();
  let publicEndpoint = ((await storage.getAppSetting(PRM_S3_KEYS.PUBLIC_ENDPOINT)) ?? PRM_S3_DEFAULTS.PUBLIC_ENDPOINT).trim();
  // An unparseable public endpoint would throw inside the direct-delivery
  // middleware on every API request; treat it as unset instead.
  if (publicEndpoint && !isValidEndpointUrl(publicEndpoint, "https")) {
    console.warn(`[prm-s3] Ignoring invalid public endpoint URL: ${publicEndpoint}`);
    publicEndpoint = "";
  }
  const bucket = ((await storage.getAppSetting(PRM_S3_KEYS.BUCKET)) || PRM_S3_DEFAULTS.BUCKET).trim();
  const region = ((await storage.getAppSetting(PRM_S3_KEYS.REGION)) || PRM_S3_DEFAULTS.REGION).trim();
  const accessKeyId = ((await storage.getAppSetting(PRM_S3_KEYS.ACCESS_KEY)) || PRM_S3_DEFAULTS.ACCESS_KEY).trim();
  const secretAccessKey = ((await storage.getAppSetting(PRM_S3_KEYS.SECRET_KEY)) || PRM_S3_DEFAULTS.SECRET_KEY).trim();
  const deliveryMode: PrmS3DeliveryMode =
    (await storage.getAppSetting(PRM_S3_KEYS.DELIVERY_MODE)) === "proxy" ? "proxy" : PRM_S3_DEFAULTS.DELIVERY_MODE;

  return {
    endpoint,
    publicEndpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    deliveryMode,
    directDelivery: deliveryMode === "direct" && !!publicEndpoint,
    isConfigured: !!(endpoint && bucket && accessKeyId && secretAccessKey),
  };
}

/**
 * Cached in memory: the config is consulted on every API response in direct
 * mode, so it must not cost DB round-trips. Invalidated by setPrmS3Config.
 */
export function getPrmS3Config(): Promise<PrmS3Config> {
  if (!configPromise) {
    configPromise = loadPrmS3Config().catch((err) => {
      configPromise = null;
      throw err;
    });
  }
  return configPromise;
}

export async function setPrmS3Config(config: {
  endpoint?: string;
  publicEndpoint?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  deliveryMode?: PrmS3DeliveryMode;
}) {
  if (config.endpoint !== undefined) await storage.setAppSetting(PRM_S3_KEYS.ENDPOINT, config.endpoint.trim());
  if (config.publicEndpoint !== undefined) await storage.setAppSetting(PRM_S3_KEYS.PUBLIC_ENDPOINT, config.publicEndpoint.trim());
  if (config.bucket !== undefined) await storage.setAppSetting(PRM_S3_KEYS.BUCKET, config.bucket.trim());
  if (config.region !== undefined) await storage.setAppSetting(PRM_S3_KEYS.REGION, config.region.trim());
  if (config.accessKeyId !== undefined) await storage.setAppSetting(PRM_S3_KEYS.ACCESS_KEY, config.accessKeyId.trim());
  if (config.secretAccessKey !== undefined) await storage.setAppSetting(PRM_S3_KEYS.SECRET_KEY, config.secretAccessKey.trim());
  if (config.deliveryMode !== undefined) await storage.setAppSetting(PRM_S3_KEYS.DELIVERY_MODE, config.deliveryMode);

  // Invalidate cached config, client and presigned URLs
  configPromise = null;
  cachedClient = null;
  cachedClientKey = "";
  presignedUrlCache.clear();
  presignedUrlCacheWindow = "";
  signingKeyCache.clear();
  healthCache = null;
}

/**
 * Client for server-side traffic (uploads, deletes, reads). Talks to the
 * internal endpoint.
 */
export async function getPrmS3Client(): Promise<{ client: S3Client; bucket: string; endpoint: string }> {
  const cfg = await getPrmS3Config();
  const cacheKey = `${cfg.endpoint}|${cfg.region}|${cfg.accessKeyId}|${cfg.secretAccessKey}`;

  if (!cachedClient || cachedClientKey !== cacheKey) {
    const endpointUrl = normalizeEndpointUrl(cfg.endpoint, "http");

    cachedClient = new S3Client({
      endpoint: endpointUrl,
      region: cfg.region || "us-east-1",
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: true,
    });
    cachedClientKey = cacheKey;
  }

  return {
    client: cachedClient,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint,
  };
}

// ── Presigned GET URLs (SigV4 query auth, host header only) ──
//
// Hand-rolled rather than the SDK presigner so it is synchronous and cheap
// enough to run inline while rewriting API responses: the signing key is
// derived once per scope date, and each (window, key) URL is memoised.

const signingKeyCache = new Map<string, Buffer>();
const presignedUrlCache = new Map<string, string>();
let presignedUrlCacheWindow = "";
const PRESIGNED_URL_CACHE_MAX = 50_000;

const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const sha256Hex = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

// AWS UriEncode: RFC 3986 unreserved characters only.
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function getSigningKey(secretAccessKey: string, scopeDate: string, region: string): Buffer {
  const cacheKey = `${scopeDate}|${region}`;
  let key = signingKeyCache.get(cacheKey);
  if (!key) {
    key = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, scopeDate), region), "s3"), "aws4_request");
    signingKeyCache.clear();
    signingKeyCache.set(cacheKey, key);
  }
  return key;
}

/**
 * Presigned GET URL for `key` on the public endpoint (or `opts.endpoint`,
 * e.g. the internal one for server-side fetches). The signing time is
 * rounded down to PRM_S3_PRESIGN_WINDOW_SECONDS, so the result is stable
 * within a window and valid for at least one more window (TTL - window).
 * An empty key signs the bucket itself; `opts.query` adds signed parameters
 * (e.g. `{ stats: "" }` for the PRM-S3 bucket stats extension).
 */
export function presignPrmS3PublicUrl(
  cfg: PrmS3Config,
  key: string,
  { endpoint = cfg.publicEndpoint, nowMs = Date.now(), query: extraQuery = {} }: { endpoint?: string; nowMs?: number; query?: Record<string, string> } = {},
): string {
  const windowStart = Math.floor(nowMs / 1000 / PRM_S3_PRESIGN_WINDOW_SECONDS) * PRM_S3_PRESIGN_WINDOW_SECONDS;
  const amzDate = new Date(windowStart * 1000).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

  if (presignedUrlCacheWindow !== amzDate) {
    presignedUrlCache.clear();
    presignedUrlCacheWindow = amzDate;
  }
  const cacheKey = `${endpoint}|${key}|${JSON.stringify(extraQuery)}`;
  const cached = presignedUrlCache.get(cacheKey);
  if (cached) return cached;

  const scopeDate = amzDate.slice(0, 8);
  const scope = `${scopeDate}/${cfg.region}/s3/aws4_request`;
  const defaultScheme = endpoint && endpoint === cfg.publicEndpoint ? "https" : "http";
  const base = new URL(normalizeEndpointUrl(endpoint, defaultScheme));
  const basePath = base.pathname.replace(/\/+$/, "");
  const canonicalUri = `${basePath}/${[cfg.bucket, ...(key ? key.split("/") : [])].map(uriEncode).join("/")}`;

  const query = [
    ...Object.entries(extraQuery),
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(PRM_S3_PUBLIC_URL_TTL_SECONDS)],
    ["X-Amz-SignedHeaders", "host"],
  ]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join("&");

  const canonicalRequest = ["GET", canonicalUri, query, `host:${base.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = crypto
    .createHmac("sha256", getSigningKey(cfg.secretAccessKey, scopeDate, cfg.region))
    .update(stringToSign)
    .digest("hex");

  const url = `${base.protocol}//${base.host}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
  if (presignedUrlCache.size < PRESIGNED_URL_CACHE_MAX) presignedUrlCache.set(cacheKey, url);
  return url;
}

export type PrmS3BucketStats = {
  objects: number;
  images: number;
  videos: number;
  variants: number;
  objectBytes: number;
  variantBytes: number;
};

/** Object and baked-variant counts for the whole bucket (PRM-S3 `?stats` extension). */
export async function getPrmS3BucketStats(): Promise<PrmS3BucketStats> {
  const cfg = await getPrmS3Config();
  const res = await fetch(presignPrmS3PublicUrl(cfg, "", { endpoint: cfg.endpoint, query: { stats: "" } }));
  if (!res.ok) throw new Error(`PRM-S3 stats failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PrmS3BucketStats;
}

export async function copyPrmS3ObjectInPlace(key: string, contentType: string = "image/jpeg"): Promise<void> {
  const { client, bucket } = await getPrmS3Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${bucket}/${key}`,
      MetadataDirective: "REPLACE",
      ContentType: contentType,
    }),
  );
}

export async function isPrmS3VariantBaked(key: string, size: ImageSize = 64): Promise<{ baked: boolean; contentType: string }> {
  const cfg = await getPrmS3Config();
  const url = withImageSize(presignPrmS3PublicUrl(cfg, key, { endpoint: cfg.endpoint }), size);
  const res = await fetch(url, { method: "HEAD" });
  const ct = res.headers.get("content-type") || "";
  return {
    baked: res.ok && ct.includes("image/webp"),
    contentType: ct,
  };
}

/**
 * Presigned GET URL on the public endpoint for the browser to fetch directly.
 * Returns null unless direct delivery is enabled (direct mode + public
 * endpoint), in which case callers stream the object through this server.
 */
export async function getPrmS3PublicUrl(keyOrUrl: string): Promise<string | null> {
  const cfg = await getPrmS3Config();
  if (!cfg.directDelivery) return null;
  return presignPrmS3PublicUrl(cfg, normalizePrmS3Key(keyOrUrl));
}

async function ensureBucketExists(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch {
      // Ignore if already created concurrently
    }
  }
}

export async function testPrmS3Connection(): Promise<{ ok: boolean; message: string }> {
  try {
    const { client, bucket } = await getPrmS3Client();
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return { ok: true, message: `Successfully connected to PRM-S3 bucket '${bucket}'.` };
    } catch (headErr: any) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        return { ok: true, message: `Successfully connected to PRM-S3 and initialized bucket '${bucket}'.` };
      } catch {
        const listRes = await client.send(new ListBucketsCommand({}));
        const bucketExists = listRes.Buckets?.some(b => b.Name === bucket);
        if (bucketExists) {
          return { ok: true, message: `Successfully connected to PRM-S3. Bucket '${bucket}' exists.` };
        }
        return { ok: true, message: `Connected to PRM-S3 server, but bucket '${bucket}' was not found.` };
      }
    }
  } catch (error: any) {
    return { ok: false, message: `Failed to connect to PRM-S3: ${error.message}` };
  }
}

// Health is polled by every open browser tab; one probe per window serves
// them all, and the probe is bounded so a dead host can't hang the request.
const HEALTH_CACHE_MS = 10_000;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
let healthCache: { at: number; result: { ok: boolean; message: string } } | null = null;

/** Cheap liveness probe of the configured PRM-S3 bucket for the UI's status indicator. */
export async function checkPrmS3Health(): Promise<{ ok: boolean; message: string }> {
  if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) return healthCache.result;
  let result: { ok: boolean; message: string };
  try {
    const { client, bucket, endpoint } = await getPrmS3Client();
    await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) });
    result = { ok: true, message: `Connected to PRM-S3 at ${endpoint}` };
  } catch (error: any) {
    result = { ok: false, message: error?.message || "PRM-S3 is unreachable" };
  }
  healthCache = { at: Date.now(), result };
  return result;
}

async function putObject(kind: UploadKind, buffer: Buffer, originalFilename: string, mimeType: string, category?: ImageCategory): Promise<string> {
  const { key } = newUploadName(kind, originalFilename, mimeType, category);
  const { client, bucket } = await getPrmS3Client();
  await ensureBucketExists(client, bucket);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType }));
  return `/api/prm-s3/${key}`;
}

export function uploadImageToPrmS3(buffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
  return putObject("image", buffer, originalFilename, mimeType);
}

export function uploadMediaToPrmS3(buffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
  return putObject("media", buffer, originalFilename, mimeType);
}

export const uploadImage = uploadImageToPrmS3;
export const uploadMedia = uploadMediaToPrmS3;

export function uploadStoryImage(buffer: Buffer, filename: string, mime: string): Promise<string> {
  return putObject("image", buffer, filename, mime, "story");
}
export function uploadPostImage(buffer: Buffer, filename: string, mime: string): Promise<string> {
  return putObject("image", buffer, filename, mime, "post");
}
export function uploadProfileImage(buffer: Buffer, filename: string, mime: string): Promise<string> {
  return putObject("image", buffer, filename, mime, "profile");
}

export async function putPrmS3Object(keyOrUrl: string, buffer: Buffer, mimeType: string): Promise<string> {
  const key = normalizePrmS3Key(keyOrUrl);
  if (key.includes("..") || !STORAGE_KEY_PREFIXES.some((p) => key.startsWith(p))) {
    throw new Error(`Access denied: Can only write objects under ${STORAGE_KEY_PREFIXES.join(", ")}`);
  }
  const { client, bucket } = await getPrmS3Client();
  await ensureBucketExists(client, bucket);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType }));
  return `/api/prm-s3/${key}`;
}

/**
 * Tells PRM-compute the face-crop bucket may have changed. Compute reads the
 * PRM-S3 credentials straight from app_settings (its DB is this one), so this
 * only pings POST /api/face/storage/reload; nothing is sent in the body.
 */
export async function syncFaceCropStorage(): Promise<void> {
  const apiUrl = (await storage.getAppSetting("prm_compute_api_url")) || (await storage.getAppSetting("prm_face_api_url"));
  const apiKey = (await storage.getAppSetting("prm_compute_api_key")) || (await storage.getAppSetting("prm_face_api_key"));
  if (!apiUrl || !apiKey) return;

  await setPrmS3Config(await getPrmS3Config());

  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/face/storage/reload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error(`syncFaceCropStorage: PRM-compute rejected PRM-S3 storage: ${await response.text()}`);
    }
  } catch (err: any) {
    console.error(`syncFaceCropStorage: could not reach PRM-compute: ${err.message}`);
  }
}

export function normalizePrmS3Key(keyOrUrl: string): string {
  const proxy = keyOrUrl.match(/^\/api\/prm-s3\/(images|profiles|posts|stories|media|faces)\/([^/?#]+)/);
  if (proxy) return `${proxy[1]}/${proxy[2]}`;
  // Absolute (possibly presigned) urls and bare keys under any prefix we write.
  // Anchored on the object name so a bucket also called "images" isn't taken
  // for the prefix (http://host/images/faces/x.jpg -> faces/x.jpg).
  const match = keyOrUrl.match(/(?:^|\/)(images|profiles|posts|stories|media|faces)\/([^/?#]+)(?=[?#]|$)/);
  return match ? `${match[1]}/${match[2]}` : keyOrUrl;
}

export async function deleteImageFromPrmS3(imageUrl: string): Promise<void> {
  const key = normalizePrmS3Key(imageUrl);
  if (key.includes("..") || !STORAGE_KEY_PREFIXES.some(p => key.startsWith(p))) {
    throw new Error("Access denied: Can only delete objects in images/ or faces/ folder");
  }
  const { client, bucket } = await getPrmS3Client();
  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
}

export async function deleteMediaFromPrmS3(mediaUrl: string): Promise<void> {
  const key = normalizePrmS3Key(mediaUrl);
  if (key.includes("..") || !key.startsWith("media/")) {
    throw new Error("Access denied: Can only delete objects in media/ folder");
  }
  const { client, bucket } = await getPrmS3Client();
  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
}

/** Every object key in the PRM-S3 bucket under prefixes (defaults to STORAGE_KEY_PREFIXES). */
export async function listPrmS3ObjectKeys(prefixes: readonly string[] | string[] = STORAGE_KEY_PREFIXES): Promise<string[]> {
  const { client, bucket } = await getPrmS3Client();
  const keys: string[] = [];
  for (const Prefix of prefixes) {
    let ContinuationToken: string | undefined;
    do {
      const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix, ContinuationToken }));
      for (const obj of res.Contents || []) if (obj.Key) keys.push(obj.Key);
      ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }
  return keys;
}

export async function deletePrmS3ObjectKey(key: string): Promise<void> {
  if (key.includes("..") || !STORAGE_KEY_PREFIXES.some(p => key.startsWith(p))) {
    throw new Error(`Access denied: Can only delete objects under ${STORAGE_KEY_PREFIXES.join(", ")}`);
  }
  const { client, bucket } = await getPrmS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getPrmS3ObjectStream(keyOrUrl: string): Promise<{
  stream: Readable;
  contentType: string;
  contentLength?: number;
  etag?: string;
}> {
  const { client, bucket } = await getPrmS3Client();
  const key = normalizePrmS3Key(keyOrUrl);
  if (key.includes("..") || !STORAGE_KEY_PREFIXES.some(p => key.startsWith(p))) {
    throw new Error(`Access denied: Can only access objects under ${STORAGE_KEY_PREFIXES.join(", ")}`);
  }
  const res = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })).catch((err) => {
    throw err?.name === "NoSuchKey" ? new ObjectMissingError(`PRM-S3 object no longer exists: ${key}`) : err;
  });

  if (!res.Body) {
    throw new Error(`Empty body for object: ${key}`);
  }

  return {
    stream: res.Body as Readable,
    contentType: res.ContentType || "application/octet-stream",
    contentLength: res.ContentLength,
    etag: res.ETag,
  };
}

export async function getPrmS3ObjectBuffer(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const { stream, contentType } = await getPrmS3ObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return {
    buffer: Buffer.concat(chunks),
    mimeType: contentType,
  };
}

export function isPrmS3ImageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("/api/prm-s3/")) return true;
  // Absolute URLs pointing at either PRM-S3 endpoint (or the historical default).
  if (url.includes("localhost:9000") || url.includes("127.0.0.1:9000")) return true;
  for (const ep of [PRM_S3_DEFAULTS.ENDPOINT, PRM_S3_DEFAULTS.PUBLIC_ENDPOINT]) {
    const host = ep.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (host && url.includes(`//${host}/`)) return true;
  }
  return false;
}

export function isStoredImageUrl(url: string): boolean {
  return isPrmS3ImageUrl(url);
}

const MAX_EXTERNAL_IMAGE_BYTES = 8 * 1024 * 1024;
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;
const MAX_EXTERNAL_REDIRECTS = 3;

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return (
    v6 === "::1" ||
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80")
  );
}

async function assertSafeExternalUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid image URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing to fetch image over unsupported protocol: ${url.protocol}`);
  }

  if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    throw new Error(`Refusing to fetch image from private/internal IP: ${url.hostname}`);
  }

  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses || addresses.length === 0) {
    throw new Error(`Unable to resolve host: ${url.hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Refusing to fetch image: ${url.hostname} resolves to private/internal IP ${address}`);
    }
  }
  return url;
}

async function readCappedBuffer(response: Response, maxBytes: number = MAX_EXTERNAL_IMAGE_BYTES): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new Error(`Failed to download image: ${declared} bytes exceeds cap of ${maxBytes} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.length;
      if (seen > maxBytes) {
        await reader.cancel();
        throw new Error(`Failed to download image: exceeded cap of ${maxBytes} bytes mid-stream`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  return Buffer.concat(chunks);
}

export async function fetchImageBuffer(location: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!location) throw new Error("Empty image location");

  if (isPrmS3ImageUrl(location)) {
    return await getPrmS3ObjectBuffer(location);
  }

  // External URL (SSRF-guarded, redirect-checked, timed out, and capped)
  let targetUrl = await assertSafeExternalUrl(location);
  let res: Response;

  for (let hop = 0; ; hop++) {
    res = await fetch(targetUrl.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });

    const redirectLocation =
      res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!redirectLocation) break;

    if (hop >= MAX_EXTERNAL_REDIRECTS) {
      throw new Error("Failed to download image: too many redirects");
    }
    const nextUrl = new URL(redirectLocation, targetUrl).toString();
    targetUrl = await assertSafeExternalUrl(nextUrl);
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch image from ${location}: HTTP ${res.status}`);
  }
  const buffer = await readCappedBuffer(res, MAX_EXTERNAL_IMAGE_BYTES);
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  return {
    buffer,
    mimeType,
  };
}
