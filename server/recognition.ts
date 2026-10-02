/**
 * PRM-Compute recognition jobs (faces, OCR, video speech-to-text) shared by the
 * image-page buttons, the image task worker and the automatic pipeline that
 * runs when prm-stories delivers new content.
 */
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { and, desc, eq, gte, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { fetchImageBuffer } from "./prm-s3";
import { facePairDismissals, faces, imageTasks, people, photos, socialAccountPosts, socialAccounts, type Photo } from "@shared/schema";
import { currentAccess, runAsSystem } from "./access";
import { log } from "./vite";
import { triggerImageTaskWorker } from "./task-worker";
// Only referenced inside functions, so the profile-image -> recognition import
// cycle never reads it before it's initialised.
import { HQ_MIN_WIDTH, getImageDimensions } from "./profile-image";
import {
  markFaceIdentitiesDirty, getLookalikeMinScore, setLookalikeMinScore, lookAlikesFor,
  getAutoAssignMinScore, setAutoAssignMinScore, AUTO_ASSIGN_MIN_MARGIN,
} from "./face-lookalikes";

// ── Compute connection ────────────────────────────────────────────────────────

/** Compute could not be reached at all (refused, DNS, timeout) — as opposed to it rejecting the item. */
export class ComputeUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputeUnreachableError";
  }
}

/** Compute is up but every slot for this engine stayed busy (or it ran out of memory) — retry shortly. */
export class ComputeBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputeBusyError";
  }
}

/** A bad or missing input on a face/connect-style call; `status` is the HTTP status the route should answer. */
export class RecognitionRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "RecognitionRequestError";
  }
}

/** mergeFaceGroups refuses to merge two groups that are each already linked to a different person. */
export class FaceMergeConflictError extends Error {
  constructor(message = "These are two different people — merge the people first.") {
    super(message);
    this.name = "FaceMergeConflictError";
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
  let response: Response;
  try {
    response = await fetch(`${conn.apiUrl}${pathname}`, {
      method: "POST",
      headers: { "X-API-Key": conn.apiKey },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    throw new ComputeUnreachableError(`Could not reach PRM-Compute at ${conn.apiUrl}: ${err?.message ?? err}`);
  }
  if (response.status === 503) {
    const body = await response.clone().json().catch(() => null);
    if (body?.busy) throw new ComputeBusyError(body.detail ?? "PRM-Compute is busy");
  }
  return response;
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
  | "face_missing" | "group_conflict" | "no_face_account";

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

  const response = await computeFetch("/api/img/add", form, 45000);
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

  // Face boxes are in this file's pixels. Ingestion may have stored the size the
  // source reported (e.g. Instagram's 1080px) for a smaller file, so record the real one.
  const dims = getImageDimensions(fetched.buffer);
  const sized = dims ? { ...photo, widthPx: dims.width, heightPx: dims.height } : photo;

  const profileLink = await linkProfileFace(sized, detected, async () => fetched.buffer);
  const facialIds = await resolveFaceIdentities(detected);

  await db.update(photos)
    .set({ facialIds, faceIdAt: new Date(), ...(dims && { widthPx: dims.width, heightPx: dims.height }) })
    .where(eq(photos.id, photoId));

  const detectedIds = facialIds.map((f) => f.faceUuid).filter((id): id is string => !!id);
  await autoAssignFaces(detectedIds).catch((err) => log(`[FaceAutoAssign] photo ${photoId}: ${err?.message ?? err}`));

  return { facesDetected: data.faces_detected ?? detected.length, faces: detected, raw: data, profileLink };
}

/**
 * The facial_ids entries for a detection: whatever compute matched, plus the
 * account whose profile picture shares the face's group (social_accounts.
 * personface_uuid), and that account's owner when it has one.
 */
/**
 * For each of `groups` (personface_uuid values), the social account and the
 * person linked to it, if any. Shared by resolveFaceIdentities (detections
 * fresh off compute) and refreshFacialIdsForGroups (existing photos whose
 * group linkage changed).
 */
async function identitiesForGroups(groups: string[], exec: DbExec = db): Promise<{
  accountOf: Map<string, { id: string; ownerUuid: string | null }>;
  personOf: Map<string, string>;
}> {
  const accountOf = new Map<string, { id: string; ownerUuid: string | null }>();
  const personOf = new Map<string, string>();
  if (groups.length) {
    const saRows = await exec
      .select({ id: socialAccounts.id, ownerUuid: socialAccounts.ownerUuid, personfaceUuid: socialAccounts.personfaceUuid })
      .from(socialAccounts)
      .where(inArray(socialAccounts.personfaceUuid, groups));
    for (const r of saRows) if (r.personfaceUuid && !accountOf.has(r.personfaceUuid)) accountOf.set(r.personfaceUuid, r);

    const personRows = await exec
      .select({ id: people.id, personfaceUuid: people.personfaceUuid })
      .from(people)
      .where(inArray(people.personfaceUuid, groups));
    for (const r of personRows) if (r.personfaceUuid && !personOf.has(r.personfaceUuid)) personOf.set(r.personfaceUuid, r.id);
  }
  return { accountOf, personOf };
}

async function resolveFaceIdentities(detected: DetectedFace[]): Promise<FacialId[]> {
  const ids = detected.map((f) => f.face_uuid || f.faceUuid).filter((id): id is string => !!id);
  const groupOf = new Map<string, string>();
  if (ids.length) {
    const rows = await db.select({ id: faces.id, personfaceUuid: faces.personfaceUuid }).from(faces).where(inArray(faces.id, ids));
    for (const r of rows) if (r.personfaceUuid) groupOf.set(r.id, r.personfaceUuid);
  }
  const groups = Array.from(new Set(groupOf.values()));
  const { accountOf, personOf } = await identitiesForGroups(groups);
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

/** `db` or a transaction handle, so group changes and their facial_ids refresh commit together. */
type DbExec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * (photo, face) pairs for every photo whose facial_ids lists one of `faceIds`.
 * PRM-Compute hands back the existing faces for a byte-identical image (same
 * file hash), so one face can sit in several photos; faces.photo_id only names
 * the first of them.
 */
export async function photosContainingFaces(faceIds: string[], exec: DbExec = db): Promise<{ photoId: string; faceUuid: string }[]> {
  if (!faceIds.length) return [];
  const result = await exec.execute(sql`
    SELECT DISTINCT p.id AS "photoId", e->>'faceUuid' AS "faceUuid"
    FROM photos p, jsonb_array_elements(coalesce(p.facial_ids, '[]'::jsonb)) e
    WHERE e->>'faceUuid' IN (${sql.join(faceIds.map((id) => sql`${id}`), sql`, `)})
  `);
  return (result as unknown as { rows: { photoId: string; faceUuid: string }[] }).rows;
}

/**
 * Recompute the personId/socialAccountId of the facial_ids entries for every
 * face in `groupUuids` (plus `extraFaceIds`, faces that just moved between
 * groups). Call after a merge/connect/disassociate changes which person or
 * account a group maps to.
 */
async function refreshFacialIdsForGroups(groupUuids: string[], exec: DbExec = db, extraFaceIds: string[] = []): Promise<void> {
  const groups = Array.from(new Set(groupUuids.filter(Boolean)));
  const cols = { id: faces.id, personfaceUuid: faces.personfaceUuid };
  const faceRows = [
    ...(groups.length ? await exec.select(cols).from(faces).where(inArray(faces.personfaceUuid, groups)) : []),
    ...(extraFaceIds.length ? await exec.select(cols).from(faces).where(inArray(faces.id, extraFaceIds)) : []),
  ];
  const photoIds = Array.from(new Set((await photosContainingFaces(faceRows.map((r) => r.id), exec)).map((r) => r.photoId)));
  if (!photoIds.length) return;

  const allGroups = Array.from(new Set(faceRows.map((r) => r.personfaceUuid).filter((g): g is string => !!g)));
  const { accountOf, personOf } = await identitiesForGroups(allGroups, exec);
  const groupOfFace = new Map(faceRows.map((r) => [r.id, r.personfaceUuid] as const));

  const affectedPhotos = await exec.select({ id: photos.id, facialIds: photos.facialIds }).from(photos).where(inArray(photos.id, photoIds));
  for (const photo of affectedPhotos) {
    const entries = (photo.facialIds ?? []) as FacialId[];
    let changed = false;
    const next = entries.map((f) => {
      if (!f.faceUuid || !groupOfFace.has(f.faceUuid)) return f;
      const group = groupOfFace.get(f.faceUuid);
      const account = group ? accountOf.get(group) : undefined;
      const personId = (group && personOf.get(group)) || account?.ownerUuid || null;
      const socialAccountId = account?.id ?? null;
      if (personId === f.personId && socialAccountId === f.socialAccountId) return f;
      changed = true;
      return { ...f, personId, socialAccountId };
    });
    if (changed) await exec.update(photos).set({ facialIds: next }).where(eq(photos.id, photo.id));
  }
}

// ── Face group merge / connect / disassociate ─────────────────────────────────

type ComputeIdentity = { uuid: string; name: string };

/**
 * The identity PRM-Compute knows a group by: the person if there is one, else
 * the account. Null for an unnamed group.
 */
async function computeIdentity(group: string, exec: DbExec = db): Promise<ComputeIdentity | null> {
  const personRows = await exec.select({ id: people.id, firstName: people.firstName, lastName: people.lastName }).from(people).where(eq(people.personfaceUuid, group));
  if (personRows.length) {
    const names = personRows.map(p => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()).filter(Boolean);
    return { uuid: group, name: names.join(" / ") || "Unnamed" };
  }
  const [account] = await exec.select({ id: socialAccounts.id, username: socialAccounts.username }).from(socialAccounts).where(eq(socialAccounts.personfaceUuid, group));
  return account ? { uuid: group, name: `@${account.username}` } : null;
}

async function groupPersonId(group: string, exec: DbExec = db): Promise<string | null> {
  const [row] = await exec.select({ id: people.id }).from(people).where(eq(people.personfaceUuid, group));
  return row?.id ?? null;
}

async function computePost(pathname: string, params: Record<string, string>, label: string): Promise<void> {
  const conn = await getComputeConnection();
  if (!conn) return;
  try {
    const response = await fetch(`${conn.apiUrl}${pathname}`, {
      method: "POST",
      headers: { "X-API-Key": conn.apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) log(`[${label}] PRM-Compute ${pathname} returned ${response.status}: ${await response.text()}`);
  } catch (err: any) {
    log(`[${label}] PRM-Compute ${pathname} failed: ${err?.message ?? err}`);
  }
}

/**
 * Best-effort, after commit and off the request path: fold each `from`
 * identity into the group's current one, then assign the faces that moved in.
 * Identities are resolved by the caller before the change, since a folded
 * group has nothing left to resolve afterwards.
 */
async function syncCompute(group: string, from: Array<ComputeIdentity | null>, movedFaceIds: string[]): Promise<void> {
  const identity = await computeIdentity(group);
  if (!identity) return;
  for (const other of from) {
    if (other && other.uuid !== identity.uuid) {
      await computePost("/api/person/merge", { primary_person_uuid: identity.uuid, secondary_person_uuid: other.uuid }, "FaceMerge");
    }
  }
  for (const faceUuid of movedFaceIds) {
    await computePost("/api/face/assign", { face_uuid: faceUuid, person_uuid: identity.uuid, name: identity.name }, "FaceConnect");
  }
}

async function moveGroup(exec: DbExec, keep: string, merge: string): Promise<void> {
  await exec.update(faces).set({ personfaceUuid: keep }).where(eq(faces.personfaceUuid, merge));
  await exec.update(people).set({ personfaceUuid: keep }).where(eq(people.personfaceUuid, merge));
  await exec.update(socialAccounts).set({ personfaceUuid: keep }).where(eq(socialAccounts.personfaceUuid, merge));
}

/**
 * Re-point every face, person and social account in `merge`'s group onto
 * `keep`, refresh photos.facial_ids for the kept group, and best-effort tell
 * PRM-Compute. Supports multiple people and social accounts sharing the same face group.
 */
export async function mergeFaceGroups(keep: string, merge: string): Promise<void> {
  if (keep === merge) return;
  const before = await Promise.all([computeIdentity(keep), computeIdentity(merge)]);

  await db.transaction(async (tx) => {
    await moveGroup(tx, keep, merge);
    await tx.delete(facePairDismissals).where(
      or(
        and(eq(facePairDismissals.groupAUuid, keep), eq(facePairDismissals.groupBUuid, merge)),
        and(eq(facePairDismissals.groupAUuid, merge), eq(facePairDismissals.groupBUuid, keep)),
        eq(facePairDismissals.groupAUuid, merge),
        eq(facePairDismissals.groupBUuid, merge)
      )
    );
    await refreshFacialIdsForGroups([keep], tx);
  });
  markFaceIdentitiesDirty();
  void syncCompute(keep, before, []);
}

export type ConnectFaceInput = { faceUuid?: string; personfaceUuid?: string; personId?: string; socialAccountId?: string };
export type ConnectFaceResult = { personId: string | null; socialAccountId: string | null; personfaceUuid: string };

/**
 * Link a face/person/account together into one face group, per face-review-plan.md
 * §3.3. An account with an owner brings its owner along, so a person and their
 * account never end up as two identities. Target group = the person's group,
 * else the account's, else the face's own unnamed group, else a new uuid.
 * - The account's group is folded in whole (it's the same identity).
 * - The face's group is folded in whole only while it's unnamed; a face sitting
 *   in someone else's named group moves on its own.
 * Assigning a face also clears its dismissal and any auto-match score: a
 * person has now decided (face-review-plan.md §8.1).
 */
export async function connectFace(input: ConnectFaceInput): Promise<ConnectFaceResult> {
  const { faceUuid, socialAccountId } = input;
  if (!faceUuid && !input.personId && !socialAccountId) throw new RecognitionRequestError(400, "At least one of faceUuid, personId or socialAccountId is required.");

  const [faceRow] = faceUuid ? await db.select({ id: faces.id, personfaceUuid: faces.personfaceUuid }).from(faces).where(eq(faces.id, faceUuid)) : [];
  if (faceUuid && !faceRow) throw new RecognitionRequestError(404, "Face not found.");

  const [account] = socialAccountId
    ? await db.select({ id: socialAccounts.id, ownerUuid: socialAccounts.ownerUuid, personfaceUuid: socialAccounts.personfaceUuid }).from(socialAccounts).where(eq(socialAccounts.id, socialAccountId))
    : [];
  if (socialAccountId && !account) throw new RecognitionRequestError(404, "Social account not found.");
  if (input.personId && account?.ownerUuid && account.ownerUuid !== input.personId) {
    throw new RecognitionRequestError(400, "That account belongs to a different person.");
  }

  const personId = input.personId ?? account?.ownerUuid ?? null;
  const [person] = personId ? await db.select({ id: people.id, personfaceUuid: people.personfaceUuid }).from(people).where(eq(people.id, personId)) : [];
  if (input.personId && !person) throw new RecognitionRequestError(404, "Person not found.");

  const faceGroup = faceRow?.personfaceUuid ?? null;
  const faceGroupNamed = faceGroup ? !!(await computeIdentity(faceGroup)) : false;
  const target =
    person?.personfaceUuid ?? account?.personfaceUuid ?? (faceGroup && !faceGroupNamed ? faceGroup : null) ?? input.personfaceUuid ?? crypto.randomUUID();

  const toFold = new Set<string>();
  if (account?.personfaceUuid && account.personfaceUuid !== target) toFold.add(account.personfaceUuid);
  if (faceGroup && faceGroup !== target && !faceGroupNamed) toFold.add(faceGroup);
  // Groups to fold will be moved to target (supports multiple people / social accounts per face)
  // A face in someone else's named group leaves it alone; that group keeps its other faces.
  const movedAlone = faceRow && faceGroup && faceGroup !== target && faceGroupNamed ? faceRow.id : null;
  const movedFaceIds =
    faceRow && faceGroup && toFold.has(faceGroup)
      ? (await db.select({ id: faces.id }).from(faces).where(eq(faces.personfaceUuid, faceGroup))).map((r) => r.id)
      : faceRow && faceGroup !== target ? [faceRow.id] : [];
  const before = await Promise.all([target, ...Array.from(toFold)].map((g) => computeIdentity(g)));

  await db.transaction(async (tx) => {
    for (const group of Array.from(toFold)) await moveGroup(tx, target, group);
    if (faceRow) await tx.update(faces).set({ personfaceUuid: target, dismissedAt: null, autoMatchScore: null }).where(eq(faces.id, faceRow.id));
    if (person && person.personfaceUuid !== target) await tx.update(people).set({ personfaceUuid: target }).where(eq(people.id, person.id));
    if (account && account.personfaceUuid !== target) await tx.update(socialAccounts).set({ personfaceUuid: target }).where(eq(socialAccounts.id, account.id));
    await refreshFacialIdsForGroups([target], tx, movedAlone ? [movedAlone] : []);
  });
  markFaceIdentitiesDirty();
  void syncCompute(target, before, movedFaceIds);

  const [resolvedAccount] = await db.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.personfaceUuid, target));
  return { personId: await groupPersonId(target), socialAccountId: resolvedAccount?.id ?? null, personfaceUuid: target };
}

export type DisassociateFaceResult = { newGroupUuid: string };

/**
 * Pull one face out of its group into a brand-new group of its own. When the
 * old group was a named identity, remember "this face isn't them" as a
 * face_pair_dismissals row so auto-assign and look-alikes never offer that
 * identity for it again (face-review-plan.md §8.4).
 */
export async function disassociateFace(faceUuid: string): Promise<DisassociateFaceResult> {
  const [faceRow] = await db.select({ id: faces.id, personfaceUuid: faces.personfaceUuid }).from(faces).where(eq(faces.id, faceUuid));
  if (!faceRow) throw new RecognitionRequestError(404, "Face not found.");
  const newGroupUuid = crypto.randomUUID();
  const oldGroup = faceRow.personfaceUuid;
  const wasNamed = oldGroup ? !!(await computeIdentity(oldGroup)) : false;
  await db.transaction(async (tx) => {
    await tx.update(faces).set({ personfaceUuid: newGroupUuid, autoMatchScore: null }).where(eq(faces.id, faceRow.id));
    if (oldGroup && wasNamed) {
      const [a, b] = oldGroup < newGroupUuid ? [oldGroup, newGroupUuid] : [newGroupUuid, oldGroup];
      await tx.insert(facePairDismissals).values({ groupAUuid: a, groupBUuid: b, userId: currentAccess()?.userId ?? null }).onConflictDoNothing();
    }
    await refreshFacialIdsForGroups([newGroupUuid], tx);
  });
  markFaceIdentitiesDirty();
  return { newGroupUuid };
}

// ── Auto-assign confident matches (face-review-plan.md §8.2) ─────────────────

export type AutoAssignResult = { scanned: number; assigned: number };

let fullAutoAssign: Promise<AutoAssignResult> | null = null;

/**
 * Assign each open face (not dismissed, not in a named group) to its top
 * look-alike when that score is at least `face_auto_assign_min_score` and the
 * runner-up isn't within AUTO_ASSIGN_MIN_MARGIN of it. The face alone moves
 * (its unnamed compute siblings are scored on their own) and is marked with
 * `auto_match_score` until a person confirms or removes it. Several faces in
 * one photo may go to the same identity (collage images).
 * `faceIds` limits the run to those faces (a freshly recognised photo);
 * without it every open face is scanned, one run at a time.
 */
export function autoAssignFaces(faceIds?: string[]): Promise<AutoAssignResult> {
  if (faceIds) return runAutoAssign(faceIds);
  fullAutoAssign ??= runAutoAssign().finally(() => {
    fullAutoAssign = null;
  });
  return fullAutoAssign;
}

async function runAutoAssign(faceIds?: string[]): Promise<AutoAssignResult> {
  if (faceIds && !faceIds.length) return { scanned: 0, assigned: 0 };
  const unnamed = sql`NOT EXISTS (SELECT 1 FROM ${people} WHERE ${people.personfaceUuid} = ${faces.personfaceUuid})
    AND NOT EXISTS (SELECT 1 FROM ${socialAccounts} WHERE ${socialAccounts.personfaceUuid} = ${faces.personfaceUuid})`;
  const candidates = await db
    .select({ id: faces.id, personfaceUuid: faces.personfaceUuid })
    .from(faces)
    .where(and(isNull(faces.dismissedAt), isNotNull(faces.photoId), isNotNull(faces.embedding), unnamed, faceIds ? inArray(faces.id, faceIds) : undefined));
  if (!candidates.length) return { scanned: 0, assigned: 0 };

  const minScore = await getAutoAssignMinScore();
  type Pick = { faceId: string; oldGroup: string | null; group: string; score: number };
  const picks: Pick[] = [];
  const BATCH = 500;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    // Scoring a margin below the threshold keeps a just-under runner-up in the list, so near ties are seen.
    const scores = await lookAlikesFor(batch.map((c) => c.id), { minScore: minScore - AUTO_ASSIGN_MIN_MARGIN });
    for (const c of batch) {
      const [top, runnerUp] = scores.get(c.id) ?? [];
      if (!top || top.score < minScore) continue;
      if (runnerUp && top.score - runnerUp.score < AUTO_ASSIGN_MIN_MARGIN) continue;
      picks.push({ faceId: c.id, oldGroup: c.personfaceUuid, group: top.personfaceUuid, score: top.score });
    }
  }
  // The same identity may take several faces in one photo: a post image is often a collage of one person.
  if (!picks.length) return { scanned: candidates.length, assigned: 0 };

  await db.transaction(async (tx) => {
    for (const a of picks) {
      // Guarded on the group read above, so a face a person assigned meanwhile is left alone.
      await tx
        .update(faces)
        .set({ personfaceUuid: a.group, autoMatchScore: a.score })
        .where(and(eq(faces.id, a.faceId), isNull(faces.dismissedAt), a.oldGroup ? eq(faces.personfaceUuid, a.oldGroup) : isNull(faces.personfaceUuid)));
    }
    await refreshFacialIdsForGroups([], tx, picks.map((a) => a.faceId));
  });

  const byGroup = new Map<string, string[]>();
  for (const a of picks) byGroup.set(a.group, [...(byGroup.get(a.group) ?? []), a.faceId]);
  void (async () => {
    for (const [group, ids] of Array.from(byGroup)) await syncCompute(group, [], ids);
  })();

  log(`[FaceAutoAssign] ${picks.length} of ${candidates.length} open faces assigned (min ${minScore})`);
  return { scanned: candidates.length, assigned: picks.length };
}

const AUTO_ASSIGN_INTERVAL_MS = 60 * 60 * 1000;

/** Hourly full auto-assign run: newly named faces make more matches possible over time. */
export function startFaceAutoAssignScheduler(): void {
  const tick = () => runAsSystem(() => autoAssignFaces()).catch((err) => log(`[FaceAutoAssign] scheduled run failed: ${err?.message ?? err}`));
  setTimeout(tick, 5 * 60 * 1000);
  setInterval(tick, AUTO_ASSIGN_INTERVAL_MS);
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

type ProfileLinkCheck =
  | { ok: false; reason: ProfileLinkReason }
  | {
      ok: true;
      accountId: string;
      faceRow: { id: string; personfaceUuid: string | null };
      account: { ownerUuid: string | null; personfaceUuid: string | null };
      owner: { id: string; personfaceUuid: string | null } | undefined;
      target: string;
      facePct: number;
    };

/**
 * Pure check for whether a profile picture's detection would link that face to
 * its account: no writes. Used by both linkProfileFace (which then applies it)
 * and profileLinkReason (read-only, for surfacing why a photo isn't linked).
 */
async function profileLinkCheck(photo: Photo, detected: DetectedFace[], getBuffer: () => Promise<Buffer>): Promise<ProfileLinkCheck> {
  const accountId = profileAccountId(photo);
  if (!accountId) return { ok: false, reason: "not_profile" };
  const [account] = await db
    .select({ ownerUuid: socialAccounts.ownerUuid, personfaceUuid: socialAccounts.personfaceUuid, noFace: socialAccounts.noFace })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, accountId));
  if (!account) return { ok: false, reason: "not_profile" };
  if (account.noFace) return { ok: false, reason: "no_face_account" };
  if (detected.length === 0) return { ok: false, reason: "no_faces" };
  if (detected.length > 1) return { ok: false, reason: "multiple_faces" };

  const face = detected[0];
  const box = (face.box || face.coordinates) as { w?: number; h?: number } | null;
  if (!box || !(box.w! > 0) || !(box.h! > 0)) return { ok: false, reason: "no_box" };
  let { widthPx, heightPx } = photo;
  if (!widthPx || !heightPx) {
    const meta = await sharp(await getBuffer()).metadata();
    widthPx = meta.width ?? null;
    heightPx = meta.height ?? null;
  }
  if (!widthPx || !heightPx) return { ok: false, reason: "no_box" };
  const facePct = (Math.max(box.w!, box.h!) / Math.min(widthPx, heightPx)) * 100;
  if (facePct < await getProfileLinkMinFacePct()) return { ok: false, reason: "face_too_small" };

  const faceUuid = face.face_uuid || face.faceUuid;
  const [faceRow] = faceUuid
    ? await db.select({ id: faces.id, personfaceUuid: faces.personfaceUuid }).from(faces).where(eq(faces.id, faceUuid))
    : [];
  if (!faceRow) return { ok: false, reason: "face_missing" };

  const [owner] = account.ownerUuid
    ? await db.select({ id: people.id, personfaceUuid: people.personfaceUuid }).from(people).where(eq(people.id, account.ownerUuid))
    : [];

  const target = account.personfaceUuid ?? owner?.personfaceUuid ?? faceRow.personfaceUuid ?? crypto.randomUUID();
  // Compute already grouped this face with a different identity: leave both alone.
  if (faceRow.personfaceUuid && faceRow.personfaceUuid !== target) return { ok: false, reason: "group_conflict" };

  return { ok: true, accountId, faceRow, account, owner, target, facePct };
}

/**
 * A profile picture showing exactly one big-enough face is the account holder:
 * put that face's group on social_accounts.personface_uuid so the same face in
 * any other photo can be named "@username" without a person existing yet. When
 * the account already has an owner, the owner's face group is used (and set if
 * the person had none), matching what /api/prm-face/face/connect would do.
 */
async function linkProfileFace(photo: Photo, detected: DetectedFace[], getBuffer: () => Promise<Buffer>): Promise<ProfileLinkOutcome> {
  const check = await profileLinkCheck(photo, detected, getBuffer);
  if (!check.ok) return { linked: false, reason: check.reason };
  const { accountId, faceRow, account, owner, target, facePct } = check;

  const alreadyLinked = account.personfaceUuid === target && faceRow.personfaceUuid === target;
  if (faceRow.personfaceUuid !== target) await db.update(faces).set({ personfaceUuid: target }).where(eq(faces.id, faceRow.id));
  if (account.personfaceUuid !== target) await db.update(socialAccounts).set({ personfaceUuid: target }).where(eq(socialAccounts.id, accountId));
  if (owner && !owner.personfaceUuid) await db.update(people).set({ personfaceUuid: target }).where(eq(people.id, owner.id));
  if (!alreadyLinked) {
    log(`[ProfileLink] account ${accountId} <- face ${faceRow.id} (${facePct.toFixed(0)}% of image)`);
    markFaceIdentitiesDirty();
  }
  return { linked: true, personfaceUuid: target, alreadyLinked };
}

/**
 * Read-only version of linkProfileFace for a photo that's already been
 * recognised: replays the check from its stored facial_ids, no writes. Returns
 * null when it would link (nothing to report), otherwise the reason it can't.
 */
export async function profileLinkReason(photo: Photo): Promise<ProfileLinkReason | null> {
  const detected: DetectedFace[] = ((photo.facialIds ?? []) as FacialId[]).map((f) => ({ face_uuid: f.faceUuid, box: f.coordinates }));
  const check = await profileLinkCheck(photo, detected, async () => (await fetchImageBuffer(photo.location)).buffer);
  return check.ok ? null : check.reason;
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
      eq(socialAccounts.noFace, false),
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

export type NoFaceImpact = { personfaceUuid: string | null; unlinkedFaces: number };

/**
 * What marking an account "no face" with clearLinks would undo: its face group,
 * and how many faces go back to unidentified (none when a person or another
 * account still names that group).
 */
export async function noFaceImpact(accountId: string): Promise<NoFaceImpact> {
  const [account] = await db.select({ personfaceUuid: socialAccounts.personfaceUuid }).from(socialAccounts).where(eq(socialAccounts.id, accountId));
  if (!account) throw new RecognitionRequestError(404, "Social account not found.");
  const group = account.personfaceUuid;
  if (!group) return { personfaceUuid: null, unlinkedFaces: 0 };
  const [row] = await db.select({
    count: sql<number>`count(*)::int`,
    namedElsewhere: sql<boolean>`EXISTS (SELECT 1 FROM ${people} WHERE ${people.personfaceUuid} = ${group})
      OR EXISTS (SELECT 1 FROM ${socialAccounts} WHERE ${socialAccounts.personfaceUuid} = ${group} AND ${socialAccounts.id} <> ${accountId})`,
  }).from(faces).where(eq(faces.personfaceUuid, group));
  return { personfaceUuid: group, unlinkedFaces: row?.namedElsewhere ? 0 : row?.count ?? 0 };
}

/**
 * "This account doesn't have a face": face review and the profile auto-link
 * stop matching faces to it. With clearLinks, its face group is dropped too,
 * so faces named only by this account go back to unidentified.
 */
export async function setAccountNoFace(accountId: string, noFace: boolean, clearLinks: boolean): Promise<void> {
  const [account] = await db.select({ personfaceUuid: socialAccounts.personfaceUuid }).from(socialAccounts).where(eq(socialAccounts.id, accountId));
  if (!account) throw new RecognitionRequestError(404, "Social account not found.");
  const group = noFace && clearLinks ? account.personfaceUuid : null;
  await db.transaction(async (tx) => {
    await tx.update(socialAccounts).set(group ? { noFace, personfaceUuid: null } : { noFace }).where(eq(socialAccounts.id, accountId));
    if (group) await refreshFacialIdsForGroups([group], tx);
  });
  if (group) markFaceIdentitiesDirty();
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

export type AutoRecognitionKind = "profile" | "post" | "story" | "message";
export type AutoRecognitionJob = "face" | "ocr" | "transcribe";

export type AutoRecognitionSettings = {
  profile: { face: boolean };
  post: { face: boolean; ocr: boolean; transcribe: boolean };
  story: { face: boolean; ocr: boolean; transcribe: boolean };
  message: { face: boolean };
  profileLink: { minFacePct: number };
  lookalike: { minScore: number };
  autoAssign: { minScore: number };
};

const AUTO_RECOGNITION_KEYS: Record<AutoRecognitionKind, Partial<Record<AutoRecognitionJob, string>>> = {
  profile: { face: "auto_recog_profile_face" },
  post: { face: "auto_recog_post_face", ocr: "auto_recog_post_ocr", transcribe: "auto_recog_post_transcribe" },
  story: { face: "auto_recog_story_face", ocr: "auto_recog_story_ocr", transcribe: "auto_recog_story_transcribe" },
  message: { face: "auto_recog_message_face" },
};

export const JOB_TASK_TYPE: Record<AutoRecognitionJob, string> = {
  face: "analyze_img_face",
  ocr: "analyze_img_ocr",
  transcribe: "transcribe_video",
};

/** Task types that need PRM-Compute; the worker holds these back while compute is down. */
export const RECOGNITION_TASK_TYPES = Object.values(JOB_TASK_TYPE);

// ── Parallel lanes ────────────────────────────────────────────────────────────
// How many jobs of each engine run at once, plus an overall cap. PRM-Compute
// reads the same app_settings keys (concurrency.py), so the task worker never
// sends more than compute will take. busyWait is how long compute queues a
// request before answering 503 busy; it must stay well under the fetch timeouts.

export type ComputeLanes = { face: number; ocr: number; stt: number; total: number; busyWait: number };

export const COMPUTE_LANE_KEYS: Record<keyof ComputeLanes, string> = {
  face: "compute_lanes_face",
  ocr: "compute_lanes_ocr",
  stt: "compute_lanes_stt",
  total: "compute_lanes_total",
  busyWait: "compute_busy_wait_seconds",
};
export const COMPUTE_LANE_DEFAULTS: ComputeLanes = { face: 1, ocr: 1, stt: 1, total: 3, busyWait: 20 };
export const COMPUTE_LANE_MAX: ComputeLanes = { face: 16, ocr: 16, stt: 16, total: 16, busyWait: 30 };

export async function getComputeLanes(): Promise<ComputeLanes> {
  const lanes = { ...COMPUTE_LANE_DEFAULTS };
  for (const key of Object.keys(lanes) as (keyof ComputeLanes)[]) {
    const n = Number(await storage.getAppSetting(COMPUTE_LANE_KEYS[key]));
    if (Number.isInteger(n) && n >= 1) lanes[key] = Math.min(n, COMPUTE_LANE_MAX[key]);
  }
  return lanes;
}

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
  out.lookalike = { minScore: await getLookalikeMinScore() };
  out.autoAssign = { minScore: await getAutoAssignMinScore() };
  return out;
}

export async function setAutoRecognitionSettings(
  update: Partial<Record<AutoRecognitionKind, Partial<Record<AutoRecognitionJob, boolean>>>> & {
    profileLink?: { minFacePct?: unknown };
    lookalike?: { minScore?: unknown };
    autoAssign?: { minScore?: unknown };
  },
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
  if (update.lookalike?.minScore !== undefined) await setLookalikeMinScore(Number(update.lookalike.minScore));
  if (update.autoAssign?.minScore !== undefined) await setAutoAssignMinScore(Number(update.autoAssign.minScore));
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
  imageTaskGroupId?: string;
}): Promise<number> {
  const userId = await queueOwnerId();
  if (!userId) return 0;
  let queued = 0;

  let groupId = input.imageTaskGroupId;
  if (!groupId && ((input.photoIds && input.photoIds.length > 0) || (input.videoPostIds && input.videoPostIds.length > 0))) {
    const count = (input.photoIds?.length ?? 0) + (input.videoPostIds?.length ?? 0);
    const grp = await storage.createImageTaskGroup({
      userId,
      title: `Recognition Batch (${count} item${count !== 1 ? "s" : ""})`,
      kind: "recognition_batch",
    });
    groupId = grp.id;
  }

  for (const job of input.jobs) {
    const type = JOB_TASK_TYPE[job];
    if (job === "transcribe") {
      const ids = input.videoPostIds ?? [];
      const live = await alreadyQueued(type, ids, "postId");
      for (const postId of ids) {
        if (live.has(postId)) continue;
        await storage.createImageTask({ userId, type, imageTaskGroupId: groupId || undefined, payload: JSON.stringify({ postId }) });
        queued++;
      }
    } else {
      const ids = input.photoIds ?? [];
      const live = await alreadyQueued(type, ids, "photoId");
      for (const photoId of ids) {
        if (live.has(photoId)) continue;
        await storage.createImageTask({ userId, type, photoId, imageTaskGroupId: groupId || undefined, payload: JSON.stringify({ photoId }) });
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
  imageTaskGroupId?: string;
}): Promise<void> {
  try {
    const settings = (await getAutoRecognitionSettings())[input.kind] as Partial<Record<AutoRecognitionJob, boolean>>;
    const jobs = (Object.keys(settings) as AutoRecognitionJob[]).filter((job) => settings[job]);
    if (!jobs.length) return;
    const queued = await enqueueRecognitionTasks({
      jobs,
      photoIds: input.photoIds,
      videoPostIds: input.videoPostId ? [input.videoPostId] : [],
      imageTaskGroupId: input.imageTaskGroupId,
    });
    if (queued) log(`[AutoRecognition] queued ${queued} ${input.kind} task(s) for ${input.photoIds.length} photo(s)`);
  } catch (err) {
    console.error("[AutoRecognition] failed to queue:", err);
  }
}

// ── Backfill ──────────────────────────────────────────────────────────────────

const STORY_KINDS: Record<AutoRecognitionKind, "story" | "not_story" | "profile" | "message"> = {
  profile: "profile", post: "not_story", story: "story", message: "message",
};

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
  } else if (STORY_KINDS[kind] === "message") {
    conditions.push(sql`${photos.prmLocation} LIKE 'message:%'`);
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
    if (kind !== "post" && kind !== "story") return { photoIds: [], videoPostIds: [] };
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
