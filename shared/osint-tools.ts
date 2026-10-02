// Static metadata for the PRM-osint tools, mirroring GET /api/v1/tools in
// PRM-osint/README.md. Drives the demo pages and decides which tools a scan of
// a given target type goes to. The live server remains the source of truth for
// validation.

// No tool takes "phone" yet; phone targets are listed but can't be scanned.
export type OsintTargetType = "username" | "email" | "phone";

export interface OsintToolMeta {
  /** Slug used in the tool's API `tool` field and the demo route. */
  name: string;
  label: string;
  description: string;
  supportedTargetTypes: OsintTargetType[];
}

export const OSINT_TOOLS: OsintToolMeta[] = [
  {
    name: "sherlock",
    label: "Sherlock",
    description: "Hunt down social media accounts by username across hundreds of sites.",
    supportedTargetTypes: ["username"],
  },
  {
    name: "maigret",
    label: "Maigret",
    description: "Collect a dossier on a person by username from many sites, with tags.",
    supportedTargetTypes: ["username"],
  },
  {
    name: "socialscan",
    label: "Socialscan",
    description: "Check whether an email or username is registered on online platforms.",
    supportedTargetTypes: ["email", "username"],
  },
  {
    name: "blackbird",
    label: "Blackbird",
    description: "Search for accounts by username or email across many modules.",
    supportedTargetTypes: ["email", "username"],
  },
  {
    name: "user-scanner",
    label: "User Scanner",
    description: "Scan an email or username across modules, including breach hits.",
    supportedTargetTypes: ["email", "username"],
  },
];

export function getOsintTool(name: string | undefined): OsintToolMeta | undefined {
  return OSINT_TOOLS.find((t) => t.name === name);
}

export type OsintHit = { site: string; url: string | null };
export type OsintRun = { tool: string; completedAt: string };
/** Hits merged across tools; a target with no finished scan has no entry at all. */
export type OsintResults = { hits: OsintHit[]; runs: OsintRun[] };

const NON_HIT_STATUSES = new Set(["available", "not_found", "not found", "free", "error", "failed"]);

function sanitizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? raw.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The accounts a tool found. Each tool lists its checks under one of these
 * keys; a check that came back free, not found, or errored is not a hit.
 */
export function osintHits(result: any): OsintHit[] {
  const list = result?.sites ?? result?.platforms ?? result?.modules;
  if (!Array.isArray(list)) return [];
  return list
    .filter((h) => {
      if (!h || typeof h !== "object") return false;
      if (h.exists === false || h.found === false || h.valid === false || h.available === true) return false;
      if (h.status && typeof h.status === "string" && NON_HIT_STATUSES.has(h.status.toLowerCase().trim())) return false;
      return true;
    })
    .map((h) => ({
      site: String(h.site ?? h.platform ?? h.name ?? "?").trim(),
      url: sanitizeUrl(h.url),
    }));
}

/**
 * One finished scan per tool → their hits, deduped by site name. Not by url:
 * tools link the same site differently (blackbird often gives an API url).
 */
export function mergeOsintScans(scans: { tool: string; completedAt: Date | string | null; result: unknown }[]): OsintResults {
  const hits = new Map<string, OsintHit>();
  for (const s of scans) {
    for (const h of osintHits(s.result)) {
      const key = h.site.toLowerCase().trim();
      const existing = hits.get(key);
      if (!existing || (!existing.url && h.url)) hits.set(key, h);
    }
  }
  return {
    hits: Array.from(hits.values()),
    runs: scans.map((s) => {
      const d = s.completedAt ? new Date(s.completedAt) : null;
      const valid = d && !isNaN(d.getTime());
      return { tool: s.tool, completedAt: valid ? d.toISOString() : new Date(0).toISOString() };
    }),
  };
}
