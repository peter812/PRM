import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { SocialAccountWithCurrentProfile } from "@shared/schema";

interface ExportSocialAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: SocialAccountWithCurrentProfile;
  massExport?: boolean;
}

export function ExportSocialAccountDialog({
  open,
  onOpenChange,
  account,
  massExport,
}: ExportSocialAccountDialogProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (account && !massExport) {
        params.set("ids", account.id);
      }
      if (includeHistory) {
        params.set("includeHistory", "true");
      }

      const queryString = params.toString();
      const response = await fetch(
        `/api/social-accounts/export-xml${queryString ? `?${queryString}` : ""}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to export");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = massExport
        ? `social_accounts_export_all.xml`
        : `${account?.username || "social_account"}_export.xml`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Successful",
        description: massExport
          ? "Exported all social accounts to XML file"
          : `Exported ${account?.username} to XML file`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export social account data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const title = massExport ? "Export All Social Accounts" : "Export Social Account";
  const description = massExport
    ? "Export all social accounts to an XML file. This will include account details, followers, and following data."
    : `Export ${account?.username || ""} to an XML file. This will include the account details, followers, and following data.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {account && !massExport && (
            <div className="rounded-md border p-4 space-y-2">
              <p className="text-sm font-medium" data-testid="text-export-username">
                {account.username}
              </p>
              {account.currentProfile?.nickname && (
                <p className="text-sm text-muted-foreground" data-testid="text-export-nickname">
                  {account.currentProfile?.nickname}
                </p>
              )}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span data-testid="text-export-followers">
                  {account.latestState?.followerCount || 0} followers
                </span>
                <span data-testid="text-export-following">
                  {account.latestState?.followingCount || 0} following
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="include-history-toggle" className="text-sm font-medium">
                Include History
              </Label>
              <p className="text-xs text-muted-foreground">
                Include profile version history and network change data in the export
              </p>
            </div>
            <Switch
              id="include-history-toggle"
              checked={includeHistory}
              onCheckedChange={setIncludeHistory}
              data-testid="switch-include-history"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-export"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              disabled={isExporting}
              data-testid="button-confirm-export"
              className="gap-2"
            >
              {isExporting ? (
                <>
                  <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export XML
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
