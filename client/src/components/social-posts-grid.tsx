import type { ReactNode } from "react";
import { Heart, MessageCircle, ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LikesHiddenBadge } from "@/components/likes-hidden-badge";
import { postPosters } from "@/lib/instagram";
import { withImageSize } from "@shared/image-size";
import type { SocialAccountPost } from "@shared/schema";

/**
 * A social account's posts as cards: thumbnail, caption, likes, comments,
 * date. The line over the caption is `renderByline` when given, else the
 * collab posters other than `accountId`. `dimmed` posts are faded. The
 * thumbnail is slide `coverIndex` (default the first).
 */
export function SocialPostsGrid<P extends SocialAccountPost>({
  posts,
  isLoading,
  accountId,
  onOpen,
  renderByline,
  dimmed,
  coverIndex,
  empty,
}: {
  posts: P[];
  isLoading: boolean;
  accountId: string | undefined;
  onOpen: (post: P) => void;
  renderByline?: (post: P) => ReactNode;
  dimmed?: (post: P) => boolean;
  coverIndex?: (post: P) => number;
  empty: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" data-testid="posts-loading-skeleton">
        {Array.from({ length: 10 }).map((_, i) => (
          <Card key={i} className="overflow-hidden shadow-none border">
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-3 pt-1">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-3 w-8" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }
  if (!posts.length) return <>{empty}</>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {posts.map((post) => {
        let images: string[] = [];
        try {
          images = post.content ? JSON.parse(post.content) : [];
        } catch {
          images = [];
        }
        const firstImage = images[coverIndex?.(post) ?? 0] || images[0] || null;
        // A collab post: the other posters, whichever of them this profile is.
        const collaborators = renderByline ? [] : postPosters(post).filter((p) => p.id !== accountId);

        return (
          <Card
            key={post.id}
            className={`overflow-hidden cursor-pointer hover:shadow-md transition-shadow${dimmed?.(post) ? " opacity-60" : ""}`}
            onClick={() => onOpen(post)}
            data-testid={`card-post-${post.id}`}
          >
            {/* Image thumbnail */}
            <div className="aspect-square bg-muted relative overflow-hidden">
              {firstImage ? (
                <img src={withImageSize(firstImage, 360)} alt="Post thumbnail" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                </div>
              )}
              {images.length > 1 && (
                <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">{images.length}</div>
              )}
            </div>

            {/* Post info */}
            <div className="p-3">
              {renderByline?.(post)}
              {collaborators.length > 0 && (
                <p className="text-xs text-muted-foreground mb-1 truncate" data-testid={`text-post-collab-${post.id}`}>
                  with {collaborators.map((c) => `@${c.username}`).join(", ")}
                </p>
              )}
              {post.description && <p className="text-sm line-clamp-2 mb-2">{post.description}</p>}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1" data-testid={`text-post-likes-${post.id}`}>
                  <Heart className="h-3 w-3" />
                  {post.likesHidden ? <LikesHiddenBadge /> : post.likeCount}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  {post.commentCount}
                </span>
                {(post.postedAt || post.createdAt) && (
                  <span className="ml-auto text-[11px] text-muted-foreground/80" data-testid={`text-post-date-${post.id}`}>
                    {new Date(post.postedAt ?? post.createdAt).toLocaleDateString()}
                  </span>
                )}
                {post.isDeleted && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0" data-testid={`badge-post-deleted-${post.id}`}>
                    Deleted
                  </Badge>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
