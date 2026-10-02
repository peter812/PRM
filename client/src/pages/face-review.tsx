// Face review queue (face-review-plan.md §4). Replaces the old /unknown-faces
// grid: one photo at a time, boxes drawn over unidentified faces, suggestion
// and look-alike chips to assign them, or "not someone I track" to dismiss.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, X, UserX, Settings, SkipForward, Wand2, MoreVertical, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getInitials, cn } from "@/lib/utils";
import { popConfetti } from "@/lib/confetti";
import { withImageSize } from "@shared/image-size";
import { FaceBoxOverlay, type OverlayFace } from "@/components/face-box-overlay";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNoFaceToggle } from "@/components/no-face-account";
import type { Person, SocialAccount } from "@shared/schema";

type FaceReviewKind = "story" | "profile" | "post" | "message";
const KINDS: FaceReviewKind[] = ["story", "profile", "post", "message"];
const KIND_LABEL: Record<FaceReviewKind, string> = { story: "Stories", profile: "Profile images", post: "Posts", message: "Messages" };

type FaceReviewCounts = Record<FaceReviewKind, number> & { total: number; dismissed: number };

type FaceReviewSuggestion = {
  socialAccountId?: string;
  personId?: string;
  username?: string;
  imageUrl?: string | null;
  ownerName?: string | null;
  label: string;
  reason: "owner" | "coauthor" | "mentioned" | "profile_account" | "sender" | "participant";
};

type FaceReviewFaceLookAlike = {
  personfaceUuid: string;
  score: number;
  socialAccountId?: string;
  personId?: string;
  label: string;
  cropUrl: string;
};

type FaceReviewFace = {
  faceUuid: string;
  number: number;
  box: { x: number; y: number; w: number; h: number } | null;
  cropUrl: string;
  color: string;
  identified: { socialAccountId?: string; personId?: string; label: string } | null;
  dismissed: boolean;
  /** Set when PRM auto-assigned this face and nobody has confirmed it. */
  autoMatchScore: number | null;
  lookAlikes: FaceReviewFaceLookAlike[];
};

type FaceReviewItem = {
  photoId: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  kind: FaceReviewKind;
  postId?: string;
  slide?: number;
  messageId?: string;
  conversationId?: string;
  postedAt?: string;
  caption?: string;
  account: { id: string; username: string; imageUrl: string | null; ownerId: string | null; ownerName: string | null; noFace: boolean } | null;
  faces: FaceReviewFace[];
  suggestions: FaceReviewSuggestion[];
  profileLinkReason?: string;
};

type FaceReviewPage = { items: FaceReviewItem[]; nextCursor: string | null };

type AutoRecognitionSettings = {
  profile: { face: boolean };
  post: { face: boolean; ocr: boolean; transcribe: boolean };
  story: { face: boolean; ocr: boolean; transcribe: boolean };
  message: { face: boolean };
};

const SUGGESTION_COPY: Record<string, string> = {
  owner: "(posted this)",
  coauthor: "(coauthor)",
  mentioned: "(mentioned)",
  profile_account: "",
  sender: "(sent this)",
  participant: "(in this conversation)",
};

function suggestionLabel(kind: FaceReviewKind, s: FaceReviewSuggestion): string {
  if (kind === "post" && s.reason === "mentioned") return `${s.label} (tagged on this slide)`;
  return `${s.label} ${SUGGESTION_COPY[s.reason] ?? ""}`.trim();
}

function contextLine(item: FaceReviewItem): string {
  if (item.kind === "story") return "Story";
  if (item.kind === "post") return item.slide !== undefined ? `Slide ${item.slide + 1}` : "Post";
  if (item.kind === "message") return item.caption ? `Conversation: ${item.caption}` : "Message";
  return "Profile image";
}

/** Photos around the current one whose images are warmed in the browser cache (previous, next two). */
const PRELOAD_OFFSETS = [1, 2, -1];

/** Every image URL the page renders for a photo, built exactly as the JSX builds them so they hit the cache. */
function reviewImageUrls(item: FaceReviewItem): string[] {
  return [
    withImageSize(item.imageUrl, 1080),
    ...(item.account?.imageUrl ? [item.account.imageUrl] : []),
    ...item.faces.flatMap((f) => [withImageSize(f.cropUrl, 128), ...f.lookAlikes.map((la) => withImageSize(la.cropUrl, 64))]),
  ];
}

export default function FaceReviewPage() {
  const { toast } = useToast();
  const noFace = useNoFaceToggle();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const kind = (KINDS.includes(params.get("tab") as FaceReviewKind) ? params.get("tab") : "story") as FaceReviewKind;
  const dismissedFilter = params.get("dismissed") === "1";

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    navigate(`/face-review?${next.toString()}`);
  };

  const { data: counts } = useQuery<FaceReviewCounts>({
    queryKey: ["/api/face-review/counts"],
    refetchInterval: 15_000,
  });
  const { data: autoSettings } = useQuery<AutoRecognitionSettings>({ queryKey: ["/api/recognition/auto"] });

  const queueQuery = useInfiniteQuery<FaceReviewPage>({
    queryKey: ["/api/face-review", kind, dismissedFilter],
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ kind, limit: "20" });
      if (dismissedFilter) p.set("dismissed", "1");
      if (pageParam) p.set("cursor", pageParam as string);
      const res = await fetch(`/api/face-review?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load face review queue");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) => {
      // If queue is empty, poll every 10s so newly processed faces appear automatically
      const totalItems = query.state.data?.pages.flatMap((p) => p.items).length ?? 0;
      return totalItems === 0 ? 10_000 : false;
    },
  });

  const items = useMemo(() => queueQuery.data?.pages.flatMap((p) => p.items) ?? [], [queueQuery.data]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [kind, dismissedFilter]);

  // Keep index within bounds whenever items change (e.g. on filter change, queue refresh or page fetch)
  useEffect(() => {
    if (items.length > 0 && index >= items.length) {
      setIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, index]);

  // Prefetch next page when nearing the end of currently loaded items
  useEffect(() => {
    if (index >= items.length - 3 && queueQuery.hasNextPage && !queueQuery.isFetchingNextPage) {
      queueQuery.fetchNextPage();
    }
  }, [index, items.length, queueQuery.hasNextPage, queueQuery.isFetchingNextPage]);

  // If waiting for next page to step forward, advance as soon as new items arrive
  const waitingForMoreRef = useRef(false);
  useEffect(() => {
    if (waitingForMoreRef.current && items.length > index + 1) {
      waitingForMoreRef.current = false;
      setIndex((i) => i + 1);
    }
  }, [items.length, index]);

  useEffect(() => {
    if (!queueQuery.isFetchingNextPage && !queueQuery.hasNextPage) {
      waitingForMoreRef.current = false;
    }
  }, [queueQuery.isFetchingNextPage, queueQuery.hasNextPage]);

  const item = items[index];

  const canGoNext = index < items.length - 1 || queueQuery.hasNextPage;
  const handleNext = () => {
    if (index < items.length - 1) {
      setIndex((i) => i + 1);
    } else if (queueQuery.hasNextPage && !queueQuery.isFetchingNextPage) {
      waitingForMoreRef.current = true;
      queueQuery.fetchNextPage();
    }
  };

  // Warm the neighbouring photos' images so stepping to them is instant. The Image objects are kept
  // until the next run so in-flight loads aren't dropped; decode() readies them for an immediate paint.
  const preloaded = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    const urls = PRELOAD_OFFSETS.flatMap((o) => (items[index + o] ? reviewImageUrls(items[index + o]) : []));
    preloaded.current = Array.from(new Set(urls)).map((url) => {
      const img = new Image();
      img.src = url;
      img.decode().catch(() => {});
      return img;
    });
  }, [items, index]);
  const [focusedFace, setFocusedFace] = useState<string | null>(null);
  // Keep the focused face's row visible when the face list scrolls.
  useEffect(() => {
    if (focusedFace) document.querySelector(`[data-testid="row-face-${focusedFace}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusedFace]);
  const [searchFace, setSearchFace] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const currentPhotoId = useRef<string | undefined>(undefined);
  currentPhotoId.current = item?.photoId;

  // Replace the photo in every cached page with a refreshed copy (after assign/dismiss). Identical
  // images share their faces, so the same face in other queued photos takes the new state too.
  function patchItem(updated: FaceReviewItem) {
    const faceState = new Map(updated.faces.map((f) => [f.faceUuid, { identified: f.identified, dismissed: f.dismissed, autoMatchScore: f.autoMatchScore }]));
    const sync = (it: FaceReviewItem): FaceReviewItem =>
      it.faces.some((f) => faceState.has(f.faceUuid))
        ? { ...it, faces: it.faces.map((f) => (faceState.has(f.faceUuid) ? { ...f, ...faceState.get(f.faceUuid) } : f)) }
        : it;
    queryClient.setQueryData<{ pages: FaceReviewPage[]; pageParams: unknown[] } | undefined>(
      ["/api/face-review", kind, dismissedFilter],
      (old) => old && {
        ...old,
        pages: old.pages.map((page) => ({ ...page, items: page.items.map((it) => (it.photoId === updated.photoId ? updated : sync(it))) })),
      },
    );
  }

  function remainingActionable(it: FaceReviewItem): boolean {
    return it.faces.some((f) => (dismissedFilter ? f.dismissed : !f.identified && !f.dismissed));
  }

  const advanceTimerRef = useRef<number | undefined>();
  useEffect(() => () => window.clearTimeout(advanceTimerRef.current), [kind, dismissedFilter]);

  function advanceIfDone(updated: FaceReviewItem) {
    patchItem(updated);

    // Only step forward if the user is still looking at the photo that was just finished and it is now resolved.
    if (!remainingActionable(updated)) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = window.setTimeout(async () => {
        if (currentPhotoId.current !== updated.photoId) return;

        // 1. If there's an item directly after this in the currently loaded list, step forward.
        if (index < items.length - 1) {
          setIndex((i) => i + 1);
          return;
        }

        // 2. We're on the last loaded item (index === items.length - 1).
        // If more pages are available, trigger fetch and wait to step forward.
        if (queueQuery.hasNextPage) {
          waitingForMoreRef.current = true;
          if (!queueQuery.isFetchingNextPage) {
            queueQuery.fetchNextPage();
          }
          return;
        }

        // 3. No more pages in the cursor sequence. Check if there are earlier skipped/unresolved items in this loaded batch.
        const earlierUnresolved = items.findIndex((it) => remainingActionable(it.photoId === updated.photoId ? updated : it));
        if (earlierUnresolved !== -1 && earlierUnresolved !== index) {
          setIndex(earlierUnresolved);
          return;
        }

        // 4. All loaded items are resolved, and cursor pagination reached the end.
        // Check the server for any newer items that arrived at the head of the queue or were processed while reviewing.
        try {
          const p = new URLSearchParams({ kind, limit: "20" });
          if (dismissedFilter) p.set("dismissed", "1");
          const r = await fetch(`/api/face-review?${p.toString()}`, { credentials: "include" });
          if (r.ok) {
            const freshPage = (await r.json()) as FaceReviewPage;
            if (freshPage.items.length > 0) {
              // Fresh items found! Replace query data and jump to index 0.
              queryClient.setQueryData(["/api/face-review", kind, dismissedFilter], {
                pages: [freshPage],
                pageParams: [undefined],
              });
              setIndex(0);
              return;
            }
          }
        } catch (err) {
          console.error("Failed to check for more face review items:", err);
        }

        // 5. Entire queue is genuinely empty!
        popConfetti();
        toast({ title: "Congratulations!", description: `You've cleared the ${KIND_LABEL[kind]} queue. All caught up.` });
        queryClient.invalidateQueries({ queryKey: ["/api/face-review", kind, dismissedFilter] });
      }, 300);
    }
  }

  const assignMutation = useMutation({
    mutationFn: async (vars: { photoId: string; faceUuid: string; socialAccountId?: string; personId?: string }) => {
      const res = await apiRequest("POST", "/api/face-review/assign", { ...vars, kind });
      return (await res.json()) as FaceReviewItem;
    },
    onSuccess: (updated) => {
      advanceIfDone(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
      setSearchQuery("");
      setSearchFace(null);
      setFocusedFace(null);
    },
    onError: () => toast({ title: "Couldn't assign that face", variant: "destructive" }),
  });

  // faceUuids: one face (Skip) or every open face in the photo (Skip all).
  const dismissMutation = useMutation({
    mutationFn: async (vars: { photoId: string; faceUuids: string[] }) => {
      const res = await apiRequest("POST", "/api/face-review/dismiss", { ...vars, kind });
      return (await res.json()) as FaceReviewItem;
    },
    onSuccess: (updated, vars) => {
      advanceIfDone(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
      toast({
        title: vars.faceUuids.length > 1 ? `Skipped ${vars.faceUuids.length} faces` : "Skipped this face",
        action: (
          <ToastAction altText="Undo" onClick={() => undismissMutation.mutate(vars)}>
            Undo
          </ToastAction>
        ),
      });
    },
    onError: (_err, vars) => toast({ title: vars.faceUuids.length > 1 ? "Couldn't skip those faces" : "Couldn't skip that face", variant: "destructive" }),
  });

  const undismissMutation = useMutation({
    mutationFn: async (vars: { photoId: string; faceUuids: string[] }) => {
      const res = await apiRequest("POST", "/api/face-review/undismiss", { ...vars, kind });
      return (await res.json()) as FaceReviewItem;
    },
    onSuccess: (updated) => {
      patchItem(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
    },
  });

  // The ✕ on a named face box: unlink it (the face comes back for review), with Undo re-assigning it.
  const unassignMutation = useMutation({
    mutationFn: async (vars: { photoId: string; face: FaceReviewFace }) => {
      const res = await apiRequest("POST", "/api/face-review/unassign", { photoId: vars.photoId, faceUuid: vars.face.faceUuid, kind });
      return (await res.json()) as FaceReviewItem;
    },
    onSuccess: (updated, { photoId, face }) => {
      patchItem(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
      const was = face.identified;
      toast({
        title: `Removed ${was?.label ?? "the name"} from this face`,
        action: was ? (
          <ToastAction
            altText="Undo"
            onClick={() => assignMutation.mutate({ photoId, faceUuid: face.faceUuid, socialAccountId: was.socialAccountId, personId: was.personId })}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: () => toast({ title: "Couldn't remove that name", variant: "destructive" }),
  });

  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/face-review/auto-assign");
      return (await res.json()) as { scanned: number; assigned: number };
    },
    onSuccess: async ({ scanned, assigned }) => {
      // The refetch drops photos auto-assign finished, shifting positions: stay on the same photo
      // (or, if it left the queue, the one that followed it) rather than the same index.
      const queueKey = ["/api/face-review", kind, dismissedFilter];
      const ids = (d?: { pages: FaceReviewPage[] }) => d?.pages.flatMap((p) => p.items.map((it) => it.photoId)) ?? [];
      const before = ids(queryClient.getQueryData(queueKey));
      const from = currentPhotoId.current ? Math.max(before.indexOf(currentPhotoId.current), 0) : 0;
      // Prefix match: every tab's queue plus the counts; waits for the active queue to refetch.
      await queryClient.invalidateQueries({ queryKey: ["/api/face-review"] });
      const after = ids(queryClient.getQueryData(queueKey));
      const next = before.slice(from).map((id) => after.indexOf(id)).find((i) => i >= 0);
      setIndex(next ?? Math.max(after.length - 1, 0));
      toast({ title: assigned ? `Auto-assigned ${assigned} of ${scanned} faces` : `No confident matches among ${scanned} faces` });
    },
    onError: () => toast({ title: "Auto-assign failed", variant: "destructive" }),
  });

  // Search-as-you-type: people + social accounts (1+ chars, debounced).
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const searchActive = debouncedQuery.length >= 1;
  const { data: peopleResults = [] } = useQuery<(Person & { uuid?: string; name?: string })[]>({
    queryKey: ["/api/people/search", { q: debouncedQuery }],
    queryFn: async () => {
      if (!debouncedQuery) return [];
      const res = await fetch(`/api/people/search?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchActive,
  });
  const { data: accountResults = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts", { search: debouncedQuery }],
    queryFn: async () => {
      if (!debouncedQuery) return [];
      const res = await fetch(`/api/social-accounts?search=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: searchActive,
  });

  // Keyboard shortcuts (§4.1): 1-9 focuses a face row, arrows prev/next image, D dismisses the focused face.
  const actionableFaces = useMemo(
    () => item?.faces.filter((f) => (dismissedFilter ? f.dismissed : !f.identified && !f.dismissed)) ?? [],
    [item, dismissedFilter],
  );
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=combobox], [role=tab]")) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      if (e.key >= "1" && e.key <= "9") {
        const face = actionableFaces.find((f) => f.number === Number(e.key));
        if (face) setFocusedFace(face.faceUuid);
      } else if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key.toLowerCase() === "d" && focusedFace && item && !dismissedFilter && !dismissMutation.isPending) {
        dismissMutation.mutate({ photoId: item.photoId, faceUuids: [focusedFace] });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actionableFaces, focusedFace, item, items.length, dismissedFilter, dismissMutation.isPending, canGoNext, queueQuery.isFetchingNextPage]);

  const kindOffToggle = autoSettings && !autoSettings[kind]?.face;

  // Profile tab: is the connected account already identified in this photo?
  const profileAccountPlaced = !!item?.account && item.faces.some((f) => f.identified?.socialAccountId === item.account!.id);
  const assignProfileAccount = (faceUuid: string) =>
    item?.account && assignMutation.mutate({ photoId: item.photoId, faceUuid, socialAccountId: item.account.id });

  // Identities already on a face in this photo stay assignable (one person can appear more than
  // once in a photo); they're listed after the others and marked.
  const placedIds = new Set(item?.faces.flatMap((f) => [f.identified?.socialAccountId, f.identified?.personId]).filter(Boolean));
  const isPlaced = (s: { socialAccountId?: string; personId?: string }) =>
    (!!s.socialAccountId && placedIds.has(s.socialAccountId)) || (!!s.personId && placedIds.has(s.personId));
  const placedLast = <T,>(list: T[], placed: (x: T) => boolean) => [...list.filter((x) => !placed(x)), ...list.filter(placed)];
  const getPersonId = (p: Person & { uuid?: string }) => p.id || p.uuid || "";
  const getPersonName = (p: Person & { name?: string }) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.name || "Unknown";
  const visibleAccountResults = placedLast(accountResults, (a) => placedIds.has(a.id));
  const visiblePeopleResults = placedLast(peopleResults, (p) => placedIds.has(getPersonId(p)));
  const ALSO_HERE = " (also in this photo)";

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-4 max-w-3xl">
        <h1 className="text-2xl font-semibold">Face review</h1>
        <p className="text-muted-foreground text-sm">Confirm who's who in faces PRM has detected but couldn't identify.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <Tabs value={kind} onValueChange={(v) => setParam({ tab: v })}>
          <TabsList>
            {KINDS.map((k) => (
              <TabsTrigger key={k} value={k} data-testid={`tab-${k}`}>
                {KIND_LABEL[k]}
                {counts && counts[k] > 0 && <Badge variant="secondary" className="ml-1.5">{counts[k]}</Badge>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={autoAssignMutation.isPending}
            onClick={() => autoAssignMutation.mutate()}
            title="Name every waiting face that closely matches someone you already know"
            data-testid="button-auto-assign"
          >
            <Wand2 className="h-4 w-4 mr-1.5" />
            {autoAssignMutation.isPending ? "Matching…" : "Auto-assign"}
          </Button>
          <Button
            variant={dismissedFilter ? "default" : "outline"}
            size="sm"
            onClick={() => setParam({ dismissed: dismissedFilter ? null : "1" })}
            data-testid="button-toggle-dismissed"
          >
            <UserX className="h-4 w-4 mr-1.5" />
            Skipped{counts ? ` (${counts.dismissed})` : ""}
          </Button>
        </div>
      </div>

      {queueQuery.isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading…</div>
      ) : queueQuery.isError ? (
        <div className="text-center py-16 text-sm text-destructive">Couldn't load the review queue. Please refresh.</div>
      ) : !item ? (
        <div className="text-center py-16 space-y-2">
          <p className="text-lg font-medium">Nothing to review</p>
          {kindOffToggle && (
            <p className="text-sm text-muted-foreground">
              Face recognition is off for {KIND_LABEL[kind].toLowerCase()}.{" "}
              <Link href="/settings/recognition" className="underline inline-flex items-center gap-1">
                <Settings className="h-3.5 w-3.5" /> Turn it on
              </Link>
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-3">
            <div className="flex justify-center">
              <FaceBoxOverlay
                src={withImageSize(item.imageUrl, 1080)}
                width={item.width}
                height={item.height}
                onFaceClick={(key) => {
                  // On a profile picture with several faces, clicking a box picks the account's face.
                  const face = item.faces.find((f) => f.faceUuid === key);
                  if (item.kind === "profile" && !dismissedFilter && !profileAccountPlaced && face && !face.identified && !face.dismissed) assignProfileAccount(key);
                  else setFocusedFace(key);
                }}
                className="border rounded-md bg-muted"
                imgClassName="max-h-[calc(100vh-16rem)] w-auto rounded-md"
                faces={item.faces.map((f): OverlayFace => ({
                  key: f.faceUuid,
                  box: f.box,
                  color: f.color,
                  label: f.identified ? f.identified.label : String(f.number),
                  variant: f.dismissed ? "muted" : f.identified ? "solid" : "dashed",
                  autoScore: f.autoMatchScore,
                }))}
                onRemove={(key) => {
                  const face = item.faces.find((f) => f.faceUuid === key);
                  if (face?.identified && !unassignMutation.isPending) unassignMutation.mutate({ photoId: item.photoId, face });
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0} data-testid="button-back">
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <span className="text-xs text-muted-foreground">{index + 1} of {items.length}{queueQuery.hasNextPage ? "+" : ""}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNext}
                disabled={!canGoNext || queueQuery.isFetchingNextPage}
                data-testid="button-next"
              >
                {queueQuery.isFetchingNextPage ? "Loading…" : "Next"} <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:max-h-[calc(100vh-13rem)]">
            {!dismissedFilter && actionableFaces.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={dismissMutation.isPending}
                onClick={() => dismissMutation.mutate({ photoId: item.photoId, faceUuids: actionableFaces.map((f) => f.faceUuid) })}
                data-testid="button-dismiss-all"
              >
                <SkipForward className="h-4 w-4 mr-1.5" /> Skip all ({actionableFaces.length})
              </Button>
            )}

            <div className="flex items-center gap-2">
              {item.account && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-6 shrink-0" title="Account options" data-testid="button-account-menu">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      <DropdownMenuItem disabled={noFace.isPending} onClick={() => noFace.toggle(item.account!)} data-testid="button-toggle-no-face">
                        <ScanFace className="h-4 w-4 mr-2" />
                        {item.account.noFace ? "Match faces to this account again" : "This account doesn't have a face"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Avatar className="h-8 w-8">
                    {item.account.imageUrl && <AvatarImage src={item.account.imageUrl} alt={item.account.username} />}
                    <AvatarFallback>{getInitials(item.account.username)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">@{item.account.username}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {contextLine(item)}
                      {item.postedAt ? ` · ${new Date(item.postedAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                </>
              )}
              {!item.account && <p className="text-sm text-muted-foreground">{contextLine(item)}</p>}
            </div>
            {item.caption && item.kind !== "message" && <p className="text-sm text-muted-foreground line-clamp-2 shrink-0">{item.caption}</p>}

            {item.profileLinkReason && <p className="text-xs text-muted-foreground">{item.profileLinkReason}</p>}

            {item.kind === "profile" && item.account && !dismissedFilter && !profileAccountPlaced && actionableFaces.length > 1 && (
              <p className="text-sm">@{item.account.username} is in this picture. Click their face.</p>
            )}

            {actionableFaces.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">All faces in this photo are resolved.</p>
                {canGoNext && (
                  <Button variant="secondary" size="sm" onClick={handleNext} disabled={queueQuery.isFetchingNextPage}>
                    {queueQuery.isFetchingNextPage ? "Loading…" : "Next photo"} <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
                {!canGoNext && items.some((it) => remainingActionable(it)) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const nextIdx = items.findIndex((it) => remainingActionable(it));
                      if (nextIdx !== -1) setIndex(nextIdx);
                    }}
                  >
                    Go to next unresolved photo
                  </Button>
                )}
              </div>
            )}

            <div className="space-y-4 min-h-0 overflow-y-auto p-0.5 pr-1" data-testid="list-faces">
              {actionableFaces.map((face) => {
                const lookAlikeMerged: (FaceReviewSuggestion & { score?: number })[] = placedLast(item.suggestions, isPlaced).map((s) => {
                  const match = face.lookAlikes.find((la) => (la.socialAccountId && la.socialAccountId === s.socialAccountId) || (la.personId && la.personId === s.personId));
                  return match ? { ...s, score: match.score } : s;
                });
                const extraLookAlikes = placedLast(face.lookAlikes, isPlaced).filter(
                  (la) => !item.suggestions.some((s) => (la.socialAccountId && la.socialAccountId === s.socialAccountId) || (la.personId && la.personId === s.personId)),
                );
                const isFocused = focusedFace === face.faceUuid;
                const isSearching = searchFace === face.faceUuid;

                return (
                  <div
                    key={face.faceUuid}
                    className={cn("rounded-md border p-3 space-y-2", isFocused && "ring-2 ring-primary")}
                    onClick={() => setFocusedFace(face.faceUuid)}
                    data-testid={`row-face-${face.faceUuid}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded overflow-hidden border-2 flex-shrink-0" style={{ borderColor: face.color }}>
                        <img src={withImageSize(face.cropUrl, 128)} alt="" className="h-full w-full object-cover" />
                      </div>
                      <span className="text-xs text-muted-foreground">Face {face.number}</span>
                    </div>

                    {item.kind === "profile" && item.account && !dismissedFilter && !profileAccountPlaced && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full justify-start"
                        onClick={(e) => { e.stopPropagation(); assignProfileAccount(face.faceUuid); }}
                        data-testid={`button-this-is-account-${face.faceUuid}`}
                      >
                        {actionableFaces.length === 1 ? `Yes, this is @${item.account.username}` : `This one is @${item.account.username}`}
                      </Button>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {lookAlikeMerged.map((s) => (
                        <button
                          key={`${s.socialAccountId ?? s.personId}-${s.reason}`}
                          type="button"
                          className="text-xs px-2 py-1 rounded-full border hover:bg-accent flex items-center gap-1"
                          onClick={(e) => { e.stopPropagation(); assignMutation.mutate({ photoId: item.photoId, faceUuid: face.faceUuid, socialAccountId: s.socialAccountId, personId: s.personId }); }}
                          data-testid={`chip-suggestion-${s.socialAccountId ?? s.personId}`}
                        >
                          {suggestionLabel(item.kind, s)}
                          {isPlaced(s) && <span className="text-muted-foreground">{ALSO_HERE}</span>}
                          {s.score !== undefined && <span className="text-muted-foreground">· {Math.round(s.score * 100)}%</span>}
                        </button>
                      ))}
                      {extraLookAlikes.map((la) => (
                        <button
                          key={la.personfaceUuid}
                          type="button"
                          className="text-xs pl-1 pr-2 py-1 rounded-full border hover:bg-accent flex items-center gap-1.5"
                          onClick={(e) => { e.stopPropagation(); assignMutation.mutate({ photoId: item.photoId, faceUuid: face.faceUuid, socialAccountId: la.socialAccountId, personId: la.personId }); }}
                          data-testid={`chip-lookalike-${la.personfaceUuid}`}
                        >
                          <img src={withImageSize(la.cropUrl, 64)} alt="" className="h-4 w-4 rounded-full object-cover" />
                          looks like {la.label} · {Math.round(la.score * 100)}%
                          {isPlaced(la) && <span className="text-muted-foreground">{ALSO_HERE}</span>}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={cn("text-xs px-2 py-1 rounded-full border hover:bg-accent flex items-center gap-1", isSearching && "bg-accent")}
                        onClick={(e) => { e.stopPropagation(); setSearchQuery(""); setSearchFace(isSearching ? null : face.faceUuid); }}
                        data-testid={`chip-search-${face.faceUuid}`}
                      >
                        <Search className="h-3 w-3" /> Someone else…
                      </button>
                      {!dismissedFilter ? (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded-full border border-dashed text-muted-foreground hover:bg-accent flex items-center gap-1"
                          onClick={(e) => { e.stopPropagation(); dismissMutation.mutate({ photoId: item.photoId, faceUuids: [face.faceUuid] }); }}
                          data-testid={`button-dismiss-${face.faceUuid}`}
                        >
                          <SkipForward className="h-3 w-3" /> Skip
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded-full border border-dashed text-muted-foreground hover:bg-accent flex items-center gap-1"
                          onClick={(e) => { e.stopPropagation(); undismissMutation.mutate({ photoId: item.photoId, faceUuids: [face.faceUuid] }); }}
                          data-testid={`button-undismiss-${face.faceUuid}`}
                        >
                          Unskip
                        </button>
                      )}
                    </div>

                    {isSearching && (
                      <div className="pt-1 space-y-1" onClick={(e) => e.stopPropagation()}>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Search people or accounts…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setSearchFace(null);
                                setSearchQuery("");
                              }
                            }}
                            className="pl-8 h-8 text-sm"
                            autoFocus
                            data-testid="input-face-search"
                          />
                          {searchQuery && (
                            <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setSearchQuery("")}>
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          )}
                        </div>
                        {searchActive && (
                          <div className="max-h-56 overflow-auto space-y-2 border rounded-md p-1.5">
                            {visiblePeopleResults.length > 0 && (
                              <div className="space-y-0.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-0.5">
                                  Person Profiles
                                </div>
                                {visiblePeopleResults.map((p) => {
                                  const pid = getPersonId(p);
                                  const name = getPersonName(p);
                                  return (
                                    <button
                                      key={pid}
                                      type="button"
                                      className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2"
                                      onClick={() => assignMutation.mutate({ photoId: item.photoId, faceUuid: face.faceUuid, personId: pid })}
                                      data-testid={`result-person-${pid}`}
                                    >
                                      <Avatar className="h-5 w-5 shrink-0">
                                        {p.imageUrl && <AvatarImage src={withImageSize(p.imageUrl, 64)} alt={name} />}
                                        <AvatarFallback className="text-[10px]">{getInitials(p.firstName || name, p.lastName || "")}</AvatarFallback>
                                      </Avatar>
                                      <span className="truncate font-medium">{name}</span>
                                      {placedIds.has(pid) && <span className="text-xs text-muted-foreground shrink-0">{ALSO_HERE}</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {visibleAccountResults.length > 0 && (
                              <div className="space-y-0.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-0.5">
                                  Social Accounts
                                </div>
                                {visibleAccountResults.map((a) => (
                                  <button
                                    key={a.id}
                                    type="button"
                                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2"
                                    onClick={() => assignMutation.mutate({ photoId: item.photoId, faceUuid: face.faceUuid, socialAccountId: a.id })}
                                    data-testid={`result-account-${a.id}`}
                                  >
                                    <Avatar className="h-5 w-5 shrink-0">
                                      {a.imageUrl && <AvatarImage src={withImageSize(a.imageUrl, 64)} alt={a.username} />}
                                      <AvatarFallback className="text-[10px]">@{a.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <span className="truncate">@{a.username}</span>
                                    {placedIds.has(a.id) && <span className="text-xs text-muted-foreground shrink-0">{ALSO_HERE}</span>}
                                  </button>
                                ))}
                              </div>
                            )}

                            {!visibleAccountResults.length && !visiblePeopleResults.length && (
                              <p className="text-xs text-muted-foreground px-2 py-1.5">No matches</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {noFace.dialog}
    </div>
  );
}
