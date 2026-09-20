/**
 * PRM-Compute recognition jobs (faces, OCR, video speech-to-text) shared by the
 * image-page buttons, the image task worker and the automatic pipeline that
 * runs when prm-stories delivers new content.
 */
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { and, desc, eq, gte, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { fetchImageBuffer } from "./prm-s3";
import { faces, imageTasks, people, photos, socialAccountPosts, socialAccounts, type Photo } from "@shared/schema";
import { currentAccess, runAsSystem } from "./access";
import { log } from "./vite";
import { triggerImageTaskWorker } from "./task-worker";
// Only referenced inside functions, so the profile-image -> recognition import
// cycle never reads it before it's initialised.
import { HQ_MIN_WIDTH } from "./profile-image";

// ── Compute connection ────────────────────────────────────────────────────────

/** Compute could not be reached at all (refused, DNS, timeout) — as opposed to it rejecting the item. */
export class ComputeUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputeUnreachableError";
  }
}

/** Older installs saved the compute connection under the prm_face_* keys. */
export async function getComputeConnection(): Promise<{ apiUrl: string; apiKey: string } | null> {
  const apiUrl = (await storage.getAppSetting("prm_compute_api_url")) || (await storage.getAppSetting("prm_face_api_url"));
  const apiKey = (await storage.getAppSetting("prm_compute_api_key")) || (await storage.getAppSetting("prm_face_api_key"));
  if (!apiUrl || !apiKey) return null;
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey };
}

async function computeFetch(pathname: string, form: FormData, timeoutMs: number): Promise<Response> {
  const conn = await getComputeConnection();
  if (!conn) throw new Error("PRM-Compute is not configured.");
  try {
    return await fetch(`${conn.apiUrl}${pathname}`, {
      method: "POST",
      headers: { "X-API-Key": conn.apiKey },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    throw new ComputeUnreachableError(`Could not reach PRM-Compute at ${conn.apiUrl}: ${err?.message ?? err}`);
  }
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export type DetectedFace = {
  face_uuid?: string; faceUuid?: string;
  box?: unknown; coordinates?: unknown;
  person_uuid?: string | null; personId?: string | null;
  [key: string]: unknown;
};

/** One entry of photos.facial_ids. */
export type FacialId = {
  faceUuid: string | undefined;
  coordinates: unknown;
  personId: string | null;
  socialAccountId: string | null;
};

export type ProfileLinkReason =
  | "not_profile" | "no_faces" | "multiple_faces" | "no_box" | "face_too_small"
  | "face_missing" | "group_conflict";

/** What linking a profile picture's face to its account came to. */
export type ProfileLinkOutcome =
  | { linked: true; personfaceUuid: string; alreadyLinked: boolean }
  | { linked: false; reason: ProfileLinkReason };

export type FaceRecognitionResult = {
  facesDetected: number;
  faces: DetectedFace[];
  raw: any;
  profileLink: ProfileLinkOutcome;
};

/**
 * Detect faces on a stored photo and record the run on the photos row. Compute
 * answers 400 for "no faces"; that still counts as a run so the photo isn't
 * picked up again by backfill. A profile picture with one face also links that
 * face to its account (see linkProfileFace).
 */
export async function runFaceRecognition(photoId: string): Promise<FaceRecognitionResult> {
  const [photo] = await db.select().from(photos).where(eq(photos.id, photoId));
  if (!photo) throw new Error("Photo not found.");

  const fetched = await fetchImageBuffer(photo.location);
  const form = new FormData();
  form.append("image", new Blob([fetched.buffer], { type: fetched.mimeType }), path.basename(photo.location) || "image.jpg");
  form.append("photo_id", photo.id);
  form.append("max_faces", "100");

  const response = await computeFetch("/api/img/add", form, 30000);
  let data: any = {};
  if (!response.ok) {
    const errBody = await response.text();
    if (!(response.status === 400 && /no faces/i.test(errBody))) {
      throw new Error(`PRM-Face error: ${errBody}`);
    }
  } else {
    data = await response.json();
  }
  const detected: DetectedFace[] = data.results ?? data.faces ?? [];

  const profileLink = await linkProfileFace(photo, detected, async () => fetched.buffer);
  const facialIds = await resolveFaceIdentities(detected);

  await db.update(photos)
    .set({ facialIds, faceIdAt: new Date() })
    .where(eq(photos.id, photoId));

  return { facesDetected: data.faces_detected ?? detected.length, faces: detected, raw: data, profileLink };
}

/**
 * The facial_ids entries for a detection: whatever compute matched, plus the
 * account whose profile picture shares the face's group (social_accounts.
 * personface_uuid), and that account's owner when it has one.
 */
async function resolveFaceIdentities(detected: DetectedFace[]): Promise<FacialId[]> {
  const ids = detected.map((f) => f.face_uuid || f.faceUuid).filter((id): id is string => !!id);
  const groupOf = new Map<string, string>();
  if (ids.length) {
    const rows = await db.select({ id: faces.id, personfaceUuid: faces.personfaceUuid }).from(faces).where(inArray(faces.id, ids));
    for (const r of rows) if (r.personfaceUuid) groupOf.set(r.id, r.personfaceUuid);
  }
  const accountOf = new Map<string, { id: string; ownerUuid: string | null }>();
  const personOf = new Map<string, string>();
  const groups = Array.from(new Set(groupOf.values()));
  if (groups.length) {
    const saRows = await db
      .select({ id: socialAccounts.id, ownerUuid: socialAccounts.ownerUuid, personfaceUuid: socialAccounts.personfaceUuid })
      .from(socialAccounts)
      .where(inArray(socialAccounts.personfaceUuid, groups));
    for (const r of saRows) if (r.personfaceUuid && !accountOf.has(r.personfaceUuid)) accountOf.set(r.personfaceUuid, r);

    const personRows = await db
      .select({ id: people.id, personfaceUuid: people.personfaceUuid })
      .from(people)
      .where(inArray(people.personfaceUuid, groups));
    for (const r of personRows) if (r.personfaceUuid && !personOf.has(r.personfaceUuid)) personOf.set(r.personfaceUuid, r.id);
  }
  return detected.map((f) => {
    const faceUuid = f.face_uuid || f.faceUuid;
    const group = faceUuid ? groupOf.get(faceUuid) : undefined;
    const account = group ? accountOf.get(group) : undefined;
    const linkedPersonId = group ? personOf.get(group) : undefined;
    return {
      faceUuid,
      coordinates: f.box || f.coordinates || null,
      personId: linkedPersonId || account?.ownerUuid || f.person_uuid || f.personId || null,
      socialAccountId: account?.id ?? null,
    };
  });
}

// ── Profile picture -> account ────────────────────────────────────────────────

const PROFILE_LINK_MIN_FACE_PCT_KEY = "auto_recog_profile_link_min_face_pct";
const PROFILE_LINK_MIN_FACE_PCT_DEFAULT = 25;

/** Smallest face (widest side, as % of the image's shorter side) that counts as the account holder. */
export async function getProfileLinkMinFacePct(): Promise<number> {
  const raw = Number(await storage.getAppSetting(PROFILE_LINK_MIN_FACE_PCT_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : PROFILE_LINK_MIN_FACE_PCT_DEFAULT;
}

const profileAccountId = (photo: Pick<Photo, "prmLocation">): string | null =>
  photo.prmLocation?.startsWith("profile_image:") ? photo.prmLocation.slice("profile_image:".length).trim() || null : null;

/**
 * A profile picture showing exactly one big-enough face is the account holder:
 * put that face's group on social_accounts.personface_uuid so the same face in
 * any other photo can be named "@username" without a person existing yet. When
 * the account already has an owner, the owner's face group is used (and set if
 * the person had none), matching what /api/prm-face/face/connect would do.
 */
async function linkProfileFace(photo: Photo, detected: DetectedFace[], getBuffer: () => Promise<Buffer>): Promise<ProfileLinkOutcome> {
  const accountId = profileAccountId(photo);
  if (!accountId) return { linked: false, reason: "not_profile" };
  if (detected.length === 0) return { linked: false, reason: "no_faces" };
  if (detected.length > 1) return { linked: false, reason: "multiple_faces" };

  const face = detected[0];
  const box = (face.box || face.coordinates) as { w?: number; h?: number } | null;
  if (!box || !(box.w! > 0) || !(box.h! > 0)) return { linked: false, reason: "no_box" };
  let { widthPx, heightPx } = photo;
  if (!widthPx || !heightPx) {
    const meta = await sharp(await getBuffer()).metadata();
    widthPx = meta.width ?? null;
    heightPx = meta.height ?? null;
  }
  if (!widthPx || !heightPx) return { linked: false, reason: "no_box" };
  const facePct = (Math.max(box.w!, box.h!) / Math.min(widthPx, heightPx)) * 100;
  if (facePct < await getProfileLinkMinFacePct()) return { linked: false, reason: "face_too_small" };

  const faceUuid = face.face_uuid || face.faceUuid;
  const [faceRow] = faceUuid
    ? await db.select({ id: faces.id, personfaceUuid: faces.personfaceUuid }).from(faces).where(eq(faces.id, faceUuid))
    : [];
  if (!faceRow) return { linked: false, reason: "face_missing" };

  const [account] = await db
    .select({ ownerUuid: socialAccounts.ownerUuid, personfaceUuid: socialAccounts.personfaceUuid })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, accountId));
  if (!account) return { linked: false, reason: "not_profile" };
  const [owner] = account.ownerUuid
    ? await db.select({ id: people.id, personfaceUuid: people.personfaceUuid }).from(people).where(eq(people.id, account.ownerUuid))
    : [];

  const target = account.personfaceUuid ?? owner?.personfaceUuid ?? faceRow.personfaceUuid ?? crypto.randomUUID();
  // Compute already grouped this face with a different identity: leave both alone.
  if (faceRow.personfaceUuid && faceRow.personfaceUuid !== target) return { linked: false, reason: "group_conflict" };

  const alreadyLinked = account.personfaceUuid === target && faceRow.personfaceUuid === target;
  if (faceRow.personfaceUuid !== target) await db.update(faces).set({ personfaceUuid: target }).where(eq(faces.id, faceRow.id));
  if (account.personfaceUuid !== target) await db.update(socialAccounts).set({ personfaceUuid: target }).where(eq(socialAccounts.id, accountId));
  if (owner && !owner.personfaceUuid) await db.update(people).set({ personfaceUuid: target }).where(eq(people.id, owner.id));
  if (!alreadyLinked) log(`[ProfileLink] account ${accountId} <- face ${faceRow.id} (${facePct.toFixed(0)}% of image)`);
  return { linked: true, personfaceUuid: target, alreadyLinked };
}

export type AssociateProfileFacesResult = { examined: number; linked: number; skipped: Partial<Record<ProfileLinkReason, number>> };

/**
 * "Associate" on Recognition settings: link already-recognised current profile
 * pictures to accounts that have no face yet, from the stored facial_ids, with
 * no new compute run. The image is only fetched when the photo row lacks its
 * dimensions.
 */
export async function associateProfileFaces(): Promise<AssociateProfileFacesResult> {
  const rows = await db
    .select({ photo: photos })
    .from(photos)
    .innerJoin(socialAccounts, eq(photos.prmLocation, sql`'profile_image:' || ${socialAccounts.id}`))
    .where(and(
      eq(photos.isSubImage, false),
      gte(photos.widthPx, HQ_MIN_WIDTH),
      isNotNull(photos.faceIdAt),
      isNull(socialAccounts.personfaceUuid),
      eq(photos.location, socialAccounts.imageUrl),
    ));
  const result: AssociateProfileFacesResult = { examined: rows.length, linked: 0, skipped: {} };
  for (const { photo } of rows) {
    const detected: DetectedFace[] = ((photo.facialIds ?? []) as FacialId[]).map((f) => ({ face_uuid: f.faceUuid, box: f.coordinates }));
    const outcome = await linkProfileFace(photo, detected, async () => (await fetchImageBuffer(photo.location)).buffer);
    if (outcome.linked) result.linked++;
    else result.skipped[outcome.reason] = (result.skipped[outcome.reason] ?? 0) + 1;
  }
  return result;
}

/** Big enough for recognition: the 150px tier is skipped everywhere. */
const isHqPhoto = (photo: Pick<Photo, "widthPx">) => (photo.widthPx ?? 0) >= HQ_MIN_WIDTH;

/**
 * The account's current profile picture and earlier full-size ones still registered under it, newest first.
 */
export async function profilePhotos(accountId: string): Promise<{ current: Photo | null; previous: Photo[] }> {
  const [account] = await db
    .select({ imageUrl: socialAccounts.imageUrl })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, accountId));
  if (!account) throw new Error("Social account not found.");
  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.prmLocation, `profile_image:${accountId}`), eq(photos.isSubImage, false)))
    .orderBy(desc(photos.uploadedAt));
  const currentUrl = account.imageUrl;
  const current = rows.find((p) => p.location === currentUrl) ?? null;
  return { current, previous: rows.filter((p) => p !== current && isHqPhoto(p)) };
}

export type ProfilePhotoRun = { photoId: string; facesDetected: number; profileLink: ProfileLinkOutcome };

/** Face recognition on an account's profile picture(s), synchronously, for the account page. */
export async function recognizeProfilePhotos(accountId: string, includePrevious: boolean): Promise<ProfilePhotoRun[]> {
  const { current, previous } = await profilePhotos(accountId);
  if (!current) throw new Error("This account has no stored profile picture.");
  if (!isHqPhoto(current)) throw new Error(`The stored profile picture is only ${current.widthPx ?? "?"}px wide; recognition needs a ${HQ_MIN_WIDTH}px copy.`);
  const targets = includePrevious ? [current, ...previous] : [current];
  const runs: ProfilePhotoRun[] = [];
  for (const photo of targets) {
    const { facesDetected, profileLink } = await runFaceRecognition(photo.id);
    runs.push({ photoId: photo.id, facesDetected, profileLink });
  }
  return runs;
}

export type OcrOptions = { min_score?: unknown; model?: unknown; photo_id?: string };

/** OCR on raw bytes. With `photo_id`, compute writes photos.ocr_data / ocr_at itself. */
export async function runOcrOnBuffer(buffer: Buffer, mimeType: string, fileName: string, opts: OcrOptions): Promise<any> {
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: mimeType || "image/jpeg" }), fileName || "image.jpg");
  if (opts.min_score !== undefined && opts.min_score !== "") form.append("min_score", String(opts.min_score));
  // Optional preset override ("v5-mobile" | "v5-server"); defaults to the configured one.
  if (opts.model) form.append("model", String(opts.model));
  if (opts.photo_id) form.append("photo_id", opts.photo_id);

  const response = await computeFetch("/api/ocr", form, 45000);
  if (!response.ok) throw new Error(`PRM-Compute OCR error: ${await response.text()}`);
  return response.json();
}

export async function runOcr(photoId: string, opts: Omit<OcrOptions, "photo_id"> = {}): Promise<any> {
  const [photo] = await db.select().from(photos).where(eq(photos.id, photoId));
  if (!photo) throw new Error("Photo not found.");
  const fetched = await fetchImageBuffer(photo.location);
  return runOcrOnBuffer(fetched.buffer, fetched.mimeType, path.basename(photo.location) || "image.jpg", { ...opts, photo_id: photoId });
}

export type WhisperResult = {
  text: string;
  segments: { start: number; end: number; text: string }[];
  language: string;
  duration: number;
  model: string;
  device: "cuda" | "cpu";
};

/** Compute's Whisper refuses uploads above this. */
const WHISPER_MAX_BYTES = 50 * 1024 * 1024;

/** The media itself can't be transcribed (too big, no audio track); retrying won't help. */
export class MediaRejectedError extends Error {}

export async function transcribeBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  opts: { model?: string; language?: string } = {},
): Promise<WhisperResult> {
  if (buffer.length > WHISPER_MAX_BYTES) {
    throw new MediaRejectedError(`Media is ${(buffer.length / 1024 / 1024).toFixed(1)} MB; PRM-Compute Whisper accepts up to 50 MB.`);
  }
  const form = new FormData();
  form.append("audio", new Blob([buffer], { type: mimeType || "audio/webm" }), fileName || "audio.webm");
  if (opts.model) form.append("model", opts.model);
  if (opts.language) form.append("language", opts.language);
  const response = await computeFetch("/api/whisper", form, 120000);
  if (!response.ok) {
    const message = `PRM-Compute Whisper returned ${response.status}: ${(await response.text()).slice(0, 200)}`;
    throw response.status >= 400 && response.status < 500 ? new MediaRejectedError(message) : new Error(message);
  }
  return response.json() as Promise<WhisperResult>;
}

export type VideoTranscript = {
  text: string;
  language: string;
  segments: { start: number; end: number; text: string }[];
  /** Set when the media was rejected; the row is stamped so backfill stops re-queueing it. */
  error?: string;
};

/** Speech-to-text on a post's video (metadata.videoUrl), stored on the post row. */
export async function transcribeVideo(postId: string): Promise<VideoTranscript> {
  const [post] = await db.select({ metadata: socialAccountPosts.metadata }).from(socialAccountPosts).where(eq(socialAccountPosts.id, postId));
  if (!post) throw new Error("Post not found.");
  const videoUrl = (post.metadata as { videoUrl?: string } | null)?.videoUrl;
  if (!videoUrl) throw new Error("Post has no video.");

  const store = (transcript: VideoTranscript) =>
    db.update(socialAccountPosts)
      .set({ videoTranscript: transcript, videoTranscriptAt: new Date() })
      .where(eq(socialAccountPosts.id, postId));

  const fetched = await fetchImageBuffer(videoUrl);
  let result: WhisperResult;
  try {
    result = await transcribeBuffer(fetched.buffer, "video/mp4", path.basename(videoUrl) || "video.mp4");
  } catch (error) {
    if (error instanceof MediaRejectedError) await store({ text: "", language: "", segments: [], error: error.message });
    throw error;
  }
  const transcript: VideoTranscript = {
    text: result.text ?? "",
    language: result.language ?? "",
    segments: (result.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
  };
  await store(transcript);
  return transcript;
}

// ── Automatic runs on new content ─────────────────────────────────────────────

export type AutoRecognitionKind = "profile" | "post" | "story";
export type AutoRecognitionJob = "face" | "ocr" | "transcribe";

export type AutoRecognitionSettings = {
  profile: { face: boolean };
  post: { face: boolean; ocr: boolean; transcribe: boolean };
  story: { face: boolean; ocr: boolean; transcribe: boolean };
  profileLink: { minFacePct: number };
};

const AUTO_RECOGNITION_KEYS: Record<AutoRecognitionKind, Partial<Record<AutoRecognitionJob, string>>> = {
  profile: { face: "auto_recog_profile_face" },
  post: { face: "auto_recog_post_face", ocr: "auto_recog_post_ocr", transcribe: "auto_recog_post_transcribe" },
  story: { face: "auto_recog_story_face", ocr: "auto_recog_story_ocr", transcribe: "auto_recog_story_transcribe" },
};

export const JOB_TASK_TYPE: Record<AutoRecognitionJob, string> = {
  face: "analyze_img_face",
  ocr: "analyze_img_ocr",
  transcribe: "transcribe_video",
};

/** Task types that need PRM-Compute; the worker holds these back while compute is down. */
export const RECOGNITION_TASK_TYPES = Object.values(JOB_TASK_TYPE);

export async function getAutoRecognitionSettings(): Promise<AutoRecognitionSettings> {
  const read = async (key?: string) => (key ? (await storage.getAppSetting(key)) === "true" : false);
  const out = {} as AutoRecognitionSettings;
  for (const kind of Object.keys(AUTO_RECOGNITION_KEYS) as AutoRecognitionKind[]) {
    const keys = AUTO_RECOGNITION_KEYS[kind];
    (out as any)[kind] = {
      face: await read(keys.face),
      ...(keys.ocr ? { ocr: await read(keys.ocr), transcribe: await read(keys.transcribe) } : {}),
    };
  }
  out.profileLink = { minFacePct: await getProfileLinkMinFacePct() };
  return out;
}

export async function setAutoRecognitionSettings(
  update: Partial<Record<AutoRecognitionKind, Partial<Record<AutoRecognitionJob, boolean>>>> & { profileLink?: { minFacePct?: unknown } },
): Promise<void> {
  for (const kind of Object.keys(AUTO_RECOGNITION_KEYS) as AutoRecognitionKind[]) {
    const keys = AUTO_RECOGNITION_KEYS[kind];
    for (const job of Object.keys(keys) as AutoRecognitionJob[]) {
      const value = update[kind]?.[job];
      if (typeof value === "boolean") await storage.setAppSetting(keys[job]!, value ? "true" : "false");
    }
  }
  const pct = Number(update.profileLink?.minFacePct);
  if (Number.isFinite(pct) && pct > 0 && pct <= 100) await storage.setAppSetting(PROFILE_LINK_MIN_FACE_PCT_KEY, String(pct));
}

/**
 * Who owns the queued tasks (image_tasks.userId is NOT NULL and the Image Tasks
 * page only lists the caller's own). A signed-in caller (backfill) owns theirs;
 * system callers (ingestion hooks) fall back to the highest-ranked admin.
 */
async function queueOwnerId(): Promise<number | undefined> {
  const ctx = currentAccess();
  if (ctx?.userId) return ctx.userId;
  const rank: Record<string, number> = { super_admin: 0, admin: 1, user: 2 };
  const users = await runAsSystem(() => storage.getAllUsers());
  users.sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.id - b.id);
  return users[0]?.id;
}

/** Ids among `ids` (photoId or payload postId) that already have a live task of `type`. */
async function alreadyQueued(type: string, ids: string[], key: "photoId" | "postId"): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ photoId: imageTasks.photoId, payload: imageTasks.payload })
    .from(imageTasks)
    .where(and(eq(imageTasks.type, type), inArray(imageTasks.status, ["pending", "in_progress"])));
  const wanted = new Set(ids);
  const live = new Set<string>();
  for (const row of rows) {
    const id = key === "photoId" ? row.photoId : (JSON.parse(row.payload || "{}") as { postId?: string }).postId;
    if (id && wanted.has(id)) live.add(id);
  }
  return live;
}

/**
 * Queue recognition jobs for photos / a post's video. Returns how many tasks
 * were created. Skips targets that already have a pending or running task of
 * that type, so redelivered content doesn't double up.
 */
export async function enqueueRecognitionTasks(input: {
  jobs: AutoRecognitionJob[];
  photoIds?: string[];
  videoPostIds?: string[];
}): Promise<number> {
  const userId = await queueOwnerId();
  if (!userId) return 0;
  let queued = 0;

  for (const job of input.jobs) {
    const type = JOB_TASK_TYPE[job];
    if (job === "transcribe") {
      const ids = input.videoPostIds ?? [];
      const live = await alreadyQueued(type, ids, "postId");
      for (const postId of ids) {
        if (live.has(postId)) continue;
        await storage.createImageTask({ userId, type, payload: JSON.stringify({ postId }) });
        queued++;
      }
    } else {
      const ids = input.photoIds ?? [];
      const live = await alreadyQueued(type, ids, "photoId");
      for (const photoId of ids) {
        if (live.has(photoId)) continue;
        await storage.createImageTask({ userId, type, photoId, payload: JSON.stringify({ photoId }) });
        queued++;
      }
    }
  }
  if (queued) triggerImageTaskWorker();
  return queued;
}

/**
 * Ingestion hook: queue whatever the settings enable for this kind of content.
 * Never throws — a queueing problem must not fail the delivery that called it.
 */
export async function enqueueAutoRecognition(input: {
  kind: AutoRecognitionKind;
  photoIds: string[];
  /** The post whose metadata.videoUrl should be transcribed, when it has one. */
  videoPostId?: string;
}): Promise<void> {
  try {
    const settings = (await getAutoRecognitionSettings())[input.kind] as Partial<Record<AutoRecognitionJob, boolean>>;
    const jobs = (Object.keys(settings) as AutoRecognitionJob[]).filter((job) => settings[job]);
    if (!jobs.length) return;
    const queued = await enqueueRecognitionTasks({
      jobs,
      photoIds: input.photoIds,
      videoPostIds: input.videoPostId ? [input.videoPostId] : [],
    });
    if (queued) log(`[AutoRecognition] queued ${queued} ${input.kind} task(s) for ${input.photoIds.length} photo(s)`);
  } catch (err) {
    console.error("[AutoRecognition] failed to queue:", err);
  }
}

// ── Backfill ──────────────────────────────────────────────────────────────────

const STORY_KINDS: Record<AutoRecognitionKind, "story" | "not_story" | "profile"> = { profile: "profile", post: "not_story", story: "story" };

/** Non-thumbnail photos of `kind` whose `job` has never run and isn't queued. */
async function unprocessedPhotoIds(kind: AutoRecognitionKind, job: "face" | "ocr"): Promise<string[]> {
  const stampColumn = job === "face" ? photos.faceIdAt : photos.ocrAt;
  const noLiveTask = notExists(
    db.select({ one: sql`1` }).from(imageTasks).where(and(
      eq(imageTasks.photoId, photos.id),
      eq(imageTasks.type, JOB_TASK_TYPE[job]),
      inArray(imageTasks.status, ["pending", "in_progress"]),
    )),
  );
  const conditions = [isNull(stampColumn), eq(photos.isSubImage, false), noLiveTask];
  if (STORY_KINDS[kind] === "profile") {
    // Never the 150px tier: too small to embed, and its 1080 sibling gets the run.
    conditions.push(sql`${photos.prmLocation} LIKE 'profile_image:%'`, gte(photos.widthPx, HQ_MIN_WIDTH));
  } else {
    const isStory = STORY_KINDS[kind] === "story";
    conditions.push(sql`${photos.prmLocation} LIKE 'post:%'`);
    conditions.push(sql`EXISTS (SELECT 1 FROM ${socialAccountPosts} WHERE ${socialAccountPosts.id} = substring(${photos.prmLocation} from 6) AND ${socialAccountPosts.postType} ${sql.raw(isStory ? "=" : "<>")} 'story')`);
  }
  const rows = await db.select({ id: photos.id }).from(photos).where(and(...conditions)).orderBy(photos.uploadedAt);
  return rows.map((r) => r.id);
}

/** Posts of `kind` with a stored video and no transcript yet. */
async function untranscribedPostIds(kind: "post" | "story"): Promise<string[]> {
  const rows = await db
    .select({ id: socialAccountPosts.id })
    .from(socialAccountPosts)
    .where(and(
      isNull(socialAccountPosts.videoTranscriptAt),
      sql`${socialAccountPosts.metadata}->>'videoUrl' IS NOT NULL`,
      kind === "story" ? eq(socialAccountPosts.postType, "story") : sql`${socialAccountPosts.postType} <> 'story'`,
    ))
    .orderBy(socialAccountPosts.createdAt);
  const ids = rows.map((r) => r.id);
  const live = await alreadyQueued(JOB_TASK_TYPE.transcribe, ids, "postId");
  return ids.filter((id) => !live.has(id));
}

export async function backfillTargets(kind: AutoRecognitionKind, job: AutoRecognitionJob): Promise<{ photoIds: string[]; videoPostIds: string[] }> {
  if (job === "transcribe") {
    if (kind === "profile") return { photoIds: [], videoPostIds: [] };
    return { photoIds: [], videoPostIds: await untranscribedPostIds(kind) };
  }
  if (kind === "profile" && job === "ocr") return { photoIds: [], videoPostIds: [] };
  return { photoIds: await unprocessedPhotoIds(kind, job), videoPostIds: [] };
}

export type BackfillCounts = Record<AutoRecognitionKind, Partial<Record<AutoRecognitionJob, number>>>;

export async function backfillCounts(): Promise<BackfillCounts> {
  const out = {} as BackfillCounts;
  for (const kind of Object.keys(AUTO_RECOGNITION_KEYS) as AutoRecognitionKind[]) {
    out[kind] = {};
    for (const job of Object.keys(AUTO_RECOGNITION_KEYS[kind]) as AutoRecognitionJob[]) {
      const targets = await backfillTargets(kind, job);
      out[kind][job] = targets.photoIds.length + targets.videoPostIds.length;
    }
  }
  return out;
}

export async function runBackfill(kind: AutoRecognitionKind, job: AutoRecognitionJob): Promise<number> {
  const targets = await backfillTargets(kind, job);
  return enqueueRecognitionTasks({ jobs: [job], ...targets });
}
