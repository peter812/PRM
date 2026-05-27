import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Scan, Upload, AlertCircle, Loader2, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type FaceBox = { x: number; y: number; w: number; h: number };
type FaceResult = { face_uuid?: string; face_box: FaceBox };
type PickoutResult = { faces: FaceResult[] };
type PrmFaceSettings = { apiUrl: string; hasApiKey: boolean };

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#ec4899", "#14b8a6",
];

export default function PrmFaceDemoPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [renderedSize, setRenderedSize] = useState<{ w: number; h: number } | null>(null);
  const [faces, setFaces] = useState<FaceResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const { data: settings } = useQuery<PrmFaceSettings>({
    queryKey: ["/api/prm-face/settings"],
  });

  const isConfigured = !!(settings?.apiUrl && settings?.hasApiKey);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        setImageDataUrl(dataUrl);
        setFaces([]);
        setRenderedSize(null);
        setNaturalSize(null);

        setIsProcessing(true);
        try {
          const formData = new FormData();
          formData.append("image", file);

          const res = await fetch("/api/prm-face/pickout-temp", {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(err.error || `Server error ${res.status}`);
          }

          const data: PickoutResult = await res.json();
          setFaces(data.faces || []);

          if ((data.faces || []).length === 0) {
            toast({ title: "No faces detected", description: "PRM-Face did not find any faces in this image." });
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleImageLoad = () => {
    if (!imgRef.current) return;
    setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    setRenderedSize({ w: imgRef.current.offsetWidth, h: imgRef.current.offsetHeight });
  };

  const scaleBox = (box: FaceBox): { left: number; top: number; width: number; height: number } => {
    if (!naturalSize || !renderedSize) return { left: 0, top: 0, width: 0, height: 0 };
    const sx = renderedSize.w / naturalSize.w;
    const sy = renderedSize.h / naturalSize.h;
    return {
      left: box.x * sx,
      top: box.y * sy,
      width: box.w * sx,
      height: box.h * sy,
    };
  };

  return (
    <div className="container max-w-full md:max-w-4xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-prm-face-demo-title">
          <Scan className="h-6 w-6" />
          PRM-Face Demo
        </h1>
        <p className="text-muted-foreground">
          Upload a photo and PRM-Face will detect every face in it. Detected faces are highlighted with coloured boxes.
          Images are processed in memory — nothing is stored on the PRM-Face server.
        </p>
      </div>

      {!isConfigured && (
        <div className="flex items-start gap-3 rounded-md bg-muted p-4 mb-6 text-sm" data-testid="text-not-configured">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          <span className="text-muted-foreground">
            PRM-Face is not configured yet. Go to{" "}
            <a href="/settings/recognition" className="underline underline-offset-2">
              Settings → Recognition
            </a>{" "}
            to set an API URL and generate an API key before using this demo.
          </span>
        </div>
      )}

      <div className="space-y-6">
        <Card data-testid="card-upload">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Upload Image
            </CardTitle>
            <CardDescription>
              Drag and drop an image here, or click to select one from your device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed rounded-md p-8 flex flex-col items-center gap-4 cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              data-testid="dropzone-image"
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                Drop an image here or click to browse
              </p>
              <Button
                variant="outline"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                disabled={!isConfigured || isProcessing}
                data-testid="button-select-image"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Detecting…
                  </>
                ) : (
                  "Select Image"
                )}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleInputChange}
                disabled={!isConfigured || isProcessing}
                data-testid="input-image-file"
              />
            </div>
          </CardContent>
        </Card>

        {imageDataUrl && (
          <Card data-testid="card-result">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Scan className="h-4 w-4" />
                Detection Result
                {faces.length > 0 && (
                  <span className="ml-auto text-sm font-normal text-muted-foreground">
                    {faces.length} face{faces.length !== 1 ? "s" : ""} found
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative inline-block max-w-full" data-testid="container-image-result">
                <img
                  ref={imgRef}
                  src={imageDataUrl}
                  alt="Uploaded"
                  className="max-w-full rounded-md block"
                  onLoad={handleImageLoad}
                  data-testid="img-uploaded"
                  style={{ display: "block" }}
                />
                {renderedSize && faces.map((face, i) => {
                  const scaled = scaleBox(face.face_box);
                  const color = COLORS[i % COLORS.length];
                  return (
                    <div
                      key={face.face_uuid || i}
                      style={{
                        position: "absolute",
                        left: scaled.left,
                        top: scaled.top,
                        width: scaled.width,
                        height: scaled.height,
                        border: `3px solid ${color}`,
                        boxSizing: "border-box",
                        pointerEvents: "none",
                      }}
                      data-testid={`face-box-${i}`}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: -22,
                          left: 0,
                          background: color,
                          color: "#fff",
                          fontSize: 11,
                          padding: "1px 5px",
                          borderRadius: 3,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                        }}
                      >
                        Face {i + 1}
                      </span>
                    </div>
                  );
                })}
                {isProcessing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-md" data-testid="overlay-processing">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
