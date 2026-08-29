import { storage } from "./storage";
import { db } from "./db";
import { socialAccounts } from "@shared/schema";
import { uploadImageToS3 } from "./s3";
import { uploadImageLocally } from "./local-storage";
import { syncEntityInBackground } from "./vector-universal";
import { eq } from "drizzle-orm";
import crypto from "crypto";

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

/** Downloads and hashes a profile picture. Throws when the CDN refuses the request. */
export async function fetchProfileImage(imageUrl: string): Promise<FetchedProfileImage> {
  const response = await fetch(imageUrl, { headers: { "User-Agent": INSTAGRAM_USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Failed to download image: HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());

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
