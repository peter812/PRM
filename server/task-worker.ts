import { storage } from "./storage";
import { pruneAutoBackups } from "./backup-scheduler";
import { db, pool } from "./db";
import { legacyHqImageUrls, legacyProfileImagesPending } from "./db-init";
import { syncEntityInBackground } from "./vector-universal";
import { uploadImage, uploadMedia, listPrmS3ObjectKeys, copyPrmS3ObjectInPlace, isPrmS3VariantBaked, deleteImageFromPrmS3, getPrmS3Client, getPrmS3BackupStatus, cancelPrmS3Backup } from "./prm-s3";
import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import AdmZip from "adm-zip";
import { loadThreadFolder, type ParsedThread, type ParsedMessage, type ParsedMedia } from "./instagram-dm-import";
import { parseSmsBackup } from "./sms-import";
import { classifyMessage, type AutomatedCategory } from "./message-classifier";
import { log } from "./vite";
import { queueOsintScansForMeAccount } from "./osint-scan-queue";
import { runAutomaticImagePassIn, autoPassInImageForSocialAccount } from "./image-pass-in-utils";
import {
  INSTAGRAM_USER_AGENT,
  getImageDimensions,
  fetchProfileImage,
  classifyProfileImage,
  applyProfileImageVerdict,
  getCurrentProfileImageUrls,
  type ProfileImageOutcome,
} from "./profile-image";
import {
  applySnapshot,
  recordProfileImageChange,
  capturesFollowers,
  capturesFollowing,
  type CaptureScope,
} from "./social-account-history";
import { followRename, instagramPkOf } from "./instagram-identity";
import type { SocialAccount } from "@shared/schema";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { eq, and, or, ne, isNotNull, inArray, like } from "drizzle-orm";
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
  users,
  ssoConfig,
  people,
  tasks,
  imageTasks,
  relationshipTypes,
  relationships,
  interactionTypes,
  interactions,
  groups,
  subGroups,
  notes,
  groupNotes,
  schooling,
  socialAccountTypes,
  socialAccounts,
  socialFollows,
  socialAccountHistory,
  socialProfileVersions,
  historicalAccountSummaries,
  socialNetworkChanges,
  socialAccountPosts,
  socialPostComments,
  lineage,
  partnerships,
  photos,
  faces,
  facePairDismissals,
  imageQuestions,
  dailyNotes,
  dailyNoteEvents,
  dailyNoteInvolvedParties,
  dailyNoteAuditLogs,
  sexGuessQueue,
  aiProviders,
  aiChats,
  appSettings,
  truePersonSearch,
  pendingSocialAccountImports,
  insights,
  osintScans,
  storyImporters,
  storyScrapeRuns,
  trackingJobs,
  socialAccountIssues,
  conversations,
  messages,
  messageRecipients,
  conversationParticipants,
  geocodes,
  personAddresses,
  type SocialAccountHistoryDelta,
  type ImageTask,
  type InsertImageTask,
  type InsertMessage,
  type AiBackendNote,
  cleanPhoneNumberForStorage,
  formatPhoneNumberForDisplay,
} from "@shared/schema";
import {
  escapeXml,
  arrayToXml,
  parseXmlTag,
  parseXmlArray,
  unescapeXml,
  extractSection,
  sectionEntries,
  xmlTag,
  xmlJsonTag,
  parseOptStr,
  parseOptInt,
  parseOptFloat,
  parseOptBool,
  parseOptDate,
  parseOptJson,
} from "./xml-utils";
import { runFaceRecognition, rescanPhotoFaces, resyncFaceIndex, runOcr, transcribeVideo, ComputeUnreachableError, ComputeBusyError, RECOGNITION_TASK_TYPES, JOB_TASK_TYPE, getComputeLanes, COMPUTE_LANE_DEFAULTS, enqueueAutoRecognition } from "./recognition";

const POLL_INTERVAL_MS = 60_000;
const IMAGE_DOWNLOAD_DELAY_MS = 1_000;
const REFRESH_DELAY_MS = 200;

let isProcessing = false;
let isPaused = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// ── Image task worker state ───────────────────────────────────────────────────
// Tasks run in lanes: one per PRM-Compute engine plus "other" (downloads and
// stubs, one at a time with a pause between to keep Instagram gentle). Each
// recognition lane runs up to its limit side by side, bounded overall by the
// total cap — the same limits PRM-Compute enforces (Settings → Recognition).
type ImageLane = "face" | "ocr" | "stt" | "other";
const IMAGE_LANES: ImageLane[] = ["face", "ocr", "stt", "other"];
const LANE_TASK_TYPE = { face: JOB_TASK_TYPE.face, ocr: JOB_TASK_TYPE.ocr, stt: JOB_TASK_TYPE.transcribe };
const laneOf = (type: string) => (IMAGE_LANES.find((l) => l !== "other" && LANE_TASK_TYPE[l] === type) ?? "other");
let laneLimits = { ...COMPUTE_LANE_DEFAULTS };
const inFlight: Record<ImageLane, number> = { face: 0, ocr: 0, stt: 0, other: 0 };
const lanePausedUntil: Record<ImageLane, number> = { face: 0, ocr: 0, stt: 0, other: 0 };
let isDispatching = false;
let redispatch = false;
let imageTaskPollTimer: ReturnType<typeof setTimeout> | null = null;
// While PRM-Compute is unreachable, recognition tasks stay pending and are
// skipped until this passes; downloads and the rest keep flowing.
const COMPUTE_BACKOFF_MS = 30_000;
let recognitionPausedUntil = 0;
// Compute answered busy: only that lane waits, briefly.
const COMPUTE_BUSY_BACKOFF_MS = 5_000;

// ── Image task handlers ───────────────────────────────────────────────────────

async function processDownloadImgInstagram(imageTaskId: string, payload: {
  socialAccountId: string;
  imageUrl: string;
}): Promise<string> {
  const { socialAccountId, imageUrl } = payload;

  const fetched = await fetchProfileImage(imageUrl);

  const current = await getCurrentProfileImageUrls(socialAccountId);
  const verdict = await classifyProfileImage(current, fetched);
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

  const outcome = await applyProfileImageVerdict(
    socialAccountId,
    current,
    fetched,
    verdict,
    undefined,
    freshTask.imageTaskGroupId || undefined,
  );

  // Re-check cancellation again after upload before persisting changes
  const postUploadTask = await storage.getImageTaskById(imageTaskId);
  if (!postUploadTask || postUploadTask.status === "cancelled") {
    log(`[ImageWorker] Task ${imageTaskId} cancelled after upload — skipping DB writes`);
    return JSON.stringify({ skipped: true, reason: "cancelled_post_upload", socialAccountId });
  }

  await recordProfileImageChange(socialAccountId, outcome);

  // Link the photo to this image task
  await db.update(imageTasks).set({ photoId: outcome.photoId }).where(eq(imageTasks.id, imageTaskId));

  // Automatically pass in the image to any linked person who doesn't have an image
  await autoPassInImageForSocialAccount(socialAccountId);

  return JSON.stringify({
    cdnUrl: outcome.imageUrl,
    socialAccountId,
    photoId: outcome.photoId,
    imageChange: outcome.imageChange,
    widthPx: fetched.dims?.width ?? null,
  });
}

async function processAnalyzeImgFull(imageTaskId: string, payload: { photoId?: string }): Promise<string> {
  log(`[ImageWorker] analyze_img_full stub — photoId: ${payload.photoId ?? "none"}`);
  return JSON.stringify({ stub: true, note: "Face detection, metadata extraction, and LLM analysis not yet implemented" });
}

async function processAnalyzeImgFace(imageTaskId: string, payload: { photoId?: string; rescan?: boolean }): Promise<string> {
  if (!payload.photoId) throw new Error("photoId is required");
  const { facesDetected } = await (payload.rescan ? rescanPhotoFaces : runFaceRecognition)(payload.photoId);
  return JSON.stringify({ photoId: payload.photoId, facesDetected });
}

async function processAnalyzeImgOcr(imageTaskId: string, payload: { photoId?: string }): Promise<string> {
  if (!payload.photoId) throw new Error("photoId is required");
  const result = await runOcr(payload.photoId);
  const text: string = result?.text ?? "";
  return JSON.stringify({ photoId: payload.photoId, lines: result?.lines?.length ?? 0, chars: text.length });
}

async function processTranscribeVideo(imageTaskId: string, payload: { postId?: string }): Promise<string> {
  if (!payload.postId) throw new Error("postId is required");
  const transcript = await transcribeVideo(payload.postId);
  return JSON.stringify({ postId: payload.postId, chars: transcript.text.length, language: transcript.language, segments: transcript.segments.length });
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

async function processImageTask(task: ImageTask): Promise<void> {
  log(`[ImageWorker] Processing image task ${task.id} (type: ${task.type})`);
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
      case "analyze_img_ocr":
        result = await processAnalyzeImgOcr(task.id, payload);
        break;
      case "transcribe_video":
        result = await processTranscribeVideo(task.id, payload);
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Only write failed state if not already cancelled
    const postErrorTask = await storage.getImageTaskById(task.id).catch(() => null);
    if (postErrorTask && postErrorTask.status === "cancelled") return;
    if (error instanceof ComputeUnreachableError) {
      // Not the task's fault: hand it back to the queue and try again later.
      recognitionPausedUntil = Date.now() + COMPUTE_BACKOFF_MS;
      log(`[ImageWorker] ${errorMessage} — recognition tasks paused for ${COMPUTE_BACKOFF_MS / 1000}s`);
      await storage.updateImageTaskStatus(task.id, "pending");
      setTimeout(dispatchImageTasks, COMPUTE_BACKOFF_MS);
      return;
    }
    if (error instanceof ComputeBusyError) {
      const lane = laneOf(task.type);
      lanePausedUntil[lane] = Date.now() + COMPUTE_BUSY_BACKOFF_MS;
      log(`[ImageWorker] ${errorMessage} — ${lane} lane retries in ${COMPUTE_BUSY_BACKOFF_MS / 1000}s`);
      await storage.updateImageTaskStatus(task.id, "pending");
      setTimeout(dispatchImageTasks, COMPUTE_BUSY_BACKOFF_MS);
      return;
    }
    log(`[ImageWorker] Image task ${task.id} failed: ${errorMessage}`);
    await storage.updateImageTaskStatus(task.id, "failed", errorMessage);
  }
}

function laneHasRoom(lane: ImageLane): boolean {
  if (Date.now() < lanePausedUntil[lane]) return false;
  if (lane === "other") return inFlight.other < 1;
  if (Date.now() < recognitionPausedUntil) return false;
  return inFlight[lane] < laneLimits[lane] && inFlight.face + inFlight.ocr + inFlight.stt < laneLimits.total;
}

function claimForLane(lane: ImageLane): Promise<ImageTask | undefined> {
  const filter = lane === "other" ? { excludeTypes: RECOGNITION_TASK_TYPES } : { types: [LANE_TASK_TYPE[lane]] };
  return storage.claimNextImageTask(filter);
}

let nextLaneIndex = 0;

/** Fill every lane that has room; re-runs whenever a task finishes. */
async function dispatchImageTasks() {
  if (isPaused) return;
  if (isDispatching) {
    redispatch = true;
    return;
  }
  isDispatching = true;
  try {
    do {
      redispatch = false;
      let claimedAny = false;
      do {
        claimedAny = false;
        for (let i = 0; i < IMAGE_LANES.length; i++) {
          if (isPaused) break;
          const lane = IMAGE_LANES[(nextLaneIndex + i) % IMAGE_LANES.length];
          if (laneHasRoom(lane)) {
            const task = await claimForLane(lane);
            if (task) {
              claimedAny = true;
              inFlight[lane]++;
              void processImageTask(task)
                .catch((error) => log(`[ImageWorker] Task ${task.id} error: ${error instanceof Error ? error.message : String(error)}`))
                .finally(() => {
                  // "other" holds its slot a moment longer so downloads stay spaced out.
                  setTimeout(() => {
                    inFlight[lane]--;
                    dispatchImageTasks();
                  }, lane === "other" ? IMAGE_DOWNLOAD_DELAY_MS : 0);
                });
            }
          }
        }
        nextLaneIndex = (nextLaneIndex + 1) % IMAGE_LANES.length;
      } while (claimedAny && !isPaused && IMAGE_LANES.some((l) => laneHasRoom(l)));
    } while (redispatch && !isPaused);
  } catch (error) {
    log(`[ImageWorker] Dispatch error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isDispatching = false;
    if (!isPaused) scheduleImagePoll();
  }
}

function scheduleImagePoll() {
  if (imageTaskPollTimer) clearTimeout(imageTaskPollTimer);
  imageTaskPollTimer = setTimeout(dispatchImageTasks, POLL_INTERVAL_MS);
}

export function triggerImageTaskWorker() {
  dispatchImageTasks();
}

/** Re-read the lane limits (after Settings → Recognition saves them) and fill any new room. */
export async function refreshImageLanes() {
  laneLimits = await getComputeLanes();
  log(`[ImageWorker] Lanes: face ${laneLimits.face} · ocr ${laneLimits.ocr} · stt ${laneLimits.stt} · total ${laneLimits.total}`);
  dispatchImageTasks();
  return laneLimits;
}

/** Legacy task type; nothing creates these any more. Same pipeline as the image worker. */
async function processGetImgTask(payload: {
  socialAccountId: string;
  imageUrl: string;
}): Promise<string> {
  const { socialAccountId, imageUrl } = payload;
  const fetched = await fetchProfileImage(imageUrl);
  const current = await getCurrentProfileImageUrls(socialAccountId);
  const verdict = await classifyProfileImage(current, fetched);
  if (!verdict.replace) {
    return JSON.stringify({ skipped: true, reason: verdict.reason, socialAccountId });
  }
  const outcome = await applyProfileImageVerdict(socialAccountId, current, fetched, verdict);
  await recordProfileImageChange(socialAccountId, outcome);
  return JSON.stringify({ cdnUrl: outcome.imageUrl, socialAccountId, imageChange: outcome.imageChange });
}

// ── Export & Import XML Engine ───────────────────────────────────────────────

async function insertBatchWithFallback<T extends Record<string, any>>(
  table: any,
  rows: T[],
  label: string,
  chunkSize = 500
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    try {
      await db.insert(table).values(chunk).onConflictDoNothing();
      inserted += chunk.length;
    } catch (err) {
      console.error(`Batch insert failed for ${label} (chunk ${i}..${i + chunk.length}), falling back to row-by-row:`, err);
      for (const row of chunk) {
        try {
          await db.insert(table).values(row).onConflictDoNothing();
          inserted++;
        } catch (rowErr) {
          console.error(`Error importing ${label} row:`, rowErr);
        }
      }
    }
  }
  return inserted;
}

/**
 * Buffers export XML and flushes it to a file descriptor every few MB. A full export
 * is larger than V8's maximum string length (~512 MB), so it is never joined in memory.
 */
class XmlFileWriter {
  private parts: string[] = [];
  private size = 0;
  constructor(private fd: number) {}

  push(s: string) {
    this.parts.push(s);
    this.size += s.length;
    if (this.size >= 8 * 1024 * 1024) this.flush();
  }

  flush() {
    if (this.parts.length === 0) return;
    fs.writeSync(this.fd, this.parts.join(""));
    this.parts = [];
    this.size = 0;
  }
}

async function generateExportXml(chunks: XmlFileWriter, options: {
  includeHistory?: boolean;
  includePostHistory?: boolean;
  onProgress?: (progress: number, message: string) => Promise<void> | void;
}): Promise<void> {
  const includeHistory = options.includeHistory ?? false;
  const includePostHistory = options.includePostHistory ?? true;
  const onProgress = options.onProgress;
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

  await onProgress?.(2, "Fetching core data…");

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

  const [allGroupNotes, allSocialAccounts, allSocialAccountTypes, allFollows, mePersonId] = await Promise.all([
    storage.getAllGroupNotes(),
    storage.getAllSocialAccounts(),
    storage.getAllSocialAccountTypes(),
    storage.getAllFollows(),
    storage.getMePersonId(),
  ]);

  const [
    allSsoConfigs,
    allLineages,
    allPartnerships,
    allPhotos,
    allDailyNotes,
    allDailyNoteEvents,
    allDailyNoteInvolvedParties,
    allDailyNoteAuditLogs,
    allSexGuesses,
    allAiProviders,
    allAiChats,
    allAppSettings,
  ] = await Promise.all([
    db.select().from(ssoConfig),
    db.select().from(lineage),
    db.select().from(partnerships),
    db.select().from(photos),
    db.select().from(dailyNotes),
    db.select().from(dailyNoteEvents),
    db.select().from(dailyNoteInvolvedParties),
    db.select().from(dailyNoteAuditLogs),
    db.select().from(sexGuessQueue),
    db.select().from(aiProviders),
    db.select().from(aiChats),
    db.select().from(appSettings),
  ]);

  const [
    allSchooling,
    allSubGroups,
    allTps,
    allFaces,
    allFacePairDismissals,
    allImageQuestions,
    allPendingImports,
    allInsights,
    allOsintScans,
  ] = await Promise.all([
    db.select().from(schooling),
    db.select().from(subGroups),
    db.select().from(truePersonSearch),
    db.select().from(faces),
    db.select().from(facePairDismissals),
    db.select().from(imageQuestions),
    db.select().from(pendingSocialAccountImports),
    db.select().from(insights),
    db.select().from(osintScans),
  ]);

  const [
    allStoryImporters,
    allStoryScrapeRuns,
    allTrackingJobs,
    allSocialAccountIssues,
    allConversations,
    allMessages,
    allMessageRecipients,
    allConversationParticipants,
    allGeocodes,
    allPersonAddresses,
  ] = await Promise.all([
    db.select().from(storyImporters),
    db.select().from(storyScrapeRuns),
    db.select().from(trackingJobs),
    db.select().from(socialAccountIssues),
    db.select().from(conversations),
    db.select().from(messages),
    db.select().from(messageRecipients),
    db.select().from(conversationParticipants),
    db.select().from(geocodes),
    db.select().from(personAddresses),
  ]);

  const user = allUsers[0];
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

  const mapPersonExport = (id: string | null | undefined): string => {
    if (!id) return "";
    return mePersonId && id === mePersonId ? ZERO_UUID : id;
  };

  const mapPrmLocationExport = (loc: string | null): string => {
    if (!loc) return "";
    if (mePersonId && loc.includes(mePersonId)) {
      return loc.replace(mePersonId, ZERO_UUID);
    }
    return loc;
  };

  await onProgress?.(8, "Building export file…");

  chunks.push('<?xml version="1.0" encoding="UTF-8"?>\n<crm_data>\n');

  // ── User profile ──
  chunks.push("  <user_profile>\n");
  chunks.push(`    ${xmlTag("name", user?.name || "")}\n`);
  chunks.push(`    ${xmlTag("nickname", user?.nickname || "")}\n`);
  chunks.push(`    ${xmlTag("username", user?.username || "")}\n`);
  chunks.push(`    ${xmlTag("sso_email", user?.ssoEmail || "")}\n`);
  chunks.push(`    ${xmlTag("created_at", user?.createdAt)}\n`);
  chunks.push("  </user_profile>\n");

  // ── SSO Config ──
  chunks.push("  <sso_config>\n");
  for (const cfg of allSsoConfigs) {
    chunks.push("    <sso_config_entry>\n");
    chunks.push(`      ${xmlTag("id", cfg.id)}\n`);
    chunks.push(`      ${xmlTag("user_id", cfg.userId)}\n`);
    chunks.push(`      ${xmlTag("enabled", cfg.enabled)}\n`);
    chunks.push(`      ${xmlTag("auto_sso", cfg.autoSso)}\n`);
    chunks.push(`      ${xmlTag("client_id", cfg.clientId || "")}\n`);
    chunks.push(`      ${xmlTag("client_secret", cfg.clientSecret || "")}\n`);
    chunks.push(`      ${xmlTag("auth_url", cfg.authUrl || "")}\n`);
    chunks.push(`      ${xmlTag("token_url", cfg.tokenUrl || "")}\n`);
    chunks.push(`      ${xmlTag("user_info_url", cfg.userInfoUrl || "")}\n`);
    chunks.push(`      ${xmlTag("redirect_url", cfg.redirectUrl || "")}\n`);
    chunks.push(`      ${xmlTag("logout_url", cfg.logoutUrl || "")}\n`);
    chunks.push(`      ${xmlTag("user_identifier", cfg.userIdentifier || "")}\n`);
    chunks.push(`      ${xmlTag("scopes", cfg.scopes || "")}\n`);
    chunks.push(`      ${xmlTag("auth_style", cfg.authStyle || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", cfg.createdAt)}\n`);
    chunks.push(`      ${xmlTag("updated_at", cfg.updatedAt)}\n`);
    chunks.push("    </sso_config_entry>\n");
  }
  chunks.push("  </sso_config>\n");

  // ── Relationship types ──
  chunks.push("  <relationship_types>\n");
  for (const type of allRelationshipTypes) {
    chunks.push("    <relationship_type>\n");
    chunks.push(`      ${xmlTag("id", type.id)}\n`);
    chunks.push(`      ${xmlTag("name", type.name)}\n`);
    chunks.push(`      ${xmlTag("color", type.color)}\n`);
    chunks.push(`      ${xmlTag("value", type.value)}\n`);
    chunks.push(`      ${xmlTag("notes", type.notes || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", type.createdAt)}\n`);
    chunks.push("    </relationship_type>\n");
  }
  chunks.push("  </relationship_types>\n");

  // ── Interaction types ──
  chunks.push("  <interaction_types>\n");
  for (const type of allInteractionTypes) {
    chunks.push("    <interaction_type>\n");
    chunks.push(`      ${xmlTag("id", type.id)}\n`);
    chunks.push(`      ${xmlTag("name", type.name)}\n`);
    chunks.push(`      ${xmlTag("color", type.color)}\n`);
    chunks.push(`      ${xmlTag("description", type.description || "")}\n`);
    chunks.push(`      ${xmlTag("value", type.value)}\n`);
    chunks.push(`      ${xmlTag("created_at", type.createdAt)}\n`);
    chunks.push("    </interaction_type>\n");
  }
  chunks.push("  </interaction_types>\n");

  await onProgress?.(15, "Exporting people…");

  // ── People ──
  chunks.push("  <people>\n");
  for (const person of peopleToExport) {
    chunks.push("    <person>\n");
    chunks.push(`      ${xmlTag("id", person.id)}\n`);
    chunks.push(`      ${xmlTag("first_name", person.firstName)}\n`);
    chunks.push(`      ${xmlTag("last_name", person.lastName)}\n`);
    chunks.push(`      ${xmlTag("email", person.email || "")}\n`);
    chunks.push(`      ${xmlTag("phone", person.phone || "")}\n`);
    chunks.push(`      ${xmlTag("company", person.company || "")}\n`);
    chunks.push(`      ${xmlTag("title", person.title || "")}\n`);
    chunks.push(`      <tags>${arrayToXml(person.tags || [], "tag")}</tags>\n`);
    chunks.push(`      ${xmlTag("image_url", person.imageUrl || "")}\n`);
    chunks.push(`      <social_account_uuids>${arrayToXml(person.socialAccountUuids || [], "social_account_uuid")}</social_account_uuids>\n`);
    chunks.push(`      ${xmlTag("is_starred", person.isStarred)}\n`);
    chunks.push(`      ${xmlTag("elo_score", person.eloScore)}\n`);
    chunks.push(`      ${xmlTag("no_social_media", person.noSocialMedia ?? 0)}\n`);
    chunks.push(`      ${xmlTag("sex", person.sex || "unknown")}\n`);
    chunks.push(`      ${xmlTag("elo_rankable", person.eloRankable ?? 1)}\n`);
    chunks.push(`      ${xmlTag("personface_uuid", person.personfaceUuid || "")}\n`);
    chunks.push(`      ${xmlTag("maiden_name", person.maidenName || "")}\n`);
    chunks.push(`      ${xmlTag("nickname", person.nickname || "")}\n`);
    chunks.push(`      ${xmlJsonTag("jobs", person.jobs)}\n`);
    chunks.push(`      ${xmlTag("tps_id", person.tpsId || "")}\n`);
    chunks.push(`      ${xmlTag("birthday", person.birthday || "")}\n`);
    chunks.push(`      ${xmlJsonTag("additional_emails", person.additionalEmails)}\n`);
    chunks.push(`      ${xmlJsonTag("additional_phones", person.additionalPhones)}\n`);
    chunks.push(`      ${xmlJsonTag("osint_runs", person.osintRuns)}\n`);
    chunks.push(`      ${xmlJsonTag("denied_recommendations", person.deniedRecommendations)}\n`);
    chunks.push(`      ${xmlTag("last_described_at", person.lastDescribedAt)}\n`);
    chunks.push(`      ${xmlTag("political_left_right", person.politicalLeftRight)}\n`);
    chunks.push(`      ${xmlTag("political_lib_auth", person.politicalLibAuth)}\n`);
    chunks.push(`      ${xmlTag("political_updated_at", person.politicalUpdatedAt)}\n`);
    chunks.push(`      ${xmlJsonTag("ai_backend_notes", person.aiBackendNotes)}\n`);
    chunks.push(`      ${xmlTag("created_at", person.createdAt)}\n`);
    chunks.push("    </person>\n");
  }
  chunks.push("  </people>\n");

  await onProgress?.(25, "Exporting relationships & groups…");

  // ── Relationships ──
  chunks.push("  <relationships>\n");
  for (const rel of allRelationships) {
    chunks.push("    <relationship>\n");
    chunks.push(`      ${xmlTag("id", rel.id)}\n`);
    chunks.push(`      ${xmlTag("from_person_id", mapPersonExport(rel.fromPersonId))}\n`);
    chunks.push(`      ${xmlTag("to_person_id", mapPersonExport(rel.toPersonId))}\n`);
    chunks.push(`      ${xmlTag("type_id", rel.typeId)}\n`);
    chunks.push(`      ${xmlTag("notes", rel.notes || "")}\n`);
    chunks.push(`      ${xmlTag("family_relationship_type", rel.familyRelationshipType || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", rel.createdAt)}\n`);
    chunks.push("    </relationship>\n");
  }
  chunks.push("  </relationships>\n");

  // ── Groups ──
  chunks.push("  <groups>\n");
  for (const group of allGroups) {
    const members = (group.members || []).map((id: string) => mapPersonExport(id));
    const crowdMembers = (group.crowdMembers || []).map((id: string) => mapPersonExport(id));
    chunks.push("    <group>\n");
    chunks.push(`      ${xmlTag("id", group.id)}\n`);
    chunks.push(`      ${xmlTag("name", group.name)}\n`);
    chunks.push(`      ${xmlTag("color", group.color)}\n`);
    chunks.push(`      <type>${arrayToXml(group.type || [], "group_type")}</type>\n`);
    chunks.push(`      <members>${arrayToXml(members, "member_id")}</members>\n`);
    chunks.push(`      ${xmlTag("image_url", group.imageUrl || "")}\n`);
    chunks.push(`      ${xmlTag("center_account_id", group.centerAccountId || "")}\n`);
    chunks.push(`      <crowd_members>${arrayToXml(crowdMembers, "crowd_member_id")}</crowd_members>\n`);
    chunks.push(`      ${xmlTag("crowd_last_calculated_at", group.crowdLastCalculatedAt)}\n`);
    chunks.push(`      ${xmlTag("crowd_mode", group.crowdMode || "")}\n`);
    chunks.push(`      ${xmlTag("crowd_follow_threshold", group.crowdFollowThreshold)}\n`);
    chunks.push(`      ${xmlTag("created_at", group.createdAt)}\n`);
    chunks.push("    </group>\n");
  }
  chunks.push("  </groups>\n");

  // ── Sub-groups ──
  chunks.push("  <sub_groups>\n");
  for (const sg of allSubGroups) {
    const members = (sg.members || []).map((id: string) => mapPersonExport(id));
    chunks.push("    <sub_group_entry>\n");
    chunks.push(`      ${xmlTag("id", sg.id)}\n`);
    chunks.push(`      ${xmlTag("group_id", sg.groupId)}\n`);
    chunks.push(`      ${xmlTag("name", sg.name)}\n`);
    chunks.push(`      ${xmlTag("color", sg.color)}\n`);
    chunks.push(`      <members>${arrayToXml(members, "member_id")}</members>\n`);
    chunks.push(`      ${xmlTag("created_at", sg.createdAt)}\n`);
    chunks.push("    </sub_group_entry>\n");
  }
  chunks.push("  </sub_groups>\n");

  // ── Interactions ──
  chunks.push("  <interactions>\n");
  for (const interaction of allInteractions) {
    const peopleIds = (interaction.peopleIds || []).map(id => mapPersonExport(id));
    chunks.push("    <interaction>\n");
    chunks.push(`      ${xmlTag("id", interaction.id)}\n`);
    chunks.push(`      ${xmlTag("type_id", interaction.typeId)}\n`);
    chunks.push(`      ${xmlTag("title", interaction.title || "")}\n`);
    chunks.push(`      ${xmlTag("date", interaction.date)}\n`);
    chunks.push(`      ${xmlTag("description", interaction.description || "")}\n`);
    chunks.push(`      ${xmlTag("image_url", interaction.imageUrl || "")}\n`);
    chunks.push(`      ${xmlTag("image_uuid", interaction.imageUuid || "")}\n`);
    chunks.push(`      <people_ids>${arrayToXml(peopleIds, "person_id")}</people_ids>\n`);
    chunks.push(`      <group_ids>${arrayToXml(interaction.groupIds || [], "group_id")}</group_ids>\n`);
    chunks.push(`      ${xmlTag("created_at", interaction.createdAt)}\n`);
    chunks.push("    </interaction>\n");
  }
  chunks.push("  </interactions>\n");

  await onProgress?.(35, "Exporting notes & schooling…");

  // ── Notes ──
  chunks.push("  <notes>\n");
  for (const note of allNotes) {
    if (note.personId === mePersonId) continue;
    chunks.push("    <note>\n");
    chunks.push(`      ${xmlTag("id", note.id)}\n`);
    chunks.push(`      ${xmlTag("person_id", note.personId)}\n`);
    chunks.push(`      ${xmlTag("content", note.content)}\n`);
    chunks.push(`      ${xmlTag("image_url", note.imageUrl || "")}\n`);
    chunks.push(`      ${xmlTag("image_uuid", note.imageUuid || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", note.createdAt)}\n`);
    chunks.push("    </note>\n");
  }
  chunks.push("  </notes>\n");

  // ── Person addresses ──
  chunks.push("  <person_addresses>\n");
  for (const a of allPersonAddresses) {
    if (a.personId === mePersonId) continue;
    chunks.push("    <person_address>\n");
    chunks.push(`      ${xmlTag("id", a.id)}\n`);
    chunks.push(`      ${xmlTag("person_id", a.personId)}\n`);
    chunks.push(`      ${xmlTag("address", a.address)}\n`);
    chunks.push(`      ${xmlTag("label", a.label || "")}\n`);
    chunks.push(`      ${xmlTag("start_date", a.startDate || "")}\n`);
    chunks.push(`      ${xmlTag("end_date", a.endDate || "")}\n`);
    chunks.push(`      ${xmlTag("is_primary", a.isPrimary)}\n`);
    chunks.push(`      ${xmlTag("source", a.source)}\n`);
    chunks.push(`      ${xmlTag("property_url", a.propertyUrl || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", a.createdAt)}\n`);
    chunks.push("    </person_address>\n");
  }
  chunks.push("  </person_addresses>\n");

  // ── Group notes ──
  chunks.push("  <group_notes>\n");
  for (const note of allGroupNotes) {
    chunks.push("    <group_note>\n");
    chunks.push(`      ${xmlTag("id", note.id)}\n`);
    chunks.push(`      ${xmlTag("group_id", note.groupId)}\n`);
    chunks.push(`      ${xmlTag("content", note.content)}\n`);
    chunks.push(`      ${xmlTag("created_at", note.createdAt)}\n`);
    chunks.push("    </group_note>\n");
  }
  chunks.push("  </group_notes>\n");

  // ── Schooling ──
  chunks.push("  <schooling>\n");
  for (const s of allSchooling) {
    chunks.push("    <schooling_entry>\n");
    chunks.push(`      ${xmlTag("id", s.id)}\n`);
    chunks.push(`      ${xmlTag("person_id", mapPersonExport(s.personId))}\n`);
    chunks.push(`      ${xmlTag("high_school", s.highSchool || "")}\n`);
    chunks.push(`      ${xmlJsonTag("colleges", s.colleges)}\n`);
    chunks.push(`      ${xmlJsonTag("additional_schooling", s.additionalSchooling)}\n`);
    chunks.push(`      ${xmlTag("created_at", s.createdAt)}\n`);
    chunks.push("    </schooling_entry>\n");
  }
  chunks.push("  </schooling>\n");

  await onProgress?.(45, "Exporting social accounts…");

  // ── Social accounts ──
  chunks.push("  <social_accounts>\n");
  for (const account of allSocialAccounts) {
    const ownerUuid = mapPersonExport(account.ownerUuid);
    const nickname = account.nickname ?? account.currentProfile?.nickname ?? "";
    const bio = account.bio ?? account.currentProfile?.bio ?? "";
    const accountUrl = account.accountUrl ?? account.currentProfile?.accountUrl ?? "";
    const imageUrl = account.imageUrl ?? account.currentProfile?.imageUrl ?? "";
    const externalImageUrl = account.externalImageUrl ?? account.currentProfile?.externalImageUrl ?? "";
    chunks.push("    <social_account>\n");
    chunks.push(`      ${xmlTag("id", account.id)}\n`);
    chunks.push(`      ${xmlTag("username", account.username)}\n`);
    chunks.push(`      ${xmlTag("nickname", nickname)}\n`);
    chunks.push(`      ${xmlTag("bio", bio)}\n`);
    chunks.push(`      ${xmlTag("account_url", accountUrl)}\n`);
    chunks.push(`      ${xmlTag("owner_uuid", ownerUuid)}\n`);
    chunks.push(`      ${xmlTag("group_id", account.groupId || "")}\n`);
    chunks.push(`      ${xmlTag("type_id", account.typeId || "")}\n`);
    chunks.push(`      ${xmlTag("image_url", imageUrl)}\n`);
    chunks.push(`      ${xmlTag("is_hq_image", account.isHqImage)}\n`);
    chunks.push(`      ${xmlTag("external_image_url", externalImageUrl)}\n`);
    chunks.push(`      ${xmlTag("location", account.location || "")}\n`);
    chunks.push(`      ${xmlTag("followers_count", account.followersCount)}\n`);
    chunks.push(`      ${xmlTag("following_count", account.followingCount)}\n`);
    chunks.push(`      ${xmlTag("reported_followers_count", account.reportedFollowersCount)}\n`);
    chunks.push(`      ${xmlTag("reported_following_count", account.reportedFollowingCount)}\n`);
    chunks.push(`      ${xmlTag("is_simple", account.isSimple)}\n`);
    chunks.push(`      ${xmlTag("interest_level", account.interestLevel)}\n`);
    chunks.push(`      ${xmlTag("interest_level_manual", account.interestLevelManual)}\n`);
    chunks.push(`      ${xmlTag("scan_every_days", account.scanEveryDays)}\n`);
    chunks.push(`      ${xmlTag("scan_checked_at", account.scanCheckedAt)}\n`);
    chunks.push(`      ${xmlTag("scan_due_at", account.scanDueAt)}\n`);
    chunks.push(`      ${xmlTag("info_checked_at", account.infoCheckedAt)}\n`);
    chunks.push(`      ${xmlTag("follows_checked_at", account.followsCheckedAt)}\n`);
    chunks.push(`      ${xmlTag("posts_checked_at", account.postsCheckedAt)}\n`);
    chunks.push(`      ${xmlTag("highlights_checked_at", account.highlightsCheckedAt)}\n`);
    chunks.push(`      ${xmlTag("tagged_checked_at", account.taggedCheckedAt)}\n`);
    chunks.push(`      ${xmlTag("joined_at", account.joinedAt)}\n`);
    chunks.push(`      ${xmlTag("reported_posts_count", account.reportedPostsCount)}\n`);
    chunks.push(`      ${xmlTag("is_private", account.isPrivate)}\n`);
    chunks.push(`      ${xmlTag("personface_uuid", account.personfaceUuid || "")}\n`);
    chunks.push(`      ${xmlTag("no_face", account.noFace)}\n`);
    chunks.push(`      ${xmlJsonTag("banned_actions", account.bannedActions)}\n`);
    chunks.push(`      ${xmlTag("skip_stories", account.skipStories)}\n`);
    chunks.push(`      ${xmlTag("is_starred", account.isStarred)}\n`);
    chunks.push(`      ${xmlJsonTag("ai_summary", account.aiSummary)}\n`);
    chunks.push(`      ${xmlTag("ai_summary_generated_at", account.aiSummaryGeneratedAt)}\n`);
    chunks.push(`      ${xmlTag("ai_summary_invalidated", account.aiSummaryInvalidated)}\n`);
    chunks.push(`      ${xmlTag("ai_summary_invalidated_at", account.aiSummaryInvalidatedAt)}\n`);
    chunks.push(`      ${xmlTag("ai_summary_model", account.aiSummaryModel || "")}\n`);
    chunks.push(`      ${xmlJsonTag("ai_backend_notes", account.aiBackendNotes)}\n`);
    chunks.push("      <notes></notes>\n");
    chunks.push(`      <following>${arrayToXml(followingMap.get(account.id) || [], "account_id")}</following>\n`);
    chunks.push(`      <followers>${arrayToXml(followersMap.get(account.id) || [], "account_id")}</followers>\n`);
    chunks.push(`      ${xmlTag("internal_account_creation_date", account.internalAccountCreationDate)}\n`);
    chunks.push(`      ${xmlTag("internal_account_creation_type", account.internalAccountCreationType)}\n`);
    chunks.push(`      ${xmlTag("last_scraped_at", account.lastScrapedAt)}\n`);
    chunks.push(`      ${xmlTag("current_posts", account.currentPosts || "")}\n`);
    chunks.push(`      ${xmlTag("deleted_posts", account.deletedPosts || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", account.createdAt)}\n`);
    chunks.push("    </social_account>\n");
  }
  chunks.push("  </social_accounts>\n");

  // ── Social follows (explicit table preserving detectedAt & source) ──
  chunks.push("  <social_follows>\n");
  for (const edge of allFollows) {
    chunks.push("    <social_follow>\n");
    chunks.push(`      ${xmlTag("follower_id", edge.followerId)}\n`);
    chunks.push(`      ${xmlTag("followed_id", edge.followedId)}\n`);
    chunks.push(`      ${xmlTag("detected_at", edge.detectedAt)}\n`);
    chunks.push(`      ${xmlTag("source", edge.source || "")}\n`);
    chunks.push("    </social_follow>\n");
  }
  chunks.push("  </social_follows>\n");

  // ── Social account types ──
  chunks.push("  <social_account_types>\n");
  for (const type of allSocialAccountTypes) {
    chunks.push("    <social_account_type>\n");
    chunks.push(`      ${xmlTag("id", type.id)}\n`);
    chunks.push(`      ${xmlTag("name", type.name)}\n`);
    chunks.push(`      ${xmlTag("color", type.color)}\n`);
    chunks.push(`      ${xmlTag("created_at", type.createdAt)}\n`);
    chunks.push("    </social_account_type>\n");
  }
  chunks.push("  </social_account_types>\n");

  if (includePostHistory) {
    await onProgress?.(55, "Exporting posts & comments…");

    const [allPosts, allPostComments] = await Promise.all([
      storage.getAllPosts(),
      db.select().from(socialPostComments),
    ]);

    chunks.push("  <social_account_posts>\n");
    for (const post of allPosts) {
      chunks.push("    <social_account_post>\n");
      chunks.push(`      ${xmlTag("id", post.id)}\n`);
      chunks.push(`      ${xmlTag("social_account_id", post.socialAccountId)}\n`);
      chunks.push(`      ${xmlJsonTag("coauthor_account_ids", post.coauthorAccountIds)}\n`);
      chunks.push(`      ${xmlTag("post_type", post.postType)}\n`);
      chunks.push(`      ${xmlTag("instagram_pk", post.instagramPk || "")}\n`);
      chunks.push(`      ${xmlTag("content", post.content || "")}\n`);
      chunks.push(`      ${xmlTag("description", post.description || "")}\n`);
      chunks.push(`      ${xmlTag("like_count", post.likeCount)}\n`);
      chunks.push(`      ${xmlTag("likes_hidden", post.likesHidden)}\n`);
      chunks.push(`      ${xmlTag("comment_count", post.commentCount)}\n`);
      chunks.push(`      ${xmlTag("mentioned_accounts", post.mentionedAccounts || "")}\n`);
      chunks.push(`      ${xmlTag("face_ids", post.faceIds || "")}\n`);
      chunks.push(`      ${xmlTag("is_deleted", post.isDeleted)}\n`);
      chunks.push(`      ${xmlTag("posted_at", post.postedAt)}\n`);
      chunks.push(`      ${xmlJsonTag("metadata", post.metadata)}\n`);
      chunks.push(`      ${xmlJsonTag("video_transcript", post.videoTranscript)}\n`);
      chunks.push(`      ${xmlTag("video_transcript_at", post.videoTranscriptAt)}\n`);
      chunks.push(`      ${xmlTag("scraped_from", post.scrapedFrom || "")}\n`);
      chunks.push(`      ${xmlJsonTag("ai_summary", post.aiSummary)}\n`);
      chunks.push(`      ${xmlTag("ai_summary_at", post.aiSummaryAt)}\n`);
      chunks.push(`      ${xmlTag("ai_summary_model", post.aiSummaryModel || "")}\n`);
      chunks.push(`      ${xmlTag("created_at", post.createdAt)}\n`);
      chunks.push(`      ${xmlTag("updated_at", post.updatedAt)}\n`);
      chunks.push("    </social_account_post>\n");
    }
    chunks.push("  </social_account_posts>\n");

    chunks.push("  <social_post_comments>\n");
    for (const c of allPostComments) {
      chunks.push("    <social_post_comment>\n");
      chunks.push(`      ${xmlTag("id", c.id)}\n`);
      chunks.push(`      ${xmlTag("post_id", c.postId)}\n`);
      chunks.push(`      ${xmlTag("instagram_comment_id", c.instagramCommentId)}\n`);
      chunks.push(`      ${xmlTag("username", c.username)}\n`);
      chunks.push(`      ${xmlTag("text", c.text)}\n`);
      chunks.push(`      ${xmlTag("like_count", c.likeCount)}\n`);
      chunks.push(`      ${xmlTag("posted_at", c.postedAt)}\n`);
      chunks.push(`      ${xmlTag("created_at", c.createdAt)}\n`);
      chunks.push(`      ${xmlTag("updated_at", c.updatedAt)}\n`);
      chunks.push("    </social_post_comment>\n");
    }
    chunks.push("  </social_post_comments>\n");
  }

  await onProgress?.(65, "Exporting photos & face recognition data…");

  // ── Photos ──
  chunks.push("  <photos>\n");
  for (const photo of allPhotos) {
    chunks.push("    <photo_entry>\n");
    chunks.push(`      ${xmlTag("id", photo.id)}\n`);
    chunks.push(`      ${xmlTag("location", photo.location)}\n`);
    chunks.push(`      ${xmlTag("uploaded_at", photo.uploadedAt)}\n`);
    chunks.push(`      ${xmlTag("is_sub_image", photo.isSubImage)}\n`);
    chunks.push(`      ${xmlTag("processed_at", photo.processedAt)}\n`);
    chunks.push(`      ${xmlTag("image_description_at", photo.imageDescriptionAt)}\n`);
    chunks.push(`      ${xmlTag("image_description", photo.imageDescription || "")}\n`);
    chunks.push(`      ${xmlTag("face_id_at", photo.faceIdAt)}\n`);
    chunks.push(`      ${xmlJsonTag("face_uuids", photo.faceUuids)}\n`);
    chunks.push(`      ${xmlJsonTag("facial_ids", photo.facialIds)}\n`);
    chunks.push(`      ${xmlTag("ocr_at", photo.ocrAt)}\n`);
    chunks.push(`      ${xmlJsonTag("ocr_data", photo.ocrData)}\n`);
    chunks.push(`      ${xmlTag("prm_location", mapPrmLocationExport(photo.prmLocation))}\n`);
    chunks.push(`      ${xmlJsonTag("metadata", photo.metadata)}\n`);
    chunks.push(`      ${xmlJsonTag("og_metadata", photo.ogMetadata)}\n`);
    chunks.push(`      ${xmlTag("file_hash", photo.fileHash || "")}\n`);
    chunks.push(`      ${xmlTag("width_px", photo.widthPx)}\n`);
    chunks.push(`      ${xmlTag("height_px", photo.heightPx)}\n`);
    chunks.push(`      ${xmlTag("perceptual_hash", photo.perceptualHash || "")}\n`);
    chunks.push("    </photo_entry>\n");
  }
  chunks.push("  </photos>\n");

  // ── Faces ──
  chunks.push("  <faces>\n");
  for (const face of allFaces) {
    chunks.push("    <face_entry>\n");
    chunks.push(`      ${xmlTag("id", face.id)}\n`);
    chunks.push(`      ${xmlTag("photo_id", face.photoId || "")}\n`);
    chunks.push(`      ${xmlTag("s3_url", face.s3Url)}\n`);
    chunks.push(`      ${xmlJsonTag("embedding", face.embedding)}\n`);
    chunks.push(`      ${xmlTag("personface_uuid", face.personfaceUuid || "")}\n`);
    chunks.push(`      ${xmlTag("detection_confidence", face.detectionConfidence || "")}\n`);
    chunks.push(`      ${xmlJsonTag("coordinates", face.coordinates)}\n`);
    chunks.push(`      ${xmlTag("created_at", face.createdAt)}\n`);
    chunks.push(`      ${xmlTag("dismissed_at", face.dismissedAt)}\n`);
    chunks.push(`      ${xmlTag("pitch", face.pitch)}\n`);
    chunks.push(`      ${xmlTag("roll", face.roll)}\n`);
    chunks.push(`      ${xmlTag("sharpness", face.sharpness)}\n`);
    chunks.push(`      ${xmlTag("yaw", face.yaw)}\n`);
    chunks.push(`      ${xmlTag("auto_match_score", face.autoMatchScore)}\n`);
    chunks.push("    </face_entry>\n");
  }
  chunks.push("  </faces>\n");

  // ── Face pair dismissals ──
  chunks.push("  <face_pair_dismissals>\n");
  for (const d of allFacePairDismissals) {
    chunks.push("    <face_pair_dismissal>\n");
    chunks.push(`      ${xmlTag("id", d.id)}\n`);
    chunks.push(`      ${xmlTag("group_a_uuid", d.groupAUuid)}\n`);
    chunks.push(`      ${xmlTag("group_b_uuid", d.groupBUuid)}\n`);
    chunks.push(`      ${xmlTag("created_at", d.createdAt)}\n`);
    chunks.push("    </face_pair_dismissal>\n");
  }
  chunks.push("  </face_pair_dismissals>\n");

  // ── Image questions ──
  chunks.push("  <image_questions>\n");
  for (const q of allImageQuestions) {
    chunks.push("    <image_question>\n");
    chunks.push(`      ${xmlTag("id", q.id)}\n`);
    chunks.push(`      ${xmlTag("photo_id", q.photoId)}\n`);
    chunks.push(`      ${xmlTag("face_uuid", q.faceUuid || "")}\n`);
    chunks.push(`      ${xmlTag("sub_image_url", q.subImageUrl)}\n`);
    chunks.push(`      ${xmlJsonTag("coordinates", q.coordinates)}\n`);
    chunks.push(`      ${xmlTag("status", q.status)}\n`);
    chunks.push(`      ${xmlTag("resolved_as", q.resolvedAs || "")}\n`);
    chunks.push(`      ${xmlTag("resolved_person_id", mapPersonExport(q.resolvedPersonId))}\n`);
    chunks.push(`      ${xmlTag("created_at", q.createdAt)}\n`);
    chunks.push(`      ${xmlTag("resolved_at", q.resolvedAt)}\n`);
    chunks.push("    </image_question>\n");
  }
  chunks.push("  </image_questions>\n");

  // ── Lineages ──
  chunks.push("  <lineages>\n");
  for (const lin of allLineages) {
    chunks.push("    <lineage_entry>\n");
    chunks.push(`      ${xmlTag("id", lin.id)}\n`);
    chunks.push(`      ${xmlTag("child_id", mapPersonExport(lin.childId))}\n`);
    chunks.push(`      ${xmlTag("parent_id", mapPersonExport(lin.parentId))}\n`);
    chunks.push(`      ${xmlTag("lineage_type", lin.lineageType)}\n`);
    chunks.push(`      ${xmlTag("created_at", lin.createdAt)}\n`);
    chunks.push("    </lineage_entry>\n");
  }
  chunks.push("  </lineages>\n");

  // ── Partnerships ──
  chunks.push("  <partnerships>\n");
  for (const part of allPartnerships) {
    chunks.push("    <partnership_entry>\n");
    chunks.push(`      ${xmlTag("id", part.id)}\n`);
    chunks.push(`      ${xmlTag("person1_id", mapPersonExport(part.person1Id))}\n`);
    chunks.push(`      ${xmlTag("person2_id", mapPersonExport(part.person2Id))}\n`);
    chunks.push(`      ${xmlTag("status", part.status)}\n`);
    chunks.push(`      ${xmlTag("created_at", part.createdAt)}\n`);
    chunks.push("    </partnership_entry>\n");
  }
  chunks.push("  </partnerships>\n");

  await onProgress?.(74, "Exporting daily notes, AI & OSINT records…");

  // ── Daily notes ──
  chunks.push("  <daily_notes>\n");
  for (const dn of allDailyNotes) {
    chunks.push("    <daily_note_entry>\n");
    chunks.push(`      ${xmlTag("id", dn.id)}\n`);
    chunks.push(`      ${xmlTag("date", dn.date)}\n`);
    chunks.push(`      ${xmlTag("user_title", dn.userTitle)}\n`);
    chunks.push(`      ${xmlTag("body", dn.body)}\n`);
    chunks.push(`      ${xmlTag("status", dn.status)}\n`);
    chunks.push(`      ${xmlTag("created_at", dn.createdAt)}\n`);
    chunks.push(`      ${xmlTag("updated_at", dn.updatedAt)}\n`);
    chunks.push("    </daily_note_entry>\n");
  }
  chunks.push("  </daily_notes>\n");

  // ── Daily note events ──
  chunks.push("  <daily_note_events>\n");
  for (const ev of allDailyNoteEvents) {
    chunks.push("    <daily_note_event_entry>\n");
    chunks.push(`      ${xmlTag("id", ev.id)}\n`);
    chunks.push(`      ${xmlTag("daily_note_id", ev.dailyNoteId)}\n`);
    chunks.push(`      ${xmlTag("text", ev.text)}\n`);
    chunks.push(`      ${xmlTag("position", ev.position)}\n`);
    chunks.push(`      ${xmlTag("created_at", ev.createdAt)}\n`);
    chunks.push("    </daily_note_event_entry>\n");
  }
  chunks.push("  </daily_note_events>\n");

  // ── Daily note involved parties ──
  chunks.push("  <daily_note_involved_parties>\n");
  for (const party of allDailyNoteInvolvedParties) {
    const refId = party.partyType === "person" ? mapPersonExport(party.refId) : party.refId;
    chunks.push("    <daily_note_involved_party_entry>\n");
    chunks.push(`      ${xmlTag("id", party.id)}\n`);
    chunks.push(`      ${xmlTag("daily_note_id", party.dailyNoteId)}\n`);
    chunks.push(`      ${xmlTag("party_type", party.partyType)}\n`);
    chunks.push(`      ${xmlTag("ref_id", refId)}\n`);
    chunks.push("    </daily_note_involved_party_entry>\n");
  }
  chunks.push("  </daily_note_involved_parties>\n");

  // ── Daily note audit logs ──
  chunks.push("  <daily_note_audit_logs>\n");
  for (const audit of allDailyNoteAuditLogs) {
    chunks.push("    <daily_note_audit_log_entry>\n");
    chunks.push(`      ${xmlTag("id", audit.id)}\n`);
    chunks.push(`      ${xmlTag("daily_note_id", audit.dailyNoteId)}\n`);
    chunks.push(`      ${xmlTag("action", audit.action)}\n`);
    chunks.push(`      ${xmlTag("timestamp", audit.timestamp)}\n`);
    chunks.push(`      ${xmlTag("pin_used", audit.pinUsed)}\n`);
    chunks.push("    </daily_note_audit_log_entry>\n");
  }
  chunks.push("  </daily_note_audit_logs>\n");

  // ── Sex guess records ──
  chunks.push("  <sex_guess_records>\n");
  for (const guess of allSexGuesses) {
    chunks.push("    <sex_guess_entry>\n");
    chunks.push(`      ${xmlTag("id", guess.id)}\n`);
    chunks.push(`      ${xmlTag("person_id", mapPersonExport(guess.personId))}\n`);
    chunks.push(`      ${xmlTag("guessed_sex", guess.guessedSex)}\n`);
    chunks.push(`      ${xmlTag("reasoning", guess.reasoning)}\n`);
    chunks.push(`      ${xmlTag("date_added", guess.dateAdded)}\n`);
    chunks.push(`      ${xmlTag("answered", guess.answered)}\n`);
    chunks.push(`      ${xmlTag("snooze_until", guess.snoozedUntil)}\n`);
    chunks.push("    </sex_guess_entry>\n");
  }
  chunks.push("  </sex_guess_records>\n");

  // ── AI Providers ──
  chunks.push("  <ai_providers>\n");
  for (const prov of allAiProviders) {
    chunks.push("    <ai_provider>\n");
    chunks.push(`      ${xmlTag("id", prov.id)}\n`);
    chunks.push(`      ${xmlTag("name", prov.name)}\n`);
    chunks.push(`      ${xmlTag("kind", prov.kind)}\n`);
    chunks.push(`      ${xmlTag("base_url", prov.baseUrl)}\n`);
    chunks.push(`      ${xmlTag("auth_type", prov.authType)}\n`);
    chunks.push(`      ${xmlTag("username", prov.username || "")}\n`);
    chunks.push(`      ${xmlTag("secret", prov.secret || "")}\n`);
    chunks.push(`      ${xmlTag("is_default", prov.isDefault)}\n`);
    chunks.push(`      ${xmlTag("is_external", prov.isExternal)}\n`);
    chunks.push(`      ${xmlTag("created_at", prov.createdAt)}\n`);
    chunks.push("    </ai_provider>\n");
  }
  chunks.push("  </ai_providers>\n");

  // ── AI Chats ──
  chunks.push("  <ai_chats>\n");
  for (const chat of allAiChats) {
    chunks.push("    <ai_chat_entry>\n");
    chunks.push(`      ${xmlTag("id", chat.id)}\n`);
    chunks.push(`      ${xmlTag("title", chat.title)}\n`);
    chunks.push(`      ${xmlTag("system_message", chat.systemMessage || "")}\n`);
    chunks.push(`      ${xmlTag("model", chat.model || "")}\n`);
    chunks.push(`      ${xmlTag("provider_id", chat.providerId || "")}\n`);
    chunks.push(`      ${xmlJsonTag("messages", chat.messages || [])}\n`);
    chunks.push(`      ${xmlTag("agent_mode", chat.agentMode)}\n`);
    chunks.push(`      ${xmlTag("created_at", chat.createdAt)}\n`);
    chunks.push(`      ${xmlTag("updated_at", chat.updatedAt)}\n`);
    chunks.push("    </ai_chat_entry>\n");
  }
  chunks.push("  </ai_chats>\n");

  // ── App settings ──
  chunks.push("  <app_settings_list>\n");
  for (const setting of allAppSettings) {
    const val = setting.key === "me_person_id" ? mapPersonExport(setting.value) : setting.value;
    chunks.push("    <app_setting_entry>\n");
    chunks.push(`      ${xmlTag("key", setting.key)}\n`);
    chunks.push(`      ${xmlTag("value", val)}\n`);
    chunks.push("    </app_setting_entry>\n");
  }
  chunks.push("  </app_settings_list>\n");

  // ── TruePersonSearch ──
  chunks.push("  <true_person_search>\n");
  for (const tps of allTps) {
    chunks.push("    <true_person_search_entry>\n");
    chunks.push(`      ${xmlTag("id", tps.id)}\n`);
    chunks.push(`      ${xmlTag("tps_id", tps.tpsId)}\n`);
    chunks.push(`      ${xmlTag("person_id", mapPersonExport(tps.personId))}\n`);
    chunks.push(`      ${xmlTag("import_date", tps.importDate)}\n`);
    chunks.push(`      ${xmlTag("full_name", tps.fullName || "")}\n`);
    chunks.push(`      ${xmlJsonTag("akas", tps.akas)}\n`);
    chunks.push(`      ${xmlTag("birthday", tps.birthday || "")}\n`);
    chunks.push(`      ${xmlTag("current_address", tps.currentAddress || "")}\n`);
    chunks.push(`      ${xmlTag("current_address_property_details", tps.currentAddressPropertyDetails || "")}\n`);
    chunks.push(`      ${xmlTag("current_address_property_url", tps.currentAddressPropertyUrl || "")}\n`);
    chunks.push(`      ${xmlJsonTag("addresses", tps.addresses)}\n`);
    chunks.push(`      ${xmlJsonTag("phone_numbers", tps.phoneNumbers)}\n`);
    chunks.push(`      ${xmlJsonTag("emails", tps.emails)}\n`);
    chunks.push(`      ${xmlJsonTag("relatives", tps.relatives)}\n`);
    chunks.push(`      ${xmlJsonTag("associates", tps.associates)}\n`);
    chunks.push(`      ${xmlJsonTag("business_connections", tps.businessConnections)}\n`);
    chunks.push(`      ${xmlJsonTag("jobs", tps.jobs)}\n`);
    chunks.push(`      ${xmlJsonTag("colleges", tps.colleges)}\n`);
    chunks.push(`      ${xmlTag("background_profile", tps.backgroundProfile || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", tps.createdAt)}\n`);
    chunks.push(`      ${xmlTag("updated_at", tps.updatedAt)}\n`);
    chunks.push("    </true_person_search_entry>\n");
  }
  chunks.push("  </true_person_search>\n");

  // ── Pending social account imports ──
  chunks.push("  <pending_social_account_imports>\n");
  for (const p of allPendingImports) {
    chunks.push("    <pending_social_account_import>\n");
    chunks.push(`      ${xmlTag("id", p.id)}\n`);
    chunks.push(`      ${xmlTag("timestamp_added", p.timestampAdded)}\n`);
    chunks.push(`      ${xmlTag("timestamp_imported", p.timestampImported)}\n`);
    chunks.push(`      ${xmlTag("already_added", p.alreadyAdded)}\n`);
    chunks.push(`      ${xmlTag("account_username", p.accountUsername)}\n`);
    chunks.push(`      ${xmlTag("account_display_name", p.accountDisplayName || "")}\n`);
    chunks.push(`      ${xmlTag("account_bio", p.accountBio || "")}\n`);
    chunks.push(`      ${xmlTag("account_website", p.accountWebsite || "")}\n`);
    chunks.push(`      ${xmlTag("account_email", p.accountEmail || "")}\n`);
    chunks.push(`      ${xmlTag("account_phone", p.accountPhone || "")}\n`);
    chunks.push(`      ${xmlTag("account_location_area", p.accountLocationArea || "")}\n`);
    chunks.push(`      ${xmlTag("account_followers", p.accountFollowers || "")}\n`);
    chunks.push(`      ${xmlTag("account_following", p.accountFollowing || "")}\n`);
    chunks.push(`      ${xmlTag("account_image_url", p.accountImageUrl || "")}\n`);
    chunks.push(`      ${xmlTag("account_followers_count", p.accountFollowersCount)}\n`);
    chunks.push(`      ${xmlTag("account_following_count", p.accountFollowingCount)}\n`);
    chunks.push(`      ${xmlTag("import_type", p.importType)}\n`);
    chunks.push(`      ${xmlTag("capture_scope", p.captureScope)}\n`);
    chunks.push(`      ${xmlTag("created_at", p.createdAt)}\n`);
    chunks.push(`      ${xmlTag("updated_at", p.updatedAt)}\n`);
    chunks.push("    </pending_social_account_import>\n");
  }
  chunks.push("  </pending_social_account_imports>\n");

  // ── Insights ──
  chunks.push("  <insights>\n");
  for (const ins of allInsights) {
    const peopleIds = (ins.applicablePeopleIds || []).map(id => mapPersonExport(id));
    chunks.push("    <insight>\n");
    chunks.push(`      ${xmlTag("id", ins.id)}\n`);
    chunks.push(`      ${xmlTag("type", ins.type)}\n`);
    chunks.push(`      ${xmlTag("source", ins.source)}\n`);
    chunks.push(`      ${xmlTag("collected_at", ins.collectedAt)}\n`);
    chunks.push(`      ${xmlTag("raw_text", ins.rawText || "")}\n`);
    chunks.push(`      ${xmlJsonTag("data", ins.data)}\n`);
    chunks.push(`      <applicable_people_ids>${arrayToXml(peopleIds, "person_id")}</applicable_people_ids>\n`);
    chunks.push(`      <applicable_social_account_ids>${arrayToXml(ins.applicableSocialAccountIds || [], "account_id")}</applicable_social_account_ids>\n`);
    chunks.push("    </insight>\n");
  }
  chunks.push("  </insights>\n");

  // ── OSINT Scans ──
  chunks.push("  <osint_scans>\n");
  for (const scan of allOsintScans) {
    chunks.push("    <osint_scan>\n");
    chunks.push(`      ${xmlTag("id", scan.id)}\n`);
    chunks.push(`      ${xmlTag("tool", scan.tool)}\n`);
    chunks.push(`      ${xmlTag("target", scan.target)}\n`);
    chunks.push(`      ${xmlTag("target_type", scan.targetType)}\n`);
    chunks.push(`      ${xmlJsonTag("options", scan.options)}\n`);
    chunks.push(`      ${xmlTag("social_account_id", scan.socialAccountId || "")}\n`);
    chunks.push(`      ${xmlTag("person_id", mapPersonExport(scan.personId))}\n`);
    chunks.push(`      ${xmlTag("status", scan.status)}\n`);
    chunks.push(`      ${xmlTag("attempts", scan.attempts)}\n`);
    chunks.push(`      ${xmlTag("compute_job_id", scan.computeJobId || "")}\n`);
    chunks.push(`      ${xmlTag("error", scan.error || "")}\n`);
    chunks.push(`      ${xmlJsonTag("result", scan.result)}\n`);
    chunks.push(`      ${xmlTag("created_at", scan.createdAt)}\n`);
    chunks.push(`      ${xmlTag("started_at", scan.startedAt)}\n`);
    chunks.push(`      ${xmlTag("completed_at", scan.completedAt)}\n`);
    chunks.push("    </osint_scan>\n");
  }
  chunks.push("  </osint_scans>\n");

  await onProgress?.(82, "Exporting story importers, messages & geocodes…");

  // ── Story importers ──
  chunks.push("  <story_importers>\n");
  for (const imp of allStoryImporters) {
    chunks.push("    <story_importer>\n");
    chunks.push(`      ${xmlTag("id", imp.id)}\n`);
    chunks.push(`      ${xmlTag("label", imp.label)}\n`);
    chunks.push(`      ${xmlTag("service_url", imp.serviceUrl)}\n`);
    chunks.push(`      ${xmlTag("service_secret", imp.serviceSecret)}\n`);
    chunks.push(`      ${xmlTag("enabled", imp.enabled)}\n`);
    chunks.push(`      ${xmlTag("run_every_days", imp.runEveryDays)}\n`);
    chunks.push(`      ${xmlTag("run_window", imp.runWindow)}\n`);
    chunks.push(`      ${xmlTag("skip_day_probability", imp.skipDayProbability)}\n`);
    chunks.push(`      ${xmlTag("download_videos", imp.downloadVideos)}\n`);
    chunks.push(`      ${xmlTag("unseen_only", imp.unseenOnly)}\n`);
    chunks.push(`      ${xmlTag("run_now_unseen_only", imp.runNowUnseenOnly)}\n`);
    chunks.push(`      ${xmlTag("next_run_at", imp.nextRunAt)}\n`);
    chunks.push(`      ${xmlTag("last_username", imp.lastUsername || "")}\n`);
    chunks.push(`      ${xmlTag("tracking_enabled", imp.trackingEnabled)}\n`);
    chunks.push(`      ${xmlTag("tracking_window", imp.trackingWindow)}\n`);
    chunks.push(`      ${xmlTag("tracking_max_jobs", imp.trackingMaxJobs)}\n`);
    chunks.push(`      ${xmlTag("next_tracking_run_at", imp.nextTrackingRunAt)}\n`);
    chunks.push(`      ${xmlTag("created_at", imp.createdAt)}\n`);
    chunks.push("    </story_importer>\n");
  }
  chunks.push("  </story_importers>\n");

  // ── Story scrape runs ──
  chunks.push("  <story_scrape_runs>\n");
  for (const run of allStoryScrapeRuns) {
    chunks.push("    <story_scrape_run>\n");
    chunks.push(`      ${xmlTag("id", run.id)}\n`);
    chunks.push(`      ${xmlTag("importer_id", run.importerId || "")}\n`);
    chunks.push(`      ${xmlTag("kind", run.kind)}\n`);
    chunks.push(`      ${xmlTag("status", run.status)}\n`);
    chunks.push(`      ${xmlTag("started_at", run.startedAt)}\n`);
    chunks.push(`      ${xmlTag("finished_at", run.finishedAt)}\n`);
    chunks.push(`      ${xmlJsonTag("counts", run.counts)}\n`);
    chunks.push(`      ${xmlJsonTag("items", run.items)}\n`);
    chunks.push(`      ${xmlTag("error", run.error || "")}\n`);
    chunks.push(`      ${xmlTag("scraped_from", run.scrapedFrom || "")}\n`);
    chunks.push(`      ${xmlTag("token_hash", run.tokenHash || "")}\n`);
    chunks.push(`      ${xmlTag("token_expires_at", run.tokenExpiresAt)}\n`);
    chunks.push("    </story_scrape_run>\n");
  }
  chunks.push("  </story_scrape_runs>\n");

  // ── Tracking jobs ──
  chunks.push("  <tracking_jobs>\n");
  for (const job of allTrackingJobs) {
    chunks.push("    <tracking_job>\n");
    chunks.push(`      ${xmlTag("id", job.id)}\n`);
    chunks.push(`      ${xmlTag("social_account_id", job.socialAccountId)}\n`);
    chunks.push(`      ${xmlTag("kind", job.kind)}\n`);
    chunks.push(`      ${xmlTag("origin", job.origin)}\n`);
    chunks.push(`      ${xmlTag("status", job.status)}\n`);
    chunks.push(`      ${xmlTag("importer_id", job.importerId || "")}\n`);
    chunks.push(`      ${xmlTag("run_id", job.runId || "")}\n`);
    chunks.push(`      ${xmlTag("batch_id", job.batchId || "")}\n`);
    chunks.push(`      ${xmlTag("attempts", job.attempts)}\n`);
    chunks.push(`      ${xmlJsonTag("result", job.result)}\n`);
    chunks.push(`      ${xmlTag("error", job.error || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", job.createdAt)}\n`);
    chunks.push(`      ${xmlTag("started_at", job.startedAt)}\n`);
    chunks.push(`      ${xmlTag("finished_at", job.finishedAt)}\n`);
    chunks.push("    </tracking_job>\n");
  }
  chunks.push("  </tracking_jobs>\n");

  // ── Social account issues ──
  chunks.push("  <social_account_issues>\n");
  for (const iss of allSocialAccountIssues) {
    chunks.push("    <social_account_issue>\n");
    chunks.push(`      ${xmlTag("id", iss.id)}\n`);
    chunks.push(`      ${xmlTag("social_account_id", iss.socialAccountId)}\n`);
    chunks.push(`      ${xmlTag("kind", iss.kind)}\n`);
    chunks.push(`      ${xmlTag("status", iss.status)}\n`);
    chunks.push(`      ${xmlTag("job_id", iss.jobId || "")}\n`);
    chunks.push(`      ${xmlTag("job_kind", iss.jobKind || "")}\n`);
    chunks.push(`      ${xmlTag("times_seen", iss.timesSeen)}\n`);
    chunks.push(`      ${xmlTag("first_seen_at", iss.firstSeenAt)}\n`);
    chunks.push(`      ${xmlTag("last_seen_at", iss.lastSeenAt)}\n`);
    chunks.push(`      ${xmlTag("resolution", iss.resolution || "")}\n`);
    chunks.push(`      ${xmlTag("previous_username", iss.previousUsername || "")}\n`);
    chunks.push(`      ${xmlTag("resolved_at", iss.resolvedAt)}\n`);
    chunks.push("    </social_account_issue>\n");
  }
  chunks.push("  </social_account_issues>\n");

  // ── Conversations ──
  chunks.push("  <conversations>\n");
  for (const conv of allConversations) {
    chunks.push("    <conversation>\n");
    chunks.push(`      ${xmlTag("id", conv.id)}\n`);
    chunks.push(`      ${xmlTag("title", conv.title || "")}\n`);
    chunks.push(`      ${xmlTag("channel_type", conv.channelType)}\n`);
    chunks.push(`      ${xmlTag("social_account_id", conv.socialAccountId || "")}\n`);
    chunks.push(`      ${xmlTag("external_url", conv.externalUrl || "")}\n`);
    chunks.push(`      ${xmlJsonTag("metadata", conv.metadata)}\n`);
    chunks.push(`      ${xmlTag("last_message_at", conv.lastMessageAt)}\n`);
    chunks.push(`      ${xmlTag("import_date", conv.importDate)}\n`);
    chunks.push(`      ${xmlTag("import_uuid", conv.importUuid || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", conv.createdAt)}\n`);
    chunks.push("    </conversation>\n");
  }
  chunks.push("  </conversations>\n");

  // ── Messages ──
  chunks.push("  <messages>\n");
  for (const msg of allMessages) {
    chunks.push("    <message>\n");
    chunks.push(`      ${xmlTag("id", msg.id)}\n`);
    chunks.push(`      ${xmlTag("conversation_id", msg.conversationId)}\n`);
    chunks.push(`      ${xmlTag("sender_person_id", mapPersonExport(msg.senderPersonId))}\n`);
    chunks.push(`      ${xmlTag("sender_social_account_id", msg.senderSocialAccountId || "")}\n`);
    chunks.push(`      ${xmlTag("content", msg.content || "")}\n`);
    chunks.push(`      ${xmlTag("content_type", msg.contentType)}\n`);
    chunks.push(`      <image_uuids>${arrayToXml(msg.imageUuids || [], "image_uuid")}</image_uuids>\n`);
    chunks.push(`      ${xmlJsonTag("attachments", msg.attachments)}\n`);
    chunks.push(`      ${xmlTag("external_id", msg.externalId || "")}\n`);
    chunks.push(`      ${xmlTag("sent_at", msg.sentAt)}\n`);
    chunks.push(`      ${xmlJsonTag("metadata", msg.metadata)}\n`);
    chunks.push(`      ${xmlTag("import_date", msg.importDate)}\n`);
    chunks.push(`      ${xmlTag("import_uuid", msg.importUuid || "")}\n`);
    chunks.push(`      ${xmlTag("created_at", msg.createdAt)}\n`);
    chunks.push("    </message>\n");
  }
  chunks.push("  </messages>\n");

  // ── Message recipients ──
  chunks.push("  <message_recipients>\n");
  for (const rec of allMessageRecipients) {
    chunks.push("    <message_recipient>\n");
    chunks.push(`      ${xmlTag("id", rec.id)}\n`);
    chunks.push(`      ${xmlTag("message_id", rec.messageId)}\n`);
    chunks.push(`      ${xmlTag("person_id", mapPersonExport(rec.personId))}\n`);
    chunks.push(`      ${xmlTag("social_account_id", rec.socialAccountId || "")}\n`);
    chunks.push(`      ${xmlTag("recipient_type", rec.recipientType)}\n`);
    chunks.push(`      ${xmlTag("import_date", rec.importDate)}\n`);
    chunks.push(`      ${xmlTag("import_uuid", rec.importUuid || "")}\n`);
    chunks.push("    </message_recipient>\n");
  }
  chunks.push("  </message_recipients>\n");

  // ── Conversation participants ──
  chunks.push("  <conversation_participants>\n");
  for (const part of allConversationParticipants) {
    chunks.push("    <conversation_participant>\n");
    chunks.push(`      ${xmlTag("id", part.id)}\n`);
    chunks.push(`      ${xmlTag("conversation_id", part.conversationId)}\n`);
    chunks.push(`      ${xmlTag("person_id", mapPersonExport(part.personId))}\n`);
    chunks.push(`      ${xmlTag("social_account_id", part.socialAccountId || "")}\n`);
    chunks.push(`      ${xmlTag("role", part.role)}\n`);
    chunks.push(`      ${xmlTag("joined_at", part.joinedAt)}\n`);
    chunks.push(`      ${xmlTag("import_date", part.importDate)}\n`);
    chunks.push(`      ${xmlTag("import_uuid", part.importUuid || "")}\n`);
    chunks.push("    </conversation_participant>\n");
  }
  chunks.push("  </conversation_participants>\n");

  // ── Geocodes ──
  chunks.push("  <geocodes>\n");
  for (const geo of allGeocodes) {
    chunks.push("    <geocode>\n");
    chunks.push(`      ${xmlTag("query", geo.query)}\n`);
    chunks.push(`      ${xmlTag("status", geo.status)}\n`);
    chunks.push(`      ${xmlTag("latitude", geo.latitude)}\n`);
    chunks.push(`      ${xmlTag("longitude", geo.longitude)}\n`);
    chunks.push(`      ${xmlTag("display_name", geo.displayName || "")}\n`);
    chunks.push(`      ${xmlTag("geocoded_at", geo.geocodedAt)}\n`);
    chunks.push("    </geocode>\n");
  }
  chunks.push("  </geocodes>\n");

  if (includeHistory) {
    await onProgress?.(90, "Exporting account history & network changes…");

    const [allHistory, allHistoricalSummaries, allNetworkChanges] = await Promise.all([
      db.select().from(socialAccountHistory),
      db.select().from(historicalAccountSummaries),
      storage.getAllNetworkChanges(),
    ]);

    chunks.push("  <social_account_history>\n");
    for (const h of allHistory) {
      chunks.push("    <history_entry>\n");
      chunks.push(`      ${xmlTag("id", h.id)}\n`);
      chunks.push(`      ${xmlTag("social_account_id", h.socialAccountId)}\n`);
      chunks.push(`      ${xmlTag("batch_id", h.batchId)}\n`);
      chunks.push(`      ${xmlTag("entry_kind", h.entryKind)}\n`);
      chunks.push(`      ${xmlTag("change_source", h.changeSource)}\n`);
      chunks.push(`      ${xmlTag("capture_scope", h.captureScope)}\n`);
      chunks.push(`      ${xmlTag("is_initial_capture", h.isInitialCapture)}\n`);
      chunks.push(`      ${xmlTag("pending_import_id", h.pendingImportId || "")}\n`);
      chunks.push(`      ${xmlTag("observed_via_account_id", h.observedViaAccountId || "")}\n`);
      chunks.push(`      ${xmlTag("detected_at", h.detectedAt)}\n`);
      chunks.push(`      ${xmlTag("followers_after", h.followersAfter)}\n`);
      chunks.push(`      ${xmlTag("followers_added", h.followersAdded)}\n`);
      chunks.push(`      ${xmlTag("followers_lost", h.followersLost)}\n`);
      chunks.push(`      ${xmlTag("following_after", h.followingAfter)}\n`);
      chunks.push(`      ${xmlTag("following_added", h.followingAdded)}\n`);
      chunks.push(`      ${xmlTag("following_lost", h.followingLost)}\n`);
      chunks.push(`      ${xmlTag("reported_followers_after", h.reportedFollowersAfter)}\n`);
      chunks.push(`      ${xmlTag("reported_following_after", h.reportedFollowingAfter)}\n`);
      chunks.push(`      ${xmlTag("posts_added", h.postsAdded)}\n`);
      chunks.push(`      ${xmlTag("posts_deleted", h.postsDeleted)}\n`);
      chunks.push(`      <profile_fields_changed>${arrayToXml(h.profileFieldsChanged || [], "field")}</profile_fields_changed>\n`);
      chunks.push(`      ${xmlTag("previous_username", h.previousUsername || "")}\n`);
      chunks.push(`      ${xmlTag("previous_nickname", h.previousNickname || "")}\n`);
      chunks.push(`      ${xmlTag("previous_bio", h.previousBio || "")}\n`);
      chunks.push(`      ${xmlTag("previous_location", h.previousLocation || "")}\n`);
      chunks.push(`      ${xmlTag("previous_image_url", h.previousImageUrl || "")}\n`);
      chunks.push(`      ${xmlTag("image_change", h.imageChange || "")}\n`);
      chunks.push(`      ${xmlJsonTag("delta", h.delta)}\n`);
      chunks.push("    </history_entry>\n");
    }
    chunks.push("  </social_account_history>\n");

    chunks.push("  <historical_account_summaries>\n");
    for (const hs of allHistoricalSummaries) {
      chunks.push("    <historical_account_summary>\n");
      chunks.push(`      ${xmlTag("id", hs.id)}\n`);
      chunks.push(`      ${xmlTag("social_account_id", hs.socialAccountId)}\n`);
      chunks.push(`      ${xmlJsonTag("content", hs.content)}\n`);
      chunks.push(`      ${xmlTag("model", hs.model || "")}\n`);
      chunks.push(`      ${xmlTag("created_at", hs.createdAt)}\n`);
      chunks.push(`      ${xmlTag("invalidated_at", hs.invalidatedAt)}\n`);
      chunks.push(`      ${xmlTag("replaced_at", hs.replacedAt)}\n`);
      chunks.push("    </historical_account_summary>\n");
    }
    chunks.push("  </historical_account_summaries>\n");

    chunks.push("  <social_network_snapshots>\n");
    for (const account of allSocialAccounts) {
      const snapFollowers = followersMap.get(account.id) || [];
      const snapFollowing = followingMap.get(account.id) || [];
      if (snapFollowers.length === 0 && snapFollowing.length === 0) continue;
      chunks.push("    <social_network_snapshot>\n");
      chunks.push(`      ${xmlTag("id", account.id)}\n`);
      chunks.push(`      ${xmlTag("social_account_id", account.id)}\n`);
      chunks.push(`      ${xmlTag("follower_count", snapFollowers.length)}\n`);
      chunks.push(`      ${xmlTag("following_count", snapFollowing.length)}\n`);
      chunks.push(`      <followers>${arrayToXml(snapFollowers, "account_id")}</followers>\n`);
      chunks.push(`      <following>${arrayToXml(snapFollowing, "account_id")}</following>\n`);
      chunks.push(`      ${xmlTag("captured_at", new Date())}\n`);
      chunks.push("    </social_network_snapshot>\n");
    }
    chunks.push("  </social_network_snapshots>\n");

    chunks.push("  <social_network_changes>\n");
    for (const change of allNetworkChanges) {
      chunks.push("    <social_network_change>\n");
      chunks.push(`      ${xmlTag("id", change.id)}\n`);
      chunks.push(`      ${xmlTag("social_account_id", change.socialAccountId)}\n`);
      chunks.push(`      ${xmlTag("change_type", change.changeType)}\n`);
      chunks.push(`      ${xmlTag("direction", change.direction)}\n`);
      chunks.push(`      ${xmlTag("target_account_id", change.targetAccountId)}\n`);
      chunks.push(`      ${xmlTag("detected_at", change.detectedAt)}\n`);
      chunks.push(`      ${xmlTag("batch_id", change.batchId || "")}\n`);
      chunks.push("    </social_network_change>\n");
    }
    chunks.push("  </social_network_changes>\n");
  }

  chunks.push("</crm_data>");
}

/** Writes to `<filePath>.partial` and renames on success, so a failed export never leaves a truncated .xml behind. */
export async function writeExportXmlToFile(
  filePath: string,
  options: {
    includeHistory?: boolean;
    includePostHistory?: boolean;
    onProgress?: (progress: number, message: string) => Promise<void> | void;
  }
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const partialPath = `${filePath}.partial`;
  const fd = fs.openSync(partialPath, "w");
  try {
    const writer = new XmlFileWriter(fd);
    await generateExportXml(writer, options);
    await options.onProgress?.(99, "Saving file…");
    writer.flush();
  } catch (err) {
    fs.closeSync(fd);
    await fs.promises.unlink(partialPath).catch(() => {});
    throw err;
  }
  fs.closeSync(fd);
  await fs.promises.rename(partialPath, filePath);
}

async function processExportXmlTask(taskId: string, payload: {
  includeHistory?: boolean;
  includePostHistory?: boolean;
  filename?: string;
  auto?: boolean;
}): Promise<string> {
  const backupsDir = path.join(process.cwd(), "backups");
  const nowStr = new Date().toISOString().replace(/[:.]/g, "-");
  let fileName = payload.filename
    ? (payload.filename.endsWith(".xml") ? payload.filename : `${payload.filename}.xml`)
    : `crm-backup-${nowStr}.xml`;

  // Sanitize filename to avoid path traversal
  fileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!fileName.endsWith(".xml")) fileName += ".xml";
  // Never overwrite an existing backup with a custom name
  if (fs.existsSync(path.join(backupsDir, fileName))) {
    fileName = `${fileName.replace(/\.xml$/, "")}-${Date.now()}.xml`;
  }

  const filePath = path.join(backupsDir, fileName);
  await writeExportXmlToFile(filePath, {
    includeHistory: payload.includeHistory ?? false,
    includePostHistory: payload.includePostHistory ?? true,
    onProgress: (progress, message) => storage.updateTaskProgress(taskId, progress, message),
  });
  if (payload.auto) await pruneAutoBackups();

  return `backups/${fileName}`;
}

// ── Import XML Engine ────────────────────────────────────────────────────────

export async function executeImportXml(
  xml: Buffer,
  options?: {
    includeHistory?: boolean;
    includePostHistory?: boolean;
    onProgress?: (progress: number, message: string) => Promise<void> | void;
  }
): Promise<{ imported: Record<string, number>; skipped: Record<string, number> }> {
  const includeHistory = options?.includeHistory ?? true;
  const includePostHistory = options?.includePostHistory ?? true;
  const onProgress = options?.onProgress;
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

  const mePersonId = await storage.getMePersonId();

  const replaceZeroUUID = (uuid: string): string => {
    if (!mePersonId) return uuid;
    return uuid === ZERO_UUID ? mePersonId : uuid;
  };

  const importedCounts: Record<string, number> = {
    relationshipTypes: 0,
    interactionTypes: 0,
    people: 0,
    relationships: 0,
    groups: 0,
    subGroups: 0,
    interactions: 0,
    notes: 0,
    groupNotes: 0,
    schooling: 0,
    socialAccounts: 0,
    socialAccountTypes: 0,
    socialFollows: 0,
    posts: 0,
    postComments: 0,
    messages: 0,
    conversations: 0,
    messageRecipients: 0,
    conversationParticipants: 0,
    networkChanges: 0,
    socialAccountHistory: 0,
    historicalAccountSummaries: 0,
    photos: 0,
    faces: 0,
    facePairDismissals: 0,
    imageQuestions: 0,
    lineages: 0,
    partnerships: 0,
    dailyNotes: 0,
    dailyNoteEvents: 0,
    dailyNoteInvolvedParties: 0,
    dailyNoteAuditLogs: 0,
    sexGuessQueue: 0,
    aiProviders: 0,
    aiChats: 0,
    appSettings: 0,
    truePersonSearch: 0,
    pendingSocialAccountImports: 0,
    insights: 0,
    osintScans: 0,
    storyImporters: 0,
    storyScrapeRuns: 0,
    trackingJobs: 0,
    socialAccountIssues: 0,
    geocodes: 0,
    personAddresses: 0,
    ssoConfig: 0,
  };
  const skippedCounts: Record<string, number> = {
    relationshipTypes: 0,
    interactionTypes: 0,
    people: 0,
    relationships: 0,
    interactions: 0,
    socialAccounts: 0,
    socialAccountTypes: 0,
    messages: 0,
  };

  await onProgress?.(5, "Loading existing data…");

  const [
    allUsers,
    existingRelationshipTypes,
    existingInteractionTypes,
    existingPeople,
    existingGroups,
    existingRelationships,
    existingInteractions,
    existingSocialAccounts,
    existingSocialAccountTypes,
  ] = await Promise.all([
    storage.getAllUsers(),
    storage.getAllRelationshipTypes(),
    storage.getAllInteractionTypes(),
    storage.getAllPeople(),
    storage.getAllGroups(),
    storage.getAllRelationships(),
    storage.getAllInteractions(),
    storage.getAllSocialAccounts(),
    storage.getAllSocialAccountTypes(),
  ]);

  const existingRelationshipTypeUuids = new Set(existingRelationshipTypes.map(t => t.id));
  const existingInteractionTypeUuids = new Set(existingInteractionTypes.map(t => t.id));
  const existingRelationshipUuids = new Set(existingRelationships.map(r => r.id));
  const existingInteractionUuids = new Set(existingInteractions.map(i => i.id));
  const existingSocialAccountTypeUuids = new Set(existingSocialAccountTypes.map(t => t.id));
  const existingPersonIds = new Set(existingPeople.map(p => p.id));
  const existingGroupIds = new Set(existingGroups.map(g => g.id));

  // Build O(1) lookup maps for existing social accounts
  const existingAccountById = new Map<string, typeof existingSocialAccounts[number]>();
  const existingAccountByTypeAndUsername = new Map<string, typeof existingSocialAccounts[number]>();
  const existingSocialAccountUuids = new Set<string>();
  for (const s of existingSocialAccounts) {
    existingAccountById.set(s.id, s);
    existingAccountByTypeAndUsername.set(`${s.typeId || ""}:${s.username.toLowerCase()}`, s);
    existingSocialAccountUuids.add(s.id);
  }

  // Pre-scan social_accounts section so socialAccountIdMap is ready before importing photos, people, and groups
  const socialAccountBlocks = Array.from(sectionEntries(xml, "social_accounts", "social_account"));
  const socialAccountIdMap = new Map<string, string>();
  for (const block of socialAccountBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const username = unescapeXml(parseXmlTag("username", block));
    const typeId = unescapeXml(parseXmlTag("type_id", block));
    if (!id) continue;
    const existing =
      existingAccountById.get(id) ||
      (username ? existingAccountByTypeAndUsername.get(`${typeId || ""}:${username.toLowerCase()}`) : undefined);
    if (existing) {
      socialAccountIdMap.set(id, existing.id);
    } else {
      socialAccountIdMap.set(id, id);
    }
  }

  const mapSocialAccountId = (id: string | null | undefined): string => {
    if (!id) return "";
    return socialAccountIdMap.get(id) || id;
  };

  const mapPrmLocationImport = (loc: string | null): string => {
    if (!loc) return "";
    let out = loc;
    if (mePersonId && out.includes(ZERO_UUID)) {
      out = out.replace(ZERO_UUID, mePersonId);
    }
    return out;
  };

  // ── User profile & SSO config ──
  const userProfileSection = extractSection(xml, "user_profile");
  const currentUser = allUsers[0];
  if (userProfileSection && currentUser) {
    const importedNickname = parseOptStr(userProfileSection, "nickname");
    const importedSsoEmail = parseOptStr(userProfileSection, "sso_email");
    const userUpdates: Record<string, any> = {};
    if (importedNickname && !currentUser.nickname) userUpdates.nickname = importedNickname;
    if (importedSsoEmail && !currentUser.ssoEmail) userUpdates.ssoEmail = importedSsoEmail;
    if (Object.keys(userUpdates).length > 0) {
      try {
        await db.update(users).set(userUpdates).where(eq(users.id, currentUser.id));
      } catch (e) {
        console.error("Error updating user_profile fields:", e);
      }
    }
  }

  if (currentUser) {
    for (const block of sectionEntries(xml, "sso_config", "sso_config_entry")) {
      const id = parseOptStr(block, "id");
      if (!id) continue;
      try {
        await db.insert(ssoConfig).values({
          id,
          userId: currentUser.id,
          enabled: parseOptInt(block, "enabled") ?? (parseOptBool(block, "enabled", false) ? 1 : 0),
          autoSso: parseOptInt(block, "auto_sso") ?? (parseOptBool(block, "auto_sso", false) ? 1 : 0),
          clientId: parseOptStr(block, "client_id") ?? "",
          clientSecret: parseOptStr(block, "client_secret") ?? "",
          authUrl: parseOptStr(block, "auth_url") ?? "",
          tokenUrl: parseOptStr(block, "token_url") ?? "",
          userInfoUrl: parseOptStr(block, "user_info_url") ?? "",
          redirectUrl: parseOptStr(block, "redirect_url") ?? "",
          logoutUrl: parseOptStr(block, "logout_url"),
          userIdentifier: parseOptStr(block, "user_identifier") || "email",
          scopes: parseOptStr(block, "scopes") || "openid profile email",
          authStyle: parseOptStr(block, "auth_style") || "auto",
          createdAt: parseOptDate(block, "created_at") ?? new Date(),
          updatedAt: parseOptDate(block, "updated_at") ?? new Date(),
        }).onConflictDoNothing();
        importedCounts.ssoConfig++;
      } catch (e) {
        console.error(`Error importing sso_config ${id}:`, e);
      }
    }
  }

  await onProgress?.(10, "Importing relationship & interaction types…");

  // ── Relationship types ──
  for (const block of sectionEntries(xml, "relationship_types", "relationship_type")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const notesVal = parseOptStr(block, "notes");
    const value = parseOptInt(block, "value") ?? 50;
    const createdAt = parseOptDate(block, "created_at") ?? new Date();
    if (!id || !name) continue;
    if (existingRelationshipTypeUuids.has(id)) {
      skippedCounts.relationshipTypes++;
      continue;
    }
    try {
      await db.insert(relationshipTypes).values({
        id,
        name,
        color,
        notes: notesVal,
        value,
        createdAt,
      }).onConflictDoNothing();
      importedCounts.relationshipTypes++;
      existingRelationshipTypeUuids.add(id);
    } catch (e) {
      console.error(`Error importing relationship type ${id}:`, e);
    }
  }

  // ── Interaction types ──
  for (const block of sectionEntries(xml, "interaction_types", "interaction_type")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const description = parseOptStr(block, "description");
    const value = parseOptInt(block, "value") ?? 50;
    const createdAt = parseOptDate(block, "created_at") ?? new Date();
    if (!id || !name) continue;
    if (existingInteractionTypeUuids.has(id)) {
      skippedCounts.interactionTypes++;
      continue;
    }
    try {
      await db.insert(interactionTypes).values({
        id,
        name,
        color,
        description,
        value,
        createdAt,
      }).onConflictDoNothing();
      importedCounts.interactionTypes++;
      existingInteractionTypeUuids.add(id);
    } catch (e) {
      console.error(`Error importing interaction type ${id}:`, e);
    }
  }

  // ── Social account types (import early so social accounts can reference them) ──
  for (const block of sectionEntries(xml, "social_account_types", "social_account_type")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const createdAt = parseOptDate(block, "created_at") ?? new Date();
    if (!id || !name) continue;
    if (existingSocialAccountTypeUuids.has(id)) {
      skippedCounts.socialAccountTypes++;
      continue;
    }
    try {
      await db.insert(socialAccountTypes).values({
        id,
        name,
        color,
        createdAt,
      }).onConflictDoNothing();
      importedCounts.socialAccountTypes++;
      existingSocialAccountTypeUuids.add(id);
    } catch (e) {
      console.error(`Error importing social account type ${id}:`, e);
    }
  }

  // ── Photos (import early so entity imageUuid references resolve) ──
  const existingPhotoIds = new Set(
    (await db.select({ id: photos.id }).from(photos)).map(p => p.id)
  );
  const photoBatch: (typeof photos.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "photos", "photo_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const location = unescapeXml(parseXmlTag("location", block));
    if (!id || !location) continue;
    if (existingPhotoIds.has(id)) continue;

    photoBatch.push({
      id,
      location,
      uploadedAt: parseOptDate(block, "uploaded_at") ?? new Date(),
      isSubImage: parseOptBool(block, "is_sub_image", false),
      processedAt: parseOptDate(block, "processed_at"),
      imageDescriptionAt: parseOptDate(block, "image_description_at"),
      imageDescription: parseOptStr(block, "image_description"),
      faceIdAt: parseOptDate(block, "face_id_at"),
      faceUuids: parseOptJson<string[] | null>(block, "face_uuids", null),
      facialIds: parseOptJson<string[] | null>(block, "facial_ids", null),
      ocrAt: parseOptDate(block, "ocr_at"),
      ocrData: parseOptJson<any>(block, "ocr_data", null),
      prmLocation: mapPrmLocationImport(unescapeXml(parseXmlTag("prm_location", block))),
      metadata: parseOptJson<any>(block, "metadata", null),
      ogMetadata: parseOptJson<any>(block, "og_metadata", null),
      fileHash: parseOptStr(block, "file_hash"),
      widthPx: parseOptInt(block, "width_px"),
      heightPx: parseOptInt(block, "height_px"),
      perceptualHash: parseOptStr(block, "perceptual_hash"),
    });
    existingPhotoIds.add(id);
  }
  importedCounts.photos += await insertBatchWithFallback(photos, photoBatch, "photos");

  await onProgress?.(20, "Importing people…");

  // ── People ──
  const existingPeopleMap = new Map<string, boolean>();
  for (const p of existingPeople) {
    existingPeopleMap.set(`${p.firstName.toLowerCase()}:${p.id}`, true);
  }
  const peopleBatch: (typeof people.$inferInsert)[] = [];
  // Backups made before address history keep the primary in <person><address>.
  const legacyAddresses: (typeof personAddresses.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "people", "person")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const firstName = unescapeXml(parseXmlTag("first_name", block));
    const lastName = unescapeXml(parseXmlTag("last_name", block));
    if (!id || !firstName) continue;
    const lookupKey = `${firstName.toLowerCase()}:${id}`;
    if (existingPeopleMap.has(lookupKey) || existingPersonIds.has(id)) {
      skippedCounts.people++;
      continue;
    }

    const tags = parseXmlArray("tags", "tag", block);
    const rawSocialUuids = parseXmlArray("social_account_uuids", "social_account_uuid", block);
    const mappedSocialUuids = rawSocialUuids.map(u => mapSocialAccountId(u)).filter(Boolean);
    const eloRankableRaw = parseXmlTag("elo_rankable", block);

    peopleBatch.push({
      id,
      firstName,
      lastName,
      email: parseOptStr(block, "email"),
      phone: parseOptStr(block, "phone"),
      company: parseOptStr(block, "company"),
      title: parseOptStr(block, "title"),
      tags: tags.length > 0 ? tags : [],
      imageUrl: parseOptStr(block, "image_url"),
      socialAccountUuids: mappedSocialUuids.length > 0 ? mappedSocialUuids : [],
      isStarred: parseOptInt(block, "is_starred") ?? 0,
      eloScore: parseOptInt(block, "elo_score") ?? 1200,
      noSocialMedia: parseOptInt(block, "no_social_media") ?? 0,
      sex: parseOptStr(block, "sex") || "unknown",
      eloRankable: eloRankableRaw !== "" ? (parseInt(eloRankableRaw, 10) || 0) : 1,
      personfaceUuid: parseOptStr(block, "personface_uuid"),
      maidenName: parseOptStr(block, "maiden_name"),
      nickname: parseOptStr(block, "nickname"),
      jobs: parseOptJson<any[]>(block, "jobs", []),
      tpsId: parseOptStr(block, "tps_id"),
      birthday: parseOptStr(block, "birthday"),
      additionalEmails: parseOptJson<any[]>(block, "additional_emails", []),
      additionalPhones: parseOptJson<any[]>(block, "additional_phones", []),
      osintRuns: parseOptJson<any>(block, "osint_runs", null),
      deniedRecommendations: parseOptJson<string[]>(block, "denied_recommendations", []),
      lastDescribedAt: parseOptDate(block, "last_described_at"),
      politicalLeftRight: parseOptFloat(block, "political_left_right"),
      politicalLibAuth: parseOptFloat(block, "political_lib_auth"),
      politicalUpdatedAt: parseOptDate(block, "political_updated_at"),
      aiBackendNotes: parseOptJson<AiBackendNote[]>(block, "ai_backend_notes", []),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
    const legacyAddress = parseOptStr(block, "address")?.trim();
    if (legacyAddress) legacyAddresses.push({ personId: id, address: legacyAddress, isPrimary: 1, source: "legacy" });
    existingPeopleMap.set(lookupKey, true);
    existingPersonIds.add(id);
  }
  importedCounts.people += await insertBatchWithFallback(people, peopleBatch, "people");

  await onProgress?.(30, "Importing groups…");

  // ── Groups (defer centerAccountId if socialAccount not yet in DB to break FK cycle) ──
  const deferredGroupCenterAccounts: { groupId: string; centerAccountId: string }[] = [];
  const groupsBatch: (typeof groups.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "groups", "group")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    if (!id || !name || !color) continue;
    if (existingGroupIds.has(id)) continue;

    const type = parseXmlArray("type", "group_type", block);
    const members = parseXmlArray("members", "member_id", block).map(m => replaceZeroUUID(m));
    const crowdMode = parseOptStr(block, "crowd_mode") || "social_accounts";
    let crowdMembers = parseXmlArray("crowd_members", "crowd_member_id", block);
    if (crowdMembers.length === 0) {
      crowdMembers = parseOptJson<string[]>(block, "crowd_members", []);
    }
    const processedCrowdMembers = crowdMembers.map(cm =>
      crowdMode === "person_profiles" ? replaceZeroUUID(cm) : mapSocialAccountId(cm)
    );

    const rawCenterAccountId = parseOptStr(block, "center_account_id");
    const mappedCenterAccountId = rawCenterAccountId ? mapSocialAccountId(rawCenterAccountId) : null;
    const canSetCenterImmediately = mappedCenterAccountId && existingAccountById.has(mappedCenterAccountId);
    if (mappedCenterAccountId && !canSetCenterImmediately) {
      deferredGroupCenterAccounts.push({ groupId: id, centerAccountId: mappedCenterAccountId });
    }

    groupsBatch.push({
      id,
      name,
      color,
      type: type.length > 0 ? type : [],
      members: members.length > 0 ? members : [],
      imageUrl: parseOptStr(block, "image_url"),
      centerAccountId: canSetCenterImmediately ? mappedCenterAccountId : null,
      crowdMembers: processedCrowdMembers,
      crowdLastCalculatedAt: parseOptDate(block, "crowd_last_calculated_at"),
      crowdMode,
      crowdFollowThreshold: parseOptInt(block, "crowd_follow_threshold") ?? 5,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
    existingGroupIds.add(id);
  }
  importedCounts.groups += await insertBatchWithFallback(groups, groupsBatch, "groups");

  // ── Sub-groups ──
  const subGroupsBatch: (typeof subGroups.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "sub_groups", "sub_group_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const groupId = unescapeXml(parseXmlTag("group_id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    if (!id || !groupId || !name || !color || !existingGroupIds.has(groupId)) continue;
    const members = parseXmlArray("members", "member_id", block).map(m => replaceZeroUUID(m));
    subGroupsBatch.push({
      id,
      groupId,
      name,
      color,
      members,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.subGroups += await insertBatchWithFallback(subGroups, subGroupsBatch, "sub_groups");

  await onProgress?.(40, "Importing social accounts…");

  // ── Social accounts (single-step insert with all columns) ──
  const pendingFollowEdges: { followerId: string; followedId: string; detectedAt?: Date; source?: string }[] = [];
  const collectFollowEdges = (accountId: string, followerIds: string[], followingIds: string[]) => {
    for (const f of followerIds) {
      if (f) pendingFollowEdges.push({ followerId: f, followedId: accountId });
    }
    for (const g of followingIds) {
      if (g) pendingFollowEdges.push({ followerId: accountId, followedId: g });
    }
  };

  const socialAccountsBatch: (typeof socialAccounts.$inferInsert)[] = [];
  for (const block of socialAccountBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const username = unescapeXml(parseXmlTag("username", block));
    if (!id || !username) continue;

    const typeIdRaw = parseOptStr(block, "type_id");
    const typeId = typeIdRaw && existingSocialAccountTypeUuids.has(typeIdRaw) ? typeIdRaw : null;
    const following = parseXmlArray("following", "account_id", block);
    const followers = parseXmlArray("followers", "account_id", block);

    const existing =
      existingAccountById.get(id) ||
      existingAccountByTypeAndUsername.get(`${typeIdRaw || ""}:${username.toLowerCase()}`);
    if (existing) {
      skippedCounts.socialAccounts++;
      socialAccountIdMap.set(id, existing.id);
      existingSocialAccountUuids.add(existing.id);
      collectFollowEdges(id, followers, following);
      continue;
    }

    const ownerUuidRaw = replaceZeroUUID(unescapeXml(parseXmlTag("owner_uuid", block)));
    const ownerUuid = ownerUuidRaw && existingPersonIds.has(ownerUuidRaw) ? ownerUuidRaw : null;
    const groupIdRaw = parseOptStr(block, "group_id");
    const groupId = groupIdRaw && existingGroupIds.has(groupIdRaw) ? groupIdRaw : null;

    socialAccountsBatch.push({
      id,
      username,
      ownerUuid,
      groupId,
      typeId,
      internalAccountCreationDate: parseOptDate(block, "internal_account_creation_date") ?? new Date(),
      internalAccountCreationType: parseOptStr(block, "internal_account_creation_type") || "Import",
      lastScrapedAt: parseOptDate(block, "last_scraped_at"),
      nickname: parseOptStr(block, "nickname"),
      bio: parseOptStr(block, "bio"),
      accountUrl: parseOptStr(block, "account_url"),
      imageUrl: parseOptStr(block, "image_url"),
      isHqImage: parseOptBool(block, "is_hq_image", false),
      externalImageUrl: parseOptStr(block, "external_image_url"),
      location: parseOptStr(block, "location"),
      followersCount: parseOptInt(block, "followers_count") ?? 0,
      followingCount: parseOptInt(block, "following_count") ?? 0,
      reportedFollowersCount: parseOptInt(block, "reported_followers_count"),
      reportedFollowingCount: parseOptInt(block, "reported_following_count"),
      currentPosts: parseOptStr(block, "current_posts"),
      deletedPosts: parseOptStr(block, "deleted_posts"),
      isSimple: parseOptBool(block, "is_simple", true),
      interestLevel: parseOptStr(block, "interest_level") || "none",
      interestLevelManual: parseOptBool(block, "interest_level_manual", false),
      // Backups from before scans carry per-kind cadences; their info ones stand in.
      scanEveryDays: parseOptInt(block, "scan_every_days") ?? parseOptInt(block, "info_every_days"),
      scanCheckedAt: parseOptDate(block, "scan_checked_at"),
      scanDueAt: parseOptDate(block, "scan_due_at") ?? parseOptDate(block, "info_due_at"),
      infoCheckedAt: parseOptDate(block, "info_checked_at"),
      followsCheckedAt: parseOptDate(block, "follows_checked_at"),
      postsCheckedAt: parseOptDate(block, "posts_checked_at"),
      taggedCheckedAt: parseOptDate(block, "tagged_checked_at"),
      highlightsCheckedAt: parseOptDate(block, "highlights_checked_at"),
      joinedAt: parseOptDate(block, "joined_at"),
      reportedPostsCount: parseOptInt(block, "reported_posts_count"),
      isPrivate: parseXmlTag("is_private", block) !== "" ? parseOptBool(block, "is_private", false) : null,
      personfaceUuid: parseOptStr(block, "personface_uuid"),
      noFace: parseOptBool(block, "no_face", false),
      bannedActions: parseOptJson<string[]>(block, "banned_actions", []),
      skipStories: parseOptBool(block, "skip_stories", false),
      isStarred: parseOptBool(block, "is_starred", false),
      aiSummary: parseOptJson<any>(block, "ai_summary", null),
      aiSummaryGeneratedAt: parseOptDate(block, "ai_summary_generated_at"),
      aiSummaryInvalidated: parseOptBool(block, "ai_summary_invalidated", false),
      aiSummaryInvalidatedAt: parseOptDate(block, "ai_summary_invalidated_at"),
      aiSummaryModel: parseOptStr(block, "ai_summary_model"),
      aiBackendNotes: parseOptJson<AiBackendNote[]>(block, "ai_backend_notes", []),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });

    socialAccountIdMap.set(id, id);
    existingSocialAccountUuids.add(id);
    collectFollowEdges(id, followers, following);
  }
  importedCounts.socialAccounts += await insertBatchWithFallback(socialAccounts, socialAccountsBatch, "social_accounts");

  // Resolve deferred group centerAccountId references now that socialAccounts exist
  for (const def of deferredGroupCenterAccounts) {
    if (existingSocialAccountUuids.has(def.centerAccountId)) {
      try {
        await db.update(groups).set({ centerAccountId: def.centerAccountId }).where(eq(groups.id, def.groupId));
      } catch (e) {
        console.error(`Error updating deferred centerAccountId for group ${def.groupId}:`, e);
      }
    }
  }

  await onProgress?.(50, "Importing relationships, interactions & notes…");

  // ── Relationships ──
  const relationshipsBatch: (typeof relationships.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "relationships", "relationship")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const fromPersonId = replaceZeroUUID(unescapeXml(parseXmlTag("from_person_id", block)));
    const toPersonId = replaceZeroUUID(unescapeXml(parseXmlTag("to_person_id", block)));
    const typeIdRaw = parseOptStr(block, "type_id");
    const typeId = typeIdRaw && existingRelationshipTypeUuids.has(typeIdRaw) ? typeIdRaw : null;
    if (!id || !fromPersonId || !toPersonId) continue;
    if (existingRelationshipUuids.has(id)) {
      skippedCounts.relationships++;
      continue;
    }
    if (!existingPersonIds.has(fromPersonId) || !existingPersonIds.has(toPersonId)) continue;

    relationshipsBatch.push({
      id,
      fromPersonId,
      toPersonId,
      typeId,
      notes: parseOptStr(block, "notes"),
      familyRelationshipType: (parseOptStr(block, "family_relationship_type") || null) as any,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
    existingRelationshipUuids.add(id);
  }
  importedCounts.relationships += await insertBatchWithFallback(relationships, relationshipsBatch, "relationships");

  // ── Lineages ──
  const lineagesBatch: (typeof lineage.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "lineages", "lineage_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const childId = replaceZeroUUID(unescapeXml(parseXmlTag("child_id", block)));
    const parentId = replaceZeroUUID(unescapeXml(parseXmlTag("parent_id", block)));
    if (!id || !childId || !parentId) continue;
    if (!existingPersonIds.has(childId) || !existingPersonIds.has(parentId)) continue;
    lineagesBatch.push({
      id,
      childId,
      parentId,
      lineageType: parseOptStr(block, "lineage_type") || "biological",
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.lineages += await insertBatchWithFallback(lineage, lineagesBatch, "lineages");

  // ── Partnerships ──
  const partnershipsBatch: (typeof partnerships.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "partnerships", "partnership_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const person1Id = replaceZeroUUID(unescapeXml(parseXmlTag("person1_id", block)));
    const person2Id = replaceZeroUUID(unescapeXml(parseXmlTag("person2_id", block)));
    if (!id || !person1Id || !person2Id) continue;
    if (!existingPersonIds.has(person1Id) || !existingPersonIds.has(person2Id)) continue;
    partnershipsBatch.push({
      id,
      person1Id,
      person2Id,
      status: parseOptStr(block, "status") || "partner",
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.partnerships += await insertBatchWithFallback(partnerships, partnershipsBatch, "partnerships");

  // ── Interactions ──
  const interactionsBatch: (typeof interactions.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "interactions", "interaction")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dateVal = parseOptDate(block, "date");
    if (!id || !dateVal) continue;
    if (existingInteractionUuids.has(id)) {
      skippedCounts.interactions++;
      continue;
    }
    const typeIdRaw = parseOptStr(block, "type_id");
    const typeId = typeIdRaw && existingInteractionTypeUuids.has(typeIdRaw) ? typeIdRaw : null;
    const imageUuidRaw = parseOptStr(block, "image_uuid");
    const imageUuid = imageUuidRaw && existingPhotoIds.has(imageUuidRaw) ? imageUuidRaw : null;
    const peopleIds = parseXmlArray("people_ids", "person_id", block).map(p => replaceZeroUUID(p));
    const groupIds = parseXmlArray("group_ids", "group_id", block);

    interactionsBatch.push({
      id,
      typeId,
      title: parseOptStr(block, "title"),
      date: dateVal,
      description: parseOptStr(block, "description"),
      peopleIds: peopleIds.length > 0 ? peopleIds : [],
      groupIds: groupIds.length > 0 ? groupIds : [],
      imageUrl: parseOptStr(block, "image_url"),
      imageUuid,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
    existingInteractionUuids.add(id);
  }
  importedCounts.interactions += await insertBatchWithFallback(interactions, interactionsBatch, "interactions");

  // ── Notes ──
  const notesBatch: (typeof notes.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "notes", "note")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = replaceZeroUUID(unescapeXml(parseXmlTag("person_id", block)));
    const content = unescapeXml(parseXmlTag("content", block));
    if (!id || !personId || !existingPersonIds.has(personId)) continue;
    const imageUuidRaw = parseOptStr(block, "image_uuid");
    const imageUuid = imageUuidRaw && existingPhotoIds.has(imageUuidRaw) ? imageUuidRaw : null;
    notesBatch.push({
      id,
      personId,
      content,
      imageUrl: parseOptStr(block, "image_url"),
      imageUuid,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.notes += await insertBatchWithFallback(notes, notesBatch, "notes");

  // ── Person addresses ──
  const personAddressesBatch: (typeof personAddresses.$inferInsert)[] = xml.includes("<person_addresses>") ? [] : legacyAddresses;
  for (const block of sectionEntries(xml, "person_addresses", "person_address")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = replaceZeroUUID(unescapeXml(parseXmlTag("person_id", block)));
    const address = unescapeXml(parseXmlTag("address", block));
    if (!id || !personId || !address || !existingPersonIds.has(personId)) continue;
    personAddressesBatch.push({
      id,
      personId,
      address,
      label: parseOptStr(block, "label"),
      startDate: parseOptStr(block, "start_date"),
      endDate: parseOptStr(block, "end_date"),
      isPrimary: parseOptInt(block, "is_primary") ?? 0,
      source: parseOptStr(block, "source") || "manual",
      propertyUrl: parseOptStr(block, "property_url"),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.personAddresses += await insertBatchWithFallback(personAddresses, personAddressesBatch, "person_addresses");

  // ── Group notes ──
  const groupNotesBatch: (typeof groupNotes.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "group_notes", "group_note")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const groupId = unescapeXml(parseXmlTag("group_id", block));
    const content = unescapeXml(parseXmlTag("content", block));
    if (!id || !groupId || !existingGroupIds.has(groupId)) continue;
    groupNotesBatch.push({
      id,
      groupId,
      content,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.groupNotes += await insertBatchWithFallback(groupNotes, groupNotesBatch, "group_notes");

  // ── Schooling ──
  const schoolingBatch: (typeof schooling.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "schooling", "schooling_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = replaceZeroUUID(unescapeXml(parseXmlTag("person_id", block)));
    if (!id || !personId || !existingPersonIds.has(personId)) continue;
    schoolingBatch.push({
      id,
      personId,
      highSchool: parseOptStr(block, "high_school"),
      colleges: parseOptJson<any[]>(block, "colleges", []),
      additionalSchooling: parseOptJson<any[]>(block, "additional_schooling", []),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.schooling += await insertBatchWithFallback(schooling, schoolingBatch, "schooling");

  if (includePostHistory) {
    await onProgress?.(60, "Importing posts & comments…");

    const existingPostIds = new Set(
      (await db.select({ id: socialAccountPosts.id }).from(socialAccountPosts)).map(p => p.id)
    );
    const postsBatch: (typeof socialAccountPosts.$inferInsert)[] = [];
    for (const block of sectionEntries(xml, "social_account_posts", "social_account_post")) {
      const id = unescapeXml(parseXmlTag("id", block));
      const postSocialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      if (!id || !postSocialAccountId || existingPostIds.has(id)) continue;

      const mappedAccountId = mapSocialAccountId(postSocialAccountId);
      if (!existingSocialAccountUuids.has(mappedAccountId)) continue;

      const coauthorsRaw = parseOptJson<string[]>(block, "coauthor_account_ids", []);
      const coauthorAccountIds = Array.isArray(coauthorsRaw)
        ? coauthorsRaw.map(cid => mapSocialAccountId(cid)).filter(Boolean)
        : [];

      postsBatch.push({
        id,
        socialAccountId: mappedAccountId,
        coauthorAccountIds,
        postType: parseOptStr(block, "post_type") || "post",
        instagramPk: parseOptStr(block, "instagram_pk"),
        content: parseOptStr(block, "content"),
        description: parseOptStr(block, "description"),
        likeCount: parseOptInt(block, "like_count") ?? 0,
        likesHidden: parseOptBool(block, "likes_hidden", false),
        commentCount: parseOptInt(block, "comment_count") ?? 0,
        mentionedAccounts: parseOptStr(block, "mentioned_accounts"),
        faceIds: parseOptStr(block, "face_ids"),
        isDeleted: parseOptBool(block, "is_deleted", false),
        postedAt: parseOptDate(block, "posted_at"),
        metadata: parseOptJson<any>(block, "metadata", null),
        videoTranscript: parseOptJson<any>(block, "video_transcript", null),
        videoTranscriptAt: parseOptDate(block, "video_transcript_at"),
        scrapedFrom: parseOptStr(block, "scraped_from"),
        aiSummary: parseOptJson<any>(block, "ai_summary", null),
        aiSummaryAt: parseOptDate(block, "ai_summary_at"),
        aiSummaryModel: parseOptStr(block, "ai_summary_model"),
        createdAt: parseOptDate(block, "created_at") ?? new Date(),
        updatedAt: parseOptDate(block, "updated_at") ?? new Date(),
      });
      existingPostIds.add(id);
    }
    importedCounts.posts += await insertBatchWithFallback(socialAccountPosts, postsBatch, "social_account_posts");

    // ── Social post comments ──
    const postCommentsBatch: (typeof socialPostComments.$inferInsert)[] = [];
    for (const block of sectionEntries(xml, "social_post_comments", "social_post_comment")) {
      const id = unescapeXml(parseXmlTag("id", block));
      const postId = unescapeXml(parseXmlTag("post_id", block));
      const instagramCommentId = unescapeXml(parseXmlTag("instagram_comment_id", block));
      const username = unescapeXml(parseXmlTag("username", block));
      const text = unescapeXml(parseXmlTag("text", block));
      if (!id || !postId || !instagramCommentId || !username || !existingPostIds.has(postId)) continue;

      postCommentsBatch.push({
        id,
        postId,
        instagramCommentId,
        username,
        text,
        likeCount: parseOptInt(block, "like_count") ?? 0,
        postedAt: parseOptDate(block, "posted_at"),
        createdAt: parseOptDate(block, "created_at") ?? new Date(),
        updatedAt: parseOptDate(block, "updated_at") ?? new Date(),
      });
    }
    importedCounts.postComments += await insertBatchWithFallback(socialPostComments, postCommentsBatch, "social_post_comments");
  }

  await onProgress?.(70, "Importing daily notes, AI, faces & OSINT…");

  // ── Daily notes ──
  const existingDailyNoteIds = new Set(
    (await db.select({ id: dailyNotes.id }).from(dailyNotes)).map(d => d.id)
  );
  const dailyNotesBatch: (typeof dailyNotes.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "daily_notes", "daily_note_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const date = unescapeXml(parseXmlTag("date", block));
    if (!id || !date) continue;
    dailyNotesBatch.push({
      id,
      date,
      userTitle: parseOptStr(block, "user_title") ?? "",
      body: unescapeXml(parseXmlTag("body", block)),
      status: parseOptStr(block, "status") || "unfinished",
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
      updatedAt: parseOptDate(block, "updated_at"),
    });
    existingDailyNoteIds.add(id);
  }
  importedCounts.dailyNotes += await insertBatchWithFallback(dailyNotes, dailyNotesBatch, "daily_notes");

  // ── Daily note events ──
  const dailyNoteEventsBatch: (typeof dailyNoteEvents.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "daily_note_events", "daily_note_event_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    if (!id || !dailyNoteId || !existingDailyNoteIds.has(dailyNoteId)) continue;
    dailyNoteEventsBatch.push({
      id,
      dailyNoteId,
      text: unescapeXml(parseXmlTag("text", block)),
      position: parseOptInt(block, "position") ?? 0,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.dailyNoteEvents += await insertBatchWithFallback(dailyNoteEvents, dailyNoteEventsBatch, "daily_note_events");

  // ── Daily note involved parties ──
  const involvedPartiesBatch: (typeof dailyNoteInvolvedParties.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "daily_note_involved_parties", "daily_note_involved_party_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    const partyType = unescapeXml(parseXmlTag("party_type", block));
    let refId = unescapeXml(parseXmlTag("ref_id", block));
    if (!id || !dailyNoteId || !partyType || !refId || !existingDailyNoteIds.has(dailyNoteId)) continue;
    if (partyType === "person") refId = replaceZeroUUID(refId);
    else if (partyType === "social_account") refId = mapSocialAccountId(refId);
    involvedPartiesBatch.push({ id, dailyNoteId, partyType, refId });
  }
  importedCounts.dailyNoteInvolvedParties += await insertBatchWithFallback(
    dailyNoteInvolvedParties,
    involvedPartiesBatch,
    "daily_note_involved_parties"
  );

  // ── Daily note audit logs ──
  const auditLogsBatch: (typeof dailyNoteAuditLogs.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "daily_note_audit_logs", "daily_note_audit_log_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    const action = unescapeXml(parseXmlTag("action", block));
    if (!id || !dailyNoteId || !action || !existingDailyNoteIds.has(dailyNoteId)) continue;
    auditLogsBatch.push({
      id,
      dailyNoteId,
      action,
      timestamp: parseOptDate(block, "timestamp") ?? new Date(),
      pinUsed: parseOptBool(block, "pin_used", false),
    });
  }
  importedCounts.dailyNoteAuditLogs += await insertBatchWithFallback(
    dailyNoteAuditLogs,
    auditLogsBatch,
    "daily_note_audit_logs"
  );

  // ── Sex guess records ──
  const sexGuessBatch: (typeof sexGuessQueue.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "sex_guess_records", "sex_guess_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = replaceZeroUUID(unescapeXml(parseXmlTag("person_id", block)));
    const guessedSex = unescapeXml(parseXmlTag("guessed_sex", block));
    const reasoning = unescapeXml(parseXmlTag("reasoning", block));
    if (!id || !personId || !guessedSex || !existingPersonIds.has(personId)) continue;
    sexGuessBatch.push({
      id,
      personId,
      guessedSex,
      reasoning,
      dateAdded: parseOptDate(block, "date_added") ?? new Date(),
      answered: parseOptInt(block, "answered") ?? 0,
      snoozedUntil: parseOptDate(block, "snooze_until"),
    });
  }
  importedCounts.sexGuessQueue += await insertBatchWithFallback(sexGuessQueue, sexGuessBatch, "sex_guess_queue");

  // ── AI Providers (import before ai_chats so providerId FK resolves) ──
  const existingAiProviderIds = new Set(
    (await db.select({ id: aiProviders.id }).from(aiProviders)).map(p => p.id)
  );
  const aiProvidersBatch: (typeof aiProviders.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "ai_providers", "ai_provider")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const kind = unescapeXml(parseXmlTag("kind", block));
    const baseUrl = unescapeXml(parseXmlTag("base_url", block));
    if (!id || !name || !kind || !baseUrl || existingAiProviderIds.has(id)) continue;
    aiProvidersBatch.push({
      id,
      name,
      kind,
      baseUrl,
      authType: parseOptStr(block, "auth_type") || "none",
      username: parseOptStr(block, "username") ?? "",
      secret: parseOptStr(block, "secret") ?? "",
      isDefault: parseOptBool(block, "is_default", false),
      isExternal: parseOptBool(block, "is_external", false),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
    existingAiProviderIds.add(id);
  }
  importedCounts.aiProviders += await insertBatchWithFallback(aiProviders, aiProvidersBatch, "ai_providers");

  // ── AI Chats ──
  const aiChatsBatch: (typeof aiChats.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "ai_chats", "ai_chat_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    if (!id) continue;
    const providerIdRaw = parseOptStr(block, "provider_id");
    const providerId = providerIdRaw && existingAiProviderIds.has(providerIdRaw) ? providerIdRaw : "";
    aiChatsBatch.push({
      id,
      title: parseOptStr(block, "title") || "New chat",
      systemMessage: parseOptStr(block, "system_message") ?? "",
      model: parseOptStr(block, "model") ?? "",
      providerId,
      messages: parseOptJson<any[]>(block, "messages", []),
      agentMode: parseOptBool(block, "agent_mode", false),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
      updatedAt: parseOptDate(block, "updated_at") ?? new Date(),
    });
  }
  importedCounts.aiChats += await insertBatchWithFallback(aiChats, aiChatsBatch, "ai_chats");

  // ── App settings ──
  for (const block of sectionEntries(xml, "app_settings_list", "app_setting_entry")) {
    const key = unescapeXml(parseXmlTag("key", block));
    let value = unescapeXml(parseXmlTag("value", block));
    if (!key) continue;
    if (key === "me_person_id") {
      value = replaceZeroUUID(value);
      // Do not overwrite me_person_id with a UUID that does not exist in people
      if (mePersonId && !existingPersonIds.has(value)) continue;
    }
    try {
      await db.insert(appSettings).values({ key, value })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value },
        });
      importedCounts.appSettings++;
    } catch (e) {
      console.error(`Error importing app setting ${key}:`, e);
    }
  }

  // ── TruePersonSearch ──
  const tpsBatch: (typeof truePersonSearch.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "true_person_search", "true_person_search_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const tpsId = unescapeXml(parseXmlTag("tps_id", block));
    if (!id || !tpsId) continue;
    const personIdRaw = parseOptStr(block, "person_id");
    const resolvedPersonId = personIdRaw ? replaceZeroUUID(personIdRaw) : null;
    const personId = resolvedPersonId && existingPersonIds.has(resolvedPersonId) ? resolvedPersonId : null;
    tpsBatch.push({
      id,
      tpsId,
      personId,
      importDate: parseOptDate(block, "import_date") ?? new Date(),
      fullName: parseOptStr(block, "full_name"),
      akas: parseOptJson<any[]>(block, "akas", []),
      birthday: parseOptStr(block, "birthday"),
      currentAddress: parseOptStr(block, "current_address"),
      currentAddressPropertyDetails: parseOptStr(block, "current_address_property_details"),
      currentAddressPropertyUrl: parseOptStr(block, "current_address_property_url"),
      addresses: parseOptJson<any[]>(block, "addresses", []),
      phoneNumbers: parseOptJson<any[]>(block, "phone_numbers", []),
      emails: parseOptJson<any[]>(block, "emails", []),
      relatives: parseOptJson<any[]>(block, "relatives", []),
      associates: parseOptJson<any[]>(block, "associates", []),
      businessConnections: parseOptJson<any[]>(block, "business_connections", []),
      jobs: parseOptJson<any[]>(block, "jobs", []),
      colleges: parseOptJson<any[]>(block, "colleges", []),
      backgroundProfile: parseOptStr(block, "background_profile"),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
      updatedAt: parseOptDate(block, "updated_at") ?? new Date(),
    });
  }
  importedCounts.truePersonSearch += await insertBatchWithFallback(truePersonSearch, tpsBatch, "true_person_search");

  // ── Faces ──
  const facesBatch: (typeof faces.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "faces", "face_entry")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const s3Url = unescapeXml(parseXmlTag("s3_url", block));
    if (!id || !s3Url) continue;
    const photoIdRaw = parseOptStr(block, "photo_id");
    const photoId = photoIdRaw && existingPhotoIds.has(photoIdRaw) ? photoIdRaw : null;
    facesBatch.push({
      id,
      photoId,
      s3Url,
      embedding: parseOptJson<number[]>(block, "embedding", []),
      personfaceUuid: parseOptStr(block, "personface_uuid"),
      detectionConfidence: parseOptStr(block, "detection_confidence"),
      coordinates: parseOptJson<any>(block, "coordinates", null),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
      dismissedAt: parseOptDate(block, "dismissed_at"),
      pitch: parseOptFloat(block, "pitch"),
      roll: parseOptFloat(block, "roll"),
      sharpness: parseOptFloat(block, "sharpness"),
      yaw: parseOptFloat(block, "yaw"),
      autoMatchScore: parseOptFloat(block, "auto_match_score"),
    });
  }
  importedCounts.faces += await insertBatchWithFallback(faces, facesBatch, "faces");

  // ── Face pair dismissals ──
  const faceDismissalsBatch: (typeof facePairDismissals.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "face_pair_dismissals", "face_pair_dismissal")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const groupAUuid = unescapeXml(parseXmlTag("group_a_uuid", block));
    const groupBUuid = unescapeXml(parseXmlTag("group_b_uuid", block));
    if (!id || !groupAUuid || !groupBUuid) continue;
    faceDismissalsBatch.push({
      id,
      groupAUuid,
      groupBUuid,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
  }
  importedCounts.facePairDismissals += await insertBatchWithFallback(
    facePairDismissals,
    faceDismissalsBatch,
    "face_pair_dismissals"
  );

  // ── Image questions ──
  const imageQuestionsBatch: (typeof imageQuestions.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "image_questions", "image_question")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const photoId = unescapeXml(parseXmlTag("photo_id", block));
    const subImageUrl = unescapeXml(parseXmlTag("sub_image_url", block));
    if (!id || !photoId || !subImageUrl || !existingPhotoIds.has(photoId)) continue;
    const resolvedPersonRaw = parseOptStr(block, "resolved_person_id");
    const mappedPerson = resolvedPersonRaw ? replaceZeroUUID(resolvedPersonRaw) : null;
    const resolvedPersonId = mappedPerson && existingPersonIds.has(mappedPerson) ? mappedPerson : null;
    imageQuestionsBatch.push({
      id,
      photoId,
      faceUuid: parseOptStr(block, "face_uuid") ?? "",
      subImageUrl,
      coordinates: parseOptJson<any>(block, "coordinates", null),
      status: parseOptStr(block, "status") || "pending",
      resolvedAs: parseOptStr(block, "resolved_as"),
      resolvedPersonId,
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
      resolvedAt: parseOptDate(block, "resolved_at"),
    });
  }
  importedCounts.imageQuestions += await insertBatchWithFallback(imageQuestions, imageQuestionsBatch, "image_questions");

  await onProgress?.(78, "Importing OSINT, story importers, messages & geocodes…");

  // ── Pending social account imports ──
  const pendingImportsBatch: (typeof pendingSocialAccountImports.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "pending_social_account_imports", "pending_social_account_import")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const accountUsername = unescapeXml(parseXmlTag("account_username", block));
    if (!id || !accountUsername) continue;
    pendingImportsBatch.push({
      id,
      timestampAdded: parseOptDate(block, "timestamp_added") ?? new Date(),
      timestampImported: parseOptDate(block, "timestamp_imported"),
      alreadyAdded: parseOptBool(block, "already_added", false),
      accountUsername,
      accountDisplayName: parseOptStr(block, "account_display_name"),
      accountBio: parseOptStr(block, "account_bio"),
      accountWebsite: parseOptStr(block, "account_website"),
      accountEmail: parseOptStr(block, "account_email"),
      accountPhone: parseOptStr(block, "account_phone"),
      accountLocationArea: parseOptStr(block, "account_location_area"),
      accountFollowers: parseOptStr(block, "account_followers"),
      accountFollowing: parseOptStr(block, "account_following"),
      accountImageUrl: parseOptStr(block, "account_image_url"),
      accountFollowersCount: parseOptInt(block, "account_followers_count"),
      accountFollowingCount: parseOptInt(block, "account_following_count"),
      importType: parseOptStr(block, "import_type") || "full",
      captureScope: parseOptStr(block, "capture_scope") || "both",
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
      updatedAt: parseOptDate(block, "updated_at") ?? new Date(),
    });
  }
  importedCounts.pendingSocialAccountImports += await insertBatchWithFallback(
    pendingSocialAccountImports,
    pendingImportsBatch,
    "pending_social_account_imports"
  );

  // ── Insights ──
  const insightsBatch: (typeof insights.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "insights", "insight")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const type = unescapeXml(parseXmlTag("type", block));
    const source = unescapeXml(parseXmlTag("source", block));
    const data = parseOptJson<Record<string, unknown> | null>(block, "data", null);
    if (!id || !type || !source || !data) continue;
    const applicablePeopleIds = parseXmlArray("applicable_people_ids", "person_id", block).map(p => replaceZeroUUID(p));
    const applicableSocialAccountIds = parseXmlArray("applicable_social_account_ids", "account_id", block).map(a =>
      mapSocialAccountId(a)
    );
    insightsBatch.push({
      id,
      type,
      source,
      collectedAt: parseOptDate(block, "collected_at") ?? new Date(),
      rawText: parseOptStr(block, "raw_text"),
      data,
      applicablePeopleIds,
      applicableSocialAccountIds,
    });
  }
  importedCounts.insights += await insertBatchWithFallback(insights, insightsBatch, "insights");

  // ── OSINT scans ──
  const osintScansBatch: (typeof osintScans.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "osint_scans", "osint_scan")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const tool = unescapeXml(parseXmlTag("tool", block));
    const target = unescapeXml(parseXmlTag("target", block));
    const targetType = unescapeXml(parseXmlTag("target_type", block));
    if (!id || !tool || !target || !targetType) continue;
    const saRaw = parseOptStr(block, "social_account_id");
    const mappedSa = saRaw ? mapSocialAccountId(saRaw) : null;
    const socialAccountId = mappedSa && existingSocialAccountUuids.has(mappedSa) ? mappedSa : null;
    const personRaw = parseOptStr(block, "person_id");
    const mappedPerson = personRaw ? replaceZeroUUID(personRaw) : null;
    const personId = mappedPerson && existingPersonIds.has(mappedPerson) ? mappedPerson : null;
    osintScansBatch.push({
      id,
      tool,
      target,
      targetType,
      options: parseOptJson<Record<string, unknown>>(block, "options", {}),
      socialAccountId,
      personId,
      status: parseOptStr(block, "status") || "pending",
      attempts: parseOptInt(block, "attempts") ?? 0,
      computeJobId: parseOptStr(block, "compute_job_id"),
      error: parseOptStr(block, "error"),
      result: parseOptJson<any>(block, "result", null),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
      startedAt: parseOptDate(block, "started_at"),
      completedAt: parseOptDate(block, "completed_at"),
    });
  }
  importedCounts.osintScans += await insertBatchWithFallback(osintScans, osintScansBatch, "osint_scans");

  // ── Story importers ──
  const existingStoryImporterIds = new Set(
    (await db.select({ id: storyImporters.id }).from(storyImporters)).map(s => s.id)
  );
  const storyImportersBatch: (typeof storyImporters.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "story_importers", "story_importer")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const label = unescapeXml(parseXmlTag("label", block));
    const serviceUrl = unescapeXml(parseXmlTag("service_url", block));
    const serviceSecret = unescapeXml(parseXmlTag("service_secret", block));
    if (!id || !label || !serviceUrl || !serviceSecret || existingStoryImporterIds.has(id)) continue;
    storyImportersBatch.push({
      id,
      label,
      serviceUrl,
      serviceSecret,
      enabled: parseOptBool(block, "enabled", true),
      runEveryDays: parseOptInt(block, "run_every_days") ?? 1,
      runWindow: parseOptStr(block, "run_window") || "daytime",
      skipDayProbability: parseOptFloat(block, "skip_day_probability") ?? 0.14,
      downloadVideos: parseOptBool(block, "download_videos", true),
      unseenOnly: parseOptBool(block, "unseen_only", false),
      runNowUnseenOnly: parseOptBool(block, "run_now_unseen_only", false),
      nextRunAt: parseOptDate(block, "next_run_at"),
      lastUsername: parseOptStr(block, "last_username"),
      trackingEnabled: parseOptBool(block, "tracking_enabled", false),
      trackingWindow: parseOptStr(block, "tracking_window") || "daytime",
      trackingMaxJobs: parseOptInt(block, "tracking_max_jobs") ?? 5,
      nextTrackingRunAt: parseOptDate(block, "next_tracking_run_at"),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
    existingStoryImporterIds.add(id);
  }
  importedCounts.storyImporters += await insertBatchWithFallback(
    storyImporters,
    storyImportersBatch,
    "story_importers"
  );

  // ── Story scrape runs ──
  const existingStoryScrapeRunIds = new Set(
    (await db.select({ id: storyScrapeRuns.id }).from(storyScrapeRuns)).map(r => r.id)
  );
  const storyScrapeRunsBatch: (typeof storyScrapeRuns.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "story_scrape_runs", "story_scrape_run")) {
    const id = unescapeXml(parseXmlTag("id", block));
    if (!id || existingStoryScrapeRunIds.has(id)) continue;
    const importerIdRaw = parseOptStr(block, "importer_id");
    const importerId = importerIdRaw && existingStoryImporterIds.has(importerIdRaw) ? importerIdRaw : null;
    storyScrapeRunsBatch.push({
      id,
      importerId,
      kind: parseOptStr(block, "kind") || "stories",
      status: parseOptStr(block, "status") || "running",
      startedAt: parseOptDate(block, "started_at") ?? new Date(),
      finishedAt: parseOptDate(block, "finished_at"),
      counts: parseOptJson<any>(block, "counts", null),
      items: parseOptJson<any>(block, "items", null),
      error: parseOptStr(block, "error"),
      scrapedFrom: parseOptStr(block, "scraped_from"),
      tokenHash: parseOptStr(block, "token_hash"),
      tokenExpiresAt: parseOptDate(block, "token_expires_at"),
    });
    existingStoryScrapeRunIds.add(id);
  }
  importedCounts.storyScrapeRuns += await insertBatchWithFallback(
    storyScrapeRuns,
    storyScrapeRunsBatch,
    "story_scrape_runs"
  );

  // ── Tracking jobs ──
  const trackingJobsBatch: (typeof trackingJobs.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "tracking_jobs", "tracking_job")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const saRaw = unescapeXml(parseXmlTag("social_account_id", block));
    const kind = unescapeXml(parseXmlTag("kind", block));
    const origin = unescapeXml(parseXmlTag("origin", block));
    if (!id || !saRaw || !kind || !origin) continue;
    const socialAccountId = mapSocialAccountId(saRaw);
    if (!existingSocialAccountUuids.has(socialAccountId)) continue;
    const importerIdRaw = parseOptStr(block, "importer_id");
    const importerId = importerIdRaw && existingStoryImporterIds.has(importerIdRaw) ? importerIdRaw : null;
    const runIdRaw = parseOptStr(block, "run_id");
    const runId = runIdRaw && existingStoryScrapeRunIds.has(runIdRaw) ? runIdRaw : null;
    trackingJobsBatch.push({
      id,
      socialAccountId,
      kind,
      origin,
      status: parseOptStr(block, "status") || "queued",
      importerId,
      runId,
      batchId: parseOptStr(block, "batch_id"),
      attempts: parseOptInt(block, "attempts") ?? 0,
      result: parseOptJson<any>(block, "result", null),
      error: parseOptStr(block, "error"),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
      startedAt: parseOptDate(block, "started_at"),
      finishedAt: parseOptDate(block, "finished_at"),
    });
  }
  importedCounts.trackingJobs += await insertBatchWithFallback(trackingJobs, trackingJobsBatch, "tracking_jobs");

  // ── Social account issues ──
  const issuesBatch: (typeof socialAccountIssues.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "social_account_issues", "social_account_issue")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const saRaw = unescapeXml(parseXmlTag("social_account_id", block));
    const kind = unescapeXml(parseXmlTag("kind", block));
    if (!id || !saRaw || !kind) continue;
    const socialAccountId = mapSocialAccountId(saRaw);
    if (!existingSocialAccountUuids.has(socialAccountId)) continue;
    issuesBatch.push({
      id,
      socialAccountId,
      kind,
      status: parseOptStr(block, "status") || "open",
      jobId: parseOptStr(block, "job_id"),
      jobKind: parseOptStr(block, "job_kind"),
      timesSeen: parseOptInt(block, "times_seen") ?? 1,
      firstSeenAt: parseOptDate(block, "first_seen_at") ?? new Date(),
      lastSeenAt: parseOptDate(block, "last_seen_at") ?? new Date(),
      resolution: parseOptStr(block, "resolution"),
      previousUsername: parseOptStr(block, "previous_username"),
      resolvedAt: parseOptDate(block, "resolved_at"),
    });
  }
  importedCounts.socialAccountIssues += await insertBatchWithFallback(
    socialAccountIssues,
    issuesBatch,
    "social_account_issues"
  );

  // ── Conversations ──
  const existingConversationIds = new Set(
    (await db.select({ id: conversations.id }).from(conversations)).map(c => c.id)
  );
  const conversationsBatch: (typeof conversations.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "conversations", "conversation")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const channelType = unescapeXml(parseXmlTag("channel_type", block));
    if (!id || !channelType || existingConversationIds.has(id)) continue;
    const saRaw = parseOptStr(block, "social_account_id");
    const mappedSa = saRaw ? mapSocialAccountId(saRaw) : null;
    const socialAccountId = mappedSa && existingSocialAccountUuids.has(mappedSa) ? mappedSa : null;
    conversationsBatch.push({
      id,
      title: parseOptStr(block, "title"),
      channelType,
      socialAccountId,
      externalUrl: parseOptStr(block, "external_url"),
      metadata: parseOptJson<any>(block, "metadata", null),
      lastMessageAt: parseOptDate(block, "last_message_at"),
      importDate: parseOptDate(block, "import_date"),
      importUuid: parseOptStr(block, "import_uuid"),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
    existingConversationIds.add(id);
  }
  importedCounts.conversations += await insertBatchWithFallback(conversations, conversationsBatch, "conversations");

  // ── Messages ──
  const existingMessageIds = new Set(
    (await db.select({ id: messages.id }).from(messages)).map(m => m.id)
  );
  const messagesBatch: (typeof messages.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "messages", "message")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const conversationId = unescapeXml(parseXmlTag("conversation_id", block));
    const sentAt = parseOptDate(block, "sent_at");
    if (!id || !conversationId || !sentAt || !existingConversationIds.has(conversationId)) continue;
    if (existingMessageIds.has(id)) {
      skippedCounts.messages++;
      continue;
    }
    const personRaw = parseOptStr(block, "sender_person_id");
    const mappedPerson = personRaw ? replaceZeroUUID(personRaw) : null;
    const senderPersonId = mappedPerson && existingPersonIds.has(mappedPerson) ? mappedPerson : null;
    const saRaw = parseOptStr(block, "sender_social_account_id");
    const mappedSa = saRaw ? mapSocialAccountId(saRaw) : null;
    const senderSocialAccountId = mappedSa && existingSocialAccountUuids.has(mappedSa) ? mappedSa : null;
    const imageUuids = parseXmlArray("image_uuids", "image_uuid", block);

    messagesBatch.push({
      id,
      conversationId,
      senderPersonId,
      senderSocialAccountId,
      content: parseOptStr(block, "content"),
      contentType: parseOptStr(block, "content_type") || "text",
      imageUuids: imageUuids.length > 0 ? imageUuids : [],
      attachments: parseOptJson<any[]>(block, "attachments", []),
      externalId: parseOptStr(block, "external_id"),
      sentAt,
      metadata: parseOptJson<any>(block, "metadata", null),
      importDate: parseOptDate(block, "import_date"),
      importUuid: parseOptStr(block, "import_uuid"),
      createdAt: parseOptDate(block, "created_at") ?? new Date(),
    });
    existingMessageIds.add(id);
  }
  importedCounts.messages += await insertBatchWithFallback(messages, messagesBatch, "messages");

  // ── Message recipients ──
  const recipientsBatch: (typeof messageRecipients.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "message_recipients", "message_recipient")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const messageId = unescapeXml(parseXmlTag("message_id", block));
    if (!id || !messageId || !existingMessageIds.has(messageId)) continue;
    const personRaw = parseOptStr(block, "person_id");
    const mappedPerson = personRaw ? replaceZeroUUID(personRaw) : null;
    const personId = mappedPerson && existingPersonIds.has(mappedPerson) ? mappedPerson : null;
    const saRaw = parseOptStr(block, "social_account_id");
    const mappedSa = saRaw ? mapSocialAccountId(saRaw) : null;
    const socialAccountId = mappedSa && existingSocialAccountUuids.has(mappedSa) ? mappedSa : null;
    recipientsBatch.push({
      id,
      messageId,
      personId,
      socialAccountId,
      recipientType: parseOptStr(block, "recipient_type") || "to",
      importDate: parseOptDate(block, "import_date"),
      importUuid: parseOptStr(block, "import_uuid"),
    });
  }
  importedCounts.messageRecipients += await insertBatchWithFallback(
    messageRecipients,
    recipientsBatch,
    "message_recipients"
  );

  // ── Conversation participants ──
  const participantsBatch: (typeof conversationParticipants.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "conversation_participants", "conversation_participant")) {
    const id = unescapeXml(parseXmlTag("id", block));
    const conversationId = unescapeXml(parseXmlTag("conversation_id", block));
    if (!id || !conversationId || !existingConversationIds.has(conversationId)) continue;
    const personRaw = parseOptStr(block, "person_id");
    const mappedPerson = personRaw ? replaceZeroUUID(personRaw) : null;
    const personId = mappedPerson && existingPersonIds.has(mappedPerson) ? mappedPerson : null;
    const saRaw = parseOptStr(block, "social_account_id");
    const mappedSa = saRaw ? mapSocialAccountId(saRaw) : null;
    const socialAccountId = mappedSa && existingSocialAccountUuids.has(mappedSa) ? mappedSa : null;
    participantsBatch.push({
      id,
      conversationId,
      personId,
      socialAccountId,
      role: parseOptStr(block, "role") || "member",
      joinedAt: parseOptDate(block, "joined_at") ?? new Date(),
      importDate: parseOptDate(block, "import_date"),
      importUuid: parseOptStr(block, "import_uuid"),
    });
  }
  importedCounts.conversationParticipants += await insertBatchWithFallback(
    conversationParticipants,
    participantsBatch,
    "conversation_participants"
  );

  // ── Geocodes ──
  const geocodesBatch: (typeof geocodes.$inferInsert)[] = [];
  for (const block of sectionEntries(xml, "geocodes", "geocode")) {
    const query = unescapeXml(parseXmlTag("query", block));
    const status = unescapeXml(parseXmlTag("status", block));
    if (!query || !status) continue;
    geocodesBatch.push({
      query,
      status,
      latitude: parseOptFloat(block, "latitude"),
      longitude: parseOptFloat(block, "longitude"),
      displayName: parseOptStr(block, "display_name"),
      geocodedAt: parseOptDate(block, "geocoded_at") ?? new Date(),
    });
  }
  importedCounts.geocodes += await insertBatchWithFallback(geocodes, geocodesBatch, "geocodes");

  await onProgress?.(88, "Importing follow graph & history…");

  // ── Social follows (explicit <social_follows> section + edges from <social_account> and <social_network_snapshot>) ──
  for (const block of sectionEntries(xml, "social_follows", "social_follow")) {
    const followerId = unescapeXml(parseXmlTag("follower_id", block));
    const followedId = unescapeXml(parseXmlTag("followed_id", block));
    if (!followerId || !followedId) continue;
    pendingFollowEdges.push({
      followerId,
      followedId,
      detectedAt: parseOptDate(block, "detected_at") ?? undefined,
      source: parseOptStr(block, "source") ?? undefined,
    });
  }

  for (const block of sectionEntries(xml, "social_network_snapshots", "social_network_snapshot")) {
    const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
    const mappedAccountId = mapSocialAccountId(socialAccountId);
    if (!socialAccountId || !existingSocialAccountUuids.has(mappedAccountId)) continue;
    const snFollowers = parseXmlArray("followers", "account_id", block);
    const snFollowing = parseXmlArray("following", "account_id", block);
    collectFollowEdges(socialAccountId, snFollowers, snFollowing);
  }

  if (includeHistory) {
    // Legacy social_profile_versions fallback
    for (const block of sectionEntries(xml, "social_profile_versions", "social_profile_version")) {
      try {
        const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
        const mappedAccountId = mapSocialAccountId(socialAccountId);
        if (!socialAccountId || !existingSocialAccountUuids.has(mappedAccountId)) continue;
        if (!parseOptBool(block, "is_current", false)) continue;
        await storage.updateSocialAccount(mappedAccountId, {
          nickname: parseOptStr(block, "nickname"),
          bio: parseOptStr(block, "bio"),
          accountUrl: parseOptStr(block, "account_url"),
          imageUrl: parseOptStr(block, "image_url"),
          externalImageUrl: parseOptStr(block, "external_image_url"),
        });
      } catch (e) {
        console.error("Error importing legacy profile version:", e);
      }
    }

    // ── Social account history ──
    const historyBatch: (typeof socialAccountHistory.$inferInsert)[] = [];
    for (const block of sectionEntries(xml, "social_account_history", "history_entry")) {
      const id = unescapeXml(parseXmlTag("id", block));
      const saRaw = unescapeXml(parseXmlTag("social_account_id", block));
      const batchId = unescapeXml(parseXmlTag("batch_id", block));
      const entryKind = unescapeXml(parseXmlTag("entry_kind", block));
      const changeSource = unescapeXml(parseXmlTag("change_source", block));
      if (!id || !saRaw || !batchId || !entryKind || !changeSource) continue;
      const socialAccountId = mapSocialAccountId(saRaw);
      if (!existingSocialAccountUuids.has(socialAccountId)) continue;

      const obsRaw = parseOptStr(block, "observed_via_account_id");
      const mappedObs = obsRaw ? mapSocialAccountId(obsRaw) : null;
      const observedViaAccountId = mappedObs && existingSocialAccountUuids.has(mappedObs) ? mappedObs : null;

      let profileFieldsChanged = parseXmlArray("profile_fields_changed", "field", block);
      if (profileFieldsChanged.length === 0) {
        profileFieldsChanged = parseOptJson<string[]>(block, "profile_fields_changed", []);
      }

      const delta = parseOptJson<any>(block, "delta", null);
      if (delta && typeof delta === "object") {
        for (const k of [
          "followersAdded",
          "followersLost",
          "followersRemoved",
          "followingAdded",
          "followingLost",
          "followingRemoved",
        ]) {
          if (Array.isArray(delta[k])) {
            delta[k] = delta[k].map((aid: string) => mapSocialAccountId(aid));
          }
        }
      }

      historyBatch.push({
        id,
        socialAccountId,
        batchId,
        entryKind,
        changeSource,
        captureScope: parseOptStr(block, "capture_scope") || "none",
        isInitialCapture: parseOptBool(block, "is_initial_capture", false),
        pendingImportId: parseOptStr(block, "pending_import_id"),
        observedViaAccountId,
        detectedAt: parseOptDate(block, "detected_at") ?? new Date(),
        followersAfter: parseOptInt(block, "followers_after") ?? 0,
        followersAdded: parseOptInt(block, "followers_added") ?? 0,
        followersLost: parseOptInt(block, "followers_lost") ?? 0,
        followingAfter: parseOptInt(block, "following_after") ?? 0,
        followingAdded: parseOptInt(block, "following_added") ?? 0,
        followingLost: parseOptInt(block, "following_lost") ?? 0,
        reportedFollowersAfter: parseOptInt(block, "reported_followers_after"),
        reportedFollowingAfter: parseOptInt(block, "reported_following_after"),
        postsAdded: parseOptInt(block, "posts_added") ?? 0,
        postsDeleted: parseOptInt(block, "posts_deleted") ?? 0,
        profileFieldsChanged,
        previousUsername: parseOptStr(block, "previous_username"),
        previousNickname: parseOptStr(block, "previous_nickname"),
        previousBio: parseOptStr(block, "previous_bio"),
        previousLocation: parseOptStr(block, "previous_location"),
        previousImageUrl: parseOptStr(block, "previous_image_url"),
        imageChange: parseOptStr(block, "image_change"),
        delta: delta as SocialAccountHistoryDelta | null,
      });
    }
    importedCounts.socialAccountHistory += await insertBatchWithFallback(
      socialAccountHistory,
      historyBatch,
      "social_account_history"
    );

    // ── Historical account summaries ──
    const histSummariesBatch: (typeof historicalAccountSummaries.$inferInsert)[] = [];
    for (const block of sectionEntries(xml, "historical_account_summaries", "historical_account_summary")) {
      const id = unescapeXml(parseXmlTag("id", block));
      const saRaw = unescapeXml(parseXmlTag("social_account_id", block));
      const content = parseOptJson<any>(block, "content", null);
      if (!id || !saRaw || !content) continue;
      const socialAccountId = mapSocialAccountId(saRaw);
      if (!existingSocialAccountUuids.has(socialAccountId)) continue;
      histSummariesBatch.push({
        id,
        socialAccountId,
        content,
        model: parseOptStr(block, "model"),
        createdAt: parseOptDate(block, "created_at") ?? new Date(),
        invalidatedAt: parseOptDate(block, "invalidated_at"),
        replacedAt: parseOptDate(block, "replaced_at") ?? new Date(),
      });
    }
    importedCounts.historicalAccountSummaries += await insertBatchWithFallback(
      historicalAccountSummaries,
      histSummariesBatch,
      "historical_account_summaries"
    );

    // ── Social network changes ──
    const networkChangesBatch: (typeof socialNetworkChanges.$inferInsert)[] = [];
    for (const block of sectionEntries(xml, "social_network_changes", "social_network_change")) {
      const id = parseOptStr(block, "id");
      const saRaw = unescapeXml(parseXmlTag("social_account_id", block));
      const changeType = unescapeXml(parseXmlTag("change_type", block));
      const direction = unescapeXml(parseXmlTag("direction", block));
      const targetRaw = unescapeXml(parseXmlTag("target_account_id", block));
      if (!saRaw || !changeType || !direction || !targetRaw) continue;
      const socialAccountId = mapSocialAccountId(saRaw);
      if (!existingSocialAccountUuids.has(socialAccountId)) continue;
      const targetAccountId = mapSocialAccountId(targetRaw);

      networkChangesBatch.push({
        ...(id ? { id } : {}),
        socialAccountId,
        changeType,
        direction,
        targetAccountId,
        detectedAt: parseOptDate(block, "detected_at") ?? new Date(),
        batchId: parseOptStr(block, "batch_id"),
      });
    }
    importedCounts.networkChanges += await insertBatchWithFallback(
      socialNetworkChanges,
      networkChangesBatch,
      "social_network_changes"
    );
  }

  // Deduplicate and batch-insert all follow edges now that all social accounts exist
  const uniqueFollows = new Map<string, typeof socialFollows.$inferInsert>();
  for (const e of pendingFollowEdges) {
    const followerId = mapSocialAccountId(e.followerId);
    const followedId = mapSocialAccountId(e.followedId);
    if (!existingSocialAccountUuids.has(followerId) || !existingSocialAccountUuids.has(followedId)) continue;
    const key = `${followerId}:${followedId}`;
    const existingEdge = uniqueFollows.get(key);
    if (!existingEdge || (e.detectedAt && !existingEdge.detectedAt)) {
      uniqueFollows.set(key, {
        followerId,
        followedId,
        detectedAt: e.detectedAt ?? new Date(),
        source: e.source || "xml-import",
      });
    }
  }
  const followBatch = Array.from(uniqueFollows.values());
  importedCounts.socialFollows += await insertBatchWithFallback(socialFollows, followBatch, "social_follows");

  // Recompute denormalized followers_count and following_count on social_accounts in a single SQL query
  if (followBatch.length > 0 || socialAccountsBatch.length > 0) {
    try {
      await db.execute(sql`
        UPDATE social_accounts sa SET
          followers_count = COALESCE((SELECT COUNT(*)::int FROM social_follows WHERE followed_id = sa.id), 0),
          following_count = COALESCE((SELECT COUNT(*)::int FROM social_follows WHERE follower_id = sa.id), 0)
      `);
    } catch (e) {
      console.error("Error recomputing social_accounts follow counts:", e);
    }
  }

  await onProgress?.(99, "Finalizing…");
  await runAutomaticImagePassIn();
  // Faces were written straight to the table, which PRM-Compute only notices by row count.
  await resyncFaceIndex();
  return { imported: importedCounts, skipped: skippedCounts };
}

async function processImportXmlTask(taskId: string, payload: {
  xml?: string;
  filePath?: string;
  includeHistory?: boolean;
  includePostHistory?: boolean;
}): Promise<string> {
  // Kept as a Buffer: a full backup can exceed V8's maximum string length.
  let xml = Buffer.from(payload.xml || "", "utf8");
  if (xml.length === 0 && payload.filePath) {
    const backupsDir = path.resolve(process.cwd(), "backups");
    const safeFilename = path.basename(payload.filePath.replace(/\\/g, "/"));
    const fullPath = path.resolve(backupsDir, safeFilename);
    if (fullPath.startsWith(backupsDir + path.sep)) {
      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.isFile()) {
          xml = await fs.promises.readFile(fullPath);
        }
      } catch {
        // File does not exist or cannot be read
      }
    }
  }
  if (xml.length === 0) {
    throw new Error("No XML data found for restore/import task");
  }

  const result = await executeImportXml(xml, {
    includeHistory: payload.includeHistory ?? true,
    includePostHistory: payload.includePostHistory ?? true,
    onProgress: (progress, message) => storage.updateTaskProgress(taskId, progress, message),
  });
  return JSON.stringify(result);
}

async function isTaskCancelled(taskId: string): Promise<boolean> {
  const task = await storage.getTaskById(taskId);
  return !task || task.status === "cancelled" || task.status === "failed";
}

/**
 * Migrates profile images to single canonical URLs with ?s= variants (image-sizes-plan.md Phase 3).
 * 1. Builds thumbUrl -> hqUrl map from the generated profile thumbs (derivedFromPhotoId) and accounts holding both urls.
 * 2. Accounts with image_url_hq: image_url := image_url_hq, is_hq := true, image_url_hq := null.
 *    Without: is_hq := photos.widthPx >= 320.
 * 3. Rewrites columns holding thumb URLs: people.image_url, groups.image_url, social_profile_versions.image_url,
 *    social_account_history.previous_image_url := coalesce(previous_image_url_hq, mapped(previous_image_url)).
 * 4. Deletes the mapped thumb objects in PRM-S3 and their photos rows; a thumb whose parent is gone stays.
 * The _hq columns are read and cleared raw (legacyHqImageUrls) so a second run after db-init dropped them is a no-op.
 */
async function processMigrateProfileImageTiers(taskId: string): Promise<string> {
  await storage.updateTaskProgress(taskId, 5, "Scanning sub-images and building thumb->HQ map...");

  // 1. Build thumbUrl -> hqUrl map. Only the generated profile thumbs: multi_image_download makes sub-images too.
  const subPhotos = await db
    .select({
      id: photos.id,
      location: photos.location,
      ogMetadata: photos.ogMetadata,
    })
    .from(photos)
    .where(and(eq(photos.isSubImage, true), like(photos.prmLocation, "profile_image:%")));

  const parentIds = subPhotos
    .map((p) => (p.ogMetadata as any)?.derivedFromPhotoId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const parentPhotos = parentIds.length > 0
    ? await db.select({ id: photos.id, location: photos.location }).from(photos).where(inArray(photos.id, parentIds))
    : [];
  const parentMap = new Map(parentPhotos.map((p) => [p.id, p.location]));

  const thumbToHqMap = new Map<string, string>();
  const mappedThumbs: typeof subPhotos = [];
  for (const p of subPhotos) {
    const derivedId = (p.ogMetadata as any)?.derivedFromPhotoId;
    if (derivedId && parentMap.has(derivedId)) {
      thumbToHqMap.set(p.location, parentMap.get(derivedId)!);
      mappedThumbs.push(p);
    }
  }
  const unmappedThumbs = subPhotos.length - mappedThumbs.length;

  // Also include dual-URL social accounts
  const legacy = await legacyHqImageUrls();
  for (const a of legacy.accounts) {
    if (a.imageUrl && a.imageUrl !== a.imageUrlHq) {
      thumbToHqMap.set(a.imageUrl, a.imageUrlHq);
    }
  }

  if (await isTaskCancelled(taskId)) return JSON.stringify({ cancelled: true });
  await storage.updateTaskProgress(taskId, 25, `Found ${thumbToHqMap.size} thumb mappings. Migrating social accounts...`);

  // 2. Migrate social_accounts
  let accountsUpdated = 0;
  if (legacy.accounts.length > 0) {
    const { rowCount } = await pool.query(
      `UPDATE social_accounts SET image_url = image_url_hq, is_hq_image = TRUE, image_url_hq = NULL WHERE image_url_hq IS NOT NULL`,
    );
    accountsUpdated += rowCount ?? 0;
  }

  const allAccounts = await db
    .select({ id: socialAccounts.id, imageUrl: socialAccounts.imageUrl, isHqImage: socialAccounts.isHqImage })
    .from(socialAccounts)
    .where(isNotNull(socialAccounts.imageUrl));

  for (const account of allAccounts) {
    const photo = await storage.getPhotoByLocation(account.imageUrl!);
    if (photo?.widthPx == null) continue;
    const isHq = photo.widthPx >= 320;
    if (account.isHqImage !== isHq) {
      await db.update(socialAccounts).set({ isHqImage: isHq }).where(eq(socialAccounts.id, account.id));
      accountsUpdated++;
    }
  }

  if (await isTaskCancelled(taskId)) return JSON.stringify({ cancelled: true });
  await storage.updateTaskProgress(taskId, 50, "Rewriting references in people, groups, and history...");

  // 3. Rewrite references
  let peopleUpdated = 0;
  let groupsUpdated = 0;
  let spvUpdated = 0;
  let historyUpdated = 0;

  if (legacy.history.length > 0) {
    const { rowCount } = await pool.query(
      `UPDATE social_account_history SET previous_image_url = previous_image_url_hq, previous_image_url_hq = NULL WHERE previous_image_url_hq IS NOT NULL`,
    );
    historyUpdated += rowCount ?? 0;
  }

  if (thumbToHqMap.size > 0) {
    const peopleRows = await db.select({ id: people.id, imageUrl: people.imageUrl }).from(people).where(isNotNull(people.imageUrl));
    for (const p of peopleRows) {
      if (p.imageUrl && thumbToHqMap.has(p.imageUrl)) {
        await db.update(people).set({ imageUrl: thumbToHqMap.get(p.imageUrl)! }).where(eq(people.id, p.id));
        peopleUpdated++;
      }
    }

    const groupRows = await db.select({ id: groups.id, imageUrl: groups.imageUrl }).from(groups).where(isNotNull(groups.imageUrl));
    for (const g of groupRows) {
      if (g.imageUrl && thumbToHqMap.has(g.imageUrl)) {
        await db.update(groups).set({ imageUrl: thumbToHqMap.get(g.imageUrl)! }).where(eq(groups.id, g.id));
        groupsUpdated++;
      }
    }

    const spvRows = await db.select({ id: socialProfileVersions.id, imageUrl: socialProfileVersions.imageUrl }).from(socialProfileVersions).where(isNotNull(socialProfileVersions.imageUrl));
    for (const spv of spvRows) {
      if (spv.imageUrl && thumbToHqMap.has(spv.imageUrl)) {
        await db.update(socialProfileVersions).set({ imageUrl: thumbToHqMap.get(spv.imageUrl)! }).where(eq(socialProfileVersions.id, spv.id));
        spvUpdated++;
      }
    }

    const historyRows = await db
      .select({ id: socialAccountHistory.id, previousImageUrl: socialAccountHistory.previousImageUrl })
      .from(socialAccountHistory)
      .where(isNotNull(socialAccountHistory.previousImageUrl));
    for (const h of historyRows) {
      if (h.previousImageUrl && thumbToHqMap.has(h.previousImageUrl)) {
        await db.update(socialAccountHistory).set({ previousImageUrl: thumbToHqMap.get(h.previousImageUrl)! }).where(eq(socialAccountHistory.id, h.id));
        historyUpdated++;
      }
    }
  }

  if (await isTaskCancelled(taskId)) return JSON.stringify({ cancelled: true });
  await storage.updateTaskProgress(taskId, 75, `Deleting ${mappedThumbs.length} obsolete thumbnail objects and photo records...`);

  // 4. Delete thumb objects and photos rows
  let deletedThumbs = 0;
  for (const p of mappedThumbs) {
    try {
      await deleteImageFromPrmS3(p.location);
    } catch {
      // Ignore if missing in S3
    }
    await db.delete(photos).where(eq(photos.id, p.id));
    deletedThumbs++;
  }

  // 5. Verification of remaining
  const pending = await legacyProfileImagesPending();
  const remaining = pending.hqAccounts + pending.hqHistory + pending.thumbs;

  await storage.updateTaskProgress(
    taskId,
    100,
    remaining === 0
      ? "Migration complete. The image_url_hq / previous_image_url_hq columns will be dropped on next start."
      : `Migration complete. Remaining unmigrated: ${remaining}; the _hq columns stay until it reaches 0.`,
  );

  return JSON.stringify({
    thumbMappingsCount: thumbToHqMap.size,
    accountsUpdated,
    peopleUpdated,
    groupsUpdated,
    spvUpdated,
    historyUpdated,
    deletedThumbs,
    unmappedThumbs,
    remainingUnmigrated: remaining,
  });
}

import { sql } from "drizzle-orm";

async function processMigrateImagePrefixes(taskId: string): Promise<string> {
  const counts = { total: 0, migrated: 0, skipped: 0, failed: 0 };
  const errors: string[] = [];
  const { client: s3Client, bucket } = await getPrmS3Client();

  const toMigrate = await db.execute(sql`
    SELECT 
      p.id, 
      p.location, 
      p.prm_location as "prmLocation", 
      p.og_metadata as "ogMetadata",
      sap.post_type as "postType"
    FROM photos p
    LEFT JOIN social_account_posts sap ON p.prm_location = 'post:' || sap.id
    WHERE p.location LIKE '/api/prm-s3/images/%' 
       OR p.location LIKE 'images/%'
  `);
  const items = toMigrate.rows as any[];
  counts.total = items.length;

  if (items.length === 0) {
    await storage.updateTaskProgress(taskId, 100, "No images found to migrate.");
    return JSON.stringify({ ...counts, errors });
  }

  let nextIndex = 0;
  let completed = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      if (await isTaskCancelled(taskId)) return;
      const idx = nextIndex++;
      const item = items[idx];
      const oldLocation: string = item.location;
      
      try {
        const oldKey = oldLocation.startsWith("/api/prm-s3/") 
          ? oldLocation.substring("/api/prm-s3/".length) 
          : oldLocation;

        let targetPrefix = "";
        if (item.postType === "story" || item.ogMetadata?.source === "instagram-story") {
          targetPrefix = "stories/";
        } else if (item.postType === "post" || item.postType === "video" || item.postType === "carousel" || item.ogMetadata?.source === "instagram-post") {
          targetPrefix = "posts/";
        } else if (item.prmLocation?.startsWith("profile_image:") || item.prmLocation?.startsWith("social_profile_image:")) {
          targetPrefix = "profiles/";
        } else {
          // If we can't determine it, we leave it in images/ (generic)
          counts.skipped++;
          completed++;
          continue;
        }

        const filename = oldKey.substring("images/".length);
        const newKey = targetPrefix + filename;
        const newLocation = oldLocation.replace("images/" + filename, newKey);

        // 1. Copy original object to new prefix (PRM-S3 bakes the new folder's WebP proxies on write)
        await s3Client.send(new CopyObjectCommand({
          Bucket: bucket,
          CopySource: bucket + "/" + oldKey,
          Key: newKey,
        }));

        // 2. DB Update transaction
        await db.transaction(async (tx) => {
          await tx.execute(sql`UPDATE photos SET location = ${newLocation} WHERE id = ${item.id}`);
          await tx.execute(sql`
            UPDATE social_account_posts 
            SET content = REPLACE(content, ${oldLocation}, ${newLocation})
            WHERE content LIKE ${'%' + oldLocation + '%'}
          `);
          await tx.execute(sql`UPDATE social_accounts SET image_url = ${newLocation} WHERE image_url = ${oldLocation}`);
          await tx.execute(sql`UPDATE social_account_history SET previous_image_url = ${newLocation} WHERE previous_image_url = ${oldLocation}`);
          await tx.execute(sql`UPDATE people SET image_url = ${newLocation} WHERE image_url = ${oldLocation}`);
          await tx.execute(sql`UPDATE social_profile_versions SET image_url = ${newLocation} WHERE image_url = ${oldLocation}`);
        });

        // 3. Delete old object from images/ (cleans up old key and any old proxies)
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: oldKey,
        }));

        counts.migrated++;
      } catch (err) {
        counts.failed++;
        if (errors.length < 20) {
          errors.push(`${oldLocation}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      completed++;
      if (completed % 25 === 0 || completed === items.length) {
        await storage.updateTaskProgress(
          taskId,
          Math.round((completed / items.length) * 100),
          `${completed}/${items.length} images migrated (${counts.migrated} migrated, ${counts.failed} failed)`
        );
      }
    }
  };

  await Promise.all(Array.from({ length: 4 }, () => runWorker()));

  if (await isTaskCancelled(taskId)) {
    return JSON.stringify({ ...counts, cancelled: true, errors });
  }

  await storage.updateTaskProgress(taskId, 100, `Completed: ${counts.migrated} migrated, ${counts.skipped} skipped, ${counts.failed} failed`);
  return JSON.stringify({ ...counts, errors });
}

function smallestVariantSize(key: string): 360 | 64 {
  if (key.startsWith("stories/") || key.startsWith("posts/")) return 360;
  return 64; // profiles/, faces/, images/ (default)
}

/**
 * Warms image variants for existing images in PRM-S3 (image-sizes-plan.md Phase 2).
 * Lists keys under images/ and faces/, checks HEAD ?s=64 (skips if image/webp),
 * and issues in-place CopyObject at concurrency 4 to trigger PRM-S3 baking.
 */
async function processBakeImageVariants(taskId: string): Promise<string> {
  const allKeys = await listPrmS3ObjectKeys(["images/", "profiles/", "posts/", "stories/", "faces/"]);
  const counts = { total: allKeys.length, baked: 0, skipped: 0, failed: 0 };
  const errors: string[] = [];

  if (allKeys.length === 0) {
    await storage.updateTaskProgress(taskId, 100, "No images found to bake.");
    return JSON.stringify({ ...counts, errors });
  }

  let nextIndex = 0;
  let completed = 0;

  const runWorker = async () => {
    while (nextIndex < allKeys.length) {
      if (await isTaskCancelled(taskId)) return;
      const idx = nextIndex++;
      const key = allKeys[idx];
      try {
        const { baked, contentType } = await isPrmS3VariantBaked(key, smallestVariantSize(key));
        if (baked) {
          counts.skipped++;
        } else {
          await copyPrmS3ObjectInPlace(key, contentType || "image/jpeg");
          // PRM-S3 bakes nothing for a non-image or a < 64 px source; count those as skipped, not baked.
          if ((await isPrmS3VariantBaked(key, smallestVariantSize(key))).baked) counts.baked++;
          else counts.skipped++;
        }
      } catch (err) {
        counts.failed++;
        if (errors.length < 20) {
          errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      completed++;
      if (completed % 25 === 0 || completed === allKeys.length) {
        await storage.updateTaskProgress(
          taskId,
          Math.round((completed / allKeys.length) * 100),
          `${completed}/${allKeys.length} images checked (${counts.baked} baked, ${counts.skipped} skipped)`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: 4 }, () => runWorker()));

  if (await isTaskCancelled(taskId)) {
    return JSON.stringify({ ...counts, cancelled: true, errors });
  }

  await storage.updateTaskProgress(
    taskId,
    100,
    `Completed: ${counts.baked} baked, ${counts.skipped} skipped, ${counts.failed} failed`,
  );
  return JSON.stringify({ ...counts, errors });
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

  const rawUsernames = rows
    .map((r: any) => (r.username || "").toString().trim().replace(/"/g, ""))
    .filter(Boolean);
  const existingAccounts = await storage.getSocialAccountsByUsernames(rawUsernames);
  const accountsByUsername = new Map(existingAccounts.map((a) => [a.username.toLowerCase(), a]));

  let importedCount = 0;
  let updatedCount = 0;
  const processedAccountIds: string[] = [];
  const mutualFollowIds: string[] = [];
  const imageTasksToCreate: InsertImageTask[] = [];

  const imageTaskGroup = await storage.createImageTaskGroup({
    title: `Instagram Import - @${targetAccountUsername} (${importType})`,
    kind: "social_import",
    parentTaskId: taskId,
    socialAccountId: accountId || null,
  });
  const imageTaskGroupId = imageTaskGroup.id;

  for (const row of rows) {
    if (await isTaskCancelled(taskId)) {
      if (imageTasksToCreate.length > 0) {
        await storage.createImageTasksBatch(imageTasksToCreate);
      }
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
        await storage.updateSocialAccount(existingAccount.id, { nickname: fullName });
        updatedCount++;
      }

      if (profilePicUrl && (!existingAccount.currentProfile?.imageUrl || forceUpdateImages)) {
        imageTasksToCreate.push({
          type: "download_img_instagram",
          status: "pending",
          parentTaskId: taskId,
          imageTaskGroupId,
          payload: JSON.stringify({
            socialAccountId: existingAccount.id,
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
        nickname: fullName || null,
        accountUrl: `https://instagram.com/${username}`,
      });

      if (profilePicUrl) {
        imageTasksToCreate.push({
          type: "download_img_instagram",
          status: "pending",
          parentTaskId: taskId,
          imageTaskGroupId,
          payload: JSON.stringify({
            socialAccountId: newAccount.id,
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

  if (imageTasksToCreate.length > 0) {
    await storage.createImageTasksBatch(imageTasksToCreate);
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
  /** Drop platform echoes ("Liked a message") */
  skipNoise?: boolean;
  /** Drop machine-sent messages: codes, shipping, receipts, promos */
  skipAutomated?: boolean;
  importMedia?: boolean;
}

type SkippedByCategory = Partial<Record<AutomatedCategory, number>>;

/**
 * Category to skip for a text message under the given options, or null to keep
 * it. Media messages are never classified: their text is a caption.
 */
function skipCategory(content: string | null, hasMedia: boolean, options: ImportDmOptions): AutomatedCategory | null {
  if (!content || hasMedia) return null;
  const category = classifyMessage(content);
  if (!category) return null;
  const wanted = category === "system_noise" ? options.skipNoise !== false : options.skipAutomated !== false;
  return wanted ? category : null;
}

function tally(counts: SkippedByCategory, category: AutomatedCategory) {
  counts[category] = (counts[category] ?? 0) + 1;
}

function sumCounts(items: SkippedByCategory[]): SkippedByCategory {
  const out: SkippedByCategory = {};
  for (const counts of items) {
    for (const [category, n] of Object.entries(counts)) {
      out[category as AutomatedCategory] = (out[category as AutomatedCategory] ?? 0) + n;
    }
  }
  return out;
}

interface ImportThreadSummary {
  conversationId: string;
  threadFolder: string;
  /** True when the stored content hash matched and the thread was skipped whole */
  skippedUnchanged: boolean;
  inserted: number;
  skippedDuplicates: number;
  skipped: SkippedByCategory;
  photosImported: number;
  videosImported: number;
  audioImported: number;
  mediaUnavailable: number;
}

async function importOneDmThread(
  taskId: string,
  threadFolder: string,
  root: { socialAccountId: string; username: string },
  options: ImportDmOptions,
  progress: { threadIndex: number; threadCount: number },
): Promise<ImportThreadSummary> {
  const importMedia = options.importMedia !== false;

  const parsed: ParsedThread = loadThreadFolder(threadFolder);
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
    const existing = await storage.getSocialAccountByUsername(parsed.username);
    if (existing) {
      counterpartId = existing.id;
    } else {
      const newAccount = await storage.createSocialAccount({
        username: parsed.username,
        ownerUuid: null,
        typeId: instagramType?.id || null,
        internalAccountCreationType: "dm backup import",
      });
      // Non-owner participant's display name; export owner is listed last
      await storage.updateSocialAccount(newAccount.id, {
        nickname: parsed.participants.length >= 1 ? parsed.participants[0] : null,
        accountUrl: `https://instagram.com/${parsed.username}`,
      });
      counterpartId = newAccount.id;
    }
  }

  // Meta exports list the export owner (the root account) as the last
  // participant — this is the display name used to attribute owner messages.
  const ownerName = parsed.participants.length > 0
    ? parsed.participants[parsed.participants.length - 1]
    : null;

  // ── Resolve or create the conversation ──
  let conversation = await storage.getConversationByMetadata("igThreadId", parsed.threadId);
  if (!conversation) {
    conversation = await storage.createConversation({
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
    skipped: {},
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
  const importedPhotoIds: string[] = [];

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
    const skip = skipCategory(msg.content, msg.media.length > 0, options);
    if (skip) {
      tally(summary.skipped, skip);
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
        const imageUrl = await uploadImage(buffer, fileName, mime);
        const photo = await storage.insertPhoto({
          location: imageUrl,
          prmLocation: `message:${message.id}`,
          isSubImage: false,
          fileHash,
          ogMetadata: { source: "instagram-export", originalUri: media.uri },
        });
        imageUuids.push(photo.id);
        importedPhotoIds.push(photo.id);
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
        const url = await uploadMedia(buffer, path.basename(filePath), mimeType);
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

  if (importedPhotoIds.length) await enqueueAutoRecognition({ kind: "message", photoIds: importedPhotoIds });

  return summary;
}

export async function queueSocialProfileImage(
  socialAccountId: string,
  imageUrl: string | null | undefined,
  parentTaskId?: string,
  imageTaskGroupId?: string,
) {
  if (!imageUrl || !imageUrl.trim()) return;

  await db
    .update(socialAccounts)
    .set({ externalImageUrl: imageUrl })
    .where(eq(socialAccounts.id, socialAccountId));

  await storage.createImageTask({
    type: "download_img_instagram",
    status: "pending",
    parentTaskId: parentTaskId || null,
    imageTaskGroupId: imageTaskGroupId || undefined,
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
 * seen before. A row carrying `pk` (Instagram's user id) matches by id first, so a
 * renamed account is followed to its new handle rather than duplicated.
 *
 * The previous implementation ran two queries and up to two writes per CSV row, so a
 * 10,000-follower pull cost roughly 30,000 round trips. This does it in a handful of
 * chunked statements regardless of size (plus one rename per renamed account), which
 * is also what lets the whole ingest sit inside a single transaction.
 */
export async function resolveScrapedAccounts(
  rows: any[],
  typeId: string | null,
  creationType = "PRM-chrome import",
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
  // Instagram's user id, where the scrape carried one: it names the row whatever the handle is now.
  const pkFor = new Map<string, string>();
  const handleFor = new Map<string, string>();
  for (const [handle, row] of byHandle) {
    const pk = instagramPkOf(row);
    if (pk && !handleFor.has(pk)) {
      pkFor.set(handle, pk);
      handleFor.set(pk, handle);
    }
  }

  const CHUNK = 500;
  const pks = [...handleFor.keys()];
  const renamed: { account: SocialAccount; handle: string }[] = [];
  for (let i = 0; i < pks.length; i += CHUNK) {
    const holders = await db.select().from(socialAccounts).where(inArray(socialAccounts.instagramUserId, pks.slice(i, i + CHUNK)));
    for (const a of holders) {
      const handle = handleFor.get(a.instagramUserId!)!;
      resolved.set(handle, a.id);
      if (a.username !== handle) renamed.push({ account: a, handle });
    }
  }
  // Rare, and each is a journaled rename (plus a merge when the new name already had a row).
  for (const { account, handle } of renamed) await followRename(account, handle);

  const backfill: [string, string][] = [];
  const byName = handles.filter(h => !resolved.has(h));
  for (let i = 0; i < byName.length; i += CHUNK) {
    const batch = byName.slice(i, i + CHUNK);
    const existing = await db
      .select({ id: socialAccounts.id, username: socialAccounts.username, instagramUserId: socialAccounts.instagramUserId })
      .from(socialAccounts)
      .where(inArray(socialAccounts.username, batch));
    for (const a of existing) {
      const pk = pkFor.get(a.username);
      // A row that holds a different id is whoever had this handle before: not this account.
      if (resolved.has(a.username) || (pk && a.instagramUserId && a.instagramUserId !== pk)) continue;
      resolved.set(a.username, a.id);
      if (pk && !a.instagramUserId) backfill.push([a.id, pk]);
    }
  }
  for (let i = 0; i < backfill.length; i += CHUNK) {
    await db.execute(sql`
      UPDATE ${socialAccounts} AS sa SET instagram_user_id = v.pk
      FROM (VALUES ${sql.join(backfill.slice(i, i + CHUNK).map(([id, pk]) => sql`(${id}, ${pk})`), sql`, `)}) AS v(id, pk)
      WHERE sa.id = v.id AND sa.instagram_user_id IS NULL
    `);
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
          instagramUserId: pkFor.get(handle),
          typeId: typeId || undefined,
          ownerUuid: null,
          internalAccountCreationType: creationType,
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
  let image: ProfileImageOutcome | undefined;
  if (record.accountImageUrl?.trim()) {
    try {
      const fetched = await fetchProfileImage(record.accountImageUrl);
      const verdict = await classifyProfileImage(mainAccount, fetched);
      if (verdict.replace) {
        image = await applyProfileImageVerdict(mainAccount.id, mainAccount, fetched, verdict);
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
  // Parsed before scope is inferred, because inference needs row counts rather than
  // raw string truthiness: a CSV that is a header line and nothing else is a non-empty
  // string but an empty list, and under authoritative deletion those mean opposite
  // things — "nothing changed" versus "unfollow everyone".
  const parsedFollowers = parseCsvRows(record.accountFollowers);
  const parsedFollowing = parseCsvRows(record.accountFollowing);
  const scope: CaptureScope =
    (record.captureScope as CaptureScope | null) ??
    (record.importType === "account" ? "profile"
      : parsedFollowers.length && parsedFollowing.length ? "both"
      : parsedFollowers.length ? "followers"
      : parsedFollowing.length ? "following"
      : "profile");

  // A direction the scrape did not capture contributes no rows. When the extension
  // declares a scope it is still honoured as-is, empty list included — that is the
  // whole point of the declaration.
  const followerRows = capturesFollowers(scope) ? parsedFollowers : [];
  const followingRows = capturesFollowing(scope) ? parsedFollowing : [];
  const graphRows = [...followerRows, ...followingRows];

  let followerIds: string[] | undefined;
  let followingIds: string[] | undefined;
  let resolved = new Map<string, string>();

  if (scope !== "profile") {
    await storage.updateTaskProgress(taskId, 25, "Resolving accounts...");
    resolved = await resolveScrapedAccounts(graphRows, typeId);

    const idsFor = (rows: any[]) => rows.map(handleOf).filter(Boolean).map(handle => {
      // resolveScrapedAccounts creates every handle it cannot find, so a miss here is
      // a real failure. Dropping it silently would be recorded as an unfollow.
      const id = resolved.get(handle);
      if (!id) throw new Error(`Failed to resolve @${handle} during import`);
      return id;
    });

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
      image,
      externalImageUrl: record.accountImageUrl || undefined,
      reportedFollowersCount: record.accountFollowersCount ?? undefined,
      reportedFollowingCount: record.accountFollowingCount ?? undefined,
    },
    source: "extension",
    pendingImportId: record.id,
  });
  void queueOsintScansForMeAccount(mainAccount.id, (entry.delta as SocialAccountHistoryDelta | null)?.followingAdded ?? []);

  // 5. Graph avatars stay on the async queue. Fetching thousands inline would
  //    serialize the import behind Instagram's CDN, and they play no part in change
  //    detection.
  if (includeGraphImages) {
    await storage.updateTaskProgress(taskId, 85, "Queueing profile images...");
    const group = await storage.createImageTaskGroup({
      title: `Social Import - @${mainUsername}`,
      kind: "social_import",
      parentTaskId: taskId,
      socialAccountId: mainAccount.id,
    });
    const imageTaskGroupId = group.id;
    for (const row of graphRows) {
      const id = resolved.get(handleOf(row));
      if (id) await queueSocialProfileImage(id, row.profile_pic_url || row.profilePicUrl, taskId, imageTaskGroupId);
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
    zipPath: string;
    rootSocialAccountId: string;
    rootUsername: string;
    options?: ImportDmOptions;
  }
): Promise<string> {
  const { zipPath, rootSocialAccountId, rootUsername, options = {} } = payload;

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
      skipped: sumCounts(summaries.map((s) => s.skipped)),
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

/**
 * Imports an "SMS Backup & Restore" XML export. The root person — whose phone
 * the backup came from — owns every conversation. Counterpart numbers are
 * matched against people's phone fields; unmatched threads still import,
 * titled by the number, so they can be linked to a person later.
 */
export async function processImportSms(
  taskId: string,
  payload: {
    xmlPath: string;
    rootPersonId: string;
    options?: ImportDmOptions;
  }
): Promise<string> {
  const { xmlPath, rootPersonId, options = {} } = payload;
  try {
    const { threads } = parseSmsBackup(fs.readFileSync(xmlPath, "utf-8"));
    if (threads.length === 0) {
      throw new Error("No <sms> or <mms> messages found in the uploaded XML");
    }

    // The Me person's own messages use the null-sender "self" convention that
    // manual entry uses; anyone else's phone attributes them to that person.
    const me = await storage.getMePerson();
    const ownerSenderPersonId = me?.id === rootPersonId ? null : rootPersonId;

    const personByPhone = new Map<string, string>();
    for (const p of await storage.getAllPeople()) {
      for (const phone of [p.phone, ...(p.additionalPhones ?? [])]) {
        const key = cleanPhoneNumberForStorage(phone);
        if (key && !personByPhone.has(key)) personByPhone.set(key, p.id);
      }
    }

    const importUuid = crypto.randomUUID();
    const importDate = new Date();
    const summary = {
      threads: 0,
      /** Nothing left to import after filtering */
      threadsSkipped: 0,
      inserted: 0,
      skippedDuplicates: 0,
      skipped: {} as SkippedByCategory,
      /** MMS with no text part — media is not imported from SMS backups */
      mediaOnlySkipped: 0,
      unmatchedNumbers: [] as string[],
    };

    for (let t = 0; t < threads.length; t++) {
      const thread = threads[t];
      if (await isTaskCancelled(taskId)) {
        return JSON.stringify({ cancelled: true, ...summary });
      }
      await storage.updateTaskProgress(taskId, Math.round((t / threads.length) * 99), `Thread ${t + 1}/${threads.length}`);

      // Filter first so a thread that is nothing but automated noise never
      // creates an empty conversation
      const kept = thread.messages.filter((msg) => {
        if (!msg.content) {
          summary.mediaOnlySkipped++;
          return false;
        }
        const skip = skipCategory(msg.content, msg.hasMedia, options);
        if (skip) tally(summary.skipped, skip);
        return !skip;
      });
      if (kept.length === 0) {
        summary.threadsSkipped++;
        continue;
      }

      const counterparts = thread.addresses.map((address) => ({
        address,
        personId: personByPhone.get(address) ?? null,
      }));
      const unmatched = counterparts.filter((c) => !c.personId).map((c) => c.address);
      summary.unmatchedNumbers.push(...unmatched);

      let conversation = await storage.getConversationByMetadata("smsThreadKey", thread.key);
      if (!conversation) {
        conversation = await storage.createConversation({
          // Participant names label fully-matched threads; otherwise show who the number is
          title: unmatched.length === 0
            ? null
            : thread.contactName ?? thread.addresses.map(formatPhoneNumberForDisplay).join(", "),
          channelType: "phone",
          socialAccountId: null,
          externalUrl: null,
          metadata: {
            smsThreadKey: thread.key,
            addresses: thread.addresses,
            contactName: thread.contactName,
            isGroup: thread.addresses.length > 1,
          },
          lastMessageAt: null,
          importDate,
          importUuid,
        });
        await storage.addConversationParticipant({
          conversationId: conversation.id,
          personId: rootPersonId,
          socialAccountId: null,
          role: "owner",
          importDate,
          importUuid,
        });
        for (const c of counterparts) {
          if (!c.personId) continue;
          await storage.addConversationParticipant({
            conversationId: conversation.id,
            personId: c.personId,
            socialAccountId: null,
            role: "participant",
            importDate,
            importUuid,
          });
        }
      }
      summary.threads++;

      const existingExternalIds = await storage.getMessageExternalIds(conversation.id);
      const batchToInsert: Array<{
        data: InsertMessage;
        recipients: Array<{ personId?: string | null; socialAccountId?: string | null; recipientType?: string }>;
      }> = [];

      for (const msg of kept) {
        if (existingExternalIds.has(msg.externalId)) {
          summary.skippedDuplicates++;
          continue;
        }
        existingExternalIds.add(msg.externalId);
        const senderPersonId = msg.isOwner
          ? ownerSenderPersonId
          : (msg.senderAddress && personByPhone.get(msg.senderAddress)) || null;
        const senderName = !msg.isOwner && !senderPersonId
          ? (thread.addresses.length === 1 && thread.contactName) || formatPhoneNumberForDisplay(msg.senderAddress)
          : undefined;
        const recipients = msg.isOwner
          ? counterparts.filter((c) => c.personId).map((c) => ({ personId: c.personId, recipientType: "to" }))
          : [{ personId: rootPersonId, recipientType: "to" }];

        batchToInsert.push({
          data: {
            conversationId: conversation.id,
            senderPersonId,
            senderSocialAccountId: null,
            content: msg.content,
            contentType: "text",
            imageUuids: [],
            attachments: null,
            externalId: msg.externalId,
            sentAt: msg.sentAt,
            metadata: senderName ? { senderName } : null,
            importDate,
            importUuid,
          },
          recipients,
        });
      }

      if (batchToInsert.length > 0) {
        await storage.bulkCreateMessages(batchToInsert);
        summary.inserted += batchToInsert.length;
      }
    }

    summary.unmatchedNumbers = [...new Set(summary.unmatchedNumbers)];
    return JSON.stringify({ success: true, ...summary });
  } finally {
    fs.rmSync(xmlPath, { force: true });
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

      const cdnUrl = await uploadImage(buffer, `image.${ext}`, contentType);

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

type GroupSignal = "mutualFollow" | "oneWayFollow" | "coFollow" | "coMention" | "bio";
const GROUP_SIGNALS: GroupSignal[] = ["mutualFollow", "oneWayFollow", "coFollow", "coMention", "bio"];
const emptySignalRecord = (): Record<GroupSignal, number> =>
  ({ mutualFollow: 0, oneWayFollow: 0, coFollow: 0, coMention: 0, bio: 0 });

/**
 * Why a hybrid community hangs together: which signals carry its internal
 * weight, what members commonly follow, its strongest pairs and weakest fits.
 * Stored with the result and fed to the LLM explainer on demand.
 */
function buildGroupSignals(opts: {
  memberIdxs: number[];
  internalEdges: GraphEdge[];
  internalWeight: number;
  edgeSignals: Map<string, Record<GroupSignal, number>>;
  totalDegree: Map<number, number>;
  followsByFollower: Map<number, string[]>;
  accounts: { id: string; username: string }[];
  idToIdx: Map<string, number>;
  keywordCounts: { keyword: string; memberCount: number }[];
}) {
  const { memberIdxs, internalEdges, internalWeight, edgeSignals, totalDegree, followsByFollower, accounts, idToIdx } = opts;

  const internalWeightBySignal = emptySignalRecord();
  const pairCounts = emptySignalRecord();
  const memberInternal = new Map<number, number>();
  const pairs: { a: string; b: string; weight: number; dominant: GroupSignal }[] = [];

  for (const e of internalEdges) {
    const s = edgeSignals.get(`${e.u}:${e.v}`) ?? emptySignalRecord();
    let dominant: GroupSignal = "mutualFollow";
    for (const sig of GROUP_SIGNALS) {
      internalWeightBySignal[sig] += s[sig];
      if (s[sig] > 0) pairCounts[sig]++;
      if (s[sig] > s[dominant]) dominant = sig;
    }
    memberInternal.set(e.u, (memberInternal.get(e.u) || 0) + e.weight);
    memberInternal.set(e.v, (memberInternal.get(e.v) || 0) + e.weight);
    pairs.push({ a: accounts[e.u].username, b: accounts[e.v].username, weight: e.weight, dominant });
  }

  const sharePct = emptySignalRecord();
  for (const sig of GROUP_SIGNALS) {
    sharePct[sig] = internalWeight > 0 ? Math.round((internalWeightBySignal[sig] / internalWeight) * 100) : 0;
    internalWeightBySignal[sig] = Math.round(internalWeightBySignal[sig] * 10) / 10;
  }

  // Accounts followed by the most members (only ones we know a username for)
  const followedCounts = new Map<string, number>();
  for (const idx of memberIdxs) {
    for (const followedId of new Set(followsByFollower.get(idx) ?? [])) {
      followedCounts.set(followedId, (followedCounts.get(followedId) || 0) + 1);
    }
  }
  const topSharedFollows = [...followedCounts.entries()]
    .filter(([id, count]) => count >= 2 && idToIdx.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, memberCount]) => ({ username: accounts[idToIdx.get(id)!].username, memberCount }));

  // Members whose connections mostly lead outside the group
  const weakMembers = memberIdxs
    .map(idx => {
      const total = totalDegree.get(idx) || 0;
      return { id: accounts[idx].id, username: accounts[idx].username, fit: total > 0 ? (memberInternal.get(idx) || 0) / total : 0 };
    })
    .filter(m => m.fit < 0.3)
    .sort((a, b) => a.fit - b.fit)
    .slice(0, 5)
    .map(m => ({ ...m, fit: Math.round(m.fit * 100) / 100 }));

  return {
    internalWeightBySignal,
    sharePct,
    pairCounts,
    topSharedFollows,
    keywordCounts: opts.keywordCounts,
    topPairs: pairs.sort((a, b) => b.weight - a.weight).slice(0, 5).map(p => ({ ...p, weight: Math.round(p.weight * 10) / 10 })),
    weakMembers,
  };
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
  minPersonalConnections?: number; // social accounts only: members that follow / are followed by a Me account
}): Promise<string> {
  const { entityType } = payload;
  const minPersonalConnections = Math.max(0, payload.minPersonalConnections ?? 0);
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
      nickname: socialAccounts.nickname,
      bio: socialAccounts.bio,
      imageUrl: socialAccounts.imageUrl,
      createdAt: socialAccounts.internalAccountCreationDate,
    }).from(socialAccounts);


    const profileMap = new Map<string, { nickname: string | null; bio: string | null; imageUrl: string | null; createdAt: Date | null }>();
    for (const a of accounts) {
      profileMap.set(a.id, { nickname: a.nickname, bio: a.bio, imageUrl: a.imageUrl, createdAt: a.createdAt });
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
    // Hybrid only: per-signal breakdown of each edge, used by the group explainer
    const edgeSignals = new Map<string, Record<GroupSignal, number>>();
    const addWeightedEdge = (uIdx: number, vIdx: number, w: number, signal: GroupSignal) => {
      if (uIdx === vIdx) return;
      const minIdx = uIdx < vIdx ? uIdx : vIdx;
      const maxIdx = uIdx < vIdx ? vIdx : uIdx;
      const key = `${minIdx}:${maxIdx}`;
      edgeWeights.set(key, (edgeWeights.get(key) || 0) + w);
      if (strategy === "hybrid") {
        let s = edgeSignals.get(key);
        if (!s) edgeSignals.set(key, s = emptySignalRecord());
        s[signal] += w;
      }
    };

    const needsFollows = strategy === "hybrid" || strategy === "network_modularity" || strategy === "co_following";
    const allFollows = needsFollows
      ? await db.select({ followerId: socialFollows.followerId, followedId: socialFollows.followedId }).from(socialFollows)
      : [];

    // Signal A: Direct Follows
    if (strategy === "hybrid" || strategy === "network_modularity") {
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

        if (isMutual) addWeightedEdge(uIdx, vIdx, 3.5, "mutualFollow");
        else addWeightedEdge(uIdx, vIdx, 1.0, "oneWayFollow");
      }
    }

    // Signal B: Co-Following / Shared Audience Bipartite Projection
    if (strategy === "hybrid" || strategy === "co_following") {
      await storage.updateTaskProgress(taskId, 50, "Analyzing co-following & shared audience overlap...");
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
          addWeightedEdge(uIdx, vIdx, weight, "coFollow");
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
                  addWeightedEdge(mentionedUIdxs[i], mentionedUIdxs[j], 2.5, "coMention");
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
          addWeightedEdge(uIdx, vIdx, weight, "bio");
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

    // Hybrid only: follower idx -> followed account ids, for "accounts most members follow"
    const followsByFollower = new Map<number, string[]>();
    if (strategy === "hybrid") {
      for (const f of allFollows) {
        const uIdx = idToIdx.get(f.followerId);
        if (uIdx === undefined) continue;
        if (!followsByFollower.has(uIdx)) followsByFollower.set(uIdx, []);
        followsByFollower.get(uIdx)!.push(f.followedId);
      }
    }

    // Accounts directly connected (follower or following) to one of Me's own accounts
    const personalIds = new Set<string>();
    if (minPersonalConnections > 0) {
      const meIds = await storage.getMeSocialAccountIds();
      if (meIds.length > 0) {
        const meSet = new Set(meIds);
        const rows = await db.select({ followerId: socialFollows.followerId, followedId: socialFollows.followedId })
          .from(socialFollows)
          .where(or(inArray(socialFollows.followerId, meIds), inArray(socialFollows.followedId, meIds)));
        for (const r of rows) {
          if (!meSet.has(r.followerId)) personalIds.add(r.followerId);
          if (!meSet.has(r.followedId)) personalIds.add(r.followedId);
        }
      }
    }

    for (const [commId, memberIdxs] of communities.entries()) {
      const cSize = memberIdxs.length;
      if (cSize < minGroupSize || cSize > maxGroupSize) continue;
      if (minPersonalConnections > 0 &&
          memberIdxs.filter(idx => personalIds.has(nodeIds[idx])).length < minPersonalConnections) continue;

      const memberSet = new Set(memberIdxs);
      let internalWeight = 0;
      let totalIncidentWeight = 0;
      let internalEdgesCount = 0;
      const internalEdges: GraphEdge[] = [];

      for (const edge of graphEdges) {
        const uIn = memberSet.has(edge.u);
        const vIn = memberSet.has(edge.v);
        if (uIn && vIn) {
          internalWeight += edge.weight;
          internalEdgesCount++;
          internalEdges.push(edge);
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
          createdAt: prof?.createdAt || null,
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
        signals: strategy === "hybrid"
          ? buildGroupSignals({
              memberIdxs, internalEdges, internalWeight, edgeSignals, totalDegree: internalDegreeMap,
              followsByFollower, accounts, idToIdx,
              keywordCounts: topKeywords.map(kw => ({ keyword: kw, memberCount: commTokenCounts.get(kw) || 0 })),
            })
          : undefined,
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
        createdAt: p.createdAt || null,
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
  const task = await storage.claimNextPendingTask();
  if (!task) return false;

  log(`[TaskWorker] Processing task ${task.id} (type: ${task.type})`);

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
      case "migrate_profile_image_tiers": {
        result = await processMigrateProfileImageTiers(task.id);
        break;
      }
      case "migrate_image_prefixes": {
        result = await processMigrateImagePrefixes(task.id);
        break;
      }
      case "bake_image_variants": {
        result = await processBakeImageVariants(task.id);
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
      case "import_sms": {
        const payload = JSON.parse(task.payload);
        result = await processImportSms(task.id, payload);
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
          payload: JSON.stringify({ xmlCleared: true }),
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

// ── PRM-S3 backups ──
//
// A prm_s3_backup task runs outside the serial queue: PRM-S3 does the work
// and this only polls its status, so other tasks keep moving meanwhile. The
// route starts the backup and inserts the task already in_progress, which
// keeps getNextPendingTask from ever picking it up.

const PRM_S3_BACKUP_POLL_MS = 2000;
const MAX_PRM_S3_BACKUP_CONSECUTIVE_FAILURES = 15;

function formatGb(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

/** Mirrors PRM-S3's progress for `backupname` onto the task until it ends. */
export async function trackPrmS3BackupTask(taskId: string, backupname: string): Promise<void> {
  let lastProgress = "";
  let lastPct = 0;
  let consecutiveFailures = 0;

  try {
    for (;;) {
      if (await isTaskCancelled(taskId)) {
        try {
          const job = await getPrmS3BackupStatus();
          if (job && job.backupname === backupname && job.state === "running") {
            await cancelPrmS3Backup();
            log(`[PrmS3Backup] ${backupname} cancelled on PRM-S3`);
          }
        } catch (err: any) {
          log(`[PrmS3Backup] cancel ${backupname}: ${err.message}`);
        }
        log(`[PrmS3Backup] ${backupname} cancelled by user`);
        return;
      }
      let job;
      try {
        job = await getPrmS3BackupStatus();
        consecutiveFailures = 0;
      } catch (err: any) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_PRM_S3_BACKUP_CONSECUTIVE_FAILURES) {
          await storage.updateTaskStatus(taskId, "failed", "PRM-S3 backup service unreachable");
          log(`[PrmS3Backup] ${backupname} failed: PRM-S3 unreachable after ${consecutiveFailures} attempts`);
          return;
        }
        // Transient: PRM-S3 may be briefly unreachable. Keep polling.
        await storage.updateTaskProgress(taskId, lastPct, `PRM-S3 unreachable: ${err.message}`);
        lastProgress = "";
        await new Promise((r) => setTimeout(r, PRM_S3_BACKUP_POLL_MS * 5));
        continue;
      }
      if (!job || job.backupname !== backupname) {
        await storage.updateTaskStatus(taskId, "failed", "PRM-S3 is no longer tracking this backup (was it restarted?)");
        return;
      }
      if (job.state === "completed") {
        await storage.updateTaskStatus(taskId, "completed", JSON.stringify({ backupname, zipBytes: job.info?.zipBytes ?? job.doneBytes, files: job.doneFiles }));
        log(`[PrmS3Backup] ${backupname} completed`);
        return;
      }
      if (job.state !== "running") {
        // Cancelled on the PRM-S3 side (e.g. via its API) or failed.
        await storage.updateTaskStatus(taskId, job.state === "cancelled" ? "cancelled" : "failed", job.error || `Backup ${job.state}`);
        return;
      }
      const progress = job.totalBytes ? Math.min(99, Math.floor((job.doneBytes / job.totalBytes) * 100)) : 0;
      const message = job.totalFiles
        ? `${job.doneFiles.toLocaleString()} / ${job.totalFiles.toLocaleString()} files · ${formatGb(job.doneBytes)} / ${formatGb(job.totalBytes)}`
        : "Counting files...";
      if (`${progress}|${message}` !== lastProgress) {
        await storage.updateTaskProgress(taskId, progress, message);
        lastProgress = `${progress}|${message}`;
        lastPct = progress;
      }
      await new Promise((r) => setTimeout(r, PRM_S3_BACKUP_POLL_MS));
    }
  } catch (err: any) {
    log(`[PrmS3Backup] ${backupname} tracking error: ${err.message}`);
    await storage.updateTaskStatus(taskId, "failed", err.message || "Backup tracking failed").catch(() => {});
  }
}

async function recoverStaleTasksOnStartup(): Promise<void> {
  try {
    await db.update(tasks)
      .set({ status: "failed", result: "Interrupted by server restart" })
      .where(and(eq(tasks.status, "in_progress"), ne(tasks.type, "prm_s3_backup")));
  } catch (err) {
    log(`[TaskWorker] Stale task recovery error: ${err}`);
  }

  // Backups run on PRM-S3, so a PRM restart doesn't stop them: pick the
  // tracking back up (it fails the task if PRM-S3 has moved on).
  try {
    const backups = await db.select().from(tasks)
      .where(and(eq(tasks.status, "in_progress"), eq(tasks.type, "prm_s3_backup")));
    for (const t of backups) {
      try {
        let backupname: string | undefined;
        try {
          const parsed = t.payload ? JSON.parse(t.payload) : null;
          backupname = parsed?.backupname;
        } catch {
          // malformed JSON payload
        }
        if (!backupname) {
          await storage.updateTaskStatus(t.id, "failed", "Invalid or missing backupname in payload");
          continue;
        }
        trackPrmS3BackupTask(t.id, backupname).catch(async (err) => {
          log(`[PrmS3Backup] tracking ${t.id} failed: ${err.message}`);
          await storage.updateTaskStatus(t.id, "failed", err.message || "Backup tracking failed").catch(() => {});
        });
      } catch (err: any) {
        log(`[TaskWorker] Stale backup recovery failed for task ${t.id}: ${err.message}`);
        await storage.updateTaskStatus(t.id, "failed", err.message || "Failed during stale task recovery").catch(() => {});
      }
    }
  } catch (err) {
    log(`[TaskWorker] Stale backup recovery query error: ${err}`);
  }

  try {
    await db.update(imageTasks)
      .set({ status: "failed", result: "Interrupted by server restart" })
      .where(eq(imageTasks.status, "in_progress"));
  } catch (err) {
    log(`[TaskWorker] Stale image task recovery error: ${err}`);
  }
}

export function startTaskWorker() {
  log("[TaskWorker] Starting background task worker");
  void recoverStaleTasksOnStartup().finally(() => {
    runWorkerLoop();
    void refreshImageLanes();
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
  if (imageTaskPollTimer) {
    clearTimeout(imageTaskPollTimer);
    imageTaskPollTimer = null;
  }
  sseManager.broadcast("worker.status", { paused: true });
  log("[TaskWorker] Worker paused");
}

export function resumeTaskWorker() {
  isPaused = false;
  sseManager.broadcast("worker.status", { paused: false });
  log("[TaskWorker] Worker resumed");
  runWorkerLoop();
  dispatchImageTasks();
}

export function isTaskWorkerPaused(): boolean {
  return isPaused;
}
