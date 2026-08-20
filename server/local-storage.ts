import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const SAFE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"]);
const SAFE_MIMETYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]);

export async function uploadImageLocally(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<string> {
  const cleanMimeType = mimeType.toLowerCase();
  if (!SAFE_MIMETYPES.has(cleanMimeType)) {
    throw new Error("Invalid or unsafe image MIME type");
  }

  let fileExtension = originalFilename.split(".").pop()?.toLowerCase() || "jpg";
  if (!SAFE_EXTENSIONS.has(fileExtension)) {
    fileExtension = "jpg";
  }

  const fileName = `${nanoid()}.${fileExtension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  fs.writeFileSync(filePath, buffer);

  return `/api/images/${fileName}`;
}

export async function deleteImageLocally(imageUrl: string): Promise<void> {
  const rawFileName = imageUrl.split("/api/images/").pop();
  if (!rawFileName) {
    throw new Error("Invalid local image URL");
  }

  const fileName = path.basename(rawFileName);
  const filePath = path.join(UPLOADS_DIR, fileName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function getLocalImagePath(fileName: string): string | null {
  const safeName = path.basename(fileName);
  const filePath = path.join(UPLOADS_DIR, safeName);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

export function isLocalImageUrl(url: string): boolean {
  return url.startsWith("/api/images/");
}

// ── Media (video/audio) storage ──
// Served via GET /api/media/:filename, which supports HTTP Range requests so
// <video>/<audio> elements can seek.

const SAFE_MEDIA_EXTENSIONS = new Set(["mp4", "m4a", "mp3", "webm", "mov", "ogg", "wav"]);
const SAFE_MEDIA_MIMETYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
]);

export async function uploadMediaLocally(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<string> {
  const cleanMimeType = mimeType.toLowerCase();
  if (!SAFE_MEDIA_MIMETYPES.has(cleanMimeType)) {
    throw new Error("Invalid or unsafe media MIME type");
  }

  let fileExtension = originalFilename.split(".").pop()?.toLowerCase() || "mp4";
  if (!SAFE_MEDIA_EXTENSIONS.has(fileExtension)) {
    fileExtension = "mp4";
  }

  const fileName = `${nanoid()}.${fileExtension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  fs.writeFileSync(filePath, buffer);

  return `/api/media/${fileName}`;
}

export async function deleteMediaLocally(mediaUrl: string): Promise<void> {
  const rawFileName = mediaUrl.split("/api/media/").pop();
  if (!rawFileName) {
    throw new Error("Invalid local media URL");
  }

  const fileName = path.basename(rawFileName);
  const filePath = path.join(UPLOADS_DIR, fileName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function getLocalMediaPath(fileName: string): string | null {
  const safeName = path.basename(fileName);
  const fileExtension = safeName.split(".").pop()?.toLowerCase() || "";
  if (!SAFE_MEDIA_EXTENSIONS.has(fileExtension)) {
    return null;
  }
  const filePath = path.join(UPLOADS_DIR, safeName);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

export function isLocalMediaUrl(url: string): boolean {
  return url.startsWith("/api/media/");
}
