import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScanFace, Upload, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type FaceBox = { x: number; y: number; w: number; h: number };
type FaceMatch = { personface_uuid?: string; person_name?: string | null; confidence_score?: number };
type FaceResult = {
  face_index?: number;
  box?: FaceBox;
  detection_confidence?: number;
  yaw?: number | null;
  pitch?: number | null;
  roll?: number | null;
  landmarks?: [number, number][] | null;
  person_name?: string | null;
  matches?: FaceMatch[];
};
type PrmFaceSettings = { apiUrl: string; hasApiKey: boolean };
type FaceConfig = { exclude_profile_faces?: boolean; max_yaw?: number };

const DEFAULT_MAX_YAW = 60;

// Oval around a detected face: padded so the face sits comfortably inside, narrowed as the head
// turns (yaw), shortened as it nods (pitch) and rotated with the head tilt (roll). Foreshortening
// is softened (0.6 + 0.4·cos) so a profile face still gets a usable oval.
function realisticOval(box: FaceBox, yaw?: number | null, pitch?: number | null, roll?: number | null) {
  const PAD_X = 1.12;
  const PAD_Y = 1.25;
  const squash = (deg?: number | null) => 0.6 + 0.4 * Math.cos(((deg ?? 0) * Math.PI) / 180);
  return {
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2,
    rx: (box.w / 2) * PAD_X * squash(yaw),
    ry: (box.h / 2) * PAD_Y * squash(pitch),
    rotate: roll ?? 0,
  };
}

export default function FacePoseDemoPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [faces, setFaces] = useState<FaceResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [maxYaw, setMaxYaw] = useState(DEFAULT_MAX_YAW);
  const [realisticBounds, setRealisticBounds] = useState(false);

  const { data: settings } = useQuery<PrmFaceSettings>({ queryKey: ["/api/prm-face/settings"] });
  const isConfigured = !!(settings?.apiUrl && settings?.hasApiKey);
  const { data: config } = useQuery<FaceConfig>({ queryKey: ["/api/prm-face/config"], enabled: isConfigured });
  const exclusionOn = config?.exclude_profile_faces ?? false;
  useEffect(() => { if (config?.max_yaw) setMaxYaw(config.max_yaw); }, [config?.max_yaw]);

  // onLoad does not fire again when the same image is re-uploaded, so also read the size once results arrive.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, [imageDataUrl, faces]);

  const isExcluded = (f: FaceResult) => f.yaw != null && Math.abs(f.yaw) >= maxYaw;

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
        return;
      }
      const reader = new FileReader();
      reader.onload = async (e) => {
        setImageDataUrl(e.target?.result as string);
        setFaces([]);
        setIsProcessing(true);
        try {
          const formData = new FormData();
          formData.append("image", file);
          const res = await fetch("/api/prm-face/pickout-temp", { method: "POST", body: formData, credentials: "include" });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(err.error || `Server error ${res.status}`);
          }
          const data: { faces: FaceResult[] } = await res.json();
          setFaces(data.faces || []);
          if (!data.faces?.some((f) => f.yaw != null)) {
            toast({ title: "No pose data", description: "PRM Compute returned no yaw. Is it updated and restarted?" });
          }
        } catch (err: any) {
          toast({ title: "Detection failed", description: err.message, variant: "destructive" });
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [toast],
  );

  const signed = (v?: number | null) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v}°`);
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const excludedCount = faces.filter(isExcluded).length;

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-full md:max-w-4xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-face-pose-title">
            <ScanFace className="h-6 w-6" />
            Face Pose Demo
          </h1>
          <p className="text-muted-foreground">
            Face recognition with head-pose estimation. Yaw (turn), pitch (nod, rough) and roll (tilt) are estimated from the five detector landmarks (eyes, nose,
            mouth corners). Faces turned {maxYaw}° or more are marked as excluded
            {exclusionOn ? " and skipped by recognition" : " (the filter is off in Settings → Recognition, so they are still matched)"}. Nothing is stored.
          </p>
        </div>

        {!isConfigured && (
          <div className="flex items-start gap-3 rounded-md bg-muted p-4 mb-6 text-sm" data-testid="text-not-configured">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <span className="text-muted-foreground">
              PRM Compute is not configured yet. Set it up in{" "}
              <a href="/settings/recognition" className="underline underline-offset-2">Settings → Recognition</a>.
            </span>
          </div>
        )}

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Upload Image</CardTitle>
              <CardDescription>Drop an image or click to choose one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className="border-2 border-dashed rounded-md p-8 flex flex-col items-center gap-4 cursor-pointer transition-colors hover:border-primary/50"
                onClick={() => fileInputRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                onDragOver={(e) => e.preventDefault()}
                data-testid="dropzone-image"
              >
                <Upload className="h-10 w-10 text-muted-foreground" />
                <Button
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  disabled={!isConfigured || isProcessing}
                  data-testid="button-select-image"
                >
                  {isProcessing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Detecting…</>) : "Select Image"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                  disabled={!isConfigured || isProcessing}
                  data-testid="input-image-file"
                />
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="max-yaw" className="whitespace-nowrap">Exclude at yaw ≥</Label>
                <Input
                  id="max-yaw"
                  type="number"
                  min={10}
                  max={90}
                  value={maxYaw}
                  onChange={(e) => setMaxYaw(Math.min(90, Math.max(10, Number(e.target.value) || DEFAULT_MAX_YAW)))}
                  className="w-24"
                  data-testid="input-max-yaw"
                />
                <span className="text-sm text-muted-foreground">degrees (preview only; saved in Settings → Recognition)</span>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="realistic-bounds" checked={realisticBounds} onCheckedChange={setRealisticBounds} data-testid="switch-realistic-bounds" />
                <Label htmlFor="realistic-bounds">Realistic bounds</Label>
                <span className="text-sm text-muted-foreground">oval slightly larger than the face, reshaped by yaw, pitch and roll</span>
              </div>
            </CardContent>
          </Card>

          {imageDataUrl && (
            <Card data-testid="card-result">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  Result
                  {faces.length > 0 && (
                    <span className="ml-auto text-sm font-normal text-muted-foreground">
                      {faces.length} face{faces.length !== 1 ? "s" : ""}, {excludedCount} excluded
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative inline-block max-w-full">
                  <img
                    ref={imgRef}
                    src={imageDataUrl}
                    alt="Uploaded"
                    className="max-w-full rounded-md block"
                    onLoad={() => imgRef.current && setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })}
                    data-testid="img-uploaded"
                  />
                  {naturalSize && faces.map((face, i) => {
                    if (!face.box) return null;
                    const excluded = isExcluded(face);
                    const color = excluded ? "#ef4444" : "#22c55e";
                    return (
                      <div key={face.face_index ?? i}>
                        <div
                          style={{
                            position: "absolute",
                            left: pct(face.box.x, naturalSize.w),
                            top: pct(face.box.y, naturalSize.h),
                            width: pct(face.box.w, naturalSize.w),
                            height: pct(face.box.h, naturalSize.h),
                            border: realisticBounds ? "none" : `2.5px ${excluded ? "dashed" : "solid"} ${color}`,
                            borderRadius: 3,
                            boxSizing: "border-box",
                            pointerEvents: "none",
                          }}
                          data-testid={`face-box-${i}`}
                        >
                          <span
                            style={{
                              position: "absolute", top: -22, left: 0, background: color, color: "#fff",
                              fontSize: 11, padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap",
                            }}
                          >
                            {face.yaw != null
                              ? `Y ${signed(face.yaw)}  P ${signed(face.pitch)}  R ${signed(face.roll)}`
                              : "n/a"}
                          </span>
                        </div>
                        {realisticBounds && (() => {
                          const oval = realisticOval(face.box, face.yaw, face.pitch, face.roll);
                          return (
                            <svg
                              viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
                              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                              data-testid={`face-oval-${i}`}
                            >
                              <ellipse
                                cx={oval.cx} cy={oval.cy} rx={oval.rx} ry={oval.ry}
                                transform={`rotate(${oval.rotate} ${oval.cx} ${oval.cy})`}
                                fill="none" stroke={color} strokeWidth={2.5}
                                strokeDasharray={excluded ? "8 5" : undefined}
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  {faces.map((face, i) => {
                    const excluded = isExcluded(face);
                    const best = face.matches?.[0];
                    return (
                      <div key={face.face_index ?? i} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm" data-testid={`face-row-${i}`}>
                        <span className="font-medium">Face {i + 1}</span>
                        <Badge variant={excluded ? "destructive" : "secondary"}>
                          yaw {face.yaw != null ? `${face.yaw}°` : "n/a"}
                        </Badge>
                        {face.pitch != null && <Badge variant="secondary" title="Up/down nod, rough estimate (+ = up)">pitch {face.pitch}°</Badge>}
                        {face.roll != null && <Badge variant="secondary" title="Sideways tilt (+ = clockwise)">roll {face.roll}°</Badge>}
                        {excluded && <Badge variant="outline">{exclusionOn ? "excluded from matching" : "would be excluded (filter off)"}</Badge>}
                        {face.detection_confidence != null && (
                          <span className="text-muted-foreground">detection {Math.round(face.detection_confidence * 100)}%</span>
                        )}
                        <span className="ml-auto">
                          {excluded && exclusionOn
                            ? <span className="text-muted-foreground">Not matched</span>
                            : best
                              ? <>{best.person_name || "Unnamed match"} <span className="text-muted-foreground">({Math.round((best.confidence_score ?? 0) * 100)}%)</span></>
                              : <span className="text-muted-foreground">No match</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
