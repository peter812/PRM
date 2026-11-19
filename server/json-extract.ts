const MAX_JSON_PARSE_ATTEMPTS = 20;

function findBalancedJsonEnd(
  text: string,
  start: number,
  openCode: number,
  closeCode: number,
): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === 0x5c /* '\' */) {
        escaped = true;
      } else if (ch === 0x22 /* '"' */) {
        inString = false;
      }
      continue;
    }
    if (ch === 0x22 /* '"' */) {
      inString = true;
    } else if (ch === openCode) {
      depth++;
    } else if (ch === closeCode) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Scans `candidate` for a balanced `{...}` or `[...]` JSON value in a single pass
 * per candidate start (respecting JSON strings/escapes), capped at
 * `MAX_JSON_PARSE_ATTEMPTS` to prevent quadratic work on malformed inputs.
 */
export function extractBalancedJson(
  candidate: string,
  open: "{" | "[",
  accept?: (parsed: unknown) => boolean,
): unknown {
  const openCode = open.charCodeAt(0);
  const closeCode = open === "{" ? 0x7d /* '}' */ : 0x5d /* ']' */;
  let pos = 0;
  let attempts = 0;

  while (attempts < MAX_JSON_PARSE_ATTEMPTS) {
    const start = candidate.indexOf(open, pos);
    if (start < 0) break;
    attempts++;

    const end = findBalancedJsonEnd(candidate, start, openCode, closeCode);
    if (end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        if (!accept || accept(parsed)) return parsed;
      } catch {
        /* keep looking */
      }
    }
    pos = start + 1;
  }
  return null;
}

// The model sometimes wraps JSON in fences or prose; pull out the first object.
export function extractJsonObject(text: string): unknown {
  if (!text) return null;
  // Strip fenced blocks first.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenceMatch?.[1] ?? text).trim();
  return extractBalancedJson(candidate, "{");
}
