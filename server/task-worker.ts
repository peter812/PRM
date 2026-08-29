import { storage } from "./storage";
import { db } from "./db";
import { syncEntityInBackground } from "./vector-universal";
import { uploadImageToS3, deleteImageFromS3, uploadMediaToS3 } from "./s3";
import { uploadImageLocally, deleteImageLocally, isLocalImageUrl, uploadMediaLocally } from "./local-storage";
import AdmZip from "adm-zip";
import { loadThreadFolder, type ParsedThread, type ParsedMessage, type ParsedMedia } from "./instagram-dm-import";
import { log } from "./vite";
import { runAutomaticImagePassIn, autoPassInImageForSocialAccount } from "./image-pass-in-utils";
import { runAsSystem, runAsUser, actingUserId } from "./access";
import {
  INSTAGRAM_USER_AGENT,
  getImageDimensions,
  fetchProfileImage,
  shouldReplaceProfileImage,
  storeProfileImage,
  getCurrentProfileImageUrl,
} from "./profile-image";
import {
  applySnapshot,
  recordProfileImageChange,
  capturesFollowers,
  capturesFollowing,
  type CaptureScope,
} from "./social-account-history";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
import Papa from "papaparse";
import { sseManager } from "./middleware/sse";

interface MessageMetadata {
  reactions?: any[];
  share?: any;
  callDurationSec?: number;
  senderName?: string;
  [key: string]: any;
}

interface MessageAttachment {
  type: string;
  originalUri?: string;
  unavailable?: boolean;
  reason?: string;
  [key: string]: any;
}
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
  groups,
  relationships,
  socialFollows,
  schooling,
  subGroups,
  truePersonSearch,
  faces,
} from "@shared/schema";
import { escapeXml, arrayToXml, parseXmlTag, parseAllTags, parseXmlArray, unescapeXml } from "./xml-utils";

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

  const fetched = await fetchProfileImage(imageUrl);

  const currentImageUrl = await getCurrentProfileImageUrl(socialAccountId);
  const verdict = await shouldReplaceProfileImage(currentImageUrl, fetched);
  if (!verdict.replace) {
    log(`[ImageWorker] Skipping download for ${socialAccountId} — ${verdict.reason}`);
    return JSON.stringify({ skipped: true, reason: verdict.reason, socialAccountId });
  }

  // Re-check cancellation before performing upload (slow I/O)
  const freshTask = await storage.getImageTaskById(imageTaskId);
  if (!freshTask || freshTask.status === "cancelled") {
    log(`[ImageWorker] Task ${imageTaskId} cancelled before upload — aborting`);
    return JSON.stringify({ skipped: true, reason: "cancelled", socialAccountId });
  }

  const { cdnUrl, photoId } = await storeProfileImage(fetched, socialAccountId);

  // Re-check cancellation again after upload before persisting changes
  const postUploadTask = await storage.getImageTaskById(imageTaskId);
  if (!postUploadTask || postUploadTask.status === "cancelled") {
    log(`[ImageWorker] Task ${imageTaskId} cancelled after upload — skipping DB writes`);
    return JSON.stringify({ skipped: true, reason: "cancelled_post_upload", socialAccountId });
  }

  await recordProfileImageChange(socialAccountId, cdnUrl, currentImageUrl);

  // TRANSITIONAL: social_profile_versions is still read by the routes and the UI.
  // Remove this write, and the profileVersionId payload field, when those readers
  // move to social_accounts.image_url and the table is dropped.
  const targetVersionId =
    profileVersionId || (await storage.getCurrentProfileVersion(socialAccountId))?.id || null;
  if (targetVersionId) {
    await storage.updateProfileVersion(targetVersionId, { imageUrl: cdnUrl });
  }

  // Link the photo to this image task
  await db.update(imageTasks).set({ photoId }).where(eq(imageTasks.id, imageTaskId));

  // Automatically pass in the image to any linked person who doesn't have an image
  await autoPassInImageForSocialAccount(socialAccountId);

  return JSON.stringify({ cdnUrl, socialAccountId, photoId, widthPx: fetched.dims?.width ?? null });
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
  const task = await runAsSystem(() => storage.getNextPendingImageTask());
  if (!task) return false;

  log(`[ImageWorker] Processing image task ${task.id} (type: ${task.type})`);
  await runAsSystem(() => storage.updateImageTaskStatus(task.id, "in_progress"));

  const effectiveUserId = task.userId || (await runAsSystem(() => storage.getAllUsers()))[0]?.id;

  return runAsUser(effectiveUserId, async () => {
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
  });
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
  // Counts are derived directly from the social_follows edge table.
  const state = await storage.getNetworkState(socialAccountId);
  if (!state) {
    return JSON.stringify({ socialAccountId, message: "Account not found", followerCount: 0, followingCount: 0 });
  }
  return JSON.stringify({ socialAccountId, followerCount: state.followerCount, followingCount: state.followingCount });
}


// ── Export XML task ──────────────────────────────────────────────────────────

async function processExportXmlTask(taskId: string, payload: {
  includeHistory: boolean;
  userId: number;
  filename?: string;
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

  const [allProfileVersions, allFollows, mePersonResult] = await Promise.all([
    storage.getAllProfileVersions(),
    storage.getAllFollows(),
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
  const followersMap = new Map<string, string[]>();
  const followingMap = new Map<string, string[]>();
  for (const edge of allFollows) {
    const followers = followersMap.get(edge.followedId);
    if (followers) followers.push(edge.followerId);
    else followersMap.set(edge.followedId, [edge.followerId]);
    const following = followingMap.get(edge.followerId);
    if (following) following.push(edge.followedId);
    else followingMap.set(edge.followerId, [edge.followedId]);
  }

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
    const members = (group.members || []).map((id: string) => id === mePersonId ? ZERO_UUID : id);
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
    xml += '    <social_account>\n';
    xml += `      <id>${escapeXml(account.id)}</id>\n`;
    xml += `      <username>${escapeXml(account.username)}</username>\n`;
    xml += `      <nickname>${escapeXml(account.currentProfile?.nickname || "")}</nickname>\n`;
    xml += `      <account_url>${escapeXml(account.currentProfile?.accountUrl || "")}</account_url>\n`;
    xml += `      <owner_uuid>${escapeXml(ownerUuid || "")}</owner_uuid>\n`;
    xml += `      <type_id>${escapeXml(account.typeId || "")}</type_id>\n`;
    xml += `      <image_url>${escapeXml(account.currentProfile?.imageUrl || "")}</image_url>\n`;
    xml += `      <notes></notes>\n`;
    xml += `      <following>${arrayToXml(followingMap.get(account.id) || [], "account_id")}</following>\n`;
    xml += `      <followers>${arrayToXml(followersMap.get(account.id) || [], "account_id")}</followers>\n`;
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
    for (const account of allSocialAccounts) {
      const snapFollowers = followersMap.get(account.id) || [];
      const snapFollowing = followingMap.get(account.id) || [];
      if (snapFollowers.length === 0 && snapFollowing.length === 0) continue;
      xml += '    <social_network_snapshot>\n';
      xml += `      <id>${escapeXml(account.id)}</id>\n`;
      xml += `      <social_account_id>${escapeXml(account.id)}</social_account_id>\n`;
      xml += `      <follower_count>${escapeXml(snapFollowers.length)}</follower_count>\n`;
      xml += `      <following_count>${escapeXml(snapFollowing.length)}</following_count>\n`;
      xml += `      <followers>${arrayToXml(snapFollowers, "account_id")}</followers>\n`;
      xml += `      <following>${arrayToXml(snapFollowing, "account_id")}</following>\n`;
      xml += `      <captured_at>${escapeXml(new Date())}</captured_at>\n`;
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

  const backupsDir = path.join(process.cwd(), "backups");
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const nowStr = new Date().toISOString().replace(/[:.]/g, "-");
  let fileName = payload.filename
    ? (payload.filename.endsWith(".xml") ? payload.filename : `${payload.filename}.xml`)
    : `crm-backup-${nowStr}.xml`;

  // Sanitize filename to avoid path traversal
  fileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!fileName.endsWith(".xml")) fileName += ".xml";

  const filePath = path.join(backupsDir, fileName);
  fs.writeFileSync(filePath, xml, "utf8");

  return `backups/${fileName}`;
}

// ── Import XML task ──────────────────────────────────────────────────────────

async function processImportXmlTask(taskId: string, payload: {
  xml?: string;
  filePath?: string;
  userId: number;
}): Promise<string> {
  let xmlText = payload.xml || "";
  if (!xmlText && payload.filePath) {
    const fullPath = path.isAbsolute(payload.filePath)
      ? payload.filePath
      : path.join(process.cwd(), payload.filePath);
    if (fs.existsSync(fullPath)) {
      xmlText = fs.readFileSync(fullPath, "utf8");
    }
  }
  if (!xmlText) {
    throw new Error("No XML data found for restore/import task");
  }
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
      await storage.createNoteWithId({ id, userId: payload.userId, personId, content, imageUrl: imageUrl || null, imageUuid: imageUuid || null });
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

  // Follow edges referenced in the file, keyed by the file's account ids.
  // Resolved through socialAccountIdMap and inserted after all accounts exist.
  const pendingFollowEdges: { followerId: string; followedId: string }[] = [];
  const collectFollowEdges = (accountId: string, followerIds: string[], followingIds: string[]) => {
    for (const f of followerIds) {
      if (f) pendingFollowEdges.push({ followerId: f, followedId: accountId });
    }
    for (const g of followingIds) {
      if (g) pendingFollowEdges.push({ followerId: accountId, followedId: g });
    }
  };

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
      collectFollowEdges(id, followers, following);
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
      collectFollowEdges(id, followers, following);
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

      const snFollowers = parseXmlArray("followers", "account_id", block);
      const snFollowing = parseXmlArray("following", "account_id", block);
      collectFollowEdges(socialAccountId, snFollowers, snFollowing);
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

  // Insert the collected follow edges now that every referenced account exists.
  // Ids are remapped for accounts that matched an existing account; edges
  // pointing at accounts not present in the database are skipped.
  const resolveFollowId = (fileId: string) => socialAccountIdMap.get(fileId) || fileId;
  await storage.addFollows(
    pendingFollowEdges
      .map(e => ({ followerId: resolveFollowId(e.followerId), followedId: resolveFollowId(e.followedId), source: "xml-import" }))
      .filter(e => existingSocialAccountUuids.has(e.followerId) && existingSocialAccountUuids.has(e.followedId))
  );

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
        id, userId: payload.userId, date, userTitle, body,
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

  // Parse and import schooling
  const schoolingBlocks = parseAllTags("schooling_entry", xmlText);
  for (const block of schoolingBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = replaceZeroUUID(unescapeXml(parseXmlTag("person_id", block)));
    const highSchool = unescapeXml(parseXmlTag("high_school", block)) || null;
    const collegesStr = unescapeXml(parseXmlTag("colleges", block));
    const additionalSchoolingStr = unescapeXml(parseXmlTag("additional_schooling", block));
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));

    try {
      await db.insert(schooling).values({
        id,
        personId,
        highSchool,
        colleges: collegesStr ? JSON.parse(collegesStr) : [],
        additionalSchooling: additionalSchoolingStr ? JSON.parse(additionalSchoolingStr) : [],
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      importedCounts.schooling = (importedCounts.schooling || 0) + 1;
    } catch (e) {
      console.error(`Error importing schooling entry ${id}:`, e);
    }
  }

  // Parse and import sub_groups
  const subGroupBlocks = parseAllTags("sub_group_entry", xmlText);
  for (const block of subGroupBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const groupId = unescapeXml(parseXmlTag("group_id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const members = parseXmlArray("members", "member_id", block);
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    const processedMembers = members.map(m => replaceZeroUUID(m));

    if (!groupId || !name || !color) continue;

    try {
      await db.insert(subGroups).values({
        id,
        groupId,
        name,
        color,
        members: processedMembers,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      importedCounts.subGroups = (importedCounts.subGroups || 0) + 1;
    } catch (e) {
      console.error(`Error importing sub_group entry ${id}:`, e);
    }
  }

  // Parse and import true_person_search
  const tpsBlocks = parseAllTags("true_person_search_entry", xmlText);
  for (const block of tpsBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const tpsId = unescapeXml(parseXmlTag("tps_id", block));
    if (!tpsId) continue;

    let personId: string | null = unescapeXml(parseXmlTag("person_id", block)) || null;
    if (personId) personId = replaceZeroUUID(personId);
    const importDateStr = unescapeXml(parseXmlTag("import_date", block));
    const fullName = unescapeXml(parseXmlTag("full_name", block)) || null;
    const akasStr = unescapeXml(parseXmlTag("akas", block));
    const birthday = unescapeXml(parseXmlTag("birthday", block)) || null;
    const currentAddress = unescapeXml(parseXmlTag("current_address", block)) || null;
    const currentAddressPropertyDetails = unescapeXml(parseXmlTag("current_address_property_details", block)) || null;
    const currentAddressPropertyUrl = unescapeXml(parseXmlTag("current_address_property_url", block)) || null;
    const addressesStr = unescapeXml(parseXmlTag("addresses", block));
    const phoneNumbersStr = unescapeXml(parseXmlTag("phone_numbers", block));
    const emailsStr = unescapeXml(parseXmlTag("emails", block));
    const relativesStr = unescapeXml(parseXmlTag("relatives", block));
    const associatesStr = unescapeXml(parseXmlTag("associates", block));
    const backgroundProfile = unescapeXml(parseXmlTag("background_profile", block)) || null;
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    const updatedAtStr = unescapeXml(parseXmlTag("updated_at", block));

    try {
      await db.insert(truePersonSearch).values({
        id,
        tpsId,
        personId: personId || null,
        importDate: importDateStr ? new Date(importDateStr) : new Date(),
        fullName,
        akas: akasStr ? JSON.parse(akasStr) : [],
        birthday,
        currentAddress,
        currentAddressPropertyDetails,
        currentAddressPropertyUrl,
        addresses: addressesStr ? JSON.parse(addressesStr) : [],
        phoneNumbers: phoneNumbersStr ? JSON.parse(phoneNumbersStr) : [],
        emails: emailsStr ? JSON.parse(emailsStr) : [],
        relatives: relativesStr ? JSON.parse(relativesStr) : [],
        associates: associatesStr ? JSON.parse(associatesStr) : [],
        backgroundProfile,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
        updatedAt: updatedAtStr ? new Date(updatedAtStr) : new Date(),
      }).onConflictDoNothing();
      importedCounts.truePersonSearch = (importedCounts.truePersonSearch || 0) + 1;
    } catch (e) {
      console.error(`Error importing true_person_search entry ${id}:`, e);
    }
  }

  // Parse and import faces
  const faceBlocks = parseAllTags("face_entry", xmlText);
  for (const block of faceBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const photoId = unescapeXml(parseXmlTag("photo_id", block)) || null;
    const s3Url = unescapeXml(parseXmlTag("s3_url", block));
    const embeddingStr = unescapeXml(parseXmlTag("embedding", block));
    const personfaceUuid = unescapeXml(parseXmlTag("personface_uuid", block)) || null;
    const detectionConfidence = unescapeXml(parseXmlTag("detection_confidence", block)) || null;
    const coordinatesStr = unescapeXml(parseXmlTag("coordinates", block));
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));

    if (!s3Url) continue;

    try {
      await db.insert(faces).values({
        id,
        photoId,
        s3Url,
        embedding: embeddingStr ? JSON.parse(embeddingStr) : [],
        personfaceUuid,
        detectionConfidence,
        coordinates: coordinatesStr ? JSON.parse(coordinatesStr) : null,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      importedCounts.faces = (importedCounts.faces || 0) + 1;
    } catch (e) {
      console.error(`Error importing face entry ${id}:`, e);
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
  // Counts are derived directly from the social_follows edge table, so there
  // is nothing to recompute; report totals for visibility.
  const allAccounts = await storage.getAllSocialAccounts();
  const allFollows = await storage.getAllFollows();
  return JSON.stringify({ refreshed: allAccounts.length, skipped: 0, total: allAccounts.length, followEdges: allFollows.length });
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
          userId: actingUserId(),
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
          userId: actingUserId(),
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

  // Record each relationship as a single directed edge; both directions of
  // the UI (target's followers and each account's following) read the same rows.
  const edges: { followerId: string; followedId: string; source: string }[] = [];
  if (importType === "followers") {
    for (const id of processedAccountIds) edges.push({ followerId: id, followedId: accountId, source: "csv-import" });
    for (const id of mutualFollowIds) edges.push({ followerId: accountId, followedId: id, source: "csv-import" });
  } else {
    for (const id of processedAccountIds) edges.push({ followerId: accountId, followedId: id, source: "csv-import" });
    for (const id of mutualFollowIds) edges.push({ followerId: id, followedId: accountId, source: "csv-import" });
  }
  await storage.addFollows(edges);

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

// ── Instagram DM export import ────────────────────────────────────────────────

/** Sniff an image MIME type from magic bytes (export photos may lack extensions). */
function sniffImageMime(buffer: Buffer): { mime: string; ext: string } {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString("ascii") === "PNG") {
    return { mime: "image/png", ext: "png" };
  }
  if (buffer.length >= 6 && buffer.subarray(0, 4).toString("ascii") === "GIF8") {
    return { mime: "image/gif", ext: "gif" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return { mime: "image/heic", ext: "heic" };
  }
  return { mime: "image/jpeg", ext: "jpg" };
}

/**
 * Resolve an export-relative media uri (e.g.
 * "your_instagram_activity/messages/inbox/<thread>/photos/x.jpg") to a path
 * inside the extracted thread folder. Returns null for remote or missing files.
 */
function resolveMediaPath(threadFolder: string, uri: string): string | null {
  if (/^https?:\/\//i.test(uri)) return null;
  const parts = uri.split("/").filter(Boolean);
  const threadBase = path.basename(threadFolder);
  const idx = parts.indexOf(threadBase);
  const candidates: string[] = [];
  if (idx >= 0) candidates.push(path.join(threadFolder, ...parts.slice(idx + 1)));
  if (parts.length >= 2) candidates.push(path.join(threadFolder, ...parts.slice(-2)));
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(path.resolve(threadFolder))) continue; // no escaping the thread dir
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

function mediaMimeForFile(kind: "video" | "audio", filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "mp4";
  if (kind === "audio") {
    if (ext === "mp3") return "audio/mpeg";
    if (ext === "wav") return "audio/wav";
    if (ext === "ogg") return "audio/ogg";
    return "audio/mp4"; // Instagram voice clips are .mp4/.m4a containers
  }
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "video/mp4";
}

/** Find every extracted directory that contains message_1.json */
function findThreadFolders(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && /^message_\d+\.json$/.test(e.name))) {
      found.push(dir);
      return; // thread folders don't nest
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
    }
  };
  walk(root);
  return found;
}

interface ImportDmOptions {
  skipNoise?: boolean;
  importMedia?: boolean;
}

interface ImportThreadSummary {
  conversationId: string;
  threadFolder: string;
  /** True when the stored content hash matched and the thread was skipped whole */
  skippedUnchanged: boolean;
  inserted: number;
  skippedDuplicates: number;
  skippedNoise: number;
  photosImported: number;
  videosImported: number;
  audioImported: number;
  mediaUnavailable: number;
}

async function importOneDmThread(
  taskId: string,
  userId: number,
  threadFolder: string,
  root: { socialAccountId: string; username: string },
  options: ImportDmOptions,
  progress: { threadIndex: number; threadCount: number },
): Promise<ImportThreadSummary> {
  const skipNoise = options.skipNoise !== false;
  const importMedia = options.importMedia !== false;

  const parsed: ParsedThread = loadThreadFolder(threadFolder);
  const storageMode = await storage.getImageStorageMode(userId);
  const importUuid = crypto.randomUUID();
  const importDate = new Date();

  // ── Resolve the counterpart social account ──
  // The thread folder is "<counterpartUsername>_<threadId>". The root account
  // (whose backup this is) owns every conversation; the counterpart is the
  // other party. A self-note thread (counterpart == root) has no counterpart.
  const isSelfThread = parsed.username.toLowerCase() === root.username.toLowerCase();
  const isGroup = parsed.participants.length > 2;
  let counterpartId: string | null = null;
  if (!isSelfThread && !isGroup) {
    const instagramType = await storage.getSocialAccountTypeByName("instagram");
    const allAccounts = await storage.getAllSocialAccounts();
    const existing = allAccounts.find(
      (a) => a.username.toLowerCase() === parsed.username.toLowerCase()
    );
    if (existing) {
      counterpartId = existing.id;
    } else {
      const newAccount = await storage.createSocialAccount({
        username: parsed.username,
        ownerUuid: null,
        typeId: instagramType?.id || null,
        internalAccountCreationType: "dm backup import",
      });
      const currentProfile = await storage.getCurrentProfileVersion(newAccount.id);
      if (currentProfile) {
        // Non-owner participant's display name; export owner is listed last
        const nickname = parsed.participants.length >= 1 ? parsed.participants[0] : null;
        await storage.updateProfileVersion(currentProfile.id, {
          nickname,
          accountUrl: `https://instagram.com/${parsed.username}`,
        });
      }
      counterpartId = newAccount.id;
    }
  }

  // Meta exports list the export owner (the root account) as the last
  // participant — this is the display name used to attribute owner messages.
  const ownerName = parsed.participants.length > 0
    ? parsed.participants[parsed.participants.length - 1]
    : null;

  // ── Resolve or create the conversation ──
  let conversation = await storage.getConversationByIgThreadId(parsed.threadId);
  if (!conversation) {
    conversation = await storage.createConversation({
      createdByUserId: userId,
      title: parsed.title,
      channelType: "instagram",
      // Primary "other party" ref; both sides are also in participants below
      socialAccountId: counterpartId,
      externalUrl: null,
      metadata: {
        igThreadId: parsed.threadId,
        threadFolder: path.basename(threadFolder),
        rootUsername: root.username,
        isGroup,
        // Export owner's display name — labels the owner side in perspective views
        ownerName,
      },
      lastMessageAt: null,
      importDate,
      importUuid,
    });
    // Owner participant references the root account (enables owner-on-the-right
    // perspective on the root account's profile)
    await storage.addConversationParticipant({
      conversationId: conversation.id,
      personId: null,
      socialAccountId: root.socialAccountId,
      role: "owner",
      importDate,
      importUuid,
    });
    if (counterpartId) {
      await storage.addConversationParticipant({
        conversationId: conversation.id,
        personId: null,
        socialAccountId: counterpartId,
        role: "participant",
        importDate,
        importUuid,
      });
    }
  }

  const summary: ImportThreadSummary = {
    conversationId: conversation.id,
    threadFolder: path.basename(threadFolder),
    skippedUnchanged: false,
    inserted: 0,
    skippedDuplicates: 0,
    skippedNoise: 0,
    photosImported: 0,
    videosImported: 0,
    audioImported: 0,
    mediaUnavailable: 0,
  };

  // Fast path: if we've imported this exact file content before, skip the whole
  // thread without touching individual messages. A changed hash falls through
  // to the message-level import below (existing externalIds are still skipped).
  const priorHash = (conversation.metadata as any)?.importHash;
  if (priorHash && priorHash === parsed.contentHash) {
    summary.skippedUnchanged = true;
    return summary;
  }

  const existingExternalIds = await storage.getMessageExternalIds(conversation.id);

  const total = parsed.messages.length;
  for (let i = 0; i < total; i++) {
    const msg: ParsedMessage = parsed.messages[i];

    if (i % 50 === 0) {
      if (await isTaskCancelled(taskId)) {
        throw new Error("cancelled");
      }
      const threadShare = 100 / progress.threadCount;
      const pct = Math.min(
        99,
        Math.round(progress.threadIndex * threadShare + (i / Math.max(total, 1)) * threadShare)
      );
      await storage.updateTaskProgress(
        taskId,
        pct,
        `Thread ${progress.threadIndex + 1}/${progress.threadCount}: message ${i}/${total}`
      );
    }

    if (existingExternalIds.has(msg.externalId)) {
      summary.skippedDuplicates++;
      continue;
    }
    if (skipNoise && msg.isSystemNoise) {
      summary.skippedNoise++;
      continue;
    }

    // Owner messages are attributed to the root account; everything else to the
    // counterpart (null in group threads, where we fall back to the raw name)
    const isOwner = ownerName !== null && msg.senderName === ownerName;
    const senderSocialAccountId = isOwner ? root.socialAccountId : counterpartId;

    const metadata: MessageMetadata = {};
    if (msg.reactions.length > 0) metadata.reactions = msg.reactions;
    if (msg.share) metadata.share = msg.share;
    if (msg.callDurationSec !== undefined) metadata.callDurationSec = msg.callDurationSec;
    if (!senderSocialAccountId) metadata.senderName = msg.senderName;

    let content = msg.content;
    if (content === null && msg.callDurationSec !== undefined) {
      const mins = Math.floor(msg.callDurationSec / 60);
      const secs = msg.callDurationSec % 60;
      content = `Call (${mins}m ${secs}s)`;
    }

    const recipients = isOwner
      ? counterpartId
        ? [{ socialAccountId: counterpartId, recipientType: "to" }]
        : []
      : [{ socialAccountId: root.socialAccountId, recipientType: "to" }];

    const message = await storage.createMessage(
      {
        conversationId: conversation.id,
        senderPersonId: null,
        senderSocialAccountId,
        content,
        contentType: msg.media.length > 0 && !content ? "media" : "text",
        imageUuids: [],
        attachments: null,
        externalId: msg.externalId,
        sentAt: msg.sentAt,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
        importDate,
        importUuid,
      },
      recipients
    );
    existingExternalIds.add(msg.externalId);
    summary.inserted++;
    void syncEntityInBackground("message", message.id);

    if (!importMedia || msg.media.length === 0) continue;

    // ── Media: photos → photos table + imageUuids; video/audio → attachments ──
    const imageUuids: string[] = [];
    const attachments: MessageAttachment[] = [];

    for (const media of msg.media as ParsedMedia[]) {
      const filePath = resolveMediaPath(threadFolder, media.uri);

      if (media.kind === "photo") {
        if (!filePath) {
          attachments.push({
            type: "file",
            originalUri: media.uri,
            unavailable: true,
            reason: media.isRemote ? "expired-cdn-url" : "file-missing",
          });
          summary.mediaUnavailable++;
          continue;
        }
        const buffer = fs.readFileSync(filePath);
        const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
        const existingPhoto = await storage.getPhotoByFileHash(fileHash);
        if (existingPhoto) {
          imageUuids.push(existingPhoto.id);
          summary.photosImported++;
          continue;
        }
        const { mime, ext } = sniffImageMime(buffer);
        const fileName = path.basename(filePath).includes(".")
          ? path.basename(filePath)
          : `${path.basename(filePath)}.${ext}`;
        const imageUrl =
          storageMode === "local"
            ? await uploadImageLocally(buffer, fileName, mime)
            : await uploadImageToS3(buffer, fileName, mime);
        const photo = await storage.insertPhoto({
          location: imageUrl,
          prmLocation: `message:${message.id}`,
          isSubImage: false,
          fileHash,
          ogMetadata: { source: "instagram-export", originalUri: media.uri },
        });
        imageUuids.push(photo.id);
        summary.photosImported++;
      } else {
        // video / audio
        if (!filePath) {
          attachments.push({
            type: media.kind,
            originalUri: media.uri,
            unavailable: true,
            reason: media.isRemote ? "expired-cdn-url" : "file-missing",
          });
          summary.mediaUnavailable++;
          continue;
        }
        const buffer = fs.readFileSync(filePath);
        const mimeType = mediaMimeForFile(media.kind, filePath);
        const url =
          storageMode === "local"
            ? await uploadMediaLocally(buffer, path.basename(filePath), mimeType)
            : await uploadMediaToS3(buffer, path.basename(filePath), mimeType);
        attachments.push({
          type: media.kind,
          url,
          originalUri: media.uri,
          mimeType,
          sizeBytes: buffer.length,
          ...(media.creationTimestamp !== undefined
            ? { creationTimestamp: media.creationTimestamp }
            : {}),
        });
        if (media.kind === "video") summary.videosImported++;
        else summary.audioImported++;
      }
    }

    if (imageUuids.length > 0 || attachments.length > 0) {
      await storage.updateMessage(message.id, {
        imageUuids,
        attachments: attachments.length > 0 ? attachments : null,
      });
    }
  }

  // Record the content hash + date so an identical re-import skips this thread
  await storage.updateConversation(conversation.id, {
    metadata: {
      ...(conversation.metadata as Record<string, unknown> | null),
      importHash: parsed.contentHash,
      importHashDate: importDate.toISOString(),
    },
  });

  return summary;
}

async function queueSocialProfileImage(
  socialAccountId: string,
  imageUrl: string | null | undefined,
  userId: number,
  parentTaskId?: string,
) {
  if (!imageUrl || !imageUrl.trim()) return;

  // The signed Instagram url is a lead for the image worker to follow, never a
  // display source, so it goes straight onto the account.
  //
  // This used to fetch-or-create a profile version first, purely to put its id in the
  // payload. The worker resolves that itself when the field is absent, so those one or
  // two queries per image bought nothing — and on a graph import with includeGraphImages
  // they were tens of thousands of round trips.
  await db
    .update(socialAccounts)
    .set({ externalImageUrl: imageUrl })
    .where(eq(socialAccounts.id, socialAccountId));

  await storage.createImageTask({
    userId,
    type: "download_img_instagram",
    status: "pending",
    parentTaskId: parentTaskId || null,
    payload: JSON.stringify({ socialAccountId, imageUrl }),
  });
}

/**
 * Parses the CSV a "full" extension pull produces.
 *
 * Two shapes arrive: a real CSV with headers, and a bare newline-separated list of
 * handles. The header sniff is deliberately loose because the extension has changed
 * its column names more than once.
 */
function parseCsvRows(csvText: string | null | undefined): any[] {
  if (!csvText || !csvText.trim()) return [];
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const firstLine = lines[0].toLowerCase();
  const hasHeaders = firstLine.includes("username") || firstLine.includes("handle") || firstLine.includes(",") || firstLine.includes("account");
  if (hasHeaders) {
    return (Papa.parse(csvText, { header: true, skipEmptyLines: true }).data || []) as any[];
  }
  return lines.map(line => ({ username: line.replace(/^@/, "").trim() }));
}

const handleOf = (row: any): string =>
  (row.username || row.handle || row.Account || row.Username || "")
    .toString().trim().replace(/^@/, "").toLowerCase();

/**
 * Resolves scraped handles to social account ids, creating the ones PRM has never
 * seen before.
 *
 * The previous implementation ran two queries and up to two writes per CSV row, so a
 * 10,000-follower pull cost roughly 30,000 round trips. This does it in three
 * statements regardless of size, which is also what lets the whole ingest sit inside
 * a single transaction.
 */
async function resolveScrapedAccounts(
  rows: any[],
  typeId: string | null,
): Promise<Map<string, string>> {
  const byHandle = new Map<string, any>();
  for (const row of rows) {
    const handle = handleOf(row);
    // First mention wins: later rows for the same handle carry no extra information.
    if (handle && !byHandle.has(handle)) byHandle.set(handle, row);
  }
  if (byHandle.size === 0) return new Map();

  const handles = [...byHandle.keys()];
  const resolved = new Map<string, string>();

  const CHUNK = 500;
  for (let i = 0; i < handles.length; i += CHUNK) {
    const batch = handles.slice(i, i + CHUNK);
    const existing = await db
      .select({ id: socialAccounts.id, username: socialAccounts.username })
      .from(socialAccounts)
      .where(inArray(socialAccounts.username, batch));
    for (const a of existing) resolved.set(a.username, a.id);
  }

  const missing = handles.filter(h => !resolved.has(h));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const batch = missing.slice(i, i + CHUNK);
    const created = await db
      .insert(socialAccounts)
      .values(batch.map(handle => {
        const row = byHandle.get(handle);
        return {
          username: handle,
          typeId: typeId || undefined,
          ownerUuid: null,
          internalAccountCreationType: "PRM-chrome import",
          nickname: row.full_name || row.displayName || null,
          accountUrl: `https://instagram.com/${handle}`,
        };
      }))
      .returning({ id: socialAccounts.id, username: socialAccounts.username });
    for (const a of created) resolved.set(a.username, a.id);
  }

  return resolved;
}

/**
 * Ingests a pending social account extraction (scraped via extension) in the background.
 *
 * Everything that touches follow edges, denormalized counts, or the history journal
 * goes through applySnapshot, which is the only writer of all three.
 */
export async function processImportSocial(
  taskId: string,
  payload: {
    pendingImportId: string;
    includeGraphImages?: boolean;
  },
): Promise<string> {
  const { pendingImportId, includeGraphImages = false } = payload;
  const record = await storage.getPendingSocialAccountImportById(pendingImportId);
  if (!record) {
    throw new Error(`Pending social account import ${pendingImportId} not found`);
  }

  const userId = actingUserId() || 1;
  const instagramType = await storage.getSocialAccountTypeByName("instagram");
  const typeId = instagramType?.id || null;

  await storage.updateTaskProgress(taskId, 5, `Setting up profile @${record.accountUsername}...`);

  // 1. Resolve or create the account this pull is about.
  const mainUsername = record.accountUsername.trim().toLowerCase();
  let [mainAccount] = await db.select().from(socialAccounts).where(eq(socialAccounts.username, mainUsername)).limit(1);
  if (!mainAccount) {
    mainAccount = await storage.createSocialAccount({
      username: mainUsername,
      typeId: typeId || undefined,
      ownerUuid: null,
      internalAccountCreationType: "PRM-chrome import",
    });
  }

  // 2. The scraped account's own picture is fetched inline, because whether it
  //    changed is part of what this import records. Instagram's urls are signed and
  //    rotate every scrape, so only the bytes can answer that.
  await storage.updateTaskProgress(taskId, 10, "Checking profile image...");
  let imageUrl: string | undefined;
  if (record.accountImageUrl?.trim()) {
    try {
      const fetched = await fetchProfileImage(record.accountImageUrl);
      const verdict = await shouldReplaceProfileImage(mainAccount.imageUrl, fetched);
      if (verdict.replace) {
        imageUrl = (await storeProfileImage(fetched, mainAccount.id)).cdnUrl;
      }
    } catch (e) {
      // A dead CDN link must not sink the whole import; the rest of the pull is fine.
      log(`[TaskWorker] Profile image fetch failed for @${mainUsername}: ${e}`);
    }
  }

  // 3. Resolve the captured graph. Only directions that actually came back are
  //    passed to applySnapshot — an absent direction must never read as an unfollow.
  // The extension states what it finished collecting (contract v2). Trust it: only
  // the extension can distinguish a follower list that is genuinely short from one
  // whose scroll was cut off, and under authoritative deletion that difference is the
  // difference between recording no change and inventing hundreds of unfollows.
  //
  // Older builds send nothing, so fall back to inferring from which lists arrived.
  const gotFollowers = Boolean(record.accountFollowers?.trim());
  const gotFollowing = Boolean(record.accountFollowing?.trim());
  const scope: CaptureScope =
    (record.captureScope as CaptureScope | null) ??
    (record.importType === "account" ? "profile"
      : gotFollowers && gotFollowing ? "both"
      : gotFollowers ? "followers"
      : gotFollowing ? "following"
      : "profile");

  let followerIds: string[] | undefined;
  let followingIds: string[] | undefined;
  const graphRows: any[] = [];
  let resolved = new Map<string, string>();

  if (scope !== "profile") {
    await storage.updateTaskProgress(taskId, 25, "Resolving accounts...");
    const followerRows = capturesFollowers(scope) ? parseCsvRows(record.accountFollowers) : [];
    const followingRows = capturesFollowing(scope) ? parseCsvRows(record.accountFollowing) : [];
    graphRows.push(...followerRows, ...followingRows);

    resolved = await resolveScrapedAccounts(graphRows, typeId);
    const idsFor = (rows: any[]) =>
      rows.map(r => resolved.get(handleOf(r))).filter((id): id is string => Boolean(id));

    if (capturesFollowers(scope)) followerIds = idsFor(followerRows);
    if (capturesFollowing(scope)) followingIds = idsFor(followingRows);
  }

  if (await isTaskCancelled(taskId)) {
    return JSON.stringify({ cancelled: true });
  }

  // 4. One transaction: diff the edges, update current state, write the journal.
  await storage.updateTaskProgress(taskId, 60, "Recording changes...");
  const entry = await applySnapshot({
    socialAccountId: mainAccount.id,
    scope,
    followerIds,
    followingIds,
    profile: {
      nickname: record.accountDisplayName || undefined,
      bio: record.accountBio || undefined,
      location: record.accountLocationArea || undefined,
      accountUrl: `https://instagram.com/${mainUsername}`,
      imageUrl,
      externalImageUrl: record.accountImageUrl || undefined,
      reportedFollowersCount: record.accountFollowersCount ?? undefined,
      reportedFollowingCount: record.accountFollowingCount ?? undefined,
    },
    source: "extension",
    pendingImportId: record.id,
  });

  // 5. Graph avatars stay on the async queue. Fetching thousands inline would
  //    serialize the import behind Instagram's CDN, and they play no part in change
  //    detection.
  if (includeGraphImages) {
    await storage.updateTaskProgress(taskId, 85, "Queueing profile images...");
    for (const row of graphRows) {
      const id = resolved.get(handleOf(row));
      if (id) await queueSocialProfileImage(id, row.profile_pic_url || row.profilePicUrl, userId, taskId);
    }
  }

  await storage.updateTaskProgress(taskId, 95, "Finalizing import...");
  await storage.markPendingImportAsImported(record.id);

  sseManager.broadcast("social_account.updated", { id: mainAccount.id });
  triggerImageTaskWorker();

  await storage.updateTaskProgress(taskId, 100, "Import completed");

  return JSON.stringify({
    success: true,
    accountUsername: mainUsername,
    scope,
    followersAdded: entry.followersAdded,
    followersLost: entry.followersLost,
    followingAdded: entry.followingAdded,
    followingLost: entry.followingLost,
    profileFieldsChanged: entry.profileFieldsChanged,
    initialCapture: entry.isInitialCapture,
  });
}

/**
 * Import a full Instagram account backup: the whole Meta export zip
 * (instagram-<username>-<date>-<id>.zip) containing every DM thread under
 * your_instagram_activity/messages/inbox/. The root account — whose backup this
 * is — owns every conversation; each thread folder names the counterpart.
 */
export async function processImportInstagramBackup(
  taskId: string,
  payload: {
    userId: number;
    zipPath: string;
    rootSocialAccountId: string;
    rootUsername: string;
    options?: ImportDmOptions;
  }
): Promise<string> {
  const { userId, zipPath, rootSocialAccountId, rootUsername, options = {} } = payload;

  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "prm-ig-dm-"));
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    const threadFolders = findThreadFolders(extractDir);
    if (threadFolders.length === 0) {
      throw new Error("No Instagram message threads (message_1.json) found in the uploaded zip");
    }

    // Skip threads with deactivated/deleted counterparts — Instagram anonymizes
    // these as "instagramuser_<numericId>" and there's no real account to attach
    const importable = threadFolders.filter((f) => !/^instagramuser_\d+$/i.test(path.basename(f)));
    const threadsSkippedAnonymous = threadFolders.length - importable.length;

    const root = { socialAccountId: rootSocialAccountId, username: rootUsername };
    const summaries: ImportThreadSummary[] = [];
    for (let t = 0; t < importable.length; t++) {
      try {
        const summary = await importOneDmThread(
          taskId,
          userId,
          importable[t],
          root,
          options,
          { threadIndex: t, threadCount: importable.length }
        );
        summaries.push(summary);
      } catch (error) {
        if (error instanceof Error && error.message === "cancelled") {
          return JSON.stringify({ cancelled: true, summaries });
        }
        throw error;
      }
    }

    return JSON.stringify({
      success: true,
      threads: summaries.length,
      threadsSkippedAnonymous,
      threadsSkippedUnchanged: summaries.filter((s) => s.skippedUnchanged).length,
      inserted: summaries.reduce((n, s) => n + s.inserted, 0),
      skippedDuplicates: summaries.reduce((n, s) => n + s.skippedDuplicates, 0),
      skippedNoise: summaries.reduce((n, s) => n + s.skippedNoise, 0),
      photosImported: summaries.reduce((n, s) => n + s.photosImported, 0),
      videosImported: summaries.reduce((n, s) => n + s.videosImported, 0),
      audioImported: summaries.reduce((n, s) => n + s.audioImported, 0),
      mediaUnavailable: summaries.reduce((n, s) => n + s.mediaUnavailable, 0),
      summaries,
    });
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
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

  const crowdMode = group.crowdMode || "social_accounts";
  const threshold = typeof group.crowdFollowThreshold === "number" ? group.crowdFollowThreshold : 5;

  await storage.updateTaskProgress(taskId, 20, "Fetching center account followers...");
  const F_center = new Set(await storage.getFollowerIds(group.centerAccountId));

  if (F_center.size === 0) {
    await storage.updateGroup(groupId, { crowdMembers: [], crowdLastCalculatedAt: new Date() });
    return JSON.stringify({
      accountsCheckedCount: 0,
      peopleCheckedCount: 0,
      crowdMembersFound: 0,
      message: "Center account has no followers. Crowd is empty."
    });
  }

  const allSocialAccounts = await db.select().from(socialAccounts);
  const allFollows = await storage.getAllFollows();

  // Map each social account ID to their followed accounts
  const followingMap = new Map<string, Set<string>>();
  for (const edge of allFollows) {
    let followed = followingMap.get(edge.followerId);
    if (!followed) { followed = new Set(); followingMap.set(edge.followerId, followed); }
    followed.add(edge.followedId);
  }

  if (crowdMode === "social_accounts") {
    // Mode: Social Account Only (New Feature)
    await storage.updateTaskProgress(taskId, 35, "Scanning social account followers...");
    const candidateAccounts = allSocialAccounts.filter(sa => sa.id !== group.centerAccountId);
    const totalAccounts = candidateAccounts.length;
    const crowdAccountIds: string[] = [];

    for (let i = 0; i < totalAccounts; i++) {
      const sa = candidateAccounts[i];
      const followed = followingMap.get(sa.id) || new Set<string>();

      let intersectionCount = 0;
      for (const f of F_center) {
        if (followed.has(f)) {
          intersectionCount++;
        }
      }

      if (intersectionCount >= threshold) {
        crowdAccountIds.push(sa.id);
      }

      if (totalAccounts > 10 && i % Math.ceil(totalAccounts / 10) === 0) {
        const progressPercent = 35 + Math.round((i / totalAccounts) * 55);
        await storage.updateTaskProgress(taskId, progressPercent, `Scanning social accounts: processed ${i}/${totalAccounts}...`);
      }
    }

    await storage.updateTaskProgress(taskId, 95, "Updating group crowd list...");
    await storage.updateGroup(groupId, {
      crowdMembers: crowdAccountIds,
      crowdLastCalculatedAt: new Date()
    });

    return JSON.stringify({
      accountsCheckedCount: totalAccounts,
      crowdMembersFound: crowdAccountIds.length,
      threshold,
      mode: "social_accounts",
      message: `Successfully calculated crowd (social accounts, threshold >= ${threshold}): ${crowdAccountIds.length} members found.`
    });
  } else {
    // Mode: Person Profiles (Legacy)
    await storage.updateTaskProgress(taskId, 30, "Retrieving all people and social connections...");
    const allPeople = await storage.getAllPeople();

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

      if (intersectionCount >= threshold) {
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
      threshold,
      mode: "person_profiles",
      message: `Successfully calculated crowd (person profiles, threshold >= ${threshold}): ${crowdPersonIds.length} members found.`
    });
  }
}

// ── Graph Community Detection & Louvain Algorithm ─────────────────────────────

interface GraphEdge {
  u: number;
  v: number;
  weight: number;
}

interface LouvainCommunityResult {
  communities: Map<number, number[]>; // communityId -> nodeIndex[]
  modularity: number;
}

/**
 * High-performance Louvain community detection algorithm with edge weights and resolution tuning.
 * Operates on integer indices [0..V-1] for optimal cache locality and speed on 25k+ nodes.
 */
function runLouvainClustering(
  nodeCount: number,
  edges: GraphEdge[],
  resolution: number = 1.0,
  maxLevels: number = 5
): LouvainCommunityResult {
  if (nodeCount === 0) {
    return { communities: new Map(), modularity: 0 };
  }

  // Calculate total edge weight
  let totalWeight = 0;
  for (const e of edges) {
    totalWeight += e.weight;
  }

  if (totalWeight <= 0) {
    // No edges: each node is its own community
    const comms = new Map<number, number[]>();
    for (let i = 0; i < nodeCount; i++) {
      comms.set(i, [i]);
    }
    return { communities: comms, modularity: 0 };
  }

  const twoM = 2 * totalWeight;

  // Build adjacency list
  const adj: Array<Map<number, number>> = new Array(nodeCount);
  const nodeDegrees = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    adj[i] = new Map();
  }

  for (const { u, v, weight } of edges) {
    if (u === v) continue;
    adj[u].set(v, (adj[u].get(v) || 0) + weight);
    adj[v].set(u, (adj[v].get(u) || 0) + weight);
    nodeDegrees[u] += weight;
    nodeDegrees[v] += weight;
  }

  // Phase 1: Local modularity optimization
  let community = new Int32Array(nodeCount);
  const communityTot = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    community[i] = i;
    communityTot[i] = nodeDegrees[i];
  }

  const nodes = Array.from({ length: nodeCount }, (_, i) => i);
  let changed = true;
  let pass = 0;

  while (changed && pass < 15) {
    changed = false;
    pass++;

    // Randomize node evaluation order to prevent bias
    for (let i = nodes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
    }

    for (const i of nodes) {
      const ki = nodeDegrees[i];
      if (ki === 0) continue;

      const cOld = community[i];
      // Temporarily remove node i from cOld
      communityTot[cOld] -= ki;

      // Find neighbor communities and weights to them
      const commWeights = new Map<number, number>();
      for (const [nbr, w] of adj[i].entries()) {
        const c = community[nbr];
        commWeights.set(c, (commWeights.get(c) || 0) + w);
      }

      let bestComm = cOld;
      let maxGain = 0;

      for (const [c, k_i_in] of commWeights.entries()) {
        // Delta Q gain calculation with resolution parameter gamma
        const gain = k_i_in - resolution * (communityTot[c] * ki) / twoM;
        if (gain > maxGain) {
          maxGain = gain;
          bestComm = c;
        }
      }

      // If cOld still has better or equal modularity, remain or move to bestComm
      community[i] = bestComm;
      communityTot[bestComm] += ki;

      if (bestComm !== cOld) {
        changed = true;
      }
    }
  }

  // Build final community mapping
  const communities = new Map<number, number[]>();
  for (let i = 0; i < nodeCount; i++) {
    const c = community[i];
    if (!communities.has(c)) {
      communities.set(c, []);
    }
    communities.get(c)!.push(i);
  }

  // Calculate final modularity score
  let q = 0;
  for (const [c, members] of communities.entries()) {
    let internalWeight = 0;
    const memberSet = new Set(members);
    for (const u of members) {
      for (const [v, w] of adj[u].entries()) {
        if (memberSet.has(v)) {
          internalWeight += w;
        }
      }
    }
    const tot = communityTot[c];
    q += (internalWeight / twoM) - resolution * Math.pow(tot / twoM, 2);
  }

  return { communities, modularity: q };
}

const STOP_WORDS = new Set([
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with",
  "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her",
  "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up",
  "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time",
  "no", "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could",
  "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
  "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
  "new", "want", "because", "any", "these", "give", "day", "most", "us", "is", "are", "was", "were",
  "com", "www", "http", "https", "link", "email", "official", "account", "page", "dm", "linkinbio"
]);

function extractBioKeywords(text?: string | null): string[] {
  if (!text) return [];
  const tokens = text.toLowerCase().match(/#?[a-zA-Z0-9_-]{3,}/g) || [];
  const valid: string[] = [];
  for (const t of tokens) {
    const clean = t.startsWith("#") ? t.slice(1) : t;
    if (!STOP_WORDS.has(clean) && clean.length >= 3 && !/^\d+$/.test(clean)) {
      valid.push(clean);
    }
  }
  return valid;
}

async function processFindPotentialGroups(taskId: string, payload: {
  entityType: "people" | "social_accounts";
  strategy?: "hybrid" | "co_following" | "network_modularity" | "bio_keywords";
  minGroupSize?: number;
  maxGroupSize?: number;
  resolution?: number;
  minCohesion?: number;
  minDensityMultiplier?: number; // legacy backwards compat
  linkDefinition?: "any" | "mutual" | "family";
}): Promise<string> {
  const { entityType } = payload;
  const strategy = payload.strategy ?? "hybrid";
  const linkDefinition = payload.linkDefinition ?? "any";
  const minGroupSize = Math.max(2, payload.minGroupSize ?? 3);
  const maxGroupSize = payload.maxGroupSize ?? 60;
  const resolution = Math.max(0.2, Math.min(5.0, payload.resolution ?? (payload.minDensityMultiplier ? Math.min(payload.minDensityMultiplier, 2.0) : 1.0)));

  await storage.updateTaskProgress(taskId, 10, "Initializing network dataset...");

  if (entityType === "social_accounts") {
    // ── 1. Load Social Accounts & Profiles ───────────────────────────────────
    await storage.updateTaskProgress(taskId, 20, "Loading social accounts and profiles...");
    const accounts = await db.select({
      id: socialAccounts.id,
      username: socialAccounts.username,
      ownerUuid: socialAccounts.ownerUuid,
      typeId: socialAccounts.typeId,
      groupId: socialAccounts.groupId,
    }).from(socialAccounts);

    const profileVersions = await db.select({
      socialAccountId: socialProfileVersions.socialAccountId,
      nickname: socialProfileVersions.nickname,
      bio: socialProfileVersions.bio,
      imageUrl: socialProfileVersions.imageUrl,
    }).from(socialProfileVersions).where(eq(socialProfileVersions.isCurrent, true));

    const profileMap = new Map<string, { nickname: string | null; bio: string | null; imageUrl: string | null }>();
    for (const p of profileVersions) {
      profileMap.set(p.socialAccountId, {
        nickname: p.nickname,
        bio: p.bio,
        imageUrl: p.imageUrl,
      });
    }

    const nodeIds = accounts.map(a => a.id);
    const nodeCount = nodeIds.length;
    const idToIdx = new Map<string, number>();
    for (let i = 0; i < nodeCount; i++) {
      idToIdx.set(nodeIds[i], i);
    }

    // ── 2. Build Multi-Signal Edge Graph ─────────────────────────────────────
    await storage.updateTaskProgress(taskId, 35, `Building network signals (${strategy})...`);
    
    // Accumulator map for weighted edges: "u-v" -> weight
    const edgeWeights = new Map<string, number>();
    const addWeightedEdge = (uIdx: number, vIdx: number, w: number) => {
      if (uIdx === vIdx) return;
      const minIdx = uIdx < vIdx ? uIdx : vIdx;
      const maxIdx = uIdx < vIdx ? vIdx : uIdx;
      const key = `${minIdx}:${maxIdx}`;
      edgeWeights.set(key, (edgeWeights.get(key) || 0) + w);
    };

    // Signal A: Direct Follows
    if (strategy === "hybrid" || strategy === "network_modularity") {
      const allFollows = await db.select({
        followerId: socialFollows.followerId,
        followedId: socialFollows.followedId,
      }).from(socialFollows);

      const followPairs = new Set<string>();
      for (const f of allFollows) {
        followPairs.add(`${f.followerId}->${f.followedId}`);
      }

      const processedPairs = new Set<string>();
      for (const f of allFollows) {
        const uIdx = idToIdx.get(f.followerId);
        const vIdx = idToIdx.get(f.followedId);
        if (uIdx === undefined || vIdx === undefined) continue;

        const forwardKey = `${f.followerId}->${f.followedId}`;
        const reverseKey = `${f.followedId}->${f.followerId}`;
        const undirectedKey = f.followerId < f.followedId ? `${f.followerId}:${f.followedId}` : `${f.followedId}:${f.followerId}`;

        if (processedPairs.has(undirectedKey)) continue;
        processedPairs.add(undirectedKey);

        const isMutual = followPairs.has(reverseKey);
        if (linkDefinition === "mutual" && !isMutual) continue;

        const weight = isMutual ? 3.5 : 1.0;
        addWeightedEdge(uIdx, vIdx, weight);
      }
    }

    // Signal B: Co-Following / Shared Audience Bipartite Projection
    if (strategy === "hybrid" || strategy === "co_following") {
      await storage.updateTaskProgress(taskId, 50, "Analyzing co-following & shared audience overlap...");
      const allFollows = await db.select({
        followerId: socialFollows.followerId,
        followedId: socialFollows.followedId,
      }).from(socialFollows);

      const followedToFollowers = new Map<string, number[]>();
      const followerDegree = new Map<number, number>();

      for (const f of allFollows) {
        const uIdx = idToIdx.get(f.followerId);
        if (uIdx === undefined) continue;

        followerDegree.set(uIdx, (followerDegree.get(uIdx) || 0) + 1);
        if (!followedToFollowers.has(f.followedId)) {
          followedToFollowers.set(f.followedId, []);
        }
        followedToFollowers.get(f.followedId)!.push(uIdx);
      }

      // Count shared following co-occurrences
      const coFollowCounts = new Map<string, number>();
      for (const followers of followedToFollowers.values()) {
        // Filter out extreme hub accounts with > 800 followers to prevent combinatorial noise
        if (followers.length < 2 || followers.length > 800) continue;

        for (let i = 0; i < followers.length; i++) {
          for (let j = i + 1; j < followers.length; j++) {
            const u = followers[i];
            const v = followers[j];
            const key = u < v ? `${u}:${v}` : `${v}:${u}`;
            coFollowCounts.set(key, (coFollowCounts.get(key) || 0) + 1);
          }
        }
      }

      const minOverlap = strategy === "co_following" ? 2 : 2;
      for (const [key, count] of coFollowCounts.entries()) {
        if (count >= minOverlap) {
          const [uStr, vStr] = key.split(":");
          const uIdx = parseInt(uStr, 10);
          const vIdx = parseInt(vStr, 10);
          const degU = followerDegree.get(uIdx) || 1;
          const degV = followerDegree.get(vIdx) || 1;
          // Cosine / Jaccard similarity weighting
          const sim = count / Math.sqrt(degU * degV);
          const weight = Math.min(4.0, sim * 5.0 + (count >= 4 ? 1.0 : 0));
          addWeightedEdge(uIdx, vIdx, weight);
        }
      }
    }

    // Signal C: Co-Mentions in Posts
    if (strategy === "hybrid") {
      try {
        const posts = await db.select({
          mentionedAccounts: socialAccountPosts.mentionedAccounts,
        }).from(socialAccountPosts);

        for (const p of posts) {
          if (!p.mentionedAccounts) continue;
          try {
            const parsed = JSON.parse(p.mentionedAccounts);
            if (Array.isArray(parsed)) {
              const usernames = new Set<string>();
              for (const entry of parsed) {
                if (Array.isArray(entry.accounts)) {
                  for (const un of entry.accounts) usernames.add(un.toLowerCase());
                }
              }
              const mentionedUIdxs: number[] = [];
              for (const acc of accounts) {
                if (usernames.has(acc.username.toLowerCase())) {
                  const idx = idToIdx.get(acc.id);
                  if (idx !== undefined) mentionedUIdxs.push(idx);
                }
              }
              for (let i = 0; i < mentionedUIdxs.length; i++) {
                for (let j = i + 1; j < mentionedUIdxs.length; j++) {
                  addWeightedEdge(mentionedUIdxs[i], mentionedUIdxs[j], 2.5);
                }
              }
            }
          } catch {}
        }
      } catch (err) {
        log(`[TaskWorker] Co-mention parsing skipped: ${err}`);
      }
    }

    // Signal D: Bio Keyword Semantic Overlap
    const accountKeywords = new Map<number, string[]>();
    const globalTokenCounts = new Map<string, number>();
    for (let i = 0; i < nodeCount; i++) {
      const p = profileMap.get(nodeIds[i]);
      const kws = extractBioKeywords(p?.bio);
      if (kws.length > 0) {
        accountKeywords.set(i, kws);
        for (const kw of new Set(kws)) {
          globalTokenCounts.set(kw, (globalTokenCounts.get(kw) || 0) + 1);
        }
      }
    }

    if (strategy === "hybrid" || strategy === "bio_keywords") {
      await storage.updateTaskProgress(taskId, 65, "Extracting semantic bio themes...");
      const tokenToAccounts = new Map<string, number[]>();
      for (const [idx, kws] of accountKeywords.entries()) {
        for (const kw of new Set(kws)) {
          if (!tokenToAccounts.has(kw)) tokenToAccounts.set(kw, []);
          tokenToAccounts.get(kw)!.push(idx);
        }
      }

      const bioOverlapCounts = new Map<string, number>();
      for (const [kw, accList] of tokenToAccounts.entries()) {
        if (accList.length >= 2 && accList.length <= 150) {
          const idf = Math.log(nodeCount / (1 + accList.length));
          for (let i = 0; i < accList.length; i++) {
            for (let j = i + 1; j < accList.length; j++) {
              const u = accList[i];
              const v = accList[j];
              const key = u < v ? `${u}:${v}` : `${v}:${u}`;
              bioOverlapCounts.set(key, (bioOverlapCounts.get(key) || 0) + idf * 0.5);
            }
          }
        }
      }

      for (const [key, score] of bioOverlapCounts.entries()) {
        if (score >= 0.8) {
          const [uStr, vStr] = key.split(":");
          const uIdx = parseInt(uStr, 10);
          const vIdx = parseInt(vStr, 10);
          const weight = Math.min(strategy === "bio_keywords" ? 3.0 : 1.5, score);
          addWeightedEdge(uIdx, vIdx, weight);
        }
      }
    }

    // ── 3. Run Louvain Community Detection ──────────────────────────────────
    await storage.updateTaskProgress(taskId, 75, "Running Louvain modularity clustering...");
    const graphEdges: GraphEdge[] = [];
    for (const [key, weight] of edgeWeights.entries()) {
      const [uStr, vStr] = key.split(":");
      graphEdges.push({
        u: parseInt(uStr, 10),
        v: parseInt(vStr, 10),
        weight,
      });
    }

    const { communities, modularity } = runLouvainClustering(nodeCount, graphEdges, resolution);

    // ── 4. Process, Filter & Enrich Results ──────────────────────────────────
    await storage.updateTaskProgress(taskId, 88, "Evaluating cluster quality and generating previews...");
    const results: any[] = [];
    const internalDegreeMap = new Map<number, number>();
    for (const edge of graphEdges) {
      internalDegreeMap.set(edge.u, (internalDegreeMap.get(edge.u) || 0) + edge.weight);
      internalDegreeMap.set(edge.v, (internalDegreeMap.get(edge.v) || 0) + edge.weight);
    }

    for (const [commId, memberIdxs] of communities.entries()) {
      const cSize = memberIdxs.length;
      if (cSize < minGroupSize || cSize > maxGroupSize) continue;

      const memberSet = new Set(memberIdxs);
      let internalWeight = 0;
      let totalIncidentWeight = 0;
      let internalEdgesCount = 0;

      for (const edge of graphEdges) {
        const uIn = memberSet.has(edge.u);
        const vIn = memberSet.has(edge.v);
        if (uIn && vIn) {
          internalWeight += edge.weight;
          internalEdgesCount++;
        }
        if (uIn || vIn) {
          totalIncidentWeight += edge.weight;
        }
      }

      if (internalEdgesCount === 0 && cSize > 2) continue;

      // Cohesion score: percentage of internal vs incident connection strength
      const cohesionScore = totalIncidentWeight > 0 ? Math.min(100, Math.round((internalWeight / totalIncidentWeight) * 100)) : 50;

      // Find top hub nodes in community by internal degree
      const sortedMemberIdxs = [...memberIdxs].sort((a, b) => (internalDegreeMap.get(b) || 0) - (internalDegreeMap.get(a) || 0));
      const topHubs = sortedMemberIdxs.slice(0, 2).map(idx => accounts[idx]);

      // Extract top distinctive keywords for community
      const commTokenCounts = new Map<string, number>();
      for (const idx of memberIdxs) {
        const kws = accountKeywords.get(idx) || [];
        for (const kw of new Set(kws)) {
          commTokenCounts.set(kw, (commTokenCounts.get(kw) || 0) + 1);
        }
      }

      const rankedKeywords: string[] = [];
      for (const [kw, count] of commTokenCounts.entries()) {
        if (count >= 2) {
          const gCount = globalTokenCounts.get(kw) || 1;
          const tfIdf = (count / cSize) * Math.log((nodeCount + 1) / (gCount + 1));
          rankedKeywords.push(kw);
        }
      }
      rankedKeywords.sort((a, b) => (commTokenCounts.get(b) || 0) - (commTokenCounts.get(a) || 0));
      const topKeywords = rankedKeywords.slice(0, 4);

      // Generate descriptive thematic name
      let suggestedName = "";
      const hubNames = topHubs.map(h => `@${h.username}`).join(" & ");

      if (topKeywords.length >= 2) {
        const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
        suggestedName = `${cap(topKeywords[0])} & ${cap(topKeywords[1])} Circle (${hubNames})`;
      } else if (topKeywords.length === 1) {
        const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
        suggestedName = `${cap(topKeywords[0])} Network (${hubNames})`;
      } else {
        suggestedName = `Circle around ${hubNames}`;
      }

      // Member previews (all members for frontend rendering without loading 25k records)
      const memberPreviews = sortedMemberIdxs.map(idx => {
        const acc = accounts[idx];
        const prof = profileMap.get(acc.id);
        return {
          id: acc.id,
          username: acc.username,
          nickname: prof?.nickname || null,
          imageUrl: prof?.imageUrl || null,
          bioSummary: prof?.bio ? prof.bio.slice(0, 90) : null,
        };
      });

      const memberIds = memberIdxs.map(idx => accounts[idx].id);

      results.push({
        id: `pg-${commId}-${Date.now()}`,
        suggestedName,
        memberIds,
        memberCount: memberIds.length,
        memberPreviews,
        topKeywords,
        cohesionScore,
        density: cSize > 1 ? (2 * internalEdgesCount) / (cSize * (cSize - 1)) : 1.0,
        densityRatio: cohesionScore / 20.0,
        internalEdgesCount,
      });
    }

    // Sort results by cohesion score and size
    results.sort((a, b) => b.cohesionScore - a.cohesionScore || b.memberCount - a.memberCount);

    await storage.updateTaskProgress(taskId, 100, `Found ${results.length} potential groups across ${nodeCount} accounts.`);
    return JSON.stringify(results);

  } else {
    // ── PEOPLE NETWORK CLUSTERING ─────────────────────────────────────────────
    await storage.updateTaskProgress(taskId, 20, "Loading people and relationship graph...");
    const allPeople = await storage.getAllPeople();
    const nodeIds = allPeople.map(p => p.id);
    const nodeCount = nodeIds.length;
    const idToIdx = new Map<string, number>();
    for (let i = 0; i < nodeCount; i++) {
      idToIdx.set(nodeIds[i], i);
    }

    const edgeWeights = new Map<string, number>();
    const addWeightedEdge = (uIdx: number, vIdx: number, w: number) => {
      if (uIdx === vIdx) return;
      const minIdx = uIdx < vIdx ? uIdx : vIdx;
      const maxIdx = uIdx < vIdx ? vIdx : uIdx;
      const key = `${minIdx}:${maxIdx}`;
      edgeWeights.set(key, (edgeWeights.get(key) || 0) + w);
    };

    if (linkDefinition === "family") {
      const allLin = await db.select().from(lineage);
      for (const l of allLin) {
        const u = idToIdx.get(l.childId);
        const v = idToIdx.get(l.parentId);
        if (u !== undefined && v !== undefined) addWeightedEdge(u, v, 4.0);
      }
      const allParts = await db.select().from(partnerships);
      for (const p of allParts) {
        const u = idToIdx.get(p.person1Id);
        const v = idToIdx.get(p.person2Id);
        if (u !== undefined && v !== undefined) addWeightedEdge(u, v, 5.0);
      }
      const allRels = await storage.getAllRelationships();
      for (const r of allRels) {
        if (r.familyRelationshipType) {
          const u = idToIdx.get(r.fromPersonId);
          const v = idToIdx.get(r.toPersonId);
          if (u !== undefined && v !== undefined) addWeightedEdge(u, v, 3.0);
        }
      }
    } else {
      const allRels = await storage.getAllRelationships();
      for (const r of allRels) {
        const u = idToIdx.get(r.fromPersonId);
        const v = idToIdx.get(r.toPersonId);
        if (u !== undefined && v !== undefined) addWeightedEdge(u, v, 2.0);
      }
      const allParts = await db.select().from(partnerships);
      for (const p of allParts) {
        const u = idToIdx.get(p.person1Id);
        const v = idToIdx.get(p.person2Id);
        if (u !== undefined && v !== undefined) addWeightedEdge(u, v, 4.0);
      }
      const allLin = await db.select().from(lineage);
      for (const l of allLin) {
        const u = idToIdx.get(l.childId);
        const v = idToIdx.get(l.parentId);
        if (u !== undefined && v !== undefined) addWeightedEdge(u, v, 3.5);
      }
    }

    const graphEdges: GraphEdge[] = [];
    for (const [key, weight] of edgeWeights.entries()) {
      const [uStr, vStr] = key.split(":");
      graphEdges.push({
        u: parseInt(uStr, 10),
        v: parseInt(vStr, 10),
        weight,
      });
    }

    await storage.updateTaskProgress(taskId, 60, "Clustering people connections...");
    const { communities } = runLouvainClustering(nodeCount, graphEdges, resolution);

    await storage.updateTaskProgress(taskId, 85, "Formatting community results...");
    const results: any[] = [];
    const personMap = new Map(allPeople.map(p => [p.id, p]));

    for (const [commId, memberIdxs] of communities.entries()) {
      const cSize = memberIdxs.length;
      if (cSize < minGroupSize || cSize > maxGroupSize) continue;

      const memberIds = memberIdxs.map(idx => nodeIds[idx]);
      const memberPeople = memberIds.map(id => personMap.get(id)).filter(Boolean) as any[];

      const topPeople = memberPeople.slice(0, 2);
      const names = topPeople.map(p => `${p.firstName || ""} ${p.lastName || ""}`.trim() || "Person").join(" & ");
      const suggestedName = `Family & Friends Circle (${names})`;

      const memberPreviews = memberPeople.slice(0, 20).map(p => ({
        id: p.id,
        username: `${p.firstName || ""} ${p.lastName || ""}`.trim(),
        nickname: p.nickname || null,
        imageUrl: p.imageUrl || null,
        bioSummary: p.company ? `${p.title || "Role"} at ${p.company}` : null,
      }));

      results.push({
        id: `pg-person-${commId}-${Date.now()}`,
        suggestedName,
        memberIds,
        memberCount: memberIds.length,
        memberPreviews,
        topKeywords: [],
        cohesionScore: 80,
        density: 1.0,
        densityRatio: 2.0,
        internalEdgesCount: memberIdxs.length,
      });
    }

    results.sort((a, b) => b.memberCount - a.memberCount);
    await storage.updateTaskProgress(taskId, 100, `Found ${results.length} communities.`);
    return JSON.stringify(results);
  }
}

async function processNextTask(): Promise<boolean> {
  const task = await runAsSystem(() => storage.getNextPendingTask());
  if (!task) return false;

  log(`[TaskWorker] Processing task ${task.id} (type: ${task.type})`);
  await runAsSystem(() => storage.updateTaskStatus(task.id, "in_progress"));

  let taskUserId = task.userId;
  if (!taskUserId) {
    try {
      const p = JSON.parse(task.payload);
      taskUserId = p.userId;
    } catch {}
  }
  if (!taskUserId) {
    taskUserId = (await runAsSystem(() => storage.getAllUsers()))[0]?.id;
  }

  return runAsUser(taskUserId, async () => {
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
        case "import_social": {
          const payload = JSON.parse(task.payload);
          result = await processImportSocial(task.id, payload);
          break;
        }
        case "import_instagram": {
          const payload = JSON.parse(task.payload);
          result = await processImportInstagram(task.id, payload);
          break;
        }
        case "import_instagram_backup": {
          const payload = JSON.parse(task.payload);
          result = await processImportInstagramBackup(task.id, payload);
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
  });
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

async function recoverStaleTasksOnStartup(): Promise<void> {
  try {
    await db.update(tasks)
      .set({ status: "failed", result: "Interrupted by server restart" })
      .where(eq(tasks.status, "in_progress"));
    await db.update(imageTasks)
      .set({ status: "failed", result: "Interrupted by server restart" })
      .where(eq(imageTasks.status, "in_progress"));
  } catch (err) {
    log(`[TaskWorker] Stale task recovery error: ${err}`);
  }
}

export function startTaskWorker() {
  log("[TaskWorker] Starting background task worker");
  void recoverStaleTasksOnStartup().finally(() => {
    runWorkerLoop();
    runImageTaskWorkerLoop();
  });
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
