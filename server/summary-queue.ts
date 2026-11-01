import { and, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { log } from "./vite";
import {
  appSettings,
  faces,
  historicalAccountSummaries,
  people,
  photos,
  socialAccountPosts,
  socialAccounts,
  summaryJobs,
  type AccountAiSummary,
  type AiBackendNote,
  type PostAiSummary,
  type PostImageSummary,
  type SocialAccountPost,
  type SummaryJob,
  type SummaryJobImageResult,
  type SummaryJobProgress,
} from "@shared/schema";
import { INTEREST_LEVELS, type InterestLevel } from "@shared/interest-level";
import { fetchImageBuffer } from "./prm-s3";
import { describeImage } from "./ai/describe";
import { bannedActions } from "./banned-actions";
import { syncEntityInBackground } from "./vector-universal";
import { asData, chat, DATA_TAGS_NOTE, listProviders, resolveModel, type AiTask, type ResolvedModel } from "./ai/provider";
import { hostPoolSlots, runOnHost, setHostPool } from "./ai/host-pool";
import { connectionsForPrompt } from "./connection-strength";
import { getPrompt } from "./prompts";

export const SUMMARY_POST_ENABLED_KEY = "summary_post_enabled";
export const SUMMARY_POST_AUTO_ENABLED_KEY = "summary_post_auto_enabled";
export const SUMMARY_ACCOUNT_ENABLED_KEY = "summary_account_enabled";
export const SUMMARY_ACCOUNT_AUTO_ENABLED_KEY = "summary_account_auto_enabled";
export const SUMMARY_SCENE_PROVIDER_KEY = "summary_scene_provider";
export const SUMMARY_SCENE_MODEL_KEY = "summary_scene_model";
export const SUMMARY_TEXT_PROVIDER_KEY = "summary_text_provider";
export const SUMMARY_TEXT_MODEL_KEY = "summary_text_model";
export const SUMMARY_POST_MAX_WORDS_KEY = "summary_post_max_words";
// "true" sends think:false to Ollama for that step.
export const SUMMARY_SCENE_NO_THINK_KEY = "summary_scene_no_think";
export const SUMMARY_POST_NO_THINK_KEY = "summary_post_no_think";
export const SUMMARY_STORY_NO_THINK_KEY = "summary_story_no_think";
export const SUMMARY_ACCOUNT_NO_THINK_KEY = "summary_account_no_think";
// JSON [{ providerId, slots }]: Ollama hosts summary runs spread across. Empty = one job at a time on the scene/text providers.
export const SUMMARY_HOST_POOL_KEY = "summary_host_pool";

export type HostPoolEntry = { providerId: string; slots: number; mlx?: boolean };

// Caps each post summary so the account prompt (built from every post summary) stays bounded.
export const DEFAULT_POST_MAX_WORDS = 400;

const MAX_ATTEMPTS = 3;
// Newest notes per person/account sent into a prompt.
const KNOWN_FACTS_PER_ENTITY = 20;
// The account summary only reads the most recent posts, keeping its prompt within the model's context.
const ACCOUNT_SUMMARY_MAX_POSTS = 100;
// ...and its strongest connections from the Connections tab.
const ACCOUNT_SUMMARY_MAX_CONNECTIONS = 20;
// Fallback only: enqueueing wakes the runner directly.
const TICK_MS = 60_000;

// Off = leave thinking at the model's default rather than forcing it on.
const thinkFlag = (noThink: boolean) => (noThink ? false : undefined);

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type SummarySettings = {
  postEnabled: boolean;
  postAutoEnabled: boolean;
  accountEnabled: boolean;
  accountAutoEnabled: boolean;
  sceneModel: { providerId: string; model: string };
  textModel: { providerId: string; model: string };
  scenePrompt: string;
  postPrompt: string;
  storyPrompt: string;
  accountPrompt: string;
  notesPrompt: string;
  postMaxWords: number;
  sceneNoThink: boolean;
  postNoThink: boolean;
  storyNoThink: boolean;
  accountNoThink: boolean;
  hostPool: HostPoolEntry[];
};

function parseHostPool(raw: string | undefined | null): HostPoolEntry[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e?.providerId === "string" && Number(e.slots) >= 1) : [];
  } catch {
    return [];
  }
}

const SUMMARY_SETTINGS_KEYS = [
  SUMMARY_POST_ENABLED_KEY,
  SUMMARY_POST_AUTO_ENABLED_KEY,
  SUMMARY_ACCOUNT_ENABLED_KEY,
  SUMMARY_ACCOUNT_AUTO_ENABLED_KEY,
  SUMMARY_SCENE_PROVIDER_KEY,
  SUMMARY_SCENE_MODEL_KEY,
  SUMMARY_TEXT_PROVIDER_KEY,
  SUMMARY_TEXT_MODEL_KEY,
  SUMMARY_POST_MAX_WORDS_KEY,
  SUMMARY_SCENE_NO_THINK_KEY,
  SUMMARY_POST_NO_THINK_KEY,
  SUMMARY_STORY_NO_THINK_KEY,
  SUMMARY_ACCOUNT_NO_THINK_KEY,
  SUMMARY_HOST_POOL_KEY,
] as const;

let cachedSummarySettings: SummarySettings | null = null;
let summarySettingsLastFetchedAt = 0;
const SUMMARY_SETTINGS_TTL_MS = 60_000;

export function invalidateSummarySettingsCache(): void {
  cachedSummarySettings = null;
  summarySettingsLastFetchedAt = 0;
}

export async function loadSummarySettings(force = false): Promise<SummarySettings> {
  if (!force && cachedSummarySettings && Date.now() - summarySettingsLastFetchedAt < SUMMARY_SETTINGS_TTL_MS) {
    return cachedSummarySettings;
  }

  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, SUMMARY_SETTINGS_KEYS as unknown as string[]));

  const map = new Map<string, string | null>(rows.map((r) => [r.key, r.value]));

  const postEnabled = map.get(SUMMARY_POST_ENABLED_KEY);
  const postAutoEnabled = map.get(SUMMARY_POST_AUTO_ENABLED_KEY);
  const accountEnabled = map.get(SUMMARY_ACCOUNT_ENABLED_KEY);
  const accountAutoEnabled = map.get(SUMMARY_ACCOUNT_AUTO_ENABLED_KEY);
  const sceneProvider = map.get(SUMMARY_SCENE_PROVIDER_KEY);
  const sceneModel = map.get(SUMMARY_SCENE_MODEL_KEY);
  const textProvider = map.get(SUMMARY_TEXT_PROVIDER_KEY);
  const textModel = map.get(SUMMARY_TEXT_MODEL_KEY);
  const postMaxWords = map.get(SUMMARY_POST_MAX_WORDS_KEY);
  const sceneNoThink = map.get(SUMMARY_SCENE_NO_THINK_KEY);
  const postNoThink = map.get(SUMMARY_POST_NO_THINK_KEY);
  const storyNoThink = map.get(SUMMARY_STORY_NO_THINK_KEY);
  const accountNoThink = map.get(SUMMARY_ACCOUNT_NO_THINK_KEY);
  const hostPool = map.get(SUMMARY_HOST_POOL_KEY);

  const settings: SummarySettings = {
    postEnabled: postEnabled === "true",
    postAutoEnabled: postAutoEnabled === "true",
    accountEnabled: accountEnabled === "true",
    accountAutoEnabled: accountAutoEnabled === "true",
    sceneModel: { providerId: sceneProvider ?? "", model: sceneModel ?? "" },
    textModel: { providerId: textProvider ?? "", model: textModel ?? "" },
    scenePrompt: await getPrompt("summaryScene"),
    postPrompt: await getPrompt("summaryPost"),
    storyPrompt: await getPrompt("summaryStory"),
    accountPrompt: await getPrompt("summaryAccount"),
    notesPrompt: await getPrompt("summaryNotes"),
    postMaxWords: Number(postMaxWords) || DEFAULT_POST_MAX_WORDS,
    sceneNoThink: sceneNoThink === "true",
    postNoThink: postNoThink === "true",
    storyNoThink: storyNoThink === "true",
    accountNoThink: accountNoThink === "true",
    hostPool: parseHostPool(hostPool),
  };

  cachedSummarySettings = settings;
  summarySettingsLastFetchedAt = Date.now();
  return settings;
}

// ── Host pool ────────────────────────────────────────────────────────────────

let poolInitialized = false;

/** Reload the pool from settings, dropping providers that no longer exist. Returns its total slots. */
export async function refreshHostPool(): Promise<number> {
  const entries = parseHostPool(await storage.getAppSetting(SUMMARY_HOST_POOL_KEY));
  const providers = entries.length ? await listProviders() : [];
  setHostPool(entries.flatMap(({ providerId, slots, mlx }) => {
    const provider = providers.find((p) => p.id === providerId);
    return provider ? [{ provider, slots, mlx: mlx === true }] : [];
  }));
  poolInitialized = true;
  return hostPoolSlots();
}

/** A step's (provider, model). With the pool on only the model name matters, so a stale provider id is ignored. */
function resolveStep(task: AiTask, step: { providerId: string; model: string }): Promise<ResolvedModel> {
  if (!step.model) return resolveModel(task);
  return resolveModel(task, hostPoolSlots() > 0 ? { model: step.model } : step);
}

/** Run one AI call on a free pool host (same model) when the pool is on; otherwise on the resolved provider. */
function onHost<T>(resolved: ResolvedModel, fn: (r: ResolvedModel) => Promise<T>): Promise<T> {
  return hostPoolSlots() > 0 ? runOnHost(resolved, (provider, model) => fn({ provider, model })) : fn(resolved);
}

/** Progress writes queued in order, so concurrent image updates can't land an older snapshot last. */
function progressSaver(jobId: string, progress: SummaryJobProgress): () => Promise<void> {
  let chain = Promise.resolve();
  return () => (chain = chain.catch(() => {}).then(async () => {
    await db.update(summaryJobs).set({ progress }).where(eq(summaryJobs.id, jobId));
  }));
}

// ── Queue Helpers ────────────────────────────────────────────────────────────

export async function enqueueSummaryJob(
  kind: "post" | "account",
  targetId: string,
  socialAccountId: string,
  options: Record<string, unknown> = {},
): Promise<boolean> {
  const [inserted] = await db
    .insert(summaryJobs)
    .values({
      kind,
      targetId,
      socialAccountId,
      status: "pending",
      options,
    })
    .onConflictDoNothing()
    .returning({ id: summaryJobs.id });

  if (inserted) wakeSummaryRunner();
  return !!inserted;
}

/**
 * Triggered when a post or story is added:
 * 1. Are post summaries enabled (and auto post summaries on)?
 *    - No -> do nothing
 *    - Yes -> enqueue post summary (which will later check account summary invalidation & auto account summary)
 */
export async function onPostAddedForSummary(postId: string, socialAccountId: string): Promise<void> {
  try {
    const settings = await loadSummarySettings();
    if (!settings.postEnabled || !settings.postAutoEnabled) return;
    if ((await bannedActions(socialAccountId)).includes("summary")) return;
    await enqueueSummaryJob("post", postId, socialAccountId);
  } catch (err) {
    log(`[SummaryQueue] Failed to handle post added ${postId}: ${errorMessage(err)}`);
  }
}

// One INSERT ... SELECT per sweep: a bulk run can cover thousands of posts.
async function enqueuePostsWhere(filter: SQL): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO summary_jobs (kind, target_id, social_account_id)
    SELECT 'post', p.id, p.social_account_id FROM social_account_posts p
    JOIN social_accounts a ON a.id = p.social_account_id
    WHERE ${filter} AND NOT 'summary' = ANY(a.banned_actions)
    ON CONFLICT DO NOTHING
  `);
  return result.rowCount ?? 0;
}

// Only the posts the account summary will read (its newest ACCOUNT_SUMMARY_MAX_POSTS); same order as runAccountSummaryJob.
async function enqueueRecentPostsForAccounts(accountFilter: SQL): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO summary_jobs (kind, target_id, social_account_id)
    SELECT 'post', r.id, r.social_account_id FROM (
      SELECT p.id, p.social_account_id, p.ai_summary,
        row_number() OVER (PARTITION BY p.social_account_id ORDER BY coalesce(p.posted_at, p.created_at) DESC, p.id DESC) AS rn
      FROM social_account_posts p JOIN social_accounts a ON a.id = p.social_account_id
      WHERE ${accountFilter}
    ) r
    WHERE r.rn <= ${ACCOUNT_SUMMARY_MAX_POSTS} AND r.ai_summary IS NULL
    ON CONFLICT DO NOTHING
  `);
  return result.rowCount ?? 0;
}

// postsQueued snapshots the post jobs the account job will wait on, for its "waiting on X/Y posts" bar.
async function enqueueAccountsWhere(filter: SQL): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO summary_jobs (kind, target_id, social_account_id, options)
    SELECT 'account', a.id, a.id, jsonb_build_object('postsQueued', (
      SELECT count(*) FROM summary_jobs p
      WHERE p.kind = 'post' AND p.social_account_id = a.id AND p.status IN ('pending', 'running')
    )) FROM social_accounts a
    WHERE ${filter}
    ON CONFLICT DO NOTHING
  `);
  return result.rowCount ?? 0;
}

/**
 * Queue all unsummarized historical posts across all accounts.
 */
// `only` narrows to stories ('story') or everything else ('post'); omitted queues both.
export async function enqueueAllHistoricalPosts(includeSummarized = false, only?: "post" | "story"): Promise<number> {
  const typeFilter = only === "story" ? sql`p.post_type = 'story'` : only === "post" ? sql`p.post_type <> 'story'` : sql`true`;
  const queued = await enqueuePostsWhere(sql`${typeFilter} AND ${includeSummarized ? sql`true` : sql`p.ai_summary IS NULL`}`);
  if (queued) wakeSummaryRunner();
  return queued;
}

/**
 * Queue account summaries (and their unsummarized recent posts first) for all accounts at `minLevel` and above.
 */
export async function enqueueAccountSummariesForLevel(minLevel: InterestLevel): Promise<{ accountsQueued: number; postsQueued: number }> {
  const levels = INTEREST_LEVELS.slice(INTEREST_LEVELS.indexOf(minLevel));
  const levelList = sql`string_to_array(${levels.join(",")}, ',')`;
  return enqueueAccountChains(sql`a.interest_level = ANY(${levelList}) AND NOT 'summary' = ANY(a.banned_actions)`);
}

/**
 * Queue an account summary for a single account (and its unsummarized recent posts if post summaries are enabled).
 */
export async function enqueueAccountSummary(accountId: string): Promise<{ accountsQueued: number; postsQueued: number }> {
  return enqueueAccountChains(sql`a.id = ${accountId}`);
}

// The claim query holds each account job until its account's post jobs are done.
async function enqueueAccountChains(accountFilter: SQL): Promise<{ accountsQueued: number; postsQueued: number }> {
  const settings = await loadSummarySettings();
  const postsQueued = settings.postEnabled ? await enqueueRecentPostsForAccounts(accountFilter) : 0;
  const accountsQueued = await enqueueAccountsWhere(accountFilter);
  if (postsQueued || accountsQueued) wakeSummaryRunner();
  return { accountsQueued, postsQueued };
}

// ── Job Execution ────────────────────────────────────────────────────────────

// A person or account a summary can name, and that ai_backend_notes can be written to.
type NoteEntity = { kind: "person" | "account"; id: string; name: string };

const entityKey = (e: NoteEntity) => `${e.kind}:${e.id}`;

function uniqueEntities(list: NoteEntity[]): NoteEntity[] {
  return Array.from(new Map(list.map((e) => [entityKey(e), e])).values());
}

// Keyed by photo location (the media URL in post.content), so each image only names the faces found in it.
async function resolveRecognizedPeopleForPost(postId: string): Promise<Map<string, NoteEntity[]>> {
  const byUrl = new Map<string, NoteEntity[]>();
  const postFaces = await db
    .select({ location: photos.location, personfaceUuid: faces.personfaceUuid })
    .from(faces)
    .innerJoin(photos, eq(faces.photoId, photos.id))
    .where(eq(photos.prmLocation, `post:${postId}`));

  const groupUuids = Array.from(new Set(postFaces.map((f) => f.personfaceUuid).filter((u): u is string => !!u)));
  if (groupUuids.length === 0) return byUrl;

  const [matchedPeople, matchedAccounts] = await Promise.all([
    db.select({ id: people.id, firstName: people.firstName, lastName: people.lastName, personfaceUuid: people.personfaceUuid })
      .from(people)
      .where(inArray(people.personfaceUuid, groupUuids)),
    db.select({ id: socialAccounts.id, username: socialAccounts.username, personfaceUuid: socialAccounts.personfaceUuid })
      .from(socialAccounts)
      .where(inArray(socialAccounts.personfaceUuid, groupUuids)),
  ]);

  const byUuid = new Map<string, NoteEntity[]>();
  const add = (uuid: string | null, entity: NoteEntity) => {
    if (uuid) byUuid.set(uuid, [...(byUuid.get(uuid) ?? []), entity]);
  };
  for (const p of matchedPeople) add(p.personfaceUuid, { kind: "person", id: p.id, name: `${p.firstName} ${p.lastName}`.trim() });
  for (const a of matchedAccounts) add(a.personfaceUuid, { kind: "account", id: a.id, name: `@${a.username}` });

  for (const f of postFaces) {
    const found = f.personfaceUuid ? byUuid.get(f.personfaceUuid) : undefined;
    if (!found) continue;
    byUrl.set(f.location, uniqueEntities([...(byUrl.get(f.location) ?? []), ...found]));
  }
  return byUrl;
}

// The account itself and the person who owns it.
async function accountEntities(accountId: string): Promise<NoteEntity[]> {
  const [row] = await db
    .select({
      username: socialAccounts.username,
      ownerId: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
    })
    .from(socialAccounts)
    .leftJoin(people, eq(people.id, socialAccounts.ownerUuid))
    .where(eq(socialAccounts.id, accountId));
  if (!row) return [];
  const list: NoteEntity[] = [{ kind: "account", id: accountId, name: `@${row.username}` }];
  if (row.ownerId) list.push({ kind: "person", id: row.ownerId, name: `${row.firstName} ${row.lastName}`.trim() });
  return list;
}

async function loadBackendNotes(entities: NoteEntity[]): Promise<Map<string, AiBackendNote[]>> {
  const personIds = entities.filter((e) => e.kind === "person").map((e) => e.id);
  const accountIds = entities.filter((e) => e.kind === "account").map((e) => e.id);
  const [personRows, accountRows] = await Promise.all([
    personIds.length
      ? db.select({ id: people.id, notes: people.aiBackendNotes }).from(people).where(inArray(people.id, personIds))
      : Promise.resolve([]),
    accountIds.length
      ? db.select({ id: socialAccounts.id, notes: socialAccounts.aiBackendNotes }).from(socialAccounts).where(inArray(socialAccounts.id, accountIds))
      : Promise.resolve([]),
  ]);
  const notes = new Map<string, AiBackendNote[]>();
  for (const r of personRows) notes.set(`person:${r.id}`, r.notes ?? []);
  for (const r of accountRows) notes.set(`account:${r.id}`, r.notes ?? []);
  return notes;
}

// The user's standing corrections, kept outside the data tags because they are trusted.
async function knownFactsBlock(entities: NoteEntity[]): Promise<string> {
  const notes = await loadBackendNotes(entities);
  const lines = uniqueEntities(entities).flatMap((e) =>
    (notes.get(entityKey(e)) ?? []).slice(-KNOWN_FACTS_PER_ENTITY).map((n) => `- ${e.name}: ${n.text}`),
  );
  return lines.length > 0
    ? `Known facts from the user (treat as true; they override what the content seems to show):\n${lines.join("\n")}`
    : "";
}

function isVideoMediaUrl(url: string): boolean {
  const clean = url.split("?")[0].toLowerCase();
  return clean.endsWith(".mp4") || clean.endsWith(".webm") || clean.endsWith(".mov");
}

// Models overshoot length instructions, so hard-cap the word count.
function clampWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  return words.length <= max ? text : `${words.slice(0, max).join(" ")}…`;
}

async function runPostSummaryJob(job: SummaryJob): Promise<void> {
  const [post] = await db.select().from(socialAccountPosts).where(eq(socialAccountPosts.id, job.targetId));
  if (!post) throw new Error("Post not found");

  const settings = await loadSummarySettings();
  let mediaUrls: string[] = [];
  try {
    mediaUrls = post.content ? JSON.parse(post.content) : [];
  } catch {
    mediaUrls = [];
  }

  const peopleByUrl = await resolveRecognizedPeopleForPost(post.id);
  const recognized = uniqueEntities(Array.from(peopleByUrl.values()).flat());
  const recognizedPeople = recognized.map((e) => e.name);
  const ownEntities = await accountEntities(post.socialAccountId);
  // A fix job (POST .../images/:imageIndex/append) re-describes only the fixed image and reuses the rest.
  const fix = job.options?.append as { imageIndex: number; text: string } | undefined;
  if (post.postType === "story") {
    const entities = uniqueEntities([...ownEntities, ...recognized]);
    return runStorySummary(job, post, settings, mediaUrls, recognizedPeople, entities, fix);
  }

  const existing = (post.aiSummary as PostAiSummary | null)?.images ?? [];
  const appendedFor = (i: number) => existing.find((e) => e.imageIndex === i)?.appended ?? [];

  // A retry keeps the image descriptions an earlier attempt already got.
  const prior = job.progress?.images ?? [];
  const images = mediaUrls.flatMap((url, i): SummaryJobImageResult[] => {
    if (!url || isVideoMediaUrl(url)) return [];
    const done = prior.find((p) => p.imageIndex === i && p.url === url && p.status === "done");
    if (done) return [done];
    const kept = fix && i !== fix.imageIndex ? existing.find((e) => e.imageIndex === i && e.description) : undefined;
    return [kept ? { imageIndex: i, url, status: "done", description: kept.description } : { imageIndex: i, url, status: "queued" }];
  });
  const progress: SummaryJobProgress = { images, final: "queued", ...(fix ? { notes: "queued" as const } : {}) };
  const saveProgress = progressSaver(job.id, progress);
  await saveProgress();

  // 1. For each image: apply to selected scene description model with predefined prompt
  const vision = await resolveStep("vision", settings.sceneModel);
  const describeOne = async (img: SummaryJobImageResult) => {
    img.status = "running";
    img.error = undefined;
    await saveProgress();
    try {
      const { buffer } = await fetchImageBuffer(img.url);
      let prompt = settings.scenePrompt;
      const imagePeople = peopleByUrl.get(img.url) ?? [];
      if (imagePeople.length > 0) {
        prompt += `\n\nRecognized people in this image: ${imagePeople.map((e) => e.name).join(", ")}`;
      }
      const facts = await knownFactsBlock([...ownEntities, ...imagePeople]);
      if (facts) prompt += `\n\n${facts}`;
      const fixes = appendedFor(img.imageIndex);
      if (fixes.length > 0) {
        prompt += `\n\nCorrections from the user about this image (treat as true):\n${fixes.map((t) => `- ${t}`).join("\n")}`;
      }
      const description = await onHost(vision, (r) => describeImage(buffer, {
        prompt,
        override: { providerId: r.provider.id, model: r.model },
        think: thinkFlag(settings.sceneNoThink),
      }));
      img.status = "done";
      img.description = description.trim();
    } catch (err) {
      img.status = "failed";
      img.error = errorMessage(err);
      log(`[SummaryQueue] Image ${img.imageIndex} on post ${post.id} failed scene description: ${img.error}`);
    }
  };
  // With a host pool the images fan out across hosts; the post summary below waits for all of them.
  const todo = images.filter((img) => img.status !== "done");
  if (hostPoolSlots() > 0) await Promise.all(todo.map(describeOne));
  else for (const img of todo) await describeOne(img);
  await saveProgress();
  const imagesAttempted = images.length;
  const imageSummaries: PostImageSummary[] = images
    .filter((img) => img.status === "done")
    .map((img) => {
      const appended = appendedFor(img.imageIndex);
      return { imageIndex: img.imageIndex, description: img.description ?? "", ...(appended.length ? { appended } : {}) };
    });

  // 2. Combine the image descriptions; post text (caption, tags, comments) is left out so the summary reflects what's seen.
  const transcript = (post.videoTranscript as { text?: string } | null)?.text;

  // Without any image or transcript the summary would be empty, so fail and let the job retry.
  if (imagesAttempted > 0 && imageSummaries.length === 0 && !transcript) {
    throw new Error(`All ${imagesAttempted} image(s) failed scene description`);
  }

  const imageLine = (s: PostImageSummary) =>
    [`Image ${s.imageIndex + 1}: ${s.description}`, ...(s.appended ?? []).map((t) => `  User correction: ${t}`)].join("\n");
  const contextParts: string[] = [
    await knownFactsBlock([...ownEntities, ...recognized]),
    recognizedPeople.length > 0 ? `Recognized People: ${recognizedPeople.join(", ")}` : "",
    transcript ? `Video Transcript:\n${asData("transcript", transcript)}` : "",
    imageSummaries.length > 0
      ? `Image Scene Descriptions:\n${asData("image_descriptions", imageSummaries.map(imageLine).join("\n"))}`
      : "",
  ].filter(Boolean);

  // A failure past here is marked on the final step by runJob.
  progress.final = "running";
  await saveProgress();
  const resolvedText = await resolveStep("text", settings.textModel);

  let overview = "";
  if (imageSummaries.length === 1 && !transcript) {
    overview = imageSummaries[0].description;
  } else if (contextParts.length > 0) {
    const result = await onHost(resolvedText, (r) => chat(r, {
      messages: [
        {
          role: "system",
          content: `${settings.postPrompt}\n\nKeep the summary under ${settings.postMaxWords} words.\n\n${DATA_TAGS_NOTE}`,
        },
        { role: "user", content: contextParts.join("\n\n") },
      ],
      think: thinkFlag(settings.postNoThink),
      signal: AbortSignal.timeout(120_000),
    }));
    overview = result.content.trim();
  } else {
    overview = "No visual or text content available to summarize.";
  }

  await savePostSummary(post, { overview: clampWords(overview, settings.postMaxWords), images: imageSummaries }, resolvedText.model, settings);
  progress.final = "done";
  await saveProgress();

  if (fix) {
    const fixed = images.find((img) => img.imageIndex === fix.imageIndex);
    const candidates = uniqueEntities([...ownEntities, ...(fixed ? peopleByUrl.get(fixed.url) ?? [] : [])]);
    await runFixNotes(post.id, fix, fixed?.description ?? "", candidates, resolvedText, settings, progress, saveProgress);
  }
}

/** Runs after the save, so a failure here never costs the summary and a retry never writes a note twice. */
async function runFixNotes(
  postId: string,
  fix: { imageIndex: number; text: string },
  description: string,
  candidates: NoteEntity[],
  resolvedText: ResolvedModel,
  settings: SummarySettings,
  progress: SummaryJobProgress,
  saveProgress: () => Promise<void>,
): Promise<void> {
  progress.notes = "running";
  await saveProgress();
  try {
    await extractBackendNotes(postId, fix, description, candidates, resolvedText, settings);
    progress.notes = "done";
  } catch (err) {
    progress.notes = "failed";
    log(`[SummaryQueue] Notes from fix on post ${postId} failed: ${errorMessage(err)}`);
  }
  await saveProgress();
}

type ExtractedNote = { target?: unknown; note?: unknown };

function extractJsonArray(text: string): ExtractedNote[] {
  if (!text) return [];
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenceMatch ? [fenceMatch[1].trim(), text.trim()] : [text.trim()];

  for (const candidate of candidates) {
    try {
      const direct = JSON.parse(candidate);
      if (Array.isArray(direct)) return direct as ExtractedNote[];
      if (direct && typeof direct === "object" && ("target" in direct || "note" in direct)) {
        return [direct as ExtractedNote];
      }
    } catch {}

    let start = candidate.indexOf("[");
    while (start !== -1) {
      let end = candidate.lastIndexOf("]");
      while (end > start) {
        try {
          const slice = candidate.slice(start, end + 1);
          const parsed = JSON.parse(slice);
          if (Array.isArray(parsed)) return parsed as ExtractedNote[];
        } catch {}
        end = candidate.lastIndexOf("]", end - 1);
      }
      start = candidate.indexOf("[", start + 1);
    }
  }
  return [];
}

/** Asks the text model which durable facts the user's fix states, and appends them to those rows' ai_backend_notes. */
async function extractBackendNotes(
  postId: string,
  fix: { imageIndex: number; text: string },
  description: string,
  candidates: NoteEntity[],
  resolvedText: ResolvedModel,
  settings: SummarySettings,
): Promise<void> {
  if (candidates.length === 0) return;
  const existing = await loadBackendNotes(candidates);
  const candidateLines = candidates.map((e, i) => {
    const notes = (existing.get(entityKey(e)) ?? []).slice(-KNOWN_FACTS_PER_ENTITY);
    const kind = e.kind === "person" ? "person" : "social account";
    return [`C${i + 1}: ${e.name} (${kind})`, ...notes.map((n) => `  existing note: ${n.text}`)].join("\n");
  });
  const result = await onHost(resolvedText, (r) => chat(r, {
    messages: [
      { role: "system", content: `${settings.notesPrompt}\n\n${DATA_TAGS_NOTE}` },
      {
        role: "user",
        content: [
          `Candidates:\n${candidateLines.join("\n")}`,
          `Image description:\n${asData("image_description", description)}`,
          `User correction:\n${fix.text}`,
        ].join("\n\n"),
      },
    ],
    think: thinkFlag(settings.postNoThink),
    signal: AbortSignal.timeout(120_000),
  }));

  const raw = result.content;
  const parsed = extractJsonArray(raw);

  const createdAt = new Date().toISOString();
  const affectedPersonIds = new Set<string>();
  const affectedAccountIds = new Set<string>();

  for (const item of parsed) {
    const target = candidates[Number(String(item?.target ?? "").replace(/^C/i, "")) - 1];
    const text = typeof item?.note === "string" ? item.note.trim() : "";
    if (!target || !text) continue;
    const note: AiBackendNote = { text, source: { kind: "post_append", postId, imageIndex: fix.imageIndex }, createdAt };
    const added = JSON.stringify([note]);
    if (target.kind === "person") {
      await db.update(people).set({ aiBackendNotes: sql`${people.aiBackendNotes} || ${added}::jsonb` }).where(eq(people.id, target.id));
      affectedPersonIds.add(target.id);
    } else {
      await db.update(socialAccounts).set({ aiBackendNotes: sql`${socialAccounts.aiBackendNotes} || ${added}::jsonb` }).where(eq(socialAccounts.id, target.id));
      affectedAccountIds.add(target.id);
    }
  }

  if (affectedAccountIds.size > 0) {
    await db
      .update(socialAccounts)
      .set({
        aiSummaryInvalidated: true,
        aiSummaryInvalidatedAt: sql`COALESCE(${socialAccounts.aiSummaryInvalidatedAt}, now())`,
      })
      .where(and(inArray(socialAccounts.id, Array.from(affectedAccountIds)), isNotNull(socialAccounts.aiSummary)));
  }

  if (affectedPersonIds.size > 0) {
    await db
      .update(socialAccounts)
      .set({
        aiSummaryInvalidated: true,
        aiSummaryInvalidatedAt: sql`COALESCE(${socialAccounts.aiSummaryInvalidatedAt}, now())`,
      })
      .where(and(inArray(socialAccounts.ownerUuid, Array.from(affectedPersonIds)), isNotNull(socialAccounts.aiSummary)));
  }
}

/**
 * Stories get a single LLM run with the story prompt: every image goes to the scene (vision) model
 * at once, or, for a video-only story, the transcript goes to the text model.
 */
async function runStorySummary(
  job: SummaryJob,
  post: SocialAccountPost,
  settings: SummarySettings,
  mediaUrls: string[],
  recognizedPeople: string[],
  entities: NoteEntity[],
  fix: { imageIndex: number; text: string } | undefined,
): Promise<void> {
  const progress: SummaryJobProgress = { images: [], final: "running", ...(fix ? { notes: "queued" as const } : {}) };
  const saveProgress = progressSaver(job.id, progress);
  await saveProgress();

  const imageUrls = mediaUrls.filter((url) => url && !isVideoMediaUrl(url));
  const fetched = await Promise.allSettled(imageUrls.map((url) => fetchImageBuffer(url)));
  const buffers = fetched.flatMap((r) => (r.status === "fulfilled" ? [r.value.buffer] : []));
  const transcript = (post.videoTranscript as { text?: string } | null)?.text;
  if (imageUrls.length > 0 && buffers.length === 0 && !transcript) {
    throw new Error(`All ${imageUrls.length} image(s) failed to load`);
  }

  const instructions = `${settings.storyPrompt}\n\nKeep the summary under ${settings.postMaxWords} words.\n\n${DATA_TAGS_NOTE}`;
  const appended = (post.aiSummary as PostAiSummary | null)?.appended ?? [];
  const contextParts = [
    await knownFactsBlock(entities),
    appended.length > 0 ? `Corrections from the user about this story (treat as true):\n${appended.map((t) => `- ${t}`).join("\n")}` : "",
    recognizedPeople.length > 0 ? `Recognized People: ${recognizedPeople.join(", ")}` : "",
    transcript ? `Video Transcript:\n${asData("transcript", transcript)}` : "",
  ].filter(Boolean);
  const think = thinkFlag(settings.storyNoThink);

  let overview = "No visual or text content available to summarize.";
  let model: string | null = null;
  // The notes step needs a text model, so a fix resolves one even when the story itself goes to vision.
  const text = fix || (buffers.length === 0 && transcript) ? await resolveStep("text", settings.textModel) : null;
  if (buffers.length > 0) {
    const vision = await resolveStep("vision", settings.sceneModel);
    model = vision.model;
    overview = await onHost(vision, (r) => describeImage(buffers, {
      prompt: [instructions, ...contextParts].join("\n\n"),
      override: { providerId: r.provider.id, model: r.model },
      think,
    }));
  } else if (transcript && text) {
    model = text.model;
    overview = (await onHost(text, (r) => chat(r, {
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: contextParts.join("\n\n") },
      ],
      think,
      signal: AbortSignal.timeout(120_000),
    }))).content;
  }

  const summary: PostAiSummary = { overview: clampWords(overview.trim(), settings.postMaxWords), images: [], ...(appended.length ? { appended } : {}) };
  await savePostSummary(post, summary, model, settings);
  progress.final = "done";
  await saveProgress();

  if (fix && text) await runFixNotes(post.id, fix, summary.overview, entities, text, settings, progress, saveProgress);
}

async function savePostSummary(
  post: SocialAccountPost,
  summary: PostAiSummary,
  model: string | null,
  settings: SummarySettings,
): Promise<void> {
  // Keep fixes the user added while this job ran.
  const [current] = await db.select({ aiSummary: socialAccountPosts.aiSummary }).from(socialAccountPosts).where(eq(socialAccountPosts.id, post.id));
  const currentSummary = current?.aiSummary as PostAiSummary | null;
  const storyAdded = (currentSummary?.appended ?? []).filter((t) => !(summary.appended ?? []).includes(t));
  if (storyAdded.length > 0) summary.appended = [...(summary.appended ?? []), ...storyAdded];
  const currentImages = currentSummary?.images ?? [];
  for (const img of summary.images) {
    const seen = img.appended ?? [];
    const added = (currentImages.find((c) => c.imageIndex === img.imageIndex)?.appended ?? []).filter((t) => !seen.includes(t));
    if (added.length > 0) img.appended = [...seen, ...added];
  }

  await db
    .update(socialAccountPosts)
    .set({
      aiSummary: summary,
      aiSummaryAt: new Date(),
      aiSummaryModel: model,
      updatedAt: new Date(),
    })
    .where(eq(socialAccountPosts.id, post.id));
  syncEntityInBackground("post", post.id);

  // Diagram flow after running a post summary:
  //    "is social account Summary on?" -> Yes -> "set current account summary as out of date"
  //    -> "is auto social account summary on?" -> Yes -> "run social account summary"
  if (settings.accountEnabled) {
    await db
      .update(socialAccounts)
      .set({
        aiSummaryInvalidated: true,
        aiSummaryInvalidatedAt: sql`COALESCE(${socialAccounts.aiSummaryInvalidatedAt}, now())`,
      })
      // An account that was never summarized has nothing to go out of date.
      .where(and(eq(socialAccounts.id, post.socialAccountId), isNotNull(socialAccounts.aiSummary)));

    if (settings.accountAutoEnabled && !(await bannedActions(post.socialAccountId)).includes("summary")) {
      await enqueueSummaryJob("account", post.socialAccountId, post.socialAccountId);
    }
  }
}

async function runAccountSummaryJob(job: SummaryJob): Promise<void> {
  const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, job.targetId));
  if (!account) throw new Error("Social account not found");

  const settings = await loadSummarySettings();
  // Posts still missing a summary (e.g. a failed post job) fall back to their caption or transcript below.
  const postedOrCreated = sql`coalesce(${socialAccountPosts.postedAt}, ${socialAccountPosts.createdAt})`;
  const recentPosts = await db
    .select({
      postType: socialAccountPosts.postType,
      postedAt: socialAccountPosts.postedAt,
      createdAt: socialAccountPosts.createdAt,
      isDeleted: socialAccountPosts.isDeleted,
      aiSummary: socialAccountPosts.aiSummary,
      description: socialAccountPosts.description,
      videoTranscript: socialAccountPosts.videoTranscript,
    })
    .from(socialAccountPosts)
    .where(eq(socialAccountPosts.socialAccountId, account.id))
    .orderBy(desc(postedOrCreated), desc(socialAccountPosts.id))
    .limit(ACCOUNT_SUMMARY_MAX_POSTS);
  const posts = recentPosts.reverse();

  const resolvedText = await resolveStep("text", settings.textModel);

  const itemLines: string[] = [];
  let postCount = 0;
  let storyCount = 0;

  for (const p of posts) {
    if (p.postType === "story") storyCount++;
    else postCount++;

    const dateStr = p.postedAt
      ? new Date(p.postedAt).toISOString().split("T")[0]
      : new Date(p.createdAt).toISOString().split("T")[0];
    const kindLabel = p.postType === "story" ? "Story" : "Post";
    const deletedTag = p.isDeleted ? " (deleted)" : "";
    const textSummary = clampWords(
      (p.aiSummary as PostAiSummary | null)?.overview ||
        p.description ||
        (p.videoTranscript as { text?: string } | null)?.text ||
        "(no summary or caption)",
      settings.postMaxWords,
    );

    itemLines.push(`[${dateStr}] ${kindLabel}${deletedTag}: ${textSummary}`);
  }

  const accountHeader = [
    `Username: @${account.username}`,
    account.nickname ? `Display Name: ${account.nickname}` : "",
    account.bio ? `Bio: ${account.bio}` : "",
    account.location ? `Location: ${account.location}` : "",
    `Followers: ${account.reportedFollowersCount ?? account.followersCount}, Following: ${account.reportedFollowingCount ?? account.followingCount}`,
    `Total Posts Analyzed: ${postCount}, Total Stories Analyzed: ${storyCount}`,
  ]
    .filter(Boolean)
    .join("\n");

  const knownFacts = await knownFactsBlock(await accountEntities(account.id));
  // A connections failure shouldn't cost the whole summary.
  const connections = await connectionsForPrompt(account.id, ACCOUNT_SUMMARY_MAX_CONNECTIONS).catch((err) => {
    log(`[SummaryQueue] Connections for account ${account.id} failed: ${errorMessage(err)}`);
    return { guide: "", block: "", count: 0 };
  });
  const promptInput = `${knownFacts ? `${knownFacts}\n\n` : ""}${asData("account_info", accountHeader)}\n\n${asData(
    "chronological_posts_and_stories",
    itemLines.length > 0 ? itemLines.join("\n") : "No posts or stories recorded for this account.",
  )}\n\n${asData(
    "connections_strongest_first",
    connections.block || "No recorded interactions with other accounts.",
  )}`;

  const result = await onHost(resolvedText, (r) => chat(r, {
    messages: [
      { role: "system", content: [settings.accountPrompt, connections.guide, DATA_TAGS_NOTE].filter(Boolean).join("\n\n") },
      { role: "user", content: promptInput },
    ],
    think: thinkFlag(settings.accountNoThink),
    signal: AbortSignal.timeout(180_000),
  }));

  const newSummary: AccountAiSummary = {
    profile: result.content.trim(),
    postCount,
    storyCount,
    connectionCount: connections.count,
  };

  const now = new Date();

  await db.transaction(async (tx) => {
    // Archive existing summary into historical_account_summaries if one exists
    if (account.aiSummary) {
      await tx.insert(historicalAccountSummaries).values({
        socialAccountId: account.id,
        content: account.aiSummary as AccountAiSummary,
        model: account.aiSummaryModel,
        createdAt: account.aiSummaryGeneratedAt ?? account.createdAt,
        invalidatedAt: account.aiSummaryInvalidatedAt,
        replacedAt: now,
      });
    }

    await tx
      .update(socialAccounts)
      .set({
        aiSummary: newSummary,
        aiSummaryGeneratedAt: now,
        aiSummaryInvalidated: false,
        aiSummaryInvalidatedAt: null,
        aiSummaryModel: resolvedText.model,
      })
      .where(eq(socialAccounts.id, account.id));
  });
  syncEntityInBackground("social_account", account.id);
}

// ── Runner Loop ──────────────────────────────────────────────────────────────

async function claimNextSummaryJob(): Promise<SummaryJob | undefined> {
  // Prioritize 'post' jobs before 'account' jobs so child post summaries complete before parent account summaries
  const { rows } = await db.execute(sql`
    UPDATE summary_jobs
    SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM summary_jobs
      WHERE status = 'pending'
        AND (
          kind = 'post'
          OR NOT EXISTS (
            SELECT 1 FROM summary_jobs p
            WHERE p.kind = 'post'
              AND p.social_account_id = summary_jobs.social_account_id
              AND p.status IN ('pending', 'running')
          )
        )
      ORDER BY CASE WHEN kind = 'post' THEN 0 ELSE 1 END, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      kind,
      target_id AS "targetId",
      social_account_id AS "socialAccountId",
      status,
      attempts,
      error,
      options,
      progress,
      created_at AS "createdAt",
      started_at AS "startedAt",
      completed_at AS "completedAt"
  `);
  return rows[0] as SummaryJob | undefined;
}

async function runJob(job: SummaryJob): Promise<void> {
  try {
    if (job.kind === "post") {
      await runPostSummaryJob(job);
    } else if (job.kind === "account") {
      await runAccountSummaryJob(job);
    }
    await db
      .update(summaryJobs)
      .set({ status: "done", error: null, completedAt: new Date() })
      .where(eq(summaryJobs.id, job.id));
  } catch (err) {
    const msg = errorMessage(err);
    log(`[SummaryQueue] ${job.kind} job ${job.targetId} attempt ${job.attempts} failed: ${msg}`);
    const giveUp = job.attempts >= MAX_ATTEMPTS;
    await db
      .update(summaryJobs)
      .set({
        status: giveUp ? "failed" : "pending",
        error: msg,
        completedAt: giveUp ? new Date() : null,
        progress: sql`CASE WHEN ${summaryJobs.progress}->>'final' = 'running'
          THEN jsonb_set(${summaryJobs.progress}, '{final}', '"failed"') ELSE ${summaryJobs.progress} END`,
      })
      .where(eq(summaryJobs.id, job.id));
  }
}

let activeJobs = 0;
let dispatching = false;
let redispatch = false;

/**
 * Claim jobs until every slot is busy: one at a time without a host pool, else
 * one per pool slot plus one so the next job's image downloads overlap.
 * Order holds within a job (images before the post summary) and in the claim
 * query (an account job waits for its pending and running post jobs).
 */
export function wakeSummaryRunner(): void {
  if (dispatching) {
    redispatch = true;
    return;
  }
  dispatching = true;
  void (async () => {
    try {
      do {
        redispatch = false;
        const slots = poolInitialized ? hostPoolSlots() : await refreshHostPool();
        const maxJobs = slots > 0 ? slots + 1 : 1;
        while (activeJobs < maxJobs) {
          const job = await claimNextSummaryJob();
          if (!job) break;
          activeJobs++;
          void runJob(job)
            .catch((err) => log(`[SummaryQueue] Job ${job.id} error: ${errorMessage(err)}`))
            .finally(() => {
              activeJobs--;
              wakeSummaryRunner();
            });
        }
      } while (redispatch);
    } catch (err) {
      log(`[SummaryQueue] Runner error: ${errorMessage(err)}`);
    } finally {
      dispatching = false;
    }
  })();
}

export function startSummaryRunner(): void {
  const syncAndWake = () => {
    refreshHostPool()
      .catch((err) => log(`[SummaryQueue] Failed to refresh host pool: ${errorMessage(err)}`))
      .finally(() => wakeSummaryRunner());
  };
  db.update(summaryJobs)
    .set({ status: "pending", startedAt: null })
    .where(eq(summaryJobs.status, "running"))
    .catch((err) => log(`[SummaryQueue] Failed to reset running jobs: ${errorMessage(err)}`))
    .finally(() => {
      syncAndWake();
      setInterval(syncAndWake, TICK_MS);
    });
}
