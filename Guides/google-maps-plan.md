# Google Maps support — plan

> **As built (2026-10-12)** — simplified from the plan below:
> - Keys live in the existing `/api/settings` whitelist (no new settings routes). `mapKeys()` in
>   `server/map-geocoder.ts` does the DB→env fallback, and `/api/demos/map/people` returns the keys
>   (no separate `/api/maps/config`).
> - Tile session and viewport copyright come from one route: `GET /api/demos/map/google/:type`.
>   The key test is `POST /api/demos/map/google-test`.
> - Dropped: the default-style setting (the picker already remembers the choice), the re-check
>   not-found button (the existing "Retry all" already does it), the Street View split panel, and
>   the satellite pin outline (pins already have a white border and shadow).
> - Shared client code is in `client/src/lib/map-shared.ts`.

Add Google Maps as an optional provider, enabled when the user saves an API key in
settings. Without a key, the app works exactly as it does today (OSM / CARTO tiles,
Nominatim geocoding).

Three parts:

1. **Maps settings page** (`/settings/maps`): Google key, Map ID, CARTO key, default style.
2. **Google layers in the existing Leaflet map** (`/demos/map`): Roadmap, Satellite,
   Hybrid and Terrain as extra style choices. Markers, clustering and pin editing are unchanged.
3. **New Google Map page** (`/demos/google-map`): the native Google Maps JS API, with
   Street View, 3D tilt and Google's own map-type control.

Geocoding uses Google whenever a key is set and Nominatim otherwise.

---

## 1. Settings and config

### Storage
Values go in the existing `app_settings` key-value table through
`storage.getAppSetting` / `setAppSetting`. No schema change is needed.

| key                     | notes                                                         |
|-------------------------|---------------------------------------------------------------|
| `google_maps_api_key`   | env fallback `GOOGLE_MAPS_API_KEY`                            |
| `google_maps_map_id`    | optional; needed for Advanced Markers on the Google page. Falls back to `DEMO_MAP_ID` |
| `carto_api_key`         | moved here from env; env `CARTO_API_KEY` stays as fallback    |
| `map_default_style`     | e.g. `standard`, `google_hybrid`; used when the browser has no saved prefs |

Add a single helper, `server/map-config.ts`, that returns
`getMapConfig(): { googleKey, mapId, cartoKey, defaultStyle }` and applies the DB→env fallback.
The geocoder, the tile-session endpoint and the config route all read from it.

### Routes (new `server/routes/maps-settings.ts`)
- `GET /api/settings/maps`: returns `{ googleConfigured, googleKeyLast4, mapId, cartoConfigured, defaultStyle }`.
  The full key is never returned here.
- `PUT /api/settings/maps`: takes a partial update. An empty string clears a value.
- `POST /api/settings/maps/test`: calls Google `createSession` (tiles) and one Geocoding
  request. It reports each result separately (for example, "Tiles OK, Geocoding: REQUEST_DENIED")
  so the user can see which APIs still need enabling in Google Cloud.
- `GET /api/maps/config`: the browser-facing config. Returns `{ googleKey, mapId, cartoKey, defaultStyle }`.
  The browser needs the raw key for the JS API and tile URLs, which is normal for Google Maps.
  This replaces the `cartoKey` / `tileUrl` fields currently returned by `/api/demos/map/people`;
  those fields move to this route.

### UI (new `client/src/pages/maps-settings.tsx`)
- Add the page under **App Options** sub-items in `settings-layout.tsx`, with a route in the same file.
- Google API key field: password input showing `••••last4`, with Save, Clear and **Test** buttons.
- Help text listing the APIs to enable: *Maps JavaScript API, Map Tiles API, Geocoding API,
  Street View* (included in the JS API). Key restriction note: the same key is used from the
  browser (tiles, JS) and from the server (geocoding). A key restricted by HTTP referrer will
  therefore break geocoding. Restrict it **by API** instead.
- Map ID field (optional), CARTO key field, and a default-style select.
- A "Re-check not-found addresses" button, shown only when a Google key is set. See §2.

---

## 2. Geocoding (`server/map-geocoder.ts`)

- At the start of `runPass()`, read `getMapConfig()`. If a Google key is set, use
  `googleSearch()` for the whole pass; otherwise use the current Nominatim `search()`.
- `googleSearch(query)`:
  - Calls `GET https://maps.googleapis.com/maps/api/geocode/json?address=…&key=…`.
  - `OK` → `{ lat, lng, displayName: formatted_address }`.
  - `ZERO_RESULTS` → `null`, which becomes a `not_found` row as today.
  - `REQUEST_DENIED` / `OVER_QUERY_LIMIT` / `INVALID_REQUEST` → throw. This stops the pass
    and puts Google's `error_message` in `progress.error`, so the map page shows it.
- Rate limit: about 10 requests per second (`MIN_INTERVAL_MS = 100` for Google) instead of 1100 ms.
  Google allows 50 QPS. 10 is gentle, and the 10k address ceiling still finishes in about 17 minutes.
- The unit-stripping and locality fallback in `lookup()` stays Nominatim-only. Google handles
  units itself, so for Google send one request with the full address.
- **Re-check not-found** (`POST /api/demos/map/geocode/retry-not-found`): deletes
  `geocodes` rows with `status = 'not_found'`, then calls `startGeocodePass()`. Addresses
  Nominatim missed get another try through Google. `ok` and `manual` rows are never touched.
- Update the header comment ("through Nominatim at ≤ 1 request/second") to describe both providers.

---

## 3. Google layers inside Leaflet (`/demos/map`)

Google's Map Tiles API serves standard XYZ tiles, which Leaflet can show directly. This
is the officially supported way to use Google tiles in a non-Google renderer.

### Server: tile sessions
- `POST https://tile.googleapis.com/v1/createSession?key=…` with:
  - roadmap: `{ mapType: "roadmap", language: "en-US", region: "US" }`
  - satellite: `{ mapType: "satellite", … }`
  - hybrid: `{ mapType: "satellite", layerTypes: ["layerRoadmap"], … }`
  - terrain: `{ mapType: "terrain", layerTypes: ["layerRoadmap"], … }`
- `GET /api/maps/google-session/:type` returns `{ session, expiry, tileWidth, imageFormat }`.
  Sessions are cached in memory per type until about 1 hour before `expiry` (Google issues
  them for about 2 weeks), so each type costs one `createSession` call per server run.
- `GET /api/maps/google-attribution/:type?zoom&north&south&east&west` proxies
  `/v1/2dtiles/viewport`. Google requires the copyright text shown on screen to match what
  is visible in the current viewport.

### Client (`map-demo.tsx`)
- Extend `MAP_STYLES` with `google_roadmap`, `google_satellite`, `google_hybrid` and
  `google_terrain`. Each carries a `googleType` and a `maxNativeZoom` (satellite/hybrid 22,
  roadmap 22, terrain 15). These four only appear in the Select when `config.googleKey` is set.
- A `GoogleTileLayer` component fetches the session through `useQuery` and renders a
  `<TileLayer url="https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=…&key=…">`.
  It uses the existing backdrop-layer pattern (`BACKDROP_LEVELS`) so zoom-out keeps working.
- A `GoogleAttribution` component refetches viewport attribution on `moveend` (debounced)
  and sets it with `map.attributionControl`. It also shows the Google logo, which the Tiles API
  requires.
- `loadPrefs()` validation already rejects unknown keys. If a user saved a `google_*` style
  and the key is later removed, fall back to `config.defaultStyle` and then to `standard`.
- Satellite imagery makes the existing dark marker styling hard to read. Add a white outline
  or shadow to `.map-pin` when a satellite or hybrid style is active (one CSS class on the container).
- Vector mode (MapLibre themes) is unchanged. Google styles are raster-mode only.

---

## 4. New Google Map page (`/demos/google-map`)

### Dependencies
- `@vis.gl/react-google-maps` (the Google-maintained React wrapper: `APIProvider`, `Map`,
  `AdvancedMarker`, `useMap`, `useMapsLibrary`)
- `@googlemaps/markerclusterer`

### Page (`client/src/pages/google-map.tsx`)
- Reads the same `GET /api/demos/map/people` data and `GET /api/maps/config`.
- If no key is set, it shows an empty state linking to `/settings/maps`.
- `<APIProvider apiKey={googleKey}>` with `<Map mapId={mapId ?? "DEMO_MAP_ID"}>`:
  - The native `mapTypeControl` provides Roadmap, Satellite, Hybrid and Terrain.
    The last choice is saved to localStorage.
  - `streetViewControl` is on, so the pegman can be dragged anywhere.
  - Tilt/rotate controls are on (45° imagery in satellite at high zoom).
  - The `?lat=&lng=&z=` URL sync works like the Leaflet page. The helper should be shared
    rather than copied (see §5).
- Markers: an `AdvancedMarker` per located pin, using the same circular photo/initials look
  as `pinIcon()` in the Leaflet page. Starred pins get the same treatment. Clustering uses
  `MarkerClusterer` on the marker instances.
- Clicking a pin opens an `InfoWindow` with the name, a link to the person, the address and a
  **Street View** button. The button:
  1. calls `StreetViewService.getPanorama({ location, radius: 50, source: OUTDOOR })`;
  2. if a panorama is found, opens `map.getStreetView()` at it, with the heading pointed at the
     pin (`spherical.computeHeading(pano.location, pin)`);
  3. otherwise shows the toast "No Street View within 50 m".
- An optional split view toggle shows a `StreetViewPanorama` in a side panel next to the map
  instead of taking over the map. This is the nicer way to browse many addresses.
- **Scope:** this page only views pins. Placing, moving and removing pins stays on the
  Leaflet page, which already does it. Add a "Edit pins" link to `/demos/map?lat&lng&z` that
  keeps the current view, plus the reverse link on the Leaflet page.

### Wiring
- Add a lazy route in `App.tsx` next to `MapDemo`.
- Add a card on `demos.tsx` next to the existing Map card ("Google Map — satellite and Street View").
  Update the existing card's description, since it is no longer OSM-only.

---

## 5. Shared code (keep it small)

Move the following out of `map-demo.tsx` into `client/src/lib/map-shared.ts` so both pages use them:
- the `MapPin` / `MapData` types
- `viewFromUrl()` and URL-sync logic (as a plain function plus a small hook for each renderer)
- the pin HTML builder (initials/photo/starred), so the Google marker looks the same

Nothing else is shared. The two renderers are separate on purpose.

---

## 6. Order of work

1. `map-config.ts`, the settings routes and `maps-settings.tsx`. Move the CARTO key in and
   add `/api/maps/config`, then switch `map-demo.tsx` to it.
2. Google geocoding, plus the re-check not-found button.
3. Tile sessions, attribution, and the four Google styles in the Leaflet page.
4. Extract `map-shared.ts`.
5. The Google Map page: map, markers and clustering first, then Street View and the split panel.
6. Demos card, nav links between the two pages, and update `PRM-external-API-guide.md` if it
   lists `/api/demos/map/*`.

## 7. Verification
- With no key: `/demos/map` looks and behaves exactly as before. The Google page shows the
  settings empty state, and geocoding still uses Nominatim at 1 request/second.
- With a key:
  - The Test button reports tiles and geocode results separately.
  - All four Google styles load in Leaflet, and attribution updates when panning.
  - Re-check not-found sends previously missed addresses to Google.
  - On the Google page, pins cluster, the map-type control works, and Street View opens
    facing the pin and toasts when there's no coverage.
- With a bad or restricted key: the geocoder error appears in the map's progress banner,
  and tile session failures show a toast and fall back to `standard`.

## Cost notes (for the settings help text)
Google gives a monthly free allowance per API. In a single-user app the main cost drivers are:
- the one-time geocoding of every address (up to 10k requests)
- Street View panorama loads
Tile and session requests are small at personal-use volume.
