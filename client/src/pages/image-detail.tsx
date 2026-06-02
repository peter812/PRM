import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Loader2, ChevronLeft, ImageOff } from "lucide-react";
import { format } from "date-fns";
import type { Photo } from "@shared/schema";
import { Button } from "@/components/ui/button";

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "MMM d, yyyy HH:mm:ss");
}

function MetaRow({ label, value, mono, testId }: { label: string; value: React.ReactNode; mono?: boolean; testId?: string }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-2 border-b last:border-b-0 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-xs break-all" : "break-words"} data-testid={testId}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  let formatted: string;
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }
  return (
    <pre className="bg-muted/40 rounded px-2 py-1.5 text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">
      {formatted}
    </pre>
  );
}

type FaceEntry = { faceUuid?: string; subImagePhotoId?: string };

function isFaceArray(v: unknown): v is FaceEntry[] {
  return Array.isArray(v);
}

export default function ImageDetailPage() {
  const [, params] = useRoute("/image/:id");
  const id = params?.id;

  const { data: photo, isLoading, error } = useQuery<Photo>({
    queryKey: [`/api/photos/${id}`],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !photo) {
    return (
      <div className="container max-w-3xl py-8 px-4">
        <Link href="/settings/image-tasks" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to Image Tasks
        </Link>
        <div className="mt-8 text-center text-muted-foreground">
          <ImageOff className="h-10 w-10 mx-auto mb-3" />
          Image not found.
        </div>
      </div>
    );
  }

  const faces = isFaceArray(photo.faceUuids) ? photo.faceUuids : [];

  return (
    <div className="container max-w-5xl py-6 px-4">
      <div className="flex items-center justify-between mb-4">
        <Link href="/settings/image-tasks" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground" data-testid="link-back">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Link>
        <Button asChild variant="outline" size="sm">
          <a href={photo.location} target="_blank" rel="noreferrer" data-testid="link-open-original">Open original</a>
        </Button>
      </div>

      <h1 className="text-2xl font-semibold mb-1" data-testid="text-image-title">Image</h1>
      <p className="text-xs font-mono text-muted-foreground mb-6 break-all" data-testid="text-image-id">{photo.id}</p>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="border rounded-md overflow-hidden bg-muted/30 flex items-center justify-center">
            <img
              src={photo.location}
              alt={photo.imageDescription || photo.id}
              className="max-h-[480px] w-auto object-contain"
              data-testid="img-photo"
            />
          </div>
          {(photo.widthPx || photo.heightPx) && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {photo.widthPx ?? "?"} × {photo.heightPx ?? "?"} px
            </p>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Basic info</h2>
          <div className="border rounded-md px-3">
            <MetaRow label="Location" value={photo.location} mono testId="text-photo-location" />
            <MetaRow label="PRM Location" value={photo.prmLocation} mono testId="text-photo-prm-location" />
            <MetaRow label="Sub-image" value={photo.isSubImage ? "Yes" : "No"} />
            <MetaRow label="Uploaded" value={formatDate(photo.uploadedAt)} />
            <MetaRow label="Processed" value={formatDate(photo.processedAt)} />
            <MetaRow label="File hash" value={photo.fileHash} mono />
            <MetaRow label="Width" value={photo.widthPx ?? null} />
            <MetaRow label="Height" value={photo.heightPx ?? null} />
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">AI image description</h2>
        <div className="border rounded-md px-3">
          <MetaRow label="Generated at" value={formatDate(photo.imageDescriptionAt)} />
          <MetaRow
            label="Description"
            value={photo.imageDescription || <span className="text-muted-foreground">—</span>}
            testId="text-image-description"
          />
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Facial detection</h2>
        <div className="border rounded-md px-3">
          <MetaRow label="Detected at" value={formatDate(photo.faceIdAt)} />
          <MetaRow
            label="Faces"
            value={
              faces.length === 0 ? (
                <span className="text-muted-foreground">No faces detected</span>
              ) : (
                <ul className="space-y-1" data-testid="list-faces">
                  {faces.map((f, i) => (
                    <li key={i} className="font-mono text-xs break-all">
                      {f.faceUuid ?? "(unknown)"}
                      {f.subImagePhotoId && (
                        <Link
                          href={`/image/${f.subImagePhotoId}`}
                          className="ml-2 text-primary hover:underline"
                          data-testid={`link-sub-image-${i}`}
                        >
                          → sub-image
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">OG metadata</h2>
        <div className="border rounded-md p-3" data-testid="block-og-metadata">
          <JsonBlock value={photo.ogMetadata} />
        </div>
      </div>

      <div className="mt-8 mb-12">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Image metadata (EXIF / analysis)</h2>
        <div className="border rounded-md p-3" data-testid="block-image-metadata">
          <JsonBlock value={photo.metadata} />
        </div>
      </div>
    </div>
  );
}
