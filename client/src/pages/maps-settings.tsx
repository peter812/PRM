import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Globe, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PEOPLE_URL } from "@/lib/map-shared";

const FIELDS = [
  {
    key: "google_maps_api_key",
    label: "Google Maps API key",
    secret: true,
    help: "Adds Google Roadmap, Satellite, Hybrid and Terrain styles to the map, enables the Google Map page (Street View), and geocodes addresses through Google instead of Nominatim.",
  },
  {
    key: "google_maps_map_id",
    label: "Google Map ID (optional)",
    secret: false,
    help: "A Map ID from Google Cloud → Map Management, for custom map styling on the Google Map page. Leave blank to use Google's demo Map ID.",
  },
  {
    key: "carto_api_key",
    label: "CARTO API key (optional)",
    secret: true,
    help: "For the Light, Voyager, Dark and vector styles. Overrides the CARTO_API_KEY environment variable.",
  },
] as const;

type TestResult = { tiles: string; geocoding: string };

export default function MapsSettingsPage() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<Record<string, string | null>>({ queryKey: ["/api/settings"] });
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (settings) setValues(Object.fromEntries(FIELDS.map((f) => [f.key, settings[f.key] ?? ""])));
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      for (const f of FIELDS) {
        const value = values[f.key]?.trim() ?? "";
        if (value !== (settings?.[f.key] ?? "")) await apiRequest("POST", "/api/settings", { key: f.key, value });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: [PEOPLE_URL] });
      toast({ title: "Map settings saved" });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/demos/map/google-test")).json() as Promise<TestResult>,
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dirty = FIELDS.some((f) => (values[f.key]?.trim() ?? "") !== (settings?.[f.key] ?? ""));

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0 space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Globe className="h-6 w-6" />
          Maps
        </h1>
        <p className="text-muted-foreground mt-1">
          Map providers for the <Link href="~/demos/map" className="underline">Map</Link> and{" "}
          <Link href="~/demos/google-map" className="underline">Google Map</Link> pages.
        </p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">API keys</CardTitle>
          <CardDescription>
            In Google Cloud, enable the <b>Maps JavaScript API</b>, <b>Map Tiles API</b> and <b>Geocoding API</b> for
            this key. The key is used from both the browser and the server, so restrict it by API, not by website —
            a website-restricted key can't geocode.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{f.help}</p>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
            <Button
              variant="outline"
              onClick={() => test.mutate()}
              disabled={dirty || !settings?.google_maps_api_key || test.isPending}
              title={dirty ? "Save first" : undefined}
            >
              {test.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Test Google key
            </Button>
          </div>

          {test.data && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              {(["tiles", "geocoding"] as const).map((k) => (
                <div key={k} className="flex gap-2">
                  <span className="w-24 shrink-0 text-muted-foreground">{k === "tiles" ? "Map Tiles" : "Geocoding"}</span>
                  <span className={test.data[k] === "OK" ? "text-green-600" : "text-destructive"}>{test.data[k]}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Addresses that Nominatim couldn't find can be sent to Google with <b>Retry all</b> under "Couldn't locate"
            on the Map page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
