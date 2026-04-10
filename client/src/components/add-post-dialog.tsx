import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Loader2, X, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AddPostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  socialAccountId: string;
}

export function AddPostDialog({ open, onOpenChange, socialAccountId }: AddPostDialogProps) {
  const { toast } = useToast();
  const [imageUrls, setImageUrls] = useState<string[]>([""]);
  const [description, setDescription] = useState("");
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [mentionedAccounts, setMentionedAccounts] = useState("");

  const createPostMutation = useMutation({
    mutationFn: async () => {
      const filteredUrls = imageUrls.filter(url => url.trim() !== "");
      return await apiRequest("POST", `/api/social-accounts/${socialAccountId}/posts`, {
        content: filteredUrls.length > 0 ? JSON.stringify(filteredUrls) : null,
        description: description || null,
        likeCount,
        commentCount,
        mentionedAccounts: mentionedAccounts.trim() ? mentionedAccounts : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", socialAccountId, "posts"] });
      toast({
        title: "Success",
        description: "Post created successfully",
      });
      resetForm();
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create post",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setImageUrls([""]);
    setDescription("");
    setLikeCount(0);
    setCommentCount(0);
    setMentionedAccounts("");
  };

  const addImageUrl = () => {
    setImageUrls([...imageUrls, ""]);
  };

  const removeImageUrl = (index: number) => {
    setImageUrls(imageUrls.filter((_, i) => i !== index));
  };

  const updateImageUrl = (index: number, value: string) => {
    const updated = [...imageUrls];
    updated[index] = value;
    setImageUrls(updated);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      onOpenChange(o);
      if (!o) resetForm();
    }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            Add Post
          </DialogTitle>
          <DialogDescription>
            Add a new post to this social account
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Image URLs */}
          <div className="space-y-2">
            <Label>Image URLs</Label>
            {imageUrls.map((url, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="https://cdn.example.com/image.jpg"
                  value={url}
                  onChange={(e) => updateImageUrl(index, e.target.value)}
                  data-testid={`input-image-url-${index}`}
                />
                {imageUrls.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeImageUrl(index)}
                    data-testid={`button-remove-image-${index}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addImageUrl} data-testid="button-add-image-url">
              <Plus className="h-4 w-4" />
              Add Image
            </Button>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="post-description">Description</Label>
            <Textarea
              id="post-description"
              placeholder="Post description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20"
              data-testid="textarea-post-description"
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
                data-testid="input-like-count"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-comments">Comment Count</Label>
              <Input
                id="post-comments"
                type="number"
                min={0}
                value={commentCount}
                onChange={(e) => setCommentCount(parseInt(e.target.value) || 0)}
                data-testid="input-comment-count"
              />
            </div>
          </div>

          {/* Mentioned Accounts */}
          <div className="space-y-2">
            <Label htmlFor="post-mentions">Mentioned Accounts</Label>
            <Input
              id="post-mentions"
              placeholder="Comma-separated account names..."
              value={mentionedAccounts}
              onChange={(e) => setMentionedAccounts(e.target.value)}
              data-testid="input-mentioned-accounts"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of mentioned account usernames
            </p>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-post">
              Cancel
            </Button>
            <Button
              onClick={() => createPostMutation.mutate()}
              disabled={createPostMutation.isPending}
              data-testid="button-submit-post"
            >
              {createPostMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating...
                </>
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
