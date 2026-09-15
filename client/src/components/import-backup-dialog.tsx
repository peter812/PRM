import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Upload, FileArchive, X, Phone } from "lucide-react";
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

/** Which backup is being imported, and who owns every conversation in it */
export type ImportBackupSource =
  | { kind: "instagram"; rootSocialAccountId: string; rootUsername: string }
  | { kind: "sms"; rootPersonId: string; personName: string };

export interface ImportFilters {
  skipAutomated: boolean;
  skipNoise: boolean;
}

interface ImportBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: ImportBackupSource;
  /** When the caller renders the filter switches itself, pass them here and the dialog won't show its own. */
  filters?: ImportFilters;
}

/** The two "skip" switches, shared by the dialog and the settings page */
export function ImportFilterSwitches({ value, onChange }: { value: ImportFilters; onChange: (next: ImportFilters) => void }) {
  return (
    <>
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label htmlFor="backup-skip-automated" className="font-medium">
            Skip automated messages
          </Label>
          <p className="text-xs text-muted-foreground">
            Verification codes, shipping updates, receipts, and promos
          </p>
        </div>
        <Switch
          id="backup-skip-automated"
          checked={value.skipAutomated}
          onCheckedChange={(skipAutomated) => onChange({ ...value, skipAutomated })}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label htmlFor="backup-skip-noise" className="font-medium">
            Skip system messages
          </Label>
          <p className="text-xs text-muted-foreground">
            Omit "Liked a message" and similar echoes
          </p>
        </div>
        <Switch
          id="backup-skip-noise"
          checked={value.skipNoise}
          onCheckedChange={(skipNoise) => onChange({ ...value, skipNoise })}
        />
      </div>
    </>
  );
}

export function ImportBackupDialog({ open, onOpenChange, source, filters: externalFilters }: ImportBackupDialogProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const isInstagram = source.kind === "instagram";

  const [file, setFile] = useState<File | null>(null);
  const [ownFilters, setOwnFilters] = useState<ImportFilters>({ skipAutomated: true, skipNoise: true });
  const { skipAutomated, skipNoise } = externalFilters ?? ownFilters;
  const [importMedia, setImportMedia] = useState(true);

  // Warn if the uploaded zip's username doesn't match this account
  const zipMatch = file && isInstagram ? /^instagram-(.+)-\d{4}-\d{2}-\d{2}-[^-]+\.zip$/i.exec(file.name) : null;
  const zipUsername = zipMatch?.[1] ?? null;
  const usernameMismatch =
    isInstagram && zipUsername != null && zipUsername.toLowerCase() !== source.rootUsername.toLowerCase();

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("skipNoise", String(skipNoise));
      formData.append("skipAutomated", String(skipAutomated));
      if (source.kind === "instagram") {
        formData.append("zip", file);
        formData.append("rootSocialAccountId", source.rootSocialAccountId);
        formData.append("importMedia", String(importMedia));
      } else {
        formData.append("xml", file);
        formData.append("rootPersonId", source.rootPersonId);
      }

      const res = await fetch(isInstagram ? "/api/tasks/import-instagram-backup" : "/api/tasks/import-sms", {
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
        description: "All threads are importing in the background.",
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
            {isInstagram ? <SiInstagram className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
            {isInstagram ? "Import Instagram Backup" : "Import SMS Backup"}
          </DialogTitle>
          <DialogDescription>
            {source.kind === "instagram" ? (
              <>
                Upload the full Meta data export zip for{" "}
                <span className="font-medium text-foreground">@{source.rootUsername}</span> (named{" "}
                <code className="text-xs">instagram-{source.rootUsername}-YYYY-MM-DD-…</code>). Every DM
                thread in the export is imported, with this account as the owner of each conversation.
              </>
            ) : (
              <>
                Upload an <span className="font-medium text-foreground">SMS Backup &amp; Restore</span> XML
                export from <span className="font-medium text-foreground">{source.personName}</span>'s phone.
                Every text thread is imported; numbers that match a person's phone are linked to them.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* File picker */}
          <div className="grid gap-2">
            <Label htmlFor="backup-file-input">{isInstagram ? "Export zip" : "Backup XML"}</Label>
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
                htmlFor="backup-file-input"
                className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 cursor-pointer hover:bg-muted/30 transition-colors text-muted-foreground"
              >
                <Upload className="h-6 w-6" />
                <span className="text-sm">
                  {isInstagram ? "Click to choose the export .zip" : "Click to choose the backup .xml"}
                </span>
              </label>
            )}
            <input
              id="backup-file-input"
              type="file"
              accept={isInstagram ? ".zip,application/zip,application/x-zip-compressed" : ".xml,text/xml,application/xml"}
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {usernameMismatch && source.kind === "instagram" && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This zip looks like it belongs to <strong>@{zipUsername}</strong>, not @
                {source.rootUsername}. It will still import as @{source.rootUsername}'s conversations —
                make sure that's what you want.
              </p>
            )}
          </div>

          {/* Options */}
          {!externalFilters && <ImportFilterSwitches value={ownFilters} onChange={setOwnFilters} />}

          {isInstagram && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="backup-import-media" className="font-medium">
                  Import media
                </Label>
                <p className="text-xs text-muted-foreground">Photos, videos, and voice messages</p>
              </div>
              <Switch id="backup-import-media" checked={importMedia} onCheckedChange={setImportMedia} />
            </div>
          )}
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
