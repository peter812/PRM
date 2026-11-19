/**
 * Validates a URL for safe use in href bindings and window.open calls.
 * Allows only http: and https: schemes (plus relative `/` paths—not `//`—when
 * `allowRelative` is true), returning `undefined` for anything else (including
 * `javascript:`, `data:`, `vbscript:`, etc.).
 */
export function safeUrl(
  url: string | null | undefined,
  opts?: { allowRelative?: boolean },
): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";

  if (trimmed.startsWith("/")) {
    if (!opts?.allowRelative || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
      return undefined;
    }
    try {
      const parsed = new URL(trimmed, origin);
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.origin === origin
      ) {
        return trimmed;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  try {
    const parsed = new URL(trimmed, origin);
    // Only allow explicit http:/https: URLs (rejects relative strings without leading `/`)
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ) {
      return trimmed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
