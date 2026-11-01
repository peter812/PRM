// Identify faces on one photo of a post or story, in its modal (photo-faces-plan.md §2–§4): the
// ScanFace toggle, the faces & mentions panel, face boxes, a popover per clicked box that names,
// renames, confirms, removes or skips that face through the Face review endpoints, and drawing a
// box around a face the scanner missed.
import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, RefreshCw, ScanFace, SquareDashedMousePointer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { FaceBoxOverlay, type FaceBox } from "@/components/face-box-overlay";
import {
  FaceIdentifyChips,
  placedIdsOf,
  serverError,
  type FaceReviewFace,
  type FaceReviewKind,
  type FaceReviewSuggestion,
} from "@/components/face-identify-chips";
import type { IdentityTarget } from "@/components/identity-search";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { withImageSize } from "@shared/image-size";
import { DRAWN_FACE_MAX_IOU, MIN_DRAWN_FACE_PX, boxIou } from "@shared/face-box";
import type { ImageTask } from "@shared/schema";

/** One analyzed slide from GET /api/social-account-posts/:id/slides (server/face-review.ts PostSlideAnalysis). */
export type PostSlide = {
  slide: number;
  photoId: string;
  kind: FaceReviewKind;
  width: number | null;
  height: number | null;
  faces: FaceReviewFace[];
  suggestions: FaceReviewSuggestion[];
  ocrData: unknown;
};

export const postSlidesKey = (postId: string) => [`/api/social-account-posts/${postId}/slides`];

type FaceEdit = {
  path: "assign" | "unassign" | "dismiss" | "undismiss";
  slide: PostSlide;
  face: FaceReviewFace;
  target?: IdentityTarget;
  /** Applied to the face until the server's reply replaces the slide's faces. */
  patch: Partial<FaceReviewFace>;
  failure: string;
};

const identityHref = (id: FaceReviewFace["identified"]) =>
  id?.socialAccountId ? `/social-accounts/${id.socialAccountId}` : id?.personId ? `/person/${id.personId}` : null;

const isOpen = (f: FaceReviewFace) => !!f.box && !f.identified && !f.dismissed;

type FaceReviewReply = { faces: FaceReviewFace[]; suggestions: FaceReviewSuggestion[] };

// Face review's queues and counts, the faces lists, and the account's Faces tab.
const invalidateFaceLists = () =>
  queryClient.invalidateQueries({
    predicate: ({ queryKey: [k] }) =>
      typeof k === "string" && (k.startsWith("/api/face-review") || k.startsWith("/api/faces") || /^\/api\/social-accounts\/[^/]+\/faces/.test(k)),
  });

export function PhotoFaces({ postId, slide, src, imgClassName, mentions, show, onShowChange, onNavigate, children }: {
  postId: string;
  slide: number;
  /** The photo to draw boxes on; unset (a video slide) shows only the panel. */
  src?: string;
  imgClassName?: string;
  /** Handles tagged on this slide. */
  mentions: string[];
  show: boolean;
  onShowChange: (show: boolean) => void;
  /** Called when a link in the panel or popover leaves the modal. */
  onNavigate?: () => void;
  /** The plain media, shown while faces are hidden. */
  children: ReactNode;
}) {
  const { toast } = useToast();
  const key = postSlidesKey(postId);
  const { data: slides } = useQuery<PostSlide[]>({ queryKey: key });
  // A story's single photo may carry no slide index; it's still the story's photo.
  const current = slides?.find((s) => s.slide === slide) ?? (slides?.length === 1 && slide === 0 ? slides[0] : undefined);
  const faces = current?.faces ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  useEffect(() => {
    setSelected(null);
    setDrawing(false);
  }, [current?.photoId, show]);
  const selectedFace = faces.find((f) => f.faceUuid === selected);

  const patchSlide = (photoId: string, fn: (s: PostSlide) => PostSlide) =>
    queryClient.setQueryData<PostSlide[]>(key, (old) => old?.map((s) => (s.photoId === photoId ? fn(s) : s)));

  const edit = useMutation({
    scope: { id: key[0] },
    mutationFn: async ({ path, slide: s, face, target }: FaceEdit) => {
      const res = await apiRequest("POST", `/api/face-review/${path}`, { photoId: s.photoId, kind: s.kind, faceUuid: face.faceUuid, ...target });
      return (await res.json()) as FaceReviewReply;
    },
    onMutate: async ({ slide: s, face, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<PostSlide[]>(key);
      patchSlide(s.photoId, (x) => ({ ...x, faces: x.faces.map((f) => (f.faceUuid === face.faceUuid ? { ...f, ...patch } : f)) }));
      return { prev };
    },
    onSuccess: (item, { slide: s }) => patchSlide(s.photoId, (x) => ({ ...x, faces: item.faces, suggestions: item.suggestions })),
    onError: (err: Error, { failure }, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast({ title: failure, description: serverError(err), variant: "destructive" });
    },
    onSettled: invalidateFaceLists,
  });

  // A drawn box becomes a face on the server; its popover opens as soon as it's back.
  const addFace = useMutation({
    mutationFn: async ({ slide: s, box }: { slide: PostSlide; box: FaceBox }) =>
      (await (await apiRequest("POST", "/api/face-review/add-face", { photoId: s.photoId, kind: s.kind, box })).json()) as FaceReviewReply & { faceUuid: string },
    onSuccess: (item, { slide: s }) => {
      patchSlide(s.photoId, (x) => ({ ...x, faces: item.faces, suggestions: item.suggestions }));
      setSelected(item.faceUuid);
    },
    onError: (err: Error) => toast({ title: "Couldn't add that face", description: serverError(err), variant: "destructive" }),
    onSettled: invalidateFaceLists,
  });
  const drawn = (box: FaceBox) => {
    if (box.w < MIN_DRAWN_FACE_PX || box.h < MIN_DRAWN_FACE_PX) {
      toast({ title: "Draw a bigger box", description: "Drag from one corner of the face to the other." });
      return;
    }
    setDrawing(false);
    const hit = faces.find((f) => f.box && boxIou(f.box, box) > DRAWN_FACE_MAX_IOU);
    if (hit) {
      setSelected(hit.faceUuid);
      toast({ title: "That face is already marked", description: "Click it instead." });
      return;
    }
    addFace.mutate({ slide: current!, box });
  };

  // After an unknown face is named or skipped, move on to the next one that still needs a decision.
  const advanceFrom = (face: FaceReviewFace) => {
    const open = faces.filter((f) => isOpen(f) && f.faceUuid !== face.faceUuid).sort((a, b) => a.number - b.number);
    setSelected((open.find((f) => f.number > face.number) ?? open[0])?.faceUuid ?? null);
  };

  const assign = (face: FaceReviewFace, target: IdentityTarget, label: string) => {
    if (!current) return;
    edit.mutate({
      path: "assign", slide: current, face, target,
      patch: { identified: { ...target, label }, dismissed: false, autoMatchScore: null },
      failure: "Couldn't name that face",
    });
    if (isOpen(face)) advanceFrom(face);
    else setSelected(null);
  };
  const unassign = (face: FaceReviewFace) =>
    current && edit.mutate({ path: "unassign", slide: current, face, patch: { identified: null, autoMatchScore: null }, failure: "Couldn't remove that name" });
  const skip = (face: FaceReviewFace) => {
    if (!current) return;
    edit.mutate({ path: "dismiss", slide: current, face, patch: { dismissed: true }, failure: "Couldn't skip that face" });
    advanceFrom(face);
  };
  const unskip = (face: FaceReviewFace) =>
    current && edit.mutate({ path: "undismiss", slide: current, face, patch: { dismissed: false }, failure: "Couldn't unskip that face" });

  // Re-scan: the global task SSE keeps ["/api/image-tasks", id] fresh; reload the slide when it ends.
  const [rescanTask, setRescanTask] = useState<string | null>(null);
  const rescan = useMutation({
    mutationFn: async (photoId: string) => (await (await apiRequest("POST", "/api/face-review/rescan", { photoId })).json()) as { taskId: string },
    onSuccess: ({ taskId }) => setRescanTask(taskId),
    onError: (err: Error) => toast({ title: "Couldn't start the re-scan", description: serverError(err), variant: "destructive" }),
  });
  const { data: task } = useQuery<ImageTask>({ queryKey: ["/api/image-tasks", rescanTask], enabled: !!rescanTask });
  useEffect(() => {
    if (!task || !["completed", "failed", "cancelled"].includes(task.status)) return;
    setRescanTask(null);
    if (task.status !== "completed") {
      toast({ title: "Face re-scan failed", description: task.result ?? undefined, variant: "destructive" });
      return;
    }
    setSelected(null);
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["/api/face-review"] });
    toast({ title: "Face re-scan finished" });
  }, [task?.status]);

  const placedIds = placedIdsOf(faces);
  const taggedHere = new Set(faces.map((f) => f.identified?.username?.toLowerCase()).filter(Boolean));
  const extraMentions = mentions.filter((m) => !taggedHere.has(m.toLowerCase()));
  const hasInfo = !!current || mentions.length > 0;
  const drawBoxes = show && !!src && (faces.some((f) => f.box) || drawing || addFace.isPending);

  const nameLink = (face: FaceReviewFace) => {
    const href = identityHref(face.identified);
    return href ? (
      <Link href={href} className="hover:underline" onClick={onNavigate}>
        {face.identified!.label}
      </Link>
    ) : (
      <span>{face.identified?.label}</span>
    );
  };

  return (
    <>
      {drawBoxes ? (
        <FaceBoxOverlay
          src={src!}
          faces={faces.map((f) => ({
            key: f.faceUuid,
            box: f.box,
            color: f.color,
            label: String(f.number),
            variant: f.dismissed ? "muted" : f.identified ? "solid" : "dashed",
            autoScore: f.identified ? f.autoMatchScore : null,
          }))}
          width={current?.width}
          height={current?.height}
          imgClassName={imgClassName}
          onFaceClick={setSelected}
          onRemove={(k) => {
            const face = faces.find((f) => f.faceUuid === k);
            if (face) unassign(face);
          }}
        >
          {(boxStyle, natural) => (
            <>
              {drawing && <DrawFaceLayer natural={natural} onDraw={drawn} onCancel={() => setDrawing(false)} />}
              {addFace.isPending && (
                <div
                  className="pointer-events-none absolute flex items-center justify-center rounded-sm border-2 border-dashed border-white"
                  style={boxStyle(addFace.variables.box)}
                >
                  <Loader2 className="h-4 w-4 animate-spin text-white drop-shadow" />
                </div>
              )}
              {selectedFace?.box && (
              <Popover open onOpenChange={(o) => !o && setSelected(null)}>
                <PopoverAnchor className="pointer-events-none absolute" style={boxStyle(selectedFace.box)} />
                <PopoverContent
                  side="right"
                  align="start"
                  className="w-80 p-3 space-y-2.5"
                  // Keep ←/→ and typing inside the popover from paging the modal.
                  onKeyDown={(e) => e.stopPropagation()}
                  data-testid="popover-face"
                >
                  <FaceActions
                    key={selectedFace.faceUuid}
                    face={selectedFace}
                    nameLink={nameLink(selectedFace)}
                    chips={
                      <FaceIdentifyChips
                        face={selectedFace}
                        kind={current!.kind}
                        suggestions={current!.suggestions}
                        placedIds={placedIds}
                        onAssign={(target, label) => assign(selectedFace, target, label)}
                        onSkip={() => skip(selectedFace)}
                        onUnskip={() => unskip(selectedFace)}
                      />
                    }
                    onConfirm={() => {
                      const { label, ...target } = selectedFace.identified!;
                      assign(selectedFace, target, label);
                    }}
                    onUnassign={() => unassign(selectedFace)}
                  />
                </PopoverContent>
              </Popover>
              )}
            </>
          )}
        </FaceBoxOverlay>
      ) : (
        children
      )}

      {hasInfo && (
        <button
          type="button"
          className={`absolute left-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full shadow-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer ${
            show ? "bg-white text-black" : "bg-black/60 text-white hover:bg-black/80"
          }`}
          onClick={() => onShowChange(!show)}
          data-testid="button-toggle-faces"
          aria-label={show ? "Hide faces and mentions" : "Show faces and mentions"}
          aria-pressed={show}
        >
          <ScanFace className="h-4 w-4" />
        </button>
      )}

      {show && hasInfo && (
        <div
          className="absolute left-3 top-14 z-20 w-56 max-h-[60%] overflow-y-auto rounded-md bg-black/75 p-2.5 text-xs text-white shadow-lg backdrop-blur-sm space-y-2.5"
          data-testid="panel-faces"
        >
          {current && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Faces</p>
              {faces.length === 0 && <p className="italic text-white/60">No faces found</p>}
              {faces.map((f) => (
                <button
                  key={f.faceUuid}
                  type="button"
                  disabled={!drawBoxes || !f.box}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left enabled:hover:bg-white/10 enabled:cursor-pointer"
                  onClick={() => setSelected(f.faceUuid)}
                  data-testid={`face-row-${f.number}`}
                >
                  <span
                    className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-1 text-[10px] font-semibold"
                    style={{ backgroundColor: f.dismissed ? "rgb(107,114,128)" : f.color }}
                  >
                    {f.number}
                  </span>
                  {f.identified ? (
                    <span className="truncate">
                      {f.identified.label}
                      {f.autoMatchScore != null && <span className="text-white/60"> · Auto {Math.round(f.autoMatchScore * 100)}%</span>}
                    </span>
                  ) : (
                    <span className="truncate italic text-white/60">{f.dismissed ? "Skipped" : "Who is this?"}</span>
                  )}
                </button>
              ))}
              {src && (
                <button
                  type="button"
                  className="flex items-center gap-1 pt-1 text-[11px] text-white/70 enabled:hover:text-white disabled:opacity-60"
                  disabled={addFace.isPending || !!rescanTask}
                  onClick={() => {
                    setSelected(null);
                    setDrawing(!drawing);
                  }}
                  data-testid="button-draw-face"
                >
                  <SquareDashedMousePointer className="h-3 w-3" />
                  {drawing ? "Cancel drawing" : "Draw a box around a missed face"}
                </button>
              )}
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-white/70 enabled:hover:text-white disabled:opacity-60"
                disabled={rescan.isPending || !!rescanTask}
                onClick={() => rescan.mutate(current.photoId)}
                title="Detects this photo's faces from scratch. Names, skips and boxes you drew on it are dropped."
                data-testid="button-rescan-faces"
              >
                <RefreshCw className={`h-3 w-3 ${rescanTask ? "animate-spin" : ""}`} />
                {rescanTask ? "Re-scanning…" : "Re-scan faces in this photo"}
              </button>
            </div>
          )}
          {extraMentions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
                {faces.length > 0 ? "Also mentioned" : "Mentioned"}
              </p>
              <div className="flex flex-wrap gap-1">
                {extraMentions.map((account) => (
                  <span key={account} className="rounded-sm bg-white/15 px-1.5 py-0.5">
                    @{account}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Draw mode over the photo: drag a rectangle and it's handed back in the image's natural pixels,
 * clamped to the photo. Esc cancels without closing the modal.
 */
function DrawFaceLayer({ natural, onDraw, onCancel }: {
  natural: { w: number; h: number };
  onDraw: (box: FaceBox) => void;
  onCancel: () => void;
}) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  useEffect(() => {
    // Capture phase on window runs before the dialog's own Esc handling on document.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  /** Pointer position as a 0–1 fraction of the photo. */
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const rect = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair touch-none bg-black/20"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = at(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = at(e);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (!rect) return;
        setDrag(null);
        onDraw({
          x: Math.round(rect.left * natural.w),
          y: Math.round(rect.top * natural.h),
          w: Math.round(rect.width * natural.w),
          h: Math.round(rect.height * natural.h),
        });
      }}
      data-testid="layer-draw-face"
    >
      {!drag && (
        <p className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded bg-black/75 px-2 py-1 text-xs text-white">
          Drag a box around the face · Esc to cancel
        </p>
      )}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-dashed border-white"
          style={{ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
        />
      )}
    </div>
  );
}

/** The popover body for one face: who it is (or PRM's guess), and what can be done about it. */
function FaceActions({ face, nameLink, chips, onConfirm, onUnassign }: {
  face: FaceReviewFace;
  nameLink: ReactNode;
  chips: ReactNode;
  onConfirm: () => void;
  onUnassign: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const auto = !!face.identified && face.autoMatchScore != null;

  return (
    <>
      <div className="flex items-center gap-2.5">
        <img src={withImageSize(face.cropUrl, 128)} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
        <div className="min-w-0 text-sm">
          <p className="font-medium">Face {face.number}</p>
          <p className="text-xs text-muted-foreground">
            {auto ? (
              <>PRM thinks this is {nameLink} ({Math.round(face.autoMatchScore! * 100)}%)</>
            ) : face.identified ? (
              nameLink
            ) : face.dismissed ? (
              "Skipped"
            ) : (
              "Who is this?"
            )}
          </p>
        </div>
      </div>
      {face.identified && !changing ? (
        <div className="flex flex-wrap gap-1.5">
          {auto && (
            <Button size="sm" className="h-7 text-xs" onClick={onConfirm} data-testid="button-confirm-face">
              Yes
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setChanging(true)} data-testid="button-change-face">
            Change…
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onUnassign} data-testid="button-unassign-face">
            {auto ? "Not them" : "Remove name"}
          </Button>
        </div>
      ) : (
        chips
      )}
    </>
  );
}
