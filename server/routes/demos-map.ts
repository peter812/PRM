/**
 * Map demo (map-page-plan.md §4, §12): every person address pinned by its
 * geocode. Self-contained — reads `people` and `person_addresses`, writes
 * the `geocodes` cache, and deletes the address row when a pin is removed.
 */
import type { Express } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { geocodes, personAddresses } from "@shared/schema";
import { db } from "../db";
import { geocoderProgress, googleSearch, mapKeys, normAddress, pinAddresses, startGeocodePass } from "../map-geocoder";

const TILE_URL = process.env.MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  process.env.MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Map Tiles API session settings per Google map type (hybrid = satellite + road labels). */
const GOOGLE_TYPES = {
  roadmap: { mapType: "roadmap" },
  satellite: { mapType: "satellite" },
  hybrid: { mapType: "satellite", layerTypes: ["layerRoadmap"] },
  terrain: { mapType: "terrain", layerTypes: ["layerRoadmap"] },
} as const;
type GoogleType = keyof typeof GOOGLE_TYPES;

/** Sessions last about two weeks; reuse each until an hour before it expires. */
const googleSessions = new Map<GoogleType, { key: string; session: string; expiresAt: number }>();

async function googleSession(type: GoogleType, key: string): Promise<string> {
  const cached = googleSessions.get(type);
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 3_600_000) return cached.session;
  const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...GOOGLE_TYPES[type], language: "en-US", region: "US" }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Map Tiles API HTTP ${res.status}`);
  googleSessions.set(type, { key, session: body.session, expiresAt: Number(body.expiry) * 1000 });
  return body.session;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type PinRow = {
  id: string;
  firstName: string;
  lastName: string;
  imageUrl: string | null;
  isStarred: number;
  tags: string[] | null;
  address: string;
  query: string;
  source: "primary" | "current" | "past";
  status: "ok" | "not_found" | "manual" | null;
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
};

/** Pins the caller may see, optionally narrowed to one address key. */
async function visiblePins(query?: string): Promise<PinRow[]> {
  const result = await db.execute<PinRow>(sql`
    SELECT people.id, people.first_name AS "firstName", people.last_name AS "lastName",
           people.image_url AS "imageUrl", people.is_starred AS "isStarred", people.tags,
           pa.address, pa.query, pa.source,
           g.status, g.latitude, g.longitude, g.display_name AS "displayName"
    FROM (${pinAddresses}) pa
    JOIN people ON people.id = pa.person_id
    LEFT JOIN ${geocodes} g ON g.query = pa.query
    ${query === undefined ? sql`` : sql`WHERE pa.query = ${query}`}
  `);
  return result.rows;
}

export function registerRoutes(app: Express) {
  // GET /api/demos/map/people — one row per visible (person, address), split by geocode state
  app.get("/api/demos/map/people", async (_req, res) => {
    try {
      const [rows, keys] = await Promise.all([visiblePins(), mapKeys()]);
      res.json({
        located: rows.filter((r) => r.latitude != null && r.longitude != null),
        notFound: rows.filter((r) => r.status === "not_found"),
        pending: rows.filter((r) => r.status == null).length,
        geocoder: geocoderProgress(),
        tileUrl: TILE_URL,
        attribution: TILE_ATTRIBUTION,
        ...keys,
      });
    } catch (error) {
      console.error("Error loading map people:", error);
      res.status(500).json({ error: "Failed to load map" });
    }
  });

  // GET /api/demos/map/google/:type?zoom&north&south&east&west — a tile session plus the
  // copyright Google requires for that viewport (it changes as the view moves)
  app.get("/api/demos/map/google/:type", async (req, res) => {
    try {
      const type = z.enum(["roadmap", "satellite", "hybrid", "terrain"]).parse(req.params.type);
      const view = z.object({
        zoom: z.coerce.number().int().min(0).max(22),
        north: z.coerce.number(),
        south: z.coerce.number(),
        east: z.coerce.number(),
        west: z.coerce.number(),
      }).parse(req.query);
      const { googleKey } = await mapKeys();
      if (!googleKey) return res.status(400).json({ error: "No Google Maps API key set" });

      const session = await googleSession(type, googleKey);
      const url = new URL("https://tile.googleapis.com/tile/v1/viewport");
      for (const [k, v] of Object.entries({ ...view, session, key: googleKey })) url.searchParams.set(k, String(v));
      const viewport = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const { copyright } = viewport.ok ? await viewport.json() : { copyright: "" };
      res.json({ session, copyright: copyright ?? "" });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message });
      console.error("Error creating Google tile session:", error);
      res.status(502).json({ error: errorMessage(error) });
    }
  });

  // POST /api/demos/map/google-test — check the saved key against each Google API the app uses
  app.post("/api/demos/map/google-test", async (_req, res) => {
    const { googleKey } = await mapKeys();
    if (!googleKey) return res.status(400).json({ error: "No Google Maps API key set" });
    const check = (p: Promise<unknown>) => p.then(() => "OK", errorMessage);
    googleSessions.clear(); // test the key as saved now, not a cached session
    const [tiles, geocoding] = await Promise.all([
      check(googleSession("roadmap", googleKey)),
      check(googleSearch("1600 Amphitheatre Parkway, Mountain View, CA", googleKey)),
    ]);
    res.json({ tiles, geocoding });
  });

  // POST /api/demos/map/geocode — start a geocoding pass (no-op while one runs)
  app.post("/api/demos/map/geocode", (_req, res) => {
    startGeocodePass();
    res.json(geocoderProgress());
  });

  // PUT /api/demos/map/geocodes — place/move the pin for one address key by hand
  app.put("/api/demos/map/geocodes", async (req, res) => {
    try {
      const { query, latitude, longitude } = z.object({
        query: z.string().min(1),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }).parse(req.body);
      if ((await visiblePins(query)).length === 0) return res.status(404).json({ error: "Address not found" });

      const values = { status: "manual", latitude, longitude, displayName: null, geocodedAt: new Date() };
      await db.insert(geocodes).values({ query, ...values }).onConflictDoUpdate({ target: geocodes.query, set: values });
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message });
      console.error("Error placing map pin:", error);
      res.status(500).json({ error: "Failed to place pin" });
    }
  });

  // DELETE /api/demos/map/pins — remove one address from a person's address history
  app.delete("/api/demos/map/pins", async (req, res) => {
    try {
      const { personId, query } = z.object({ personId: z.string().min(1), query: z.string().min(1) }).parse(req.body);
      if (!(await visiblePins(query)).some((p) => p.id === personId)) {
        return res.status(404).json({ error: "Address not found" });
      }
      await db.execute(sql`
        DELETE FROM ${personAddresses} WHERE person_id = ${personId} AND ${normAddress(sql`address`)} = ${query}
      `);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message });
      console.error("Error removing map pin:", error);
      res.status(500).json({ error: "Failed to remove pin" });
    }
  });

  // POST /api/demos/map/geocodes/retry — forget not_found results (all, or one address's) and re-run
  app.post("/api/demos/map/geocodes/retry", async (req, res) => {
    try {
      const { query } = z.object({ query: z.string().optional() }).parse(req.body ?? {});
      if (query !== undefined && (await visiblePins(query)).length === 0) {
        return res.status(404).json({ error: "Address not found" });
      }
      await db.execute(sql`
        DELETE FROM ${geocodes} WHERE status = 'not_found'
        ${query === undefined ? sql`` : sql`AND query = ${query}`}
      `);
      startGeocodePass();
      res.json(geocoderProgress());
    } catch (error) {
      console.error("Error retrying geocodes:", error);
      res.status(500).json({ error: "Failed to retry" });
    }
  });
}
