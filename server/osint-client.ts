// PRM-osint client shared by the /api/osint proxy routes and the scan runner.
// Settings live in the shared app_settings store under the keys below; every
// request injects the API key server-side so the browser never sees it.
import { storage } from "./storage";

export const OSINT_ENABLED_KEY = "osint_enabled";
export const OSINT_API_URL_KEY = "osint_api_url";
export const OSINT_API_KEY_KEY = "osint_api_key";

/**
 * Normalize a user-entered address down to just `scheme://host(:port)` — no
 * path, query, hash, or trailing slash. So the user only has to type
 * `http(s)://{ip}(:port)` and pasting something like
 * `https://1.2.3.4:8000/api/v1/` still works. Returns null if it can't be
 * parsed into a valid http(s) origin.
 */
export function normalizeOsintUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  // Assume http:// when no scheme is given so the URL parser has something to chew on.
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    // u.host includes the port when one was specified, and omits it otherwise.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export type OsintConfig = { enabled: boolean; apiUrl: string; apiKey: string };

export async function loadOsintConfig(): Promise<OsintConfig> {
  // PRM-Compute (formerly PRM-face) hosts the unified OSINT service.
  // We check compute settings first, falling back to legacy settings for seamless transition.
  const [
    computeUrl,
    computeKey,
    faceUrl,
    faceKey,
    legacyUrl,
    legacyKey,
    legacyEnabled,
  ] = await Promise.all([
    storage.getAppSetting("prm_compute_api_url"),
    storage.getAppSetting("prm_compute_api_key"),
    storage.getAppSetting("prm_face_api_url"),
    storage.getAppSetting("prm_face_api_key"),
    storage.getAppSetting(OSINT_API_URL_KEY),
    storage.getAppSetting(OSINT_API_KEY_KEY),
    storage.getAppSetting(OSINT_ENABLED_KEY),
  ]);

  const rawUrl = computeUrl || faceUrl || legacyUrl || "";
  const apiKey = computeKey || faceKey || legacyKey || "";
  const apiUrl = rawUrl ? (normalizeOsintUrl(rawUrl) ?? rawUrl) : "";
  const enabled = (!!apiUrl && !!apiKey) || legacyEnabled === "true";

  return {
    enabled,
    apiUrl,
    apiKey,
  };
}

/** True when connectivity is turned on and both address + key are present. */
export function isOsintConfigured(cfg: OsintConfig): boolean {
  return cfg.enabled && !!cfg.apiUrl && !!cfg.apiKey;
}

/** Call the PRM-Compute OSINT API with the stored key injected. */
export async function osintFetch(
  apiUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  // PRM-compute hosts OSINT endpoints at /api/osint/* (tools, scans, etc.)
  const endpointPath = cleanPath.startsWith("/api/osint")
    ? cleanPath
    : `/api/osint${cleanPath}`;

  // Strip trailing slashes so `base + path` never produces a double slash.
  return fetch(`${apiUrl.replace(/\/+$/, "")}${endpointPath}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
