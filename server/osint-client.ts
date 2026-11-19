// PRM-osint client shared by the /api/osint proxy routes and the scan runner.
// Settings live in the shared app_settings store under the keys below; every
// request injects the API key server-side so the browser never sees it.
import dns from "node:dns/promises";
import net from "node:net";
import { storage } from "./storage";

export const OSINT_ENABLED_KEY = "osint_enabled";
export const OSINT_API_URL_KEY = "osint_api_url";
export const OSINT_API_KEY_KEY = "osint_api_key";

/** True when the hostname/IP points to a cloud instance-metadata endpoint or link-local metadata range. */
export function isBlockedMetadataHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "fd00:ec2::254"
  ) {
    return true;
  }
  if (/^169\.254\./.test(host)) {
    return true;
  }
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice(7);
    if (/^169\.254\./.test(mapped)) return true;
    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      if (((hi >> 8) & 0xff) === 169 && (hi & 0xff) === 254) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Normalize a user-entered address down to just `scheme://host(:port)` — no
 * path, query, hash, or trailing slash. So the user only has to type
 * `http(s)://{ip}(:port)` and pasting something like
 * `https://1.2.3.4:8000/api/v1/` still works. Returns null if it can't be
 * parsed into a valid http(s) origin or targets a blocked metadata host.
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
    if (isBlockedMetadataHost(u.hostname)) return null;
    // u.host includes the port when one was specified, and omits it otherwise.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export type OsintConfig = { enabled: boolean; apiUrl: string; apiKey: string };

let cachedOsintConfig: OsintConfig | null = null;
let osintConfigLastFetchedAt = 0;
const OSINT_CONFIG_TTL_MS = 60_000;

export function invalidateOsintConfigCache(): void {
  cachedOsintConfig = null;
  osintConfigLastFetchedAt = 0;
}

export async function loadOsintConfig(force = false): Promise<OsintConfig> {
  if (!force && cachedOsintConfig && Date.now() - osintConfigLastFetchedAt < OSINT_CONFIG_TTL_MS) {
    return cachedOsintConfig;
  }

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

  const cfg: OsintConfig = {
    enabled,
    apiUrl,
    apiKey,
  };

  cachedOsintConfig = cfg;
  osintConfigLastFetchedAt = Date.now();
  return cfg;
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
  const normalized = normalizeOsintUrl(apiUrl);
  if (!normalized) {
    throw new Error("Invalid or blocked OSINT API URL.");
  }

  const host = new URL(normalized).hostname.replace(/^\[|\]$/g, "");
  if (!net.isIP(host)) {
    let addresses: { address: string }[] = [];
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch {
      // Let fetch() surface DNS/network errors normally.
    }
    for (const { address } of addresses) {
      if (isBlockedMetadataHost(address)) {
        throw new Error("Refusing to connect to a blocked metadata address.");
      }
    }
  }

  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  // PRM-compute hosts OSINT endpoints at /api/osint/* (tools, scans, etc.)
  const endpointPath = cleanPath.startsWith("/api/osint")
    ? cleanPath
    : `/api/osint${cleanPath}`;

  return fetch(`${normalized}${endpointPath}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...(init.headers ?? {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
}
