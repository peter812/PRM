import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  KeyRound,
  ImageIcon,
  Trash2,
  Download,
  User,
} from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const PAGE_SIZE = 24;

const FACE_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#ec4899", "#14b8a6",
];

type PhotoImage = {
  image_uuid: string;
  image_url: string;
  thumb_url: string;
  face_count: number;
};

type PersonPhotosResponse = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  images: PhotoImage[];
  api_url: string;
};

type FaceBox = { x: number; y: number; w: number; h: number };
type FaceDetail = {
  face_uuid: string;
  person_uuid?: string | null;
  person_name?: string | null;
  is_social?: boolean;
  social_username?: string | null;
  box?: FaceBox | null;
};
type ImageDetail = {
  image_uuid: string;
  faces?: FaceDetail[];
};

function FaceOverlay({
  faces,
  imgNaturalWidth,
  imgNaturalHeight,
  containerWidth,
  containerHeight,
}: {
  faces: FaceDetail[];
  imgNaturalWidth: number;
  imgNaturalHeight: number;
  containerWidth: number;
  containerHeight: number;
}) {
  if (!imgNaturalWidth || !imgNaturalHeight) return null;

  const scaleX = containerWidth / imgNaturalWidth;
  const scaleY = containerHeight / imgNaturalHeight;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={containerWidth}
      height={containerHeight}
    >
      {faces.map((face, i) => {
        if (!face.box) return null;
        const { x, y, w, h } = face.box;
        const color = FACE_COLORS[i % FACE_COLORS.length];
        const rx = x * scaleX;
        const ry = y * scaleY;
        const rw = w * scaleX;
        const rh = h * scaleY;
        const name = face.person_name ?? (face.social_username ? `@${face.social_username}` : "Unknown");
        return (
          <g key={face.face_uuid ?? i}>
            <rect
              x={rx}
              y={ry}
              width={rw}
              height={rh}
              fill="none"
              stroke={color}
              strokeWidth={2}
            />
            <rect
              x={rx}
              y={ry - 18}
              width={Math.min(rw, 120)}
              height={18}
              fill={color}
              opacity={0.85}
            />
            <text
              x={rx + 4}
              y={ry - 4}
              fill="white"
              fontSize={11}
              fontFamily="sans-serif"
            >
              {name.length > 14 ? name.slice(0, 13) + "…" : name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PhotoModal({
  image,
  apiUrl,
  open,
  onClose,
  onDeleted,
}: {
  image: PhotoImage | null;
  apiUrl: string;
  open: boolean;
  onClose: () => void;
  onDeleted: (uuid: string) => void;
}) {

  const { toast } = useToast();
  const [showPeople, setShowPeople] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number; nw: number; nh: number } | null>(null);

  const { data: detail, isLoading: detailLoading } = useQuery<ImageDetail>({
    queryKey: ["/api/prm-face/img/detail-enriched", image?.image_uuid],
    queryFn: async () => {
      const res = await fetch(`/api/prm-face/img/detail-enriched?uuid=${encodeURIComponent(image!.image_uuid)}`, {
        credentials: "include",
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error("Unexpected server response."); }
      if (!res.ok) throw new Error(data?.error ?? `Server error ${res.status}`);
      return data;
    },
    enabled: open && !!image?.image_uuid && showPeople,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/prm-face/img/delete?image_uuid=${encodeURIComponent(image!.image_uuid)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text();
        let err: any;
        try { err = JSON.parse(body); } catch { throw new Error(body); }
        throw new Error(err?.error ?? `Delete failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Image deleted" });
      setDeleteDialogOpen(false);
      onDeleted(image!.image_uuid);
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      setDeleteDialogOpen(false);
    },
  });

  const handleDownload = useCallback(() => {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image.image_url;
    a.download = `photo-${image.image_uuid}.jpg`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }, [image]);

  const handleImgLoad = useCallback(() => {
    const el = imgRef.current;
    if (!el) return;
    setImgDims({
      w: el.clientWidth,
      h: el.clientHeight,
      nw: el.naturalWidth,
      nh: el.naturalHeight,
    });
  }, []);

  const faces: FaceDetail[] = detail?.faces ?? [];

  if (!image) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-3xl w-full p-0 overflow-hidden" data-testid="dialog-photo-detail">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-base">Photo</DialogTitle>
          </DialogHeader>

          <div className="relative bg-black flex items-center justify-center" style={{ minHeight: 300, maxHeight: "60vh" }}>
            <img
              ref={imgRef}
              src={image.image_url}
              alt="Photo"
              className="max-w-full max-h-full object-contain"
              style={{ maxHeight: "60vh" }}
              onLoad={handleImgLoad}
              data-testid="img-photo-full"
            />
            {showPeople && imgDims && faces.length > 0 && (
              <FaceOverlay
                faces={faces}
                imgNaturalWidth={imgDims.nw}
                imgNaturalHeight={imgDims.nh}
                containerWidth={imgDims.w}
                containerHeight={imgDims.h}
              />
            )}
            {showPeople && detailLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
          </div>

          <div className="px-4 pb-4 space-y-4">
            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="show-people-checkbox"
                checked={showPeople}
                onCheckedChange={(v) => setShowPeople(!!v)}
                data-testid="checkbox-show-people"
              />
              <Label htmlFor="show-people-checkbox" className="text-sm cursor-pointer">
                Show people
              </Label>
              {showPeople && !detailLoading && faces.length > 0 && (
                <span className="text-xs text-muted-foreground ml-2">
                  {faces.filter(f => f.person_name).length} identified
                </span>
              )}
            </div>

            {showPeople && !detailLoading && faces.length > 0 && (
              <div className="flex flex-wrap gap-2" data-testid="list-people-in-photo">
                {faces.map((face, i) => {
                  const color = FACE_COLORS[i % FACE_COLORS.length];
                  const name = face.person_name ?? (face.social_username ? `@${face.social_username}` : "Unknown");
                  return (
                    <span
                      key={face.face_uuid ?? i}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border"
                      style={{ borderColor: color, color }}
                      data-testid={`badge-person-in-photo-${face.face_uuid}`}
                    >
                      <User className="h-3 w-3" />
                      {name}
                    </span>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1" data-testid="row-photo-actions">
              <Button
                variant="outline"
                onClick={handleDownload}
                data-testid="button-download-photo"
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
                data-testid="button-delete-photo"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete-photo">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the image and all associated face records from the
              PRM-Face server. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-photo">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-photo"
            >
              {deleteMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting…</>
              ) : (
                "Yes, delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function PersonPhotosTab({ personId }: { personId: string }) {
  const [page, setPage] = useState(1);
  const [selectedImage, setSelectedImage] = useState<PhotoImage | null>(null);
  const [deletedUuids, setDeletedUuids] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useQuery<PersonPhotosResponse>({
    queryKey: ["/api/prm-face/person-photos", personId, page],
    queryFn: async () => {
      const res = await fetch(
        `/api/prm-face/person-photos/${encodeURIComponent(personId)}?page=${page}&page_size=${PAGE_SIZE}`,
        { credentials: "include" }
      );
      const text = await res.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { throw new Error("Unexpected server response — please refresh."); }
      if (!res.ok) throw new Error(payload?.error ?? `Server error ${res.status}`);
      return payload;
    },
    retry: false,
  });

  const handleDeleted = useCallback((uuid: string) => {
    setDeletedUuids((prev) => new Set([...prev, uuid]));
    queryClient.invalidateQueries({ queryKey: ["/api/prm-face/person-photos", personId] });
  }, [personId]);

  const images = (data?.images ?? []).filter(img => !deletedUuids.has(img.image_uuid));
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const apiUrl = data?.api_url ?? "";

  const isKeyInvalid = isError && (error as Error).message === "API_KEY_INVALID";

  if (isLoading) {
    return (
      <div className="px-6 py-4 space-y-4" data-testid="loading-person-photos">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isKeyInvalid) {
    return (
      <div className="px-6 py-8">
        <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm" data-testid="error-api-key-person-photos">
          <KeyRound className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
          <div className="space-y-1">
            <p className="text-destructive font-medium">Invalid or missing API key</p>
            <p className="text-muted-foreground">
              PRM-Face rejected the request. Please{" "}
              <Link href="/settings/recognition" className="underline text-foreground hover:text-foreground/80">
                regenerate your API key
              </Link>{" "}
              in Recognition Settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-6 py-8">
        <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm" data-testid="error-person-photos">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
          <span className="text-destructive">{(error as Error).message}</span>
        </div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground" data-testid="empty-person-photos">
        <ImageIcon className="h-10 w-10" />
        <p className="text-sm">No photos found for this person.</p>
        <p className="text-xs text-muted-foreground/70">
          Upload photos using the Add menu on their profile.
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 py-4 space-y-4" data-testid="person-photos-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} photo{total !== 1 ? "s" : ""} containing this person
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3" data-testid="grid-person-photos">
        {images.map((img) => (
          <button
            key={img.image_uuid}
            className="rounded-md border bg-card overflow-hidden hover-elevate focus:outline-none focus-visible:ring-2 focus-visible:ring-ring aspect-square"
            onClick={() => setSelectedImage(img)}
            data-testid={`card-person-photo-${img.image_uuid}`}
          >
            <img
              src={img.thumb_url}
              alt="Photo"
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = img.image_url;
              }}
            />
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2" data-testid="pagination-person-photos">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            data-testid="button-prev-page-person-photos"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            data-testid="button-next-page-person-photos"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <PhotoModal
        image={selectedImage}
        apiUrl={apiUrl}
        open={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
