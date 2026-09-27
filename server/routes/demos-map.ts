/**
 * Map demo (map-page-plan.md §4, §12): every person address pinned by its
 * geocode. Self-contained — reads `people` and `true_person_search`, writes
 * only the `geocodes` cache.
 */
import type { Express } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { geocodes, people } from "@shared/schema";
import { db } from "../db";
import { visibleShared } from "../access";
import { geocoderProgress, pinAddresses, startGeocodePass } from "../map-geocoder";

const TILE_URL = process.env.MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  process.env.MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

type PinRow = {
  id: string;
  firstName: string;
  lastName: string;
  imageUrl: string | null;
  isStarred: number;
  tags: string[] | null;
  address: string;
  query: string;
  source: "profile" | "tps_current" | "tps_past";
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
    WHERE ${visibleShared(people.visibility, people.createdByUserId) ?? sql`true`}
      ${query === undefined ? sql`` : sql`AND pa.query = ${query}`}
  `);
  return result.rows;
}

export function registerRoutes(app: Express) {
  // GET /api/demos/map/people — one row per visible (person, address), split by geocode state
  app.get("/api/demos/map/people", async (_req, res) => {
    try {
      const rows = await visiblePins();
      res.json({
        located: rows.filter((r) => r.latitude != null && r.longitude != null),
        notFound: rows.filter((r) => r.status === "not_found"),
        pending: rows.filter((r) => r.status == null).length,
        geocoder: geocoderProgress(),
        tileUrl: TILE_URL,
        attribution: TILE_ATTRIBUTION,
      });
    } catch (error) {
      console.error("Error loading map people:", error);
      res.status(500).json({ error: "Failed to load map" });
    }
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
