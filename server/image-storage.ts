import { STORAGE_MODES, type StorageMode } from "@shared/schema";
import { storage } from "./storage";
import { uploadImageLocally, uploadMediaLocally } from "./local-storage";
import { uploadImageToS3, uploadMediaToS3 } from "./s3";
import { getPrmS3Config, setPrmS3Config, uploadImageToPrmS3, uploadMediaToPrmS3 } from "./prm-s3";

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

/**
 * Tells PRM-compute the face-crop bucket may have changed. Compute reads the
 * storage mode and PRM-S3 credentials straight from app_settings (its DB is
 * this one), so this only pings POST /api/face/storage/reload; nothing is sent
 * in the body. In "prm-s3" mode the resolved config is written back first,
 * since compute can't see the env/hardcoded defaults PRM falls back to when
 * the admin has never saved the PRM-S3 settings. Best-effort: a missing or
 * offline compute server is logged, never thrown.
 */
export async function syncFaceCropStorage(): Promise<void> {
  // Older installs saved the compute connection under the prm_face_* keys.
  const apiUrl = (await storage.getAppSetting("prm_compute_api_url")) || (await storage.getAppSetting("prm_face_api_url"));
  const apiKey = (await storage.getAppSetting("prm_compute_api_key")) || (await storage.getAppSetting("prm_face_api_key"));
  if (!apiUrl || !apiKey) return;

  const mode = await getImageStorageMode();
  if (mode === "prm-s3") await setPrmS3Config(await getPrmS3Config());

  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/face/storage/reload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error(`syncFaceCropStorage: PRM-compute rejected ${mode} storage: ${await response.text()}`);
    }
  } catch (err: any) {
    console.error(`syncFaceCropStorage: could not reach PRM-compute: ${err.message}`);
  }
}
