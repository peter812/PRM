import { STORAGE_MODES, type StorageMode } from "@shared/schema";
import { storage } from "./storage";
import { uploadImageLocally, uploadMediaLocally } from "./local-storage";
import { uploadImageToS3, uploadMediaToS3 } from "./s3";
import { uploadImageToPrmS3, uploadMediaToPrmS3 } from "./prm-s3";

// One backend for every image and video the app writes, chosen by an admin
// on Settings → Image Storage. It used to be per user plus a separate stories
// setting, which let background workers (running as no user, or as whichever
// user came first) send uploads to a bucket nobody had picked.
export const IMAGE_STORAGE_MODE_KEY = "image_storage_mode";

export function isStorageMode(value: unknown): value is StorageMode {
  return STORAGE_MODES.includes(value as StorageMode);
}

export async function getImageStorageMode(): Promise<StorageMode> {
  const mode = await storage.getAppSetting(IMAGE_STORAGE_MODE_KEY);
  return isStorageMode(mode) ? mode : "local";
}

export function setImageStorageMode(mode: StorageMode): Promise<void> {
  return storage.setAppSetting(IMAGE_STORAGE_MODE_KEY, mode);
}

/** Stores an image on the configured backend and returns the URL to save. */
export async function uploadImage(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const mode = await getImageStorageMode();
  if (mode === "local") return uploadImageLocally(buffer, filename, mimeType);
  if (mode === "prm-s3") return uploadImageToPrmS3(buffer, filename, mimeType);
  return uploadImageToS3(buffer, filename, mimeType);
}

/** Stores a video or audio file on the configured backend and returns the URL to save. */
export async function uploadMedia(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const mode = await getImageStorageMode();
  if (mode === "local") return uploadMediaLocally(buffer, filename, mimeType);
  if (mode === "prm-s3") return uploadMediaToPrmS3(buffer, filename, mimeType);
  return uploadMediaToS3(buffer, filename, mimeType);
}
