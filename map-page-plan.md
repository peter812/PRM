# Map demo — plan

PRM knows where a lot of people live — `people.address` is a free-text field
filled in by hand or from a TruePeopleSearch import — but the only place it
shows up is one line on the person profile. There is no way to answer "who do
I know near here?".

This plan adds a **Map** demo: every person with an address, pinned on an
OpenStreetMap base map, clustered when zoomed out, with a popup that links to
their profile. Addresses are turned into coordinates on the server, once, and
cached.

It is a **self-contained demo with no hooks into the rest of the app**. Nothing
outside the demo calls it, triggers it, or links to it, and it changes no
existing page, route, write path or startup code. It only *reads* `people`.
Removing it means deleting its files, two registration lines and one table (§8).

Decisions (2026-09-26):

| Question | Answer |
|---|---|
| Where | Demos section: `/demos/map`, a card on `demos.tsx` and a Demos sub-item in the sidebar. No other entry points |
| No hooks | No geocoding on person save, no startup/interval worker, no link from the person profile, no columns on `people`. Geocoding runs only when someone opens the demo (§3) |
| Map library | **Leaflet** via `react-leaflet` v4 (v5 needs React 19; PRM is on 18.3) + `react-leaflet-cluster` for clustering. Raster tiles, no API key, no WebGL |
| Tiles | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with the required "© OpenStreetMap contributors" attribution. URL comes from `MAP_TILE_URL` so it can be swapped for a self-hosted or commercial tile server without code changes |
| Geocoding | **Nominatim**, server-side only, ≤ 1 request/second, identifying `User-Agent`, results cached forever. Base URL from `GEOCODER_URL` (default `https://nominatim.openstreetmap.org`) so a self-hosted Nominatim can replace it |
| What gets pinned (v1) | `people.address` only. TPS previous addresses and `social_accounts.location` are §7 follow-ups — they reuse the same cache |
| What gets pinned (v2, §12) | Every person address: `people.address` + TPS current + TPS history, all as ordinary pins. Social account locations and pending imports stay off |

---

## 1. Why a geocode cache table, not lat/lng columns on `people`

Columns on `people` would be a hook: every write path that touches `address`
(profile edit, TPS import, merge, restore from backup) would have to clear
them. Instead the demo owns its own table:

- **One table keyed by the normalized address string.** The map query joins
  `people` to it on that key. Edit an address and the join simply misses — the
  next geocode pass picks up the new string. No invalidation code anywhere.
- **Duplicates are free.** Ten people at the same address (a family, a dorm)
  cost one Nominatim call.
- **Fixing a bad pin fixes it for everyone at that address**, which is what
  you want.
- **The later sources in §7 reuse it** — a TPS address or an Instagram
  location string is just another key.

The normalization lives in exactly one place — a SQL expression — so the
geocoder, the map query and the fix endpoint can't disagree:

```sql
lower(regexp_replace(trim(address), '\s+', ' ', 'g'))
```

## 2. Schema

### 2.1 `geocodes` (new, `shared/schema.ts` + `server/db-init.ts`)

```ts
export const geocodes = pgTable("geocodes", {
  query: text("query").primaryKey(),              // normalized address (§1)
  status: text("status").notNull(),               // 'ok' | 'not_found' | 'manual'
  latitude: real("latitude"),                     // null when not_found
  longitude: real("longitude"),
  displayName: text("display_name"),              // what Nominatim matched, shown in the popup
  geocodedAt: timestamp("geocoded_at").notNull().defaultNow(),
});
```

- `manual` = a person dragged the pin / placed it by hand. The geocoder never
  overwrites a `manual` row.
- `not_found` rows are kept so the geocoder doesn't retry them every pass; the
  demo lists them (§5.3) so they can be placed by hand.
- Transient failures (network, 429, 5xx) write **nothing** — the address stays
  "pending" and is retried next pass.

`db-init.ts` gets a `CREATE TABLE IF NOT EXISTS geocodes (...)` alongside the
other idempotent migrations — table creation only, nothing else. No changes to
`people`.

## 3. Geocoder (`server/map-geocoder.ts`, new)

On-demand, not scheduled. Opening the demo page calls
`POST /api/demos/map/geocode`, which starts a drain pass if one isn't already
running and returns immediately:

```
pending = SELECT DISTINCT norm(address) FROM people
          WHERE address IS NOT NULL AND trim(address) <> ''
            AND norm(address) NOT IN (SELECT query FROM geocodes)
for each: GET {GEOCODER_URL}/search?q=…&format=jsonv2&limit=1
          sleep ≥ 1100 ms between calls
          200 + hit   → insert ok
          200 + empty → insert not_found
          429 / 5xx / network → stop the pass (next page open resumes)
```

- **Single-flight:** a module-level `running` flag plus a `{ done, total }`
  progress object; a second POST during a pass is a no-op.
- **Nothing runs unless someone opens the demo.** No startup code, no timer,
  no call from any save path. A pass that is started finishes (or fails) on
  its own even if the tab closes; it is bounded by the pending list it took.
- **Nominatim policy:** `User-Agent: PRM/1.0 (+contact)` and `email=` from
  `NOMINATIM_EMAIL`; never more than 1 req/s; the browser never talks to
  Nominatim (no autocomplete-as-you-type).
- **Scale:** at the 10k ceiling, a cold first pass is ≤ 10k calls ≈ 3 hours,
  once, fewer after dedupe. Later passes cover only new/edited addresses.
  Not worth batching or parallelism — the policy forbids it anyway.
- Runs under `runAsSystem` — it reads every address regardless of visibility,
  but writes nothing user-visible except the cache.

## 4. API (`server/routes/demos-map.ts`, new; one `register…` line in `server/routes.ts`)

All under `/api/demos/map/`.

### `GET /api/demos/map/people`

One query, filtered by the usual `visibleShared(people)` access rule:

```sql
SELECT p.id, p.first_name, p.last_name, p.image_url, p.is_starred, p.tags,
       p.address, g.status, g.latitude, g.longitude, g.display_name
FROM people p
LEFT JOIN geocodes g ON g.query = norm(p.address)
WHERE p.address IS NOT NULL AND trim(p.address) <> '' AND <visibleShared>
```

Returns `{ located, notFound, pending, geocoder: { running, done, total },
tileUrl, attribution }`. No viewport paging: at ≤ 10k people the whole payload
is a few hundred KB and clustering is client-side.

### `POST /api/demos/map/geocode`

Starts a pass (§3) if none is running. Returns the progress object.

### `PUT /api/demos/map/geocodes` — fix a pin

Body `{ personId, latitude, longitude }`. Looks up that person's address and
upserts the `geocodes` row for `norm(address)` with `status = 'manual'`. Only
writes to `geocodes`; requires the caller can read that person.

### `POST /api/demos/map/geocodes/retry`

Deletes `not_found` rows (optionally for one `personId`) and starts a pass.

## 5. Page (`client/src/pages/map-demo.tsx`, new)

### 5.1 Layout

Full-height like `family-tree.tsx`: map fills the content area, a collapsible
left panel holds search, filters, geocoding progress and the not-found list.

- **Markers:** `L.divIcon` with the person's avatar in a circle (initials
  fallback), gold ring if starred. Using divIcon also sidesteps Leaflet's
  default-marker-image path bug under Vite.
- **Clusters:** `react-leaflet-cluster`; cluster bubble shows the count.
  Several people at one exact address spiderfy on click.
- **Popup:** name, address (and Nominatim's `displayName` if it differs),
  "Open profile" → `/person/:id`, "Move pin" (§5.4). The profile link is
  outbound from the demo; nothing links back in.
- **Initial view:** `fitBounds` over all located people; if none, world view.
- **URL state:** `?lat=&lng=&z=` kept in sync with `replaceState`, same
  pattern as the family-tree page, so a view can be bookmarked.
- **Dark mode:** a CSS filter (`invert + hue-rotate`) on the tile pane when
  the app theme is dark; OSM has no official dark raster style.

### 5.2 Filters (client-side, over the already-loaded list)

Name search (pans to the match and opens its popup), starred only, tag
multi-select. All filtering is in-memory; no refetch.

### 5.3 Geocoding progress / not found

- On mount the page POSTs `/geocode`. While `geocoder.running`, the panel
  shows "Locating addresses… 120 / 430" and the people query refetches every
  10 s so pins appear as they're found.
- "Couldn't locate (N)" lists `notFound` people with their address and two
  actions: **Place manually** (§5.4) and **Retry**.

### 5.4 Move / place a pin

Click "Move pin" → marker becomes draggable (or, for place-manually, the next
map click drops it). On drop → `PUT /geocodes` → invalidate the people query.

### 5.5 Registration (the only edits to existing files)

- `App.tsx`: `<ProtectedRoute path="/demos/map" component={MapDemo} />`
- `app-sidebar.tsx`: Demos sub-item `{ title: "Map", url: "/demos/map", icon: Map }`
- `demos.tsx`: one card linking to `/demos/map`, like the Whisper card
- `server/routes.ts`: register `demos-map` routes
- `shared/schema.ts` + `server/db-init.ts`: the `geocodes` table

## 6. Dependencies

```
leaflet ^1.9           react-leaflet ^4.2      react-leaflet-cluster ^2.1
@types/leaflet, @types/leaflet.markercluster (dev)
```

`import "leaflet/dist/leaflet.css"` (plus the cluster CSS) inside
`map-demo.tsx` only, so it never loads outside the demo. Nothing server-side —
Nominatim is a plain `fetch`.

## 7. Later (not in v1, all inside the demo)

- ~~**TPS addresses**~~ — planned in §12.
- ~~**Social account locations**~~ — declined 2026-09-26: the data is
  country-only ("United States" ×360), and the map is about where people live.
- **Story location stickers** from `social_account_posts.metadata.locations`
  (none in the DB today).
- **Radius search:** "people within N km of here" — a haversine `WHERE` over
  `geocodes`; no PostGIS needed at this scale.
- **Groups filter.**

If the demo graduates to a real feature, that's when hooks get added (geocode
on save, profile link, a top-level sidebar entry) — as a separate plan.

## 8. Footprint / removal

New files: `server/map-geocoder.ts`, `server/routes/demos-map.ts`,
`client/src/pages/map-demo.css`,
`client/src/pages/map-demo.tsx`. Edited: the registration lines in §5.5.
To remove: delete the four files, revert the §5.5 lines, `DROP TABLE geocodes`,
uninstall the five packages.

## 9. Privacy note

Every address the demo geocodes is sent to Nominatim (OSM Foundation servers),
and tile requests reveal which area is being viewed. For a personal CRM that is
probably acceptable; if not, point `GEOCODER_URL` at a self-hosted Nominatim or
Photon and `MAP_TILE_URL` at a self-hosted tile server — no code changes.

## 10. Verification

1. `npm run check` passes.
2. Restart the server without opening the demo → no Nominatim traffic in the
   log; `geocodes` unchanged.
3. Save a person's address elsewhere in the app → no geocoder activity (no
   hooks).
4. Open `/demos/map` → a pass starts, progress counts up, pins appear.
5. Edit an address, reopen the demo → the new address is geocoded and the pin
   moves; the old `geocodes` row stays (harmless cache).
6. Nonsense address → appears under "Couldn't locate"; place it manually →
   row is `manual`, and a retry does not overwrite it.
7. Two people at the same address → one Nominatim call, one cluster that
   spiderfies into two markers.
8. Log shows ≥ 1.1 s between requests; kill network mid-pass → no
   `not_found` rows written; reopening resumes.
9. A private person owned by another user does not appear on the map.
10. Dark theme renders legible tiles; attribution is visible bottom-right.

## 11. Build order

1. `geocodes` table (schema + db-init).
2. `server/map-geocoder.ts` (on-demand single-flight pass).
3. `server/routes/demos-map.ts` (GET people, POST geocode, PUT fix, retry).
4. Install deps; `map-demo.tsx` with markers, clusters, popups, fitBounds.
5. Registration: route, sidebar sub-item, demos card.
6. Filters, progress/not-found panel, move/place pin, URL state, dark mode.

---

## 12. v2 — every address on the map

Today the map pins 1 person. The DB holds 6 TruePeopleSearch records, all
linked to people, with a current address each and ~35 history entries (mostly
around Spokane, plus Yakima, Harrisburg/Rapid City SD, and a few past
addresses in ID, TN, IL, CO, AZ). v2 pins all of them.

Decisions (2026-09-26):

| Question | Answer |
|---|---|
| Sources | `people.address`, `true_person_search.current_address`, and each `true_person_search.addresses[].address` |
| Past addresses | Always shown, same pin style as current. The popup says where the address came from |
| Address field vs TPS current | Both are pinned when they differ. The same address from two sources is one pin (dedupe per person on the normalized key) |
| Social account locations | Off (country-only data) |
| Pending imports ("Austin, TX" ×16) | Off. They're not people yet |
| Unlinked TPS rows (`person_id` null) | Off. There's no person for the popup and no owner for access checks (none exist today) |

Still no hooks: the demo now *reads* `true_person_search` too, and still
writes only `geocodes`.

### 12.1 One address source, used everywhere

Replace the three places that read `people.address` directly (the geocoder's
pending query, the GET route, the fix/retry lookups) with one SQL fragment in
`map-geocoder.ts`:

```sql
-- person_addresses(person_id, address, source)
SELECT id, address, 'profile' FROM people
UNION ALL
SELECT person_id, current_address, 'tps_current' FROM true_person_search
UNION ALL
SELECT t.person_id, a->>'address', 'tps_past'
FROM true_person_search t, jsonb_array_elements(t.addresses) a
```

filtered to non-blank addresses and non-null `person_id`. The geocoder takes
`DISTINCT norm(address)` from it; the GET route joins it to `people` (for name,
avatar, tags and the `visibleShared` check) and to `geocodes`. The cache key,
statuses and single-flight pass are unchanged, so the existing rows (Emily's
pin) keep working.

**Dedupe:** `DISTINCT ON (person_id, norm(address))`, keeping the best source
in the order profile → tps_current → tps_past. So Emily's Address field and her
TPS current address, if they normalize the same, are one pin labelled
"Address field".

### 12.2 API changes (`server/routes/demos-map.ts`)

A person now has several pins, so a pin is identified by its **address key**,
not by `personId`:

- `GET /people`: one row per (person, address) with the extra fields
  `query` (the normalized key) and `source`. The rest of the response is
  unchanged.
- `PUT /geocodes`: the body becomes `{ query, latitude, longitude }`. The route
  checks that `query` is in `person_addresses` for at least one person the
  caller can see (else 404), then upserts it as `manual`.
- `POST /geocodes/retry`: `{ query? }` replaces `{ personId? }`.

`normAddress` stays the only definition of the key. The client never builds a
key; it only echoes back the `query` the server sent.

### 12.3 Page changes (`client/src/pages/map-demo.tsx`)

- **Markers:** keyed `${personId}:${query}`, the same avatar divIcon for every
  source.
- **Popup:** adds a source line: "Address field", "TruePeopleSearch — current"
  or "TruePeopleSearch — past", plus "N other addresses" when the person has
  more pins. Move pin sends the pin's `query`.
- **Search:** a person can match several pins, so fit the bounds of all their
  pins and open the popup only when there is exactly one.
- **Starred / tags filters:** unchanged. They filter by person, so all of a
  person's pins show or hide together.
- **Couldn't locate:** one row per address (with the person's name and the
  source), since only that one address failed.
- **Counts:** the panel shows "N people · M addresses".

### 12.4 What to expect

- The first open after v2 geocodes about 40 new addresses: ≈ 45 s at
  1.1 s/request, with pins appearing as the 10 s refetch lands. Later opens
  make no calls.
- TPS history strings look like "123 Main St, Spokane Valley, WA 99216", which
  Nominatim handles well. Expect a few not-founds on rural or PO-box
  addresses; they get Place manually like any other.
- *As built:* the first pass missed 15 of 33 (unit numbers like "#209",
  "Rd N", PO boxes). The geocoder now falls back: full address → without the
  unit → "city, state zip". All 33 located; about half at street or city
  precision, which the popup's "Matched:" line makes visible.
- The Spokane area becomes a dense cluster of about 15 pins, and the far-flung
  history (TN, IL, CO, AZ) makes the first `fitBounds` show most of the US.
  That's accurate, just wide.

### 12.5 Verification

1. `npx tsc --noEmit` passes.
2. Open `/demos/map`: progress shows about 40, the pass completes, and the
   log shows ≥ 1.1 s between requests.
3. All 6 linked people have pins, and the popup source labels are correct.
4. Emily: one pin if her two addresses normalize the same, otherwise two.
5. Move a TPS past-address pin: it becomes `manual` and every person sharing
   that address moves too. Retry doesn't overwrite it.
6. A private person owned by another user: none of their addresses appear,
   and `PUT` with their `query` returns 404.
7. Starring or tag-filtering a person shows or hides all their pins together.

### 12.6 Build order

1. `person_addresses` fragment + geocoder pending query.
2. GET route: the union, dedupe, `query`/`source` fields.
3. PUT/retry keyed by `query`, with the visibility check.
4. Client: marker keys, popup source line, search over several pins,
   per-address not-found list, counts.
5. Run the §12.5 checks against the real data. This sends about 40 real
   addresses to Nominatim (see §9).
