/** A face box in the image's natural pixels (facial_ids / faces.coordinates). */
export type FaceBox = { x: number; y: number; w: number; h: number };

/** Smallest side, in natural pixels, of a face box the user can draw. */
export const MIN_DRAWN_FACE_PX = 24;

/** A drawn box overlapping an existing face by more than this (IoU) is that face. */
export const DRAWN_FACE_MAX_IOU = 0.5;

/** Intersection over union of two boxes (0 = apart, 1 = identical). */
export function boxIou(a: FaceBox, b: FaceBox): number {
  const iw = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = iw * ih;
  return inter ? inter / (a.w * a.h + b.w * b.h - inter) : 0;
}
