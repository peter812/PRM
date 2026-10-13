/**
 * Roster import (yearbook / playbill demo): find every face on a page, have the
 * vision model read the name (and bio) that belongs to each numbered face, then
 * create or reuse a person per face, link the face, and file them under the
 * school / CYT branch group.
 *
 * New people are created low value (people.is_low_value = 1) so a few thousand
 * classmates don't crowd the people list.
 */
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "./db";
import { faces, groups, people, photos, subGroups } from "@shared/schema";
import { storage } from "./storage";
import { fetchImageBuffer, uploadProfileImage } from "./prm-s3";
import { runFaceRecognition, connectFace } from "./recognition";
import { normalizeBox, type FaceBox } from "./faces";
import { describeImage } from "./ai/describe";
import { extractJsonObject } from "./json-extract";
import { syncEntityInBackground } from "./vector-universal";

export const ROSTER_LAYOUTS = ["yearbook", "yearbook_advanced", "cyt", "cyt_leads"] as const;
export type RosterLayout = (typeof ROSTER_LAYOUTS)[number];

export type RosterContext = {
  school?: string; yearbookYear?: string; grade?: string; // yearbook layouts
  branch?: string; year?: string; quarter?: string; production?: string; // CYT layouts
};

export type RosterPersonRef = { id: string; name: string; imageUrl: string | null };
export type RosterMatch =
  | { status: "existing"; person: RosterPersonRef }
  | { status: "suggestion"; candidates: RosterPersonRef[] }
  | { status: "new" };

export type RosterEntry = {
  n: number;
  faceUuid: string;
  box: FaceBox;
  cropUrl: string | null;
  firstName: string;
  lastName: string;
  bio: string;
  lowConfidence: boolean;
  match: RosterMatch;
};

export type RosterAnalysis = { photoId: string; imageUrl: string; entries: RosterEntry[]; extraNames: string[] };

const isYearbook = (layout: RosterLayout) => layout === "yearbook" || layout === "yearbook_advanced";

/** The school / CYT branch group: the dedup scope, and where everyone is filed. */
export function contextGroupName(layout: RosterLayout, ctx: RosterContext): string {
  if (isYearbook(layout)) return (ctx.school ?? "").trim();
  const branch = (ctx.branch ?? "").trim();
  return /^cyt\b/i.test(branch) ? branch : `CYT ${branch}`;
}

/** The edition sub-group, e.g. "2019 Yearbook – Grade 10" or "2024 Q2 – Annie". */
function editionName(layout: RosterLayout, ctx: RosterContext): string {
  if (isYearbook(layout)) {
    return [ctx.yearbookYear && `${ctx.yearbookYear} Yearbook`, ctx.grade && `Grade ${ctx.grade}`].filter(Boolean).join(" – ");
  }
  return [[ctx.year, ctx.quarter].filter(Boolean).join(" "), ctx.production].filter(Boolean).join(" – ");
}

export function missingContext(layout: RosterLayout, ctx: RosterContext): string[] {
  const required: (keyof RosterContext)[] = isYearbook(layout)
    ? ["school", "yearbookYear", "grade"]
    : ["branch", "year", "quarter", "production"];
  return required.filter((k) => !ctx[k]?.trim());
}

// ── Analyze ──────────────────────────────────────────────────────────────────

/** Reading order: cluster faces into rows by vertical centre, then left to right. */
function readingOrder<T extends { box: FaceBox }>(items: T[]): T[] {
  const byY = [...items].sort((a, b) => (a.box.y + a.box.h / 2) - (b.box.y + b.box.h / 2));
  const rows: T[][] = [];
  for (const item of byY) {
    const row = rows[rows.length - 1];
    const cy = item.box.y + item.box.h / 2;
    const rowCy = row && row.reduce((s, r) => s + r.box.y + r.box.h / 2, 0) / row.length;
    const rowH = row && row.reduce((s, r) => s + r.box.h, 0) / row.length;
    if (row && Math.abs(cy - rowCy!) < rowH! * 0.5) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.box.x - b.box.x));
}

/** The page with each face boxed and numbered, so the model can say which name belongs to which face. */
async function labelFaces(image: Buffer, boxes: FaceBox[]): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const marks = boxes.map((b, i) => {
    const size = Math.max(14, Math.round(b.h * 0.3));
    return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#ff0040" stroke-width="${Math.max(2, size / 8)}"/>`
      + `<rect x="${b.x}" y="${b.y}" width="${size * (String(i + 1).length * 0.65 + 0.4)}" height="${size * 1.1}" fill="#ff0040"/>`
      + `<text x="${b.x + size * 0.2}" y="${b.y + size * 0.9}" font-family="Arial, sans-serif" font-weight="bold" font-size="${size}" fill="#fff">${i + 1}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${marks.join("")}</svg>`;
  return sharp(image).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 90 }).toBuffer();
}

const LAYOUT_INSTRUCTIONS: Record<RosterLayout, string> = {
  yearbook: "This is a yearbook page. Each person's name is printed directly beneath their photo.",
  yearbook_advanced:
    "This is a yearbook page. Each row of photos has its own list of names printed to the left of the photos. " +
    "Within a row, the names are listed in the same order as the photos from left to right.",
  cyt: "This is a theater playbill (cast page). Each person's name is printed directly beneath their photo.",
  cyt_leads:
    "This is a theater playbill (leads page). Photos are on the left; to the right of each photo is a text block. " +
    "The first line of that block is the person's name and the remaining lines are their bio.",
};

function buildPrompt(layout: RosterLayout, count: number): string {
  return [
    LAYOUT_INSTRUCTIONS[layout],
    `I have drawn a red box with a red number tag on each of the ${count} detected faces (numbered 1 to ${count}).`,
    "For each numbered face, read the name that belongs to that face. Split it into first name and last name " +
      "(put middle names or initials with the first name; keep suffixes like Jr. with the last name).",
    layout === "cyt_leads" ? "Also copy the bio text for each face exactly as printed, joined into one paragraph." : "Leave bio empty.",
    "If you cannot read a face's name, return empty strings for it and set confident to false.",
    "List any printed names that do not belong to a numbered face in extraNames (e.g. people pictured without a detected face, or 'Not Pictured').",
    'Reply with JSON only: {"faces":[{"n":1,"firstName":"","lastName":"","bio":"","confident":true}],"extraNames":[]}',
  ].join("\n");
}

export async function analyzeRoster(photoId: string, layout: RosterLayout, ctx: RosterContext): Promise<RosterAnalysis> {
  const [photo] = await db.select().from(photos).where(eq(photos.id, photoId));
  if (!photo) throw new Error("Photo not found.");

  const recognition = await runFaceRecognition(photoId);
  const detected = recognition.faces
    .map((f) => ({ faceUuid: (f.face_uuid || f.faceUuid) as string | undefined, box: normalizeBox(f.box ?? f.coordinates) }))
    .filter((f): f is { faceUuid: string; box: FaceBox } => !!f.faceUuid && !!f.box);
  if (detected.length === 0) return { photoId, imageUrl: photo.location, entries: [], extraNames: [] };

  const ordered = readingOrder(detected);
  const { buffer } = await fetchImageBuffer(photo.location);
  const reply = await describeImage(await labelFaces(buffer, ordered.map((f) => f.box)), { prompt: buildPrompt(layout, ordered.length) });
  const parsed = extractJsonObject(reply) as { faces?: any[]; extraNames?: unknown[] } | null;
  if (!parsed || !Array.isArray(parsed.faces)) throw new Error("The vision model did not return the expected JSON. Try again or pick a different vision model.");
  const byN = new Map(parsed.faces.map((f) => [Number(f?.n), f]));

  const cropRows = await db.select({ id: faces.id, s3Url: faces.s3Url }).from(faces)
    .where(sql`${faces.id} IN (${sql.join(ordered.map((f) => sql`${f.faceUuid}`), sql`, `)})`);
  const cropOf = new Map(cropRows.map((r) => [r.id, r.s3Url]));

  const groupId = await findGroupId(contextGroupName(layout, ctx));
  const entries: RosterEntry[] = [];
  for (const [i, face] of ordered.entries()) {
    const ai = byN.get(i + 1);
    const firstName = String(ai?.firstName ?? "").trim();
    const lastName = String(ai?.lastName ?? "").trim();
    entries.push({
      n: i + 1,
      faceUuid: face.faceUuid,
      box: face.box,
      cropUrl: cropOf.get(face.faceUuid) ?? null,
      firstName,
      lastName,
      bio: String(ai?.bio ?? "").trim(),
      lowConfidence: !ai || ai.confident === false || !firstName,
      match: await matchPersonInGroup(groupId, firstName, lastName),
    });
  }
  const extraNames = (parsed.extraNames ?? []).map((s) => String(s).trim()).filter(Boolean);
  return { photoId, imageUrl: photo.location, entries, extraNames };
}

// ── Dedup ────────────────────────────────────────────────────────────────────

async function findGroupId(name: string): Promise<string | null> {
  if (!name) return null;
  const [row] = await db.select({ id: groups.id }).from(groups).where(sql`lower(${groups.name}) = lower(${name})`).limit(1);
  return row?.id ?? null;
}

const toRef = (p: { id: string; firstName: string; lastName: string; imageUrl: string | null }): RosterPersonRef =>
  ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), imageUrl: p.imageUrl });

/**
 * Same full name and already in the school / branch group → that person.
 * Same name anywhere else → a suggestion the user must accept (default is new).
 */
async function matchPersonInGroup(groupId: string | null, firstName: string, lastName: string): Promise<RosterMatch> {
  if (!firstName) return { status: "new" };
  const sameName = await db
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName, imageUrl: people.imageUrl })
    .from(people)
    .where(and(sql`lower(${people.firstName}) = lower(${firstName})`, sql`lower(${people.lastName}) = lower(${lastName})`))
    .limit(20);
  if (sameName.length === 0) return { status: "new" };
  if (groupId) {
    const [group] = await db.select({ members: groups.members }).from(groups).where(eq(groups.id, groupId));
    const inGroup = sameName.find((p) => group?.members?.includes(p.id));
    if (inGroup) return { status: "existing", person: toRef(inGroup) };
  }
  return { status: "suggestion", candidates: sameName.map(toRef) };
}

export async function matchPerson(layout: RosterLayout, ctx: RosterContext, firstName: string, lastName: string): Promise<RosterMatch> {
  return matchPersonInGroup(await findGroupId(contextGroupName(layout, ctx)), firstName.trim(), lastName.trim());
}

// ── Commit ───────────────────────────────────────────────────────────────────

export type RosterCommitEntry = { faceUuid: string; box: FaceBox; firstName: string; lastName: string; bio?: string; personId?: string | null };
export type RosterCommitResult = {
  created: number; matched: number; imagesSet: number; failed: { name: string; error: string }[];
  groupId: string; subGroupId: string | null;
};

async function findOrCreateGroup(name: string, type: string): Promise<string> {
  const existing = await findGroupId(name);
  if (existing) return existing;
  const group = await storage.createGroup({ name, color: type === "School" ? "#2563eb" : "#9333ea", type: [type], members: [] });
  syncEntityInBackground("group", group.id);
  return group.id;
}

async function findOrCreateSubGroup(groupId: string, name: string): Promise<string | null> {
  if (!name) return null;
  const [row] = await db.select({ id: subGroups.id }).from(subGroups)
    .where(and(eq(subGroups.groupId, groupId), sql`lower(${subGroups.name}) = lower(${name})`)).limit(1);
  if (row) return row.id;
  return (await storage.createSubGroup({ groupId, name, color: "#64748b", members: [] })).id;
}

/** A padded square around the face from the original page; compute's crop is too tight for an avatar. */
async function profileCrop(page: Buffer, box: FaceBox): Promise<Buffer> {
  const img = sharp(page);
  const { width = 0, height = 0 } = await img.metadata();
  const side = Math.round(Math.max(box.w, box.h) * 1.8);
  const left = Math.max(0, Math.round(box.x + box.w / 2 - side / 2));
  const top = Math.max(0, Math.round(box.y + box.h / 2 - side / 2));
  return img
    .extract({ left, top, width: Math.min(side, width - left), height: Math.min(side, height - top) })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function commitRoster(photoId: string, layout: RosterLayout, ctx: RosterContext, entries: RosterCommitEntry[]): Promise<RosterCommitResult> {
  const [photo] = await db.select().from(photos).where(eq(photos.id, photoId));
  if (!photo) throw new Error("Photo not found.");
  const { buffer: page } = await fetchImageBuffer(photo.location);

  const groupId = await findOrCreateGroup(contextGroupName(layout, ctx), isYearbook(layout) ? "School" : "Theater");
  const subGroupId = await findOrCreateSubGroup(groupId, editionName(layout, ctx));
  const result: RosterCommitResult = { created: 0, matched: 0, imagesSet: 0, failed: [], groupId, subGroupId };
  const memberIds: string[] = [];

  for (const entry of entries) {
    const name = `${entry.firstName} ${entry.lastName}`.trim();
    try {
      let person = entry.personId ? (await db.select().from(people).where(eq(people.id, entry.personId)))[0] : undefined;
      if (entry.personId && !person) throw new Error("Matched person no longer exists.");
      if (person) result.matched++;
      else {
        person = await storage.createPerson({ firstName: entry.firstName.trim(), lastName: entry.lastName.trim(), isLowValue: 1 });
        result.created++;
      }

      await connectFace({ faceUuid: entry.faceUuid, personId: person.id });

      if (!person.imageUrl) {
        const crop = await profileCrop(page, entry.box);
        const imageUrl = await uploadProfileImage(crop, `${person.id}.jpg`, "image/jpeg");
        await storage.insertPhoto({ location: imageUrl, prmLocation: `person_image:${person.id}`, isSubImage: false });
        await storage.updatePerson(person.id, { imageUrl });
        result.imagesSet++;
      }

      if (isYearbook(layout)) await addSchooling(person.id, ctx);
      if (entry.bio?.trim()) {
        const where = [ctx.production, contextGroupName(layout, ctx), [ctx.quarter, ctx.year].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        const note = await storage.createNote({ personId: person.id, content: `Playbill bio (${where}):\n${entry.bio.trim()}` });
        syncEntityInBackground("note", note.id);
      }
      syncEntityInBackground("person", person.id);
      memberIds.push(person.id);
    } catch (err: any) {
      result.failed.push({ name: name || `face ${entry.faceUuid}`, error: err?.message ?? String(err) });
    }
  }

  await addMembers(groups, groupId, memberIds);
  if (subGroupId) await addMembers(subGroups, subGroupId, memberIds);
  return result;
}

async function addMembers(table: typeof groups | typeof subGroups, id: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(table)
    .set({ members: sql`ARRAY(SELECT DISTINCT unnest(coalesce(${table.members}, ARRAY[]::text[]) || ${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[]`}))` })
    .where(eq(table.id, id));
}

/** Record the school on the person's schooling (once per school + grade). */
async function addSchooling(personId: string, ctx: RosterContext): Promise<void> {
  const school = ctx.school?.trim();
  if (!school) return;
  const existing = await storage.getSchoolingByPersonId(personId);
  const course = ctx.grade ? `Grade ${ctx.grade}` : null;
  const additional = existing?.additionalSchooling ?? [];
  if (additional.some((s) => s.name.toLowerCase() === school.toLowerCase() && (s.course ?? null) === course)) return;
  await storage.upsertSchooling({
    personId,
    highSchool: existing?.highSchool ?? null,
    colleges: existing?.colleges ?? [],
    additionalSchooling: [...additional, { name: school, course, startDate: ctx.yearbookYear || null, endDate: ctx.yearbookYear || null }],
  });
}
