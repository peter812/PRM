import { useState, useEffect } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronLeft, ChevronRight, ExternalLink, ImageIcon, Info, Layers, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { safeJsonParse } from "@/lib/utils";
import type { SocialAccountPost } from "@shared/schema";

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
  resharedPost?: { mediaId: string; code: string | null } | null;
  music?: { title: string | null; artist: string | null } | null;
  isAd?: boolean;
}

const firstImage = (post: SocialAccountPost) => safeJsonParse<string[]>(post.content, [])[0] ?? null;
const isVideo = (post: SocialAccountPost) => (post.metadata as StoryMetadata | null)?.mediaType === 2;
const mentionsOf = (post: SocialAccountPost) =>
  safeJsonParse<{ accounts?: string[] }[]>(post.mentionedAccounts, []).flatMap((m) => m.accounts ?? []);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** One story, or a day's worth of them with arrows to step through. */
function StoryDialog({ stories, onClose }: { stories: SocialAccountPost[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
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
                key={story.id}
                src={meta.videoUrl}
                poster={image ?? undefined}
                controls
                playsInline
                className="max-h-[85vh] w-full object-contain"
                data-testid="video-story"
              />
            ) : image ? (
              <img src={image} alt={story.description ?? "Story"} className="max-h-[85vh] w-full object-contain" />
            ) : (
              <ImageIcon className="h-12 w-12 text-muted-foreground/40 my-24" />
            )}
            {stories.length > 1 && (
              <>
                <Button variant="ghost" size="icon" className="absolute left-1 top-1/2 -translate-y-1/2 text-white hover:bg-white/20" onClick={prev} disabled={index === 0} data-testid="button-story-prev">
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 text-white hover:bg-white/20" onClick={next} disabled={index === stories.length - 1} data-testid="button-story-next">
                  <ChevronRight className="h-6 w-6" />
                </Button>
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
            {story.description && <Row label="Description">{story.description}</Row>}
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
            {meta.resharedPost && (
              <Row label="Reshared post">
                {meta.resharedPost.code ? (
                  <a href={`https://www.instagram.com/p/${meta.resharedPost.code}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    instagram.com/p/{meta.resharedPost.code}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : meta.resharedPost.mediaId}
              </Row>
            )}
            {meta.music && (meta.music.title || meta.music.artist) && (
              <Row label="Music">{[meta.music.title, meta.music.artist].filter(Boolean).join(" — ")}</Row>
            )}
            {meta.isAd && <Badge variant="outline">Paid partnership</Badge>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StoriesTab({ stories }: { stories: SocialAccountPost[] }) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [combineDaily, setCombineDaily] = useState(false);
  const [selected, setSelected] = useState<SocialAccountPost[] | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !stories.length) return;
    const params = new URLSearchParams(window.location.search);
    const storyPk = params.get("storyPk");
    if (!storyPk) return;
    const targetPost = stories.find((s) => {
      const meta = (s.metadata ?? {}) as any;
      if (meta.storyPk === storyPk) return true;
      if (s.id && s.id.includes(storyPk)) return true;
      return false;
    });
    if (targetPost) {
      setSelected([targetPost]);
    }
  }, [stories]);

  const time = (p: SocialAccountPost) => new Date(p.postedAt ?? p.createdAt).getTime();
  const sorted = [...stories].sort((a, b) => (newestFirst ? time(b) - time(a) : time(a) - time(b)));

  // A card is one story, or — combined — every story from the same local day.
  // Within a day the stories stay in posting order so the arrows read like Instagram did.
  let cards: SocialAccountPost[][];
  if (combineDaily) {
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
          <Button variant={combineDaily ? "default" : "outline"} size="sm" onClick={() => setCombineDaily((v) => !v)} data-testid="button-combine-daily">
            <Layers className="h-4 w-4" />
            Combine daily stories
          </Button>
          <Button variant="outline" size="sm" onClick={() => setNewestFirst((v) => !v)} data-testid="button-sort-stories">
            {newestFirst ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
            {newestFirst ? "Newest first" : "Oldest first"}
          </Button>
        </div>
      </div>

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
            return (
              <button
                key={cover.id}
                type="button"
                onClick={() => setSelected(group)}
                className="group relative aspect-[9/16] overflow-hidden rounded-md bg-muted text-left focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid={`card-story-${cover.id}`}
              >
                {image ? (
                  <img src={image} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
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
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && <StoryDialog key={selected[0].id} stories={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
