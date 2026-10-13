import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronLeft, ChevronRight, ExternalLink, ImageIcon, Info, Layers, Loader2, Sparkles, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { safeJsonParse } from "@/lib/utils";
import { HIGHLIGHT_PALETTE, type HighlightWithStints, type SocialAccountPost, type StorySeenBy, type TrackingJob } from "@shared/schema";
import { withImageSize } from "@shared/image-size";
import { PostSummarySection } from "@/components/account-summary";
import { VideoTranscript } from "@/components/video-transcript";

/** What prm-stories puts in social_account_posts.metadata for a story. */
interface StoryMetadata {
  expiresAt?: string | null;
  /** 1 image, 2 video — a video's image is its cover frame. */
  mediaType?: number | null;
  videoDuration?: number | null;
  /** Set when the importer had "Download videos" on and the mp4 was stored. */
  videoUrl?: string | null;
  links?: { url: string; display: string | null }[];
  hashtags?: string[];
  locations?: { name: string; pk: string | null }[];
  /** Older stories carry only mediaId/code; kind, url and ownerUsername came later. */
  resharedPost?: {
    kind?: "post" | "reel" | "story";
    mediaId?: string | null;
    code: string | null;
    url?: string;
    ownerUsername?: string | null;
  } | null;
  music?: { title: string | null; artist: string | null } | null;
  isAd?: boolean;
}

const firstImage = (post: SocialAccountPost) => safeJsonParse<string[]>(post.content, [])[0] ?? null;
const isVideo = (post: SocialAccountPost) => (post.metadata as StoryMetadata | null)?.mediaType === 2;
const mentionsOf = (post: SocialAccountPost) =>
  safeJsonParse<{ accounts?: string[] }[]>(post.mentionedAccounts, []).flatMap((m) => m.accounts ?? []);

/** A thin border in the sets' colors: solid for one, equal segments for several. */
function ringBackground(colors: string[]): string | undefined {
  if (colors.length <= 1) return colors[0];
  const step = 100 / colors.length;
  return `conic-gradient(${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
}

const when = (d: Date | string) => new Date(d).toLocaleString();

/** Every set this story has been in, deleted sets too, with when PRM learned it joined and left. */
function HighlightHistory({ postId, highlights }: { postId: string; highlights: HighlightWithStints[] }) {
  const rows = highlights.flatMap((set) => set.stints.filter((m) => m.postId === postId).map((m) => ({ set, m })));
  if (!rows.length) return null;
  return (
    <Row label="Highlights">
      <ul className="space-y-1.5">
        {rows.map(({ set, m }) => (
          <li key={m.id} className="flex items-start gap-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: set.color }} />
            <span>
              <span className="font-medium">{set.title || "Untitled"}</span>
              {set.deletedSeenAt && <span className="text-muted-foreground"> (set deleted)</span>}
              <span className="block text-xs text-muted-foreground">
                {new Date(m.placedSeenAt).getTime() === new Date(set.firstSeenAt).getTime()
                  ? `Already in the set when first seen ${when(m.placedSeenAt)}`
                  : `Placed in set, seen ${when(m.placedSeenAt)}`}
                {" · "}
                {m.leftSeenAt
                  ? `${m.leftReason === "set_deleted" ? "set deleted" : "left set"}, seen ${when(m.leftSeenAt)}`
                  : `still in set, last seen ${when(m.lastConfirmedAt)}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Row>
  );
}

/** Who viewed an own story, liked or replied ones first. Nothing at all until the scraper has read a list. */
function SeenBy({ seenBy, igLink }: { seenBy: StorySeenBy | null; igLink: (username: string) => React.ReactNode }) {
  if (!seenBy?.viewers.length) return null;
  const viewers = [...seenBy.viewers].sort((a, b) => Number(Boolean(b.reply) || b.liked) - Number(Boolean(a.reply) || a.liked));
  return (
    <Row label={`Seen by ${seenBy.viewerCount}`}>
      <div className="text-xs text-muted-foreground mb-2">
        Captured {when(seenBy.capturedAt)}
        {viewers.length < seenBy.viewerCount && ` · ${viewers.length} listed`}
      </div>
      <ul className="space-y-1 max-h-72 overflow-y-auto" data-testid="list-story-seen-by">
        {viewers.map((v) => (
          <li key={v.pk}>
            <span className="inline-flex items-center gap-1.5">
              {igLink(v.username)}
              {v.fullName && <span className="text-muted-foreground">{v.fullName}</span>}
              {v.liked && <span title="Liked">❤️</span>}
            </span>
            {v.reply && <div className="ml-4 text-muted-foreground">“{v.reply}”</div>}
          </li>
        ))}
      </ul>
    </Row>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** One story, or a day's worth of them with arrows to step through. */
function StoryDialog({ stories, highlights, onClose }: { stories: SocialAccountPost[]; highlights: HighlightWithStints[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const story = stories[index];
  if (!story) return null;
  const meta = (story.metadata ?? {}) as StoryMetadata;
  const image = firstImage(story);
  const mentions = mentionsOf(story);
  const igLink = (username: string) => (
    <a key={username} href={`https://www.instagram.com/${username}/`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      @{username}
    </a>
  );
  const prev = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => setIndex((i) => Math.min(stories.length - 1, i + 1));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-4xl w-full p-0 gap-0 overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") prev();
          if (e.key === "ArrowRight") next();
        }}
        data-testid="dialog-story-detail"
      >
        <DialogTitle className="sr-only">Story</DialogTitle>
        <div className="flex flex-col md:flex-row max-h-[85vh]">
          <div className="relative bg-black flex items-center justify-center md:w-[45%] shrink-0">
            {meta.videoUrl ? (
              <video
                ref={videoRef}
                key={story.id}
                src={meta.videoUrl}
                poster={withImageSize(image, 1080)}
                controls
                playsInline
                className="max-h-[85vh] w-full object-contain"
                data-testid="video-story"
              />
            ) : image ? (
              <img src={withImageSize(image, 1080)} alt={story.description ?? "Story"} className="max-h-[85vh] w-full object-contain" />
            ) : (
              <ImageIcon className="h-12 w-12 text-muted-foreground/40 my-24" />
            )}
            {stories.length > 1 && (
              <>
                <button
                  type="button"
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white shadow-md transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  onClick={prev}
                  disabled={index === 0}
                  data-testid="button-story-prev"
                  aria-label="Previous story"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white shadow-md transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  onClick={next}
                  disabled={index === stories.length - 1}
                  data-testid="button-story-next"
                  aria-label="Next story"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute top-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                  {index + 1} / {stories.length}
                </div>
              </>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <Row label="Posted">
              <span className="inline-flex items-center gap-1.5">
                {story.postedAt ? new Date(story.postedAt).toLocaleString() : "—"}
                {meta.expiresAt && <span className="text-muted-foreground"> · expired {new Date(meta.expiresAt).toLocaleString()}</span>}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Collection details" data-testid="button-story-provenance">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Scraped from {story.scrapedFrom ? `@${story.scrapedFrom}` : "an unknown account"}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            </Row>
            {isVideo(story) && (
              <Badge variant="outline" className="gap-1">
                <Video className="h-3 w-3" />
                Video{meta.videoDuration ? ` · ${Math.round(meta.videoDuration)}s` : ""}{meta.videoUrl ? "" : " — cover frame shown"}
              </Badge>
            )}
            <HighlightHistory postId={story.id} highlights={highlights} />
            {story.description && <Row label="Description">{story.description}</Row>}
            <VideoTranscript
              key={story.id}
              transcript={story.videoTranscript}
              onSeek={(t) => {
                if (!videoRef.current) return;
                videoRef.current.currentTime = t;
                videoRef.current.play();
              }}
            />
            <PostSummarySection postId={story.id} initialSummary={story.aiSummary} currentImageIndex={0} />
            {mentions.length > 0 && (
              <Row label="Mentions">
                <div className="flex flex-wrap gap-x-3 gap-y-1">{mentions.map(igLink)}</div>
              </Row>
            )}
            {!!meta.links?.length && (
              <Row label="Links">
                <ul className="space-y-1">
                  {meta.links.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline break-all">
                        {l.display ?? l.url}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              </Row>
            )}
            {!!meta.hashtags?.length && (
              <Row label="Hashtags">
                <div className="flex flex-wrap gap-1">
                  {meta.hashtags.map((h) => <Badge key={h} variant="secondary">#{h}</Badge>)}
                </div>
              </Row>
            )}
            {!!meta.locations?.length && <Row label="Location">{meta.locations.map((l) => l.name).join(", ")}</Row>}
            {meta.resharedPost && (() => {
              const r = meta.resharedPost;
              const url = r.url ?? (r.code ? `https://www.instagram.com/p/${r.code}/` : null);
              return (
                <Row label={`Reshared ${r.kind ?? "post"}`}>
                  <div className="space-y-1">
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline break-all">
                        {url.replace(/^https:\/\/www\./, "")}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    )}
                    {r.ownerUsername && <div>by {igLink(r.ownerUsername)}</div>}
                  </div>
                </Row>
              );
            })()}
            {meta.music && (meta.music.title || meta.music.artist) && (
              <Row label="Music">{[meta.music.title, meta.music.artist].filter(Boolean).join(" — ")}</Row>
            )}
            {meta.isAd && <Badge variant="outline">Paid partnership</Badge>}
            <SeenBy seenBy={story.seenBy} igLink={igLink} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StoriesTab({ accountId, stories }: { accountId: string; stories: SocialAccountPost[] }) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [combineDaily, setCombineDaily] = useState(false);
  const [selected, setSelected] = useState<SocialAccountPost[] | null>(null);
  const [setFilter, setSetFilter] = useState<string | null>(null);

  const highlightsKey = [`/api/social-accounts/${accountId}/highlights`];
  const { data: highlights = [] } = useQuery<HighlightWithStints[]>({ queryKey: highlightsKey });
  const recolor = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) => apiRequest("PATCH", `/api/instagram-highlights/${id}`, { color }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: highlightsKey }),
  });

  // Same key as the profile page, which polls it fast while a job is open.
  const { toast } = useToast();
  const jobsKey = [`/api/social-accounts/${accountId}/tracking-jobs`];
  const { data: jobs } = useQuery<TrackingJob[]>({ queryKey: jobsKey });
  const highlightsQueued = !!jobs?.some((j) => j.kind === "highlights" && (j.status === "queued" || j.status === "running"));
  const getHighlights = useMutation({
    mutationFn: () => apiRequest("POST", `/api/social-accounts/${accountId}/tracking-jobs`, { kind: "highlights" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobsKey });
      toast({ title: "Queued", description: "A highlights check will run on the next tracking run." });
    },
    onError: (e: Error) => toast({ title: "Could not get highlights", description: e.message, variant: "destructive" }),
  });
  // When the job finishes, pull in the sets and any stories it downloaded.
  const wasQueued = useRef(false);
  useEffect(() => {
    if (wasQueued.current && !highlightsQueued) {
      queryClient.invalidateQueries({ queryKey: highlightsKey });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", accountId, "posts?postType=story&includeDeleted=true"] });
    }
    wasQueued.current = highlightsQueued;
  }, [highlightsQueued, accountId]);
  // The grid shows current membership only; the dialog has the history.
  const live = highlights.filter((h) => !h.deletedSeenAt);
  const setsOf = new Map<string, HighlightWithStints[]>();
  for (const set of live) {
    for (const m of set.stints) if (!m.leftSeenAt) setsOf.set(m.postId, [...(setsOf.get(m.postId) ?? []), set]);
  }
  const activeSet = live.find((h) => h.id === setFilter) ?? null;

  useEffect(() => {
    if (typeof window === "undefined" || !stories.length) return;
    const params = new URLSearchParams(window.location.search);
    const storyPk = params.get("storyPk");
    if (!storyPk) return;
    const targetPost = stories.find((s) => s.instagramPk === storyPk);
    if (targetPost) {
      setSelected([targetPost]);
    }
  }, [stories]);

  const time = (p: SocialAccountPost) => new Date(p.postedAt ?? p.createdAt).getTime();
  const sorted = [...stories].sort((a, b) => (newestFirst ? time(b) - time(a) : time(a) - time(b)));

  // A card is one story, or — combined — every story from the same local day.
  // Within a day the stories stay in posting order so the arrows read like Instagram did.
  let cards: SocialAccountPost[][];
  let notDownloaded = 0;
  if (activeSet) {
    // A set reads in its own order (the sort button flips it); its stories aren't combined by day.
    const byId = new Map(stories.map((s) => [s.id, s]));
    const inSet = activeSet.stints.filter((m) => !m.leftSeenAt).sort((a, b) => a.position - b.position).map((m) => byId.get(m.postId));
    const held = inSet.filter((s): s is SocialAccountPost => Boolean(s));
    notDownloaded = inSet.length - held.length;
    cards = (newestFirst ? held : held.reverse()).map((s) => [s]);
  } else if (combineDaily) {
    const byDay = new Map<string, SocialAccountPost[]>();
    for (const s of sorted) {
      const day = new Date(time(s)).toDateString();
      byDay.set(day, [...(byDay.get(day) ?? []), s]);
    }
    cards = [...byDay.values()].map((day) => day.sort((a, b) => time(a) - time(b)));
  } else {
    cards = sorted.map((s) => [s]);
  }

  return (
    <div className="px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h2 className="text-lg font-semibold">Stories ({stories.length})</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => getHighlights.mutate()} disabled={getHighlights.isPending || highlightsQueued} data-testid="button-get-highlights">
            {getHighlights.isPending || highlightsQueued ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {highlightsQueued ? "Getting highlights…" : "Get highlights"}
          </Button>
          {!activeSet && (
            <Button variant={combineDaily ? "default" : "outline"} size="sm" onClick={() => setCombineDaily((v) => !v)} data-testid="button-combine-daily">
              <Layers className="h-4 w-4" />
              Combine daily stories
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setNewestFirst((v) => !v)} data-testid="button-sort-stories">
            {newestFirst ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
            {activeSet ? (newestFirst ? "Set order" : "Reversed") : newestFirst ? "Newest first" : "Oldest first"}
          </Button>
        </div>
      </div>

      {live.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="highlight-chips">
          <button
            type="button"
            onClick={() => setSetFilter(null)}
            className={`h-7 rounded-full border px-3 text-xs ${!activeSet ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
            data-testid="chip-highlight-all"
          >
            All
          </button>
          {live.map((set) => {
            const on = set.id === activeSet?.id;
            return (
              <div
                key={set.id}
                className="flex h-7 items-center rounded-full border pl-1.5 text-xs"
                style={on ? { borderColor: set.color, background: `${set.color}22` } : undefined}
              >
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="h-4 w-4 rounded-full ring-offset-background hover:ring-2 hover:ring-ring" style={{ background: set.color }} aria-label={`Change color of ${set.title || "set"}`} data-testid={`button-highlight-color-${set.id}`} />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2">
                    <div className="grid grid-cols-5 gap-1.5">
                      {HIGHLIGHT_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`h-6 w-6 rounded-full ${c === set.color ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""}`}
                          style={{ background: c }}
                          onClick={() => recolor.mutate({ id: set.id, color: c })}
                          aria-label={c}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <button type="button" onClick={() => setSetFilter(on ? null : set.id)} className="h-full pl-1.5 pr-3" data-testid={`chip-highlight-${set.id}`}>
                  {set.title || "Untitled"} <span className="text-muted-foreground">{set.stints.filter((m) => !m.leftSeenAt).length}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {notDownloaded > 0 && (
        <p className="mb-4 text-xs text-muted-foreground">{notDownloaded} {notDownloaded === 1 ? "story" : "stories"} in this set not downloaded yet</p>
      )}

      {cards.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No stories recorded yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {cards.map((group) => {
            const cover = group[0];
            const image = firstImage(cover);
            // Every set any story on the card is in, once each.
            const sets = [...new Map(group.flatMap((s) => setsOf.get(s.id) ?? []).map((h) => [h.id, h])).values()];
            return (
              <div key={cover.id} className="rounded-lg" style={sets.length ? { background: ringBackground(sets.map((h) => h.color)), padding: 2 } : undefined}>
              <button
                type="button"
                onClick={() => setSelected(group)}
                className="group relative block w-full aspect-[9/16] overflow-hidden rounded-md bg-muted text-left focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid={`card-story-${cover.id}`}
              >
                {image ? (
                  <img src={withImageSize(image, 360)} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                )}
                {group.length > 1 && (
                  <div className="absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">{group.length}</div>
                )}
                {isVideo(cover) && <Video className="absolute top-2 left-2 h-4 w-4 text-white drop-shadow" />}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-[11px] text-white">
                  {cover.postedAt ? new Date(cover.postedAt).toLocaleDateString() : ""}
                  {sets.length > 0 && <div className="truncate opacity-90">{sets.map((h) => h.title || "Untitled").join(" · ")}</div>}
                </div>
              </button>
              </div>
            );
          })}
        </div>
      )}

      {selected && <StoryDialog key={selected[0].id} stories={selected} highlights={highlights} onClose={() => setSelected(null)} />}
    </div>
  );
}
