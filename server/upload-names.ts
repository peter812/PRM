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

export function isSafeUploadExtension(kind: UploadKind, ext: string): boolean {
  return UPLOAD_KINDS[kind].extensions.has(ext.toLowerCase());
}

/**
 * Validates the MIME type and mints a fresh file name with a safe extension.
 * `key` is that name under the kind's bucket prefix (images/… or media/…).
 * Throws on a MIME type we do not accept.
 */
export function newUploadName(kind: UploadKind, originalFilename: string, mimeType: string): { fileName: string; key: string } {
  const spec = UPLOAD_KINDS[kind];
  if (!spec.mimeTypes.has(mimeType.toLowerCase())) {
    throw new Error(`Invalid or unsafe ${kind} MIME type`);
  }
  let ext = originalFilename.split(".").pop()?.toLowerCase() || spec.fallbackExt;
  if (!spec.extensions.has(ext)) ext = spec.fallbackExt;
  const fileName = `${nanoid()}.${ext}`;
  return { fileName, key: `${spec.prefix}/${fileName}` };
}
