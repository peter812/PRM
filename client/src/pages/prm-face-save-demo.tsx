import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Scan, Upload, AlertCircle, Loader2, ImageIcon, ChevronsUpDown, Check, UserRound, AtSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type FaceBox = { x: number; y: number; w: number; h: number };
type FaceResult = { face_uuid?: string; face_index?: number; box?: FaceBox };
type PickoutResult = { faces_detected?: number; faces: FaceResult[] };
type PrmFaceSettings = { apiUrl: string; hasApiKey: boolean };

type PersonOption = { uuid: string; name: string; imageUrl?: string | null };
type SocialOption = { uuid: string; username: string; nickname?: string | null };

type Assignment = {
  face_index: number;
  person_uuid?: string;
  social_account_id?: string;
  is_social_account: boolean;
  label?: string;
};

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#ec4899", "#14b8a6",
];

function PersonSearch({
  value,
  onChange,
}: {
  value: PersonOption | null;
  onChange: (p: PersonOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  const { data: results, isFetching } = useQuery<PersonOption[]>({
    queryKey: ["/api/people/search", debouncedQuery],
    queryFn: async () => {
      if (debouncedQuery.length < 3) return [];
      const res = await fetch(`/api/people/search?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.map((p: any) => ({ uuid: p.uuid, name: p.name, imageUrl: p.imageUrl })) : [];
    },
    enabled: debouncedQuery.length >= 3,
    staleTime: 10000,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          data-testid="button-person-search"
        >
          <span className="truncate">{value ? value.name : "None (orphan)"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search people (3+ chars)…"
            value={query}
            onValueChange={setQuery}
            data-testid="input-person-search"
          />
          <CommandList>
            {query.length < 3 ? (
              <CommandEmpty>Type at least 3 characters to search.</CommandEmpty>
            ) : isFetching ? (
              <CommandEmpty>
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
              </CommandEmpty>
            ) : !results?.length ? (
              <CommandEmpty>No people found.</CommandEmpty>
            ) : (
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  onSelect={() => { onChange(null); setOpen(false); setQuery(""); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                  None (orphan)
                </CommandItem>
                {results.map((p) => (
                  <CommandItem
                    key={p.uuid}
                    value={p.uuid}
                    onSelect={() => { onChange(p); setOpen(false); setQuery(""); }}
                    data-testid={`option-person-${p.uuid}`}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value?.uuid === p.uuid ? "opacity-100" : "opacity-0")} />
                    {p.name}
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

function SocialSearch({
  value,
  onChange,
}: {
  value: SocialOption | null;
  onChange: (s: SocialOption | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  const { data: results, isFetching } = useQuery<SocialOption[]>({
    queryKey: ["/api/social-accounts/paginated", debouncedQuery],
    queryFn: async () => {
      if (debouncedQuery.length < 3) return [];
      const res = await fetch(
        `/api/social-accounts/paginated?search=${encodeURIComponent(debouncedQuery)}&limit=30&offset=0`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      const data = await res.json();
      const accounts: any[] = Array.isArray(data) ? data : data.accounts ?? [];
      return accounts.map((a: any) => ({
        uuid: a.uuid,
        username: a.username,
        nickname: a.currentProfile?.nickname ?? a.nickname ?? null,
      }));
    },
    enabled: debouncedQuery.length >= 3,
    staleTime: 10000,
  });

  const displayName = (s: SocialOption) => s.nickname ? `${s.nickname} (@${s.username})` : `@${s.username}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          data-testid="button-social-search"
        >
          <span className="truncate">{value ? displayName(value) : "None (orphan)"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search accounts (3+ chars)…"
            value={query}
            onValueChange={setQuery}
            data-testid="input-social-search"
          />
          <CommandList>
            {query.length < 3 ? (
              <CommandEmpty>Type at least 3 characters to search.</CommandEmpty>
            ) : isFetching ? (
              <CommandEmpty>
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
              </CommandEmpty>
            ) : !results?.length ? (
              <CommandEmpty>No accounts found.</CommandEmpty>
            ) : (
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  onSelect={() => { onChange(null); setOpen(false); setQuery(""); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                  None (orphan)
                </CommandItem>
                {results.map((s) => (
                  <CommandItem
                    key={s.uuid}
                    value={s.uuid}
                    onSelect={() => { onChange(s); setOpen(false); setQuery(""); }}
                    data-testid={`option-social-${s.uuid}`}
                  >
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

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

type FaceState = {
  isSocial: boolean;
  person: PersonOption | null;
  social: SocialOption | null;
};

function IdentificationModal({
  open,
  onClose,
  imageDataUrl,
  imageFile,
  faces,
}: {
  open: boolean;
  onClose: () => void;
  imageDataUrl: string;
  imageFile: File;
  faces: FaceResult[];
}) {
  const { toast } = useToast();
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [faceStates, setFaceStates] = useState<FaceState[]>(() =>
    faces.map(() => ({ isSocial: false, person: null, social: null }))
  );

  useEffect(() => {
    setFaceStates(faces.map(() => ({ isSocial: false, person: null, social: null })));
    setNaturalSize(null);
  }, [faces, open]);

  const handleImageLoad = () => {
    if (!imgRef.current) return;
    setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
  };

  const pctBox = (box: FaceBox, nat: { w: number; h: number }) => ({
    left: `${(box.x / nat.w) * 100}%`,
    top: `${(box.y / nat.h) * 100}%`,
    width: `${(box.w / nat.w) * 100}%`,
    height: `${(box.h / nat.h) * 100}%`,
  });

  const setFaceState = (i: number, patch: Partial<FaceState>) => {
    setFaceStates((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const assignments: Assignment[] = faceStates.map((s, i) => ({
        face_index: i,
        ...(s.isSocial
          ? { social_account_id: s.social?.uuid, is_social_account: true, label: s.social ? `@${s.social.username}` : undefined }
          : { person_uuid: s.person?.uuid, is_social_account: false, label: s.person?.name }),
      }));

      const formData = new FormData();
      formData.append("image", imageFile);
      formData.append("assignments", JSON.stringify(assignments));

      const res = await fetch("/api/prm-face/save-with-assignments", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const named = assignments.filter((a) => a.person_uuid || a.social_account_id).length;
      toast({
        title: "Image saved",
        description: `Saved to PRM-Face with ${named} identified face${named !== 1 ? "s" : ""}.`,
      });
      onClose();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isSaving) onClose(); }}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] flex flex-col gap-0 p-0" data-testid="modal-identification">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Identify Faces
            <span className="ml-auto text-sm font-normal text-muted-foreground">
              {faces.length} face{faces.length !== 1 ? "s" : ""} detected
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 pb-4 space-y-5">
          <div className="relative inline-block max-w-full w-full" data-testid="container-modal-image">
            <img
              ref={imgRef}
              src={imageDataUrl}
              alt="Uploaded"
              className="max-w-full w-full rounded-md block"
              onLoad={handleImageLoad}
              data-testid="img-modal-uploaded"
            />
            {naturalSize && faces.map((face, i) => {
              if (!face.box) return null;
              const pos = pctBox(face.box, naturalSize);
              const color = COLORS[i % COLORS.length];
              return (
                <div
                  key={face.face_uuid ?? face.face_index ?? i}
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
                  data-testid={`modal-face-box-${i}`}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      background: color,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: 1,
                      padding: "2px 5px",
                      borderRadius: 3,
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                    }}
                    data-testid={`modal-face-number-${i}`}
                  >
                    {i + 1}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            {faces.map((face, i) => {
              const color = COLORS[i % COLORS.length];
              const state = faceStates[i] ?? { isSocial: false, person: null, social: null };
              return (
                <Card key={face.face_uuid ?? face.face_index ?? i} data-testid={`card-face-${i}`}>
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex items-center justify-center rounded text-xs font-bold text-white shrink-0"
                        style={{ background: color, minWidth: 24, height: 24, padding: "0 6px" }}
                        data-testid={`badge-face-number-${i}`}
                      >
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium">Face {i + 1}</span>
                      <div className="ml-auto flex items-center gap-2">
                        <Checkbox
                          id={`social-check-${i}`}
                          checked={state.isSocial}
                          onCheckedChange={(checked) =>
                            setFaceState(i, { isSocial: !!checked, person: null, social: null })
                          }
                          data-testid={`checkbox-social-${i}`}
                        />
                        <label
                          htmlFor={`social-check-${i}`}
                          className="text-sm text-muted-foreground cursor-pointer select-none flex items-center gap-1"
                        >
                          {state.isSocial ? <AtSign className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                          Social account
                        </label>
                      </div>
                    </div>

                    {state.isSocial ? (
                      <SocialSearch
                        value={state.social}
                        onChange={(s) => setFaceState(i, { social: s })}
                      />
                    ) : (
                      <PersonSearch
                        value={state.person}
                        onChange={(p) => setFaceState(i, { person: p })}
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 flex-row gap-2 justify-end">
          <Button variant="outline" onClick={onClose} disabled={isSaving} data-testid="button-cancel-save">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} data-testid="button-confirm-save">
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save to PRM-Face"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PrmFaceSaveDemoPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [faces, setFaces] = useState<FaceResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

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
        setImageFile(file);
        setFaces([]);
        setModalOpen(false);

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
          const detectedFaces = data.faces || [];
          setFaces(detectedFaces);

          if (detectedFaces.length === 0) {
            toast({ title: "No faces detected", description: "PRM-Face did not find any faces in this image." });
          } else {
            setModalOpen(true);
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
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-full md:max-w-4xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
        <div className="space-y-2 mb-6">
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-prm-face-save-demo-title">
            <Scan className="h-6 w-6" />
            PRM-Face Save Demo
          </h1>
          <p className="text-muted-foreground">
            Upload a photo, identify each detected face by linking it to a person or social account, then save the image permanently to PRM-Face.
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

          {imageDataUrl && faces.length > 0 && !modalOpen && (
            <Card data-testid="card-reopen">
              <CardContent className="pt-4 pb-4 flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  {faces.length} face{faces.length !== 1 ? "s" : ""} detected in the last image.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setModalOpen(true)}
                  data-testid="button-reopen-modal"
                >
                  <Scan className="h-4 w-4 mr-2" />
                  Identify &amp; Save
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {imageDataUrl && imageFile && (
        <IdentificationModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          imageDataUrl={imageDataUrl}
          imageFile={imageFile}
          faces={faces}
        />
      )}
    </div>
  );
}
