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
import { useToast } from "@/hooks/use-toast";
import type { SocialAccount } from "@shared/schema";

interface ExportSocialAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: SocialAccount;
}

export function ExportSocialAccountDialog({
  open,
  onOpenChange,
  account,
}: ExportSocialAccountDialogProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch(
        `/api/social-accounts/export-xml?ids=${encodeURIComponent(account.id)}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to export account");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${account.username}_export.xml`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Successful",
        description: `Exported ${account.username} to XML file`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export social account",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Social Account</DialogTitle>
          <DialogDescription>
            Export {account.username} to an XML file. This will include the
            account details, followers, and following data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border p-4 space-y-2">
            <p className="text-sm font-medium" data-testid="text-export-username">
              {account.username}
            </p>
            {account.nickname && (
              <p className="text-sm text-muted-foreground" data-testid="text-export-nickname">
                {account.nickname}
              </p>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span data-testid="text-export-followers">
                {account.followers?.length || 0} followers
              </span>
              <span data-testid="text-export-following">
                {account.following?.length || 0} following
              </span>
            </div>
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
