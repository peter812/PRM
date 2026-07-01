import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScanFace, ChevronLeft, ChevronRight, Loader2, AlertCircle, KeyRound, User } from "lucide-react";
import { Link } from "wouter";

const PAGE_SIZE = 24;

type FaceItem = {
  face_uuid: string;
  s3_url: string | null;
  personface_uuid: string | null;
  person_name?: string | null;
  created_at?: string | null;
  photo_id?: string | null;
};

type FaceListResponse = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  faces: FaceItem[];
};

export default function RecognitionFacesPage() {
  const [page, setPage] = useState(1);

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/prm-face/face/list"] });
  }, []);

  const { data, isLoading, isError, error } = useQuery<FaceListResponse>({
    queryKey: ["/api/prm-face/face/list", page],
    queryFn: async () => {
      const res = await fetch(`/api/prm-face/face/list?page=${page}&page_size=${PAGE_SIZE}`, {
        credentials: "include",
      });
      const text = await res.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { throw new Error("Unexpected server response — please refresh."); }
      if (!res.ok) throw new Error(payload?.error ?? `Server error ${res.status}`);
      return payload;
    },
    retry: false,
  });

  const isKeyInvalid = isError && (error as Error).message === "API_KEY_INVALID";
  const faces: FaceItem[] = data?.faces ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const formatDate = (val?: string | null) => {
    if (!val) return null;
    try {
      return new Date(val).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch { return val; }
  };

  return (
    <div className="h-full overflow-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 md:px-8 py-3 flex items-center gap-2">
        <ScanFace className="h-5 w-5 text-muted-foreground" />
        <span className="font-semibold">Faces</span>
        {total > 0 && <span className="text-sm text-muted-foreground">({total})</span>}
      </div>

      {/* Content */}
      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <div className="flex items-center justify-center py-24" data-testid="loading-faces">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isKeyInvalid && (
          <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm" data-testid="error-api-key-faces">
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
        )}

        {isError && !isKeyInvalid && (
          <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm" data-testid="error-faces">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <span className="text-destructive">{(error as Error).message}</span>
          </div>
        )}

        {!isLoading && !isError && faces.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground" data-testid="empty-faces">
            <ScanFace className="h-10 w-10" />
            <p className="text-sm">No faces registered yet. Add an image to extract faces.</p>
          </div>
        )}

        {!isLoading && !isError && faces.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4" data-testid="grid-faces">
              {faces.map((face) => {
                const fullUrl = face.s3_url ?? null;
                const date = formatDate(face.created_at);
                const hasName = !!face.person_name;
                return (
                  <div
                    key={face.face_uuid}
                    className="rounded-md border bg-card overflow-hidden flex flex-col"
                    data-testid={`card-face-${face.face_uuid}`}
                  >
                    <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                      {fullUrl ? (
                        <img
                          src={fullUrl}
                          alt={face.person_name ?? "Unknown face"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <User className="h-8 w-8 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="p-2 space-y-0.5">
                      <p className={`text-xs font-medium truncate ${hasName ? "" : "text-muted-foreground italic"}`}>
                        {face.person_name ?? "Unidentified"}
                      </p>
                      {date && <p className="text-xs text-muted-foreground">{date}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8" data-testid="pagination-faces">
                <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} data-testid="button-prev-page-faces">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} data-testid="button-next-page-faces">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
