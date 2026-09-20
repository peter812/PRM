const STORAGE_KEY = "prm_return_to";

/**
 * Checks if a given pathname represents a protected non-home page.
 * Home pages ("/", "/home") and auth/onboarding pages ("/auth", "/auth-direct", "/welcome")
 * do not qualify as non-home destinations.
 */
export function isNonHomePage(pathname: string): boolean {
  if (!pathname) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (
    normalized === "" ||
    normalized === "/" ||
    normalized === "/home" ||
    normalized.startsWith("/auth") ||
    normalized.startsWith("/welcome")
  ) {
    return false;
  }
  return true;
}

/**
 * Validates and sanitizes a returnTo URL to prevent open redirect vulnerabilities.
 * Returns the sanitized relative URL path (including query string and hash) if valid, or null.
 */
export function sanitizeReturnTo(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  // Must begin with a single slash, not protocol-relative (//) or backslash escape (/\)
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return null;
  }

  try {
    const dummyBase = "http://dummy.local";
    const parsed = new URL(trimmed, dummyBase);

    // Verify it stays on the dummy host without scheme trickery
    if (parsed.origin !== dummyBase) {
      return null;
    }

    if (!isNonHomePage(parsed.pathname)) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/**
 * Resolves a safe redirect destination, checking URL search parameters first
 * and falling back to sessionStorage.
 */
export function getSafeReturnTo(urlParam?: string | null): string | null {
  const fromParam = sanitizeReturnTo(urlParam);
  if (fromParam) return fromParam;

  if (typeof window !== "undefined") {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      const fromStorage = sanitizeReturnTo(stored);
      if (fromStorage) return fromStorage;
    } catch {}
  }

  return null;
}

/**
 * Stores the target path in sessionStorage if it is a valid non-home destination.
 */
export function setStoredReturnTo(url: string): void {
  const sanitized = sanitizeReturnTo(url);
  if (sanitized && typeof window !== "undefined") {
    try {
      sessionStorage.setItem(STORAGE_KEY, sanitized);
    } catch {}
  }
}

/**
 * Clears the stored return destination from sessionStorage.
 */
export function clearStoredReturnTo(): void {
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}
