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
 * Byte range of a top-level container section `<tagName>...</tagName>` in an XML document,
 * or null when the container is not present.
 *
 * Works on the raw Buffer because a full backup can be larger than V8's maximum string
 * length (~512 MB), so the document is never decoded as one string.
 */
function findSectionRange(xml: Buffer, tagName: string): [number, number] | null {
  // Fast path for standard 2-space indented top-level sections (avoids matching inner child tags like <notes> or <messages>)
  const indentedOpen = `\n  <${tagName}>`;
  const startIndented = xml.indexOf(indentedOpen);
  if (startIndented !== -1) {
    const contentStart = startIndented + Buffer.byteLength(indentedOpen);
    const endIndented = xml.indexOf(`\n  </${tagName}>`, contentStart);
    if (endIndented !== -1) return [contentStart, endIndented];
    const endPlain = xml.indexOf(`</${tagName}>`, contentStart);
    if (endPlain !== -1) return [contentStart, endPlain];
  }

  // Fallback for unindented XML
  const openTag = `<${tagName}>`;
  const firstIdx = xml.indexOf(openTag);
  if (firstIdx === -1) return null;
  const contentStart = firstIdx + Buffer.byteLength(openTag);
  const end = xml.indexOf(`</${tagName}>`, contentStart);
  return end === -1 ? null : [contentStart, end];
}

/** Decoded content of a top-level container section, or `""` when it is not present. */
export function extractSection(xml: Buffer, tagName: string): string {
  const range = findSectionRange(xml, tagName);
  return range ? xml.toString("utf8", range[0], range[1]) : "";
}

/**
 * Yield the trimmed content of every `<entryTag>...</entryTag>` inside a top-level section,
 * decoding one entry at a time so a section larger than the max string length still imports.
 * Scans the whole document when the section container is missing.
 */
export function* sectionEntries(xml: Buffer, sectionTag: string, entryTag: string): Generator<string> {
  const [start, end] = findSectionRange(xml, sectionTag) ?? [0, xml.length];
  const openTag = `<${entryTag}>`;
  const closeTag = `</${entryTag}>`;
  const openLen = Buffer.byteLength(openTag);
  const closeLen = Buffer.byteLength(closeTag);
  let pos = start;
  while (pos < end) {
    const open = xml.indexOf(openTag, pos);
    if (open === -1 || open >= end) return;
    const close = xml.indexOf(closeTag, open + openLen);
    if (close === -1 || close > end) return;
    yield xml.toString("utf8", open + openLen, close).trim();
    pos = close + closeLen;
  }
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

