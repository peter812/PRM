import { storage } from "./storage";
import { db } from "./db";
import { syncEntityInBackground } from "./vector-universal";
import { uploadImageToS3, deleteImageFromS3 } from "./s3";
import { uploadImageLocally, deleteImageLocally, isLocalImageUrl } from "./local-storage";
import { log } from "./vite";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { eq, isNotNull } from "drizzle-orm";
import {
  people,
  tasks,
  imageTasks,
  relationshipTypes,
  interactionTypes,
  socialNetworkChanges,
  socialAccountPosts,
} from "@shared/schema";

// ── Image dimension helper ────────────────────────────────────────────────────

function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
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

const INSTAGRAM_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1";

const POLL_INTERVAL_MS = 60_000;
const IMAGE_DOWNLOAD_DELAY_MS = 1_000;
const REFRESH_DELAY_MS = 200;

let isProcessing = false;
let isPaused = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// ── Image task worker state ───────────────────────────────────────────────────
let isImageProcessing = false;
let imageTaskPollTimer: ReturnType<typeof setTimeout> | null = null;

// ── Image task handlers ───────────────────────────────────────────────────────

async function processDownloadImgInstagram(imageTaskId: string, payload: {
  socialAccountId: string;
  imageUrl: string;
  profileVersionId?: string | null;
}): Promise<string> {
  const { socialAccountId, imageUrl, profileVersionId } = payload;

  const response = await fetch(imageUrl, {
    headers: { "User-Agent": INSTAGRAM_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Failed to download image: HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";

  // Capture OpenGraph-style metadata about where this file came from. This is
  // intentionally lightweight (response headers + source URL) so it can be
  // recorded for every file added to storage without extra network round-trips.
  const ogMetadata: Record<string, unknown> = {
    sourceUrl: imageUrl,
    contentType,
    contentLength: response.headers.get("content-length"),
    lastModified: response.headers.get("last-modified"),
    etag: response.headers.get("etag"),
    fetchedAt: new Date().toISOString(),
  };

  // Compute file hash for deduplication
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const dims = getImageDimensions(buffer);

  // Get current profile version to check existing image for THIS account
  const currentVersion = await storage.getCurrentProfileVersion(socialAccountId);
  const targetVersionId = profileVersionId || currentVersion?.id || null;
  if (currentVersion?.imageUrl) {
    // Fetch the photo record for THIS account's current image (scoped, not global)
    const existingPhotoByLocation = await storage.getPhotoByLocation(currentVersion.imageUrl);
    if (existingPhotoByLocation) {
      // Same hash → same content, skip entirely
      if (existingPhotoByLocation.fileHash === fileHash) {
        log(`[ImageWorker] Skipping download for ${socialAccountId} — same hash as current profile photo`);
        return JSON.stringify({ skipped: true, reason: "same_hash", socialAccountId });
      }
      // Existing photo has equal or better resolution → skip
      if (existingPhotoByLocation.widthPx && dims && dims.width <= existingPhotoByLocation.widthPx) {
        log(`[ImageWorker] Skipping download for ${socialAccountId} — existing (${existingPhotoByLocation.widthPx}px) >= new (${dims.width}px)`);
        return JSON.stringify({ skipped: true, reason: "lower_resolution", socialAccountId });
      }
    }
  }

  // Re-check cancellation before performing upload (slow I/O)
  const freshTask = await storage.getImageTaskById(imageTaskId);
  if (!freshTask || freshTask.status === "cancelled") {
    log(`[ImageWorker] Task ${imageTaskId} cancelled before upload — aborting`);
    return JSON.stringify({ skipped: true, reason: "cancelled", socialAccountId });
  }

  // Determine which storage provider to use
  let cdnUrl: string;
  try {
    const user = (await storage.getAllUsers())[0];
    const storageMode = user ? await storage.getImageStorageMode(user.id) : "s3";
    if (storageMode === "local") {
      cdnUrl = await uploadImageLocally(buffer, `instagram_profile.${ext}`, contentType);
    } else {
      cdnUrl = await uploadImageToS3(buffer, `instagram_profile.${ext}`, contentType);
    }
  } catch {
    cdnUrl = await uploadImageToS3(buffer, `instagram_profile.${ext}`, contentType);
  }

  // Re-check cancellation again after upload before persisting changes
  const postUploadTask = await storage.getImageTaskById(imageTaskId);
  if (!postUploadTask || postUploadTask.status === "cancelled") {
    log(`[ImageWorker] Task ${imageTaskId} cancelled after upload — skipping DB writes`);
    return JSON.stringify({ skipped: true, reason: "cancelled_post_upload", socialAccountId });
  }

  // Register in photos table with hash and dimensions (let errors propagate to fail the task)
  const photo = await storage.insertPhoto({
    location: cdnUrl,
    prmLocation: `profile_image:${socialAccountId}`,
    isSubImage: false,
    fileHash,
    widthPx: dims?.width ?? null,
    heightPx: dims?.height ?? null,
    ogMetadata,
  });

  syncEntityInBackground("image", photo.id);

  // Update profile version image URL
  if (targetVersionId) {
    await storage.updateProfileVersion(targetVersionId, { imageUrl: cdnUrl });
  }

  // Link the photo to this image task
  await db.update(imageTasks).set({ photoId: photo.id }).where(eq(imageTasks.id, imageTaskId));

  return JSON.stringify({ cdnUrl, socialAccountId, photoId: photo.id, widthPx: dims?.width ?? null });
}

async function processAnalyzeImgFull(imageTaskId: string, payload: { photoId?: string }): Promise<string> {
  log(`[ImageWorker] analyze_img_full stub — photoId: ${payload.photoId ?? "none"}`);
  return JSON.stringify({ stub: true, note: "Face detection, metadata extraction, and LLM analysis not yet implemented" });
}

async function processAnalyzeImgFace(imageTaskId: string, payload: { photoId?: string }): Promise<string> {
  log(`[ImageWorker] analyze_img_face stub — photoId: ${payload.photoId ?? "none"}`);
  return JSON.stringify({ stub: true, note: "Face detection not yet implemented" });
}

async function processAnalyzeImgMetadata(imageTaskId: string, payload: { photoId?: string }): Promise<string> {
  log(`[ImageWorker] analyze_img_metadata stub — photoId: ${payload.photoId ?? "none"}`);
  return JSON.stringify({ stub: true, note: "Metadata extraction not yet implemented" });
}

async function processAnalyzeImgLlm(imageTaskId: string, payload: { photoId?: string }): Promise<string> {
  log(`[ImageWorker] analyze_img_llm stub — photoId: ${payload.photoId ?? "none"}`);
  return JSON.stringify({ stub: true, note: "LLM image analysis not yet implemented" });
}

async function processConvertImg(imageTaskId: string, payload: { photoId?: string; targetFormat?: string; maxWidthPx?: number }): Promise<string> {
  log(`[ImageWorker] convert_img stub — photoId: ${payload.photoId ?? "none"}`);
  return JSON.stringify({ stub: true, note: "Image conversion not yet implemented" });
}

async function processNextImageTask(): Promise<boolean> {
  const task = await storage.getNextPendingImageTask();
  if (!task) return false;

  log(`[ImageWorker] Processing image task ${task.id} (type: ${task.type})`);
  await storage.updateImageTaskStatus(task.id, "in_progress");

  try {
    let result: string;
    const payload = JSON.parse(task.payload || "{}");

    switch (task.type) {
      case "download_img_instagram":
        result = await processDownloadImgInstagram(task.id, payload);
        break;
      case "analyze_img_full":
        result = await processAnalyzeImgFull(task.id, payload);
        break;
      case "analyze_img_face":
        result = await processAnalyzeImgFace(task.id, payload);
        break;
      case "analyze_img_metadata":
        result = await processAnalyzeImgMetadata(task.id, payload);
        break;
      case "analyze_img_llm":
        result = await processAnalyzeImgLlm(task.id, payload);
        break;
      case "convert_img":
        result = await processConvertImg(task.id, payload);
        break;
      default:
        throw new Error(`Unknown image task type: ${task.type}`);
    }

    // Re-check cancellation before persisting completed state — a DELETE during execution should win
    const postHandlerTask = await storage.getImageTaskById(task.id);
    if (postHandlerTask?.status === "cancelled") {
      log(`[ImageWorker] Image task ${task.id} was cancelled during execution — preserving cancelled state`);
    } else {
      await storage.updateImageTaskStatus(task.id, "completed", result);
      log(`[ImageWorker] Image task ${task.id} completed`);
    }
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`[ImageWorker] Image task ${task.id} failed: ${errorMessage}`);
    // Only write failed state if not already cancelled
    const postErrorTask = await storage.getImageTaskById(task.id).catch(() => null);
    if (!postErrorTask || postErrorTask.status !== "cancelled") {
      await storage.updateImageTaskStatus(task.id, "failed", errorMessage);
    }
    return true;
  }
}

async function runImageTaskWorkerLoop() {
  if (isImageProcessing || isPaused) return;
  isImageProcessing = true;
  try {
    let hasMore = true;
    while (hasMore && !isPaused) {
      hasMore = await processNextImageTask();
      if (hasMore && !isPaused) {
        await new Promise(resolve => setTimeout(resolve, IMAGE_DOWNLOAD_DELAY_MS));
      }
    }
  } catch (error) {
    log(`[ImageWorker] Worker loop error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isImageProcessing = false;
    if (!isPaused) scheduleImagePoll();
  }
}

function scheduleImagePoll() {
  if (imageTaskPollTimer) clearTimeout(imageTaskPollTimer);
  imageTaskPollTimer = setTimeout(() => {
    runImageTaskWorkerLoop();
  }, POLL_INTERVAL_MS);
}

export function triggerImageTaskWorker() {
  if (isImageProcessing || isPaused) return;
  if (imageTaskPollTimer) clearTimeout(imageTaskPollTimer);
  runImageTaskWorkerLoop();
}

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

// ── XML helpers (shared by export and import tasks) ─────────────────────────

function escapeXml(str: any): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function arrayToXml(arr: any[], itemName: string): string {
  if (!arr || arr.length === 0) return "";
  return arr.map(item => `<${itemName}>${escapeXml(item)}</${itemName}>`).join("");
}

function parseXmlTag(tagName: string, text: string): string {
  const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "s");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function parseXmlArray(containerTag: string, itemTag: string, text: string): string[] {
  const containerContent = parseXmlTag(containerTag, text);
  if (!containerContent) return [];
  const itemRegex = new RegExp(`<${itemTag}>(.*?)</${itemTag}>`, "gs");
  const matches = containerContent.matchAll(itemRegex);
  return Array.from(matches).map(m => m[1].trim());
}

function parseAllTags(tagName: string, text: string): string[] {
  const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gs");
  const matches = text.matchAll(regex);
  return Array.from(matches).map(m => m[1].trim());
}

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── Export XML task ──────────────────────────────────────────────────────────

async function processExportXmlTask(taskId: string, payload: {
  includeHistory: boolean;
  userId: number;
}): Promise<string> {
  const { includeHistory } = payload;
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

  await storage.updateTaskProgress(taskId, 2, "Fetching data…");

  // Run queries in small sequential batches to avoid exhausting the DB connection pool
  const [allUsers, allPeople, allRelationshipTypes, allRelationships] = await Promise.all([
    storage.getAllUsers(),
    storage.getAllPeople(),
    storage.getAllRelationshipTypes(),
    storage.getAllRelationships(),
  ]);

  const [allInteractionTypes, allInteractions, allGroups, allNotes] = await Promise.all([
    storage.getAllInteractionTypes(),
    storage.getAllInteractions(),
    storage.getAllGroups(),
    storage.getAllNotes(),
  ]);

  const [allGroupNotes, allSocialAccounts, allSocialAccountTypes] = await Promise.all([
    storage.getAllGroupNotes(),
    storage.getAllSocialAccounts(),
    storage.getAllSocialAccountTypes(),
  ]);

  const [allProfileVersions, allNetworkStates, mePersonResult] = await Promise.all([
    storage.getAllProfileVersions(),
    storage.getAllNetworkStates(),
    db.select().from(people).where(isNotNull(people.userId)).limit(1),
  ]);

  const user = allUsers[0];
  const mePersonId = mePersonResult[0]?.id || null;
  const peopleToExport = allPeople.filter(p => p.id !== mePersonId);
  const networkStateMap = new Map(allNetworkStates.map(s => [s.socialAccountId, s]));

  await storage.updateTaskProgress(taskId, 8, "Building export file…");

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<crm_data>\n';

  xml += '  <user_profile>\n';
  xml += `    <name>${escapeXml(user?.name || "")}</name>\n`;
  xml += `    <nickname>${escapeXml(user?.nickname || "")}</nickname>\n`;
  xml += '  </user_profile>\n';

  xml += '  <relationship_types>\n';
  for (const type of allRelationshipTypes) {
    xml += '    <relationship_type>\n';
    xml += `      <id>${escapeXml(type.id)}</id>\n`;
    xml += `      <name>${escapeXml(type.name)}</name>\n`;
    xml += `      <color>${escapeXml(type.color)}</color>\n`;
    xml += `      <value>${escapeXml(type.value)}</value>\n`;
    xml += `      <notes>${escapeXml(type.notes || "")}</notes>\n`;
    xml += `      <created_at>${escapeXml(type.createdAt)}</created_at>\n`;
    xml += '    </relationship_type>\n';
  }
  xml += '  </relationship_types>\n';

  xml += '  <interaction_types>\n';
  for (const type of allInteractionTypes) {
    xml += '    <interaction_type>\n';
    xml += `      <id>${escapeXml(type.id)}</id>\n`;
    xml += `      <name>${escapeXml(type.name)}</name>\n`;
    xml += `      <color>${escapeXml(type.color)}</color>\n`;
    xml += `      <description>${escapeXml(type.description || "")}</description>\n`;
    xml += `      <value>${escapeXml(type.value)}</value>\n`;
    xml += `      <created_at>${escapeXml(type.createdAt)}</created_at>\n`;
    xml += '    </interaction_type>\n';
  }
  xml += '  </interaction_types>\n';

  await storage.updateTaskProgress(taskId, 15, "Exporting people…");

  xml += '  <people>\n';
  for (const person of peopleToExport) {
    xml += '    <person>\n';
    xml += `      <id>${escapeXml(person.id)}</id>\n`;
    xml += `      <first_name>${escapeXml(person.firstName)}</first_name>\n`;
    xml += `      <last_name>${escapeXml(person.lastName)}</last_name>\n`;
    xml += `      <email>${escapeXml(person.email || "")}</email>\n`;
    xml += `      <phone>${escapeXml(person.phone || "")}</phone>\n`;
    xml += `      <company>${escapeXml(person.company || "")}</company>\n`;
    xml += `      <title>${escapeXml(person.title || "")}</title>\n`;
    xml += `      <tags>${arrayToXml(person.tags || [], "tag")}</tags>\n`;
    xml += `      <image_url>${escapeXml(person.imageUrl || "")}</image_url>\n`;
    xml += `      <social_account_uuids>${arrayToXml(person.socialAccountUuids || [], "social_account_uuid")}</social_account_uuids>\n`;
    xml += `      <is_starred>${escapeXml(person.isStarred)}</is_starred>\n`;
    xml += `      <elo_score>${escapeXml(person.eloScore)}</elo_score>\n`;
    xml += `      <no_social_media>${escapeXml(person.noSocialMedia ?? 0)}</no_social_media>\n`;
    xml += `      <created_at>${escapeXml(person.createdAt)}</created_at>\n`;
    xml += '    </person>\n';
  }
  xml += '  </people>\n';

  await storage.updateTaskProgress(taskId, 28, "Exporting relationships…");

  xml += '  <relationships>\n';
  for (const rel of allRelationships) {
    const fromPersonId = rel.fromPersonId === mePersonId ? ZERO_UUID : rel.fromPersonId;
    const toPersonId = rel.toPersonId === mePersonId ? ZERO_UUID : rel.toPersonId;
    xml += '    <relationship>\n';
    xml += `      <id>${escapeXml(rel.id)}</id>\n`;
    xml += `      <from_person_id>${escapeXml(fromPersonId)}</from_person_id>\n`;
    xml += `      <to_person_id>${escapeXml(toPersonId)}</to_person_id>\n`;
    xml += `      <type_id>${escapeXml(rel.typeId)}</type_id>\n`;
    xml += `      <notes>${escapeXml(rel.notes || "")}</notes>\n`;
    xml += `      <created_at>${escapeXml(rel.createdAt)}</created_at>\n`;
    xml += '    </relationship>\n';
  }
  xml += '  </relationships>\n';

  await storage.updateTaskProgress(taskId, 38, "Exporting groups & interactions…");

  xml += '  <groups>\n';
  for (const group of allGroups) {
    const members = (group.members || []).map(id => id === mePersonId ? ZERO_UUID : id);
    xml += '    <group>\n';
    xml += `      <id>${escapeXml(group.id)}</id>\n`;
    xml += `      <name>${escapeXml(group.name)}</name>\n`;
    xml += `      <color>${escapeXml(group.color)}</color>\n`;
    xml += `      <type>${arrayToXml(group.type || [], "group_type")}</type>\n`;
    xml += `      <members>${arrayToXml(members, "member_id")}</members>\n`;
    xml += `      <image_url>${escapeXml(group.imageUrl || "")}</image_url>\n`;
    xml += `      <created_at>${escapeXml(group.createdAt)}</created_at>\n`;
    xml += '    </group>\n';
  }
  xml += '  </groups>\n';

  xml += '  <interactions>\n';
  for (const interaction of allInteractions) {
    const peopleIds = (interaction.peopleIds || []).map(id => id === mePersonId ? ZERO_UUID : id);
    xml += '    <interaction>\n';
    xml += `      <id>${escapeXml(interaction.id)}</id>\n`;
    xml += `      <type_id>${escapeXml(interaction.typeId)}</type_id>\n`;
    xml += `      <title>${escapeXml(interaction.title || "")}</title>\n`;
    xml += `      <date>${escapeXml(interaction.date)}</date>\n`;
    xml += `      <description>${escapeXml(interaction.description || "")}</description>\n`;
    xml += `      <image_url>${escapeXml(interaction.imageUrl || "")}</image_url>\n`;
    xml += `      <image_uuid>${escapeXml(interaction.imageUuid || "")}</image_uuid>\n`;
    xml += `      <people_ids>${arrayToXml(peopleIds, "person_id")}</people_ids>\n`;
    xml += `      <group_ids>${arrayToXml(interaction.groupIds || [], "group_id")}</group_ids>\n`;
    xml += `      <created_at>${escapeXml(interaction.createdAt)}</created_at>\n`;
    xml += '    </interaction>\n';
  }
  xml += '  </interactions>\n';

  await storage.updateTaskProgress(taskId, 48, "Exporting notes…");

  xml += '  <notes>\n';
  for (const note of allNotes) {
    if (note.personId === mePersonId) continue;
    xml += '    <note>\n';
    xml += `      <id>${escapeXml(note.id)}</id>\n`;
    xml += `      <person_id>${escapeXml(note.personId)}</person_id>\n`;
    xml += `      <content>${escapeXml(note.content)}</content>\n`;
    xml += `      <image_url>${escapeXml(note.imageUrl || "")}</image_url>\n`;
    xml += `      <image_uuid>${escapeXml(note.imageUuid || "")}</image_uuid>\n`;
    xml += `      <created_at>${escapeXml(note.createdAt)}</created_at>\n`;
    xml += '    </note>\n';
  }
  xml += '  </notes>\n';

  xml += '  <group_notes>\n';
  for (const note of allGroupNotes) {
    xml += '    <group_note>\n';
    xml += `      <id>${escapeXml(note.id)}</id>\n`;
    xml += `      <group_id>${escapeXml(note.groupId)}</group_id>\n`;
    xml += `      <content>${escapeXml(note.content)}</content>\n`;
    xml += `      <created_at>${escapeXml(note.createdAt)}</created_at>\n`;
    xml += '    </group_note>\n';
  }
  xml += '  </group_notes>\n';

  await storage.updateTaskProgress(taskId, 58, "Exporting social accounts…");

  xml += '  <social_accounts>\n';
  for (const account of allSocialAccounts) {
    const ownerUuid = account.ownerUuid === mePersonId ? ZERO_UUID : account.ownerUuid;
    const accountState = networkStateMap.get(account.id);
    xml += '    <social_account>\n';
    xml += `      <id>${escapeXml(account.id)}</id>\n`;
    xml += `      <username>${escapeXml(account.username)}</username>\n`;
    xml += `      <nickname>${escapeXml(account.currentProfile?.nickname || "")}</nickname>\n`;
    xml += `      <account_url>${escapeXml(account.currentProfile?.accountUrl || "")}</account_url>\n`;
    xml += `      <owner_uuid>${escapeXml(ownerUuid || "")}</owner_uuid>\n`;
    xml += `      <type_id>${escapeXml(account.typeId || "")}</type_id>\n`;
    xml += `      <image_url>${escapeXml(account.currentProfile?.imageUrl || "")}</image_url>\n`;
    xml += `      <notes></notes>\n`;
    xml += `      <following>${arrayToXml(accountState?.following || [], "account_id")}</following>\n`;
    xml += `      <followers>${arrayToXml(accountState?.followers || [], "account_id")}</followers>\n`;
    xml += `      <internal_account_creation_date>${escapeXml(account.internalAccountCreationDate)}</internal_account_creation_date>\n`;
    xml += `      <internal_account_creation_type>${escapeXml(account.internalAccountCreationType)}</internal_account_creation_type>\n`;
    xml += `      <created_at>${escapeXml(account.createdAt)}</created_at>\n`;
    xml += '    </social_account>\n';
  }
  xml += '  </social_accounts>\n';

  await storage.updateTaskProgress(taskId, 68, "Exporting social account types…");

  xml += '  <social_account_types>\n';
  for (const type of allSocialAccountTypes) {
    xml += '    <social_account_type>\n';
    xml += `      <id>${escapeXml(type.id)}</id>\n`;
    xml += `      <name>${escapeXml(type.name)}</name>\n`;
    xml += `      <color>${escapeXml(type.color)}</color>\n`;
    xml += `      <created_at>${escapeXml(type.createdAt)}</created_at>\n`;
    xml += '    </social_account_type>\n';
  }
  xml += '  </social_account_types>\n';

  await storage.updateTaskProgress(taskId, 76, "Exporting posts…");

  const allPosts = await storage.getAllPosts();
  xml += '  <social_account_posts>\n';
  for (const post of allPosts) {
    xml += '    <social_account_post>\n';
    xml += `      <id>${escapeXml(post.id)}</id>\n`;
    xml += `      <social_account_id>${escapeXml(post.socialAccountId)}</social_account_id>\n`;
    xml += `      <post_type>${escapeXml(post.postType)}</post_type>\n`;
    xml += `      <content>${escapeXml(post.content || "")}</content>\n`;
    xml += `      <description>${escapeXml(post.description || "")}</description>\n`;
    xml += `      <like_count>${escapeXml(post.likeCount)}</like_count>\n`;
    xml += `      <comment_count>${escapeXml(post.commentCount)}</comment_count>\n`;
    xml += `      <comments>${escapeXml(post.comments || "")}</comments>\n`;
    xml += `      <mentioned_accounts>${escapeXml(post.mentionedAccounts || "")}</mentioned_accounts>\n`;
    xml += `      <posted_at>${escapeXml(post.postedAt || "")}</posted_at>\n`;
    xml += `      <created_at>${escapeXml(post.createdAt)}</created_at>\n`;
    xml += '    </social_account_post>\n';
  }
  xml += '  </social_account_posts>\n';

  if (includeHistory) {
    await storage.updateTaskProgress(taskId, 84, "Exporting profile history…");

    xml += '  <social_profile_versions>\n';
    for (const version of allProfileVersions) {
      xml += '    <social_profile_version>\n';
      xml += `      <id>${escapeXml(version.id)}</id>\n`;
      xml += `      <social_account_id>${escapeXml(version.socialAccountId)}</social_account_id>\n`;
      xml += `      <nickname>${escapeXml(version.nickname || "")}</nickname>\n`;
      xml += `      <bio>${escapeXml(version.bio || "")}</bio>\n`;
      xml += `      <account_url>${escapeXml(version.accountUrl || "")}</account_url>\n`;
      xml += `      <image_url>${escapeXml(version.imageUrl || "")}</image_url>\n`;
      xml += `      <external_image_url>${escapeXml(version.externalImageUrl || "")}</external_image_url>\n`;
      xml += `      <is_current>${escapeXml(version.isCurrent)}</is_current>\n`;
      xml += `      <detected_at>${escapeXml(version.detectedAt)}</detected_at>\n`;
      xml += '    </social_profile_version>\n';
    }
    xml += '  </social_profile_versions>\n';

    xml += '  <social_network_snapshots>\n';
    for (const state of allNetworkStates) {
      xml += '    <social_network_snapshot>\n';
      xml += `      <id>${escapeXml(state.id)}</id>\n`;
      xml += `      <social_account_id>${escapeXml(state.socialAccountId)}</social_account_id>\n`;
      xml += `      <follower_count>${escapeXml(state.followerCount)}</follower_count>\n`;
      xml += `      <following_count>${escapeXml(state.followingCount)}</following_count>\n`;
      xml += `      <followers>${arrayToXml(state.followers || [], "account_id")}</followers>\n`;
      xml += `      <following>${arrayToXml(state.following || [], "account_id")}</following>\n`;
      xml += `      <captured_at>${escapeXml(state.updatedAt)}</captured_at>\n`;
      xml += '    </social_network_snapshot>\n';
    }
    xml += '  </social_network_snapshots>\n';

    await storage.updateTaskProgress(taskId, 92, "Exporting network changes…");

    const allNetworkChanges = await storage.getAllNetworkChanges();
    xml += '  <social_network_changes>\n';
    for (const change of allNetworkChanges) {
      xml += '    <social_network_change>\n';
      xml += `      <id>${escapeXml(change.id)}</id>\n`;
      xml += `      <social_account_id>${escapeXml(change.socialAccountId)}</social_account_id>\n`;
      xml += `      <change_type>${escapeXml(change.changeType)}</change_type>\n`;
      xml += `      <direction>${escapeXml(change.direction)}</direction>\n`;
      xml += `      <target_account_id>${escapeXml(change.targetAccountId)}</target_account_id>\n`;
      xml += `      <detected_at>${escapeXml(change.detectedAt)}</detected_at>\n`;
      xml += `      <batch_id>${escapeXml(change.batchId || "")}</batch_id>\n`;
      xml += '    </social_network_change>\n';
    }
    xml += '  </social_network_changes>\n';
  }

  xml += '</crm_data>';

  await storage.updateTaskProgress(taskId, 99, "Saving file…");

  const exportsDir = path.join(process.cwd(), "exports");
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  const fileName = `crm-export-${taskId}.xml`;
  const filePath = path.join(exportsDir, fileName);
  fs.writeFileSync(filePath, xml, "utf8");

  return `exports/${fileName}`;
}

// ── Import XML task ──────────────────────────────────────────────────────────

async function processImportXmlTask(taskId: string, payload: {
  xml: string;
  userId: number;
}): Promise<string> {
  const xmlText = payload.xml;
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

  const mePersonResult = await db.select().from(people).where(isNotNull(people.userId)).limit(1);
  const mePersonId = mePersonResult[0]?.id || null;

  const replaceZeroUUID = (uuid: string): string => {
    if (!mePersonId) return uuid;
    return uuid === ZERO_UUID ? mePersonId : uuid;
  };

  let importedCounts: Record<string, number> = {
    relationshipTypes: 0, interactionTypes: 0, people: 0,
    relationships: 0, groups: 0, interactions: 0,
    notes: 0, groupNotes: 0, socialAccounts: 0,
    socialAccountTypes: 0, posts: 0, messages: 0, networkChanges: 0,
  };
  let skippedCounts: Record<string, number> = {
    relationshipTypes: 0, interactionTypes: 0, people: 0,
    relationships: 0, interactions: 0, socialAccounts: 0, socialAccountTypes: 0, messages: 0,
  };

  await storage.updateTaskProgress(taskId, 5, "Loading existing data…");

  const [
    existingRelationshipTypes,
    existingInteractionTypes,
    existingPeople,
    existingRelationships,
    existingInteractions,
    existingSocialAccounts,
  ] = await Promise.all([
    storage.getAllRelationshipTypes(),
    storage.getAllInteractionTypes(),
    storage.getAllPeople(),
    storage.getAllRelationships(),
    storage.getAllInteractions(),
    storage.getAllSocialAccounts(),
  ]);

  const existingRelationshipTypeUuids = new Set(existingRelationshipTypes.map(t => t.id));
  const existingInteractionTypeUuids = new Set(existingInteractionTypes.map(t => t.id));
  const existingRelationshipUuids = new Set(existingRelationships.map(r => r.id));
  const existingInteractionUuids = new Set(existingInteractions.map(i => i.id));
  const existingSocialAccountUuids = new Set(existingSocialAccounts.map(s => s.id));

  await storage.updateTaskProgress(taskId, 10, "Importing relationship types…");

  for (const block of parseAllTags("relationship_type", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const notes = unescapeXml(parseXmlTag("notes", block));
    if (existingRelationshipTypeUuids.has(id)) { skippedCounts.relationshipTypes++; continue; }
    try {
      await db.insert(relationshipTypes).values({ id, name, color, notes: notes || null, value: 50 }).onConflictDoNothing();
      importedCounts.relationshipTypes++;
      existingRelationshipTypeUuids.add(id);
    } catch (e) { console.error(`Error importing relationship type ${id}:`, e); }
  }

  for (const block of parseAllTags("interaction_type", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const description = unescapeXml(parseXmlTag("description", block));
    const value = parseInt(parseXmlTag("value", block)) || 50;
    if (existingInteractionTypeUuids.has(id)) { skippedCounts.interactionTypes++; continue; }
    try {
      await db.insert(interactionTypes).values({ id, name, color, description: description || null, value }).onConflictDoNothing();
      importedCounts.interactionTypes++;
      existingInteractionTypeUuids.add(id);
    } catch (e) { console.error(`Error importing interaction type ${id}:`, e); }
  }

  await storage.updateTaskProgress(taskId, 20, "Importing people…");

  const existingPeopleMap = new Map<string, boolean>();
  for (const p of existingPeople) {
    existingPeopleMap.set(`${p.firstName.toLowerCase()}:${p.id}`, true);
  }
  for (const block of parseAllTags("person", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const firstName = unescapeXml(parseXmlTag("first_name", block));
    const lastName = unescapeXml(parseXmlTag("last_name", block));
    const email = unescapeXml(parseXmlTag("email", block));
    const phone = unescapeXml(parseXmlTag("phone", block));
    const company = unescapeXml(parseXmlTag("company", block));
    const title = unescapeXml(parseXmlTag("title", block));
    const tags = parseXmlArray("tags", "tag", block);
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const socialAccountUuids = parseXmlArray("social_account_uuids", "social_account_uuid", block);
    const isStarred = parseInt(parseXmlTag("is_starred", block)) || 0;
    const eloScore = parseInt(parseXmlTag("elo_score", block)) || 1200;
    const noSocialMedia = parseInt(parseXmlTag("no_social_media", block)) || 0;
    const lookupKey = `${firstName.toLowerCase()}:${id}`;
    if (existingPeopleMap.has(lookupKey)) { skippedCounts.people++; continue; }
    try {
      await storage.createPersonWithId({
        id, firstName, lastName,
        email: email || null, phone: phone || null, company: company || null, title: title || null,
        tags: tags.length > 0 ? tags : [],
        imageUrl: imageUrl || null,
        socialAccountUuids: socialAccountUuids.length > 0 ? socialAccountUuids : [],
        isStarred, eloScore, noSocialMedia,
      });
      importedCounts.people++;
      existingPeopleMap.set(lookupKey, true);
    } catch (e) { console.error(`Error importing person ${id}:`, e); }
  }

  await storage.updateTaskProgress(taskId, 30, "Importing groups…");

  for (const block of parseAllTags("group", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const type = parseXmlArray("type", "group_type", block);
    const members = parseXmlArray("members", "member_id", block);
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const processedMembers = members.map(m => replaceZeroUUID(m));
    try {
      await storage.createGroupWithId({
        id, name, color,
        type: type.length > 0 ? type : [],
        members: processedMembers.length > 0 ? processedMembers : [],
        imageUrl: imageUrl || null,
      });
      importedCounts.groups++;
    } catch (e) { console.error(`Error importing group ${id}:`, e); }
  }

  await storage.updateTaskProgress(taskId, 40, "Importing relationships & interactions…");

  for (const block of parseAllTags("relationship", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const fromPersonId = replaceZeroUUID(unescapeXml(parseXmlTag("from_person_id", block)));
    const toPersonId = replaceZeroUUID(unescapeXml(parseXmlTag("to_person_id", block)));
    const typeId = unescapeXml(parseXmlTag("type_id", block));
    const notes = unescapeXml(parseXmlTag("notes", block));
    if (existingRelationshipUuids.has(id)) { skippedCounts.relationships++; continue; }
    try {
      await storage.createRelationshipWithId({ id, fromPersonId, toPersonId, typeId, notes: notes || null });
      importedCounts.relationships++;
      existingRelationshipUuids.add(id);
    } catch (e) { console.error(`Error importing relationship ${id}:`, e); }
  }

  for (const block of parseAllTags("interaction", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const typeId = unescapeXml(parseXmlTag("type_id", block));
    const interactionTitle = unescapeXml(parseXmlTag("title", block));
    const date = unescapeXml(parseXmlTag("date", block));
    const description = unescapeXml(parseXmlTag("description", block));
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const imageUuid = unescapeXml(parseXmlTag("image_uuid", block));
    const peopleIds = parseXmlArray("people_ids", "person_id", block);
    const groupIds = parseXmlArray("group_ids", "group_id", block);
    const processedPeopleIds = peopleIds.map(p => replaceZeroUUID(p));
    if (existingInteractionUuids.has(id)) { skippedCounts.interactions++; continue; }
    try {
      await storage.createInteractionWithId({
        id, typeId: typeId || undefined,
        title: interactionTitle || undefined,
        date: new Date(date),
        description: description || undefined,
        peopleIds: processedPeopleIds.length > 0 ? processedPeopleIds : [],
        groupIds: groupIds.length > 0 ? groupIds : [],
        imageUrl: imageUrl || undefined,
        imageUuid: imageUuid || undefined,
      });
      importedCounts.interactions++;
      existingInteractionUuids.add(id);
    } catch (e) { console.error(`Error importing interaction ${id}:`, e); }
  }

  await storage.updateTaskProgress(taskId, 52, "Importing notes…");

  for (const block of parseAllTags("note", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = unescapeXml(parseXmlTag("person_id", block));
    const content = unescapeXml(parseXmlTag("content", block));
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const imageUuid = unescapeXml(parseXmlTag("image_uuid", block));
    try {
      await storage.createNoteWithId({ id, personId, content, imageUrl: imageUrl || null, imageUuid: imageUuid || null });
      importedCounts.notes++;
    } catch (e) { console.error(`Error importing note ${id}:`, e); }
  }

  for (const block of parseAllTags("group_note", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const groupId = unescapeXml(parseXmlTag("group_id", block));
    const content = unescapeXml(parseXmlTag("content", block));
    try {
      await storage.createGroupNoteWithId({ id, groupId, content });
      importedCounts.groupNotes++;
    } catch (e) { console.error(`Error importing group note ${id}:`, e); }
  }

  await storage.updateTaskProgress(taskId, 62, "Importing social account types…");

  const existingSocialAccountTypeUuids = new Set((await storage.getAllSocialAccountTypes()).map(t => t.id));
  for (const block of parseAllTags("social_account_type", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    if (existingSocialAccountTypeUuids.has(id)) { skippedCounts.socialAccountTypes = (skippedCounts.socialAccountTypes || 0) + 1; continue; }
    try {
      await storage.createSocialAccountTypeWithId({ id, name, color });
      importedCounts.socialAccountTypes = (importedCounts.socialAccountTypes || 0) + 1;
      existingSocialAccountTypeUuids.add(id);
    } catch (e) { console.error(`Error importing social account type ${id}:`, e); }
  }

  await storage.updateTaskProgress(taskId, 72, "Importing social accounts…");

  for (const block of parseAllTags("social_account", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const username = unescapeXml(parseXmlTag("username", block));
    const nickname = unescapeXml(parseXmlTag("nickname", block));
    const accountUrl = unescapeXml(parseXmlTag("account_url", block));
    const ownerUuid = unescapeXml(parseXmlTag("owner_uuid", block));
    const typeId = unescapeXml(parseXmlTag("type_id", block));
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const following = parseXmlArray("following", "account_id", block);
    const followers = parseXmlArray("followers", "account_id", block);
    const internalAccountCreationDateStr = unescapeXml(parseXmlTag("internal_account_creation_date", block));
    const internalAccountCreationType = unescapeXml(parseXmlTag("internal_account_creation_type", block));
    if (existingSocialAccountUuids.has(id)) { skippedCounts.socialAccounts++; continue; }
    const processedOwnerUuid = replaceZeroUUID(ownerUuid);
    try {
      const created = await storage.createSocialAccountWithId({
        id, username,
        ownerUuid: processedOwnerUuid || null,
        typeId: typeId || null,
        internalAccountCreationType: internalAccountCreationType || "Import",
        internalAccountCreationDate: internalAccountCreationDateStr ? new Date(internalAccountCreationDateStr) : undefined,
      });
      if (nickname || accountUrl || imageUrl) {
        if (created.currentProfile) {
          await storage.updateProfileVersion(created.currentProfile.id, {
            nickname: nickname || null, accountUrl: accountUrl || null, imageUrl: imageUrl || null,
          });
        }
      }
      if ((followers && followers.length > 0) || (following && following.length > 0)) {
        await storage.upsertNetworkState({
          socialAccountId: id,
          followerCount: followers.length,
          followingCount: following.length,
          followers, following,
        });
      }
      importedCounts.socialAccounts++;
      existingSocialAccountUuids.add(id);
    } catch (e) { console.error(`Error importing social account ${id}:`, e); }
  }

  await storage.updateTaskProgress(taskId, 80, "Importing posts…");

  const existingPostIds = new Set(
    (await db.select({ id: socialAccountPosts.id }).from(socialAccountPosts)).map(p => p.id)
  );
  for (const block of parseAllTags("social_account_post", xmlText)) {
    try {
      const id = unescapeXml(parseXmlTag("id", block));
      const postSocialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      const postType = unescapeXml(parseXmlTag("post_type", block)) || "post";
      const content = unescapeXml(parseXmlTag("content", block));
      const description = unescapeXml(parseXmlTag("description", block));
      const likeCount = parseInt(parseXmlTag("like_count", block)) || 0;
      const commentCount = parseInt(parseXmlTag("comment_count", block)) || 0;
      const comments = unescapeXml(parseXmlTag("comments", block));
      const mentionedAccounts = unescapeXml(parseXmlTag("mentioned_accounts", block));
      const postedAtStr = unescapeXml(parseXmlTag("posted_at", block));
      const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
      if (!id || !postSocialAccountId) continue;
      if (existingPostIds.has(id)) continue;
      if (!existingSocialAccountUuids.has(postSocialAccountId)) continue;
      await db.insert(socialAccountPosts).values({
        id, socialAccountId: postSocialAccountId, postType,
        content: content || null, description: description || null,
        likeCount, commentCount,
        comments: comments || null, mentionedAccounts: mentionedAccounts || null,
        postedAt: postedAtStr ? new Date(postedAtStr) : null,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      existingPostIds.add(id);
      importedCounts.posts++;
    } catch (e) { console.error("Error importing post:", e); }
  }

  await storage.updateTaskProgress(taskId, 88, "Importing profile history…");

  for (const block of parseAllTags("social_profile_version", xmlText)) {
    try {
      const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      if (!socialAccountId || !existingSocialAccountUuids.has(socialAccountId)) continue;
      const pvNickname = unescapeXml(parseXmlTag("nickname", block));
      const pvBio = unescapeXml(parseXmlTag("bio", block));
      const pvAccountUrl = unescapeXml(parseXmlTag("account_url", block));
      const pvImageUrl = unescapeXml(parseXmlTag("image_url", block));
      const pvExternalImageUrl = unescapeXml(parseXmlTag("external_image_url", block));
      const pvIsCurrent = parseXmlTag("is_current", block) === "true";
      await storage.createProfileVersion({
        socialAccountId, nickname: pvNickname || null, bio: pvBio || null,
        accountUrl: pvAccountUrl || null, imageUrl: pvImageUrl || null,
        externalImageUrl: pvExternalImageUrl || null, isCurrent: pvIsCurrent,
      });
    } catch (e) { console.error("Error importing profile version:", e); }
  }

  for (const block of parseAllTags("social_network_snapshot", xmlText)) {
    try {
      const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      if (!socialAccountId || !existingSocialAccountUuids.has(socialAccountId)) continue;
      const followerCount = parseInt(parseXmlTag("follower_count", block)) || 0;
      const followingCount = parseInt(parseXmlTag("following_count", block)) || 0;
      const snFollowers = parseXmlArray("followers", "account_id", block);
      const snFollowing = parseXmlArray("following", "account_id", block);
      await storage.upsertNetworkState({ socialAccountId, followerCount, followingCount, followers: snFollowers, following: snFollowing });
    } catch (e) { console.error("Error importing network snapshot:", e); }
  }

  await storage.updateTaskProgress(taskId, 94, "Importing network changes…");

  for (const block of parseAllTags("social_network_change", xmlText)) {
    try {
      const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      const changeType = unescapeXml(parseXmlTag("change_type", block));
      const direction = unescapeXml(parseXmlTag("direction", block));
      const targetAccountId = unescapeXml(parseXmlTag("target_account_id", block));
      const detectedAtStr = unescapeXml(parseXmlTag("detected_at", block));
      const batchId = unescapeXml(parseXmlTag("batch_id", block));
      if (!socialAccountId || !existingSocialAccountUuids.has(socialAccountId)) continue;
      if (!changeType || !direction || !targetAccountId) continue;
      await db.insert(socialNetworkChanges).values({
        socialAccountId, changeType, direction, targetAccountId,
        detectedAt: detectedAtStr ? new Date(detectedAtStr) : new Date(),
        batchId: batchId || null,
      });
      importedCounts.networkChanges = (importedCounts.networkChanges || 0) + 1;
    } catch (e) { console.error("Error importing network change:", e); }
  }

  await storage.updateTaskProgress(taskId, 99, "Finalizing…");
  return JSON.stringify({ imported: importedCounts, skipped: skippedCounts });
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
  const s3Urls = allUrls.filter(u => !isLocalImageUrl(u.url) && !u.url.includes("instagram.com"));
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
      await storage.updatePhotoLocation(entry.url, localUrl).catch(() => {});

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
  const localUrls = allUrls.filter(u => isLocalImageUrl(u.url) && !u.url.includes("instagram.com"));
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
      await storage.updatePhotoLocation(entry.url, s3Url).catch(() => {});

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

async function processImportInstagram(taskId: string, payload: {
  accountId: string;
  targetAccountUsername: string;
  importType: "followers" | "following";
  forceUpdateImages: boolean;
  rows: any[];
  skippedRows: number;
}): Promise<string> {
  const { accountId, targetAccountUsername, importType, forceUpdateImages, rows, skippedRows } = payload;

  const instagramType = await storage.getSocialAccountTypeByName("instagram");
  const instagramTypeId = instagramType?.id || null;

  const allAccounts = await storage.getAllSocialAccounts();
  const accountsByUsername = new Map(allAccounts.map(a => [a.username.toLowerCase(), a]));

  let importedCount = 0;
  let updatedCount = 0;
  const processedAccountIds: string[] = [];
  const mutualFollowIds: string[] = [];

  for (const row of rows) {
    if (await isTaskCancelled(taskId)) {
      return JSON.stringify({ cancelled: true, imported: importedCount, updated: updatedCount });
    }

    const username = (row.username || "").toString().trim().replace(/"/g, "");
    const fullName = (row.full_name || "").toString().trim().replace(/"/g, "");
    const profilePicUrl = (row.profile_pic_url || "").toString().trim().replace(/"/g, "");
    const followedByViewer = (row.followed_by_viewer || "").toString().toLowerCase() === "true";

    if (!username) continue;

    const existingAccount = accountsByUsername.get(username.toLowerCase());

    if (existingAccount) {
      if (fullName && existingAccount.currentProfile?.nickname !== fullName) {
        await storage.createProfileVersion({
          socialAccountId: existingAccount.id,
          nickname: fullName,
          accountUrl: existingAccount.currentProfile?.accountUrl || null,
          imageUrl: existingAccount.currentProfile?.imageUrl || null,
          isCurrent: true,
        });
        updatedCount++;
      }

      if (profilePicUrl && (!existingAccount.currentProfile?.imageUrl || forceUpdateImages)) {
        const currentProfile = await storage.getCurrentProfileVersion(existingAccount.id);
        await storage.createImageTask({
          type: "download_img_instagram",
          status: "pending",
          parentTaskId: taskId,
          payload: JSON.stringify({
            socialAccountId: existingAccount.id,
            profileVersionId: currentProfile?.id || null,
            imageUrl: profilePicUrl,
          }),
        });
      }

      processedAccountIds.push(existingAccount.id);
    } else {
      const newAccount = await storage.createSocialAccount({
        username,
        ownerUuid: null,
        typeId: instagramTypeId,
        internalAccountCreationType: `${targetAccountUsername} import`,
      });

      const currentProfile = await storage.getCurrentProfileVersion(newAccount.id);
      if (currentProfile) {
        await storage.updateProfileVersion(currentProfile.id, {
          nickname: fullName || null,
          accountUrl: `https://instagram.com/${username}`,
        });
      }

      if (profilePicUrl) {
        await storage.createImageTask({
          type: "download_img_instagram",
          status: "pending",
          parentTaskId: taskId,
          payload: JSON.stringify({
            socialAccountId: newAccount.id,
            profileVersionId: currentProfile?.id || null,
            imageUrl: profilePicUrl,
          }),
        });
      }

      accountsByUsername.set(username.toLowerCase(), newAccount);
      processedAccountIds.push(newAccount.id);
      importedCount++;
    }

    if (followedByViewer) {
      const acct = accountsByUsername.get(username.toLowerCase());
      if (acct) mutualFollowIds.push(acct.id);
    }
  }

  const existingState = await storage.getNetworkState(accountId);
  const existingFollowers = existingState?.followers || [];
  const existingFollowing = existingState?.following || [];

  let newFollowers: string[];
  let newFollowing: string[];

  if (importType === "followers") {
    newFollowers = Array.from(new Set([...existingFollowers, ...processedAccountIds]));
    newFollowing = Array.from(new Set([...existingFollowing, ...mutualFollowIds]));
  } else {
    newFollowing = Array.from(new Set([...existingFollowing, ...processedAccountIds]));
    newFollowers = Array.from(new Set([...existingFollowers, ...mutualFollowIds]));
  }

  await storage.upsertNetworkState({
    socialAccountId: accountId,
    followerCount: newFollowers.length,
    followingCount: newFollowing.length,
    followers: newFollowers,
    following: newFollowing,
  });

  // Kick off the image task worker for the download_img_instagram tasks we just created
  triggerImageTaskWorker();

  return JSON.stringify({
    success: true,
    imported: importedCount,
    updated: updatedCount,
    total: processedAccountIds.length,
    skippedRows,
  });
}

interface MultiImageDownloadItem {
  url: string;
  uuid: string;
  prmLocation?: string;
  isSubImage?: boolean;
  metadata?: any;
  ogMetadata?: any;
}

async function processMultiImageDownload(
  taskId: string,
  payload: { images: MultiImageDownloadItem[] }
): Promise<string> {
  const images = payload.images || [];
  const totalCount = images.length;
  await storage.updateTaskProgress(taskId, 0, `Starting download of ${totalCount} images...`);

  let completedCount = 0;
  const results: Array<{
    uuid: string;
    status: "completed" | "failed";
    url?: string;
    widthPx?: number | null;
    heightPx?: number | null;
    error?: string;
  }> = [];

  // Determine storage mode once
  let storageMode: "local" | "s3" = "s3";
  try {
    const user = (await storage.getAllUsers())[0];
    if (user) {
      storageMode = await storage.getImageStorageMode(user.id);
    }
  } catch (err) {
    log(`[TaskWorker] Error getting image storage mode: ${err}`);
  }

  // Helper to process a single image
  const downloadImage = async (item: MultiImageDownloadItem) => {
    const { url, uuid, prmLocation, isSubImage, metadata, ogMetadata: providedOgMetadata } = item;
    try {
      // Check if photo ID already exists
      const existing = await storage.getPhotoById(uuid);
      if (existing) {
        return {
          uuid,
          status: "completed" as const,
          url: existing.location,
          widthPx: existing.widthPx,
          heightPx: existing.heightPx,
        };
      }

      // Download
      const response = await fetch(url, {
        headers: { "User-Agent": INSTAGRAM_USER_AGENT },
      });
      if (!response.ok) {
        throw new Error(`Failed to download image: HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";

      const ogMetadataObj: Record<string, unknown> = {
        sourceUrl: url,
        contentType,
        contentLength: response.headers.get("content-length"),
        lastModified: response.headers.get("last-modified"),
        etag: response.headers.get("etag"),
        fetchedAt: new Date().toISOString(),
      };

      const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
      const dims = getImageDimensions(buffer);

      // Upload
      let cdnUrl: string;
      if (storageMode === "local") {
        cdnUrl = await uploadImageLocally(buffer, `image.${ext}`, contentType);
      } else {
        cdnUrl = await uploadImageToS3(buffer, `image.${ext}`, contentType);
      }

      // Insert photo
      const photo = await storage.insertPhoto({
        id: uuid,
        location: cdnUrl,
        prmLocation: prmLocation || `multi_image_download:${taskId}`,
        isSubImage: isSubImage ?? false,
        fileHash,
        widthPx: dims?.width ?? null,
        heightPx: dims?.height ?? null,
        ogMetadata: {
          ...ogMetadataObj,
          ...(providedOgMetadata || {}),
        },
        metadata: metadata || null,
      });

      // Sync vector
      syncEntityInBackground("image", photo.id);

      return {
        uuid,
        status: "completed" as const,
        url: cdnUrl,
        widthPx: dims?.width ?? null,
        heightPx: dims?.height ?? null,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log(`[TaskWorker] Failed to download image ${uuid} from ${url}: ${errMsg}`);
      return {
        uuid,
        status: "failed" as const,
        error: errMsg,
      };
    }
  };

  // Process concurrently with a limit of 8
  const CONCURRENCY_LIMIT = 8;
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < totalCount) {
      const index = currentIndex++;
      const item = images[index];
      const result = await downloadImage(item);
      results[index] = result;

      completedCount++;
      const percent = Math.round((completedCount / totalCount) * 100);
      await storage.updateTaskProgress(
        taskId,
        percent,
        `Downloaded ${completedCount}/${totalCount} images...`
      );
    }
  };

  const workers = Array.from(
    { length: Math.min(CONCURRENCY_LIMIT, totalCount) },
    () => worker()
  );
  await Promise.all(workers);

  const responsePayload = {
    uuids: images.map(img => img.uuid),
    results,
  };

  return JSON.stringify(responsePayload);
}

async function processNextTask(): Promise<boolean> {
  const task = await storage.getNextPendingTask();
  if (!task) return false;

  log(`[TaskWorker] Processing task ${task.id} (type: ${task.type})`);
  await storage.updateTaskStatus(task.id, "in_progress");

  try {
    let result: string;

    switch (task.type) {
      case "multi_image_download": {
        const payload = JSON.parse(task.payload);
        result = await processMultiImageDownload(task.id, payload);
        break;
      }
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
      case "import_instagram": {
        const payload = JSON.parse(task.payload);
        result = await processImportInstagram(task.id, payload);
        break;
      }
      case "export_xml": {
        const payload = JSON.parse(task.payload);
        result = await processExportXmlTask(task.id, payload);
        break;
      }
      case "import_xml": {
        const payload = JSON.parse(task.payload);
        // Scrub the raw XML from the persisted task payload immediately after
        // parsing to avoid retaining large PII strings in the database.
        await db.update(tasks).set({
          payload: JSON.stringify({ userId: payload.userId, xmlCleared: true }),
        }).where(eq(tasks.id, task.id));
        result = await processImportXmlTask(task.id, payload);
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
  if (isProcessing || isPaused) return;
  isProcessing = true;

  try {
    let hasMore = true;
    while (hasMore && !isPaused) {
      hasMore = await processNextTask();
      if (hasMore && !isPaused) {
        await new Promise(resolve => setTimeout(resolve, IMAGE_DOWNLOAD_DELAY_MS));
      }
    }
  } catch (error) {
    log(`[TaskWorker] Worker loop error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isProcessing = false;
    if (!isPaused) schedulePoll();
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
  runImageTaskWorkerLoop();
}

export function triggerTaskWorker() {
  if (isProcessing || isPaused) return;
  if (pollTimer) clearTimeout(pollTimer);
  runWorkerLoop();
}

export function pauseTaskWorker() {
  isPaused = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  log("[TaskWorker] Worker paused");
}

export function resumeTaskWorker() {
  isPaused = false;
  log("[TaskWorker] Worker resumed");
  runWorkerLoop();
}

export function isTaskWorkerPaused(): boolean {
  return isPaused;
}
