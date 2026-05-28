import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ImageIcon, Plus, ChevronLeft, ChevronRight, Upload, Loader2, AlertCircle, KeyRound, MoreVertical, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const PAGE_SIZE = 24;

type ImageItem = {
  image_uuid: string;
  image_url: string;
  original_filename: string;
  face_count: number;
  created_at: string | null;
};

type ListImagesResponse = {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  images: ImageItem[];
};

type Settings = { apiUrl: string; hasApiKey: boolean };

function buildUrl(apiUrl: string, relativePath: string): string {
  return `${apiUrl.replace(/\/+$/, "")}${relativePath}`;
}

export default function RecognitionImagesPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/prm-face/settings"],
  });
  const apiUrl = settings?.apiUrl ?? "";

  const { data, isLoading, isError, error } = useQuery<ListImagesResponse>({
    queryKey: ["/api/prm-face/img/list", page],
    queryFn: async () => {
      const res = await fetch(`/api/prm-face/img/list?page=${page}&page_size=${PAGE_SIZE}`, {
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
  const images: ImageItem[] = data?.images ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

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
      const text = await res.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { payload = null; }
      if (!res.ok) {
        const msg = payload?.error ?? (text.startsWith("<") ? "Session may have expired — please refresh." : `Server error ${res.status}`);
        throw new Error(msg);
      }
      const facesDetected: number = payload?.faces_detected ?? 0;
      toast({
        title: "Image added",
        description: `${facesDetected} face${facesDetected !== 1 ? "s" : ""} detected and stored.`,
      });
      setIsAddOpen(false);
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/img/list"] });
    } catch (err: any) {
      const msg = err.message === "API_KEY_INVALID"
        ? "Invalid API key — please regenerate it in Recognition Settings."
        : err.message;
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (item: ImageItem) => {
    try {
      const res = await fetch(`/api/prm-face/img/delete?image_uuid=${encodeURIComponent(item.image_uuid)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const text = await res.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { payload = null; }
      if (!res.ok) throw new Error(payload?.error ?? `Server error ${res.status}`);
      toast({ title: "Image deleted", description: item.original_filename });
      queryClient.invalidateQueries({ queryKey: ["/api/prm-face/img/list"] });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    setIsAddOpen(open);
  };

  const formatDate = (val?: string | null) => {
    if (!val) return null;
    try {
      return new Date(val).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch { return val; }
  };

  return (
    <div className="h-full overflow-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 md:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
          <span className="font-semibold">Images</span>
          {total > 0 && <span className="text-sm text-muted-foreground">({total})</span>}
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

        {isKeyInvalid && (
          <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm" data-testid="error-api-key">
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
          <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm" data-testid="error-images">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <span className="text-destructive">{(error as Error).message}</span>
          </div>
        )}

        {!isLoading && !isError && images.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground" data-testid="empty-images">
            <ImageIcon className="h-10 w-10" />
            <p className="text-sm">No images yet. Upload one to get started.</p>
          </div>
        )}

        {!isLoading && !isError && images.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4" data-testid="grid-images">
              {images.map((item) => {
                const fullUrl = apiUrl ? buildUrl(apiUrl, item.image_url) : null;
                const date = formatDate(item.created_at);
                return (
                  <div
                    key={item.image_uuid}
                    className="rounded-md border bg-card overflow-hidden flex flex-col"
                    data-testid={`card-image-${item.image_uuid}`}
                  >
                    <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                      {fullUrl ? (
                        <img
                          src={fullUrl}
                          alt={item.original_filename}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="p-2 space-y-0.5">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-medium truncate" title={item.original_filename}>
                          {item.original_filename}
                        </p>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 shrink-0 -mt-0.5 -mr-0.5"
                              data-testid={`button-image-menu-${item.image_uuid}`}
                            >
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDelete(item)}
                              data-testid={`menu-delete-image-${item.image_uuid}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.face_count} face{item.face_count !== 1 ? "s" : ""}
                      </p>
                      {date && <p className="text-xs text-muted-foreground">{date}</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8" data-testid="pagination-images">
                <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} data-testid="button-prev-page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} data-testid="button-next-page">
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
                <p className="text-sm text-muted-foreground text-center truncate max-w-full">{selectedFile.name}</p>
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} data-testid="button-change-image">
                  Change image
                </Button>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">Drop an image here or click to browse</p>
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} data-testid="button-browse-image">
                  Select image
                </Button>
              </>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} data-testid="input-image-file" />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogOpenChange(false)} disabled={isUploading} data-testid="button-cancel-upload">
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!selectedFile || isUploading} data-testid="button-confirm-upload">
              {isUploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading…</> : "Add Image"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
