// Face review queue (face-review-plan.md §4). Replaces the old /unknown-faces
// grid: one photo at a time, boxes drawn over unidentified faces, suggestion
// and look-alike chips to assign them, or "not someone I track" to dismiss.
// The Clusters tab (face-clustering-plan.md §5) names whole clusters at once.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, UserX, Settings, SkipForward, Wand2, MoreVertical, ScanFace, RefreshCw, Loader2, Ban, Users, EyeOff, CheckCheck } from "lucide-react";
import { useBannedActionToggle } from "@/components/banned-action-toggle";
import { Button } from "@/components/ui/button";
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
import { IdentitySearch } from "@/components/identity-search";
import { FaceClustersTab } from "@/components/face-clusters-tab";
import { FaceVerifyTab } from "@/components/face-verify-tab";
import type { ImageTask } from "@shared/schema";

type FaceReviewKind = "story" | "profile" | "post" | "message";
const KINDS: FaceReviewKind[] = ["story", "profile", "post", "message"];
const KIND_LABEL: Record<FaceReviewKind, string> = { story: "Stories", profile: "Profile images", post: "Posts", message: "Messages" };

type FaceReviewCounts = Record<FaceReviewKind, number> & { total: number; dismissed: number };

export type FaceReviewSuggestion = {
  socialAccountId?: string;
  personId?: string;
  username?: string;
  imageUrl?: string | null;
  ownerName?: string | null;
  label: string;
  reason: "owner" | "coauthor" | "mentioned" | "profile_account" | "sender" | "participant" | "lookalike";
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
  /** A quality-noise face (too small, low confidence or blurry); hidden unless "Show noise" is on. */
  noise: boolean;
  cluster: { id: string; size: number } | null;
  lookAlikes: FaceReviewFaceLookAlike[];
};

type FaceState = Pick<FaceReviewFace, "identified" | "dismissed" | "autoMatchScore">;
const faceState = (f: FaceReviewFace): FaceState => ({ identified: f.identified, dismissed: f.dismissed, autoMatchScore: f.autoMatchScore });

/** An optimistic queue edit: the faces' states before it, to restore if the server refuses it. */
type Optimistic = { photoId: string; key: unknown[]; before: Map<string, FaceState>; states: Map<string, Partial<FaceState>> };

/** apiRequest's "409: {"error":"…"}" as just the server's message. */
function serverError(err: Error): string {
  const body = err.message.replace(/^\d+:\s*/, "");
  try {
    return JSON.parse(body).error ?? body;
  } catch {
    return body;
  }
}

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

export const SUGGESTION_COPY: Record<string, string> = {
  owner: "(posted this)",
  coauthor: "(coauthor)",
  mentioned: "(mentioned)",
  profile_account: "",
  sender: "(sent this)",
  participant: "(in this conversation)",
  lookalike: "(looks like them)",
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

/** A face re-scan task; `settled` is set once its outcome has been applied to the page. */
type Rescan = { taskId: string; settled?: "completed" | "failed" };

const RESCAN_LABEL: Record<string, string> = { pending: "Queued", in_progress: "Scanning…", completed: "Done", failed: "Failed", cancelled: "Failed" };

/**
 * Follows one re-scan task (the global task SSE keeps ["/api/image-tasks", …] fresh), reports
 * its finish once, and shows its status chip while its photo is on screen.
 */
function RescanStatus({ rescan, visible, onSettled }: { rescan: Rescan; visible: boolean; onSettled: (task: ImageTask) => void }) {
  const { data: task } = useQuery<ImageTask>({ queryKey: ["/api/image-tasks", rescan.taskId], enabled: !rescan.settled });
  const finished = task && ["completed", "failed", "cancelled"].includes(task.status);
  useEffect(() => {
    if (finished && !rescan.settled) onSettled(task);
  }, [finished]);

  if (!visible) return null;
  const status = rescan.settled ?? task?.status ?? "pending";
  const failed = status === "failed" || status === "cancelled";
  return (
    <Badge
      variant={failed ? "destructive" : "secondary"}
      className="shrink-0 gap-1"
      title={failed ? task?.result ?? undefined : undefined}
      data-testid="badge-rescan-status"
    >
      {status === "in_progress" && <Loader2 className="h-3 w-3 animate-spin" />}
      {RESCAN_LABEL[status] ?? status}
    </Badge>
  );
}

export default function FaceReviewPage() {
  const { toast } = useToast();
  const noFace = useNoFaceToggle();
  const bans = useBannedActionToggle();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  // The Clusters tab is the default; `kind` is the per-photo queue the story/profile/post/message tabs show.
  const tabParam = params.get("tab");
  const queueTab = KINDS.includes(tabParam as FaceReviewKind);
  const clustersTab = !queueTab && tabParam !== "verify";
  const kind = (queueTab ? tabParam : "story") as FaceReviewKind;
  const dismissedFilter = params.get("dismissed") === "1";
  const showNoise = params.get("noise") === "1";
  const queueKey = ["/api/face-review", kind, dismissedFilter, showNoise];

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    navigate(`/face-review?${next.toString()}`);
  };

  const { data: counts } = useQuery<FaceReviewCounts>({
    queryKey: ["/api/face-review/counts", { noise: showNoise ? "1" : undefined }],
    refetchInterval: 15_000,
  });
  const { data: autoSettings } = useQuery<AutoRecognitionSettings>({ queryKey: ["/api/recognition/auto"] });

  const queueQuery = useInfiniteQuery<FaceReviewPage>({
    queryKey: queueKey,
    enabled: queueTab,
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ kind, limit: "20" });
      if (dismissedFilter) p.set("dismissed", "1");
      if (showNoise) p.set("noise", "1");
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
  useEffect(() => setIndex(0), [kind, dismissedFilter, showNoise]);

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
  const currentPhotoId = useRef<string | undefined>(undefined);
  currentPhotoId.current = item?.photoId;

  // Optimistic face states still waiting on the server, so a reply to an earlier action doesn't undo them.
  const pendingFaces = useRef(new Map<string, Partial<FaceState>>());
  const withPending = (f: FaceReviewFace): FaceReviewFace => (pendingFaces.current.has(f.faceUuid) ? { ...f, ...pendingFaces.current.get(f.faceUuid) } : f);

  // Set faces' state in every cached page. Identical images share their faces, so the same face in
  // other queued photos takes the new state too; `replace` swaps that photo in whole.
  function patchFaces(faceState: Map<string, Partial<FaceState>>, replace?: FaceReviewItem, key: unknown[] = queueKey) {
    const sync = (it: FaceReviewItem): FaceReviewItem =>
      it.faces.some((f) => faceState.has(f.faceUuid))
        ? { ...it, faces: it.faces.map((f) => (faceState.has(f.faceUuid) ? { ...f, ...faceState.get(f.faceUuid) } : f)) }
        : it;
    queryClient.setQueryData<{ pages: FaceReviewPage[]; pageParams: unknown[] } | undefined>(
      key,
      (old) => old && {
        ...old,
        pages: old.pages.map((page) => ({ ...page, items: page.items.map((it) => (it.photoId === replace?.photoId ? replace : sync(it))) })),
      },
    );
  }

  // Replace the photo in every cached page with a refreshed copy (after assign/dismiss).
  function patchItem(updated: FaceReviewItem) {
    const item = { ...updated, faces: updated.faces.map(withPending) };
    patchFaces(new Map(item.faces.map((f) => [f.faceUuid, faceState(f)])), item);
  }

  // Queue actions apply at once (and run on the server one at a time, via the shared mutation scope):
  // the photo updates and, when it's now resolved, the queue advances without waiting for the reply.
  function applyOptimistic(photoId: string, states: Map<string, Partial<FaceState>>, advance: boolean): Optimistic {
    const it = items.find((i) => i.photoId === photoId);
    const before = new Map((it?.faces ?? []).filter((f) => states.has(f.faceUuid)).map((f) => [f.faceUuid, faceState(f)]));
    states.forEach((s, faceUuid) => pendingFaces.current.set(faceUuid, s));
    if (it) {
      const next = { ...it, faces: it.faces.map(withPending) };
      if (advance) advanceIfDone(next);
      else patchItem(next);
    }
    return { photoId, key: queueKey, before, states };
  }

  function settle(ctx: Optimistic | undefined) {
    ctx?.states.forEach((s, faceUuid) => {
      if (pendingFaces.current.get(faceUuid) === s) pendingFaces.current.delete(faceUuid);
    });
  }

  // The server refused: restore the faces, go back to the photo and say why.
  function rollback(ctx: Optimistic | undefined, title: string, err: Error) {
    toast({ title, description: serverError(err), variant: "destructive" });
    if (!ctx) return;
    settle(ctx);
    patchFaces(ctx.before, undefined, ctx.key);
    if (ctx.key.join() !== queueKey.join()) return;
    if (currentPhotoId.current === ctx.photoId) window.clearTimeout(advanceTimerRef.current);
    const at = (queryClient.getQueryData<{ pages: FaceReviewPage[] }>(queueKey)?.pages.flatMap((p) => p.items) ?? []).findIndex((i) => i.photoId === ctx.photoId);
    if (at >= 0) setIndex(at);
  }

  // Quality-noise faces don't hold a photo in the queue unless "Show noise" is on (matches faceQualifies).
  const actionable = (f: FaceReviewFace) => (dismissedFilter ? f.dismissed : !f.identified && !f.dismissed && (showNoise || !f.noise));
  function remainingActionable(it: FaceReviewItem): boolean {
    return it.faces.some(actionable);
  }

  const advanceTimerRef = useRef<number | undefined>();
  useEffect(() => () => window.clearTimeout(advanceTimerRef.current), [kind, dismissedFilter, showNoise]);

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
          if (showNoise) p.set("noise", "1");
          const r = await fetch(`/api/face-review?${p.toString()}`, { credentials: "include" });
          if (r.ok) {
            const freshPage = (await r.json()) as FaceReviewPage;
            if (freshPage.items.length > 0) {
              // Fresh items found! Replace query data and jump to index 0.
              queryClient.setQueryData(queueKey, {
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
        queryClient.invalidateQueries({ queryKey: queueKey });
      }, 300);
    }
  }

  // Every queue action shares one scope, so their requests reach the server in the order they were made.
  const queueScope = { id: "face-review-queue" };
  const onSaved = (updated: FaceReviewItem, _vars: unknown, ctx: Optimistic | undefined) => {
    settle(ctx);
    patchItem(updated);
    queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
  };

  // `label` only names the face until the server's reply arrives; it isn't sent.
  const assignMutation = useMutation({
    scope: queueScope,
    mutationFn: async ({ label: _label, ...vars }: { photoId: string; faceUuid: string; label: string; socialAccountId?: string; personId?: string; username?: string }) => {
      const res = await apiRequest("POST", "/api/face-review/assign", { ...vars, kind });
      return (await res.json()) as FaceReviewItem;
    },
    onMutate: (vars) => {
      setSearchFace(null);
      setFocusedFace(null);
      const identified = { socialAccountId: vars.socialAccountId, personId: vars.personId, label: vars.label };
      return applyOptimistic(vars.photoId, new Map([[vars.faceUuid, { identified, dismissed: false, autoMatchScore: null }]]), true);
    },
    onSuccess: onSaved,
    onError: (err: Error, _vars, ctx) => rollback(ctx, "Couldn't assign that face", err),
  });

  // faceUuids: one face (Skip) or every open face in the photo (Skip all).
  const dismissMutation = useMutation({
    scope: queueScope,
    mutationFn: async (vars: { photoId: string; faceUuids: string[] }) => {
      const res = await apiRequest("POST", "/api/face-review/dismiss", { ...vars, kind });
      return (await res.json()) as FaceReviewItem;
    },
    onMutate: (vars) => {
      toast({
        title: vars.faceUuids.length > 1 ? `Skipped ${vars.faceUuids.length} faces` : "Skipped this face",
        action: (
          <ToastAction altText="Undo" onClick={() => undismissMutation.mutate(vars)}>
            Undo
          </ToastAction>
        ),
      });
      return applyOptimistic(vars.photoId, new Map(vars.faceUuids.map((u) => [u, { dismissed: true }])), true);
    },
    onSuccess: onSaved,
    onError: (err: Error, vars, ctx) => rollback(ctx, vars.faceUuids.length > 1 ? "Couldn't skip those faces" : "Couldn't skip that face", err),
  });

  const undismissMutation = useMutation({
    scope: queueScope,
    mutationFn: async (vars: { photoId: string; faceUuids: string[] }) => {
      const res = await apiRequest("POST", "/api/face-review/undismiss", { ...vars, kind });
      return (await res.json()) as FaceReviewItem;
    },
    onMutate: (vars) => applyOptimistic(vars.photoId, new Map(vars.faceUuids.map((u) => [u, { dismissed: false }])), false),
    onSuccess: onSaved,
    onError: (err: Error, vars, ctx) => rollback(ctx, vars.faceUuids.length > 1 ? "Couldn't unskip those faces" : "Couldn't unskip that face", err),
  });

  // The ✕ on a named face box: unlink it (the face comes back for review), with Undo re-assigning it.
  const unassignMutation = useMutation({
    scope: queueScope,
    mutationFn: async (vars: { photoId: string; face: FaceReviewFace }) => {
      const res = await apiRequest("POST", "/api/face-review/unassign", { photoId: vars.photoId, faceUuid: vars.face.faceUuid, kind });
      return (await res.json()) as FaceReviewItem;
    },
    onMutate: ({ photoId, face }) => {
      const was = face.identified;
      toast({
        title: `Removed ${was?.label ?? "the name"} from this face`,
        action: was ? (
          <ToastAction
            altText="Undo"
            onClick={() => assignMutation.mutate({ photoId, faceUuid: face.faceUuid, label: was.label, socialAccountId: was.socialAccountId, personId: was.personId })}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
      return applyOptimistic(photoId, new Map([[face.faceUuid, { identified: null, autoMatchScore: null }]]), false);
    },
    onSuccess: onSaved,
    onError: (err: Error, _vars, ctx) => rollback(ctx, "Couldn't remove that name", err),
  });

  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/face-review/auto-assign");
      return (await res.json()) as { scanned: number; assigned: number; verify: number };
    },
    onSuccess: async ({ scanned, assigned, verify }) => {
      // The refetch drops photos auto-assign finished, shifting positions: stay on the same photo
      // (or, if it left the queue, the one that followed it) rather than the same index.
      const ids = (d?: { pages: FaceReviewPage[] }) => d?.pages.flatMap((p) => p.items.map((it) => it.photoId)) ?? [];
      const before = ids(queryClient.getQueryData(queueKey));
      const from = currentPhotoId.current ? Math.max(before.indexOf(currentPhotoId.current), 0) : 0;
      // Prefix match: every tab's queue plus the counts; waits for the active queue to refetch.
      await queryClient.invalidateQueries({ queryKey: ["/api/face-review"] });
      const after = ids(queryClient.getQueryData(queueKey));
      const next = before.slice(from).map((id) => after.indexOf(id)).find((i) => i >= 0);
      setIndex(next ?? Math.max(after.length - 1, 0));
      toast({ title: `${assigned ? `Auto-assigned ${assigned} of ${scanned} faces` : `No confident matches among ${scanned} faces`}${verify ? `, ${verify} to verify` : ""}` });
    },
    onError: () => toast({ title: "Auto-assign failed", variant: "destructive" }),
  });

  // Re-scan (⋮ menu): photoId → its task. Kept per photo so stepping away and back keeps the chip.
  const [rescans, setRescans] = useState<Record<string, Rescan>>({});
  const rescanMutation = useMutation({
    mutationFn: async (photoId: string) => {
      const res = await apiRequest("POST", "/api/face-review/rescan", { photoId });
      return (await res.json()) as { taskId: string };
    },
    onSuccess: ({ taskId }, photoId) => setRescans((r) => ({ ...r, [photoId]: { taskId } })),
    onError: (err: Error) => toast({ title: "Couldn't start the re-scan", description: err.message, variant: "destructive" }),
  });

  // The scan replaced every face (new ids, boxes and crops): swap in the refreshed photo. No advancing —
  // the user asked to see this photo's result.
  async function applyRescan(photoId: string, task: ImageTask) {
    const outcome = task.status === "completed" ? "completed" : "failed";
    setRescans((r) => ({ ...r, [photoId]: { taskId: task.id, settled: outcome } }));
    if (outcome === "failed") {
      toast({ title: "Face re-scan failed", description: task.result ?? undefined, variant: "destructive" });
      return;
    }
    window.setTimeout(() => setRescans(({ [photoId]: done, ...rest }) => (done?.taskId === task.id ? rest : { ...rest, [photoId]: done })), 4000);
    const res = await fetch(`/api/face-review/item?${new URLSearchParams({ photoId, kind })}`, { credentials: "include" });
    if (!res.ok) return;
    const updated = (await res.json()) as FaceReviewItem;
    patchItem(updated);
    if (currentPhotoId.current === photoId) {
      setFocusedFace(null);
      setSearchFace(null);
    }
    queryClient.invalidateQueries({ queryKey: ["/api/face-review/counts"] });
    toast({ title: `Re-scan found ${updated.faces.length} face${updated.faces.length === 1 ? "" : "s"}` });
  }

  // Keyboard shortcuts (§4.1): 1-9 focuses a face row, arrows prev/next image, D dismisses the focused face, Space skips all.
  const actionableFaces = useMemo(
    () => item?.faces.filter(actionable) ?? [],
    [item, dismissedFilter, showNoise],
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
      } else if (e.key === " ") {
        e.preventDefault();
        if (item && !dismissedFilter && actionableFaces.length > 0) {
          dismissMutation.mutate({ photoId: item.photoId, faceUuids: actionableFaces.map((f) => f.faceUuid) });
        }
      } else if (e.key.toLowerCase() === "d" && focusedFace && item && !dismissedFilter) {
        dismissMutation.mutate({ photoId: item.photoId, faceUuids: [focusedFace] });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actionableFaces, focusedFace, item, items.length, dismissedFilter, canGoNext, queueQuery.isFetchingNextPage]);

  const kindOffToggle = autoSettings && !autoSettings[kind]?.face;

  // Profile tab: is the connected account already identified in this photo?
  const profileAccountPlaced = !!item?.account && item.faces.some((f) => f.identified?.socialAccountId === item.account!.id);
  const assignProfileAccount = (faceUuid: string) =>
    item?.account && assignMutation.mutate({ photoId: item.photoId, faceUuid, label: `@${item.account.username}`, socialAccountId: item.account.id });

  // Identities already on a face in this photo stay assignable (one person can appear more than
  // once in a photo); they're listed after the others and marked.
  const placedIds = new Set(item?.faces.flatMap((f) => [f.identified?.socialAccountId, f.identified?.personId]).filter(Boolean));
  const isPlaced = (s: { socialAccountId?: string; personId?: string }) =>
    (!!s.socialAccountId && placedIds.has(s.socialAccountId)) || (!!s.personId && placedIds.has(s.personId));
  const placedLast = <T,>(list: T[], placed: (x: T) => boolean) => [...list.filter((x) => !placed(x)), ...list.filter(placed)];
  const ALSO_HERE = " (also in this photo)";

  return (
    <div className="h-full overflow-y-auto container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-4 max-w-3xl">
        <h1 className="text-2xl font-semibold">Face review</h1>
        <p className="text-muted-foreground text-sm">Confirm who's who in faces PRM has detected but couldn't identify.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <Tabs value={queueTab ? kind : clustersTab ? "clusters" : "verify"} onValueChange={(v) => setParam({ tab: v === "clusters" ? null : v, cluster: null })}>
          <TabsList>
            <TabsTrigger value="clusters" data-testid="tab-clusters">
              <Users className="h-4 w-4 mr-1.5" /> Clusters
            </TabsTrigger>
            <TabsTrigger value="verify" data-testid="tab-verify">
              <CheckCheck className="h-4 w-4 mr-1.5" /> Verify
            </TabsTrigger>
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
            variant={showNoise ? "default" : "outline"}
            size="sm"
            onClick={() => setParam({ noise: showNoise ? null : "1" })}
            title="Include faces too small, blurry or low-confidence to be worth asking about"
            data-testid="button-toggle-noise"
          >
            <EyeOff className="h-4 w-4 mr-1.5" />
            {showNoise ? "Hide noise" : "Show noise"}
          </Button>
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

      {clustersTab ? (
        <FaceClustersTab clusterId={params.get("cluster")} onOpenCluster={(id) => setParam({ cluster: id })} />
      ) : !queueTab ? (
        <FaceVerifyTab />
      ) : queueQuery.isLoading ? (
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
                  if (face?.identified) unassignMutation.mutate({ photoId: item.photoId, face });
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
                onClick={() => dismissMutation.mutate({ photoId: item.photoId, faceUuids: actionableFaces.map((f) => f.faceUuid) })}
                data-testid="button-dismiss-all"
              >
                <SkipForward className="h-4 w-4 mr-1.5" /> Skip all ({actionableFaces.length}) <kbd className="ml-1.5 text-[10px] opacity-60">Space</kbd>
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
                      <DropdownMenuItem disabled={bans.isPending} onClick={() => bans.set(item.account!, "facial_scan", true)} data-testid="button-ban-facial-scan">
                        <Ban className="h-4 w-4 mr-2" />
                        Don't scan this account's photos for faces
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={rescanMutation.isPending || (!!rescans[item.photoId] && !rescans[item.photoId].settled)}
                        onClick={() => rescanMutation.mutate(item.photoId)}
                        data-testid="button-rescan-faces"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Re-scan faces in this photo
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
              {Object.entries(rescans).map(([photoId, rescan]) => (
                <RescanStatus key={rescan.taskId} rescan={rescan} visible={photoId === item.photoId} onSettled={(task) => applyRescan(photoId, task)} />
              ))}
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
                      {face.noise && <Badge variant="outline" className="text-[10px]">low quality</Badge>}
                      {face.cluster && (
                        <button
                          type="button"
                          className="ml-auto text-xs px-2 py-0.5 rounded-full border hover:bg-accent flex items-center gap-1"
                          onClick={(e) => { e.stopPropagation(); setParam({ tab: null, cluster: face.cluster!.id }); }}
                          title="Name every face in this cluster at once"
                          data-testid={`chip-cluster-${face.faceUuid}`}
                        >
                          <Users className="h-3 w-3" /> in a cluster of {face.cluster.size}
                        </button>
                      )}
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
                          key={`${s.socialAccountId ?? s.personId ?? s.username}-${s.reason}`}
                          type="button"
                          className="text-xs px-2 py-1 rounded-full border hover:bg-accent flex items-center gap-1"
                          onClick={(e) => { e.stopPropagation(); assignMutation.mutate({ photoId: item.photoId, faceUuid: face.faceUuid, label: s.label, socialAccountId: s.socialAccountId, personId: s.personId, username: s.username }); }}
                          data-testid={`chip-suggestion-${s.socialAccountId ?? s.personId ?? s.username}`}
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
                          onClick={(e) => { e.stopPropagation(); assignMutation.mutate({ photoId: item.photoId, faceUuid: face.faceUuid, label: la.label, socialAccountId: la.socialAccountId, personId: la.personId }); }}
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
                        onClick={(e) => { e.stopPropagation(); setSearchFace(isSearching ? null : face.faceUuid); }}
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
                      <IdentitySearch
                        placedIds={placedIds}
                        onPick={(target, label) => assignMutation.mutate({ photoId: item.photoId, faceUuid: face.faceUuid, label: label ?? `@${target.username ?? "…"}`, ...target })}
                        onCancel={() => setSearchFace(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {noFace.dialog}
      {bans.dialog}
    </div>
  );
}
