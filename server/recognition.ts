/**
 * PRM-Compute recognition jobs (faces, OCR, video speech-to-text) shared by the
 * image-page buttons, the image task worker and the automatic pipeline that
 * runs when prm-stories delivers new content.
 */
import path from "path";
import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { fetchImageBuffer } from "./prm-s3";
import { imageTasks, photos, socialAccountPosts } from "@shared/schema";
import { currentAccess, runAsSystem } from "./access";
import { log } from "./vite";
import { triggerImageTaskWorker } from "./task-worker";

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

/**
 * Detect faces on a stored photo and record the run on the photos row. Compute
 * answers 400 for "no faces"; that still counts as a run so the photo isn't
 * picked up again by backfill.
 */
export async function runFaceRecognition(photoId: string): Promise<{ facesDetected: number; faces: DetectedFace[]; raw: any }> {
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
  const faces: DetectedFace[] = data.results ?? data.faces ?? [];

  await db.update(photos)
    .set({
      facialIds: faces.map((f) => ({
        faceUuid: f.face_uuid || f.faceUuid,
        coordinates: f.box || f.coordinates || null,
        personId: f.person_uuid || f.personId || null,
        socialAccountId: null,
      })),
      faceIdAt: new Date(),
    })
    .where(eq(photos.id, photoId));

  return { facesDetected: data.faces_detected ?? faces.length, faces, raw: data };
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
  return out;
}

export async function setAutoRecognitionSettings(update: Partial<Record<AutoRecognitionKind, Partial<Record<AutoRecognitionJob, boolean>>>>): Promise<void> {
  for (const kind of Object.keys(AUTO_RECOGNITION_KEYS) as AutoRecognitionKind[]) {
    const keys = AUTO_RECOGNITION_KEYS[kind];
    for (const job of Object.keys(keys) as AutoRecognitionJob[]) {
      const value = update[kind]?.[job];
      if (typeof value === "boolean") await storage.setAppSetting(keys[job]!, value ? "true" : "false");
    }
  }
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
    conditions.push(sql`${photos.prmLocation} LIKE 'profile_image:%'`);
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
