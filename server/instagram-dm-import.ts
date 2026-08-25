// Parser for Meta/Instagram data-export DM threads.
//
// An export thread folder looks like:
//   your_instagram_activity/messages/inbox/<username>_<threadId>/
//     message_1.json  (newest messages; Instagram splits at ~10k per file)
//     message_2.json  (older)
//     photos/  videos/  audio/
//
// This module is pure: it takes already-read JSON contents and returns a
// normalized thread. File-system access lives in loadThreadFolder(), used by
// the import task and test scripts.

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ── Types ──

export interface ParsedThread {
  threadId: string;
  username: string;
  title: string | null;
  participants: string[];
  messages: ParsedMessage[]; // ascending by sentAt
  /**
   * SHA-256 over the raw message_N.json contents. Stored on the conversation
   * at import; an identical hash on a later import means nothing changed and the
   * whole thread can be skipped without touching individual messages.
   */
  contentHash: string;
}

export interface ParsedMessage {
  /** "<threadId>:<timestamp_ms>:<senderSlug>[:n]" — unique within the thread */
  externalId: string;
  senderName: string;
  sentAt: Date;
  content: string | null;
  media: ParsedMedia[];
  share?: { link?: string; text?: string };
  reactions: { actor: string; emoji: string }[];
  callDurationSec?: number;
  /** "Liked a message" / "Reacted … to your message" system echoes */
  isSystemNoise: boolean;
}

export interface ParsedMedia {
  kind: "photo" | "video" | "audio";
  /** Relative path inside the export, or an absolute https:// CDN URL */
  uri: string;
  /** Remote CDN URLs in old exports are expired and unrecoverable */
  isRemote: boolean;
  creationTimestamp?: number;
}

// Raw shapes as they appear in message_N.json (only the fields we read)
interface RawMediaItem {
  uri?: string;
  creation_timestamp?: number;
}

interface RawMessage {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  photos?: RawMediaItem[];
  videos?: RawMediaItem[];
  audio_files?: RawMediaItem[];
  sticker?: RawMediaItem;
  share?: { link?: string; share_text?: string };
  reactions?: { reaction?: string; actor?: string }[];
  call_duration?: number;
}

interface RawThreadFile {
  participants?: { name?: string }[];
  messages?: RawMessage[];
  title?: string;
  thread_path?: string;
}

// ── String decoding ──

/**
 * Meta exports store UTF-8 bytes as latin-1 code points ("ðŸ ž"
 * is really 🐞). Re-decode, but leave strings alone when they are plain ASCII,
 * already contain non-latin-1 characters, or would not survive the round trip.
 */
export function decodeMetaString(s: string): string {
  if (!s || typeof s !== "string") return s;
  try {
    const bytes = Buffer.from(s, "latin1");
    const utf8 = bytes.toString("utf8");
    if (!utf8.includes("\uFFFD") && utf8 !== s) {
      return utf8;
    }
  } catch {
    // Return original string on decoding failure
  }
  return s;
}

// ── Folder name ──

/**
 * Parse a Meta export zip/folder name into its parts.
 * "instagram-zeroturnpete-2026-06-29-I5qDTVQw" →
 *   { username: "zeroturnpete", date: "2026-06-29", exportId: "I5qDTVQw" }
 * The username is the ROOT account whose backup this is. Returns null when the
 * name doesn't match the expected shape.
 */
export function parseExportZipName(
  name: string
): { username: string; date: string; exportId: string } | null {
  // Strip a trailing .zip and any directory prefix
  const base = path.basename(name).replace(/\.zip$/i, "");
  // instagram-<username>-<yyyy>-<mm>-<dd>-<exportId>
  // username may contain hyphens/dots; anchor on the date + export id at the end
  const m = base.match(/^instagram-(.+)-(\d{4}-\d{2}-\d{2})-([^-]+)$/);
  if (!m) return null;
  return { username: m[1], date: m[2], exportId: m[3] };
}

/** "laylabug_587235216244212" → { username: "laylabug", threadId: "587235216244212" } */
export function parseThreadFolderName(folder: string): { username: string; threadId: string } {
  const base = path.basename(folder);
  const idx = base.lastIndexOf("_");
  if (idx > 0 && /^\d+$/.test(base.slice(idx + 1))) {
    return { username: base.slice(0, idx), threadId: base.slice(idx + 1) };
  }
  // Group threads and edge cases may not follow the pattern; fall back to the
  // whole name as both username and id so imports still get a stable key.
  return { username: base, threadId: base };
}

// ── Noise detection ──

const NOISE_PATTERNS = [
  /^Liked a message$/,
  /^Reacted .{1,16} to your message\.?$/su,
  /^You unsent a message\.?$/,
  /^.+ unsent a message\.?$/,
];

function isNoiseContent(content: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(content));
}

// ── Main parser ──

function normalizeMedia(kind: ParsedMedia["kind"], items: RawMediaItem[] | undefined): ParsedMedia[] {
  if (!items) return [];
  const out: ParsedMedia[] = [];
  for (const item of items) {
    if (!item?.uri) continue;
    out.push({
      kind,
      uri: item.uri,
      isRemote: /^https?:\/\//i.test(item.uri),
      ...(item.creation_timestamp !== undefined ? { creationTimestamp: item.creation_timestamp } : {}),
    });
  }
  return out;
}

function senderSlug(name: string): string {
  if (!name) return "unknown";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (slug) return slug;
  return crypto.createHash("md5").update(name).digest("hex").slice(0, 8);
}

/**
 * Merge and normalize all message_N.json files of one thread.
 *
 * @param files      contents of every message_N.json in the thread, any order.
 *                   Pass `raw` (the file's exact text) for a stable content hash;
 *                   otherwise the hash falls back to JSON.stringify(json).
 * @param folderName the thread folder name, e.g. "laylabug_587235216244212"
 */
export function parseInstagramThread(
  files: { name: string; json: unknown; raw?: string }[],
  folderName: string,
): ParsedThread {
  const { username, threadId } = parseThreadFolderName(folderName);

  // Content hash: sha256 over each file's raw text, ordered by name so file
  // read order doesn't change the result
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(file.name);
    hash.update("\0");
    hash.update(file.raw ?? JSON.stringify(file.json));
    hash.update("\0");
  }
  const contentHash = hash.digest("hex");

  let title: string | null = null;
  const participants = new Set<string>();
  const raw: RawMessage[] = [];

  for (const file of files) {
    const data = file.json as RawThreadFile;
    if (!data || !Array.isArray(data.messages)) {
      throw new Error(`${file.name}: not a Meta message export (missing messages array)`);
    }
    if (title === null && typeof data.title === "string") {
      title = decodeMetaString(data.title);
    }
    for (const p of data.participants ?? []) {
      if (p?.name) participants.add(decodeMetaString(p.name));
    }
    // Files store messages newest-first; reverse so the stable sort below keeps
    // chronological order for messages sharing a timestamp.
    for (let i = data.messages.length - 1; i >= 0; i--) {
      raw.push(data.messages[i]);
    }
  }

  raw.sort((a, b) => (a.timestamp_ms ?? 0) - (b.timestamp_ms ?? 0));

  const externalIdCounts = new Map<string, number>();
  const messages: ParsedMessage[] = [];

  for (const m of raw) {
    if (typeof m.timestamp_ms !== "number") continue;

    const senderName = decodeMetaString(m.sender_name ?? "Unknown");
    const content = typeof m.content === "string" ? decodeMetaString(m.content) : null;

    const media: ParsedMedia[] = [
      ...normalizeMedia("photo", m.photos),
      ...normalizeMedia("video", m.videos),
      ...normalizeMedia("audio", m.audio_files),
      // Stickers are image files inside the export; treat them as photos
      ...normalizeMedia("photo", m.sticker ? [m.sticker] : undefined),
    ];

    const reactions = (m.reactions ?? [])
      .filter((r) => r?.reaction && r?.actor)
      .map((r) => ({ actor: decodeMetaString(r.actor!), emoji: decodeMetaString(r.reaction!) }));

    const share =
      m.share && (m.share.link || m.share.share_text)
        ? {
            ...(m.share.link ? { link: m.share.link } : {}),
            ...(m.share.share_text ? { text: decodeMetaString(m.share.share_text) } : {}),
          }
        : undefined;

    const baseId = `${threadId}:${m.timestamp_ms}:${senderSlug(senderName)}`;
    const collision = externalIdCounts.get(baseId) ?? 0;
    externalIdCounts.set(baseId, collision + 1);
    const externalId = collision === 0 ? baseId : `${baseId}:${collision}`;

    messages.push({
      externalId,
      senderName,
      sentAt: new Date(m.timestamp_ms),
      content,
      media,
      ...(share ? { share } : {}),
      reactions,
      ...(typeof m.call_duration === "number" ? { callDurationSec: m.call_duration } : {}),
      isSystemNoise: content !== null && media.length === 0 && isNoiseContent(content),
    });
  }

  return {
    threadId,
    username,
    title,
    participants: [...participants],
    messages,
    contentHash,
  };
}

// ── File-system loader (used by the import task and test scripts) ──

/** Read every message_N.json in a thread folder and parse the thread. */
export function loadThreadFolder(folderPath: string): ParsedThread {
  const fileNames = fs
    .readdirSync(folderPath)
    .filter((f) => /^message_\d+\.json$/.test(f));
  if (fileNames.length === 0) {
    throw new Error(`No message_N.json files found in ${folderPath}`);
  }
  const files = fileNames.map((name) => {
    const raw = fs.readFileSync(path.join(folderPath, name), "utf8");
    return { name, raw, json: JSON.parse(raw) };
  });
  return parseInstagramThread(files, path.basename(folderPath));
}
