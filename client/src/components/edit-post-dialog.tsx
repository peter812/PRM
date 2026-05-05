import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Loader2, X, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { safeJsonParse } from "@/lib/utils";
import type { SocialAccountPost } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface MentionEntry {
  imageIndex: number;
  accounts: string[];
}

/**
 * Build a Map<imageIndex, commaSeparatedAccounts> from the stored JSON.
 * Falls back gracefully for old comma-separated strings or invalid data.
 */
function buildMentionMap(raw: string | null | undefined): Map<number, string> {
  const map = new Map<number, string>();
  if (!raw) return map;
  const parsed = safeJsonParse<MentionEntry[]>(raw, []);
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && "imageIndex" in parsed[0]) {
    for (const entry of parsed) {
      if (typeof entry.imageIndex === "number" && Array.isArray(entry.accounts)) {
        map.set(entry.imageIndex, entry.accounts.join(", "));
      }
    }
  }
  return map;
}

interface EditPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: SocialAccountPost;
  socialAccountId: string;
}

export function EditPostDialog({ open, onOpenChange, post, socialAccountId }: EditPostDialogProps) {
  const { toast } = useToast();
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [mentionsByImage, setMentionsByImage] = useState<string[]>([""]);
  const [description, setDescription] = useState("");
  const [comments, setComments] = useState("");
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [isDeleted, setIsDeleted] = useState(false);

  useEffect(() => {
    if (open && post) {
      const urls = safeJsonParse<string[]>(post.content, []);
      const parsedUrls = Array.isArray(urls) && urls.length > 0 ? urls : [""];
      setImageUrls(parsedUrls);
      setDescription(post.description ?? "");
      setComments(post.comments ?? "");
      setLikeCount(post.likeCount ?? 0);
      setCommentCount(post.commentCount ?? 0);
      setIsDeleted(post.isDeleted ?? false);

      const mentionMap = buildMentionMap(post.mentionedAccounts);
      const mentions: string[] = parsedUrls.map((_, idx) => mentionMap.get(idx) ?? "");
      setMentionsByImage(mentions);
    }
  }, [open, post]);

  /**
   * Build the mentionedAccounts JSON reindexed against the filtered URL list.
   * originalIndices[i] = the original row index in imageUrls for filtered position i.
   */
  const buildMentionedAccounts = (originalIndices: number[]): string | null => {
    const result: MentionEntry[] = [];
    originalIndices.forEach((origIdx, newIdx) => {
      const raw = (mentionsByImage[origIdx] ?? "").trim();
      if (raw) {
        const accounts = raw.split(",").map(a => a.trim()).filter(Boolean);
        if (accounts.length > 0) {
          result.push({ imageIndex: newIdx, accounts });
        }
      }
    });
    return result.length > 0 ? JSON.stringify(result) : null;
  };

  const updatePostMutation = useMutation({
    mutationFn: async () => {
      const originalIndices: number[] = [];
      const filteredUrls: string[] = [];
      imageUrls.forEach((url, i) => {
        if (url.trim() !== "") {
          filteredUrls.push(url);
          originalIndices.push(i);
        }
      });
      return await apiRequest("PATCH", `/api/social-account-posts/${post.id}`, {
        content: filteredUrls.length > 0 ? JSON.stringify(filteredUrls) : null,
        description: description || null,
        comments: comments || null,
        likeCount,
        commentCount,
        mentionedAccounts: buildMentionedAccounts(originalIndices),
        isDeleted,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", socialAccountId, "posts"] });
      toast({
        title: "Success",
        description: "Post updated successfully",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update post",
        variant: "destructive",
      });
    },
  });

  const addImageUrl = () => {
    setImageUrls([...imageUrls, ""]);
    setMentionsByImage([...mentionsByImage, ""]);
  };

  const removeImageUrl = (index: number) => {
    setImageUrls(imageUrls.filter((_, i) => i !== index));
    setMentionsByImage(mentionsByImage.filter((_, i) => i !== index));
  };

  const updateImageUrl = (index: number, value: string) => {
    const updated = [...imageUrls];
    updated[index] = value;
    setImageUrls(updated);
  };

  const updateMentions = (index: number, value: string) => {
    const updated = [...mentionsByImage];
    updated[index] = value;
    setMentionsByImage(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-5 w-5" />
            Edit Post
          </DialogTitle>
          <DialogDescription>
            Update post details
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Image URLs with per-image mentions */}
          <div className="space-y-3">
            <Label>Images</Label>
            {imageUrls.map((url, index) => (
              <div key={index} className="space-y-1.5 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground min-w-[3rem]">Image {index + 1}</span>
                  <Input
                    placeholder="https://cdn.example.com/image.jpg"
                    value={url}
                    onChange={(e) => updateImageUrl(index, e.target.value)}
                    data-testid={`input-edit-image-url-${index}`}
                  />
                  {imageUrls.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeImageUrl(index)}
                      data-testid={`button-remove-edit-image-${index}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 pl-[3.5rem]">
                  <Input
                    placeholder="Mentioned accounts (comma-separated)"
                    value={mentionsByImage[index] ?? ""}
                    onChange={(e) => updateMentions(index, e.target.value)}
                    className="text-sm"
                    data-testid={`input-edit-mentions-image-${index}`}
                  />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addImageUrl} data-testid="button-add-edit-image-url">
              <Plus className="h-4 w-4" />
              Add Image
            </Button>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="edit-post-description">Description</Label>
            <Textarea
              id="edit-post-description"
              placeholder="Post description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20"
              data-testid="textarea-edit-post-description"
            />
          </div>

          {/* Comments */}
          <div className="space-y-2">
            <Label htmlFor="edit-post-comments-json">Comments (JSON or text)</Label>
            <Textarea
              id="edit-post-comments-json"
              placeholder='[{"author":"user1","text":"Great post!"}] or plain text...'
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              className="min-h-20 font-mono text-sm"
              data-testid="textarea-edit-post-comments"
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-post-likes">Like Count</Label>
              <Input
                id="edit-post-likes"
                type="number"
                min={0}
                value={likeCount}
                onChange={(e) => setLikeCount(parseInt(e.target.value) || 0)}
                data-testid="input-edit-like-count"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-post-comment-count">Comment Count</Label>
              <Input
                id="edit-post-comment-count"
                type="number"
                min={0}
                value={commentCount}
                onChange={(e) => setCommentCount(parseInt(e.target.value) || 0)}
                data-testid="input-edit-comment-count"
              />
            </div>
          </div>

          {/* Mark as Deleted */}
          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="edit-post-deleted" className="text-base font-medium">
                Mark as Deleted
              </Label>
              <p className="text-sm text-muted-foreground">
                Mark this post as deleted (soft delete)
              </p>
            </div>
            <Switch
              id="edit-post-deleted"
              checked={isDeleted}
              onCheckedChange={setIsDeleted}
              data-testid="switch-post-deleted"
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit-post">
              Cancel
            </Button>
            <Button
              onClick={() => updatePostMutation.mutate()}
              disabled={updatePostMutation.isPending}
              data-testid="button-submit-edit-post"
            >
              {updatePostMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
