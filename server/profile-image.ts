import { storage } from "./storage";
import { db } from "./db";
import { photos, socialAccounts } from "@shared/schema";
import type { Photo, ProfileImageChange } from "@shared/schema";
import { fetchImageBuffer, isStoredImageUrl } from "./prm-s3";
import { isLocalImageUrl, getLocalImagePath } from "./local-storage";
import { uploadImage } from "./image-storage";
import { syncEntityInBackground } from "./vector-universal";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs";
import sharp from "sharp";

/**
 * Downloading, hashing and storing an Instagram profile picture.
 *
 * Extracted from processDownloadImgInstagram, which had grown the only correct
 * version of this: hash-based change detection, a resolution guard, and a
 * storage-mode-aware upload. Two other copies existed and neither did all three.
 * Both the image-task worker and the inline path in processImportSocial now call
 * these, so the rules live in exactly one place.
 *
 * Instagram serves the same picture at two sizes: a 150px thumbnail on every
 * follower/following scrape and a 1080px original on a profile-info fetch. Both
 * are kept (social_accounts.image_url / image_url_hq), and a perceptual hash
 * tells a bigger copy of the same picture from a new picture, so the journal can
 * say "improved" rather than "changed". See profile-image-tiers-plan.md.
 */

export const INSTAGRAM_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1";

export type ImageTier = "lq" | "hq";

/** 150 and 320 are Instagram's thumbnail sizes; 640 and 1080 are the "full" picture. */
const HQ_MIN_WIDTH = 320;

export const tierOf = (dims: { width: number } | null): ImageTier =>
  dims && dims.width >= HQ_MIN_WIDTH ? "hq" : "lq";

/** The size every list view renders; an HQ copy is cut down to this when no LQ arrived. */
const THUMBNAIL_PX = 150;

/**
 * Difference hash: 9×8 greyscale, each bit is "left pixel brighter than right".
 * Size-invariant by construction, which is exactly the 150-vs-1080 question.
 */
export async function perceptualHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits = (bits << 1n) | (data[row * 9 + col] > data[row * 9 + col + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Re-encodes and resizes land well under this; a different picture lands well over. */
const SAME_PICTURE_MAX_DISTANCE = 10;

export const samePicture = (a: string, b: string): boolean =>
  hammingDistance(a, b) <= SAME_PICTURE_MAX_DISTANCE;

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
  tier: ImageTier;
  perceptualHash: string;
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
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
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
  if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    throw new Error(`Refusing to fetch image from private/internal IP ${url.hostname}`);
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

  // Lightweight on purpose — response headers and the source url only, so it can be
  // recorded for every stored file without an extra round-trip.
  return profileImageFromBuffer(buffer, contentType, imageUrl, {
    contentLength: response.headers.get("content-length"),
    lastModified: response.headers.get("last-modified"),
    etag: response.headers.get("etag"),
  });
}

/** Bytes that arrived some other way (prm-stories uploads them) in the shape the guards below expect. */
export async function profileImageFromBuffer(
  buffer: Buffer,
  contentType: string,
  sourceUrl?: string,
  headers: Record<string, string | null> = {},
): Promise<FetchedProfileImage> {
  const dims = getImageDimensions(buffer);
  return {
    buffer,
    contentType,
    ext: contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg",
    fileHash: crypto.createHash("sha256").update(buffer).digest("hex"),
    dims,
    tier: tierOf(dims),
    perceptualHash: await perceptualHash(buffer),
    ogMetadata: { sourceUrl: sourceUrl ?? null, contentType, ...headers, fetchedAt: new Date().toISOString() },
  };
}

/** The two urls an account holds, in the shape both the row and `currentProfile` carry. */
export interface ProfileImageUrls {
  imageUrl: string | null;
  imageUrlHq: string | null;
}

export type ProfileImageVerdict =
  | { replace: false; reason: "same_hash" | "same_picture" | "lower_resolution" }
  | {
      replace: true;
      imageChange: ProfileImageChange;
      /** Case D: a bigger copy of the picture we hold — the existing 150 is kept as-is. */
      keepLq: boolean;
    };

/**
 * Instagram's CDN filename (`…/123_456_789_n.jpg`) is the same across sizes and
 * changes with the picture; a match is a free "same picture" before any pixels.
 */
function cdnFilename(sourceUrl: unknown): string | null {
  if (typeof sourceUrl !== "string") return null;
  try {
    return new URL(sourceUrl).pathname.split("/").pop() || null;
  } catch {
    return null;
  }
}

/** Bytes of a stored image, from whichever backend holds it. */
export async function readStoredImage(location: string): Promise<Buffer | null> {
  if (!isStoredImageUrl(location)) {
    return null;
  }
  try {
    const { buffer } = await fetchImageBuffer(location);
    return buffer;
  } catch {
    return null;
  }
}

/**
 * The photos row's perceptual hash, computing and persisting it for rows written
 * before the column existed. Null when the bytes are gone.
 */
async function ensurePerceptualHash(photo: Photo): Promise<string | null> {
  if (photo.perceptualHash) return photo.perceptualHash;
  const buffer = await readStoredImage(photo.location);
  if (!buffer) return null;
  const hash = await perceptualHash(buffer);
  if (hash) {
    await db.update(photos).set({ perceptualHash: hash }).where(eq(photos.id, photo.id));
  }
  return hash;
}

/**
 * Whether a freshly fetched image should replace what the account holds, and
 * how the journal should describe it (profile-image-tiers-plan.md §4).
 *
 * Instagram's profile-picture urls are signed and rotate on every scrape, so the
 * url says nothing about whether the picture changed — only the bytes do. Same
 * bytes, or the same picture at the same or a lower size, is a skip. The same
 * picture at a higher size is an "improvement"; anything else is a new picture,
 * labelled by the tiers it moved between.
 */
export async function classifyProfileImage(
  current: ProfileImageUrls,
  fetched: FetchedProfileImage,
): Promise<ProfileImageVerdict> {
  const best = current.imageUrlHq ?? current.imageUrl;
  if (!best) {
    return { replace: true, imageChange: fetched.tier === "hq" ? "added_hq" : "added_lq", keepLq: false };
  }

  const bestPhoto = await storage.getPhotoByLocation(best);
  const lqPhoto = current.imageUrl && current.imageUrl !== best
    ? await storage.getPhotoByLocation(current.imageUrl)
    : null;
  if ([bestPhoto, lqPhoto].some((p) => p?.fileHash === fetched.fileHash)) {
    return { replace: false, reason: "same_hash" };
  }

  // Rows from before tiers may hold a 1080 in image_url; the photos row knows, the column doesn't.
  const currentTier: ImageTier = bestPhoto?.widthPx
    ? tierOf({ width: bestPhoto.widthPx })
    : current.imageUrlHq ? "hq" : "lq";

  let same = false;
  if (bestPhoto) {
    const bestName = cdnFilename((bestPhoto.ogMetadata as Record<string, unknown> | null)?.sourceUrl);
    const fetchedName = cdnFilename(fetched.ogMetadata.sourceUrl);
    if (bestName && fetchedName && bestName === fetchedName) {
      same = true;
    } else {
      const hash = await ensurePerceptualHash(bestPhoto);
      same = hash !== null && samePicture(hash, fetched.perceptualHash);
    }
  }

  if (currentTier === "lq") {
    if (fetched.tier === "lq") {
      return same
        ? { replace: false, reason: "same_picture" }
        : { replace: true, imageChange: "updated_lq", keepLq: false };
    }
    return same
      ? { replace: true, imageChange: "improved", keepLq: true }
      : { replace: true, imageChange: "updated_lq_to_hq", keepLq: false };
  }
  if (fetched.tier === "lq") {
    return same
      ? { replace: false, reason: "lower_resolution" }
      : { replace: true, imageChange: "updated_hq_to_lq", keepLq: false };
  }
  return same
    ? { replace: false, reason: "same_picture" }
    : { replace: true, imageChange: "updated_hq", keepLq: false };
}


/**
 * Uploads a fetched image and registers it in the photos table. Returns the
 * stable url to store on the account.
 */
export async function storeProfileImage(
  fetched: FetchedProfileImage,
  socialAccountId: string,
): Promise<{ cdnUrl: string; photoId: string }> {
  const cdnUrl = await uploadImage(fetched.buffer, `instagram_profile.${fetched.ext}`, fetched.contentType);

  const photo = await storage.insertPhoto({
    location: cdnUrl,
    prmLocation: `profile_image:${socialAccountId}`,
    isSubImage: false,
    fileHash: fetched.fileHash,
    widthPx: fetched.dims?.width ?? null,
    heightPx: fetched.dims?.height ?? null,
    perceptualHash: fetched.perceptualHash,
    ogMetadata: fetched.ogMetadata,
  });

  syncEntityInBackground("image", photo.id);

  return { cdnUrl, photoId: photo.id };
}

/**
 * The 150px webp every list renders, cut from an HQ copy. A sub-image of the
 * photo it came from, so the image page still resolves it and dedupe sees its hash.
 */
export async function storeProfileThumbnail(
  hqBuffer: Buffer,
  socialAccountId: string,
  derivedFromPhotoId: string | null,
): Promise<string> {
  const buffer = await sharp(hqBuffer)
    .resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: "cover" })
    .webp({ quality: 82 })
    .toBuffer();
  const cdnUrl = await uploadImage(buffer, "instagram_profile_150.webp", "image/webp");

  await storage.insertPhoto({
    location: cdnUrl,
    prmLocation: `profile_image:${socialAccountId}`,
    isSubImage: true,
    fileHash: crypto.createHash("sha256").update(buffer).digest("hex"),
    widthPx: THUMBNAIL_PX,
    heightPx: THUMBNAIL_PX,
    perceptualHash: await perceptualHash(buffer),
    ogMetadata: { derivedFromPhotoId, contentType: "image/webp", fetchedAt: new Date().toISOString() },
  });

  return cdnUrl;
}

/** What a replacement leaves on the account, plus how the journal describes it. */
export interface ProfileImageOutcome {
  imageUrl: string;
  imageUrlHq: string | null;
  imageChange: ProfileImageChange;
  photoId: string;
}

/**
 * Stores the fetched image — and its 150 thumbnail when no LQ copy would remain —
 * and says what the account's two urls become. Does not touch the account row:
 * the caller writes that together with the journal entry.
 */
export async function applyProfileImageVerdict(
  socialAccountId: string,
  current: ProfileImageUrls,
  fetched: FetchedProfileImage,
  verdict: Extract<ProfileImageVerdict, { replace: true }>,
  /** When the bytes are already in storage (a manual upload), the row to reuse. */
  stored?: { cdnUrl: string; photoId: string },
): Promise<ProfileImageOutcome> {
  const { cdnUrl, photoId } = stored ?? (await storeProfileImage(fetched, socialAccountId));
  const { imageChange } = verdict;

  if (fetched.tier === "lq") {
    // A new picture only known at 150: whatever HQ we held is of the old picture.
    return { imageUrl: cdnUrl, imageUrlHq: null, imageChange, photoId };
  }
  const imageUrl = verdict.keepLq && current.imageUrl
    ? current.imageUrl
    : await storeProfileThumbnail(fetched.buffer, socialAccountId, photoId);
  return { imageUrl, imageUrlHq: cdnUrl, imageChange, photoId };
}

/**
 * A picture someone uploaded by hand (already in storage via /api/upload-image),
 * run through the same classifier as a scrape so a 1080 gets its 150 and the
 * journal says what happened. Null means leave the account as it is: the
 * picture is one we already hold, or its bytes could not be read back.
 */
export async function ingestManualProfileImage(
  socialAccountId: string,
  current: ProfileImageUrls,
  imageUrl: string,
): Promise<ProfileImageOutcome | null> {
  let fetched: FetchedProfileImage | null = null;
  const isStored = isStoredImageUrl(imageUrl);

  if (isStored) {
    const buffer = await readStoredImage(imageUrl);
    if (!buffer) return null;
    const contentType = imageUrl.endsWith(".png") ? "image/png" : imageUrl.endsWith(".webp") ? "image/webp" : "image/jpeg";
    fetched = await profileImageFromBuffer(buffer, contentType);
  } else {
    // External URL: must pass SSRF validation and host allowlist with chunked size caps and timeouts
    try {
      fetched = await fetchProfileImage(imageUrl);
    } catch {
      return null;
    }
  }

  const verdict = await classifyProfileImage(current, fetched);
  if (!verdict.replace) return null;

  if (!isStored) {
    // Store external profile image into PRM storage
    const stored = await storeProfileImage(fetched, socialAccountId);
    return applyProfileImageVerdict(socialAccountId, current, fetched, verdict, { cdnUrl: stored.cdnUrl, photoId: stored.photoId });
  }

  const facts = {
    prmLocation: `profile_image:${socialAccountId}`,
    fileHash: fetched.fileHash,
    widthPx: fetched.dims?.width ?? null,
    heightPx: fetched.dims?.height ?? null,
    perceptualHash: fetched.perceptualHash,
  };
  let photo = await storage.getPhotoByLocation(imageUrl);
  if (photo) {
    await db.update(photos).set(facts).where(eq(photos.id, photo.id));
  } else {
    photo = await storage.insertPhoto({ location: imageUrl, isSubImage: false, ogMetadata: fetched.ogMetadata, ...facts });
  }
  return applyProfileImageVerdict(socialAccountId, current, fetched, verdict, { cdnUrl: imageUrl, photoId: photo.id });
}

/** The account's current urls, for the classifier. */
export async function getCurrentProfileImageUrls(socialAccountId: string): Promise<ProfileImageUrls> {
  const [row] = await db
    .select({ imageUrl: socialAccounts.imageUrl, imageUrlHq: socialAccounts.imageUrlHq })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, socialAccountId));
  return { imageUrl: row?.imageUrl ?? null, imageUrlHq: row?.imageUrlHq ?? null };
}

/**
 * Normalises one account written before tiers existed: a 1080 sitting in
 * image_url moves to image_url_hq and a 150 webp takes its place. Nothing about
 * the picture changed, so no journal entry. Returns what it did.
 */
export async function backfillProfileImageTiers(
  account: { id: string } & ProfileImageUrls,
): Promise<"moved" | "already_lq" | "missing" | "skipped"> {
  if (!account.imageUrl || account.imageUrlHq) return "skipped";

  const photo = await storage.getPhotoByLocation(account.imageUrl);
  let widthPx = photo?.widthPx ?? null;
  let buffer: Buffer | null = null;
  if (!widthPx) {
    buffer = await readStoredImage(account.imageUrl);
    if (!buffer) return "missing";
    widthPx = getImageDimensions(buffer)?.width ?? (await sharp(buffer).metadata()).width ?? null;
  }
  if (tierOf(widthPx ? { width: widthPx } : null) === "lq") return "already_lq";

  buffer ??= await readStoredImage(account.imageUrl);
  if (!buffer) return "missing";
  const thumbUrl = await storeProfileThumbnail(buffer, account.id, photo?.id ?? null);
  await db
    .update(socialAccounts)
    .set({ imageUrl: thumbUrl, imageUrlHq: account.imageUrl })
    .where(eq(socialAccounts.id, account.id));
  return "moved";
}
