import dns from "node:dns/promises";
import net from "node:net";
import type { AiProvider } from "@shared/schema";

// Shared HTTP helpers for the AI adapters.

/** The host didn't answer at all (refused, DNS, reset) — as opposed to an error reply or a timeout. */
export class ProviderUnreachableError extends Error {}

export function providerBase(p: AiProvider): string {
  return p.baseUrl.trim().replace(/\/+$/, "");
}

export function providerHeaders(p: AiProvider): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (p.authType === "basic") {
    headers["Authorization"] = "Basic " + Buffer.from(`${p.username}:${p.secret}`).toString("base64");
  } else if (p.authType === "bearer" && p.secret) {
    headers["Authorization"] = `Bearer ${p.secret}`;
  }
  return headers;
}

/** POST JSON and throw a readable error on a non-2xx response. */
export async function postJson(p: AiProvider, path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(`${providerBase(p)}${path}`, {
      method: "POST",
      headers: providerHeaders(p),
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(120_000),
      redirect: "error", // a redirect would replay the Authorization header to another host
    });
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") throw new Error(`${p.name} request timed out`);
    throw new ProviderUnreachableError(`Failed to reach ${p.name}: ${err?.message ?? err}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${p.name} returned ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp;
}

/** Yield complete lines from a streaming response body. */
export async function* readLines(resp: Response): AsyncIterable<string> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) yield line;
    }
    if (buf.trim()) yield buf;
  } finally {
    // Close the connection when the consumer stops early ([DONE], client disconnect).
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** GET JSON and throw a readable error on a non-2xx response. */
export async function getJson<T>(p: AiProvider, path: string, timeoutMs = 10000): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${providerBase(p)}${path}`, { headers: providerHeaders(p), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  } catch (err: any) {
    throw new ProviderUnreachableError(`Failed to reach ${p.name}: ${err?.message ?? err}`);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${p.name} returned ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json() as Promise<T>;
}

function parseIPv6Groups(ip: string): number[] | null {
  const clean = ip.split("%")[0].toLowerCase();
  let normalized = clean;
  const lastColon = clean.lastIndexOf(":");
  if (lastColon !== -1 && clean.slice(lastColon + 1).includes(".")) {
    const v4Part = clean.slice(lastColon + 1);
    if (!net.isIPv4(v4Part)) return null;
    const octets = v4Part.split(".").map(Number);
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${clean.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const seg of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
      out.push(parseInt(seg, 16));
    }
    return out;
  };

  if (halves.length === 2) {
    const left = parseGroups(halves[0]);
    const right = parseGroups(halves[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return [...left, ...new Array<number>(missing).fill(0), ...right];
  }

  const parsed = parseGroups(normalized);
  return parsed && parsed.length === 8 ? parsed : null;
}

/** True when an IPv4 or IPv6 address (including IPv4-mapped IPv6) points to cloud instance metadata. */
export function isMetadataIp(ip: string): boolean {
  const clean = ip.split("%")[0].toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv4(clean)) {
    return clean.startsWith("169.254.");
  }
  if (!net.isIPv6(clean)) return false;
  const groups = parseIPv6Groups(clean);
  if (!groups) return false;

  // AWS EC2 IPv6 metadata endpoint: fd00:ec2::254
  if (
    groups[0] === 0xfd00 &&
    groups[1] === 0x0ec2 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0 &&
    groups[6] === 0 &&
    groups[7] === 0x0254
  ) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:169.254.0.0/112, normalized to ::ffff:a9fe:*) and IPv4-compatible (::169.254.0.0/112)
  const isZeroPrefix96 =
    groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0;
  if (isZeroPrefix96 && (groups[5] === 0xffff || groups[5] === 0) && groups[6] === 0xa9fe) {
    return true;
  }

  return false;
}

/** Cloud instance-metadata endpoints; never a valid AI provider. */
export function isMetadataUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "").split("%")[0];
  } catch {
    return false;
  }
  if (host === "metadata.google.internal" || host === "metadata") return true;
  return isMetadataIp(host);
}

/**
 * Validate a user-configured service URL (Whisper, PRM-Compute, AI provider):
 * requires http:// or https://, blocks cloud metadata hostnames/IPs (including
 * IPv4-mapped IPv6 and hex/decimal IPv4 forms), and checks DNS resolution
 * against metadata IPs. Private/LAN IPs are allowed for self-hosted services.
 */
export async function assertSafeServiceUrl(raw: string, label = "Service URL"): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must start with http:// or https://`);
  }
  if (isMetadataUrl(url.toString())) {
    throw new Error(`${label} cannot point to a cloud metadata address`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "").split("%")[0];
  if (!net.isIP(host)) {
    try {
      const addresses = await dns.lookup(host, { all: true });
      for (const { address } of addresses) {
        if (isMetadataIp(address)) {
          throw new Error(`${label} resolves to a cloud metadata address (${address})`);
        }
      }
    } catch (err: any) {
      if (err?.message?.includes("cloud metadata")) throw err;
    }
  }
  return url;
}

/** True when the URL's host is outside the local network, i.e. data leaves your control. */
export function isExternalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (host.includes(":")) return !(host === "::1" || /^(fc|fd|fe80:)/.test(host)); // IPv6 loopback / ULA / link-local
  // Single-label names (localhost, docker service names) and private TLDs stay local.
  if (!host.includes(".") || /\.(local|lan|internal|home|localhost)$/.test(host)) return false;
  const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  return true;
}
