import { z } from "zod";

/**
 * Returns true if the URL is null, undefined, empty, or uses an http:/https: scheme.
 * Rejects javascript:, data:, vbscript:, file:, and other non-HTTP(S) schemes.
 */
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (url === null || url === undefined) return true;
  const trimmed = url.trim();
  if (trimmed === "") return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalizes a nullable/optional URL string: returns null if empty, null, or unsafe,
 * otherwise returns the trimmed URL string (only when http: or https:).
 */
export function sanitizeHttpUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined) return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;
  return isSafeHttpUrl(trimmed) ? trimmed : null;
}

/**
 * Zod schema for an optional/nullable HTTP(S) URL (allows null, undefined, or empty string).
 */
export const optionalHttpUrlSchema = z
  .string()
  .nullable()
  .optional()
  .refine((val) => isSafeHttpUrl(val), {
    message: "URL must use http: or https: scheme",
  });
