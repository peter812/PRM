import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Database,
  Download,
  Trash2,
  Edit2,
  RotateCcw,
  Upload,
  Plus,
  Search,
  CheckCircle2,
  TriangleAlert,
  Loader2,
  FileCode,
  HardDrive,
  Clock,
  X,
} from "lucide-react";

interface BackupItem {
  filename: string;
  size: number;
  createdAt: string;
  modifiedAt: string;
}

interface TaskStatus {
  id: string;
  type: string;
  status: string;
  progress: number;
  progressMessage: string | null;
  result: string | null;
}

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function BackupsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [customBackupName, setCustomBackupName] = useState("");
  const [includeHistory, setIncludeHistory] = useState(false);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [selectedBackupForRename, setSelectedBackupForRename] = useState<BackupItem | null>(null);
  const [newBackupName, setNewBackupName] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedBackupForDelete, setSelectedBackupForDelete] = useState<BackupItem | null>(null);

  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupItem | null>(null);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskType, setActiveTaskType] = useState<"export" | "restore" | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [taskCompletedMessage, setTaskCompletedMessage] = useState<string | null>(null);
  const [taskErrorMessage, setTaskErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch past backups
  const {
    data: backups = [],
    isLoading,
    isRefetching,
  } = useQuery<BackupItem[]>({
    queryKey: ["/api/backups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/backups");
      return res.json();
    },
  });

  // Task poller for active backup export/restore tasks
  useEffect(() => {
    if (!activeTaskId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${activeTaskId}`);
        if (!res.ok) return;
        const task: TaskStatus = await res.json();
        setTaskStatus(task);

        if (task.status === "completed") {
          clearInterval(interval);
          setActiveTaskId(null);
          queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
          queryClient.invalidateQueries({ queryKey: ["/api/people"] });
          queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
          queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });

          if (activeTaskType === "export") {
            const filename = task.result ? task.result.replace(/^(backups|exports)\//, "") : "Backup";
            setTaskCompletedMessage(`Backup "${filename}" created successfully and saved to the backups directory.`);
            toast({ title: "Backup Created", description: `Backup "${filename}" is ready.` });
          } else {
            let details = "";
            try {
              const resObj = JSON.parse(task.result || "{}");
              if (resObj.imported) {
                const total = Object.values(resObj.imported as Record<string, number>).reduce((a, b) => a + b, 0);
                details = ` (${total} records imported/updated)`;
              }
            } catch {}
            setTaskCompletedMessage(`Data restore completed successfully${details}.`);
            toast({ title: "Restore Completed", description: "CRM data was successfully restored." });
          }
        } else if (task.status === "failed" || task.status === "cancelled") {
          clearInterval(interval);
          setActiveTaskId(null);
          const err = task.result || "The task failed unexpectedly. Please check server logs.";
          setTaskErrorMessage(err);
          toast({
            title: activeTaskType === "export" ? "Backup Failed" : "Restore Failed",
            description: err,
            variant: "destructive",
          });
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeTaskId, activeTaskType, queryClient, toast]);

  // Create Backup Mutation
  const createBackupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backups/create", {
        filename: customBackupName.trim() || undefined,
        includeHistory,
      });
      return res.json();
    },
    onSuccess: (task) => {
      setCreateDialogOpen(false);
      setCustomBackupName("");
      setTaskCompletedMessage(null);
      setTaskErrorMessage(null);
      setActiveTaskType("export");
      setActiveTaskId(task.id);
      toast({ title: "Backup Started", description: "Creating full XML backup..." });
    },
    onError: (err: Error) => {
      toast({ title: "Backup Failed", description: err.message, variant: "destructive" });
    },
  });

  // Upload Backup Mutation
  const uploadBackupMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/backups/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to upload backup file");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      toast({
        title: "Backup Uploaded",
        description: `Successfully uploaded "${data.filename}" (${formatBytes(data.size)}).`,
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: Error) => {
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  // Rename Backup Mutation
  const renameBackupMutation = useMutation({
    mutationFn: async ({ filename, newFilename }: { filename: string; newFilename: string }) => {
      const res = await apiRequest("PATCH", `/api/backups/${encodeURIComponent(filename)}/rename`, {
        newFilename,
      });
      return res.json();
    },
    onSuccess: () => {
      setRenameDialogOpen(false);
      setSelectedBackupForRename(null);
      setNewBackupName("");
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      toast({ title: "Backup Renamed", description: "Backup filename has been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Rename Failed", description: err.message, variant: "destructive" });
    },
  });

  // Delete Backup Mutation
  const deleteBackupMutation = useMutation({
    mutationFn: async (filename: string) => {
      const res = await apiRequest("DELETE", `/api/backups/${encodeURIComponent(filename)}`);
      return res.json();
    },
    onSuccess: () => {
      setDeleteDialogOpen(false);
      setSelectedBackupForDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      toast({ title: "Backup Deleted", description: "The backup file has been deleted." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    },
  });

  // Restore Backup Mutation
  const restoreBackupMutation = useMutation({
    mutationFn: async (filename: string) => {
      const res = await apiRequest("POST", `/api/backups/${encodeURIComponent(filename)}/restore`);
      return res.json();
    },
    onSuccess: (task) => {
      setRestoreDialogOpen(false);
      setSelectedBackupForRestore(null);
      setTaskCompletedMessage(null);
      setTaskErrorMessage(null);
      setActiveTaskType("restore");
      setActiveTaskId(task.id);
      toast({
        title: "Restore Started",
        description: "Restoring CRM data from selected backup file...",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Restore Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".xml")) {
      toast({
        title: "Invalid File Type",
        description: "Please select an XML backup file (.xml).",
        variant: "destructive",
      });
      return;
    }
    uploadBackupMutation.mutate(file);
  };

  const openRenameDialog = (item: BackupItem) => {
    setSelectedBackupForRename(item);
    setNewBackupName(item.filename.replace(/\.xml$/, ""));
    setRenameDialogOpen(true);
  };

  const openDeleteDialog = (item: BackupItem) => {
    setSelectedBackupForDelete(item);
    setDeleteDialogOpen(true);
  };

  const openRestoreDialog = (item: BackupItem) => {
    setSelectedBackupForRestore(item);
    setRestoreDialogOpen(true);
  };

  const handleDownload = (filename: string) => {
    const link = document.createElement("a");
    link.href = `/api/backups/${encodeURIComponent(filename)}/download`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredBackups = backups.filter((b) =>
    b.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container max-w-full md:max-w-4xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0 space-y-6">
      {/* Hidden file input for uploading backups */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".xml,application/xml,text/xml"
        className="hidden"
      />

      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold flex items-center gap-2">
            <Database className="h-7 w-7 text-primary" />
            Backups Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create, download, restore, rename, upload, and delete full CRM database backups stored in the application.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBackupMutation.isPending}
            className="flex items-center gap-2"
          >
            {uploadBackupMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload Backup
          </Button>

          <Button
            onClick={() => setCreateDialogOpen(true)}
            disabled={!!activeTaskId}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Backup
          </Button>
        </div>
      </div>

      {/* Active task tracker banner */}
      {activeTaskId && taskStatus && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {activeTaskType === "export" ? "Creating Backup…" : "Restoring CRM Data…"}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {taskStatus.progress}%
              </span>
            </div>
            <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${taskStatus.progress}%` }}
              />
            </div>
            {taskStatus.progressMessage && (
              <p className="text-xs text-muted-foreground">{taskStatus.progressMessage}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Task success message */}
      {taskCompletedMessage && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-primary/10 border border-primary/20 p-3 text-sm">
          <div className="flex items-center gap-2 text-primary font-medium">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>{taskCompletedMessage}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setTaskCompletedMessage(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Task error message */}
      {taskErrorMessage && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <TriangleAlert className="h-5 w-5 shrink-0" />
            <span>{taskErrorMessage}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setTaskErrorMessage(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Past backups card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
                Past Backups
              </CardTitle>
              <CardDescription>
                {backups.length === 1
                  ? "1 backup file available in backups/"
                  : `${backups.length} backup files available in backups/`}
              </CardDescription>
            </div>

            {backups.length > 0 && (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter backups…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm">Loading past backups…</p>
            </div>
          ) : backups.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground space-y-3">
              <div className="p-3 bg-secondary rounded-full">
                <FileCode className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-medium text-foreground">No backups found</p>
                <p className="text-sm mt-0.5">
                  Create a new backup or upload an existing XML backup to get started.
                </p>
              </div>
              <Button onClick={() => setCreateDialogOpen(true)} className="flex items-center gap-2 mt-2">
                <Plus className="h-4 w-4" />
                Create First Backup
              </Button>
            </div>
          ) : filteredBackups.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No backups matching &quot;{searchTerm}&quot;.
            </div>
          ) : (
            <div className="divide-y rounded-md border overflow-hidden">
              {filteredBackups.map((item) => (
                <div
                  key={item.filename}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FileCode className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium text-sm truncate" title={item.filename}>
                        {item.filename}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(item.modifiedAt)}
                      </span>
                      <span>•</span>
                      <span>{formatBytes(item.size)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(item.filename)}
                      title="Download backup"
                      className="h-8 px-2.5 text-xs flex items-center gap-1.5"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">Download</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openRenameDialog(item)}
                      title="Rename backup"
                      className="h-8 px-2.5 text-xs flex items-center gap-1.5"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">Rename</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openRestoreDialog(item)}
                      disabled={!!activeTaskId}
                      title="Restore data from backup"
                      className="h-8 px-2.5 text-xs flex items-center gap-1.5 text-amber-600 dark:text-amber-500 hover:text-amber-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">Restore</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeleteDialog(item)}
                      title="Delete backup"
                      className="h-8 px-2.5 text-xs flex items-center gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Dialogs ── */}

      {/* Create Backup Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Backup</DialogTitle>
            <DialogDescription>
              Export your CRM database (people, interactions, relationships, notes, schooling, groups, and settings) to an XML file.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="custom-backup-name">Custom Filename (optional)</Label>
              <Input
                id="custom-backup-name"
                placeholder="e.g. crm-backup-pre-update"
                value={customBackupName}
                onChange={(e) => setCustomBackupName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the default timestamped filename.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="create-include-history" className="text-sm font-medium">
                  Include Social Account History
                </Label>
                <p className="text-xs text-muted-foreground">
                  Include follower/following snapshots and profile version history
                </p>
              </div>
              <Switch
                id="create-include-history"
                checked={includeHistory}
                onCheckedChange={setIncludeHistory}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createBackupMutation.mutate()}
              disabled={createBackupMutation.isPending}
            >
              {createBackupMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Starting…
                </>
              ) : (
                "Start Backup"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Backup</DialogTitle>
            <DialogDescription>
              Enter a new name for &quot;{selectedBackupForRename?.filename}&quot;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="rename-backup-input">New Filename</Label>
            <div className="flex items-center gap-2">
              <Input
                id="rename-backup-input"
                value={newBackupName}
                onChange={(e) => setNewBackupName(e.target.value)}
                placeholder="new-backup-name"
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground font-mono">.xml</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedBackupForRename || !newBackupName.trim()) return;
                renameBackupMutation.mutate({
                  filename: selectedBackupForRename.filename,
                  newFilename: newBackupName.trim(),
                });
              }}
              disabled={renameBackupMutation.isPending || !newBackupName.trim()}
            >
              {renameBackupMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Renaming…
                </>
              ) : (
                "Save Name"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Backup File?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete &quot;{selectedBackupForDelete?.filename}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (selectedBackupForDelete) {
                  deleteBackupMutation.mutate(selectedBackupForDelete.filename);
                }
              }}
            >
              Delete Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Confirmation Alert Dialog */}
      <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
              <RotateCcw className="h-5 w-5" />
              Restore from Backup?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                You are about to restore CRM data from <strong>{selectedBackupForRestore?.filename}</strong>.
              </p>
              <p className="text-xs text-muted-foreground">
                This will import and merge records (people, relationships, interactions, notes, groups, settings) from this backup into your current database. Existing IDs will be matched and preserved.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
              onClick={() => {
                if (selectedBackupForRestore) {
                  restoreBackupMutation.mutate(selectedBackupForRestore.filename);
                }
              }}
            >
              Confirm Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
