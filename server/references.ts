/**
 * References: a face crop plus what was printed beside it (name, bio) and where
 * it was collected (location). PRM keeps the record in reference_records;
 * PRM-compute keeps the embedding in reference_vectors and the crop under
 * references/ in PRM-S3, both keyed by the reference UUID. Separate from the
 * standard face DB: nothing here creates faces, people or groups.
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { faces, people, referenceRecords, type ReferenceLocation, type ReferenceRecord } from "@shared/schema";
import { computeFetch, getComputeConnection } from "./recognition";
import type { FaceBox } from "./faces";

async function computeJson<T>(pathname: string, body: FormData | object, timeoutMs: number, label: string): Promise<T> {
  const response = await computeFetch(pathname, body, timeoutMs);
  if (!response.ok) throw new Error(`PRM Compute ${label} failed: ${await response.text()}`);
  return (await response.json()) as T;
}

const imageForm = (image: Buffer, mimeType: string, fileName: string) => {
  const form = new FormData();
  form.append("image", new Blob([image], { type: mimeType }), fileName || "image.jpg");
  return form;
};

// ── Detect / commit (used by the roster import) ─────────────────────────────

export type DetectedReference = { referenceUuid: string; box: FaceBox; cropUrl: string };

/** `dryRun` stores nothing in compute; crops come back as data URLs. */
export async function detectReferences(image: Buffer, mimeType: string, fileName: string, dryRun = false): Promise<DetectedReference[]> {
  const form = imageForm(image, mimeType, fileName);
  form.append("max_faces", "500");
  if (dryRun) form.append("dry_run", "true");
  const data = await computeJson<{ faces: { reference_uuid: string; box: FaceBox; crop_url: string }[] }>(
    "/api/reference/detect", form, 120000, "reference detect",
  );
  return data.faces.map((f) => ({ referenceUuid: f.reference_uuid, box: f.box, cropUrl: f.crop_url }));
}

export type NewReference = { referenceUuid: string; cropUrl: string; name?: string; role?: string; bio?: string };

export async function saveReferences(location: ReferenceLocation, entries: NewReference[], discard: string[]): Promise<number> {
  if (entries.length) {
    await db.insert(referenceRecords).values(entries.map((e) => ({
      id: e.referenceUuid,
      cropUrl: e.cropUrl,
      name: e.name?.trim() || null,
      role: e.role?.trim() || null,
      bio: e.bio?.trim() || null,
      location,
    }))).onConflictDoNothing();
  }
  if (discard.length) await deleteComputeReferences({ ids: discard }).catch((err) => console.error("[References] discard:", err?.message ?? err));
  return entries.length;
}

// ── List ─────────────────────────────────────────────────────────────────────

export type ReferenceListQuery = { name?: string; q?: string; type?: string; sort?: "newest" | "oldest"; page?: number; pageSize?: number };

export async function listReferences(query: ReferenceListQuery): Promise<{ items: ReferenceRecord[]; total: number; types: string[] }> {
  const where: SQL[] = [];
  const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  if (query.name?.trim()) where.push(sql`${referenceRecords.name} ILIKE ${like(query.name.trim())}`);
  if (query.q?.trim()) {
    const kw = like(query.q.trim());
    where.push(sql`(${referenceRecords.name} ILIKE ${kw} OR ${referenceRecords.role} ILIKE ${kw} OR ${referenceRecords.bio} ILIKE ${kw} OR ${referenceRecords.location}::text ILIKE ${kw})`);
  }
  if (query.type?.trim()) where.push(sql`lower(${referenceRecords.location}->>'type') = lower(${query.type.trim()})`);
  const cond = where.length ? and(...where) : undefined;

  const pageSize = Math.min(Math.max(query.pageSize ?? 60, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const [items, [{ total }], typeRows] = await Promise.all([
    db.select().from(referenceRecords).where(cond)
      .orderBy(query.sort === "oldest" ? asc(referenceRecords.collectedAt) : desc(referenceRecords.collectedAt), asc(referenceRecords.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(referenceRecords).where(cond),
    db.selectDistinct({ type: sql<string>`${referenceRecords.location}->>'type'` }).from(referenceRecords),
  ]);
  return { items, total, types: typeRows.map((r) => r.type).filter(Boolean).sort() };
}

// ── Search by face ───────────────────────────────────────────────────────────

export type ReferenceMatch = ReferenceRecord & { similarity: number };
export type ReferenceSearchProbe =
  | { image: Buffer; mimeType: string; fileName: string }
  | { faceUuid: string }
  | { personId: string }
  | { referenceId: string };

export async function searchReferences(probe: ReferenceSearchProbe): Promise<{ probeFaces: number; matches: ReferenceMatch[] }> {
  let form: FormData;
  if ("image" in probe) form = imageForm(probe.image, probe.mimeType, probe.fileName);
  else {
    form = new FormData();
    if ("referenceId" in probe) form.append("reference_uuid", probe.referenceId);
    else {
      const ids = "faceUuid" in probe ? [probe.faceUuid] : await personFaceIds(probe.personId);
      if (ids.length === 0) return { probeFaces: 0, matches: [] };
      form.append("face_uuids", ids.join(","));
    }
  }
  const data = await computeJson<{ probe_faces: number; matches: { reference_uuid: string; similarity: number }[] }>(
    "/api/reference/search", form, 60000, "reference search",
  );
  if (data.matches.length === 0) return { probeFaces: data.probe_faces, matches: [] };
  const rows = await db.select().from(referenceRecords).where(inArray(referenceRecords.id, data.matches.map((m) => m.reference_uuid)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    probeFaces: data.probe_faces,
    matches: data.matches.flatMap((m) => {
      const row = byId.get(m.reference_uuid);
      return row ? [{ ...row, similarity: m.similarity }] : [];
    }),
  };
}

/** The person's linked faces (their face group), capped so the probe stays small. */
async function personFaceIds(personId: string): Promise<string[]> {
  const [person] = await db.select({ personfaceUuid: people.personfaceUuid }).from(people).where(eq(people.id, personId));
  if (!person?.personfaceUuid) return [];
  const rows = await db.select({ id: faces.id }).from(faces).where(eq(faces.personfaceUuid, person.personfaceUuid)).limit(50);
  return rows.map((r) => r.id);
}

// ── Delete ───────────────────────────────────────────────────────────────────

async function deleteComputeReferences(body: { ids: string[] } | { all: true }) {
  return computeJson<{ deleted: number; crops_deleted?: number; crops_error?: string | null }>("/api/reference/delete", body, 120000, "reference delete");
}

export async function deleteAllReferences(): Promise<{ deleted: number; cropsError: string | null }> {
  const compute = await deleteComputeReferences({ all: true });
  const deleted = (await db.delete(referenceRecords).returning({ id: referenceRecords.id })).length;
  return { deleted, cropsError: compute.crops_error ?? null };
}

/** Database reset: the tables are dropped with everything else; this clears compute's crops. */
export async function clearComputeReferencesForReset(): Promise<void> {
  if (!(await getComputeConnection())) return;
  await deleteComputeReferences({ all: true }).catch((err) => console.error("[References] reset:", err?.message ?? err));
}
