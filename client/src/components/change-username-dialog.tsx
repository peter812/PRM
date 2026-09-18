import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, AtSign } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SocialAccountWithCurrentProfile, SocialAccountType } from "@shared/schema";

interface ChangeUsernameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: SocialAccountWithCurrentProfile;
  accountType?: SocialAccountType | null;
}

export function computeDerivedUrl(
  existingUrl: string | null | undefined,
  oldUsername: string,
  newUsername: string,
  platformName?: string | null,
): string {
  const cleanNew = newUsername.trim().replace(/^@/, "");
  if (!cleanNew) return existingUrl || "";

  if (existingUrl && oldUsername) {
    const cleanOld = oldUsername.trim().replace(/^@/, "");
    if (cleanOld) {
      const escaped = cleanOld.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const regex = new RegExp(`(/)${escaped}(/?|\\?|#|$)`, "i");
      if (regex.test(existingUrl)) {
        return existingUrl.replace(regex, `$1${cleanNew}$2`);
      }
    }
  }

  const platform = platformName?.toLowerCase();
  if (platform === "instagram") {
    return `https://instagram.com/${cleanNew}`;
  }
  if (platform === "x.com" || platform === "twitter") {
    return `https://x.com/${cleanNew}`;
  }
  if (platform === "facebook") {
    return `https://facebook.com/${cleanNew}`;
  }
  if (platform === "linkedin") {
    return `https://linkedin.com/in/${cleanNew}`;
  }
  if (existingUrl) {
    return existingUrl;
  }
  return `https://instagram.com/${cleanNew}`;
}

export function ChangeUsernameDialog({
  open,
  onOpenChange,
  account,
  accountType,
}: ChangeUsernameDialogProps) {
  const { toast } = useToast();
  const currentDisplayName = account.currentProfile?.nickname || account.nickname || "";
  const currentUrl = account.currentProfile?.accountUrl || account.accountUrl || "";

  const [username, setUsername] = useState(account.username || "");
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [accountUrl, setAccountUrl] = useState(currentUrl);
  const [isUrlCustomized, setIsUrlCustomized] = useState(false);

  useEffect(() => {
    if (open) {
      const initDisplayName = account.currentProfile?.nickname || account.nickname || "";
      const initUrl = account.currentProfile?.accountUrl || account.accountUrl || computeDerivedUrl("", "", account.username, accountType?.name);
      setUsername(account.username || "");
      setDisplayName(initDisplayName);
      setAccountUrl(initUrl);
      setIsUrlCustomized(false);
    }
  }, [open, account, accountType]);

  const handleUsernameChange = (newVal: string) => {
    const clean = newVal.replace(/\s+/g, "");
    setUsername(clean);
    if (!isUrlCustomized) {
      setAccountUrl(computeDerivedUrl(currentUrl, account.username, clean, accountType?.name));
    }
  };

  const handleUrlChange = (newUrl: string) => {
    setAccountUrl(newUrl);
    setIsUrlCustomized(true);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const cleanUsername = username.trim().replace(/^@/, "");
      return await apiRequest("PATCH", `/api/social-accounts/${account.id}`, {
        username: cleanUsername,
        nickname: displayName.trim() || null,
        accountUrl: accountUrl.trim() || null,
      });
    },
    onSuccess: () => {
      // Prefix match covers the profile and its history; the list lives under its own key.
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"] });
      toast({
        title: "Username Updated",
        description: `Successfully updated to @${username.trim().replace(/^@/, "")}. Change recorded in history.`,
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Update Failed",
        description: err.message || "Failed to update username",
        variant: "destructive",
      });
    },
  });

  const cleanUsername = username.trim().replace(/^@/, "");
  const hasChanges =
    cleanUsername !== account.username ||
    displayName.trim() !== currentDisplayName.trim() ||
    accountUrl.trim() !== currentUrl.trim();

  const isValid = cleanUsername.length > 0 && hasChanges;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" data-testid="dialog-change-username">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AtSign className="h-5 w-5" />
            Change Username
          </DialogTitle>
          <DialogDescription>
            Update the username, display name, and URL for this account. Any changes will be recorded in the account history.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isValid && !mutation.isPending) {
              mutation.mutate();
            }
          }}
          className="space-y-4 py-2"
        >
          {/* Username Field */}
          <div className="space-y-2">
            <Label htmlFor="input-change-username">Username</Label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-muted-foreground text-sm font-mono select-none">@</span>
              <Input
                id="input-change-username"
                value={username.replace(/^@/, "")}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="username"
                className="pl-7"
                data-testid="input-change-username"
                autoFocus
              />
            </div>
          </div>

          {/* Display Name Field */}
          <div className="space-y-2">
            <Label htmlFor="input-change-display-name">Display Name</Label>
            <Input
              id="input-change-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. John Doe"
              data-testid="input-change-display-name"
            />
          </div>

          {/* Account URL Field */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="input-change-account-url">Account URL</Label>
              {isUrlCustomized && (
                <button
                  type="button"
                  onClick={() => {
                    setIsUrlCustomized(false);
                    setAccountUrl(computeDerivedUrl(currentUrl, account.username, username, accountType?.name));
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Reset to derived
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <Input
                id="input-change-account-url"
                value={accountUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://instagram.com/username"
                data-testid="input-change-account-url"
                className="text-sm font-mono"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {isUrlCustomized ? "Custom URL set manually." : "Automatically derived from username and platform."}
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
              data-testid="button-cancel-change-username"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || mutation.isPending}
              data-testid="button-submit-change-username"
              className="gap-1.5"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
