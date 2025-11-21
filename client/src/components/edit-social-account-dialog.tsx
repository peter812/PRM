import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import type { SocialAccount } from "@shared/schema";

interface EditSocialAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: SocialAccount;
}

export function EditSocialAccountDialog({
  open,
  onOpenChange,
  account,
}: EditSocialAccountDialogProps) {
  const { toast } = useToast();
  const [username, setUsername] = useState(account.username);
  const [accountUrl, setAccountUrl] = useState(account.accountUrl);
  const [imageUrl, setImageUrl] = useState(account.imageUrl || "");

  const updateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", `/api/social-accounts/${account.id}`, {
        username,
        accountUrl,
        imageUrl: imageUrl || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", account.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({
        title: "Success",
        description: "Social account updated successfully",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update social account",
        variant: "destructive",
      });
    },
  });

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      // Reset form when opening
      setUsername(account.username);
      setAccountUrl(account.accountUrl);
      setImageUrl(account.imageUrl || "");
    }
    onOpenChange(newOpen);
  };

  const isValid = username.trim() && accountUrl.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="dialog-edit-social-account">
        <DialogHeader>
          <DialogTitle>Edit Social Account</DialogTitle>
          <DialogDescription>
            Update the details of this social account
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="username" className="text-sm font-medium">
              Username <span className="text-destructive">*</span>
            </Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              data-testid="input-username"
              required
            />
          </div>

          <div>
            <Label htmlFor="accountUrl" className="text-sm font-medium">
              Account URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="accountUrl"
              value={accountUrl}
              onChange={(e) => setAccountUrl(e.target.value)}
              placeholder="https://..."
              data-testid="input-account-url"
              required
            />
          </div>

          <div>
            <Label htmlFor="imageUrl" className="text-sm font-medium">
              Image URL <span className="text-muted-foreground text-xs ml-1">(Optional)</span>
            </Label>
            <Input
              id="imageUrl"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://... (optional)"
              data-testid="input-image-url"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            data-testid="button-cancel-edit"
            disabled={updateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={!isValid || updateMutation.isPending}
            data-testid="button-save-edit"
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
