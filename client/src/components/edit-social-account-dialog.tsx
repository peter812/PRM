import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import type { SocialAccount, SocialAccountType } from "@shared/schema";

function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color) || /^#[0-9A-Fa-f]{3}$/.test(color);
}

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
  const [typeId, setTypeId] = useState(account.typeId || "");

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", `/api/social-accounts/${account.id}`, {
        username,
        accountUrl,
        imageUrl: imageUrl || null,
        typeId: typeId && typeId !== "none" ? typeId : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", account.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
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
      setUsername(account.username);
      setAccountUrl(account.accountUrl);
      setImageUrl(account.imageUrl || "");
      setTypeId(account.typeId || "");
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
            <Label htmlFor="type" className="text-sm font-medium">
              Account Type
            </Label>
            <Select value={typeId || "none"} onValueChange={setTypeId}>
              <SelectTrigger data-testid="select-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Type</SelectItem>
                {socialAccountTypes?.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    <span className="flex items-center gap-2">
                      {isValidHexColor(type.color) && (
                        <span 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: type.color }}
                        />
                      )}
                      {type.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
