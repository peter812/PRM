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
      signal,
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

/** Cloud instance-metadata endpoints; never a valid AI provider. */
export function isMetadataUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return /^169\.254\./.test(host) || host === "metadata.google.internal" || host === "metadata" || host === "fd00:ec2::254";
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
