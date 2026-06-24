import { useState } from "react";
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Edit2, X, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SocialAccountPost } from "@shared/schema";
import { safeJsonParse } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

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

        <div className="flex flex-col md:flex-row min-h-[400px] max-h-[85vh]">
          {/* Image Section */}
          <div className="relative flex-1 bg-black flex items-center justify-center min-h-[300px] md:min-h-[400px]">
            {images.length > 0 ? (
              <>
                <img
                  src={images[currentImageIndex]}
                  alt={`Post image ${currentImageIndex + 1}`}
                  className="max-w-full max-h-[60vh] md:max-h-[80vh] object-contain"
                  data-testid="img-post-detail"
                />

                {/* Navigation Arrows */}
                {images.length > 1 && (
                  <>
                    {currentImageIndex > 0 && (
                      <button
                        type="button"
                        className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        onClick={prevImage}
                        data-testid="button-prev-image"
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </button>
                    )}
                    {currentImageIndex < images.length - 1 && (
                      <button
                        type="button"
                        className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        onClick={nextImage}
                        data-testid="button-next-image"
                      >
                        <ChevronRight className="h-6 w-6" />
                      </button>
                    )}

                    {/* Image Dots */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {images.map((_, idx) => (
                        <button
                          key={idx}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            idx === currentImageIndex ? "bg-white" : "bg-white/40"
                          }`}
                          onClick={() => setCurrentImageIndex(idx)}
                          data-testid={`button-image-dot-${idx}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center text-muted-foreground p-8">
                <p className="text-lg">No images</p>
              </div>
            )}
          </div>

          {/* Info Section */}
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l flex flex-col overflow-auto bg-background">
            <div className="p-4 space-y-4 flex-1">
              {/* Description & Caption Info */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Caption</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        data-testid="button-post-info"
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" align="end">
                      <div className="space-y-2">
                        <h4 className="font-medium leading-none text-sm font-semibold">Post Metadata</h4>
                        <p className="text-xs text-muted-foreground">Internal database identifiers for this post.</p>
                        <div className="border-t pt-2 mt-2 space-y-1.5 text-xs">
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-muted-foreground font-medium">Post ID:</span>
                            <code className="bg-muted px-1.5 py-0.5 rounded select-all break-all text-[10px]" data-testid="text-metadata-post-id">{post.id}</code>
                          </div>
                          <div className="flex justify-between items-center gap-2">
                            <span className="text-muted-foreground font-medium">Account ID:</span>
                            <code className="bg-muted px-1.5 py-0.5 rounded select-all break-all text-[10px]" data-testid="text-metadata-account-id">{post.socialAccountId}</code>
                          </div>
                          {post.postType && (
                            <div className="flex justify-between items-center gap-2">
                              <span className="text-muted-foreground font-medium">Post Type:</span>
                              <span className="capitalize">{post.postType}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <p className="text-sm whitespace-pre-wrap" data-testid="text-post-description">
                  {post.description || <span className="italic text-muted-foreground">No caption</span>}
                </p>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-sm" data-testid="text-post-likes">
                  <Heart className="h-4 w-4" />
                  <span>{(post.likeCount ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm" data-testid="text-post-comments">
                  <MessageCircle className="h-4 w-4" />
                  <span>{(post.commentCount ?? 0).toLocaleString()}</span>
                </div>
              </div>

              {/* Per-image Mentioned Accounts */}
              {mentionsForCurrentImage.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Mentioned in image {currentImageIndex + 1}
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

              {/* Date info */}
              {post.postedAt && (
                <p className="text-xs text-muted-foreground" data-testid="text-post-date">
                  Posted: {new Date(post.postedAt).toLocaleDateString()}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Added: {new Date(post.createdAt).toLocaleDateString()}
              </p>

              {post.isDeleted && (
                <Badge variant="destructive" className="text-xs">
                  Deleted
                </Badge>
              )}
            </div>

            {/* Actions */}
            <div className="border-t p-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  onOpenChange(false);
                  onEdit();
                }}
                data-testid="button-edit-from-detail"
              >
                <Edit2 className="h-4 w-4 mr-1" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  onOpenChange(false);
                  onDelete();
                }}
                data-testid="button-delete-from-detail"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
