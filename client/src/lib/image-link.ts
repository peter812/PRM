// Helpers for building links to the /image/:id detail page that preserve
// the originating page so the detail page's back button can return to it.

/** Returns the current path + search string (used as the `from` param value). */
export function currentLocationFrom(): string {
  if (typeof window === "undefined") return "/images";
  return window.location.pathname + window.location.search;
}

/**
 * Build the href to the image detail page for the given photo id, embedding
 * the originating path as the `from` query parameter.
 *
 * @param photoId  The image (photo) UUID.
 * @param fromPath Optional explicit path to use as `from`. Defaults to the
 *                 current browser location.
 */
export function imageDetailHref(photoId: string, fromPath?: string): string {
  const from = fromPath ?? currentLocationFrom();
  return `/image/${photoId}?from=${encodeURIComponent(from)}`;
}
