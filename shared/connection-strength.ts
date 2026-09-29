// Connection strength between two Instagram accounts (connection-strength-plan.md).
// The one place the math lives: the server scores with it and the Connections
// tab draws each row's running-strength graph with it, so the two always agree.

export const CONNECTION_STRENGTH_KEY = "connection_strength";

export type ConnectionKind = "comment" | "story_mention" | "post_mention" | "bio";
export const CONNECTION_KINDS: ConnectionKind[] = ["comment", "story_mention", "post_mention", "bio"];

export type ConnectionWeights = Record<ConnectionKind, number> & { heartMultiplier: number };

export const DEFAULT_CONNECTION_WEIGHTS: ConnectionWeights = {
  comment: 5,
  story_mention: 5,
  post_mention: 5,
  bio: 5,
  heartMultiplier: 2,
};

/** The stored app setting, with defaults for anything missing or malformed. */
export function parseConnectionWeights(raw: string | null | undefined): ConnectionWeights {
  let stored: Record<string, unknown> = {};
  try {
    stored = raw ? JSON.parse(raw) : {};
  } catch {}
  const out = { ...DEFAULT_CONNECTION_WEIGHTS };
  for (const key of Object.keys(out) as (keyof ConnectionWeights)[]) {
    const v = stored[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

export type ConnectionEvent = {
  at: string; // ISO; for a bio mention, when the handle first appeared
  kind: ConnectionKind;
  dir: "in" | "out"; // out = the viewed account did it to the other one
  heart?: boolean; // bio only: a heart emoji sits next to the handle
  removedAt?: string; // bio only: when the handle left the bio; absent while it's still there
};

const DAY_MS = 86_400_000;
const FLOOR_AFTER_DAYS = 730;

/** 1 today, falling in a straight line to 0.5 at two years, and 0.5 forever after. */
export function decayFactor(ageDays: number): number {
  return Math.max(0.5, 1 - Math.max(0, ageDays) / (2 * FLOOR_AFTER_DAYS));
}

/** What one event is worth as of `now` (0 before it happened). */
export function eventValue(e: ConnectionEvent, weights: ConnectionWeights, now: number): number {
  const at = Date.parse(e.at);
  if (at > now) return 0;
  let weight = weights[e.kind];
  let since = at;
  if (e.kind === "bio") {
    if (e.heart) weight *= weights.heartMultiplier;
    // A bio mention counts in full while it's there and ages from the day it came down.
    const removed = e.removedAt ? Date.parse(e.removedAt) : null;
    since = removed !== null && removed <= now ? removed : now;
  }
  return weight * decayFactor((now - since) / DAY_MS);
}

export function scoreAt(events: ConnectionEvent[], weights: ConnectionWeights, now: number): number {
  let total = 0;
  for (const e of events) total += eventValue(e, weights, now);
  return total;
}

// Instagram handles: letters, digits, dots, underscores, up to 30. The lookbehind
// keeps the domain of an email address (name@gmail.com) from reading as a handle.
const HANDLE_RE = /(?<![\w.])@([A-Za-z0-9._]{1,30})/g;
// Every heart but the broken one (U+1F494).
const HEART_RE = /[❤♥\u{1F493}\u{1F495}-\u{1F49F}\u{1F5A4}\u{1F90D}\u{1F90E}\u{1F9E1}\u{1FA75}-\u{1FA77}]/u;
const HEART_WINDOW = 6; // UTF-16 units either side of the handle: room for a space and an emoji or two

/** Lower-cased @handles in a caption or bio, each with whether a heart sits beside it. */
export function extractHandles(text: string | null | undefined): Map<string, { heart: boolean }> {
  const out = new Map<string, { heart: boolean }>();
  if (!text) return out;
  for (const m of text.matchAll(HANDLE_RE)) {
    const handle = m[1].replace(/\.+$/, "").toLowerCase();
    if (!handle) continue;
    const start = m.index!;
    const end = start + m[0].length;
    const around = text.slice(Math.max(0, start - HEART_WINDOW), start) + text.slice(end, end + HEART_WINDOW);
    const heart = HEART_RE.test(around);
    out.set(handle, { heart: heart || out.get(handle)?.heart || false });
  }
  return out;
}
