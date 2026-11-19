import { nanoid } from "nanoid";

// What every storage backend (local disk, S3, PRM-S3) accepts for the two kinds
// of user-supplied files it writes. One place, so a fix lands in all three.
const UPLOAD_KINDS: Record<UploadKind, { prefix: string; fallbackExt: string; extensions: Set<string>; mimeTypes: Set<string> }> = {
  image: {
    prefix: "images",
    fallbackExt: "jpg",
    extensions: new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"]),
    mimeTypes: new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]),
  },
  media: {
    prefix: "media",
    fallbackExt: "mp4",
    extensions: new Set(["mp4", "m4a", "mp3", "webm", "mov", "ogg", "wav"]),
    mimeTypes: new Set([
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "audio/mp4",
      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
      "audio/x-m4a",
    ]),
  },
};

export type UploadKind = "image" | "media";

export type ImageCategory = "generic" | "profile" | "post" | "story";

const CATEGORY_PREFIXES: Record<ImageCategory, string> = {
  generic: "images",
  profile: "profiles",
  post:    "posts",
  story:   "stories",
};

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

/**
 * Checks whether `buffer` starts with magic bytes matching an allowed format
 * for `kind`, preventing spoofed MIME types or extensions from bypassing upload checks.
 */
export function hasValidMagicBytes(kind: UploadKind, buffer: Buffer): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;

  if (kind === "image") {
    // JPEG: FF D8 FF
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    ) {
      return true;
    }
    // GIF: GIF87a / GIF89a
    if (
      buffer.length >= 6 &&
      buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
      (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
    ) {
      return true;
    }
    // WebP: RIFF....WEBP
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return true;
    }
    // HEIC/HEIF: ....ftyp<brand>
    if (
      buffer.length >= 12 &&
      buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
      HEIC_BRANDS.has(buffer.subarray(8, 12).toString("ascii"))
    ) {
      return true;
    }
    return false;
  }

  // media: MP4 / MOV / M4A (ISO BMFF ftyp box, excluding HEIC image brands)
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
    !HEIC_BRANDS.has(buffer.subarray(8, 12).toString("ascii"))
  ) {
    return true;
  }
  // WebM / Matroska: 1A 45 DF A3
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return true;
  }
  // OGG: OggS
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") {
    return true;
  }
  // WAV: RIFF....WAVE
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return true;
  }
  // MP3: ID3 tag or MPEG audio frame sync
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("ascii") === "ID3") {
    return true;
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return true;
  }
  return false;
}

export function isSafeUploadExtension(kind: UploadKind, ext: string): boolean {
  return UPLOAD_KINDS[kind].extensions.has(ext.toLowerCase());
}

/**
 * Validates the MIME type (and magic bytes when `buffer` is supplied) and mints
 * a fresh file name with a safe extension.
 * `key` is that name under the kind's bucket prefix (images/… or media/…).
 * Throws on a MIME type or file signature we do not accept.
 */
export function newUploadName(kind: UploadKind, originalFilename: string, mimeType: string, category?: ImageCategory, buffer?: Buffer): { fileName: string; key: string } {
  const spec = UPLOAD_KINDS[kind];
  if (!spec.mimeTypes.has(mimeType.toLowerCase())) {
    throw new Error(`Invalid or unsafe ${kind} MIME type`);
  }
  if (buffer !== undefined && !hasValidMagicBytes(kind, buffer)) {
    throw new Error(`Invalid or unsafe ${kind} file signature`);
  }
  let ext = originalFilename.split(".").pop()?.toLowerCase() || spec.fallbackExt;
  if (!spec.extensions.has(ext)) ext = spec.fallbackExt;
  const fileName = `${nanoid()}.${ext}`;
  const prefix = kind === "image" && category ? CATEGORY_PREFIXES[category] : spec.prefix;
  return { fileName, key: `${prefix}/${fileName}` };
}
