/**
 * Shared XML helper utilities used by export, import, and social-media routes.
 *
 * Consolidates identical functions that were previously duplicated across
 * server/task-worker.ts, server/routes/social-media.ts, and
 * server/routes/auth-setup.ts.
 */

// ── Escaping / Serialization ─────────────────────────────────────────────────

/** Escape XML special characters. Null/undefined → empty string. */
export function escapeXml(str: any): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Serialize an array of values into repeated XML elements. */
export function arrayToXml(arr: any[], itemName: string): string {
  if (!arr || arr.length === 0) return "";
  return arr.map(item => `<${itemName}>${escapeXml(item)}</${itemName}>`).join("");
}

// ── Parsing / Deserialization ────────────────────────────────────────────────

/** Extract the text content of the first matching XML tag. */
export function parseXmlTag(tagName: string, text: string): string {
  const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "s");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

/** Extract the text content of every matching XML tag. */
export function parseAllTags(tagName: string, text: string): string[] {
  const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gs");
  const matches = text.matchAll(regex);
  return Array.from(matches).map(m => m[1].trim());
}

/** Extract an array of child-tag values from inside a container tag. */
export function parseXmlArray(containerTag: string, itemTag: string, text: string): string[] {
  const containerContent = parseXmlTag(containerTag, text);
  if (!containerContent) return [];
  const itemRegex = new RegExp(`<${itemTag}>(.*?)</${itemTag}>`, "gs");
  const matches = containerContent.matchAll(itemRegex);
  return Array.from(matches).map(m => m[1].trim());
}

/**
 * Decode XML character entities back to their literal characters.
 * Order matters: &amp; is decoded LAST to prevent double-unescaping.
 */
export function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
