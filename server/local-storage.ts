import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function uploadImageLocally(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<string> {
  const fileExtension = originalFilename.split(".").pop() || "jpg";
  const fileName = `${nanoid()}.${fileExtension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  fs.writeFileSync(filePath, buffer);

  return `/api/images/${fileName}`;
}

export async function deleteImageLocally(imageUrl: string): Promise<void> {
  const fileName = imageUrl.split("/api/images/").pop();
  if (!fileName) {
    throw new Error("Invalid local image URL");
  }

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
