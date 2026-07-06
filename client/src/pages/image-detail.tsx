import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute, useLocation } from "wouter";
import { Loader2, ChevronLeft, ImageOff, CheckCircle2, XCircle, ExternalLink, Trash2 } from "lucide-react";
import { format } from "date-fns";
import type { Photo, Person, SocialAccountWithCurrentProfile } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { imageDetailHref } from "@/lib/image-link";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

type FacialIdEntry = {
  faceUuid: string;
  subImageUrl?: string;
  coordinates?: { x: number; y: number; w: number; h: number };
  personId?: string | null;
  socialAccountId?: string | null;
};

function isFacialIdsArray(v: unknown): v is FacialIdEntry[] {
  return Array.isArray(v);
}

const COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6"];

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

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/photos/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown server error" }));
        throw new Error(body.error || `Server returned ${res.status}`);
      }
      toast({
        title: "Image Deleted",
        description: "The image and all associated traces have been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/img/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/person-photos"] });
      setLocation(back.href);
    } catch (err: any) {
      toast({
        title: "Delete Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  const [showBoundingBoxes, setShowBoundingBoxes] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const { data: people = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const { data: socialAccounts = [] } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts"],
  });

  const peopleMap = new Map(people.map((p) => [p.id, p]));
  const socialMap = new Map(socialAccounts.map((s) => [s.id, s]));

  const handleImageLoad = () => {
    if (!imgRef.current) return;
    setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
  };

  const pctBox = (box: { x: number; y: number; w: number; h: number }, nat: { w: number; h: number }) => ({
    left: `${(box.x / nat.w) * 100}%`,
    top: `${(box.y / nat.h) * 100}%`,
    width: `${(box.w / nat.w) * 100}%`,
    height: `${(box.h / nat.h) * 100}%`,
  });

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
  const facialIds = isFacialIdsArray(photo.facialIds) ? photo.facialIds : [];

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
        <div className="flex items-center gap-2">
          {hasFaceRecog && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
              data-testid="btn-toggle-bounds"
            >
              {showBoundingBoxes ? "Hide bounds" : "Show bounds"}
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <a href={photo.location} target="_blank" rel="noreferrer" data-testid="link-open-original">
              <ExternalLink className="h-4 w-4 mr-1" />
              Open original
            </a>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowConfirmDelete(true)}
            disabled={isDeleting}
            data-testid="btn-delete-image"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-1" />
                Delete Image
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Image at the top */}
      <div className="border rounded-md overflow-hidden bg-muted/30 flex items-center justify-center mb-6">
        <div className="relative inline-block max-w-full">
          <img
            ref={imgRef}
            src={photo.location}
            alt={photo.imageDescription || photo.id}
            className="max-h-[560px] w-auto object-contain block"
            onLoad={handleImageLoad}
            data-testid="img-photo"
          />
          {showBoundingBoxes && naturalSize && facialIds.map((face, i) => {
            if (!face.coordinates) return null;
            const pos = pctBox(face.coordinates, naturalSize);
            const color = COLORS[i % COLORS.length];
            return (
              <div
                key={face.faceUuid || i}
                style={{
                  position: "absolute",
                  left: pos.left,
                  top: pos.top,
                  width: pos.width,
                  height: pos.height,
                  border: `2.5px solid ${color}`,
                  borderRadius: 3,
                  boxSizing: "border-box",
                  pointerEvents: "none",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    background: color,
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 1,
                    padding: "2px 4px",
                    borderRadius: 2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {i + 1}
                </span>
              </div>
            );
          })}
        </div>
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

      {/* Facial Recog section */}
      <div className="mb-6" data-testid="section-facial-recog">
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
          Facial Recog
        </h2>
        <div className="border rounded-md px-3 py-2.5 text-sm">
          {!hasFaceRecog ? (
            <span className="text-muted-foreground">Facial recognition not run on this image.</span>
          ) : facialIds.length === 0 ? (
            <span className="text-muted-foreground">No faces detected.</span>
          ) : (
            <ul className="space-y-2 py-1" data-testid="list-facial-recog">
              {facialIds.map((face, i) => {
                const color = COLORS[i % COLORS.length];
                const person = face.personId ? peopleMap.get(face.personId) : null;
                const social = face.socialAccountId ? socialMap.get(face.socialAccountId) : null;

                return (
                  <li key={face.faceUuid || i} className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 inline-flex items-center justify-center rounded-full text-white text-[10px] font-bold shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {i + 1}
                    </span>
                    {person ? (
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-muted-foreground">Identified as:</span>
                        <Link
                          href={`/person/${person.id}`}
                          className="font-medium text-primary hover:underline truncate"
                          data-testid={`link-facial-person-${i}`}
                        >
                          {person.firstName} {person.lastName}
                        </Link>
                      </span>
                    ) : social ? (
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-muted-foreground">Linked social account:</span>
                        <span className="font-medium text-foreground truncate">
                          {social.currentProfile?.nickname || `@${social.username}`}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Unknown / Unmapped</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

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

      <AlertDialog open={showConfirmDelete} onOpenChange={setShowConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete this image from PRM, PRM-Face, and S3? This action will also delete all associated face crops and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
