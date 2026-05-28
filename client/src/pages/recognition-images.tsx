import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ImageIcon, Plus, ChevronLeft, ChevronRight, Upload, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 24;

type ImageItem = {
  uuid: string;
  filename?: string;
  source_filename?: string;
  added_at?: string;
  created_at?: string;
  face_count?: number;
  faces_found?: number;
  url?: string;
  file_url?: string;
  [key: string]: unknown;
};

type ListResponse = {
  items?: ImageItem[];
  images?: ImageItem[];
  data?: ImageItem[];
  total?: number;
  page?: number;
  page_size?: number;
  pages?: number;
  [key: string]: unknown;
};

export default function RecognitionImagesPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError, error } = useQuery<ListResponse>({
    queryKey: ["/api/prm-face/img/list", page],
    queryFn: async () => {
      const res = await fetch(`/api/prm-face/img/list?page=${page}&page_size=${PAGE_SIZE}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      return res.json();
    },
  });

  const items: ImageItem[] = data?.items ?? data?.images ?? (data?.data as ImageItem[]) ?? [];
  const total = data?.total ?? items.length;
  const totalPages = data?.pages ?? Math.ceil(total / PAGE_SIZE);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) setSelectedFile(file);
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", selectedFile);
      const res = await fetch("/api/prm-face/img/add", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      toast({ title: "Image added", description: "The image has been stored and faces extracted." });
      setIsAddOpen(false);
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/img/list"] });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    setIsAddOpen(open);
  };

  const formatDate = (val?: string) => {
    if (!val) return null;
    try {
      return new Date(val).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return val;
    }
  };

  const getImageUrl = (item: ImageItem): string | null =>
    (item.url as string) ?? (item.file_url as string) ?? null;

  const getFilename = (item: ImageItem): string =>
    (item.filename as string) ?? (item.source_filename as string) ?? item.uuid.slice(0, 8) + "…";

  const getFaceCount = (item: ImageItem): number | null =>
    item.face_count != null ? item.face_count : item.faces_found != null ? item.faces_found : null;

  const getDate = (item: ImageItem): string | null =>
    formatDate((item.added_at as string) ?? (item.created_at as string));

  return (
    <div className="h-full overflow-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 md:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
          <span className="font-semibold">Images</span>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">({total})</span>
          )}
        </div>
        <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-image">
          <Plus className="h-4 w-4 mr-2" />
          Add Image
        </Button>
      </div>

      {/* Content */}
      <div className="px-4 md:px-8 py-6">
        {isLoading && (
          <div className="flex items-center justify-center py-24" data-testid="loading-images">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm" data-testid="error-images">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <span className="text-destructive">{(error as Error).message}</span>
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground" data-testid="empty-images">
            <ImageIcon className="h-10 w-10" />
            <p className="text-sm">No images yet. Upload one to get started.</p>
          </div>
        )}

        {!isLoading && !isError && items.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4" data-testid="grid-images">
              {items.map((item, i) => {
                const imgUrl = getImageUrl(item);
                const name = getFilename(item);
                const faces = getFaceCount(item);
                const date = getDate(item);
                return (
                  <div
                    key={item.uuid}
                    className="rounded-md border bg-card overflow-hidden flex flex-col"
                    data-testid={`card-image-${item.uuid}`}
                  >
                    <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="p-2 space-y-0.5">
                      <p className="text-xs font-medium truncate" title={name}>{name}</p>
                      {faces != null && (
                        <p className="text-xs text-muted-foreground">{faces} face{faces !== 1 ? "s" : ""}</p>
                      )}
                      {date && (
                        <p className="text-xs text-muted-foreground">{date}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8" data-testid="pagination-images">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Image Dialog */}
      <Dialog open={isAddOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-image">
          <DialogHeader>
            <DialogTitle>Add Image</DialogTitle>
          </DialogHeader>

          <div
            className="border-2 border-dashed rounded-md p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors hover:border-primary/50"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            data-testid="dropzone-add-image"
          >
            {selectedFile ? (
              <>
                <div className="w-full max-h-48 overflow-hidden rounded-md bg-muted flex items-center justify-center">
                  <img
                    src={URL.createObjectURL(selectedFile)}
                    alt="Preview"
                    className="max-w-full max-h-48 object-contain"
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center truncate max-w-full">
                  {selectedFile.name}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  data-testid="button-change-image"
                >
                  Change image
                </Button>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  Drop an image here or click to browse
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  data-testid="button-browse-image"
                >
                  Select image
                </Button>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-image-file"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogOpenChange(false)} disabled={isUploading} data-testid="button-cancel-upload">
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!selectedFile || isUploading} data-testid="button-confirm-upload">
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading…
                </>
              ) : (
                "Add Image"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
