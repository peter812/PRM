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
  schooling,
  truePersonSearch,
  jobExperienceZodSchema,
  partialDate,
  collegeExperienceZodSchema,
  type CollegeExperience,
  type ExtensionSession,
  type InsertPerson,
  type JobExperience,
} from "@shared/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authenticateExtensionToken } from "../auth";
import { getPrimaryAddress, tpsEntries, upsertTpsAddresses } from "../person-addresses";

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
  /** A contact's matchable name keys: first/nickname × last/maiden. */
  function personNameKeys(p: { firstName?: string | null; lastName?: string | null; nickname?: string | null; maidenName?: string | null }): Set<string> {
    const keys = new Set<string>();
    for (const given of [p.firstName, p.nickname]) {
      for (const family of [p.lastName, p.maidenName]) {
        const key = normalizeName(`${given ?? ""} ${family ?? ""}`)?.key;
        if (key) keys.add(key);
      }
    }
    return keys;
  }

  /** The contact already linked to this TPS record (people.tps_id), if any. */
  async function findLinkedPerson(tpsId: string): Promise<{ id: string } | null> {
    const [linked] = await db.select({ id: people.id }).from(people).where(eq(people.tpsId, tpsId)).limit(1);
    return linked ?? null;
  }

  /**
   * Find the first PRM contact whose normalized name matches — first name or
   * nickname, with last or maiden name.
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
      if (personNameKeys(p).has(norm.key)) return { id: p.id };
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
      // Contacts linked by TPS id are Found even when their names differ from TPS.
      const ids = parsed.data.items.map((i) => i.tpsId);
      const linked = new Map(
        (ids.length
          ? await db.select({ id: people.id, tpsId: people.tpsId }).from(people).where(inArray(people.tpsId, ids))
          : []
        ).map((p) => [p.tpsId, { id: p.id }]),
      );
      for (const item of parsed.data.items) {
        const match = linked.get(item.tpsId) ?? await findMatchingPerson(item.name, cache);
        results[item.tpsId] = { found: !!match, personUuid: match?.id ?? null };
      }
      res.json({ results });
    } catch (error) {
      console.error("Error in TPS match:", error);
      res.status(500).json({ error: "Failed to match names" });
    }
  });

  /** The person-page state PRM-chrome renders: Found + Extract status. */
  async function personStatus(tpsId: string, personId: string | null) {
    const [record] = await db
      .select({ id: truePersonSearch.id, importDate: truePersonSearch.importDate })
      .from(truePersonSearch)
      .where(eq(truePersonSearch.tpsId, tpsId))
      .orderBy(desc(truePersonSearch.importDate))
      .limit(1);
    return {
      found: !!personId,
      personUuid: personId,
      extracted: !!record,
      tpsRecordId: record?.id ?? null,
      lastExtractedAt: record?.importDate ?? null,
      primaryAddress: personId ? await getPrimaryAddress(personId) : null,
    };
  }

  // ── Person page: Found + extract status ────────────────────────────────────
  app.get("/api/v1/tps/person-status", async (req, res) => {
    const session = await requireExtensionSession(req, res);
    if (!session) return;

    const tpsId = (req.query.tpsId as string | undefined)?.trim();
    const name = (req.query.name as string | undefined) ?? "";
    if (!tpsId) return res.status(400).json({ error: "tpsId is required" });

    try {
      const match = await findLinkedPerson(tpsId) ?? await findMatchingPerson(name);
      res.json(await personStatus(tpsId, match?.id ?? null));
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
      const existing = await findLinkedPerson(tpsId);
      if (existing) {
        return res.status(200).json({ personUuid: existing.id });
      }

      // Provenance tags: mark the source and (when present) the location.
      const location = [city, state].filter(Boolean).join(", ");
      const tags = ["truepeoplesearch", ...(location ? [location] : [])];

      const person = await storage.createPerson({
        firstName,
        lastName: lastName || "",
        phone: phone || null,
        tpsId,
        tags,
      });

      res.status(201).json({ personUuid: person.id });
    } catch (error) {
      console.error("Error adding TPS person to PRM:", error);
      res.status(500).json({ error: "Failed to add person" });
    }
  });

  // ── Person page: "Link to person" search (Not Found → pick an existing contact) ──
  app.get("/api/v1/tps/people-search", async (req, res) => {
    const session = await requireExtensionSession(req, res);
    if (!session) return;

    const q = ((req.query.q as string | undefined) ?? "").trim();
    if (q.length < 3) return res.status(400).json({ error: "Type at least 3 characters" });

    try {
      const matches = await storage.getAllPeople(q);
      // Image paths are PRM-relative; the extension renders them on truepeoplesearch.com.
      const origin = `${req.protocol}://${req.get("host")}`;
      res.json({
        people: matches.slice(0, 20).map((p) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          nickname: p.nickname,
          maidenName: p.maidenName,
          imageUrl: p.imageUrl ? new URL(p.imageUrl, origin).href : null,
          tpsId: p.tpsId,
        })),
      });
    } catch (error) {
      console.error("Error in TPS people-search:", error);
      res.status(500).json({ error: "Failed to search people" });
    }
  });

  // ── Person page: "Link to person" — attach this TPS record + reconcile names ──
  const linkSchema = z.object({
    tpsId: z.string().min(1),
    personId: z.string().min(1),
    tpsFirstName: z.string().default(""),
    tpsLastName: z.string().default(""),
    // keep | replace first name | TPS first → nickname | current first → nickname, TPS first → first
    first: z.enum(["keep", "replace", "toNickname", "swapToNickname"]).default("keep"),
    // keep | replace last name | TPS last → maiden name
    last: z.enum(["keep", "replace", "toMaiden"]).default("keep"),
  });

  app.post("/api/v1/tps/link", async (req, res) => {
    const session = await requireExtensionSession(req, res);
    if (!session) return;

    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });
    }
    const { tpsId, personId, first, last } = parsed.data;
    const tpsFirst = parsed.data.tpsFirstName.trim();
    const tpsLast = parsed.data.tpsLastName.trim();
    if (first !== "keep" && !tpsFirst) return res.status(400).json({ error: "TPS first name is empty" });
    if (last !== "keep" && !tpsLast) return res.status(400).json({ error: "TPS last name is empty" });

    try {
      const [person] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
      if (!person) return res.status(404).json({ error: "Person not found" });

      const update: Partial<InsertPerson> = { tpsId };
      if (first === "replace") update.firstName = tpsFirst;
      if (first === "toNickname") update.nickname = tpsFirst;
      if (first === "swapToNickname") {
        update.nickname = person.firstName;
        update.firstName = tpsFirst;
      }
      if (last === "replace") update.lastName = tpsLast;
      if (last === "toMaiden") update.maidenName = tpsLast;

      const updated = (await storage.updatePerson(personId, update))!;
      res.json({
        ...(await personStatus(tpsId, personId)),
        person: {
          firstName: updated.firstName,
          lastName: updated.lastName,
          nickname: updated.nickname,
          maidenName: updated.maidenName,
        },
      });
    } catch (error) {
      console.error("Error linking TPS record:", error);
      res.status(500).json({ error: "Failed to link person" });
    }
  });

  // ── Person page: Extract full record into true_person_search ────────────────
  const tpsAddressSchema = z.object({
    address: z.string(),
    propertyUrl: z.string().nullable().optional(),
    startDate: partialDate.nullable().optional(),
    endDate: partialDate.nullable().optional(),
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
    currentAddressStartDate: partialDate.nullable().optional(),
    addresses: z.array(tpsAddressSchema).optional(),
    phoneNumbers: z.array(z.string()).optional(),
    emails: z.array(z.string()).optional(),
    relatives: z.array(tpsRelationSchema).optional(),
    associates: z.array(tpsRelationSchema).optional(),
    businessConnections: z.array(z.object({
      name: z.string(),
      address: z.string().nullable().optional(),
      startDate: partialDate.nullable().optional(),
    })).optional(),
    jobs: z.array(jobExperienceZodSchema).optional(),
    colleges: z.array(collegeExperienceZodSchema).optional(),
    backgroundProfile: z.string().nullable().optional(),
    // The primary the user confirmed in PRM-chrome; absent from extensions older than 1.1.0.
    primaryAddress: z.discriminatedUnion("choice", [
      z.object({ choice: z.literal("keep") }),
      z.object({ choice: z.literal("tps"), address: z.string().min(1) }),
    ]).optional(),
  });

  /** Append the incoming entries whose (case-insensitive) key isn't already in the list. */
  function mergeNew<T extends JobExperience | CollegeExperience>(
    existing: T[],
    incoming: T[],
    key: (e: T) => string | { primary: string; detail: string },
  ) {
    const normalize = (e: T): { primary: string; detail: string; exactKey: string } => {
      const res = key(e);
      let primary = "";
      let detail = "";
      if (typeof res === "string") {
        const sep = res.indexOf("|");
        primary = (sep === -1 ? res : res.slice(0, sep)).trim().toLowerCase();
        detail = (sep === -1 ? "" : res.slice(sep + 1)).trim().toLowerCase();
      } else {
        primary = (res.primary || "").trim().toLowerCase();
        detail = (res.detail || "").trim().toLowerCase();
      }
      return { primary, detail, exactKey: `${primary}|${detail}` };
    };

    const seenExact = new Set<string>();
    const hasDetail = new Set<string>();

    for (const e of existing) {
      const { primary, detail, exactKey } = normalize(e);
      if (!primary && !detail) continue;
      seenExact.add(exactKey);
      if (detail) hasDetail.add(primary);
    }

    for (const e of incoming) {
      const { primary, detail } = normalize(e);
      if (primary && detail) hasDetail.add(primary);
    }

    const fresh = incoming.filter((e) => {
      const { primary, detail, exactKey } = normalize(e);
      if (!primary && !detail) return false;
      if (seenExact.has(exactKey)) return false;
      if (!detail && hasDetail.has(primary)) return false;
      seenExact.add(exactKey);
      if (detail) hasDetail.add(primary);
      return true;
    });
    return { list: [...existing, ...fresh], added: fresh.length };
  }

  app.post("/api/v1/tps/extract", async (req, res) => {
    const session = await requireExtensionSession(req, res);
    if (!session) return;

    const parsed = extractSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });
    }
    const { currentAddressStartDate, primaryAddress, ...data } = parsed.data;

    try {
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        // If data.personId is passed for a person deleted in PRM, setting it to null
        // prevents an unhandled PostgreSQL 23503 foreign key constraint violation.
        if (data.personId) {
          const [exists] = await tx
            .select({ id: people.id })
            .from(people)
            .where(eq(people.id, data.personId))
            .limit(1);
          if (!exists) {
            data.personId = null;
          }
        }

        const [record] = await tx
          .insert(truePersonSearch)
          .values({ ...data, importDate: now, updatedAt: now })
          .returning();
        if (!data.personId) return { record, addressesAdded: 0, primaryAddress: null, jobsAdded: 0, collegesAdded: 0 };

        // Backfill the contact's tps_id link and merge the addresses into their history.
        const [person] = await tx.update(people).set({ tpsId: data.tpsId }).where(eq(people.id, data.personId)).returning();
        const { added, primaryAddress: primary } = await upsertTpsAddresses(
          tx, data.personId, tpsEntries({ ...data, currentAddressStartDate }), primaryAddress,
        );

        // Merge TPS jobs / colleges into the contact's profile, skipping ones they already have.
        const jobs = mergeNew(
          person?.jobs ?? [],
          data.jobs ?? [],
          (j) => `${(j.company || "").trim().toLowerCase()}|${(j.position || "").trim().toLowerCase()}`,
        );
        if (jobs.added) await tx.update(people).set({ jobs: jobs.list }).where(eq(people.id, data.personId));
        const [school] = await tx.select().from(schooling).where(eq(schooling.personId, data.personId));
        const colleges = mergeNew(
          school?.colleges ?? [],
          data.colleges ?? [],
          (c) => `${(c.name || "").trim().toLowerCase()}|${(c.degree || "").trim().toLowerCase()}`,
        );
        if (colleges.added) {
          if (school) await tx.update(schooling).set({ colleges: colleges.list }).where(eq(schooling.id, school.id));
          else await tx.insert(schooling).values({ personId: data.personId, colleges: colleges.list });
        }
        return { record, addressesAdded: added, primaryAddress: primary, jobsAdded: jobs.added, collegesAdded: colleges.added };
      });

      res.status(201).json({
        tpsRecordId: result.record.id,
        status: "extracted",
        lastExtractedAt: result.record.importDate,
        addressesAdded: result.addressesAdded,
        primaryAddress: result.primaryAddress,
        jobsAdded: result.jobsAdded,
        collegesAdded: result.collegesAdded,
      });
    } catch (error) {
      console.error("Error extracting TPS record:", error);
      res.status(500).json({ error: "Failed to extract record" });
    }
  });
}
