/**
 * The honey pot (honey-pot-plan.md): where really blurry faces are put out of the way.
 * A honey pot face is dismissed (so every queue, clustering, auto-assign and the centroids
 * already skip it) and tagged `honeypot`: 'manual' when a person sent it, 'auto' when
 * auto-assign matched it to a manual one (recognition.ts runAutoAssign). Only manual faces
 * are matched against; Confirm turns an auto face into a manual one. Releasing marks it
 * 'released', which auto routing respects.
 */
import { and, desc, eq, inArray, isNotNull, not, sql } from "drizzle-orm";
import { db } from "./db";
import { faces } from "@shared/schema";
import { clearedSuggestions, disassociateFaces, faceGroupUnnamed } from "./recognition";
import { markHoneypotDirty } from "./face-lookalikes";

export type HoneypotSource = "manual" | "auto";
export type HoneypotFace = {
  id: string; cropUrl: string; photoId: string | null; sharpness: number | null;
  honeypotAt: Date | null; source: HoneypotSource; score: number | null;
};

const inHoneypot = inArray(faces.honeypot, ["manual", "auto"]);

/** Put faces in the honey pot. A face in a named group leaves it first, so a blurry crop stops shaping that identity. */
export async function sendToHoneypot(faceIds: string[]): Promise<{ sent: number }> {
  if (!faceIds.length) return { sent: 0 };
  const named = await db
    .select({ id: faces.id })
    .from(faces)
    .where(and(inArray(faces.id, faceIds), isNotNull(faces.personfaceUuid), not(faceGroupUnnamed)));
  if (named.length) await disassociateFaces(named.map((r) => r.id));
  const now = new Date();
  const rows = await db
    .update(faces)
    .set({ dismissedAt: now, honeypot: "manual", honeypotAt: now, honeypotScore: null, autoMatchScore: null, ...clearedSuggestions })
    .where(inArray(faces.id, faceIds))
    .returning({ id: faces.id });
  markHoneypotDirty();
  return { sent: rows.length };
}

/** Take faces back out: they return to the review queues and the next cluster run, and auto routing leaves them alone. */
export async function releaseFromHoneypot(faceIds: string[]): Promise<{ released: number }> {
  if (!faceIds.length) return { released: 0 };
  const rows = await db
    .update(faces)
    .set({ dismissedAt: null, honeypot: "released", honeypotAt: null, honeypotScore: null })
    .where(and(inArray(faces.id, faceIds), inHoneypot))
    .returning({ id: faces.id });
  markHoneypotDirty();
  return { released: rows.length };
}

/** Keep auto-routed faces for good: they become manual, so future faces are matched against them too. */
export async function confirmHoneypot(faceIds: string[]): Promise<{ confirmed: number }> {
  if (!faceIds.length) return { confirmed: 0 };
  const rows = await db
    .update(faces)
    .set({ honeypot: "manual", honeypotScore: null })
    .where(and(inArray(faces.id, faceIds), eq(faces.honeypot, "auto")))
    .returning({ id: faces.id });
  markHoneypotDirty();
  return { confirmed: rows.length };
}

/** Honey pot faces, newest first; `source` narrows to how they got there. */
export async function listHoneypot(
  offset: number,
  limit: number,
  source?: HoneypotSource,
): Promise<{ items: HoneypotFace[]; total: number; manual: number; auto: number }> {
  const where = source ? eq(faces.honeypot, source) : inHoneypot;
  const [items, [counts]] = await Promise.all([
    db
      .select({
        id: faces.id, cropUrl: faces.s3Url, photoId: faces.photoId, sharpness: faces.sharpness,
        honeypotAt: faces.honeypotAt, source: sql<HoneypotSource>`${faces.honeypot}`, score: faces.honeypotScore,
      })
      .from(faces)
      .where(where)
      .orderBy(desc(faces.honeypotAt), desc(faces.id))
      .offset(offset)
      .limit(limit),
    db
      .select({
        manual: sql<number>`count(*) FILTER (WHERE ${faces.honeypot} = 'manual')::int`,
        auto: sql<number>`count(*) FILTER (WHERE ${faces.honeypot} = 'auto')::int`,
      })
      .from(faces)
      .where(inHoneypot),
  ]);
  const total = source ? counts[source] : counts.manual + counts.auto;
  return { items, total, manual: counts.manual, auto: counts.auto };
}
