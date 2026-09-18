import fs from "fs";
import path from "path";
import { newUploadName, isSafeUploadExtension, type UploadKind } from "./upload-names";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function writeUpload(kind: UploadKind, buffer: Buffer, originalFilename: string, mimeType: string): string {
  const { fileName } = newUploadName(kind, originalFilename, mimeType);
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
  return fileName;
}

export async function uploadImageLocally(buffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
  return `/api/images/${writeUpload("image", buffer, originalFilename, mimeType)}`;
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

export async function uploadMediaLocally(buffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
  return `/api/media/${writeUpload("media", buffer, originalFilename, mimeType)}`;
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
  if (!isSafeUploadExtension("media", safeName.split(".").pop() || "")) {
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
