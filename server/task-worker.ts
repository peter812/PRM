import { storage } from "./storage";
import { db } from "./db";
import { syncEntityInBackground } from "./vector-universal";
import { uploadImageToS3, deleteImageFromS3 } from "./s3";
import { uploadImageLocally, deleteImageLocally, isLocalImageUrl } from "./local-storage";
import { log } from "./vite";
import { runAutomaticImagePassIn, autoPassInImageForSocialAccount } from "./image-pass-in-utils";
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
  lineage,
  partnerships,
  photos,
  dailyNotes,
  dailyNoteEvents,
  dailyNoteInvolvedParties,
  dailyNoteAuditLogs,
  sexGuessQueue,
  aiChats,
  appSettings,
  socialAccounts,
  socialProfileVersions,
  socialNetworkState,
  groups,
  relationships,
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

  // Automatically pass in the image to any linked person who doesn't have an image
  await autoPassInImageForSocialAccount(socialAccountId);

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

  const [
    allLineages,
    allPartnerships,
    allPhotos,
    allDailyNotes,
    allDailyNoteEvents,
    allDailyNoteInvolvedParties,
    allDailyNoteAuditLogs,
    allSexGuesses,
    allAiChats,
    allAppSettings,
  ] = await Promise.all([
    db.select().from(lineage),
    db.select().from(partnerships),
    db.select().from(photos),
    db.select().from(dailyNotes),
    db.select().from(dailyNoteEvents),
    db.select().from(dailyNoteInvolvedParties),
    db.select().from(dailyNoteAuditLogs),
    db.select().from(sexGuessQueue),
    db.select().from(aiChats),
    db.select().from(appSettings),
  ]);

  const user = allUsers[0];
  const mePersonId = mePersonResult[0]?.id || null;
  const peopleToExport = allPeople.filter(p => p.id !== mePersonId);
  const networkStateMap = new Map(allNetworkStates.map(s => [s.socialAccountId, s]));

  // Helper to map mePersonId to ZERO_UUID in photos.prmLocation
  const mapPrmLocationExport = (loc: string | null): string => {
    if (!loc) return "";
    if (mePersonId && loc.includes(mePersonId)) {
      return loc.replace(mePersonId, ZERO_UUID);
    }
    return loc;
  };

  // Helper function to escape XML special characters
  const escapeXml = (str: any): string => {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  // Helper function to convert array to XML
  const arrayToXml = (arr: any[], itemName: string): string => {
    if (!arr || arr.length === 0) return "";
    return arr.map(item => `<${itemName}>${escapeXml(item)}</${itemName}>`).join("");
  };

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
    xml += `      <sex>${escapeXml(person.sex || "unknown")}</sex>\n`;
    xml += `      <elo_rankable>${escapeXml(person.eloRankable ?? 1)}</elo_rankable>\n`;
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
    xml += `      <family_relationship_type>${escapeXml(rel.familyRelationshipType || "")}</family_relationship_type>\n`;
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
    xml += `      <last_scraped_at>${escapeXml(account.lastScrapedAt)}</last_scraped_at>\n`;
    xml += `      <current_posts>${escapeXml(account.currentPosts || "")}</current_posts>\n`;
    xml += `      <deleted_posts>${escapeXml(account.deletedPosts || "")}</deleted_posts>\n`;
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
    xml += `      <face_ids>${escapeXml(post.faceIds || "")}</face_ids>\n`;
    xml += `      <is_deleted>${escapeXml(post.isDeleted)}</is_deleted>\n`;
    xml += `      <posted_at>${escapeXml(post.postedAt || "")}</posted_at>\n`;
    xml += `      <created_at>${escapeXml(post.createdAt)}</created_at>\n`;
    xml += '    </social_account_post>\n';
  }
  xml += '  </social_account_posts>\n';

  // Export photos (new)
  xml += '  <photos>\n';
  for (const photo of allPhotos) {
    xml += '    <photo_entry>\n';
    xml += `      <id>${escapeXml(photo.id)}</id>\n`;
    xml += `      <location>${escapeXml(photo.location)}</location>\n`;
    xml += `      <uploaded_at>${escapeXml(photo.uploadedAt)}</uploaded_at>\n`;
    xml += `      <is_sub_image>${escapeXml(photo.isSubImage)}</is_sub_image>\n`;
    xml += `      <processed_at>${escapeXml(photo.processedAt)}</processed_at>\n`;
    xml += `      <image_description_at>${escapeXml(photo.imageDescriptionAt)}</image_description_at>\n`;
    xml += `      <image_description>${escapeXml(photo.imageDescription || "")}</image_description>\n`;
    xml += `      <face_id_at>${escapeXml(photo.faceIdAt)}</face_id_at>\n`;
    xml += `      <face_uuids>${escapeXml(photo.faceUuids ? JSON.stringify(photo.faceUuids) : "")}</face_uuids>\n`;
    xml += `      <prm_location>${escapeXml(mapPrmLocationExport(photo.prmLocation))}</prm_location>\n`;
    xml += `      <metadata>${escapeXml(photo.metadata ? JSON.stringify(photo.metadata) : "")}</metadata>\n`;
    xml += `      <og_metadata>${escapeXml(photo.ogMetadata ? JSON.stringify(photo.ogMetadata) : "")}</og_metadata>\n`;
    xml += `      <file_hash>${escapeXml(photo.fileHash || "")}</file_hash>\n`;
    xml += `      <width_px>${escapeXml(photo.widthPx)}</width_px>\n`;
    xml += `      <height_px>${escapeXml(photo.heightPx)}</height_px>\n`;
    xml += '    </photo_entry>\n';
  }
  xml += '  </photos>\n';

  // Export lineages (new)
  xml += '  <lineages>\n';
  for (const lin of allLineages) {
    const childId = lin.childId === mePersonId ? ZERO_UUID : lin.childId;
    const parentId = lin.parentId === mePersonId ? ZERO_UUID : lin.parentId;
    xml += '    <lineage_entry>\n';
    xml += `      <id>${escapeXml(lin.id)}</id>\n`;
    xml += `      <child_id>${escapeXml(childId)}</child_id>\n`;
    xml += `      <parent_id>${escapeXml(parentId)}</parent_id>\n`;
    xml += `      <lineage_type>${escapeXml(lin.lineageType)}</lineage_type>\n`;
    xml += `      <created_at>${escapeXml(lin.createdAt)}</created_at>\n`;
    xml += '    </lineage_entry>\n';
  }
  xml += '  </lineages>\n';

  // Export partnerships (new)
  xml += '  <partnerships>\n';
  for (const part of allPartnerships) {
    const person1Id = part.person1Id === mePersonId ? ZERO_UUID : part.person1Id;
    const person2Id = part.person2Id === mePersonId ? ZERO_UUID : part.person2Id;
    xml += '    <partnership_entry>\n';
    xml += `      <id>${escapeXml(part.id)}</id>\n`;
    xml += `      <person1_id>${escapeXml(person1Id)}</person1_id>\n`;
    xml += `      <person2_id>${escapeXml(person2Id)}</person2_id>\n`;
    xml += `      <status>${escapeXml(part.status)}</status>\n`;
    xml += `      <created_at>${escapeXml(part.createdAt)}</created_at>\n`;
    xml += '    </partnership_entry>\n';
  }
  xml += '  </partnerships>\n';

  // Export daily notes (new)
  xml += '  <daily_notes>\n';
  for (const dn of allDailyNotes) {
    xml += '    <daily_note_entry>\n';
    xml += `      <id>${escapeXml(dn.id)}</id>\n`;
    xml += `      <date>${escapeXml(dn.date)}</date>\n`;
    xml += `      <user_title>${escapeXml(dn.userTitle)}</user_title>\n`;
    xml += `      <body>${escapeXml(dn.body)}</body>\n`;
    xml += `      <created_at>${escapeXml(dn.createdAt)}</created_at>\n`;
    xml += `      <updated_at>${escapeXml(dn.updatedAt)}</updated_at>\n`;
    xml += '    </daily_note_entry>\n';
  }
  xml += '  </daily_notes>\n';

  // Export daily note events (new)
  xml += '  <daily_note_events>\n';
  for (const ev of allDailyNoteEvents) {
    xml += '    <daily_note_event_entry>\n';
    xml += `      <id>${escapeXml(ev.id)}</id>\n`;
    xml += `      <daily_note_id>${escapeXml(ev.dailyNoteId)}</daily_note_id>\n`;
    xml += `      <text>${escapeXml(ev.text)}</text>\n`;
    xml += `      <position>${escapeXml(ev.position)}</position>\n`;
    xml += `      <created_at>${escapeXml(ev.createdAt)}</created_at>\n`;
    xml += '    </daily_note_event_entry>\n';
  }
  xml += '  </daily_note_events>\n';

  // Export daily note involved parties (new)
  xml += '  <daily_note_involved_parties>\n';
  for (const party of allDailyNoteInvolvedParties) {
    let refId = party.refId;
    if (party.partyType === "person" && refId === mePersonId) {
      refId = ZERO_UUID;
    }
    xml += '    <daily_note_involved_party_entry>\n';
    xml += `      <id>${escapeXml(party.id)}</id>\n`;
    xml += `      <daily_note_id>${escapeXml(party.dailyNoteId)}</daily_note_id>\n`;
    xml += `      <party_type>${escapeXml(party.partyType)}</party_type>\n`;
    xml += `      <ref_id>${escapeXml(refId)}</ref_id>\n`;
    xml += '    </daily_note_involved_party_entry>\n';
  }
  xml += '  </daily_note_involved_parties>\n';

  // Export daily note audit logs (new)
  xml += '  <daily_note_audit_logs>\n';
  for (const log of allDailyNoteAuditLogs) {
    xml += '    <daily_note_audit_log_entry>\n';
    xml += `      <id>${escapeXml(log.id)}</id>\n`;
    xml += `      <daily_note_id>${escapeXml(log.dailyNoteId)}</daily_note_id>\n`;
    xml += `      <action>${escapeXml(log.action)}</action>\n`;
    xml += `      <timestamp>${escapeXml(log.timestamp)}</timestamp>\n`;
    xml += `      <pin_used>${escapeXml(log.pinUsed)}</pin_used>\n`;
    xml += '    </daily_note_audit_log_entry>\n';
  }
  xml += '  </daily_note_audit_logs>\n';

  // Export sex guesses queue (new)
  xml += '  <sex_guess_records>\n';
  for (const guess of allSexGuesses) {
    const personId = guess.personId === mePersonId ? ZERO_UUID : guess.personId;
    xml += '    <sex_guess_entry>\n';
    xml += `      <id>${escapeXml(guess.id)}</id>\n`;
    xml += `      <person_id>${escapeXml(personId)}</person_id>\n`;
    xml += `      <guessed_sex>${escapeXml(guess.guessedSex)}</guessed_sex>\n`;
    xml += `      <reasoning>${escapeXml(guess.reasoning)}</reasoning>\n`;
    xml += `      <date_added>${escapeXml(guess.dateAdded)}</date_added>\n`;
    xml += `      <answered>${escapeXml(guess.answered)}</answered>\n`;
    xml += `      <snooze_until>${escapeXml(guess.snoozedUntil)}</snooze_until>\n`;
    xml += '    </sex_guess_entry>\n';
  }
  xml += '  </sex_guess_records>\n';

  // Export AI chats (new)
  xml += '  <ai_chats>\n';
  for (const chat of allAiChats) {
    if (chat.userId !== payload.userId) continue;
    xml += '    <ai_chat_entry>\n';
    xml += `      <id>${escapeXml(chat.id)}</id>\n`;
    xml += `      <title>${escapeXml(chat.title)}</title>\n`;
    xml += `      <system_message>${escapeXml(chat.systemMessage)}</system_message>\n`;
    xml += `      <model>${escapeXml(chat.model)}</model>\n`;
    xml += `      <messages>${escapeXml(chat.messages ? JSON.stringify(chat.messages) : "[]")}</messages>\n`;
    xml += `      <created_at>${escapeXml(chat.createdAt)}</created_at>\n`;
    xml += `      <updated_at>${escapeXml(chat.updatedAt)}</updated_at>\n`;
    xml += '    </ai_chat_entry>\n';
  }
  xml += '  </ai_chats>\n';

  // Export app settings (new)
  xml += '  <app_settings_list>\n';
  for (const setting of allAppSettings) {
    xml += '    <app_setting_entry>\n';
    xml += `      <key>${escapeXml(setting.key)}</key>\n`;
    xml += `      <value>${escapeXml(setting.value)}</value>\n`;
    xml += '    </app_setting_entry>\n';
  }
  xml += '  </app_settings_list>\n';

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

  const mapPrmLocationImport = (loc: string | null): string => {
    if (!loc) return "";
    if (mePersonId && loc.includes(ZERO_UUID)) {
      return loc.replace(ZERO_UUID, mePersonId);
    }
    return loc;
  };

  let importedCounts: Record<string, number> = {
    relationshipTypes: 0,
    interactionTypes: 0,
    people: 0,
    relationships: 0,
    groups: 0,
    interactions: 0,
    notes: 0,
    groupNotes: 0,
    socialAccounts: 0,
    socialAccountTypes: 0,
    posts: 0,
    messages: 0,
    networkChanges: 0,
    photos: 0,
    lineages: 0,
    partnerships: 0,
    dailyNotes: 0,
    dailyNoteEvents: 0,
    dailyNoteInvolvedParties: 0,
    dailyNoteAuditLogs: 0,
    sexGuessQueue: 0,
    aiChats: 0,
    appSettings: 0,
  };
  let skippedCounts: Record<string, number> = {
    relationshipTypes: 0,
    interactionTypes: 0,
    people: 0,
    relationships: 0,
    interactions: 0,
    socialAccounts: 0,
    socialAccountTypes: 0,
    messages: 0,
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
  const socialAccountIdMap = new Map<string, string>();

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

  // Parse and import photos (import early so entity imageUuid references resolve)
  const photoBlocks = parseAllTags("photo_entry", xmlText);
  for (const block of photoBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const location = unescapeXml(parseXmlTag("location", block));
    const uploadedAtStr = unescapeXml(parseXmlTag("uploaded_at", block));
    const isSubImage = parseXmlTag("is_sub_image", block) === "true";
    const processedAtStr = unescapeXml(parseXmlTag("processed_at", block));
    const imageDescriptionAtStr = unescapeXml(parseXmlTag("image_description_at", block));
    const imageDescription = unescapeXml(parseXmlTag("image_description", block));
    const faceIdAtStr = unescapeXml(parseXmlTag("face_id_at", block));
    const faceUuidsStr = unescapeXml(parseXmlTag("face_uuids", block));
    const prmLocation = mapPrmLocationImport(unescapeXml(parseXmlTag("prm_location", block)));
    const metadataStr = unescapeXml(parseXmlTag("metadata", block));
    const ogMetadataStr = unescapeXml(parseXmlTag("og_metadata", block));
    const fileHash = unescapeXml(parseXmlTag("file_hash", block));
    const widthPxStr = unescapeXml(parseXmlTag("width_px", block));
    const heightPxStr = unescapeXml(parseXmlTag("height_px", block));

    try {
      await db.insert(photos).values({
        id, location,
        uploadedAt: uploadedAtStr ? new Date(uploadedAtStr) : new Date(),
        isSubImage,
        processedAt: processedAtStr ? new Date(processedAtStr) : null,
        imageDescriptionAt: imageDescriptionAtStr ? new Date(imageDescriptionAtStr) : null,
        imageDescription: imageDescription || null,
        faceIdAt: faceIdAtStr ? new Date(faceIdAtStr) : null,
        faceUuids: faceUuidsStr ? JSON.parse(faceUuidsStr) : null,
        prmLocation,
        metadata: metadataStr ? JSON.parse(metadataStr) : null,
        ogMetadata: ogMetadataStr ? JSON.parse(ogMetadataStr) : null,
        fileHash: fileHash || null,
        widthPx: widthPxStr ? parseInt(widthPxStr) : null,
        heightPx: heightPxStr ? parseInt(heightPxStr) : null,
      }).onConflictDoNothing();
      importedCounts.photos++;
    } catch (e) {
      console.error(`Error importing photo entry ${id}:`, e);
    }
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
    const sex = unescapeXml(parseXmlTag("sex", block)) || "unknown";
    const eloRankable = parseXmlTag("elo_rankable", block) !== "" ? (parseInt(parseXmlTag("elo_rankable", block)) || 0) : 1;
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
        sex, eloRankable,
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
    const typeId = unescapeXml(parseXmlTag("type_id", block)) || null;
    const notes = unescapeXml(parseXmlTag("notes", block));
    const familyRelationshipType = unescapeXml(parseXmlTag("family_relationship_type", block)) || null;
    if (existingRelationshipUuids.has(id)) { skippedCounts.relationships++; continue; }
    try {
      await storage.createRelationshipWithId({
        id, fromPersonId, toPersonId, typeId,
        notes: notes || null,
        familyRelationshipType: (familyRelationshipType || null) as any,
      });
      importedCounts.relationships++;
      existingRelationshipUuids.add(id);
    } catch (e) { console.error(`Error importing relationship ${id}:`, e); }
  }

  // Parse and import lineages (new)
  const lineageBlocks = parseAllTags("lineage_entry", xmlText);
  for (const block of lineageBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const childId = replaceZeroUUID(unescapeXml(parseXmlTag("child_id", block)));
    const parentId = replaceZeroUUID(unescapeXml(parseXmlTag("parent_id", block)));
    const lineageType = unescapeXml(parseXmlTag("lineage_type", block)) || "biological";
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));

    try {
      await db.insert(lineage).values({
        id, childId, parentId, lineageType,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      importedCounts.lineages++;
    } catch (e) { console.error(`Error importing lineage entry ${id}:`, e); }
  }

  // Parse and import partnerships (new)
  const partnershipBlocks = parseAllTags("partnership_entry", xmlText);
  for (const block of partnershipBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const person1Id = replaceZeroUUID(unescapeXml(parseXmlTag("person1_id", block)));
    const person2Id = replaceZeroUUID(unescapeXml(parseXmlTag("person2_id", block)));
    const status = unescapeXml(parseXmlTag("status", block)) || "partner";
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));

    try {
      await db.insert(partnerships).values({
        id, person1Id, person2Id, status,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      importedCounts.partnerships++;
    } catch (e) { console.error(`Error importing partnership entry ${id}:`, e); }
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
    const lastScrapedAtStr = unescapeXml(parseXmlTag("last_scraped_at", block));
    const currentPosts = unescapeXml(parseXmlTag("current_posts", block)) || null;
    const deletedPosts = unescapeXml(parseXmlTag("deleted_posts", block)) || null;
    
    const existing = existingSocialAccounts.find(
      s => s.id === id || (s.username.toLowerCase() === username.toLowerCase() && s.typeId === (typeId || null))
    );
    if (existing) {
      skippedCounts.socialAccounts++;
      socialAccountIdMap.set(id, existing.id);
      existingSocialAccountUuids.add(existing.id);
      continue;
    }

    const processedOwnerUuid = replaceZeroUUID(ownerUuid);
    try {
      const created = await storage.createSocialAccountWithId({
        id, username,
        ownerUuid: processedOwnerUuid || null,
        typeId: typeId || null,
        internalAccountCreationType: internalAccountCreationType || "Import",
        internalAccountCreationDate: internalAccountCreationDateStr ? new Date(internalAccountCreationDateStr) : undefined,
      });

      // Update extra columns using Drizzle
      await db.update(socialAccounts).set({
        lastScrapedAt: lastScrapedAtStr ? new Date(lastScrapedAtStr) : null,
        currentPosts: currentPosts || null,
        deletedPosts: deletedPosts || null,
      }).where(eq(socialAccounts.id, id));

      socialAccountIdMap.set(id, id);
      existingSocialAccountUuids.add(id);
      existingSocialAccounts.push(created);

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
      const faceIds = unescapeXml(parseXmlTag("face_ids", block));
      const isDeleted = parseXmlTag("is_deleted", block) === "true";
      const postedAtStr = unescapeXml(parseXmlTag("posted_at", block));
      const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
      if (!id || !postSocialAccountId) continue;
      if (existingPostIds.has(id)) continue;
      
      const mappedAccountId = socialAccountIdMap.get(postSocialAccountId) || postSocialAccountId;
      if (!existingSocialAccountUuids.has(mappedAccountId)) continue;

      await db.insert(socialAccountPosts).values({
        id, socialAccountId: mappedAccountId, postType,
        content: content || null, description: description || null,
        likeCount, commentCount,
        comments: comments || null, mentionedAccounts: mentionedAccounts || null,
        faceIds: faceIds || null,
        isDeleted,
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
      const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
      if (!socialAccountId || !existingSocialAccountUuids.has(mappedAccountId)) continue;

      const pvNickname = unescapeXml(parseXmlTag("nickname", block));
      const pvBio = unescapeXml(parseXmlTag("bio", block));
      const pvAccountUrl = unescapeXml(parseXmlTag("account_url", block));
      const pvImageUrl = unescapeXml(parseXmlTag("image_url", block));
      const pvExternalImageUrl = unescapeXml(parseXmlTag("external_image_url", block));
      const pvIsCurrent = parseXmlTag("is_current", block) === "true";
      await storage.createProfileVersion({
        socialAccountId: mappedAccountId, nickname: pvNickname || null, bio: pvBio || null,
        accountUrl: pvAccountUrl || null, imageUrl: pvImageUrl || null,
        externalImageUrl: pvExternalImageUrl || null, isCurrent: pvIsCurrent,
      });
    } catch (e) { console.error("Error importing profile version:", e); }
  }

  for (const block of parseAllTags("social_network_snapshot", xmlText)) {
    try {
      const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
      if (!socialAccountId || !existingSocialAccountUuids.has(mappedAccountId)) continue;

      const followerCount = parseInt(parseXmlTag("follower_count", block)) || 0;
      const followingCount = parseInt(parseXmlTag("following_count", block)) || 0;
      const snFollowers = parseXmlArray("followers", "account_id", block);
      const snFollowing = parseXmlArray("following", "account_id", block);
      await storage.upsertNetworkState({ socialAccountId: mappedAccountId, followerCount, followingCount, followers: snFollowers, following: snFollowing });
    } catch (e) { console.error("Error importing network snapshot:", e); }
  }

  await storage.updateTaskProgress(taskId, 94, "Importing network changes…");

  for (const block of parseAllTags("social_network_change", xmlText)) {
    try {
      const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
      if (!socialAccountId || !existingSocialAccountUuids.has(mappedAccountId)) continue;

      const changeType = unescapeXml(parseXmlTag("change_type", block));
      const direction = unescapeXml(parseXmlTag("direction", block));
      const targetAccountId = unescapeXml(parseXmlTag("target_account_id", block));
      const detectedAtStr = unescapeXml(parseXmlTag("detected_at", block));
      const batchId = unescapeXml(parseXmlTag("batch_id", block));
      if (!changeType || !direction || !targetAccountId) continue;
      await db.insert(socialNetworkChanges).values({
        socialAccountId: mappedAccountId, changeType, direction, targetAccountId,
        detectedAt: detectedAtStr ? new Date(detectedAtStr) : new Date(),
        batchId: batchId || null,
      });
      importedCounts.networkChanges = (importedCounts.networkChanges || 0) + 1;
    } catch (e) { console.error("Error importing network change:", e); }
  }

  // Parse and import daily notes (new)
  const dailyNoteBlocks = parseAllTags("daily_note_entry", xmlText);
  for (const block of dailyNoteBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const date = unescapeXml(parseXmlTag("date", block));
    const userTitle = unescapeXml(parseXmlTag("user_title", block));
    const body = unescapeXml(parseXmlTag("body", block));
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    const updatedAtStr = unescapeXml(parseXmlTag("updated_at", block));

    try {
      await db.insert(dailyNotes).values({
        id, date, userTitle, body,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
        updatedAt: updatedAtStr ? new Date(updatedAtStr) : null,
      }).onConflictDoNothing();
      importedCounts.dailyNotes++;
    } catch (e) {
      console.error(`Error importing daily note ${id}:`, e);
    }
  }

  // Parse and import daily note events (new)
  const dailyNoteEventBlocks = parseAllTags("daily_note_event_entry", xmlText);
  for (const block of dailyNoteEventBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    const text = unescapeXml(parseXmlTag("text", block));
    const position = parseInt(parseXmlTag("position", block)) || 0;
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));

    try {
      await db.insert(dailyNoteEvents).values({
        id, dailyNoteId, text, position,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      importedCounts.dailyNoteEvents++;
    } catch (e) {
      console.error(`Error importing daily note event ${id}:`, e);
    }
  }

  // Parse and import daily note involved parties (new)
  const involvedPartyBlocks = parseAllTags("daily_note_involved_party_entry", xmlText);
  for (const block of involvedPartyBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    const partyType = unescapeXml(parseXmlTag("party_type", block));
    let refId = unescapeXml(parseXmlTag("ref_id", block));
    if (partyType === "person") {
      refId = replaceZeroUUID(refId);
    }

    try {
      await db.insert(dailyNoteInvolvedParties).values({
        id, dailyNoteId, partyType, refId,
      }).onConflictDoNothing();
      importedCounts.dailyNoteInvolvedParties++;
    } catch (e) {
      console.error(`Error importing daily note involved party ${id}:`, e);
    }
  }

  // Parse and import daily note audit logs (new)
  const auditLogBlocks = parseAllTags("daily_note_audit_log_entry", xmlText);
  for (const block of auditLogBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    const action = unescapeXml(parseXmlTag("action", block));
    const timestampStr = unescapeXml(parseXmlTag("timestamp", block));
    const pinUsed = parseXmlTag("pin_used", block) === "true";

    try {
      await db.insert(dailyNoteAuditLogs).values({
        id, dailyNoteId, action,
        timestamp: timestampStr ? new Date(timestampStr) : new Date(),
        pinUsed,
      }).onConflictDoNothing();
      importedCounts.dailyNoteAuditLogs++;
    } catch (e) {
      console.error(`Error importing daily note audit log ${id}:`, e);
    }
  }

  // Parse and import sex guess records (new)
  const sexGuessBlocks = parseAllTags("sex_guess_entry", xmlText);
  for (const block of sexGuessBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = replaceZeroUUID(unescapeXml(parseXmlTag("person_id", block)));
    const guessedSex = unescapeXml(parseXmlTag("guessed_sex", block));
    const reasoning = unescapeXml(parseXmlTag("reasoning", block));
    const dateAddedStr = unescapeXml(parseXmlTag("date_added", block));
    const answered = parseInt(parseXmlTag("answered", block)) || 0;
    const snoozeUntilStr = unescapeXml(parseXmlTag("snooze_until", block));

    try {
      await db.insert(sexGuessQueue).values({
        id, personId, guessedSex, reasoning,
        dateAdded: dateAddedStr ? new Date(dateAddedStr) : new Date(),
        answered,
        snoozedUntil: snoozeUntilStr ? new Date(snoozeUntilStr) : null,
      }).onConflictDoNothing();
      importedCounts.sexGuessQueue++;
    } catch (e) {
      console.error(`Error importing sex guess entry ${id}:`, e);
    }
  }

  // Parse and import AI chats (new)
  const aiChatBlocks = parseAllTags("ai_chat_entry", xmlText);
  for (const block of aiChatBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const title = unescapeXml(parseXmlTag("title", block)) || "New chat";
    const systemMessage = unescapeXml(parseXmlTag("system_message", block));
    const model = unescapeXml(parseXmlTag("model", block));
    const messagesStr = unescapeXml(parseXmlTag("messages", block));
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    const updatedAtStr = unescapeXml(parseXmlTag("updated_at", block));

    try {
      await db.insert(aiChats).values({
        id, userId: payload.userId, title, systemMessage, model,
        messages: messagesStr ? JSON.parse(messagesStr) : [],
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
        updatedAt: updatedAtStr ? new Date(updatedAtStr) : new Date(),
      }).onConflictDoNothing();
      importedCounts.aiChats++;
    } catch (e) {
      console.error(`Error importing AI chat ${id}:`, e);
    }
  }

  // Parse and import app settings (new)
  const appSettingBlocks = parseAllTags("app_setting_entry", xmlText);
  for (const block of appSettingBlocks) {
    const key = unescapeXml(parseXmlTag("key", block));
    const value = unescapeXml(parseXmlTag("value", block));
    if (!key) continue;

    try {
      await db.insert(appSettings).values({ key, value })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value }
        });
      importedCounts.appSettings++;
    } catch (e) {
      console.error(`Error importing app setting ${key}:`, e);
    }
  }

  await storage.updateTaskProgress(taskId, 99, "Finalizing…");
  await runAutomaticImagePassIn();
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
      storageMode = (await storage.getImageStorageMode(user.id)) as "local" | "s3";
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

async function processCalculateCrowd(taskId: string, payload: { groupId: string }): Promise<string> {
  const { groupId } = payload;
  await storage.updateTaskProgress(taskId, 10, "Fetching group details...");
  const group = await storage.getGroupById(groupId);
  if (!group) {
    throw new Error("Group not found");
  }
  if (!group.centerAccountId) {
    throw new Error("No center account associated with this group.");
  }

  await storage.updateTaskProgress(taskId, 20, "Fetching center account followers...");
  const centerState = await storage.getNetworkState(group.centerAccountId);
  const F_center = new Set(centerState?.followers || []);

  if (F_center.size === 0) {
    await storage.updateGroup(groupId, { crowdMembers: [], crowdLastCalculatedAt: new Date() });
    return JSON.stringify({
      peopleCheckedCount: 0,
      crowdMembersFound: 0,
      message: "Center account has no followers. Crowd is empty."
    });
  }

  await storage.updateTaskProgress(taskId, 30, "Retrieving all people and social connections...");
  const allPeople = await storage.getAllPeople();
  const allSocialAccounts = await db.select().from(socialAccounts);
  const allNetworkStates = await storage.getAllNetworkStates();

  // Map each person to their social account IDs
  const personSocialAccountsMap = new Map<string, Set<string>>();
  for (const p of allPeople) {
    personSocialAccountsMap.set(p.id, new Set(p.socialAccountUuids || []));
  }
  for (const sa of allSocialAccounts) {
    if (sa.ownerUuid) {
      if (!personSocialAccountsMap.has(sa.ownerUuid)) {
        personSocialAccountsMap.set(sa.ownerUuid, new Set());
      }
      personSocialAccountsMap.get(sa.ownerUuid)!.add(sa.id);
    }
  }

  // Map each social account ID to their followed accounts
  const followingMap = new Map<string, Set<string>>();
  for (const ns of allNetworkStates) {
    followingMap.set(ns.socialAccountId, new Set(ns.following || []));
  }

  await storage.updateTaskProgress(taskId, 40, "Scanning follower networks...");
  const crowdPersonIds: string[] = [];
  const totalPeople = allPeople.length;

  for (let i = 0; i < totalPeople; i++) {
    const person = allPeople[i];
    const S_P = personSocialAccountsMap.get(person.id) || new Set<string>();
    
    // Union of all accounts followed by person P
    const Following_P = new Set<string>();
    for (const saId of S_P) {
      const followed = followingMap.get(saId);
      if (followed) {
        for (const f of followed) {
          Following_P.add(f);
        }
      }
    }

    // Intersection with center account followers
    let intersectionCount = 0;
    for (const f of F_center) {
      if (Following_P.has(f)) {
        intersectionCount++;
      }
    }

    if (intersectionCount > 5) {
      crowdPersonIds.push(person.id);
    }

    if (totalPeople > 10 && i % Math.ceil(totalPeople / 10) === 0) {
      const progressPercent = 40 + Math.round((i / totalPeople) * 50);
      await storage.updateTaskProgress(taskId, progressPercent, `Scanning follower networks: processed ${i}/${totalPeople} people...`);
    }
  }

  await storage.updateTaskProgress(taskId, 95, "Updating group crowd list...");
  await storage.updateGroup(groupId, {
    crowdMembers: crowdPersonIds,
    crowdLastCalculatedAt: new Date()
  });

  return JSON.stringify({
    peopleCheckedCount: totalPeople,
    crowdMembersFound: crowdPersonIds.length,
    message: `Successfully calculated crowd for group: ${crowdPersonIds.length} members found.`
  });
}

async function processFindPotentialGroups(taskId: string, payload: {
  entityType: "people" | "social_accounts";
  minGroupSize?: number;
  minDensityMultiplier?: number;
  linkDefinition: "any" | "mutual" | "family";
}): Promise<string> {
  const { entityType, linkDefinition } = payload;
  const minGroupSize = payload.minGroupSize ?? 3;
  const minDensityMultiplier = payload.minDensityMultiplier ?? 1.5;

  await storage.updateTaskProgress(taskId, 15, "Loading graph nodes...");
  let nodes: string[] = [];
  const edges: [string, string][] = [];

  if (entityType === "people") {
    const allPeople = await storage.getAllPeople();
    nodes = allPeople.map(p => p.id);

    await storage.updateTaskProgress(taskId, 30, "Loading relationship links...");
    
    if (linkDefinition === "family") {
      // 1. Lineage links
      const allLin = await db.select().from(lineage);
      for (const l of allLin) {
        edges.push([l.childId, l.parentId]);
      }
      // 2. Partnership links
      const allParts = await db.select().from(partnerships);
      for (const p of allParts) {
        edges.push([p.person1Id, p.person2Id]);
      }
      // 3. Family marked relationships
      const allRels = await storage.getAllRelationships();
      for (const r of allRels) {
        if (r.familyRelationshipType) {
          edges.push([r.fromPersonId, r.toPersonId]);
        }
      }
    } else if (linkDefinition === "mutual") {
      const allRels = await storage.getAllRelationships();
      const relKeys = new Set<string>();
      for (const r of allRels) {
        relKeys.add(`${r.fromPersonId}->${r.toPersonId}`);
      }
      const addedKeys = new Set<string>();
      for (const r of allRels) {
        const backKey = `${r.toPersonId}->${r.fromPersonId}`;
        if (relKeys.has(backKey)) {
          const key = r.fromPersonId < r.toPersonId ? `${r.fromPersonId}-${r.toPersonId}` : `${r.toPersonId}-${r.fromPersonId}`;
          if (!addedKeys.has(key)) {
            edges.push([r.fromPersonId, r.toPersonId]);
            addedKeys.add(key);
          }
        }
      }
      const allParts = await db.select().from(partnerships);
      for (const p of allParts) {
        const key = p.person1Id < p.person2Id ? `${p.person1Id}-${p.person2Id}` : `${p.person2Id}-${p.person1Id}`;
        if (!addedKeys.has(key)) {
          edges.push([p.person1Id, p.person2Id]);
          addedKeys.add(key);
        }
      }
    } else { // any
      const allRels = await storage.getAllRelationships();
      for (const r of allRels) {
        edges.push([r.fromPersonId, r.toPersonId]);
      }
      const allParts = await db.select().from(partnerships);
      for (const p of allParts) {
        edges.push([p.person1Id, p.person2Id]);
      }
      const allLin = await db.select().from(lineage);
      for (const l of allLin) {
        edges.push([l.childId, l.parentId]);
      }
    }
  } else { // social_accounts
    const allAccounts = await db.select().from(socialAccounts);
    nodes = allAccounts.map(a => a.id);

    await storage.updateTaskProgress(taskId, 30, "Loading follow networks...");
    const allNetworkStates = await storage.getAllNetworkStates();

    if (linkDefinition === "mutual") {
      const followMap = new Set<string>();
      for (const ns of allNetworkStates) {
        const following = ns.following || [];
        for (const fId of following) {
          followMap.add(`${ns.socialAccountId}->${fId}`);
        }
      }
      const addedKeys = new Set<string>();
      for (const ns of allNetworkStates) {
        const following = ns.following || [];
        for (const fId of following) {
          const backKey = `${fId}->${ns.socialAccountId}`;
          if (followMap.has(backKey)) {
            const key = ns.socialAccountId < fId ? `${ns.socialAccountId}-${fId}` : `${fId}-${ns.socialAccountId}`;
            if (!addedKeys.has(key)) {
              edges.push([ns.socialAccountId, fId]);
              addedKeys.add(key);
            }
          }
        }
      }
    } else if (linkDefinition === "any") {
      const addedKeys = new Set<string>();
      for (const ns of allNetworkStates) {
        const following = ns.following || [];
        for (const fId of following) {
          const key = ns.socialAccountId < fId ? `${ns.socialAccountId}-${fId}` : `${fId}-${ns.socialAccountId}`;
          if (!addedKeys.has(key)) {
            edges.push([ns.socialAccountId, fId]);
            addedKeys.add(key);
          }
        }
      }
    }
  }

  await storage.updateTaskProgress(taskId, 50, "Running Label Propagation clustering...");
  
  const nodeSet = new Set(nodes);
  const validEdges: [string, string][] = [];
  const uniqueEdges = new Set<string>();

  for (const [u, v] of edges) {
    if (nodeSet.has(u) && nodeSet.has(v) && u !== v) {
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (!uniqueEdges.has(key)) {
        uniqueEdges.add(key);
        validEdges.push([u, v]);
      }
    }
  }

  const communities = runLabelPropagation(nodes, validEdges);

  await storage.updateTaskProgress(taskId, 80, "Calculating modularity and densities...");

  const E_total = uniqueEdges.size;
  const V_total = nodes.length;
  const D_global = V_total > 1 ? (2 * E_total) / (V_total * (V_total - 1)) : 0;

  const allPeople = entityType === "people" ? await storage.getAllPeople() : [];
  const allAccounts = entityType === "social_accounts" ? await db.select().from(socialAccounts) : [];

  const results: any[] = [];
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node, []);
  }
  for (const [u, v] of validEdges) {
    adjacency.get(u)?.push(v);
    adjacency.get(v)?.push(u);
  }

  for (const [lbl, communityNodes] of communities.entries()) {
    const C_size = communityNodes.length;
    if (C_size < minGroupSize) continue;

    const communitySet = new Set(communityNodes);
    let E_in = 0;
    for (const edgeKey of uniqueEdges) {
      const [u, v] = edgeKey.split('-');
      if (communitySet.has(u) && communitySet.has(v)) {
        E_in++;
      }
    }

    const D_C = C_size > 1 ? (2 * E_in) / (C_size * (C_size - 1)) : 0;

    if (D_global > 0) {
      const ratio = D_C / D_global;
      if (ratio < minDensityMultiplier) continue;
    } else {
      if (E_in === 0) continue;
    }

    const degrees = new Map<string, number>();
    for (const node of communityNodes) {
      let deg = 0;
      const neighbors = adjacency.get(node) || [];
      for (const nbr of neighbors) {
        if (communitySet.has(nbr)) deg++;
      }
      degrees.set(node, deg);
    }

    const sortedNodes = [...communityNodes].sort((a, b) => (degrees.get(b) || 0) - (degrees.get(a) || 0));
    const topNodes = sortedNodes.slice(0, 2);

    let clusteredAround = "";
    if (entityType === "people") {
      const names = topNodes.map(id => {
        const p = allPeople.find(person => person.id === id);
        return p ? `${p.firstName} ${p.lastName}` : "Unknown";
      });
      clusteredAround = names.join(" & ");
    } else {
      const names = topNodes.map(id => {
        const a = allAccounts.find(acc => acc.id === id);
        return a ? `@${a.username}` : "Unknown";
      });
      clusteredAround = names.join(" & ");
    }

    const suggestedName = `Potential Group (Clustered around ${clusteredAround})`;

    results.push({
      suggestedName,
      memberIds: communityNodes,
      density: D_C,
      globalDensity: D_global,
      densityRatio: D_global > 0 ? D_C / D_global : 1.0,
      internalEdgesCount: E_in,
    });
  }

  results.sort((a, b) => b.densityRatio - a.densityRatio);

  await storage.updateTaskProgress(taskId, 100, "Group detection analysis complete.");
  return JSON.stringify(results);
}

function runLabelPropagation(nodes: string[], edges: [string, string][], maxIterations = 20): Map<string, string[]> {
  const labels = new Map<string, string>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    labels.set(node, node);
    adjacency.set(node, []);
  }

  for (const [u, v] of edges) {
    adjacency.get(u)?.push(v);
    adjacency.get(v)?.push(u);
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    const shuffledNodes = [...nodes];
    for (let i = shuffledNodes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledNodes[i], shuffledNodes[j]] = [shuffledNodes[j], shuffledNodes[i]];
    }

    for (const node of shuffledNodes) {
      const neighbors = adjacency.get(node) || [];
      if (neighbors.length === 0) continue;

      const counts = new Map<string, number>();
      for (const neighbor of neighbors) {
        const lbl = labels.get(neighbor)!;
        counts.set(lbl, (counts.get(lbl) || 0) + 1);
      }

      let maxFreq = 0;
      let bestLabels: string[] = [];
      for (const [lbl, freq] of counts.entries()) {
        if (freq > maxFreq) {
          maxFreq = freq;
          bestLabels = [lbl];
        } else if (freq === maxFreq) {
          bestLabels.push(lbl);
        }
      }

      const chosenLabel = bestLabels[Math.floor(Math.random() * bestLabels.length)];
      if (labels.get(node) !== chosenLabel) {
        labels.set(node, chosenLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  const communities = new Map<string, string[]>();
  for (const [node, lbl] of labels.entries()) {
    if (!communities.has(lbl)) {
      communities.set(lbl, []);
    }
    communities.get(lbl)!.push(node);
  }

  return communities;
}

async function processNextTask(): Promise<boolean> {
  const task = await storage.getNextPendingTask();
  if (!task) return false;

  log(`[TaskWorker] Processing task ${task.id} (type: ${task.type})`);
  await storage.updateTaskStatus(task.id, "in_progress");

  try {
    let result: string;

    switch (task.type) {
      case "calculate_crowd": {
        const payload = JSON.parse(task.payload);
        result = await processCalculateCrowd(task.id, payload);
        break;
      }
      case "find_potential_groups": {
        const payload = JSON.parse(task.payload);
        result = await processFindPotentialGroups(task.id, payload);
        break;
      }
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
