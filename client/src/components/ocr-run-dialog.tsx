import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ScanText, X } from "lucide-react";
import { format } from "date-fns";

export type OcrLine = {
  text: string;
  score: number;
  box: number[][]; // [[x, y] * 4] in pixel coordinates
};

export type OcrData = {
  text: string;
  lines: OcrLine[];
  width: number;
  height: number;
  model?: string;
};

export function isOcrData(v: unknown): v is OcrData {
  return !!v && typeof v === "object" && Array.isArray((v as OcrData).lines);
}

interface OcrRunDialogProps {
  open: boolean;
  onClose: () => void;
  photo: { id: string; imageUrl: string; ocrData?: unknown; ocrAt?: string | Date | null };
}

// Bounding box of a quad/polygon as percentages of the natural image size.
function pctBox(box: number[][], w: number, h: number) {
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    left: `${(minX / w) * 100}%`,
    top: `${(minY / h) * 100}%`,
    width: `${((Math.max(...xs) - minX) / w) * 100}%`,
    height: `${((Math.max(...ys) - minY) / h) * 100}%`,
  };
}

export function OcrRunDialog({ open, onClose, photo }: OcrRunDialogProps) {
  const { toast } = useToast();
  const imgRef = useRef<HTMLImageElement>(null);
  const existing = isOcrData(photo.ocrData) ? photo.ocrData : null;

  const [minScore, setMinScore] = useState(0.5);
  const [result, setResult] = useState<OcrData | null>(existing);
  const [hovered, setHovered] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (open) {
      setResult(existing);
      setHovered(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/photos/${photo.id}/run-ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ min_score: minScore }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error || `Server returned ${res.status}`);
      }
      return res.json() as Promise<OcrData>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: "OCR Complete",
        description: data.lines.length === 0
          ? "No text lines met the confidence threshold."
          : `Identified ${data.lines.length} text line${data.lines.length === 1 ? "" : "s"}.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "OCR Failed", description: err.message, variant: "destructive" });
    },
  });

  const isRunning = runMutation.isPending;
  // Overlay coordinates come from the OCR run's own image size, falling back to the rendered image.
  const overlaySize = result ? { w: result.width, h: result.height } : naturalSize;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isRunning) onClose(); }}>
      <DialogContent className="max-w-4xl w-full max-h-[90vh] flex flex-col p-0 gap-0" hideCloseButton>
        <DialogHeader className="p-6 pb-4 border-b shrink-0 flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-xl font-semibold flex items-center gap-2">
              <ScanText className="h-5 w-5" />
              {existing ? "Re-run OCR" : "Run OCR"}
            </DialogTitle>
            <DialogDescription>
              {existing && photo.ocrAt
                ? `Last run ${format(new Date(photo.ocrAt), "MMM d, yyyy HH:mm:ss")}. Re-running replaces the stored result.`
                : "Extract text from this image with PRM-Compute."}
            </DialogDescription>
          </div>
          {!isRunning && (
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
              <X className="h-4 w-4" />
            </Button>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="relative bg-black/5 rounded-lg overflow-hidden self-start">
            <img
              ref={imgRef}
              src={photo.imageUrl}
              alt="OCR source"
              className="w-full h-auto block"
              onLoad={() => {
                if (imgRef.current) setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
              }}
            />
            {isRunning && (
              <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            )}
            {result && overlaySize && result.lines.map((line, i) => (
              <div
                key={i}
                className={
                  "absolute border-2 rounded-sm transition-colors " +
                  (hovered === i ? "border-primary bg-primary/20" : "border-yellow-400/80")
                }
                style={pctBox(line.box, overlaySize.w, overlaySize.h)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                title={line.text}
              />
            ))}
          </div>

          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="ocr-min-score" className="text-xs">Min confidence (0–1)</Label>
                <Input
                  id="ocr-min-score"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minScore}
                  onChange={(e) => setMinScore(Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
                  disabled={isRunning}
                  data-testid="input-ocr-min-score"
                />
              </div>
              <Button onClick={() => runMutation.mutate()} disabled={isRunning} data-testid="btn-run-ocr">
                {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ScanText className="h-4 w-4 mr-2" />}
                {result ? "Re-run OCR" : "Run OCR"}
              </Button>
            </div>

            {result ? (
              <>
                <div className="text-xs text-muted-foreground" data-testid="text-ocr-summary">
                  {result.lines.length} line{result.lines.length === 1 ? "" : "s"}
                  {result.model ? ` · ${result.model}` : ""} · {result.width}×{result.height}px
                </div>
                {result.lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No text detected.</p>
                ) : (
                  <ul className="space-y-1.5" data-testid="list-ocr-lines">
                    {result.lines.map((line, i) => (
                      <li
                        key={i}
                        className={
                          "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm cursor-default " +
                          (hovered === i ? "border-primary bg-primary/10" : "")
                        }
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <span className="flex-1 break-words">{line.text}</span>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5">
                          {(line.score * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">OCR has not been run on this image.</p>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 border-t shrink-0 sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={isRunning}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
