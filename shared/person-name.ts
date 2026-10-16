/**
 * Display name for a person. A nickname trumps the first name, keeping the
 * first name in parentheses: "Bob (Robert) Smith". Without one (or when it
 * equals the first name): "Robert Smith".
 *
 * PRM-chrome's content/truepeoplesearch.js keeps a copy — keep the two in step.
 */
export type NameParts = {
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  maidenName?: string | null;
};

const clean = (s: string | null | undefined) => (s ?? "").trim();

function effectiveNickname(p: NameParts): string {
  const nick = clean(p.nickname);
  return nick && nick.toLowerCase() !== clean(p.firstName).toLowerCase() ? nick : "";
}

export function formatPersonName(p: NameParts | null | undefined): string {
  if (!p) return "";
  const first = clean(p.firstName);
  const nick = effectiveNickname(p);
  const given = nick ? (first ? `${nick} (${first})` : nick) : first;
  return [given, clean(p.lastName)].filter(Boolean).join(" ");
}

/** Avatar initials — the nickname's initial stands in for the first name's. */
export function personInitials(p: NameParts | null | undefined): string {
  if (!p) return "";
  const given = effectiveNickname(p) || clean(p.firstName);
  return `${given.charAt(0)}${clean(p.lastName).charAt(0)}`.toUpperCase();
}

/**
 * Text for client-side name filtering: "first last", plus "nick last" and
 * "first maiden" when set, so any of those phrasings matches.
 */
export function personSearchText(p: NameParts | null | undefined): string {
  if (!p) return "";
  const first = clean(p.firstName);
  const last = clean(p.lastName);
  const nick = clean(p.nickname);
  const maiden = clean(p.maidenName);
  return [
    `${first} ${last}`,
    nick && `${nick} ${last}`,
    maiden && `${first} ${maiden}`,
  ].filter(Boolean).join(" ").trim();
}
