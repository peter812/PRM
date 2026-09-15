import { storage } from "./storage";
import { db } from "./db";
import { socialAccounts } from "@shared/schema";
import { uploadImageToS3 } from "./s3";
import { uploadImageLocally } from "./local-storage";
import { syncEntityInBackground } from "./vector-universal";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * Downloading, hashing and storing an Instagram profile picture.
 *
 * Extracted from processDownloadImgInstagram, which had grown the only correct
 * version of this: hash-based change detection, a resolution guard, and a
 * storage-mode-aware upload. Two other copies existed and neither did all three.
 * Both the image-task worker and the inline path in processImportSocial now call
 * these, so the rules live in exactly one place.
 */

export const INSTAGRAM_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1";

export function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    // PNG: signature bytes 0-7, IHDR width at 16, height at 20 (big-endian uint32)
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    // JPEG: scan for SOF markers
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        const segLen = buffer.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
      return null;
    }
    // WebP: RIFF....WEBP format
    if (buffer.length >= 30 && buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") {
      const fmt = buffer.slice(12, 16).toString("ascii");
      if (fmt === "VP8 " && buffer.length >= 30) {
        const w = (buffer.readUInt16LE(26) & 0x3fff) + 1;
        const h = (buffer.readUInt16LE(28) & 0x3fff) + 1;
        return { width: w, height: h };
      }
      if (fmt === "VP8X" && buffer.length >= 30) {
        const w = buffer.readUIntLE(24, 3) + 1;
        const h = buffer.readUIntLE(27, 3) + 1;
        return { width: w, height: h };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface FetchedProfileImage {
  buffer: Buffer;
  contentType: string;
  ext: string;
  fileHash: string;
  dims: { width: number; height: number } | null;
  /** Response headers plus the source url, recorded on the photos row. */
  ogMetadata: Record<string, unknown>;
}

/**
 * Hosts this server is willing to make an outbound request to.
 *
 * The image url arrives on an extension payload, so it is caller-controlled: without
 * this, `fetchProfileImage` is a server-side request forgery primitive pointed at
 * whatever the caller names — cloud metadata, a database port, anything on the
 * private network — with the response body stored and served back out.
 *
 * The allowlist is the real control. Checking the resolved address as well is defence
 * in depth: with a host allowlist, rebinding requires a record under Instagram's own
 * domains.
 */
const ALLOWED_IMAGE_HOSTS = [/\.cdninstagram\.com$/i, /\.fbcdn\.net$/i];

/** Profile pictures are well under a megabyte; this is only here to bound the damage. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 10_000;

/** Redirects are followed by hand so the allowlist applies to every hop, not just the first. */
const MAX_REDIRECTS = 3;

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)          // link-local, and so cloud metadata
      || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Throws unless `raw` is an https url on an allowed CDN host that resolves publicly. */
async function assertFetchableImageUrl(raw: string): Promise<string> {
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error(`Refusing to fetch image over ${url.protocol}`);
  }
  if (!ALLOWED_IMAGE_HOSTS.some((re) => re.test(url.hostname))) {
    throw new Error(`Refusing to fetch image from disallowed host ${url.hostname}`);
  }
  for (const { address } of await dns.lookup(url.hostname, { all: true })) {
    if (isPrivateAddress(address)) {
      throw new Error(`Refusing to fetch image: ${url.hostname} resolves to ${address}`);
    }
  }
  return url.toString();
}

/**
 * Buffers a response body, refusing to exceed the cap.
 *
 * Content-Length is checked first because it is free, and again while reading because
 * it is advisory — a chunked response carries no length at all.
 */
async function readCapped(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    throw new Error(`Failed to download image: ${declared} bytes exceeds cap`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.length;
    if (seen > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Failed to download image: exceeded cap mid-stream");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads and hashes a profile picture.
 *
 * Throws when the CDN refuses the request, when the url is not one we are willing to
 * fetch, or when the response exceeds what a profile picture can plausibly be.
 */
export async function fetchProfileImage(imageUrl: string): Promise<FetchedProfileImage> {
  let target = await assertFetchableImageUrl(imageUrl);
  let response: Response;

  for (let hop = 0; ; hop++) {
    response = await fetch(target, {
      headers: { "User-Agent": INSTAGRAM_USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const location = response.status >= 300 && response.status < 400
      ? response.headers.get("location")
      : null;
    if (!location) break;

    if (hop >= MAX_REDIRECTS) throw new Error("Failed to download image: too many redirects");
    target = await assertFetchableImageUrl(new URL(location, target).toString());
  }

  if (!response.ok) {
    throw new Error(`Failed to download image: HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const buffer = await readCapped(response);

  return {
    buffer,
    contentType,
    ext: contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg",
    fileHash: crypto.createHash("sha256").update(buffer).digest("hex"),
    dims: getImageDimensions(buffer),
    // Lightweight on purpose — response headers and the source url only, so it can be
    // recorded for every stored file without an extra round-trip.
    ogMetadata: {
      sourceUrl: imageUrl,
      contentType,
      contentLength: response.headers.get("content-length"),
      lastModified: response.headers.get("last-modified"),
      etag: response.headers.get("etag"),
      fetchedAt: new Date().toISOString(),
    },
  };
}

export type ProfileImageVerdict =
  | { replace: true }
  | { replace: false; reason: "same_hash" | "lower_resolution" };

/**
 * Whether a freshly fetched image should replace the account's current one.
 *
 * Instagram's profile-picture urls are signed and rotate on every scrape, so the
 * url says nothing about whether the picture changed — only the bytes do. A
 * lower-resolution fetch of the same picture is also rejected, since Instagram
 * serves several sizes and a later scrape landing on a smaller one would
 * otherwise degrade what we already hold.
 */
export async function shouldReplaceProfileImage(
  currentImageUrl: string | null | undefined,
  fetched: FetchedProfileImage,
): Promise<ProfileImageVerdict> {
  if (!currentImageUrl) return { replace: true };

  const existing = await storage.getPhotoByLocation(currentImageUrl);
  if (!existing) return { replace: true };

  if (existing.fileHash === fetched.fileHash) return { replace: false, reason: "same_hash" };
  if (existing.widthPx && fetched.dims && fetched.dims.width <= existing.widthPx) {
    return { replace: false, reason: "lower_resolution" };
  }
  return { replace: true };
}

/**
 * Uploads a fetched image to whichever backend the user has configured and
 * registers it in the photos table. Returns the stable url to store on the account.
 */
export async function storeProfileImage(
  fetched: FetchedProfileImage,
  socialAccountId: string,
): Promise<{ cdnUrl: string; photoId: string }> {
  const filename = `instagram_profile.${fetched.ext}`;

  let cdnUrl: string;
  try {
    const user = (await storage.getAllUsers())[0];
    const mode = user ? await storage.getImageStorageMode(user.id) : "s3";
    cdnUrl =
      mode === "local"
        ? await uploadImageLocally(fetched.buffer, filename, fetched.contentType)
        : await uploadImageToS3(fetched.buffer, filename, fetched.contentType);
  } catch {
    cdnUrl = await uploadImageToS3(fetched.buffer, filename, fetched.contentType);
  }

  const photo = await storage.insertPhoto({
    location: cdnUrl,
    prmLocation: `profile_image:${socialAccountId}`,
    isSubImage: false,
    fileHash: fetched.fileHash,
    widthPx: fetched.dims?.width ?? null,
    heightPx: fetched.dims?.height ?? null,
    ogMetadata: fetched.ogMetadata,
  });

  syncEntityInBackground("image", photo.id);

  return { cdnUrl, photoId: photo.id };
}

/** The account's current image url, for the comparison above. */
export async function getCurrentProfileImageUrl(socialAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ imageUrl: socialAccounts.imageUrl })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, socialAccountId));
  return row?.imageUrl ?? null;
}
