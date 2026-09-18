import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Edit2, X, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LikesHiddenBadge } from "@/components/likes-hidden-badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import type { SocialAccountPost, SocialPostCommentWithAccount } from "@shared/schema";
import { safeJsonParse } from "@/lib/utils";
import { postPosters } from "@/lib/instagram";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

interface MentionEntry {
  imageIndex: number;
  accounts: string[];
}

function getMentionsForImage(raw: string | null | undefined, imageIndex: number): string[] {
  if (!raw) return [];
  const parsed = safeJsonParse<MentionEntry[]>(raw, []);
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && "imageIndex" in parsed[0]) {
    const entry = parsed.find(e => e.imageIndex === imageIndex);
    return entry?.accounts ?? [];
  }
  return [];
}

function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const cleanUrl = url.split("?")[0].toLowerCase();
  return (
    cleanUrl.endsWith(".mp4") ||
    cleanUrl.endsWith(".webm") ||
    cleanUrl.endsWith(".mov") ||
    url.startsWith("/api/media/")
  );
}

interface PostDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: SocialAccountPost;
  onEdit: () => void;
  onDelete: () => void;
}

export function PostDetailDialog({ open, onOpenChange, post, onEdit, onDelete }: PostDetailDialogProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const images: string[] = safeJsonParse<string[]>(post.content, []);

  const { data: comments, isLoading: isLoadingComments } = useQuery<SocialPostCommentWithAccount[]>({
    queryKey: [`/api/social-account-posts/${post.id}/comments`],
    enabled: open && !!post.id,
    staleTime: 10_000,
  });

  const commentCountLabel = comments
    ? post.commentCount && post.commentCount > comments.length
      ? `${comments.length} of ${post.commentCount}`
      : `${comments.length}`
    : `${post.commentCount ?? 0}`;

  const nextImage = () => {
    if (currentImageIndex < images.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    }
  };

  const prevImage = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") prevImage();
    if (e.key === "ArrowRight") nextImage();
  };

  const mentionsForCurrentImage = getMentionsForImage(post.mentionedAccounts, currentImageIndex);
  const posters = postPosters(post);

  const renderDescriptionWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline break-all"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      onOpenChange(o);
      if (!o) setCurrentImageIndex(0);
    }}>
      <DialogContent
        className="max-w-5xl w-full p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 z-10"
          onClick={() => onOpenChange(false)}
          data-testid="button-close-post-detail"
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="flex flex-col md:flex-row min-h-[400px] max-h-[85vh] h-[85vh]">
          {/* Image/Video Section */}
          <div className="relative flex-1 bg-black flex items-center justify-center min-h-[300px] md:min-h-[400px] overflow-hidden">
            {images.length > 0 ? (
              <div className="relative max-w-full max-h-[60vh] md:max-h-[80vh] flex items-center justify-center w-fit h-fit">
                {isVideoUrl(images[currentImageIndex]) ? (
                  <video
                    src={images[currentImageIndex]}
                    controls
                    className="max-w-full max-h-[60vh] md:max-h-[80vh] object-contain block"
                    data-testid="video-post-detail"
                  />
                ) : (
                  <img
                    src={images[currentImageIndex]}
                    alt={`Post image ${currentImageIndex + 1}`}
                    className="max-w-full max-h-[60vh] md:max-h-[80vh] object-contain block"
                    data-testid="img-post-detail"
                  />
                )}

                {/* Navigation Arrows */}
                {images.length > 1 && (
                  <>
                    {currentImageIndex > 0 && (
                      <button
                        type="button"
                        className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white shadow-md transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                        onClick={prevImage}
                        data-testid="button-prev-image"
                        aria-label="Previous image"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                    )}
                    {currentImageIndex < images.length - 1 && (
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white shadow-md transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                        onClick={nextImage}
                        data-testid="button-next-image"
                        aria-label="Next image"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    )}

                    {/* Image Dots */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
                      {images.map((_, idx) => (
                        <button
                          type="button"
                          key={idx}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            idx === currentImageIndex ? "bg-white" : "bg-white/40"
                          }`}
                          onClick={() => setCurrentImageIndex(idx)}
                          data-testid={`button-image-dot-${idx}`}
                          aria-label={`Go to image ${idx + 1}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center text-muted-foreground p-8">
                <p className="text-lg">No images</p>
              </div>
            )}
          </div>

          {/* Info Section */}
          <div className="w-full md:w-[420px] border-t md:border-t-0 md:border-l flex flex-col h-full overflow-hidden bg-background">
            {/* Header: Posters & Close button area */}
            <div className="p-3.5 border-b shrink-0 flex items-center justify-between gap-2 pr-10">
              {posters.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1 text-sm font-medium" data-testid="text-post-posters">
                  {posters.map((p, i) => (
                    <span key={p.username} className="flex items-center gap-1">
                      {i > 0 && <span className="text-muted-foreground font-normal">with</span>}
                      {p.id ? (
                        <Link
                          href={`/social-accounts/${p.id}`}
                          className={`hover:underline ${p.primary ? "font-semibold text-foreground" : "text-foreground/90"}`}
                          onClick={() => onOpenChange(false)}
                        >
                          @{p.username}
                        </Link>
                      ) : (
                        <span className={p.primary ? "font-semibold text-foreground" : "text-foreground/90"}>
                          @{p.username}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-sm font-semibold">Post</div>
              )}
            </div>

            {/* Scrollable body: Caption, Mentions, Comments */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4 space-y-4">
                {/* Description */}
                {post.description && (
                  <div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed break-words" data-testid="text-post-description">
                      {renderDescriptionWithLinks(post.description)}
                    </p>
                  </div>
                )}

                {/* Per-image Mentioned Accounts */}
                {mentionsForCurrentImage.length > 0 && (
                  <div className="rounded-md bg-muted/50 p-2.5 space-y-1.5">
                    <p className="text-xs text-muted-foreground font-medium">
                      Mentioned in slide {currentImageIndex + 1}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {mentionsForCurrentImage.map((account, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          @{account}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                {/* Comments Section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>Comments ({commentCountLabel})</span>
                  </div>

                  {isLoadingComments ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
                      <span className="text-xs">Loading comments...</span>
                    </div>
                  ) : comments && comments.length > 0 ? (
                    <div className="space-y-3.5" data-testid="post-comments-list">
                      {comments.map((comment) => (
                        <div key={comment.id} className="flex items-start gap-2.5 text-xs group" data-testid={`comment-item-${comment.id}`}>
                          <Avatar className="h-7 w-7 shrink-0 mt-0.5 border border-border/40">
                            {comment.accountImageUrl && (
                              <AvatarImage src={comment.accountImageUrl} alt={comment.username} />
                            )}
                            <AvatarFallback className="text-[10px] font-semibold bg-muted uppercase">
                              {comment.username.slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-baseline gap-1.5 flex-wrap">
                              {comment.accountId ? (
                                <Link
                                  href={`/social-accounts/${comment.accountId}`}
                                  className="font-semibold text-foreground hover:underline"
                                  onClick={() => onOpenChange(false)}
                                >
                                  @{comment.username}
                                </Link>
                              ) : (
                                <a
                                  href={`https://www.instagram.com/${encodeURIComponent(comment.username)}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold text-foreground hover:underline"
                                >
                                  @{comment.username}
                                </a>
                              )}
                              {comment.postedAt && (
                                <span className="text-[10px] text-muted-foreground">
                                  {formatDistanceToNow(new Date(comment.postedAt), { addSuffix: true })}
                                </span>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap break-words text-foreground/90 leading-relaxed">
                              {renderDescriptionWithLinks(comment.text)}
                            </p>
                            {comment.likeCount > 0 && (
                              <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-0.5">
                                <Heart className="h-3 w-3 fill-rose-500 text-rose-500" />
                                <span>{comment.likeCount.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-muted-foreground space-y-1">
                      <p className="text-xs font-medium">
                        {(post.commentCount ?? 0) > 0
                          ? "No comments imported yet"
                          : "No comments on this post"}
                      </p>
                      {(post.commentCount ?? 0) > 0 && (
                        <p className="text-[11px] text-muted-foreground/70">
                          Comments are imported when &apos;Import comments&apos; is enabled in settings.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>

            {/* Pinned Bottom / Footer Section */}
            <div className="border-t p-3 space-y-2.5 shrink-0 bg-background/95 backdrop-blur">
              {/* Stats & Meta */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-xs" data-testid="text-post-likes">
                    <Heart className="h-3.5 w-3.5 text-muted-foreground" />
                    {post.likesHidden ? <LikesHiddenBadge /> : <span>{(post.likeCount ?? 0).toLocaleString()}</span>}
                  </div>
                  <div className="flex items-center gap-1 text-xs" data-testid="text-post-comments">
                    <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{(post.commentCount ?? 0).toLocaleString()}</span>
                  </div>
                </div>

                {post.isDeleted && (
                  <Badge variant="destructive" className="text-[10px] h-5">
                    Deleted
                  </Badge>
                )}
              </div>

              {/* Dates */}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                {post.postedAt && (
                  <span data-testid="text-post-date">
                    Posted: {new Date(post.postedAt).toLocaleDateString()}
                  </span>
                )}
                <span>
                  Added: {new Date(post.createdAt).toLocaleDateString()}
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => {
                    onOpenChange(false);
                    onEdit();
                  }}
                  data-testid="button-edit-from-detail"
                >
                  <Edit2 className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-destructive hover:text-destructive text-xs"
                  onClick={() => {
                    onOpenChange(false);
                    onDelete();
                  }}
                  data-testid="button-delete-from-detail"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
