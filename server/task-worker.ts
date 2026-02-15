import { storage } from "./storage";
import { uploadImageToS3, deleteImageFromS3 } from "./s3";
import { uploadImageLocally, deleteImageLocally, isLocalImageUrl } from "./local-storage";
import { log } from "./vite";
import fs from "fs";
import path from "path";
import os from "os";

const INSTAGRAM_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1";

const POLL_INTERVAL_MS = 60_000;
const IMAGE_DOWNLOAD_DELAY_MS = 1_000;
const REFRESH_DELAY_MS = 200;

let isProcessing = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function processGetImgTask(payload: {
  socialAccountId: string;
  imageUrl: string;
  profileVersionId?: string | null;
}): Promise<string> {
  const { socialAccountId, imageUrl, profileVersionId } = payload;

  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `task_img_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": INSTAGRAM_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download image: HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const tmpFilePath = `${tmpFile}.${ext}`;

    fs.writeFileSync(tmpFilePath, buffer);

    const cdnUrl = await uploadImageToS3(buffer, `instagram_profile.${ext}`, contentType);

    try {
      fs.unlinkSync(tmpFilePath);
    } catch {
    }

    if (profileVersionId) {
      await storage.updateProfileVersion(profileVersionId, { imageUrl: cdnUrl });
    } else {
      const currentProfile = await storage.getCurrentProfileVersion(socialAccountId);
      if (currentProfile) {
        await storage.updateProfileVersion(currentProfile.id, { imageUrl: cdnUrl });
      }
    }

    return JSON.stringify({ cdnUrl, socialAccountId });
  } catch (error) {
    try {
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(tmpFile)));
      for (const f of files) {
        fs.unlinkSync(path.join(tmpDir, f));
      }
    } catch {
    }
    throw error;
  }
}

async function processRefreshFollowerCount(payload: {
  socialAccountId: string;
}): Promise<string> {
  const { socialAccountId } = payload;
  const state = await storage.getNetworkState(socialAccountId);
  if (!state) {
    return JSON.stringify({ socialAccountId, message: "No network state found", followerCount: 0, followingCount: 0 });
  }
  const followerCount = state.followers?.length || 0;
  const followingCount = state.following?.length || 0;
  await storage.upsertNetworkState({
    socialAccountId,
    followers: state.followers || [],
    following: state.following || [],
  });
  return JSON.stringify({ socialAccountId, followerCount, followingCount });
}

async function isTaskCancelled(taskId: string): Promise<boolean> {
  const task = await storage.getTaskById(taskId);
  return !task || task.status === "cancelled" || task.status === "failed";
}

async function processMassRefreshFollowerCount(taskId: string): Promise<string> {
  const allAccounts = await storage.getAllSocialAccounts();
  let refreshed = 0;
  let skipped = 0;
  for (const account of allAccounts) {
    if (await isTaskCancelled(taskId)) {
      return JSON.stringify({ refreshed, skipped, total: allAccounts.length, cancelled: true });
    }
    const state = await storage.getNetworkState(account.id);
    if (!state) {
      skipped++;
      continue;
    }
    await storage.upsertNetworkState({
      socialAccountId: account.id,
      followers: state.followers || [],
      following: state.following || [],
    });
    refreshed++;
    await new Promise(resolve => setTimeout(resolve, REFRESH_DELAY_MS));
  }
  return JSON.stringify({ refreshed, skipped, total: allAccounts.length });
}

async function processTransferImagesToLocal(taskId: string): Promise<string> {
  const allUrls = await storage.getAllImageUrls();
  const s3Urls = allUrls.filter(u => !isLocalImageUrl(u.url));
  let transferred = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const entry of s3Urls) {
    if (await isTaskCancelled(taskId)) {
      return JSON.stringify({ transferred, failed, total: s3Urls.length, cancelled: true, errors });
    }

    try {
      const response = await fetch(entry.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "image/jpeg";
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";

      const localUrl = await uploadImageLocally(buffer, `transferred.${ext}`, contentType);
      await storage.updateImageUrl(entry.table, entry.id, entry.column, entry.url, localUrl);

      try {
        await deleteImageFromS3(entry.url);
      } catch (delErr) {
        log(`[TaskWorker] Warning: could not delete S3 image after transfer: ${entry.url}`);
      }

      transferred++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.table}/${entry.id}: ${msg}`);
      log(`[TaskWorker] Failed to transfer image to local: ${entry.url} - ${msg}`);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return JSON.stringify({ transferred, failed, total: s3Urls.length, errors });
}

async function processTransferImagesToS3(taskId: string): Promise<string> {
  const allUrls = await storage.getAllImageUrls();
  const localUrls = allUrls.filter(u => isLocalImageUrl(u.url));
  let transferred = 0;
  let failed = 0;
  const errors: string[] = [];

  const UPLOADS_DIR = path.join(process.cwd(), "uploads");

  for (const entry of localUrls) {
    if (await isTaskCancelled(taskId)) {
      return JSON.stringify({ transferred, failed, total: localUrls.length, cancelled: true, errors });
    }

    try {
      const fileName = entry.url.split("/api/images/").pop();
      if (!fileName) throw new Error("Invalid local URL");

      const filePath = path.join(UPLOADS_DIR, path.basename(fileName));
      if (!fs.existsSync(filePath)) {
        throw new Error("Local file not found");
      }

      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).replace(".", "") || "jpg";
      const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

      const s3Url = await uploadImageToS3(buffer, `transferred.${ext}`, mimeType);
      await storage.updateImageUrl(entry.table, entry.id, entry.column, entry.url, s3Url);

      try {
        await deleteImageLocally(entry.url);
      } catch (delErr) {
        log(`[TaskWorker] Warning: could not delete local image after transfer: ${entry.url}`);
      }

      transferred++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.table}/${entry.id}: ${msg}`);
      log(`[TaskWorker] Failed to transfer image to S3: ${entry.url} - ${msg}`);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return JSON.stringify({ transferred, failed, total: localUrls.length, errors });
}

async function processNextTask(): Promise<boolean> {
  const task = await storage.getNextPendingTask();
  if (!task) return false;

  log(`[TaskWorker] Processing task ${task.id} (type: ${task.type})`);
  await storage.updateTaskStatus(task.id, "in_progress");

  try {
    let result: string;

    switch (task.type) {
      case "get_img": {
        const payload = JSON.parse(task.payload);
        result = await processGetImgTask(payload);
        break;
      }
      case "refresh_follower_count": {
        const payload = JSON.parse(task.payload);
        result = await processRefreshFollowerCount(payload);
        break;
      }
      case "mass_refresh_follower_count": {
        result = await processMassRefreshFollowerCount(task.id);
        break;
      }
      case "transfer_images_to_local": {
        result = await processTransferImagesToLocal(task.id);
        break;
      }
      case "transfer_images_to_s3": {
        result = await processTransferImagesToS3(task.id);
        break;
      }
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }

    if (await isTaskCancelled(task.id)) {
      log(`[TaskWorker] Task ${task.id} was cancelled during processing`);
      return true;
    }
    await storage.updateTaskStatus(task.id, "completed", result);
    log(`[TaskWorker] Task ${task.id} completed`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`[TaskWorker] Task ${task.id} failed: ${errorMessage}`);
    await storage.updateTaskStatus(task.id, "failed", errorMessage);
    return true;
  }
}

async function runWorkerLoop() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    let hasMore = true;
    while (hasMore) {
      hasMore = await processNextTask();
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, IMAGE_DOWNLOAD_DELAY_MS));
      }
    }
  } catch (error) {
    log(`[TaskWorker] Worker loop error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isProcessing = false;
    schedulePoll();
  }
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    runWorkerLoop();
  }, POLL_INTERVAL_MS);
}

export function startTaskWorker() {
  log("[TaskWorker] Starting background task worker");
  runWorkerLoop();
}

export function triggerTaskWorker() {
  if (isProcessing) return;
  if (pollTimer) clearTimeout(pollTimer);
  runWorkerLoop();
}
