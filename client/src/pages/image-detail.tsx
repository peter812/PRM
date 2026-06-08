import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Loader2, ChevronLeft, ImageOff, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import type { Photo } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { imageDetailHref } from "@/lib/image-link";

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "MMM d, yyyy HH:mm:ss");
}

function StatusChip({ label, value, testId }: { label: string; value: boolean; testId?: string }) {
  const Icon = value ? CheckCircle2 : XCircle;
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white " +
        (value ? "bg-green-600" : "bg-red-600")
      }
      data-testid={testId}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
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

type FaceEntry = { faceUuid?: string; subImagePhotoId?: string };

function isFaceArray(v: unknown): v is FaceEntry[] {
  return Array.isArray(v);
}

function useBackHref(currentId: string): { href: string; label: string } {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const from = new URLSearchParams(search).get("from");
  // Only accept same-origin paths that look like a simple in-app route. This
  // rejects protocol-relative URLs (//evil.com), backslash tricks (/\evil.com)
  // and any non-leading-slash value.
  if (from && /^\/[A-Za-z0-9_\-/?=&%.]*$/.test(from) && !from.startsWith(`/image/${currentId}`)) {
    return { href: from, label: "Back" };
  }
  return { href: "/images", label: "Back to Images" };
}

export default function ImageDetailPage() {
  const [, params] = useRoute("/image/:id");
  const id = params?.id ?? "";

  const back = useBackHref(id);

  const { data: photo, isLoading, error } = useQuery<Photo>({
    queryKey: [`/api/photos/${id}`],
    enabled: !!id,
  });

  // Parent lookup (only for sub-images)
  const { data: parent } = useQuery<Photo>({
    queryKey: [`/api/photos/${id}/parent`],
    enabled: !!id && !!photo?.isSubImage,
    retry: false,
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
        <Link
          href={back.href}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          data-testid="link-back"
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> {back.label}
        </Link>
        <div className="mt-8 text-center text-muted-foreground">
          <ImageOff className="h-10 w-10 mx-auto mb-3" />
          Image not found.
        </div>
      </div>
    );
  }

  const faces = isFaceArray(photo.faceUuids) ? photo.faceUuids : [];
  const subImageRefs = faces.filter((f) => !!f.subImagePhotoId);
  const hasAiDescription = !!photo.imageDescriptionAt;
  const hasFaceRecog = !!photo.faceIdAt;

  return (
    <div className="container max-w-4xl py-6 px-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-4">
        <Link
          href={back.href}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          data-testid="link-back"
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> {back.label}
        </Link>
        <Button asChild variant="outline" size="sm">
          <a href={photo.location} target="_blank" rel="noreferrer" data-testid="link-open-original">
            <ExternalLink className="h-4 w-4 mr-1" />
            Open original
          </a>
        </Button>
      </div>

      {/* Image at the top */}
      <div className="border rounded-md overflow-hidden bg-muted/30 flex items-center justify-center mb-6">
        <img
          src={photo.location}
          alt={photo.imageDescription || photo.id}
          className="max-h-[560px] w-auto object-contain"
          data-testid="img-photo"
        />
      </div>
      {(photo.widthPx || photo.heightPx) && (
        <p className="text-xs text-muted-foreground text-center -mt-4 mb-6" data-testid="text-image-dimensions">
          {photo.widthPx ?? "?"} × {photo.heightPx ?? "?"} px
        </p>
      )}

      {/* Status chips */}
      <div className="flex flex-wrap gap-2 mb-4" data-testid="group-status-chips">
        <StatusChip label="AI desc" value={hasAiDescription} testId="chip-ai-status" />
        <StatusChip label="Face recog" value={hasFaceRecog} testId="chip-face-recog" />
        <StatusChip label="Sub image" value={!!photo.isSubImage} testId="chip-sub-image" />
      </div>

      {/* Creation date */}
      <div className="mb-6 text-sm" data-testid="text-creation-date">
        <span className="text-muted-foreground">Created: </span>
        <span>{formatDate(photo.uploadedAt)}</span>
      </div>

      {/* Image description (only if non-empty) */}
      {photo.imageDescription && photo.imageDescription.trim() !== "" && (
        <div className="mb-6" data-testid="section-image-description">
          <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
            Image description
          </h2>
          <div className="border rounded-md px-3 py-2 text-sm whitespace-pre-wrap break-words" data-testid="text-image-description">
            {photo.imageDescription}
          </div>
        </div>
      )}

      {/* Links section */}
      <div className="mb-6" data-testid="section-links">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Links</h2>
        <div className="border rounded-md px-3 py-2 text-sm">
          {photo.isSubImage ? (
            parent ? (
              <Link
                href={imageDetailHref(parent.id)}
                className="text-primary hover:underline break-all font-mono text-xs"
                data-testid="link-parent-image"
              >
                ↑ Parent image: {parent.id}
              </Link>
            ) : (
              <span className="text-muted-foreground">Parent image not found.</span>
            )
          ) : subImageRefs.length === 0 ? (
            <span className="text-muted-foreground">No sub-images.</span>
          ) : (
            <ul className="space-y-1" data-testid="list-sub-images">
              {subImageRefs.map((f, i) => (
                <li key={f.subImagePhotoId ?? i}>
                  <Link
                    href={imageDetailHref(f.subImagePhotoId!)}
                    className="text-primary hover:underline break-all font-mono text-xs"
                    data-testid={`link-sub-image-${i}`}
                  >
                    ↓ Sub-image: {f.subImagePhotoId}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Location / URL / UUID */}
      <div className="mb-6" data-testid="section-location">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Location</h2>
        <div className="border rounded-md px-3">
          <MetaRow label="PRM Location" value={photo.prmLocation} mono testId="text-photo-prm-location" />
          <MetaRow
            label="Image URL"
            value={
              <a
                href={photo.location}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline break-all"
                data-testid="link-image-url"
              >
                {photo.location}
              </a>
            }
          />
          <MetaRow label="Image UUID" value={photo.id} mono testId="text-image-uuid" />
        </div>
      </div>

      {/* Deep info: action dates */}
      <div className="mb-12" data-testid="section-deep-info">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
          Deep info — action dates
        </h2>
        <div className="border rounded-md px-3">
          <MetaRow label="Uploaded" value={formatDate(photo.uploadedAt)} testId="text-date-uploaded" />
          <MetaRow label="Processed" value={formatDate(photo.processedAt)} testId="text-date-processed" />
          <MetaRow
            label="AI description"
            value={formatDate(photo.imageDescriptionAt)}
            testId="text-date-ai-description"
          />
          <MetaRow label="Face detection" value={formatDate(photo.faceIdAt)} testId="text-date-face-id" />
        </div>
      </div>
    </div>
  );
}
