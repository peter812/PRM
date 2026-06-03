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
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move" | null;

interface Rect { x: number; y: number; w: number; h: number; }

function FreeCropArea({
  imageSrc,
  onCropComplete,
  onClose,
}: {
  imageSrc: string;
  onCropComplete: (blob: Blob) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; startRect: Rect } | null>(null);
  const MIN = 0.05;

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const toNorm = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { nx: 0, ny: 0 };
    const { left, top, width, height } = el.getBoundingClientRect();
    return { nx: (clientX - left) / width, ny: (clientY - top) / height };
  };

  const getHandle = (clientX: number, clientY: number): Handle => {
    const { nx, ny } = toNorm(clientX, clientY);
    const { x, y, w, h } = rect;
    const T = 0.03;
    const inX = nx >= x - T && nx <= x + w + T;
    const inY = ny >= y - T && ny <= y + h + T;
    if (!inX || !inY) return null;
    const onLeft = Math.abs(nx - x) < T;
    const onRight = Math.abs(nx - (x + w)) < T;
    const onTop = Math.abs(ny - y) < T;
    const onBottom = Math.abs(ny - (y + h)) < T;
    if (onTop && onLeft) return "nw";
    if (onTop && onRight) return "ne";
    if (onBottom && onLeft) return "sw";
    if (onBottom && onRight) return "se";
    if (onTop) return "n";
    if (onBottom) return "s";
    if (onLeft) return "w";
    if (onRight) return "e";
    if (nx >= x && nx <= x + w && ny >= y && ny <= y + h) return "move";
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = getHandle(e.clientX, e.clientY);
    if (!handle) return;
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, startRect: { ...rect } };
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const { handle, startX, startY, startRect } = dragRef.current;
    const dx = (e.clientX - startX) / width;
    const dy = (e.clientY - startY) / height;
    let { x, y, w, h } = startRect;

    if (handle === "move") {
      x = Math.max(0, Math.min(1 - w, x + dx));
      y = Math.max(0, Math.min(1 - h, y + dy));
    }
    if (handle === "e" || handle === "ne" || handle === "se") {
      w = Math.max(MIN, Math.min(1 - x, w + dx));
    }
    if (handle === "w" || handle === "nw" || handle === "sw") {
      const newX = Math.max(0, Math.min(x + w - MIN, x + dx));
      w = w + (x - newX);
      x = newX;
    }
    if (handle === "s" || handle === "se" || handle === "sw") {
      h = Math.max(MIN, Math.min(1 - y, h + dy));
    }
    if (handle === "n" || handle === "ne" || handle === "nw") {
      const newY = Math.max(0, Math.min(y + h - MIN, y + dy));
      h = h + (y - newY);
      y = newY;
    }
    setRect({ x, y, w, h });
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const getCursor = (e: React.MouseEvent): string => {
    const h = getHandle(e.clientX, e.clientY);
    if (!h) return "default";
    if (h === "move") return "move";
    if (h === "n" || h === "s") return "ns-resize";
    if (h === "e" || h === "w") return "ew-resize";
    if (h === "ne" || h === "sw") return "nesw-resize";
    if (h === "nw" || h === "se") return "nwse-resize";
    return "default";
  };

  const [cursor, setCursor] = useState("default");

  const handleSave = async () => {
    if (!imgNaturalSize) return;
    const { w: nw, h: nh } = imgNaturalSize;
    const pixelCrop: Area = {
      x: Math.round(rect.x * nw),
      y: Math.round(rect.y * nh),
      width: Math.round(rect.w * nw),
      height: Math.round(rect.h * nh),
    };
    try {
      const blob = await getCroppedImage(imageSrc, pixelCrop);
      onCropComplete(blob);
      onClose();
    } catch (err) {
      console.error("Error cropping image:", err);
    }
  };

  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const HANDLE_SIZE = 10;
  const handles: { id: Handle; style: React.CSSProperties }[] = [
    { id: "nw", style: { left: pct(rect.x), top: pct(rect.y), cursor: "nwse-resize" } },
    { id: "ne", style: { left: pct(rect.x + rect.w), top: pct(rect.y), cursor: "nesw-resize" } },
    { id: "sw", style: { left: pct(rect.x), top: pct(rect.y + rect.h), cursor: "nesw-resize" } },
    { id: "se", style: { left: pct(rect.x + rect.w), top: pct(rect.y + rect.h), cursor: "nwse-resize" } },
    { id: "n", style: { left: pct(rect.x + rect.w / 2), top: pct(rect.y), cursor: "ns-resize" } },
    { id: "s", style: { left: pct(rect.x + rect.w / 2), top: pct(rect.y + rect.h), cursor: "ns-resize" } },
    { id: "w", style: { left: pct(rect.x), top: pct(rect.y + rect.h / 2), cursor: "ew-resize" } },
    { id: "e", style: { left: pct(rect.x + rect.w), top: pct(rect.y + rect.h / 2), cursor: "ew-resize" } },
  ];

  return (
    <>
      <div
        ref={containerRef}
        className="relative select-none overflow-hidden rounded-md bg-black"
        style={{ cursor, touchAction: "none" }}
        onMouseDown={onMouseDown}
        onMouseMove={(e) => setCursor(getCursor(e))}
      >
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Crop source"
          onLoad={onImgLoad}
          className="block w-full max-h-96 object-contain pointer-events-none"
          draggable={false}
        />
        {imgNaturalSize && (
          <>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow: `0 0 0 9999px rgba(0,0,0,0.55)`,
                clipPath: `polygon(0% 0%, 0% 100%, ${pct(rect.x)} 100%, ${pct(rect.x)} ${pct(rect.y)}, ${pct(rect.x + rect.w)} ${pct(rect.y)}, ${pct(rect.x + rect.w)} ${pct(rect.y + rect.h)}, ${pct(rect.x)} ${pct(rect.y + rect.h)}, ${pct(rect.x)} 100%, 100% 100%, 100% 0%)`,
              }}
            />
            <div
              className="absolute pointer-events-none border border-white/80"
              style={{
                left: pct(rect.x),
                top: pct(rect.y),
                width: pct(rect.w),
                height: pct(rect.h),
              }}
            />
            {handles.map(({ id, style }) => (
              <div
                key={id}
                className="absolute bg-white border border-gray-400 pointer-events-none"
                style={{
                  ...style,
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  transform: "translate(-50%, -50%)",
                  borderRadius: 2,
                }}
              />
            ))}
          </>
        )}
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

  const onCropChange = useCallback((location: { x: number; y: number }) => {
    setCrop(location);
  }, []);

  const onCropAreaChange = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    try {
      const blob = await getCroppedImage(imageSrc, croppedAreaPixels);
      onCropComplete(blob);
      onClose();
    } catch (error) {
      console.error("Error cropping image:", error);
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
                onValueChange={(value) => setZoom(value[0])}
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
