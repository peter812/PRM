import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Upload, FileArchive, X } from "lucide-react";
import { SiInstagram } from "react-icons/si";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface ImportInstagramBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account whose backup this is — owns every imported conversation */
  rootSocialAccountId: string;
  /** Account username, shown for confirmation and matched against the zip name */
  rootUsername: string;
}

export function ImportInstagramBackupDialog({
  open,
  onOpenChange,
  rootSocialAccountId,
  rootUsername,
}: ImportInstagramBackupDialogProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [file, setFile] = useState<File | null>(null);
  const [skipNoise, setSkipNoise] = useState(true);
  const [importMedia, setImportMedia] = useState(true);

  // Warn if the uploaded zip's username doesn't match this account
  const zipMatch = file ? /^instagram-(.+)-\d{4}-\d{2}-\d{2}-[^-]+\.zip$/i.exec(file.name) : null;
  const zipUsername = zipMatch?.[1] ?? null;
  const usernameMismatch =
    zipUsername != null && zipUsername.toLowerCase() !== rootUsername.toLowerCase();

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("zip", file);
      formData.append("rootSocialAccountId", rootSocialAccountId);
      formData.append("skipNoise", String(skipNoise));
      formData.append("importMedia", String(importMedia));

      const res = await fetch("/api/tasks/import-instagram-backup", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to start import");
      }
      return await res.json();
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/paginated"] });
      toast({
        title: "Backup import started",
        description: "All DM threads are importing in the background.",
      });
      onOpenChange(false);
      setFile(null);
      navigate(`/settings/task/${task.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Import failed to start",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SiInstagram className="h-5 w-5" />
            Import Instagram Backup
          </DialogTitle>
          <DialogDescription>
            Upload the full Meta data export zip for{" "}
            <span className="font-medium text-foreground">@{rootUsername}</span> (named{" "}
            <code className="text-xs">instagram-{rootUsername}-YYYY-MM-DD-…</code>). Every DM thread
            in the export is imported, with this account as the owner of each conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* File picker */}
          <div className="grid gap-2">
            <Label htmlFor="backup-zip-input">Export zip</Label>
            {file ? (
              <div className="flex items-center gap-2 rounded-md border p-3 bg-muted/30">
                <FileArchive className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm truncate flex-1">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB
                </span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label
                htmlFor="backup-zip-input"
                className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 cursor-pointer hover:bg-muted/30 transition-colors text-muted-foreground"
              >
                <Upload className="h-6 w-6" />
                <span className="text-sm">Click to choose the export .zip</span>
              </label>
            )}
            <input
              id="backup-zip-input"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {usernameMismatch && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This zip looks like it belongs to <strong>@{zipUsername}</strong>, not @
                {rootUsername}. It will still import as @{rootUsername}'s conversations — make sure
                that's what you want.
              </p>
            )}
          </div>

          {/* Options */}
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="backup-skip-noise" className="font-medium">
                Skip system messages
              </Label>
              <p className="text-xs text-muted-foreground">
                Omit "Liked a message" and similar echoes
              </p>
            </div>
            <Switch id="backup-skip-noise" checked={skipNoise} onCheckedChange={setSkipNoise} />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="backup-import-media" className="font-medium">
                Import media
              </Label>
              <p className="text-xs text-muted-foreground">Photos, videos, and voice messages</p>
            </div>
            <Switch id="backup-import-media" checked={importMedia} onCheckedChange={setImportMedia} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => importMutation.mutate()}
            disabled={!file || importMutation.isPending}
          >
            {importMutation.isPending ? "Uploading..." : "Start Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
