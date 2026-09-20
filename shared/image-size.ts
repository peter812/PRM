export type ImageSize = 64 | 128 | 150 | 360 | 480 | 1080 | "max" | "64" | "128" | "150" | "360" | "480" | "1080";

export const ALLOWED_IMAGE_SIZES = new Set(["64", "128", "150", "360", "480", "1080", "max"]);

export function isValidImageSize(size: unknown): size is ImageSize {
  return typeof size === "number" || typeof size === "string" ? ALLOWED_IMAGE_SIZES.has(String(size)) : false;
}

/**
 * Appends or updates the `s=` query parameter on an image URL.
 * Preserves existing query params (e.g. on presigned SigV4 URLs).
 * Non-PRM-S3 URLs (Instagram CDN, external links) are returned unchanged.
 */
export function withImageSize(url: string, size: ImageSize): string;
export function withImageSize(url: string | null | undefined, size: ImageSize): string | undefined;
export function withImageSize(url?: string | null, size: ImageSize = "max"): string | undefined {
  if (!url) return url ?? undefined;
  // Only a proxy path or a presigned PRM-S3 URL understands `?s=`.
  if (!url.includes("/api/prm-s3/") && !url.includes("X-Amz-Signature=")) return url;
  const s = String(size);
  if (/[?&]s=/.test(url)) {
    return url.replace(/([?&]s=)[^&]*/, `$1${s}`);
  }
  return url.includes("?") ? `${url}&s=${s}` : `${url}?s=${s}`;
}
