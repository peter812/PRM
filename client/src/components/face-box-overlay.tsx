import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FaceBox = { x: number; y: number; w: number; h: number };

/** Face colours, indexed by face order in the image. Bright enough to read on any photo in either theme. */
export const FACE_COLORS = ["#f43f5e", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];
export const faceColor = (index: number) => FACE_COLORS[index % FACE_COLORS.length];

export type OverlayFace = {
  key: string;
  box: FaceBox | null;
  color: string;
  /** Number or short name drawn on the box's corner. */
  label?: string;
  /** dashed = needs a decision, solid = named, muted = dismissed or not the face being shown. */
  variant?: "dashed" | "solid" | "muted";
  /** PRM auto-assigned this face at this score and nobody has confirmed it; drawn as an "Auto · 62%" tag. */
  autoScore?: number | null;
};

/**
 * An image with a box drawn around each face. Boxes are in the image's natural
 * pixels (as stored in facial_ids / faces.coordinates), so they're placed as
 * percentages once the natural size is known and scale with the rendered image.
 */
export function FaceBoxOverlay({
  src,
  faces,
  width,
  height,
  onFaceClick,
  onRemove,
  className,
  imgClassName,
}: {
  src: string;
  faces: OverlayFace[];
  /** Original size the boxes were measured against (photos.width_px / height_px); otherwise read on load. */
  width?: number | null;
  height?: number | null;
  onFaceClick?: (key: string) => void;
  /** When set, named (solid) boxes get a ✕ that unlinks the face from its identity. */
  onRemove?: (key: string) => void;
  className?: string;
  imgClassName?: string;
}) {
  // Boxes are in the original image's pixels, so the stored original size wins
  // over the loaded size (src may be a smaller resized variant). Loaded size is
  // only a fallback and is tagged with its src so it never carries over.
  const [loaded, setLoaded] = useState<{ src: string; w: number; h: number } | null>(null);
  const nat = width && height ? { w: width, h: height } : loaded?.src === src ? loaded : null;

  return (
    <div className={cn("relative inline-block", className)}>
      <img
        src={src}
        alt=""
        className={cn("block max-w-full h-auto", imgClassName)}
        onLoad={(e) => setLoaded({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
      {nat &&
        faces.map((f) => {
          if (!f.box) return null;
          const tagColor = f.variant === "muted" ? "rgb(107,114,128)" : f.color;
          return (
            <div
              key={f.key}
              className="absolute"
              style={{
                left: `${(f.box.x / nat.w) * 100}%`,
                top: `${(f.box.y / nat.h) * 100}%`,
                width: `${(f.box.w / nat.w) * 100}%`,
                height: `${(f.box.h / nat.h) * 100}%`,
              }}
            >
              <button
                type="button"
                disabled={!onFaceClick}
                onClick={() => onFaceClick?.(f.key)}
                className={cn("absolute inset-0 rounded-sm border-2", onFaceClick ? "cursor-pointer" : "cursor-default", f.variant === "dashed" && "border-dashed")}
                style={{ borderColor: f.variant === "muted" ? "rgba(156,163,175,0.8)" : f.color, boxShadow: "0 0 0 1px rgba(0,0,0,0.35)" }}
                data-testid={`face-box-${f.key}`}
              />
              {(f.label || f.autoScore != null) && (
                <span
                  className="pointer-events-none absolute -top-5 left-0 px-1 text-[11px] font-semibold leading-4 text-white rounded-sm whitespace-nowrap"
                  style={{ backgroundColor: tagColor }}
                >
                  {f.label}
                  {f.autoScore != null && <span className="font-normal opacity-90">{f.label ? " · " : ""}Auto {Math.round(f.autoScore * 100)}%</span>}
                </span>
              )}
              {onRemove && f.variant === "solid" && (
                <button
                  type="button"
                  onClick={() => onRemove(f.key)}
                  className="absolute -top-2.5 -right-2.5 h-5 w-5 rounded-full flex items-center justify-center text-white shadow ring-1 ring-black/30 hover:scale-110 transition-transform"
                  style={{ backgroundColor: tagColor }}
                  title="Not them: remove this name from the face"
                  aria-label="Remove name from this face"
                  data-testid={`button-remove-face-${f.key}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
    </div>
  );
}
