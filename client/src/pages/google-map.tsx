/// <reference types="google.maps" />
/**
 * Google Map (google-maps-plan.md §4): the map demo's pins on Google's own map, with
 * Google's map types and Street View. View only — pins are placed, moved and removed on
 * /demos/map, which also runs geocoding. Needs a Google Maps key (Settings → Maps).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  InfoWindow,
  Map as GoogleMap,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { Globe, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  fullName,
  PEOPLE_URL,
  pinHtml,
  pinKey,
  SOURCE_LABELS,
  usePrimaryOnly,
  viewFromUrl,
  writeViewToUrl,
  type MapData,
  type MapPin,
} from "@/lib/map-shared";
import "./map-demo.css";

const MAP_TYPE_KEY = "google-map-type";

function savedMapType(): string {
  try {
    return localStorage.getItem(MAP_TYPE_KEY) || "hybrid";
  } catch {
    return "hybrid";
  }
}

type SetMarkerRef = (marker: google.maps.marker.AdvancedMarkerElement | null, key: string) => void;

/** Its own component so the ref callback is stable; an inline one would re-register every render. */
function PinMarker({ pin, onSelect, setMarkerRef }: { pin: MapPin; onSelect: (p: MapPin) => void; setMarkerRef: SetMarkerRef }) {
  const key = pinKey(pin);
  const ref = useCallback((m: google.maps.marker.AdvancedMarkerElement | null) => setMarkerRef(m, key), [setMarkerRef, key]);
  return (
    <AdvancedMarker
      ref={ref}
      position={{ lat: pin.latitude!, lng: pin.longitude! }}
      anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
      title={fullName(pin)}
      onClick={() => onSelect(pin)}
    >
      <div dangerouslySetInnerHTML={{ __html: pinHtml(pin) }} />
    </AdvancedMarker>
  );
}

function PinMarkers({ pins, fit }: { pins: MapPin[]; fit: boolean }) {
  const map = useMap();
  const streetView = useMapsLibrary("streetView");
  const geometry = useMapsLibrary("geometry");
  const { toast } = useToast();
  const [markers, setMarkers] = useState<Record<string, google.maps.marker.AdvancedMarkerElement>>({});
  const [selected, setSelected] = useState<MapPin | null>(null);

  const clusterer = useMemo(() => map && new MarkerClusterer({ map }), [map]);
  useEffect(() => () => clusterer?.setMap(null), [clusterer]);
  useEffect(() => {
    clusterer?.clearMarkers();
    clusterer?.addMarkers(Object.values(markers));
  }, [clusterer, markers]);

  const setMarkerRef = useCallback<SetMarkerRef>((marker, key) => {
    setMarkers((prev) => {
      if (marker ? prev[key] === marker : !prev[key]) return prev;
      const next = { ...prev };
      if (marker) next[key] = marker;
      else delete next[key];
      return next;
    });
  }, []);

  // Fit to everyone once, unless the URL chose a view.
  const fitted = useRef(!fit);
  useEffect(() => {
    if (!map || fitted.current || pins.length === 0) return;
    fitted.current = true;
    const bounds = new google.maps.LatLngBounds();
    for (const p of pins) bounds.extend({ lat: p.latitude!, lng: p.longitude! });
    map.fitBounds(bounds, 40);
  }, [map, pins]);

  /** Street View at the nearest outdoor panorama, turned to face the address. */
  const openStreetView = async (p: MapPin) => {
    if (!map || !streetView || !geometry) return;
    const target = { lat: p.latitude!, lng: p.longitude! };
    try {
      const { data } = await new streetView.StreetViewService().getPanorama({
        location: target,
        radius: 50,
        source: streetView.StreetViewSource.OUTDOOR,
      });
      const view = map.getStreetView();
      view.setPano(data.location!.pano);
      view.setPov({ heading: geometry.spherical.computeHeading(data.location!.latLng!, target), pitch: 0 });
      view.setVisible(true);
      setSelected(null);
    } catch {
      toast({ title: "No Street View here", description: "Google has no outdoor imagery within 50 m of this address." });
    }
  };

  return (
    <>
      {pins.map((p) => (
        <PinMarker key={pinKey(p)} pin={p} onSelect={setSelected} setMarkerRef={setMarkerRef} />
      ))}
      {selected && (
        <InfoWindow
          anchor={markers[pinKey(selected)]}
          headerContent={<span className="font-semibold text-sm text-neutral-900">{fullName(selected)}</span>}
          onCloseClick={() => setSelected(null)}
        >
          <div className="space-y-1 min-w-48 text-xs text-neutral-900">
            <div>{selected.address}</div>
            <div className="text-neutral-500">{SOURCE_LABELS[selected.source]}</div>
            {selected.status === "manual" ? (
              <div className="italic text-neutral-500">Placed by hand</div>
            ) : (
              selected.displayName && <div className="text-neutral-500">Matched: {selected.displayName}</div>
            )}
            <div className="flex gap-3 pt-1">
              <Link href={`/person/${selected.id}`} className="text-[#0078A8] hover:underline">Open profile</Link>
              <button type="button" className="text-[#0078A8] hover:underline" onClick={() => openStreetView(selected)}>
                Street View
              </button>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export default function GoogleMapPage() {
  const [, navigate] = useLocation();
  const [initialView] = useState(viewFromUrl);
  const [initialMapType] = useState(savedMapType); // constant, so the map's own control stays in charge
  const { data, isLoading } = useQuery<MapData>({ queryKey: [PEOPLE_URL] });
  const [primaryOnly, setPrimaryOnly] = usePrimaryOnly();
  const located = useMemo(
    () => (data?.located ?? []).filter((p) => !primaryOnly || p.source === "primary"),
    [data, primaryOnly],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.googleKey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Globe className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Add a Google Maps API key to use the Google map.</p>
        <Button asChild>
          <Link href="/settings/maps">Open Maps settings</Link>
        </Button>
      </div>
    );
  }

  const people = new Set(located.map((p) => p.id)).size;

  return (
    <APIProvider apiKey={data.googleKey}>
      <div className="relative isolate h-full w-full">
        <GoogleMap
          className="h-full w-full"
          mapId={data.mapId || "DEMO_MAP_ID"}
          defaultCenter={initialView ? { lat: initialView.center[0], lng: initialView.center[1] } : { lat: 20, lng: 0 }}
          defaultZoom={initialView?.zoom ?? 2}
          mapTypeId={initialMapType}
          gestureHandling="greedy"
          onIdle={(e) => {
            const c = e.map.getCenter();
            if (c) writeViewToUrl(c.lat(), c.lng(), e.map.getZoom() ?? 2);
          }}
          onMapTypeIdChanged={(e) => {
            try {
              localStorage.setItem(MAP_TYPE_KEY, e.map.getMapTypeId() ?? "");
            } catch {
              /* storage unavailable */
            }
          }}
        >
          <PinMarkers pins={located} fit={!initialView} />
        </GoogleMap>

        <div className="absolute top-14 left-3 z-10 flex items-center gap-3 rounded-lg border bg-background/95 px-3 py-2 shadow">
          <div>
            <h1 className="font-semibold flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4" /> Google Map
            </h1>
            <p className="text-xs text-muted-foreground">
              {people} people · {located.length} addresses
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="google-map-primary" checked={primaryOnly} onCheckedChange={setPrimaryOnly} />
            <Label htmlFor="google-map-primary" className="text-xs">Primary only</Label>
          </div>
          <Button size="sm" variant="outline" className="h-7" onClick={() => navigate(`/demos/map${window.location.search}`)}>
            <Pencil className="h-3 w-3 mr-1" /> Edit pins
          </Button>
        </div>
      </div>
    </APIProvider>
  );
}
