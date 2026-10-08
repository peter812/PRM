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
  const raw = str instanceof Date ? str.toISOString() : String(str);
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Serialize an array of values into repeated XML elements. */
export function arrayToXml(arr: any[] | null | undefined, itemName: string): string {
  if (!arr || arr.length === 0) return "";
  return arr.map(item => `<${itemName}>${escapeXml(item)}</${itemName}>`).join("");
}

/** Serialize a single optional value into `<name>escaped</name>`, or `""` when empty/null/undefined. */
export function xmlTag(name: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  return `<${name}>${escapeXml(val)}</${name}>`;
}

/** Serialize a JSONB value into `<name>escapedJson</name>`, or `""` when null/undefined. */
export function xmlJsonTag(name: string, val: unknown): string {
  if (val === null || val === undefined) return "";
  return `<${name}>${escapeXml(JSON.stringify(val))}</${name}>`;
}

// ── Parsing / Deserialization ────────────────────────────────────────────────

const singleTagRegexCache = new Map<string, RegExp>();
const multiTagRegexCache = new Map<string, RegExp>();

function getSingleTagRegex(tagName: string): RegExp {
  let regex = singleTagRegexCache.get(tagName);
  if (!regex) {
    regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "s");
    singleTagRegexCache.set(tagName, regex);
  }
  return regex;
}

function getMultiTagRegex(tagName: string): RegExp {
  let regex = multiTagRegexCache.get(tagName);
  if (!regex) {
    regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gs");
    multiTagRegexCache.set(tagName, regex);
  }
  return regex;
}

/**
 * Extract a top-level container section `<tagName>...</tagName>` from an XML document
 * so `parseAllTags` only scans the relevant slice instead of the entire multi-MB string.
 * Falls back to `xml` if the container tag is not present.
 */
export function extractSection(xml: string, tagName: string): string {
  // Fast path for standard 2-space indented top-level sections (avoids matching inner child tags like <notes> or <messages>)
  const indentedOpen = `\n  <${tagName}>`;
  const startIndented = xml.indexOf(indentedOpen);
  if (startIndented !== -1) {
    const contentStart = startIndented + indentedOpen.length;
    const indentedClose = `\n  </${tagName}>`;
    const endIndented = xml.indexOf(indentedClose, contentStart);
    if (endIndented !== -1) {
      return xml.slice(contentStart, endIndented);
    }
    const plainClose = `</${tagName}>`;
    const endPlain = xml.indexOf(plainClose, contentStart);
    if (endPlain !== -1) {
      return xml.slice(contentStart, endPlain);
    }
  }

  // Fallback for unindented XML
  const openTag = `<${tagName}>`;
  const firstIdx = xml.indexOf(openTag);
  if (firstIdx === -1) return xml;

  const matches = parseAllTags(tagName, xml);
  if (matches.length === 0) return xml;
  return matches.length === 1 ? matches[0] : matches.join("\n");
}

/** Extract the text content of the first matching XML tag. */
export function parseXmlTag(tagName: string, text: string): string {
  const match = text.match(getSingleTagRegex(tagName));
  return match ? match[1].trim() : "";
}

/** Extract the text content of every matching XML tag. */
export function parseAllTags(tagName: string, text: string): string[] {
  const matches = text.matchAll(getMultiTagRegex(tagName));
  return Array.from(matches, m => m[1].trim());
}

/** Extract an array of child-tag values from inside a container tag. */
export function parseXmlArray(containerTag: string, itemTag: string, text: string): string[] {
  const containerContent = parseXmlTag(containerTag, text);
  if (!containerContent) return [];
  const matches = containerContent.matchAll(getMultiTagRegex(itemTag));
  return Array.from(matches, m => m[1].trim());
}

/**
 * Decode XML character entities back to their literal characters.
 * Order matters: &amp; is decoded LAST to prevent double-unescaping.
 */
export function unescapeXml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/** Parse an optional string tag; returns null when missing or empty. */
export function parseOptStr(xml: string, tag: string): string | null {
  const raw = unescapeXml(parseXmlTag(tag, xml));
  return raw !== "" ? raw : null;
}

/** Parse an optional integer tag; returns null when missing or NaN. */
export function parseOptInt(xml: string, tag: string): number | null {
  const raw = parseXmlTag(tag, xml);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return !isNaN(n) ? n : null;
}

/** Parse an optional float tag; returns null when missing or NaN. */
export function parseOptFloat(xml: string, tag: string): number | null {
  const raw = parseXmlTag(tag, xml);
  if (!raw) return null;
  const n = parseFloat(raw);
  return !isNaN(n) ? n : null;
}

/** Parse an optional boolean tag; returns `defaultVal` when missing or unrecognized. */
export function parseOptBool(xml: string, tag: string, defaultVal = false): boolean {
  const raw = parseXmlTag(tag, xml).toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return defaultVal;
}

/** Parse an optional Date tag; returns null when missing or invalid Date. */
export function parseOptDate(xml: string, tag: string): Date | null {
  const raw = unescapeXml(parseXmlTag(tag, xml));
  if (!raw) return null;
  const d = new Date(raw);
  return !isNaN(d.getTime()) ? d : null;
}

/** Parse a JSON-encoded tag safely with fallback on missing or invalid JSON. */
export function parseOptJson<T>(xml: string, tag: string, fallback: T): T {
  const raw = unescapeXml(parseXmlTag(tag, xml));
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

