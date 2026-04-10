import { useState } from "react";
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Edit2, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SocialAccountPost } from "@shared/schema";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

interface PostDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: SocialAccountPost;
  onEdit: () => void;
  onDelete: () => void;
}

export function PostDetailDialog({ open, onOpenChange, post, onEdit, onDelete }: PostDetailDialogProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  let images: string[] = [];
  try {
    images = post.content ? JSON.parse(post.content) : [];
  } catch {
    images = [];
  }

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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full"
                        onClick={prevImage}
                        data-testid="button-prev-image"
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </Button>
                    )}
                    {currentImageIndex < images.length - 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full"
                        onClick={nextImage}
                        data-testid="button-next-image"
                      >
                        <ChevronRight className="h-6 w-6" />
                      </Button>
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
              {/* Description */}
              {post.description && (
                <div>
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-post-description">
                    {post.description}
                  </p>
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-sm" data-testid="text-post-likes">
                  <Heart className="h-4 w-4" />
                  <span>{post.likeCount.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm" data-testid="text-post-comments">
                  <MessageCircle className="h-4 w-4" />
                  <span>{post.commentCount.toLocaleString()}</span>
                </div>
              </div>

              {/* Mentioned Accounts */}
              {post.mentionedAccounts && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Mentioned</p>
                  <div className="flex flex-wrap gap-1">
                    {post.mentionedAccounts.split(",").map((account, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        @{account.trim()}
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
