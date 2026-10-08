/**
 * Map demo (map-page-plan.md §5, §12): people pinned on OpenStreetMap at every
 * address PRM knows for them — the Address field plus TruePeopleSearch current
 * and past addresses. Opening the page starts a server-side geocoding pass for
 * any addresses not located yet; pins appear as it progresses.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map-demo.css";
import { applyVectorTheme, VECTOR_THEMES } from "./map-vector-themes";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, MapPin, RotateCcw, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { withImageSize } from "@shared/image-size";

const PEOPLE_URL = "/api/demos/map/people";

/** One (person, address) pair. A person with several addresses has several pins. */
interface MapPin {
  id: string; // person id
  firstName: string;
  lastName: string;
  imageUrl: string | null;
  isStarred: number;
  tags: string[] | null;
  address: string;
  query: string; // the server's cache key for this address; echoed back, never built here
  source: "profile" | "tps_current" | "tps_past";
  status: "ok" | "not_found" | "manual" | null;
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
}

interface MapData {
  located: MapPin[];
  notFound: MapPin[];
  pending: number;
  geocoder: { running: boolean; done: number; total: number; error: string | null };
  tileUrl: string;
  cartoKey: string | null;
  attribution: string;
}

const SOURCE_LABELS: Record<MapPin["source"], string> = {
  profile: "Address field",
  tps_current: "TruePeopleSearch — current",
  tps_past: "TruePeopleSearch — past",
};

const pinKey = (p: MapPin) => `${p.id}:${p.query}`;
const fullName = (p: MapPin) => `${p.firstName} ${p.lastName}`.trim();

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function personIcon(p: MapPin, moving: boolean): L.DivIcon {
  const initials = `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
  const inner = p.imageUrl
    ? `<img src="${escapeHtml(withImageSize(p.imageUrl, 64))}" alt="" />`
    : escapeHtml(initials);
  const cls = ["map-demo-pin", p.isStarred ? "starred" : "", moving ? "moving" : ""].filter(Boolean).join(" ");
  return L.divIcon({ className: "", html: `<div class="${cls}">${inner}</div>`, iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18] });
}

/** Initial view from ?lat=&lng=&z=, if the URL has one. */
function viewFromUrl(): { center: [number, number]; zoom: number } | null {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const zoom = Number(params.get("z"));
  if (!params.has("lat") || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
  return { center: [lat, lng], zoom };
}

/** Keeps ?lat=&lng=&z= in sync with the view, and forwards map clicks. */
function MapEvents({ onClick }: { onClick: (latlng: L.LatLng) => void }) {
  useMapEvents({
    moveend(e) {
      const map = e.target as L.Map;
      const c = map.getCenter();
      const params = new URLSearchParams({ lat: c.lat.toFixed(5), lng: c.lng.toFixed(5), z: String(map.getZoom()) });
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    },
    click(e) {
      onClick(e.latlng);
    },
  });
  return null;
}

const WORLD_BOUNDS = L.latLngBounds([-85, -180], [85, 180]);

/**
 * Zoom-out stops at the level where one copy of the world fills the viewport, so no country repeats.
 * Reports the level so the cluster group can be rebuilt: markercluster sizes its zoom grids from
 * minZoom once, on add, and throws (`_zoom` / `_leaflet_pos` of undefined) if minZoom changes later.
 */
function WorldMinZoom({ onChange }: { onChange: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const apply = () => {
      const zoom = Math.ceil(map.getBoundsZoom(WORLD_BOUNDS, true));
      map.setMinZoom(zoom);
      onChange(zoom);
    };
    apply();
    map.on("resize", apply);
    return () => {
      map.off("resize", apply);
    };
  }, [map, onChange]);
  return null;
}

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const cartoUrl = (style: string, key: string | null) =>
  `https://basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png${key ? `?key=${key}` : ""}`;

/** Color schemes. "standard" uses the server-configured tiles (data.tileUrl). */
const MAP_STYLES = {
  standard: { label: "Standard" },
  light: { label: "Light", style: "rastertiles/light_all" },
  voyager: { label: "Voyager", style: "rastertiles/voyager" },
  dark: { label: "Dark", style: "rastertiles/dark_all" },
} as const;
type MapStyleKey = keyof typeof MAP_STYLES;

/** How many zoom levels coarser the raster backdrop is (each level doubles the area it covers). */
const BACKDROP_LEVELS = 3;

const POSITRON_STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const withCartoKey = (url: string, key: string | null) =>
  key && !url.includes("key=") ? `${url}${url.includes("?") ? "&" : "?"}key=${key}` : url;

/** Vector basemap: CARTO Positron's style.json recolored with a Terraink theme, drawn by MapLibre GL inside Leaflet. */
function VectorLayer({ themeKey, cartoKey }: { themeKey: string; cartoKey: string | null }) {
  const map = useMap();
  useEffect(() => {
    let cancelled = false;
    let layer: L.Layer | null = null;
    (async () => {
      const [{ maplibreGL }, { setWorkerUrl }, { default: workerUrl }, style] = await Promise.all([
        import("@maplibre/maplibre-gl-leaflet"),
        import("maplibre-gl"),
        import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
        fetch(withCartoKey(POSITRON_STYLE_URL, cartoKey)).then((r) => r.json()),
      ]);
      if (cancelled) return;
      setWorkerUrl(workerUrl); // Vite can't resolve maplibre's own worker path
      layer = maplibreGL({
        style: applyVectorTheme(style, VECTOR_THEMES[themeKey]),
        transformRequest: (url) => ({ url: /cartocdn\.com/.test(url) ? withCartoKey(url, cartoKey) : url }),
      }).addTo(map);
    })();
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, themeKey, cartoKey]);
  return null;
}

interface MapPrefs {
  mode: "raster" | "vector";
  raster: MapStyleKey;
  vector: string;
}
const DEFAULT_PREFS: MapPrefs = { mode: "raster", raster: "standard", vector: "midnight_blue" };
const STYLE_STORAGE_KEY = "map-demo-prefs";

function loadPrefs(): MapPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(STYLE_STORAGE_KEY) ?? "null");
    if (v && (v.mode === "raster" || v.mode === "vector") && v.raster in MAP_STYLES && v.vector in VECTOR_THEMES) return v;
  } catch {
    /* storage unavailable or corrupt */
  }
  return DEFAULT_PREFS;
}

/** fitBounds options that keep pins clear of the side panel when it's open. */
const fitOptions = (panelOpen: boolean): L.FitBoundsOptions => ({
  paddingTopLeft: [panelOpen ? 400 : 40, 40],
  paddingBottomRight: [40, 40],
  maxZoom: 14,
});

/**
 * Fit to everyone the first time there is anyone to fit (unless the URL chose a
 * view), and again as a geocoding pass adds pins, so the view grows with them.
 */
function FitOnce({ points, skip, growing, panelOpen }: { points: [number, number][]; skip: boolean; growing: boolean; panelOpen: boolean }) {
  const map = useMap();
  const fittedCount = useRef(0);
  const wasGrowing = useRef(false); // the refetch that ends a pass reports running: false
  useEffect(() => {
    const settling = growing || wasGrowing.current;
    wasGrowing.current = growing;
    if (skip || points.length === 0 || points.length === fittedCount.current) return;
    if (fittedCount.current > 0 && !settling) return;
    // The container can still be 0×0 on first load (the page lays out after the
    // map mounts), and a 0×0 fit lands at maxZoom. Fit once it has a size.
    const el = map.getContainer();
    const observer = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) return;
      observer.disconnect();
      fittedCount.current = points.length;
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(points), fitOptions(panelOpen));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [map, points, skip, growing]); // eslint-disable-line react-hooks/exhaustive-deps -- panelOpen only shapes the next fit
  return null;
}

export default function MapDemo() {
  const { toast } = useToast();
  const [initialView] = useState(viewFromUrl);
  const [panelOpen, setPanelOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [placingKey, setPlacingKey] = useState<string | null>(null); // not-found pin awaiting a map click
  const [movingKey, setMovingKey] = useState<string | null>(null); // located pin that is draggable
  const [minZoom, setMinZoom] = useState<number | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const cluster = useRef<L.MarkerClusterGroup>(null);

  const { data, isLoading } = useQuery<MapData>({
    queryKey: [PEOPLE_URL],
    refetchInterval: (query) => (query.state.data?.geocoder.running ? 5000 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [PEOPLE_URL] });
  const [prefs, setPrefs] = useState<MapPrefs>(loadPrefs);
  const updatePrefs = (patch: Partial<MapPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const rasterStyle = MAP_STYLES[prefs.raster];
  const tileStyle = "style" in rasterStyle ? { url: cartoUrl(rasterStyle.style, data?.cartoKey ?? null) } : null;

  const locate = useMutation({
    mutationFn: () => apiRequest("POST", "/api/demos/map/geocode"),
    onSettled: refresh,
  });
  // Opening the demo is what locates new addresses — nothing else triggers it.
  useEffect(() => {
    locate.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const place = useMutation({
    mutationFn: (v: { query: string; latitude: number; longitude: number }) =>
      apiRequest("PUT", "/api/demos/map/geocodes", v),
    onSuccess: () => {
      setPlacingKey(null);
      setMovingKey(null);
      refresh();
    },
    onError: (e: Error) => toast({ title: "Couldn't save pin", description: e.message, variant: "destructive" }),
  });

  const retry = useMutation({
    mutationFn: (query?: string) => apiRequest("POST", "/api/demos/map/geocodes/retry", query ? { query } : {}),
    onSettled: refresh,
  });

  const allTags = useMemo(
    () => Array.from(new Set(data?.located.flatMap((p) => p.tags ?? []) ?? [])).sort(),
    [data],
  );
  const points = useMemo(
    () => data?.located.map((p) => [p.latitude!, p.longitude!] as [number, number]) ?? [],
    [data],
  );
  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      (data?.located ?? []).filter(
        (p) =>
          (!starredOnly || p.isStarred) &&
          (selectedTags.size === 0 || (p.tags ?? []).some((t) => selectedTags.has(t))) &&
          (!q || fullName(p).toLowerCase().includes(q)),
      ),
    [data, starredOnly, selectedTags, q],
  );
  const pinsByPerson = useMemo(() => {
    const byPerson = new Map<string, MapPin[]>();
    for (const p of data?.located ?? []) byPerson.set(p.id, [...(byPerson.get(p.id) ?? []), p]);
    return byPerson;
  }, [data]);
  const visiblePeople = useMemo(() => Array.from(new Map(visible.map((p) => [p.id, p])).values()), [visible]);

  // One pin: open it. Several: fit them all.
  const focus = (personId: string) => {
    const pins = pinsByPerson.get(personId) ?? [];
    if (pins.length === 1) {
      const marker = markers.current.get(pinKey(pins[0]));
      if (marker && cluster.current) cluster.current.zoomToShowLayer(marker, () => marker.openPopup());
    } else if (pins.length > 1) {
      map?.closePopup();
      map?.fitBounds(L.latLngBounds(pins.map((p) => [p.latitude!, p.longitude!])), fitOptions(panelOpen));
    }
  };

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (!next.delete(tag)) next.add(tag);
      return next;
    });

  const placingPin = data?.notFound.find((p) => pinKey(p) === placingKey);
  const movingPin = data?.located.find((p) => pinKey(p) === movingKey);

  const handleMapClick = (latlng: L.LatLng) => {
    if (placingPin) place.mutate({ query: placingPin.query, latitude: latlng.lat, longitude: latlng.lng });
  };
  const geocoder = data?.geocoder;

  return (
    <div className={`relative h-full w-full ${placingPin ? "map-demo-placing" : ""}`}>
      <MapContainer
        center={initialView?.center ?? [20, 0]}
        zoom={initialView?.zoom ?? 2}
        maxZoom={19}
        className="h-full w-full z-0 !bg-background"
        maxBounds={WORLD_BOUNDS}
        maxBoundsViscosity={1}
        ref={setMap}
      >
        {data && prefs.mode === "vector" && <VectorLayer themeKey={prefs.vector} cartoKey={data.cartoKey} />}
        {data && prefs.mode === "raster" && (
          <>
            {/* Low-res backdrop: tiles BACKDROP_LEVELS zooms coarser, stretched to fit. Each covers a big
                area around the view, so zooming out shows blurry map (sharpened as tiles load) instead of gaps. */}
            <TileLayer
              key={`${prefs.raster}-backdrop`}
              url={tileStyle ? tileStyle.url : data.tileUrl}
              className={tileStyle ? "" : "map-demo-tiles"}
              tileSize={256 << BACKDROP_LEVELS}
              zoomOffset={-BACKDROP_LEVELS}
              minNativeZoom={BACKDROP_LEVELS}
              zIndex={0}
              noWrap
            />
            <TileLayer
              key={prefs.raster}
              url={tileStyle ? tileStyle.url : data.tileUrl}
              attribution={tileStyle ? CARTO_ATTRIBUTION : data.attribution}
              className={tileStyle ? "" : "map-demo-tiles"}
              zIndex={1}
              noWrap
            />
          </>
        )}
        <WorldMinZoom onChange={setMinZoom} />
        <MapEvents onClick={handleMapClick} />
        <FitOnce points={points} skip={!!initialView} growing={!!data?.geocoder.running} panelOpen={panelOpen} />
        {minZoom !== null && (
        <MarkerClusterGroup key={minZoom} ref={cluster} chunkedLoading>
          {visible.map((p) => {
            const key = pinKey(p);
            const others = (pinsByPerson.get(p.id)?.length ?? 1) - 1;
            return (
            <Marker
              key={key}
              position={[p.latitude!, p.longitude!]}
              icon={personIcon(p, key === movingKey)}
              draggable={key === movingKey}
              ref={(m) => {
                if (m) markers.current.set(key, m);
                else markers.current.delete(key);
              }}
              eventHandlers={{
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  place.mutate({ query: p.query, latitude: ll.lat, longitude: ll.lng });
                },
              }}
            >
              <Popup>
                <div className="space-y-1 min-w-48 text-neutral-900">
                  <div className="font-semibold text-sm">{fullName(p)}</div>
                  <div className="text-xs">{p.address}</div>
                  <div className="text-xs text-neutral-500">{SOURCE_LABELS[p.source]}</div>
                  {p.status === "manual" ? (
                    <div className="text-xs italic text-neutral-500">Placed by hand</div>
                  ) : (
                    p.displayName && <div className="text-xs text-neutral-500">Matched: {p.displayName}</div>
                  )}
                  {others > 0 && (
                    <button type="button" className="text-xs text-[#0078A8] hover:underline" onClick={() => focus(p.id)}>
                      {others} other address{others === 1 ? "" : "es"}
                    </button>
                  )}
                  <div className="flex gap-3 pt-1 text-xs">
                    <Link href={`/person/${p.id}`}>Open profile</Link>
                    <button
                      type="button"
                      className="text-[#0078A8] hover:underline"
                      onClick={() => {
                        setMovingKey(key);
                        markers.current.get(key)?.closePopup();
                      }}
                    >
                      Move pin
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
            );
          })}
        </MarkerClusterGroup>
        )}
      </MapContainer>

      <div className="absolute bottom-6 left-4 z-[1000] shadow flex gap-1">
        <div className="flex rounded-md border bg-background p-0.5">
          {(["raster", "vector"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={prefs.mode === mode ? "secondary" : "ghost"}
              className="h-7 px-2 capitalize"
              onClick={() => updatePrefs({ mode })}
            >
              {mode}
            </Button>
          ))}
        </div>
        {prefs.mode === "raster" ? (
          <Select value={prefs.raster} onValueChange={(v) => updatePrefs({ raster: v as MapStyleKey })}>
            <SelectTrigger className="h-8 w-36 bg-background" aria-label="Map color scheme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MAP_STYLES).map(([key, st]) => (
                <SelectItem key={key} value={key}>{st.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={prefs.vector} onValueChange={(v) => updatePrefs({ vector: v })}>
            <SelectTrigger className="h-8 w-40 bg-background" aria-label="Map color scheme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(VECTOR_THEMES).map(([key, t]) => (
                <SelectItem key={key} value={key}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {!panelOpen && (
        <Button size="sm" variant="secondary" className="absolute top-4 left-14 z-[1000] shadow" onClick={() => setPanelOpen(true)}>
          <ChevronRight className="h-4 w-4 mr-1" /> Panel
        </Button>
      )}

      {panelOpen && (
        <div className="absolute top-4 left-14 w-80 max-w-[calc(100%-4.5rem)] max-h-[calc(100%-2rem)] overflow-y-auto bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg z-[1000] p-4 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Map
              </h1>
              <p className="text-xs text-muted-foreground">
                {isLoading ? "Loading…" : `${pinsByPerson.size} people · ${data?.located.length ?? 0} addresses · showing ${visible.length}`}
              </p>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPanelOpen(false)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>

          {geocoder?.running && geocoder.total > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Locating addresses… {geocoder.done} / {geocoder.total}
            </div>
          )}
          {!geocoder?.running && geocoder?.error && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>Geocoding stopped: {geocoder.error}</span>
            </div>
          )}
          {!geocoder?.running && !!data?.pending && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{data.pending} not located yet</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => locate.mutate()}>
                Locate
              </Button>
            </div>
          )}

          {(placingPin || movingPin) && (
            <div className="rounded-md border border-primary/50 bg-primary/5 p-2 text-xs flex items-start justify-between gap-2">
              <span>
                {placingPin
                  ? <>Click the map to place <b>{fullName(placingPin)}</b> at {placingPin.address}.</>
                  : <>Drag <b>{fullName(movingPin!)}</b>'s pin to its new spot.</>}
              </span>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setPlacingKey(null); setMovingKey(null); }}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Input placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8" />
            {q && (
              <div className="space-y-0.5">
                {visiblePeople.slice(0, 8).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left text-sm px-2 py-1 rounded hover:bg-accent truncate"
                    onClick={() => focus(p.id)}
                  >
                    {fullName(p)}
                  </button>
                ))}
                {visiblePeople.length === 0 && <p className="text-xs text-muted-foreground px-2">No matches</p>}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch id="map-starred" checked={starredOnly} onCheckedChange={setStarredOnly} />
              <Label htmlFor="map-starred" className="text-sm flex items-center gap-1">
                <Star className="h-3 w-3" /> Starred only
              </Label>
            </div>
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant={selectedTags.has(tag) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {!!data?.notFound.length && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Couldn't locate ({data.notFound.length})</h2>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => retry.mutate(undefined)} disabled={retry.isPending}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Retry all
                </Button>
              </div>
              {data.notFound.map((p) => (
                <div key={pinKey(p)} className="text-xs space-y-1 rounded border p-2">
                  <Link href={`/person/${p.id}`} className="font-medium text-sm hover:underline">
                    {fullName(p)}
                  </Link>
                  <div className="text-muted-foreground break-words">{p.address}</div>
                  <div className="text-muted-foreground">{SOURCE_LABELS[p.source]}</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => { setMovingKey(null); setPlacingKey(pinKey(p)); }}>
                      Place manually
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => retry.mutate(p.query)} disabled={retry.isPending}>
                      Retry
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
