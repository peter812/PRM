/**
 * Map demo geocoder (map-page-plan.md §3, §12). On demand only: the demo page
 * starts a pass, which drains every pinned address with no `geocodes` row
 * through Google's Geocoding API when a Google Maps key is set (Settings → Maps),
 * otherwise Nominatim at ≤ 1 request/second. Nothing else in the app calls this.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { geocodes } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { log } from "./vite";

const GEOCODER_URL = (process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL || "";
/** Nominatim's usage policy: an absolute maximum of 1 request per second. */
const MIN_INTERVAL_MS = 1100;
/** Google allows 50 QPS; 10/s keeps a 10k-address backfill under 20 minutes. */
const GOOGLE_INTERVAL_MS = 100;

/** Map keys from Settings → Maps, falling back to env. */
export async function mapKeys() {
  return {
    googleKey: (await storage.getAppSetting("google_maps_api_key")) || process.env.GOOGLE_MAPS_API_KEY || null,
    mapId: (await storage.getAppSetting("google_maps_map_id")) || null,
    cartoKey: (await storage.getAppSetting("carto_api_key")) || process.env.CARTO_API_KEY || null,
  };
}

/** The one definition of the cache key for an address (plan §1). */
export function normAddress(column: PgColumn | SQL): SQL<string> {
  return sql<string>`lower(regexp_replace(trim(${column}), '[[:space:]]+', ' ', 'g'))`;
}

/**
 * Every address the map pins (plan §12.1): one row per person_addresses row with
 * `person_id`, `address`, `query` (the cache key) and `source` (primary, current
 * or past). Not access-filtered; callers join `people`.
 */
export const pinAddresses = sql`
  SELECT person_id, address, ${normAddress(sql`address`)} AS query,
         CASE WHEN is_primary = 1 THEN 'primary' WHEN end_date IS NULL THEN 'current' ELSE 'past' END AS source
  FROM person_addresses
`;

export interface GeocoderProgress {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
}

const progress: GeocoderProgress = { running: false, done: 0, total: 0, error: null };

export function geocoderProgress(): GeocoderProgress {
  return { ...progress };
}

/** Start a pass unless one is already running. Returns immediately. */
export function startGeocodePass(): void {
  if (progress.running) return;
  Object.assign(progress, { running: true, done: 0, total: 0, error: null });
  runPass()
    .catch((err) => {
      progress.error = err instanceof Error ? err.message : String(err);
      log(`Map geocoder stopped: ${progress.error}`);
    })
    .finally(() => {
      progress.running = false;
    });
}

async function runPass(): Promise<void> {
  const pending = await db.execute<{ query: string }>(sql`
    SELECT DISTINCT pa.query
    FROM (${pinAddresses}) pa
    WHERE NOT EXISTS (SELECT 1 FROM geocodes g WHERE g.query = pa.query)
  `);
  const queries = pending.rows.map((r) => r.query);
  progress.total = queries.length;
  if (queries.length === 0) return;
  const { googleKey } = await mapKeys();
  const find = googleKey ? (q: string) => googleSearch(q, googleKey) : lookup;
  log(`Map geocoder: ${queries.length} address(es) to locate via ${googleKey ? "Google" : "Nominatim"}`);

  for (const query of queries) {
    // Throws on network / HTTP errors, which ends the pass without writing a
    // row — the address stays pending and the next pass retries it.
    const hit = await find(query);
    await db
      .insert(geocodes)
      .values(
        hit
          ? { query, status: "ok", latitude: hit.lat, longitude: hit.lng, displayName: hit.displayName }
          : { query, status: "not_found" },
      )
      .onConflictDoNothing(); // never overwrite a pin placed by hand meanwhile
    progress.done++;
  }
  log(`Map geocoder: pass complete (${queries.length})`);
}

type Hit = { lat: number; lng: number; displayName: string };

/**
 * Nominatim often misses scraped street addresses with unit numbers or odd
 * suffixes ("2915 31st st #209, zion, il 60099"). Try the full address, then
 * without the unit, then just "city, state zip". A city-level hit is still
 * useful, and its displayName (shown in the popup) makes the precision clear.
 */
async function lookup(query: string): Promise<Hit | null> {
  const withoutUnit = query.replace(/\s*(#|\b(apt|unit|ste|suite|lot|spc)\b\.?)\s*[\w-]+/g, "");
  const locality = query.split(",").slice(-2).join(",").trim();
  const candidates = Array.from(new Set([query, withoutUnit, locality])).filter((q) => q.includes(","));
  for (const candidate of candidates) {
    const hit = await search(candidate);
    if (hit) return hit;
  }
  return null;
}

let lastCall = 0;

async function throttle(intervalMs: number): Promise<void> {
  const wait = lastCall + intervalMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function search(query: string): Promise<Hit | null> {
  await throttle(MIN_INTERVAL_MS);

  const url = new URL(`${GEOCODER_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  if (NOMINATIM_EMAIL) url.searchParams.set("email", NOMINATIM_EMAIL);

  const res = await fetch(url, {
    headers: { "User-Agent": `PRM/1.0 (personal relationship manager${NOMINATIM_EMAIL ? `; ${NOMINATIM_EMAIL}` : ""})` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!hits.length) return null;
  return { lat: Number(hits[0].lat), lng: Number(hits[0].lon), displayName: hits[0].display_name };
}

/** Google handles unit numbers itself, so one request per address. Throws on key/quota errors. */
export async function googleSearch(query: string, key: string): Promise<Hit | null> {
  await throttle(GOOGLE_INTERVAL_MS);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Google geocoder HTTP ${res.status}`);
  const body = (await res.json()) as {
    status: string;
    error_message?: string;
    results: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[];
  };
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK") throw new Error(`Google geocoder: ${body.error_message || body.status}`);
  const { formatted_address, geometry } = body.results[0];
  return { lat: geometry.location.lat, lng: geometry.location.lng, displayName: formatted_address };
}
