import { storage } from "./storage";
import { uploadImageToS3 } from "./s3";
import { log } from "./vite";
import fs from "fs";
import path from "path";
import os from "os";

const INSTAGRAM_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1";

const POLL_INTERVAL_MS = 60_000;
const IMAGE_DOWNLOAD_DELAY_MS = 1_000;

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
      default:
        throw new Error(`Unknown task type: ${task.type}`);
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
