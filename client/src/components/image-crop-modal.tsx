import { useState, useCallback, useRef, useEffect } from "react";
import Cropper, { Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Unlock, Lock } from "lucide-react";

interface ImageCropModalProps {
  open: boolean;
  onClose: () => void;
  imageSrc: string;
  onCropComplete: (croppedImageBlob: Blob) => void;
  aspectRatio?: number;
}

async function getCroppedImage(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Failed to create blob")); return; }
      resolve(blob);
    }, "image/jpeg");
  });
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.setAttribute("crossOrigin", "anonymous");
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", reject);
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// FreeCropArea — resizable crop box with zoom slider; letterbox-safe
// ---------------------------------------------------------------------------

type Handle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w" | "move";
interface Rect { x: number; y: number; w: number; h: number; }

function FreeCropArea({ imageSrc, onCropComplete, onClose }: {
  imageSrc: string;
  onCropComplete: (blob: Blob) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  // rect: normalised to CONTAINER (0–1)
  const [rect, setRect] = useState<Rect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; startRect: Rect } | null>(null);
  const HANDLE_T = 0.025; // threshold for handle hit-test (normalised)
  const MIN = 0.02;

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  };

  // Returns {left,top,scaleW,scaleH} — the zoomed rendered image bounds in
  // container-normalised coords.  scaleW/scaleH are the fraction of the
  // container the zoomed image occupies (can exceed 1 when zoomed in).
  const getImgBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container || !naturalSize) return null;
    const { width: cW, height: cH } = container.getBoundingClientRect();
    if (cW === 0 || cH === 0) return null;
    const { w: nW, h: nH } = naturalSize;
    // base scale: fit image inside container
    const baseScale = Math.min(cW / nW, cH / nH);
    const dW = nW * baseScale * zoom;  // zoomed rendered width  (px)
    const dH = nH * baseScale * zoom;  // zoomed rendered height (px)
    return {
      left:  (cW / 2 - dW / 2) / cW,
      top:   (cH / 2 - dH / 2) / cH,
      right: (cW / 2 + dW / 2) / cW,
      bot:   (cH / 2 + dH / 2) / cH,
      scaleW: dW / cW,
      scaleH: dH / cH,
      cW, cH, nW, nH,
    };
  }, [naturalSize, zoom]);

  // Clamp rect so it stays within the zoomed image bounds
  const clampRect = useCallback((r: Rect): Rect => {
    const b = getImgBounds();
    if (!b) return r;
    let { x, y, w, h } = r;
    w = Math.max(MIN, Math.min(b.scaleW, w));
    h = Math.max(MIN, Math.min(b.scaleH, h));
    x = Math.max(b.left, Math.min(b.right - w, x));
    y = Math.max(b.top,  Math.min(b.bot   - h, y));
    return { x, y, w, h };
  }, [getImgBounds]);

  // Initialise crop box when image loads or zoom changes
  useEffect(() => {
    const b = getImgBounds();
    if (!b) return;
    const margin = 0.05;
    setRect(clampRect({
      x: b.left + margin * b.scaleW,
      y: b.top  + margin * b.scaleH,
      w: b.scaleW * (1 - 2 * margin),
      h: b.scaleH * (1 - 2 * margin),
    }));
  // Only re-init when the image first loads, not on every zoom change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalSize]);

  const toNorm = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { nx: 0, ny: 0 };
    const { left, top, width, height } = el.getBoundingClientRect();
    return { nx: (clientX - left) / width, ny: (clientY - top) / height };
  };

  const hitHandle = (clientX: number, clientY: number): Handle | null => {
    const { nx, ny } = toNorm(clientX, clientY);
    const { x, y, w, h } = rect;
    const T = HANDLE_T;
    const insideX = nx >= x - T && nx <= x + w + T;
    const insideY = ny >= y - T && ny <= y + h + T;
    if (!insideX || !insideY) return null;
    const onL = Math.abs(nx - x)       < T;
    const onR = Math.abs(nx - (x + w)) < T;
    const onT = Math.abs(ny - y)       < T;
    const onB = Math.abs(ny - (y + h)) < T;
    if (onT && onL) return "nw";
    if (onT && onR) return "ne";
    if (onB && onL) return "sw";
    if (onB && onR) return "se";
    if (onT) return "n";
    if (onB) return "s";
    if (onL) return "w";
    if (onR) return "e";
    if (nx >= x && nx <= x + w && ny >= y && ny <= y + h) return "move";
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = hitHandle(e.clientX, e.clientY);
    if (!handle) return;
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, startRect: { ...rect } };
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const { width: cW, height: cH } = container.getBoundingClientRect();
    const { handle, startX, startY, startRect } = dragRef.current;
    const dx = (e.clientX - startX) / cW;
    const dy = (e.clientY - startY) / cH;
    let { x, y, w, h } = startRect;

    if (handle === "move") { x += dx; y += dy; }
    if (handle === "e"  || handle === "ne" || handle === "se") { w += dx; }
    if (handle === "w"  || handle === "nw" || handle === "sw") { const nx = x + dx; w -= (nx - x); x = nx; }
    if (handle === "s"  || handle === "se" || handle === "sw") { h += dy; }
    if (handle === "n"  || handle === "ne" || handle === "nw") { const ny = y + dy; h -= (ny - y); y = ny; }

    setRect(clampRect({ x, y, w, h }));
  }, [clampRect]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const [cursor, setCursor] = useState("default");
  const handleMouseMove = (e: React.MouseEvent) => {
    const h = hitHandle(e.clientX, e.clientY);
    const map: Record<string, string> = {
      nw: "nwse-resize", se: "nwse-resize",
      ne: "nesw-resize", sw: "nesw-resize",
      n: "ns-resize", s: "ns-resize",
      e: "ew-resize", w: "ew-resize",
      move: "move",
    };
    setCursor(h ? (map[h] ?? "default") : "default");
  };

  const handleSave = async () => {
    const b = getImgBounds();
    if (!b) return;
    // Convert container-normalised rect → image-normalised → natural pixels
    const imgX = (rect.x - b.left) / b.scaleW;
    const imgY = (rect.y - b.top)  / b.scaleH;
    const imgW = rect.w / b.scaleW;
    const imgH = rect.h / b.scaleH;
    const pixelCrop: Area = {
      x: Math.max(0, Math.round(imgX * b.nW)),
      y: Math.max(0, Math.round(imgY * b.nH)),
      width:  Math.min(b.nW, Math.round(imgW * b.nW)),
      height: Math.min(b.nH, Math.round(imgH * b.nH)),
    };
    if (pixelCrop.width < 1 || pixelCrop.height < 1) return;
    try {
      const blob = await getCroppedImage(imageSrc, pixelCrop);
      onCropComplete(blob);
      onClose();
    } catch (err) {
      console.error("Error cropping image:", err);
    }
  };

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  const HSIZ = 10; // handle size in px

  const handles: { id: Handle; style: React.CSSProperties }[] = [
    { id: "nw", style: { left: pct(rect.x),           top: pct(rect.y),           cursor: "nwse-resize" } },
    { id: "ne", style: { left: pct(rect.x + rect.w),  top: pct(rect.y),           cursor: "nesw-resize" } },
    { id: "sw", style: { left: pct(rect.x),           top: pct(rect.y + rect.h),  cursor: "nesw-resize" } },
    { id: "se", style: { left: pct(rect.x + rect.w),  top: pct(rect.y + rect.h),  cursor: "nwse-resize" } },
    { id: "n",  style: { left: pct(rect.x + rect.w / 2), top: pct(rect.y),        cursor: "ns-resize"   } },
    { id: "s",  style: { left: pct(rect.x + rect.w / 2), top: pct(rect.y + rect.h), cursor: "ns-resize" } },
    { id: "w",  style: { left: pct(rect.x),           top: pct(rect.y + rect.h / 2), cursor: "ew-resize" } },
    { id: "e",  style: { left: pct(rect.x + rect.w),  top: pct(rect.y + rect.h / 2), cursor: "ew-resize" } },
  ];

  return (
    <>
      {/* Image + crop overlay */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-md bg-black select-none"
        style={{ height: 384, cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={handleMouseMove}
        data-testid="free-crop-container"
      >
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Crop source"
          onLoad={onImgLoad}
          draggable={false}
          className="pointer-events-none absolute inset-0 w-full h-full object-contain"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
        />

        {naturalSize && (
          <>
            {/* Dark overlay with a "hole" cut out for the crop area */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `rgba(0,0,0,0)`,
                boxShadow: "none",
                clipPath: [
                  "polygon(",
                  "0% 0%, 0% 100%, ",
                  `${pct(rect.x)} 100%, `,
                  `${pct(rect.x)} ${pct(rect.y)}, `,
                  `${pct(rect.x + rect.w)} ${pct(rect.y)}, `,
                  `${pct(rect.x + rect.w)} ${pct(rect.y + rect.h)}, `,
                  `${pct(rect.x)} ${pct(rect.y + rect.h)}, `,
                  `${pct(rect.x)} 100%, `,
                  "100% 100%, 100% 0%",
                  ")",
                ].join(""),
                backgroundColor: "rgba(0,0,0,0.55)",
              }}
            />

            {/* Crop border */}
            <div
              className="absolute pointer-events-none border border-white/80"
              style={{
                left: pct(rect.x),
                top: pct(rect.y),
                width: pct(rect.w),
                height: pct(rect.h),
              }}
            />

            {/* Drag handles */}
            {handles.map(({ id, style }) => (
              <div
                key={id}
                className="absolute bg-white border border-gray-400 pointer-events-none"
                style={{
                  ...style,
                  width: HSIZ,
                  height: HSIZ,
                  transform: "translate(-50%, -50%)",
                  borderRadius: 2,
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Zoom slider */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Zoom</label>
        <Slider
          value={[zoom]}
          onValueChange={(v) => setZoom(v[0])}
          min={1}
          max={3}
          step={0.1}
          data-testid="slider-zoom"
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-crop">
          Cancel
        </Button>
        <Button onClick={handleSave} data-testid="button-save-crop">
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// ImageCropModal — fixed-ratio uses react-easy-crop; free uses FreeCropArea
// ---------------------------------------------------------------------------

export function ImageCropModal({
  open,
  onClose,
  imageSrc,
  onCropComplete,
  aspectRatio,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const isFreeAspect = aspectRatio === undefined;

  const onCropChange = useCallback((loc: { x: number; y: number }) => setCrop(loc), []);
  const onCropAreaChange = useCallback((_: Area, pixels: Area) => setCroppedAreaPixels(pixels), []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    try {
      const blob = await getCroppedImage(imageSrc, croppedAreaPixels);
      onCropComplete(blob);
      onClose();
    } catch (err) {
      console.error("Error cropping image:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-image-crop">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Crop Image
            {isFreeAspect ? (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Unlock className="h-3 w-3" />
                Free ratio
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Lock className="h-3 w-3" />
                Fixed ratio
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isFreeAspect ? (
          <FreeCropArea
            imageSrc={imageSrc}
            onCropComplete={onCropComplete}
            onClose={onClose}
          />
        ) : (
          <>
            <div className="relative h-96 bg-muted rounded-md">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspectRatio}
                onCropChange={onCropChange}
                onCropComplete={onCropAreaChange}
                onZoomChange={setZoom}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Zoom</label>
              <Slider
                value={[zoom]}
                onValueChange={(v) => setZoom(v[0])}
                min={1}
                max={3}
                step={0.1}
                data-testid="slider-zoom"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} data-testid="button-cancel-crop">
                Cancel
              </Button>
              <Button onClick={handleSave} data-testid="button-save-crop">
                Save
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
