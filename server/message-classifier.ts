/**
 * Classifies imported message text as machine-sent noise so imports can skip
 * it. Pure, platform-agnostic: used by both the SMS and Instagram importers.
 *
 * A message is only tagged when it looks like it came from a system, not a
 * person. Tier keywords alone are not enough ("did your package arrive?" is a
 * friend, not a courier); shipping/transactional/promotional need a keyword
 * plus a sender marker (opt-out boilerplate, a link, or a "BRAND:" prefix).
 */

export type AutomatedCategory =
  | "security_code"
  | "shipping"
  | "transactional"
  | "promotional"
  | "system_noise";

/** Platform echoes that carry no content of their own */
const SYSTEM_NOISE = [
  /^Liked a message$/,
  /^Reacted .{1,16} to your message\.?$/su,
  /^You unsent a message\.?$/,
  /^.+ unsent a message\.?$/,
  // iMessage tapbacks arrive over MMS as `Loved “…”`
  /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned) [“"].*[”"]$/s,
];

// Account-safety alerts are never dropped, even when they carry a code
const CRITICAL =
  /\b(unusual|suspicious) (activity|login|sign[- ]?in)|wasn'?t you|not you\b|password (has been|was) (changed|reset)|fraud|unauthori[sz]ed|account (is |has been )?locked\b/i;

const SECURITY_KEYWORD =
  /\b(verification|security|login|sign[- ]?in|authentication|one[- ]?time|confirmation|access) (code|pin)\b|\b(otp|passcode)\b|confirm your identity/i;
const CODE = /\b\d{4,8}\b/;
const NO_SHARE = /\b(do not|don'?t|never) share\b/i;
const CODE_EXPIRES = /\b(expires?|valid for)\b/i;

const TIERS: Array<[Exclude<AutomatedCategory, "security_code" | "system_noise">, RegExp]> = [
  [
    "shipping",
    /\b(out for delivery|delivered|shipment|shipping update|has shipped|tracking( number| id)?|package|parcel|arriving (today|tomorrow)|delivery attempted|signature required|(ready for|is ready for) pickup|pickup ready|estimated delivery)\b/i,
  ],
  [
    "transactional",
    /\b(order (confirmed|shipped|received)|purchase confirmation|your receipt|payment (received|confirmation|due)|subscription renewal|appointment (reminder|confirmed)|reservation confirmed|table is confirmed|invoice|statement (is )?available|due to be filled)\b/i,
  ],
  [
    "promotional",
    /\b(limited time|exclusive offer|special offer|sale ends|save \d+%|coupon|promo code|donate|survey|win \$?\d|drawing to win|register (here|now|by))\b/i,
  ],
];

/** Boilerplate only bulk senders produce */
const SENDER_MARKERS = [
  /\breply (help|stop|yes|y)\b|\b(stop|end) to (cancel|end|opt[- ]?out|unsubscribe)\b|\bopt[- ]?out\b|\bunsubscribe\b/i,
  /msg ?& ?data rates/i,
  /https?:\/\/\S+/i,
  // "ACCREDO: Your order…" / "From EWU - …"
  /^(from )?[A-Z][A-Z0-9&'. -]{2,}[:-]\s/,
];

export function classifyMessage(content: string): AutomatedCategory | null {
  const text = content.trim();
  if (!text) return null;

  if (SYSTEM_NOISE.some((re) => re.test(text))) return "system_noise";
  if (CRITICAL.test(text)) return null;

  if (CODE.test(text) && (SECURITY_KEYWORD.test(text) || CODE_EXPIRES.test(text) || NO_SHARE.test(text))) {
    return "security_code";
  }

  const markers = SENDER_MARKERS.filter((re) => re.test(text)).length;
  for (const [category, keyword] of TIERS) {
    if (markers > 0 && keyword.test(text)) return category;
  }
  // No tier keyword but unmistakably bulk-sent (e.g. "Reply STOP … Msg&data rates")
  return markers >= 2 ? "promotional" : null;
}
