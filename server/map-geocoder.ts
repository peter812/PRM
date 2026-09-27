/**
 * Map demo geocoder (map-page-plan.md §3, §12). On demand only: the demo page
 * starts a pass, which drains every pinned address with no `geocodes` row
 * through Nominatim at ≤ 1 request/second. Nothing else in the app calls this.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { geocodes } from "@shared/schema";
import { db } from "./db";
import { log } from "./vite";

const GEOCODER_URL = (process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL || "";
/** Nominatim's usage policy: an absolute maximum of 1 request per second. */
const MIN_INTERVAL_MS = 1100;

/** The one definition of the cache key for an address (plan §1). */
export function normAddress(column: PgColumn | SQL): SQL<string> {
  return sql<string>`lower(regexp_replace(trim(${column}), '[[:space:]]+', ' ', 'g'))`;
}

/**
 * Every address the map pins (plan §12.1), one row per (person, address key):
 * `person_id`, `address`, `query` (the cache key) and `source`. When one person
 * has the same address from several sources, the best source wins:
 * profile → tps_current → tps_past. Not access-filtered; callers join `people`.
 */
export const pinAddresses = sql`
  SELECT DISTINCT ON (person_id, ${normAddress(sql`address`)})
         person_id, address, ${normAddress(sql`address`)} AS query, source
  FROM (
    SELECT id AS person_id, address, 'profile' AS source, 0 AS rank FROM people
    UNION ALL
    SELECT person_id, current_address, 'tps_current', 1 FROM true_person_search
    UNION ALL
    SELECT t.person_id, a->>'address', 'tps_past', 2
    FROM true_person_search t, jsonb_array_elements(coalesce(t.addresses, '[]'::jsonb)) a
  ) all_addresses
  WHERE person_id IS NOT NULL AND address IS NOT NULL AND trim(address) <> ''
  ORDER BY person_id, ${normAddress(sql`address`)}, rank
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
  log(`Map geocoder: ${queries.length} address(es) to locate`);

  for (const query of queries) {
    // Throws on network / HTTP errors, which ends the pass without writing a
    // row — the address stays pending and the next pass retries it.
    const hit = await lookup(query);
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

async function search(query: string): Promise<Hit | null> {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

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
