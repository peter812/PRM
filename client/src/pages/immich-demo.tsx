import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Upload, ImageIcon, RefreshCw, ImagePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

type ImmichAsset = {
  id: string;
  originalFileName: string | null;
  fileCreatedAt: string | null;
  type: string | null;
};

type ImmichClientConfig = {
  enabled: boolean;
  url: string;
  apiKey: string;
};

// Authenticated <img> for direct-from-Immich image fetching. The browser does
// not let us set custom headers on a plain <img> tag, so we fetch the image
// with the API key, turn it into a blob URL, and feed that to the <img>.
function ImmichImg({
  url,
  apiKey,
  assetId,
  size = "preview",
  alt,
  className,
}: {
  url: string;
  apiKey: string;
  assetId: string;
  size?: "thumbnail" | "preview";
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setError(false);
    setSrc(null);
    (async () => {
      try {
        const resp = await fetch(`${url}/api/assets/${assetId}/thumbnail?size=${size}`, {
          headers: { "x-api-key": apiKey, Accept: "image/*" },
        });
        if (!resp.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const blob = await resp.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setSrc(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, apiKey, assetId, size]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className ?? ""}`}>
        <ImageIcon className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className ?? ""}`}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} data-testid={`img-immich-${assetId}`} />;
}

export default function ImmichDemoPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: clientConfig, isLoading: configLoading } = useQuery<ImmichClientConfig>({
    queryKey: ["/api/immich/client-config"],
  });

  const {
    data: assetsData,
    isLoading: assetsLoading,
    refetch: refetchAssets,
    error: assetsError,
  } = useQuery<{ assets: ImmichAsset[] }>({
    queryKey: ["/api/immich/assets"],
    enabled: !!clientConfig?.enabled,
  });

  const handleUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("image", file);
        const res = await fetch("/api/immich/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to upload");
        toast({
          title: data.duplicate ? "Already in Immich" : "Uploaded to Immich",
          description: data.duplicate
            ? "Immich detected this as a duplicate."
            : `Asset ${data.assetId} stored.`,
        });
        await refetchAssets();
      } catch (err: any) {
        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      } finally {
        setIsUploading(false);
      }
    },
    [refetchAssets, toast]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void handleUpload(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    void handleUpload(file);
  };

  if (configLoading) {
    return (
      <div className="container max-w-5xl mx-auto py-6 px-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!clientConfig?.enabled) {
    return (
      <div className="container max-w-2xl mx-auto py-6 px-4 space-y-4">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ImagePlus className="h-6 w-6" />
          Immich Demo
        </h1>
        <Card>
          <CardContent className="py-6 space-y-3">
            <p className="text-sm">
              The Immich demo is not enabled. Configure and enable it on the{" "}
              <Link href="/settings/immich" className="underline" data-testid="link-immich-settings">
                Immich Connection
              </Link>{" "}
              settings page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const assets = assetsData?.assets ?? [];

  return (
    <div className="container max-w-5xl mx-auto py-6 px-4 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-immich-demo-title">
            <ImagePlus className="h-6 w-6" />
            Immich Demo
          </h1>
          <p className="text-muted-foreground text-sm">
            Upload photos through the PRM middleware to your Immich server. Photos are then fetched
            directly from Immich by your browser, bypassing the PRM server.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchAssets()}
          disabled={assetsLoading}
          data-testid="button-refresh-immich-assets"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${assetsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div
        className="border-2 border-dashed rounded-md p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover-elevate transition-colors min-h-32"
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        data-testid="dropzone-immich-upload"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-immich-file"
        />
        {isUploading ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm">Uploading to Immich…</p>
          </>
        ) : (
          <>
            <div className="rounded-full bg-muted p-3">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Drop an image here to upload to Immich</p>
              <p className="text-xs text-muted-foreground mt-0.5">or click to browse</p>
            </div>
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Photos in Immich</h2>
          <span className="text-xs text-muted-foreground" data-testid="text-immich-asset-count">
            {assets.length} loaded
          </span>
        </div>
        {assetsError ? (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-destructive">
                Could not load assets from Immich: {(assetsError as Error).message}
              </p>
            </CardContent>
          </Card>
        ) : assetsLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : assets.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              No photos found in Immich yet. Upload one above to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {assets.map((a) => (
              <div
                key={a.id}
                className="aspect-square rounded-md overflow-hidden border bg-muted"
                data-testid={`card-immich-asset-${a.id}`}
                title={a.originalFileName ?? a.id}
              >
                <ImmichImg
                  url={clientConfig.url}
                  apiKey={clientConfig.apiKey}
                  assetId={a.id}
                  size="preview"
                  alt={a.originalFileName ?? a.id}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
