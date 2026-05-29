import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Card, CardContent } from "@/components/ui/card";
import { ImageIcon, Plus, ChevronLeft, ChevronRight, Upload, Loader2, AlertCircle, KeyRound, MoreVertical, Trash2, Scan, ChevronsUpDown, Check, UserRound, AtSign, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

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

type FaceDetail = {
  face_uuid: string;
  person_uuid?: string | null;
  person_name?: string | null;
  is_social?: boolean;
  social_username?: string | null;
  social_nickname?: string | null;
  box?: { x: number; y: number; w: number; h: number } | null;
};

type ImageDetail = {
  image_uuid: string;
  faces?: FaceDetail[];
};

type PersonOption = { uuid: string; name: string };
type SocialOption = { uuid: string; username: string; nickname?: string | null };

type FaceState = {
  isSocial: boolean;
  person: PersonOption | null;
  social: SocialOption | null;
};

function buildListThumbUrl(apiUrl: string, item: ImageItem): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (item.face_count > 0) return `${base}/img-sml/${item.image_uuid}.webp`;
  return `${base}/img/${item.image_uuid}.jpg`;
}

function buildFaceThumbUrl(apiUrl: string, faceUuid: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/face-img/${faceUuid}.webp`;
}

function buildFullImageUrl(apiUrl: string, imageUuid: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/img/${imageUuid}.jpg`;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return debounced;
}

function PersonSearch({ value, onChange }: { value: PersonOption | null; onChange: (p: PersonOption | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  const { data: mePerson } = useQuery<PersonOption | null>({
    queryKey: ["/api/people/me-person"],
    queryFn: async () => {
      const res = await fetch("/api/people/me-person", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: Infinity,
  });

  const { data: searchResults, isFetching } = useQuery<PersonOption[]>({
    queryKey: ["/api/people/search", debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/people/search?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.map((p: any) => ({ uuid: p.uuid, name: p.name })) : [];
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 10000,
  });

  const meMatchesQuery = !query || query.toLowerCase() === "me" ||
    (mePerson?.name?.toLowerCase().includes(query.toLowerCase()) ?? false);
  const filteredResults = (searchResults ?? []).filter((p) => p.uuid !== mePerson?.uuid);
  const showItems = mePerson && meMatchesQuery || filteredResults.length > 0;

  let statusMsg: string | null = null;
  if (query.length === 1) statusMsg = "Type 1 more character to search…";
  else if (debouncedQuery.length >= 2 && isFetching) statusMsg = null;
  else if (debouncedQuery.length >= 2 && !showItems) statusMsg = "No people found.";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between" data-testid="button-person-search-match">
          <span className="truncate">{value ? value.name : "None (orphan)"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search people…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandGroup>
              <CommandItem value="__none__" onSelect={() => { onChange(null); setOpen(false); setQuery(""); }}>
                <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                None (orphan)
              </CommandItem>
              {mePerson && meMatchesQuery && (
                <CommandItem value={mePerson.uuid} onSelect={() => { onChange(mePerson); setOpen(false); setQuery(""); }}>
                  <Check className={cn("mr-2 h-4 w-4", value?.uuid === mePerson.uuid ? "opacity-100" : "opacity-0")} />
                  <span className="flex items-center gap-1.5">
                    {mePerson.name}
                    <span className="text-xs text-muted-foreground">(Me)</span>
                  </span>
                </CommandItem>
              )}
              {filteredResults.map((p) => (
                <CommandItem key={p.uuid} value={p.uuid} onSelect={() => { onChange(p); setOpen(false); setQuery(""); }}>
                  <Check className={cn("mr-2 h-4 w-4", value?.uuid === p.uuid ? "opacity-100" : "opacity-0")} />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {isFetching && (
              <div className="py-4 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isFetching && statusMsg && (
              <div className="py-4 text-center text-sm text-muted-foreground">{statusMsg}</div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SocialSearch({ value, onChange }: { value: SocialOption | null; onChange: (s: SocialOption | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  const { data: results, isFetching } = useQuery<SocialOption[]>({
    queryKey: ["/api/social-accounts/paginated", debouncedQuery],
    queryFn: async () => {
      if (debouncedQuery.length < 3) return [];
      const res = await fetch(`/api/social-accounts/paginated?search=${encodeURIComponent(debouncedQuery)}&limit=30&offset=0`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      const accounts: any[] = Array.isArray(data) ? data : data.accounts ?? [];
      return accounts.map((a: any) => ({ uuid: a.uuid, username: a.username, nickname: a.currentProfile?.nickname ?? a.nickname ?? null }));
    },
    enabled: debouncedQuery.length >= 3,
    staleTime: 10000,
  });

  const displayName = (s: SocialOption) => s.nickname ? `${s.nickname} (@${s.username})` : `@${s.username}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between" data-testid="button-social-search-match">
          <span className="truncate">{value ? displayName(value) : "None (orphan)"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search accounts (3+ chars)…" value={query} onValueChange={setQuery} />
          <CommandList>
            {query.length < 3 ? (
              <CommandEmpty>Type at least 3 characters to search.</CommandEmpty>
            ) : isFetching ? (
              <CommandEmpty><Loader2 className="h-4 w-4 animate-spin mx-auto" /></CommandEmpty>
            ) : !results?.length ? (
              <CommandEmpty>No accounts found.</CommandEmpty>
            ) : (
              <CommandGroup>
                <CommandItem value="__none__" onSelect={() => { onChange(null); setOpen(false); setQuery(""); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                  None (orphan)
                </CommandItem>
                {results.map((s) => (
                  <CommandItem key={s.uuid} value={s.uuid} onSelect={() => { onChange(s); setOpen(false); setQuery(""); }}>
                    <Check className={cn("mr-2 h-4 w-4", value?.uuid === s.uuid ? "opacity-100" : "opacity-0")} />
                    {displayName(s)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#ec4899", "#14b8a6"];

function MatchModal({ item, apiUrl, onClose }: { item: ImageItem | null; apiUrl: string; onClose: () => void }) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [faceStates, setFaceStates] = useState<FaceState[]>([]);
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const { data: detail, isLoading, isError, error } = useQuery<ImageDetail>({
    queryKey: ["/api/prm-face/img/detail-enriched", item?.image_uuid],
    queryFn: async () => {
      const res = await fetch(`/api/prm-face/img/detail-enriched?uuid=${encodeURIComponent(item!.image_uuid)}`, { credentials: "include" });
      const text = await res.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { throw new Error("Unexpected server response."); }
      if (!res.ok) throw new Error(payload?.error ?? `Server error ${res.status}`);
      return payload;
    },
    enabled: !!item,
    staleTime: 0,
  });

  const faces: FaceDetail[] = detail?.faces ?? [];

  useEffect(() => {
    if (!detail) return;
    setNaturalSize(null);
    setFaceStates(
      (detail.faces ?? []).map((f) => {
        if (f.is_social && f.person_uuid && f.social_username) {
          return {
            isSocial: true,
            person: null,
            social: { uuid: f.person_uuid, username: f.social_username, nickname: f.social_nickname ?? null },
          };
        }
        return {
          isSocial: false,
          person: f.person_uuid && f.person_name ? { uuid: f.person_uuid, name: f.person_name } : null,
          social: null,
        };
      })
    );
  }, [detail]);

  const setFaceState = (i: number, patch: Partial<FaceState>) => {
    setFaceStates((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const pctBox = (box: { x: number; y: number; w: number; h: number }, nat: { w: number; h: number }) => ({
    left: `${(box.x / nat.w) * 100}%`,
    top: `${(box.y / nat.h) * 100}%`,
    width: `${(box.w / nat.w) * 100}%`,
    height: `${(box.h / nat.h) * 100}%`,
  });

  const handleSave = async () => {
    if (!item) return;
    setIsSaving(true);
    try {
      const assignments = faceStates
        .map((s, i) => {
          const face = faces[i];
          if (!face) return null;
          if (s.isSocial && s.social) {
            return { face_uuid: face.face_uuid, person_uuid: s.social.uuid, name: s.social.nickname ?? `@${s.social.username}` };
          }
          if (!s.isSocial && s.person) {
            return { face_uuid: face.face_uuid, person_uuid: s.person.uuid, name: s.person.name };
          }
          return null;
        })
        .filter(Boolean);

      const res = await fetch("/api/prm-face/face/assign-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const named = assignments.length;
      toast({ title: "Assignments saved", description: `${named} face${named !== 1 ? "s" : ""} linked to people.` });
      onClose();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const fullImageUrl = item && apiUrl ? buildFullImageUrl(apiUrl, item.image_uuid) : null;
  const hasFaces = faces.length > 0;
  const hasBoxes = faces.some((f) => f.box);

  return (
    <Dialog open={!!item} onOpenChange={(v) => { if (!v && !isSaving) onClose(); }}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] flex flex-col gap-0 p-0" data-testid="modal-match-image">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Identify Faces
            {hasFaces && (
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {faces.length} face{faces.length !== 1 ? "s" : ""} detected
              </span>
            )}
          </DialogTitle>
          {item && <DialogDescription className="text-xs truncate">{item.original_filename}</DialogDescription>}
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 pb-4 space-y-5">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {isError && (
            <div className="flex items-start gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
              <div className="text-destructive space-y-1">
                <p className="font-medium">Failed to load image details from PRM-Face.</p>
                {error instanceof Error && <p className="text-xs opacity-80">{error.message}</p>}
              </div>
            </div>
          )}

          {!isLoading && !isError && fullImageUrl && (
            <div className="relative inline-block max-w-full w-full" data-testid="container-match-image">
              <img
                ref={imgRef}
                src={fullImageUrl}
                alt={item?.original_filename ?? "Image"}
                className="max-w-full w-full rounded-md block"
                onLoad={() => {
                  if (imgRef.current) setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
                }}
                data-testid="img-match-full"
              />
              {hasBoxes && naturalSize && faces.map((face, i) => {
                if (!face.box) return null;
                const pos = pctBox(face.box, naturalSize);
                const color = COLORS[i % COLORS.length];
                return (
                  <div
                    key={face.face_uuid}
                    style={{ position: "absolute", left: pos.left, top: pos.top, width: pos.width, height: pos.height, border: `2.5px solid ${color}`, borderRadius: 3, boxSizing: "border-box", pointerEvents: "none" }}
                    data-testid={`match-face-box-${i}`}
                  >
                    <span style={{ position: "absolute", top: 2, right: 2, background: color, color: "#fff", fontSize: 11, fontWeight: 700, lineHeight: 1, padding: "2px 5px", borderRadius: 3, pointerEvents: "none" }}>
                      {i + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {!isLoading && !isError && !hasFaces && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <User className="h-8 w-8" />
              <p className="text-sm">No faces were detected in this image.</p>
            </div>
          )}

          {!isLoading && !isError && hasFaces && (
            <div className="space-y-3">
              {faces.map((face, i) => {
                const color = COLORS[i % COLORS.length];
                const state = faceStates[i] ?? { isSocial: false, person: null, social: null };
                const cropUrl = apiUrl ? buildFaceThumbUrl(apiUrl, face.face_uuid) : null;
                return (
                  <Card key={face.face_uuid} data-testid={`card-match-face-${i}`}>
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-center gap-3">
                        {cropUrl ? (
                          <div className="h-10 w-10 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                            <img src={cropUrl} alt={`Face ${i + 1}`} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <span
                            className="flex items-center justify-center rounded text-xs font-bold text-white shrink-0"
                            style={{ background: color, minWidth: 24, height: 24, padding: "0 6px" }}
                          >
                            {i + 1}
                          </span>
                        )}
                        <span className="text-sm font-medium">Face {i + 1}</span>
                        <div className="ml-auto flex items-center gap-2">
                          <Checkbox
                            id={`match-social-${i}`}
                            checked={state.isSocial}
                            onCheckedChange={(checked) => setFaceState(i, { isSocial: !!checked, person: null, social: null })}
                            data-testid={`checkbox-match-social-${i}`}
                          />
                          <label htmlFor={`match-social-${i}`} className="text-sm text-muted-foreground cursor-pointer select-none flex items-center gap-1">
                            {state.isSocial ? <AtSign className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                            Social account
                          </label>
                        </div>
                      </div>
                      {state.isSocial ? (
                        <SocialSearch value={state.social} onChange={(s) => setFaceState(i, { social: s })} />
                      ) : (
                        <PersonSearch value={state.person} onChange={(p) => setFaceState(i, { person: p })} />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 flex-row gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={isSaving} data-testid="button-cancel-match">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !hasFaces || isLoading} data-testid="button-save-match">
            {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Assignments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RecognitionImagesPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [matchItem, setMatchItem] = useState<ImageItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/prm-face/img/list"] });
  }, []);

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/prm-face/settings"],
  });
  const apiUrl = settings?.apiUrl ?? "";

  const { data, isLoading, isError, error } = useQuery<ListImagesResponse>({
    queryKey: ["/api/prm-face/img/list", page],
    queryFn: async () => {
      const res = await fetch(`/api/prm-face/img/list?page=${page}&page_size=${PAGE_SIZE}`, { credentials: "include" });
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
      const res = await fetch("/api/prm-face/img/add", { method: "POST", body: formData, credentials: "include" });
      const text = await res.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { payload = null; }
      if (!res.ok) {
        const msg = payload?.error ?? (text.startsWith("<") ? "Session may have expired — please refresh." : `Server error ${res.status}`);
        throw new Error(msg);
      }
      const facesDetected: number = payload?.faces_detected ?? 0;
      toast({ title: "Image added", description: `${facesDetected} face${facesDetected !== 1 ? "s" : ""} detected and stored.` });
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
      const res = await fetch(`/api/prm-face/img/delete?image_uuid=${encodeURIComponent(item.image_uuid)}`, { method: "DELETE", credentials: "include" });
      const text = await res.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { payload = null; }
      if (!res.ok) throw new Error(payload?.error ?? `Server error ${res.status}`);
      toast({ title: "Image deleted", description: item.original_filename });
      if (images.length === 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/prm-face/img/list", page] });
      }
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
    try { return new Date(val).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch { return val; }
  };

  return (
    <div className="h-full overflow-auto">
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
                const thumbUrl = apiUrl ? buildListThumbUrl(apiUrl, item) : null;
                const date = formatDate(item.created_at);
                return (
                  <div
                    key={item.image_uuid}
                    className="rounded-md border bg-card overflow-hidden flex flex-col"
                    data-testid={`card-image-${item.image_uuid}`}
                  >
                    <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt={item.original_filename} className="w-full h-full object-cover" loading="lazy" />
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
                            <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0 -mt-0.5 -mr-0.5" data-testid={`button-image-menu-${item.image_uuid}`}>
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {item.face_count > 0 && (
                              <DropdownMenuItem
                                onClick={() => setMatchItem(item)}
                                data-testid={`menu-match-image-${item.image_uuid}`}
                              >
                                <Scan className="h-3.5 w-3.5 mr-2" />
                                Match
                              </DropdownMenuItem>
                            )}
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
                  <img src={URL.createObjectURL(selectedFile)} alt="Preview" className="max-w-full max-h-48 object-contain" />
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

      {/* Match Modal */}
      <MatchModal item={matchItem} apiUrl={apiUrl} onClose={() => setMatchItem(null)} />
    </div>
  );
}
