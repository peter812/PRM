// Faces (face-review-plan.md §5): known identities — face groups already
// linked to a person and/or a social account. Browse, search, open the
// person/account, merge two identities together, or pull a mistaken face
// back out of a group.
import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Search,
  Loader2,
  Users,
  ImageOff,
  ArrowUpDown,
  User,
  AtSign,
  ExternalLink,
  ImageIcon,
  X,
  Merge,
  MessageSquare,
  Clapperboard,
  StickyNote,
  Handshake,
  MapPin,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { withImageSize } from "@shared/image-size";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { FaceBoxOverlay, faceColor, type OverlayFace } from "@/components/face-box-overlay";

const PAGE_SIZE = 60;

type KnownFaceAccount = { id: string; username: string; nickname: string | null; imageUrl: string | null };
type KnownFacePerson = { id: string; name: string };
type KnownFaceListItem = {
  personfaceUuid: string;
  cropUrl: string | null;
  person: KnownFacePerson | null;
  people?: KnownFacePerson[];
  accounts: KnownFaceAccount[];
  photoCount: number;
  lastSeenAt: string | null;
};
type ListKnownFacesResult = { items: KnownFaceListItem[]; nextCursor: string | null };
type LikelySamePair = {
  groupA: KnownFaceListItem;
  groupB: KnownFaceListItem;
  score: number;
};

type ResolvedPhotoSource = { type: string; id: string; label: string; href: string; sublabel?: string };
type KnownFaceDetailPhoto = {
  photoId: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  faces: { faceUuid: string; box: { x: number; y: number; w: number; h: number } | null; autoMatchScore: number | null }[];
  uploadedAt: string | null;
  source: ResolvedPhotoSource | null;
};
type KnownFaceDetail = { header: KnownFaceListItem; photos: KnownFaceDetailPhoto[] };

function identityTitle(item: KnownFaceListItem): string {
  const people = item.people && item.people.length > 0 ? item.people : item.person ? [item.person] : [];
  if (people.length > 1) {
    return people.map((p) => p.name || "Unnamed").join(" & ");
  }
  if (people.length === 1) return people[0].name || "Unnamed";
  if (item.accounts.length > 1) {
    return item.accounts.map((a) => `@${a.username}`).slice(0, 2).join(", ") + (item.accounts.length > 2 ? ` (+${item.accounts.length - 2})` : "");
  }
  return item.accounts[0]?.username ? `@${item.accounts[0].username}` : "Unknown";
}

/** Person cards: @usernames under the name. Account-only cards: the nickname under the @username. Multi-profile cards: count badges. */
function identitySubtitle(item: KnownFaceListItem): string | null {
  const people = item.people && item.people.length > 0 ? item.people : item.person ? [item.person] : [];
  if (people.length > 0) {
    const parts: string[] = [];
    if (people.length > 1) parts.push(`${people.length} profiles`);
    if (item.accounts.length) parts.push(item.accounts.map((a) => `@${a.username}`).join(", "));
    return parts.join(" · ") || null;
  }
  if (item.accounts.length > 1) {
    return `${item.accounts.length} accounts`;
  }
  return item.accounts[0]?.nickname ?? null;
}

function formatLastSeen(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const SOURCE_ICONS: Record<string, typeof User> = {
  person: User,
  social_account: AtSign,
  post: ImageIcon,
  story: Clapperboard,
  group: Users,
  note: StickyNote,
  interaction: Handshake,
  message: MessageSquare,
};

function SourceIcon({ type }: { type: string }) {
  const Icon = SOURCE_ICONS[type] ?? MapPin;
  return <Icon className="h-3 w-3 shrink-0" />;
}

async function invalidateFacesQueries() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["/api/faces"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/faces/likely-same"] }),
  ]);
}

export default function FacesPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "count">("recent");
  const [openIdentity, setOpenIdentity] = useState<string | null>(null);
  const [likelySameOpen, setLikelySameOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: likelySameData } = useQuery<{ pairs: LikelySamePair[] }>({
    queryKey: ["/api/faces/likely-same"],
    queryFn: async () => {
      const res = await fetch("/api/faces/likely-same", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load likely same faces");
      return res.json();
    },
  });
  const likelySameCount = likelySameData?.pairs?.length ?? 0;

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery<ListKnownFacesResult>({
    queryKey: ["/api/faces", "grid", debouncedSearch, sort],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ sort, limit: String(PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/faces?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load faces");
      return res.json();
    },
    initialPageParam: "" as string,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b sticky top-0 backdrop-blur-xl bg-background/70 z-20">
        <Users className="h-4 w-4 text-muted-foreground shrink-0" />
        <h1 className="text-lg font-semibold leading-none mr-2">Faces</h1>
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or username…"
            className="pl-8 h-8"
            data-testid="input-search-faces"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setSort((s) => (s === "recent" ? "count" : "recent"))}
          data-testid="button-toggle-sort"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {sort === "count" ? "Most photos" : "Recently seen"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 ml-auto border-primary/30 text-primary hover:bg-primary/10"
          onClick={() => setLikelySameOpen(true)}
          data-testid="button-likely-same"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Likely Same
          {likelySameCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-primary text-primary-foreground font-semibold">
              {likelySameCount}
            </span>
          )}
        </Button>
      </div>

      {isLoading && (
        <div className="p-3">
          <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <Skeleton className="aspect-square w-full rounded-full" />
                <Skeleton className="h-2.5 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      )}

      {isError && (
        <div className="px-4 py-8 text-sm text-destructive">Failed to load faces. Please refresh.</div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <ImageOff className="h-10 w-10" />
          <p className="text-sm">{debouncedSearch ? "No matching identities." : "No known faces yet."}</p>
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className="p-3">
          <div
            className="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10"
            data-testid="grid-faces"
          >
            {items.map((item) => (
              <button
                key={item.personfaceUuid}
                type="button"
                onClick={() => setOpenIdentity(item.personfaceUuid)}
                className="flex flex-col items-center gap-1.5 group"
                data-testid={`card-identity-${item.personfaceUuid}`}
              >
                <div className="aspect-square w-full rounded-full overflow-hidden bg-muted ring-1 ring-border group-hover:ring-2 group-hover:ring-primary transition-all">
                  {item.cropUrl ? (
                    <img src={withImageSize(item.cropUrl, 128)} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <User className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="w-full text-center leading-tight">
                  <p className="text-xs font-medium truncate" title={identityTitle(item)}>
                    {identityTitle(item)}
                  </p>
                  {identitySubtitle(item) && (
                    <p className="text-[11px] text-muted-foreground truncate" title={identitySubtitle(item) ?? undefined}>
                      {identitySubtitle(item)}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground/80 truncate">
                    {item.photoCount} photo{item.photoCount !== 1 ? "s" : ""}
                    {formatLastSeen(item.lastSeenAt) ? ` · ${formatLastSeen(item.lastSeenAt)}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div ref={sentinelRef} className="h-12 flex items-center justify-center">
            {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
      )}

      {openIdentity && (
        <IdentityDialog personfaceUuid={openIdentity} onClose={() => setOpenIdentity(null)} />
      )}

      {likelySameOpen && (
        <LikelySameDialog open={likelySameOpen} onClose={() => setLikelySameOpen(false)} />
      )}
    </div>
  );
}

function IdentityDialog({
  personfaceUuid,
  onClose,
}: {
  personfaceUuid: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ faceUuid: string; label: string } | null>(null);

  const { data: detail, isLoading, isError } = useQuery<KnownFaceDetail>({
    queryKey: ["/api/faces", personfaceUuid],
    queryFn: async () => {
      const res = await fetch(`/api/faces/${personfaceUuid}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load identity");
      return res.json();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (faceUuid: string) => {
      const res = await apiRequest("POST", "/api/faces/remove-from-group", { faceUuid });
      return res.json();
    },
    onSuccess: async () => {
      await invalidateFacesQueries();
      toast({ title: "Face removed from group" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove face", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl">
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (isError || !detail) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl">
          <p className="text-sm text-destructive py-8 text-center">Failed to load this identity.</p>
        </DialogContent>
      </Dialog>
    );
  }

  const { header, photos } = detail;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full overflow-hidden bg-muted shrink-0">
              {header.cropUrl ? (
                <img src={withImageSize(header.cropUrl, 128)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <User className="h-5 w-5" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate">{identityTitle(header)}</div>
              {identitySubtitle(header) && (
                <div className="text-xs font-normal text-muted-foreground truncate">{identitySubtitle(header)}</div>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {(header.people && header.people.length > 0 ? header.people : header.person ? [header.person] : []).map((p) => (
            <Link key={p.id} href={`/person/${p.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid={`link-open-person-${p.id}`}>
                <User className="h-3.5 w-3.5" />
                {header.people && header.people.length > 1 ? `Open ${p.name}` : "Open person"}
              </Button>
            </Link>
          ))}
          {header.accounts.map((a) => (
            <Link key={a.id} href={`/social-accounts/${a.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid={`link-open-account-${a.id}`}>
                <AtSign className="h-3.5 w-3.5" />@{a.username}
              </Button>
            </Link>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 ml-auto"
            onClick={() => setMergeOpen(true)}
            data-testid="button-merge-with"
          >
            <Merge className="h-3.5 w-3.5" />
            Merge with…
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          {header.photoCount} photo{header.photoCount !== 1 ? "s" : ""}
        </div>

        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No photos yet.</p>
        ) : (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            {photos.map((photo) => {
              const overlayFaces: OverlayFace[] = photo.faces.map((f, i) => ({
                key: f.faceUuid,
                box: f.box,
                color: faceColor(i),
                variant: "solid",
                autoScore: f.autoMatchScore,
              }));
              return (
                <div key={photo.photoId} className="rounded-md border overflow-hidden bg-card flex flex-col">
                  <FaceBoxOverlay
                    src={withImageSize(photo.imageUrl, 480)}
                    faces={overlayFaces}
                    width={photo.width}
                    height={photo.height}
                    imgClassName="w-full h-auto object-cover"
                    onRemove={(key) => {
                      const i = photo.faces.findIndex((f) => f.faceUuid === key);
                      setRemoveTarget({ faceUuid: key, label: photo.faces.length > 1 ? `Not them (face ${i + 1})` : "Not them" });
                    }}
                  />
                  <div className="p-2 space-y-1.5">
                    {photo.source ? (
                      <div className="flex items-start gap-1.5 text-xs">
                        <div className="mt-0.5 text-muted-foreground">
                          <SourceIcon type={photo.source.type} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{photo.source.label}</p>
                          {photo.source.sublabel && (
                            <p className="text-muted-foreground truncate">{photo.source.sublabel}</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Source unavailable</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {photo.source && (
                        <Link href={photo.source.href}>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 gap-1 text-xs" data-testid={`link-source-${photo.photoId}`}>
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </Button>
                        </Link>
                      )}
                      <Link href={`/image/${photo.photoId}`}>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 gap-1 text-xs" data-testid={`link-image-${photo.photoId}`}>
                          <ImageIcon className="h-3 w-3" />
                          Image
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>

      {mergeOpen && <MergeDialog current={header} onClose={() => setMergeOpen(false)} />}

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removeTarget?.label ?? "Remove this face?"}</AlertDialogTitle>
            <AlertDialogDescription>
              This photo's face will no longer be counted as {identityTitle(header)}. It moves to its own group and
              can be reviewed again in Face review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeTarget) removeMutation.mutate(removeTarget.faceUuid);
                setRemoveTarget(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function MergeDialog({
  current,
  onClose,
}: {
  current: KnownFaceListItem;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<KnownFaceListItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<ListKnownFacesResult>({
    queryKey: ["/api/faces", "merge-search", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ sort: "count", limit: "20" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/faces?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to search identities");
      return res.json();
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async (target: KnownFaceListItem) => {
      await apiRequest("POST", "/api/faces/merge", { keep: current.personfaceUuid, merge: target.personfaceUuid });
    },
    onSuccess: async () => {
      await invalidateFacesQueries();
      toast({ title: "Identities merged" });
      onClose();
    },
    onError: (err: Error) => {
      const message = err.message.replace(/^\d+:\s*/, "");
      toast({ title: "Merge failed", description: message, variant: "destructive" });
    },
  });

  const candidates = (data?.items ?? []).filter((i) => i.personfaceUuid !== current.personfaceUuid);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge with…</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or username…"
            className="pl-8"
            autoFocus
            data-testid="input-merge-search"
          />
        </div>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {debouncedSearch ? "No matches." : "No other known faces yet."}
            </p>
          )}
          {candidates.map((c) => (
            <button
              key={c.personfaceUuid}
              type="button"
              className="w-full flex items-center gap-2.5 p-2 rounded-md hover-elevate text-left"
              onClick={() => setConfirmTarget(c)}
              data-testid={`row-merge-candidate-${c.personfaceUuid}`}
            >
              <div className="h-8 w-8 rounded-full overflow-hidden bg-muted shrink-0">
                {c.cropUrl ? (
                  <img src={withImageSize(c.cropUrl, 64)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{identityTitle(c)}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.photoCount} photo{c.photoCount !== 1 ? "s" : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={!!confirmTarget} onOpenChange={(v) => !v && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge identities?</AlertDialogTitle>
            <AlertDialogDescription>
              Fold {confirmTarget ? identityTitle(confirmTarget) : ""}'s {confirmTarget?.photoCount ?? 0} photo
              {confirmTarget?.photoCount !== 1 ? "s" : ""} into {identityTitle(current)}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTarget) mergeMutation.mutate(confirmTarget);
                setConfirmTarget(null);
              }}
            >
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function LikelySameDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [index, setIndex] = useState(0);

  const { data, isLoading } = useQuery<{ pairs: LikelySamePair[] }>({
    queryKey: ["/api/faces/likely-same"],
    queryFn: async () => {
      const res = await fetch("/api/faces/likely-same", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load likely same faces");
      return res.json();
    },
    enabled: open,
  });

  const pairs = data?.pairs ?? [];
  const currentPair = pairs[index];

  useEffect(() => {
    if (pairs.length > 0 && index >= pairs.length) {
      setIndex(0);
    }
  }, [pairs.length, index]);

  const mergeMutation = useMutation({
    mutationFn: async ({ keep, merge }: { keep: string; merge: string }) => {
      await apiRequest("POST", "/api/faces/merge", { keep, merge });
    },
    onSuccess: async () => {
      await invalidateFacesQueries();
      toast({ title: "Faces merged successfully" });
    },
    onError: (err: Error) => {
      const message = err.message.replace(/^\d+:\s*/, "");
      toast({ title: "Merge failed", description: message, variant: "destructive" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ groupA, groupB }: { groupA: string; groupB: string }) => {
      await apiRequest("POST", "/api/faces/likely-same/dismiss", { groupA, groupB });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/faces/likely-same"] });
      toast({ title: "Marked as not same" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to dismiss pair", description: err.message, variant: "destructive" });
    },
  });

  const handleMerge = async (keepItem: KnownFaceListItem, mergeItem: KnownFaceListItem) => {
    await mergeMutation.mutateAsync({
      keep: keepItem.personfaceUuid,
      merge: mergeItem.personfaceUuid,
    });
  };

  const handleNotSame = async () => {
    if (!currentPair) return;
    await dismissMutation.mutateAsync({
      groupA: currentPair.groupA.personfaceUuid,
      groupB: currentPair.groupB.personfaceUuid,
    });
  };

  const handleSkip = () => {
    if (pairs.length > 1) {
      setIndex((i) => (i + 1) % pairs.length);
    }
  };

  const isBusy = mergeMutation.isPending || dismissMutation.isPending;

  const renderSide = (item: KnownFaceListItem, otherItem: KnownFaceListItem, side: "A" | "B") => {
    const title = identityTitle(item);
    const subtitle = identitySubtitle(item);
    const peopleList = item.people && item.people.length > 0 ? item.people : item.person ? [item.person] : [];

    return (
      <div className="flex-1 flex flex-col items-center p-4 rounded-xl border bg-card/60 shadow-sm text-center">
        <div className="aspect-square w-28 h-28 rounded-full overflow-hidden bg-muted ring-2 ring-primary/20 mb-3 shrink-0 shadow-sm">
          {item.cropUrl ? (
            <img src={withImageSize(item.cropUrl, 360)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <User className="h-10 w-10" />
            </div>
          )}
        </div>
        <div className="w-full mb-3 min-w-0">
          <h3 className="font-semibold text-base truncate" title={title}>
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate mt-0.5" title={subtitle}>
              {subtitle}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            {item.photoCount} photo{item.photoCount !== 1 ? "s" : ""}
            {formatLastSeen(item.lastSeenAt) ? ` · Last seen ${formatLastSeen(item.lastSeenAt)}` : ""}
          </p>
        </div>

        {/* Linked accounts and person profile chips */}
        <div className="w-full flex flex-wrap justify-center gap-1.5 mb-4 max-h-24 overflow-y-auto">
          {peopleList.map((p) => (
            <Link key={p.id} href={`/person/${p.id}`} target="_blank">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground hover:underline cursor-pointer">
                <User className="h-3 w-3" />
                {p.name}
              </span>
            </Link>
          ))}
          {item.accounts.map((a) => (
            <Link key={a.id} href={`/social-accounts/${a.id}`} target="_blank">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:underline cursor-pointer">
                <AtSign className="h-3 w-3" />
                {a.username}
              </span>
            </Link>
          ))}
        </div>

        {/* Merge button below account: "Merge to {account/person}" */}
        <div className="mt-auto w-full pt-2">
          <Button
            className="w-full gap-1.5"
            disabled={isBusy}
            onClick={() => handleMerge(item, otherItem)}
            data-testid={`button-merge-to-${side}-${item.personfaceUuid}`}
          >
            {mergeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Merge className="h-4 w-4" />
            )}
            Merge to {title}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between mr-6">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              Likely Same Faces
            </DialogTitle>
            {currentPair && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                {Math.round(currentPair.score * 100)}% Match
              </span>
            )}
          </div>
          {currentPair && (
            <DialogDescription>
              Candidate {index + 1} of {pairs.length} — Choose which identity to merge into, or mark as not the same.
            </DialogDescription>
          )}
        </DialogHeader>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Scanning known faces for matches…</p>
          </div>
        )}

        {!isLoading && !currentPair && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-semibold text-base">No Likely Matches</h4>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                All known faces have been compared. No candidate duplicates above the similarity threshold were found.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onClose} className="mt-2">
              Close
            </Button>
          </div>
        )}

        {!isLoading && currentPair && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch gap-4 relative">
              {renderSide(currentPair.groupA, currentPair.groupB, "A")}
              <div className="hidden sm:flex items-center justify-center -mx-2 z-10">
                <span className="px-2.5 py-1 rounded-full bg-muted border text-[11px] font-bold text-muted-foreground shadow-sm">
                  VS
                </span>
              </div>
              {renderSide(currentPair.groupB, currentPair.groupA, "B")}
            </div>

            <DialogFooter className="flex items-center justify-between sm:justify-between border-t pt-3 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-foreground"
                disabled={isBusy}
                onClick={handleSkip}
                data-testid="button-likely-same-skip"
              >
                Skip
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                disabled={isBusy}
                onClick={handleNotSame}
                data-testid="button-likely-same-not-same"
              >
                {dismissMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                No, Not Same
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

