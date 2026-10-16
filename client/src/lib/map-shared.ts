/** What the Leaflet map demo and the Google Map page share: the pin data and how a pin looks. */
import { formatPersonName } from "@shared/person-name";
import { useState } from "react";
import { withImageSize } from "@shared/image-size";

export const PEOPLE_URL = "/api/demos/map/people";

/** One (person, address) pair. A person with several addresses has several pins. */
export interface MapPin {
  id: string; // person id
  firstName: string;
  lastName: string;
  imageUrl: string | null;
  isStarred: number;
  tags: string[] | null;
  address: string;
  query: string; // the server's cache key for this address; echoed back, never built here
  source: "primary" | "current" | "past";
  status: "ok" | "not_found" | "manual" | null;
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
}

export interface MapData {
  located: MapPin[];
  notFound: MapPin[];
  pending: number;
  geocoder: { running: boolean; done: number; total: number; error: string | null };
  tileUrl: string;
  attribution: string;
  googleKey: string | null;
  mapId: string | null;
  cartoKey: string | null;
}

export const SOURCE_LABELS: Record<MapPin["source"], string> = {
  primary: "Primary address",
  current: "Current address",
  past: "Past address",
};

const PRIMARY_ONLY_KEY = "map-primary-only";

/** "Primary addresses only", remembered across both map pages. */
export function usePrimaryOnly(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(PRIMARY_ONLY_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(PRIMARY_ONLY_KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };
  return [value, set];
}

export const pinKey =(p: MapPin) => `${p.id}:${p.query}`;
export const fullName = (p: MapPin) => formatPersonName(p);

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The round photo / initials pin (styled by map-demo.css). */
export function pinHtml(p: MapPin, extraClass = ""): string {
  const initials = `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
  const inner = p.imageUrl
    ? `<img src="${escapeHtml(withImageSize(p.imageUrl, 64))}" alt="" />`
    : escapeHtml(initials);
  const cls = ["map-demo-pin", p.isStarred ? "starred" : "", extraClass].filter(Boolean).join(" ");
  return `<div class="${cls}">${inner}</div>`;
}

/** Initial view from ?lat=&lng=&z=, if the URL has one. */
export function viewFromUrl(): { center: [number, number]; zoom: number } | null {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const zoom = Number(params.get("z"));
  if (!params.has("lat") || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
  return { center: [lat, lng], zoom };
}

/** Keeps any other params (e.g. ?person=&address=) so the page's backlink survives panning. */
export function writeViewToUrl(lat: number, lng: number, zoom: number): void {
  const params = new URLSearchParams(window.location.search);
  params.set("lat", lat.toFixed(5));
  params.set("lng", lng.toFixed(5));
  params.set("z", String(Math.round(zoom)));
  window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
}

/** The map, zoomed to one of a person's addresses, with a link back to them. */
export const mapHref = (personId: string, address: string) =>
  `/demos/map?${new URLSearchParams({ person: personId, address })}`;

/** The ?person=&address= the map was opened with, if any. */
export function targetFromUrl(): { personId: string; address: string | null } | null {
  const params = new URLSearchParams(window.location.search);
  const personId = params.get("person");
  return personId ? { personId, address: params.get("address") } : null;
}
