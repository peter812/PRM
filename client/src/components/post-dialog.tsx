import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Loader2, X, ImagePlus } from "lucide-react";
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

interface PostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  socialAccountId: string;
  post?: SocialAccountPost;
}

export function PostDialog({ open, onOpenChange, socialAccountId, post }: PostDialogProps) {
  const isEdit = !!post;
  const { toast } = useToast();
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [mentionsByImage, setMentionsByImage] = useState<string[]>([""]);
  const [description, setDescription] = useState("");
  const [comments, setComments] = useState("");
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [isDeleted, setIsDeleted] = useState(false);

  useEffect(() => {
    if (open) {
      if (isEdit && post) {
        const urls = safeJsonParse<string[]>(post.content, []);
        const parsedUrls = Array.isArray(urls) && urls.length > 0 ? urls : [""];
        setImageUrls(parsedUrls);
        setDescription(post.description ?? "");
        setComments(post.comments ?? "");
        setLikeCount(post.likeCount ?? 0);
        setCommentCount(post.commentCount ?? 0);
        setIsDeleted(post.isDeleted ?? false);

        const mentionMap = buildMentionMap(post.mentionedAccounts);
        const mentions = parsedUrls.map((_, idx) => mentionMap.get(idx) ?? "");
        setMentionsByImage(mentions);
      } else {
        setImageUrls([""]);
        setMentionsByImage([""]);
        setDescription("");
        setComments("");
        setLikeCount(0);
        setCommentCount(0);
        setIsDeleted(false);
      }
    }
  }, [open, post, isEdit]);

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

  const mutation = useMutation({
    mutationFn: async () => {
      const originalIndices: number[] = [];
      const filteredUrls: string[] = [];
      imageUrls.forEach((url, i) => {
        if (url.trim() !== "") {
          filteredUrls.push(url);
          originalIndices.push(i);
        }
      });

      const payload = {
        content: filteredUrls.length > 0 ? JSON.stringify(filteredUrls) : null,
        description: description || null,
        comments: comments || null,
        likeCount,
        commentCount,
        mentionedAccounts: buildMentionedAccounts(originalIndices),
        isDeleted: isEdit ? isDeleted : false,
      };

      if (isEdit && post) {
        return await apiRequest("PATCH", `/api/social-accounts/${socialAccountId}/posts/${post.id}`, payload);
      } else {
        return await apiRequest("POST", `/api/social-accounts/${socialAccountId}/posts`, payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", socialAccountId, "posts"] });
      toast({
        title: "Success",
        description: isEdit ? "Post updated successfully" : "Post created successfully",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: `Failed to ${isEdit ? "update" : "create"} post`,
        variant: "destructive",
      });
    },
  });

  const addImageUrl = () => {
    setImageUrls([...imageUrls, ""]);
    setMentionsByImage([...mentionsByImage, ""]);
  };

  const removeImageUrl = (index: number) => {
    if (imageUrls.length === 1) {
      setImageUrls([""]);
      setMentionsByImage([""]);
      return;
    }
    setImageUrls(imageUrls.filter((_, i) => i !== index));
    setMentionsByImage(mentionsByImage.filter((_, i) => i !== index));
  };

  const handleImageUrlChange = (index: number, val: string) => {
    const updated = [...imageUrls];
    updated[index] = val;
    setImageUrls(updated);
  };

  const handleMentionsChange = (index: number, val: string) => {
    const updated = [...mentionsByImage];
    updated[index] = val;
    setMentionsByImage(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Post" : "Add New Post"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update social media post details"
              : "Create a new social media post record"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Images */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Image URLs</Label>
              <Button type="button" variant="outline" size="sm" onClick={addImageUrl} className="h-8">
                <ImagePlus className="h-4 w-4 mr-1" />
                Add Image
              </Button>
            </div>
            {imageUrls.map((url, i) => (
              <div key={i} className="space-y-2 border p-3 rounded-md bg-muted/30 relative">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => removeImageUrl(i)}
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="pr-8 space-y-2">
                  <div>
                    <Label htmlFor={`post-url-${i}`} className="text-xs">URL</Label>
                    <Input
                      id={`post-url-${i}`}
                      placeholder="https://example.com/image.jpg"
                      value={url}
                      onChange={(e) => handleImageUrlChange(i, e.target.value)}
                      data-testid={isEdit ? `input-edit-image-url-${i}` : `input-image-url-${i}`}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`post-mentions-${i}`} className="text-xs">Mentioned accounts (comma-separated)</Label>
                    <Input
                      id={`post-mentions-${i}`}
                      placeholder="account1, account2"
                      value={mentionsByImage[i] || ""}
                      onChange={(e) => handleMentionsChange(i, e.target.value)}
                      data-testid={isEdit ? `input-edit-mentions-${i}` : `input-mentions-${i}`}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="post-desc">Description</Label>
            <Textarea
              id="post-desc"
              placeholder="Write something about this post..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid={isEdit ? "textarea-edit-post-desc" : "textarea-post-desc"}
              className="min-h-[100px]"
            />
          </div>

          {/* Comments */}
          <div className="space-y-2">
            <Label htmlFor="post-comments">Comments</Label>
            <Textarea
              id="post-comments"
              placeholder="Add post comments..."
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              data-testid={isEdit ? "textarea-edit-post-comments" : "textarea-post-comments"}
              className="min-h-[80px]"
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="post-likes">Like Count</Label>
              <Input
                id="post-likes"
                type="number"
                min={0}
                value={likeCount}
                onChange={(e) => setLikeCount(parseInt(e.target.value) || 0)}
                data-testid={isEdit ? "input-edit-like-count" : "input-like-count"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-comment-count">Comment Count</Label>
              <Input
                id="post-comment-count"
                type="number"
                min={0}
                value={commentCount}
                onChange={(e) => setCommentCount(parseInt(e.target.value) || 0)}
                data-testid={isEdit ? "input-edit-comment-count" : "input-comment-count"}
              />
            </div>
          </div>

          {/* Mark as Deleted (only for Edit mode) */}
          {isEdit && (
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
          )}

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid={isEdit ? "button-cancel-edit-post" : "button-cancel-post"}
            >
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              data-testid={isEdit ? "button-submit-edit-post" : "button-submit-post"}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isEdit ? "Saving..." : "Creating..."}
                </>
              ) : isEdit ? (
                "Save Changes"
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Create Post
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
