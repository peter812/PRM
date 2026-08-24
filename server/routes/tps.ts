// TruePeopleSearch (TPS) integration route module - tps.ts
//
// Backs the PRM-chrome extension's injections on www.truepeoplesearch.com:
//   - results page:  batch "Found / Not Found" status for the names on a page
//   - person page:   Found status + Extract status, "Add to PRM", and the
//                    full-record Extract into the true_person_search table.
//
// All routes authenticate with the X-Extension-Token header (the same session
// token flow as /api/v1/posts/import). Their paths are registered in
// PUBLIC_API_PATHS in auth-setup.ts so they bypass the browser-session gate.
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { storage } from "../storage";
import {
  people,
  truePersonSearch,
  isAdminRole,
  type ExtensionSession,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authenticateExtensionToken } from "../auth";
import { enterAccessContext } from "../access";

/**
 * Express helper: pull + verify the extension token, updating last-accessed.
 * Sends the 401 itself and returns null when auth fails.
 */
async function requireExtensionSession(
  req: Request,
  res: Response,
): Promise<ExtensionSession | null> {
  const token = req.headers["x-extension-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Extension token required" });
    return null;
  }
  const session = await authenticateExtensionToken(token);
  if (!session) {
    res.status(401).json({ error: "Invalid extension token" });
    return null;
  }
  await storage.updateExtensionSessionLastAccessed(session.id);
  // These routes are on the public list (no browser session), so accessMiddleware
  // never ran. Install the access context now that we know who is calling —
  // without it every filtered storage read throws AccessContextMissingError.
  // Admin cross-user view is deliberately never on for extension traffic.
  const user = await storage.getUser(session.userId);
  enterAccessContext({
    userId: session.userId,
    isAdmin: isAdminRole(user?.role),
    adminView: false,
    system: false,
  });
  return session;
}

/**
 * Normalize a full name to a comparable "first last" key (name-only matching).
 * Ignores middle names/initials, casing, and extra whitespace so a TPS name
 * like "Danna M Fallang" matches a PRM contact "Danna Fallang".
 */
function normalizeName(full: string | null | undefined): { key: string; first: string; last: string } | null {
  if (!full) return null;
  const tokens = full.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const first = tokens[0].toLowerCase();
  const last = tokens[tokens.length - 1].toLowerCase();
  return { key: tokens.length === 1 ? first : `${first} ${last}`, first, last };
}

export function registerRoutes(app: Express) {
  /**
   * Find the first PRM contact whose normalized first+last name matches.
   * `cache` memoizes the per-lastname candidate lookups within a single batch.
   */
  async function findMatchingPerson(
    fullName: string,
    cache?: Map<string, Awaited<ReturnType<typeof storage.getAllPeople>>>,
  ): Promise<{ id: string } | null> {
    const norm = normalizeName(fullName);
    if (!norm) return null;
    // Narrow candidates by the (more distinctive) last-name token, then compare exactly.
    const lookupTerm = norm.last || norm.first;
    let candidates = cache?.get(lookupTerm);
    if (!candidates) {
      candidates = await storage.getAllPeople(lookupTerm);
      cache?.set(lookupTerm, candidates);
    }
    for (const p of candidates) {
      const candKey = normalizeName(`${p.firstName ?? ""} ${p.lastName ?? ""}`)?.key;
      if (candKey && candKey === norm.key) return { id: p.id };
    }
    return null;
  }

  // ── Results page: batch Found/Not-Found ────────────────────────────────────
  const matchSchema = z.object({
    items: z.array(z.object({ tpsId: z.string().min(1), name: z.string() })).max(200),
  });

  app.post("/api/v1/tps/match", async (req, res) => {
    const session = await requireExtensionSession(req, res);
    if (!session) return;

    const parsed = matchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });
    }

    try {
      const cache = new Map<string, Awaited<ReturnType<typeof storage.getAllPeople>>>();
      const results: Record<string, { found: boolean; personUuid: string | null }> = {};
      for (const item of parsed.data.items) {
        const match = await findMatchingPerson(item.name, cache);
        results[item.tpsId] = { found: !!match, personUuid: match?.id ?? null };
      }
      res.json({ results });
    } catch (error) {
      console.error("Error in TPS match:", error);
      res.status(500).json({ error: "Failed to match names" });
    }
  });

  // ── Person page: Found + extract status ────────────────────────────────────
  app.get("/api/v1/tps/person-status", async (req, res) => {
    const session = await requireExtensionSession(req, res);
    if (!session) return;

    const tpsId = (req.query.tpsId as string | undefined)?.trim();
    const name = (req.query.name as string | undefined) ?? "";
    if (!tpsId) return res.status(400).json({ error: "tpsId is required" });

    try {
      const match = await findMatchingPerson(name);
      const [record] = await db
        .select({ id: truePersonSearch.id })
        .from(truePersonSearch)
        .where(eq(truePersonSearch.tpsId, tpsId))
        .limit(1);

      res.json({
        found: !!match,
        personUuid: match?.id ?? null,
        extracted: !!record,
        tpsRecordId: record?.id ?? null,
      });
    } catch (error) {
      console.error("Error in TPS person-status:", error);
      res.status(500).json({ error: "Failed to fetch status" });
    }
  });

  // ── Person page: "Add to PRM" (creates a contact when Not Found) ────────────
  const addSchema = z.object({
    tpsId: z.string().min(1),
    firstName: z.string().min(1),
    lastName: z.string().default(""),
    age: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    phone: z.string().optional(),
  });

  app.post("/api/v1/tps/add", async (req, res) => {
    const session = await requireExtensionSession(req, res);
    if (!session) return;

    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });
    }
    const { tpsId, firstName, lastName, city, state, phone } = parsed.data;

    try {
      // Provenance tags: mark the source and (when present) the location.
      const location = [city, state].filter(Boolean).join(", ");
      const tags = ["truepeoplesearch", ...(location ? [location] : [])];

      const person = await storage.createPerson({
        // Attribution, not ownership — `people.userId` marks a user's own "Me"
        // person and is unique per user (§8.4).
        createdByUserId: session.userId,
        firstName,
        lastName: lastName || "",
        phone: phone || null,
        tpsId,
        tags,
      } as any);

      res.status(201).json({ personUuid: person.id });
    } catch (error) {
      console.error("Error adding TPS person to PRM:", error);
      res.status(500).json({ error: "Failed to add person" });
    }
  });

  // ── Person page: Extract full record into true_person_search ────────────────
  const tpsAddressSchema = z.object({
    address: z.string(),
    propertyUrl: z.string().nullable().optional(),
  });
  const tpsRelationSchema = z.object({
    name: z.string(),
    age: z.string().nullable().optional(),
    tpsId: z.string().nullable().optional(),
  });
  const extractSchema = z.object({
    tpsId: z.string().min(1),
    personId: z.string().nullable().optional(),
    fullName: z.string().nullable().optional(),
    akas: z.array(z.string()).optional(),
    birthday: z.string().nullable().optional(),
    currentAddress: z.string().nullable().optional(),
    currentAddressPropertyDetails: z.string().nullable().optional(),
    currentAddressPropertyUrl: z.string().nullable().optional(),
    addresses: z.array(tpsAddressSchema).optional(),
    phoneNumbers: z.array(z.string()).optional(),
    emails: z.array(z.string()).optional(),
    relatives: z.array(tpsRelationSchema).optional(),
    associates: z.array(tpsRelationSchema).optional(),
    backgroundProfile: z.string().nullable().optional(),
  });

  app.post("/api/v1/tps/extract", async (req, res) => {
    const session = await requireExtensionSession(req, res);
    if (!session) return;

    const parsed = extractSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });
    }
    const data = parsed.data;

    try {
      const now = new Date();
      const [record] = await db
        .insert(truePersonSearch)
        .values({ ...data, importDate: now, updatedAt: now })
        .returning();

      // Backfill the contact's tps_id link when we extracted for a Found person.
      if (data.personId) {
        await db
          .update(people)
          .set({ tpsId: data.tpsId })
          .where(eq(people.id, data.personId));
      }

      res.status(201).json({ tpsRecordId: record.id, status: "extracted" });
    } catch (error) {
      console.error("Error extracting TPS record:", error);
      res.status(500).json({ error: "Failed to extract record" });
    }
  });
}
