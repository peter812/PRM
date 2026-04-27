import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get initials from a name.
 * - Two args (firstName, lastName): returns first char of each
 * - One arg with spaces: returns first char of first two words
 * - One arg without spaces: returns first 2 chars
 */
export function getInitials(firstName: string, lastName?: string): string {
  if (lastName !== undefined) {
    const first = firstName?.[0] ?? "";
    const last = lastName?.[0] ?? "";
    return `${first}${last}`.toUpperCase();
  }
  const name = firstName ?? "";
  const words = name.split(" ").filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

/**
 * Validate a hex color string (3 or 6 digit).
 */
export function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color) || /^#[0-9A-Fa-f]{3}$/.test(color);
}

/**
 * Format a Date to a datetime-local input value string.
 */
export function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Safely parse JSON, returning a fallback value on failure.
 */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
