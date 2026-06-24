import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { HardDrive, Cloud, ArrowRightLeft, Loader2, ImageIcon, TriangleAlert, Database, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type StorageModeResponse = {
  mode: string;
  hasS3Creds: boolean;
};

type ImageStats = {
  total: number;
  local: number;
  s3: number;
};

type BackfillResult = {
  inserted: number;
  skipped: number;
  total: number;
};

type DeleteInstagramResult = {
  profileVersionsCleared: number;
  postsCleared: number;
  photosDeleted: number;
};

export default function ImageStorageSettingsPage() {
  const { toast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<"to-local" | "to-s3" | "switch-to-local" | "switch-to-s3" | "backfill" | "delete-instagram" | "delete-orphans" | null>(null);

  const { data: storageData, isLoading: modeLoading } = useQuery<StorageModeResponse>({
    queryKey: ["/api/image-storage/mode"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ImageStats>({
    queryKey: ["/api/image-storage/stats"],
  });

  const setModeMutation = useMutation({
    mutationFn: async (mode: string) => {
      const res = await apiRequest("PUT", "/api/image-storage/mode", { mode });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/mode"] });
      toast({ title: "Storage mode updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update storage mode", description: error.message, variant: "destructive" });
    },
  });

  const transferToLocalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/transfer-to-local");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Transfer started", description: "A background task has been created to move S3 images to local storage. Check the Tasks page for progress." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start transfer", description: error.message, variant: "destructive" });
    },
  });

  const transferToS3Mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/transfer-to-s3");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Transfer started", description: "A background task has been created to move local images to S3 storage. Check the Tasks page for progress." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start transfer", description: error.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/photos/backfill");
      return res.json() as Promise<BackfillResult>;
    },
    onSuccess: (data) => {
      toast({
        title: "Photos registered",
        description: `${data.inserted} new photo${data.inserted !== 1 ? "s" : ""} added to the database. ${data.skipped} already registered.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Backfill failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteInstagramMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/delete-instagram-urls");
      return res.json() as Promise<DeleteInstagramResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      toast({
        title: "Instagram URLs removed",
        description: `${data.profileVersionsCleared} profile image${data.profileVersionsCleared !== 1 ? "s" : ""}, ${data.postsCleared} post${data.postsCleared !== 1 ? "s" : ""}, ${data.photosDeleted} photo record${data.photosDeleted !== 1 ? "s" : ""} cleared.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteOrphansMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/photos/orphans");
      return res.json() as Promise<{ deleted: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      toast({
        title: "Orphan images deleted",
        description: `${data.deleted} orphan photo record${data.deleted !== 1 ? "s" : ""} removed from the database${data.deleted > 0 ? " and their files deleted" : ""}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const handleModeChange = (newMode: string) => {
    const currentMode = storageData?.mode;
    if (newMode === currentMode) return;

    if (newMode === "local" && stats && stats.s3 > 0) {
      setConfirmDialog("switch-to-local");
    } else if (newMode === "s3" && stats && stats.local > 0) {
      setConfirmDialog("switch-to-s3");
    } else {
      setModeMutation.mutate(newMode);
    }
  };

  const handleConfirmSwitch = (transferImages: boolean) => {
    if (confirmDialog === "switch-to-local") {
      setModeMutation.mutate("local");
      if (transferImages) {
        transferToLocalMutation.mutate();
      }
    } else if (confirmDialog === "switch-to-s3") {
      setModeMutation.mutate("s3");
      if (transferImages) {
        transferToS3Mutation.mutate();
      }
    }
    setConfirmDialog(null);
  };

  if (modeLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-image-storage">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentMode = storageData?.mode || "s3";
  const hasS3Creds = storageData?.hasS3Creds || false;

  return (
    <div className="container max-w-full md:max-w-3xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-image-storage-title">Image Storage</h1>
        <p className="text-muted-foreground">
          Configure where uploaded images are stored and transfer images between storage types.
        </p>
      </div>

      <div className="space-y-6">
        <Card data-testid="card-storage-mode">
          <CardHeader>
            <CardTitle className="text-lg">Storage Mode</CardTitle>
            <CardDescription>Choose where new image uploads will be stored.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <Select value={currentMode} onValueChange={handleModeChange} disabled={setModeMutation.isPending}>
                <SelectTrigger className="w-[200px]" data-testid="select-storage-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="s3" data-testid="option-s3">
                    <span className="flex items-center gap-2">
                      <Cloud className="h-4 w-4" />
                      S3 Storage
                    </span>
                  </SelectItem>
                  <SelectItem value="local" data-testid="option-local">
                    <span className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4" />
                      Local Storage
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {setModeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={hasS3Creds ? "outline" : "destructive"} data-testid="badge-s3-status">
                <Cloud className="h-3 w-3 mr-1" />
                S3 Credentials: {hasS3Creds ? "Configured" : "Not Set"}
              </Badge>
              <Badge variant="outline" data-testid="badge-current-mode">
                {currentMode === "s3" ? <Cloud className="h-3 w-3 mr-1" /> : <HardDrive className="h-3 w-3 mr-1" />}
                Active: {currentMode === "s3" ? "S3" : "Local"}
              </Badge>
            </div>

            {!hasS3Creds && currentMode === "s3" && (
              <p className="text-sm text-destructive">
                S3 credentials are not configured. Uploads will fail until S3 environment variables are set, or switch to local storage.
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-image-stats">
          <CardHeader>
            <CardTitle className="text-lg">Image Statistics</CardTitle>
            <CardDescription>Overview of where your images are currently stored.</CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : stats ? (
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm" data-testid="text-total-images">Total: {stats.total}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Cloud className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm" data-testid="text-s3-images">S3: {stats.s3}</span>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm" data-testid="text-local-images">Local: {stats.local}</span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="card-transfer-images">
          <CardHeader>
            <CardTitle className="text-lg">Transfer Images</CardTitle>
            <CardDescription>Move existing images between storage types. Transfers run as background tasks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4">
              <div className="space-y-3">
                <h3 className="text-sm font-medium" data-testid="text-transfer-to-local-label">Send S3 Images to Local Storage</h3>
                <p className="text-xs text-muted-foreground">
                  Downloads all S3-stored images and saves them locally. Updates all database references. Deletes S3 copies after transfer.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setConfirmDialog("to-local")}
                  disabled={transferToLocalMutation.isPending || (stats?.s3 === 0)}
                  data-testid="button-transfer-to-local"
                >
                  {transferToLocalMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4 mr-2" />
                  )}
                  Transfer S3 to Local {stats && stats.s3 > 0 && `(${stats.s3} images)`}
                </Button>
              </div>

              <div className="border-t pt-4 space-y-3">
                <h3 className="text-sm font-medium" data-testid="text-transfer-to-s3-label">Send Local Images to S3 Storage</h3>
                <p className="text-xs text-muted-foreground">
                  Uploads all locally stored images to S3. Updates all database references. Deletes local copies after transfer.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setConfirmDialog("to-s3")}
                  disabled={transferToS3Mutation.isPending || (stats?.local === 0) || !hasS3Creds}
                  data-testid="button-transfer-to-s3"
                >
                  {transferToS3Mutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4 mr-2" />
                  )}
                  Transfer Local to S3 {stats && stats.local > 0 && `(${stats.local} images)`}
                </Button>
                {!hasS3Creds && (
                  <p className="text-xs text-destructive">S3 credentials required to transfer images to S3.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-add-photos-to-db">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" />
              Add Photos to DB
            </CardTitle>
            <CardDescription>Register existing image URLs in the photos table.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3" data-testid="notice-backfill-danger">
              <TriangleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Danger — do at your own risk</p>
                <p className="text-xs text-muted-foreground">
                  This scans every image URL in the database and registers it in the photos table. It is safe to run multiple times (duplicates are skipped), but may be slow on large datasets. New uploads are registered automatically going forward.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog("backfill")}
              disabled={backfillMutation.isPending}
              data-testid="button-add-photos-to-db"
            >
              {backfillMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              Scan and Register Photos
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-delete-instagram-urls">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Instagram &amp; Facebook CDN Image URLs
            </CardTitle>
            <CardDescription>
              This will remove all cdninstagram.com and fbcdn.net URLs from images. These are temporary URLs (72hr) added when we do imports from Instagram — these should not be stored permanently.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3" data-testid="notice-instagram-danger">
              <TriangleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Danger — this is destructive and cannot be undone</p>
                <p className="text-xs text-muted-foreground">
                  Removes all image URLs from social media posts and social profile photos, and removes all photo DB table entries that have cdninstagram.com or fbcdn.net as their image URL.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog("delete-instagram")}
              disabled={deleteInstagramMutation.isPending}
              data-testid="button-delete-instagram-urls"
            >
              {deleteInstagramMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete CDN Image URLs
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-delete-orphan-images">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete Orphan Images
            </CardTitle>
            <CardDescription>
              Remove photo records from the database that are no longer linked to any person, note, interaction, group, or social profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3" data-testid="notice-orphan-danger">
              <TriangleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Danger — this is destructive and cannot be undone</p>
                <p className="text-xs text-muted-foreground">
                  Scans every row in the photos table and deletes any whose image URL does not appear in any people, note, interaction, group, or social profile record. The physical files (local or S3) are also deleted.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog("delete-orphans")}
              disabled={deleteOrphansMutation.isPending}
              data-testid="button-delete-orphan-images"
            >
              {deleteOrphansMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete Orphan Images
            </Button>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmDialog === "to-local"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer S3 Images to Local?</AlertDialogTitle>
            <AlertDialogDescription>
              This will download {stats?.s3 || 0} images from S3 and store them locally. The S3 copies will be deleted after successful transfer. A background task will handle this process.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-transfer">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { transferToLocalMutation.mutate(); setConfirmDialog(null); }} data-testid="button-confirm-transfer-to-local">
              Start Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDialog === "to-s3"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer Local Images to S3?</AlertDialogTitle>
            <AlertDialogDescription>
              This will upload {stats?.local || 0} local images to S3 storage. The local copies will be deleted after successful transfer. A background task will handle this process.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-transfer-s3">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { transferToS3Mutation.mutate(); setConfirmDialog(null); }} data-testid="button-confirm-transfer-to-s3">
              Start Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDialog === "switch-to-local"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Local Storage?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {stats?.s3 || 0} images stored in S3. Would you like to transfer them to local storage? New uploads will use local storage regardless.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 flex-wrap">
            <AlertDialogCancel data-testid="button-cancel-switch">Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => handleConfirmSwitch(false)} data-testid="button-switch-no-transfer">
              Switch Without Transfer
            </Button>
            <AlertDialogAction onClick={() => handleConfirmSwitch(true)} data-testid="button-switch-and-transfer-local">
              Switch and Transfer Images
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDialog === "switch-to-s3"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to S3 Storage?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {stats?.local || 0} images stored locally. Would you like to transfer them to S3? New uploads will use S3 storage regardless.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 flex-wrap">
            <AlertDialogCancel data-testid="button-cancel-switch-s3">Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => handleConfirmSwitch(false)} data-testid="button-switch-s3-no-transfer">
              Switch Without Transfer
            </Button>
            <AlertDialogAction onClick={() => handleConfirmSwitch(true)} data-testid="button-switch-and-transfer-s3">
              Switch and Transfer Images
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDialog === "backfill"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Scan and Register Photos?</AlertDialogTitle>
            <AlertDialogDescription>
              This will scan all image URLs in the database and create a row in the photos table for each one that is not already registered. Already-registered photos are skipped. This process may be slow on large datasets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-backfill">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { backfillMutation.mutate(); setConfirmDialog(null); }}
              data-testid="button-confirm-backfill"
            >
              Register Photos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDialog === "delete-instagram"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete CDN Image URLs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all cdninstagram.com and fbcdn.net URLs from social profile versions and post content, and delete matching rows from the photos table. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-instagram">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { deleteInstagramMutation.mutate(); setConfirmDialog(null); }}
              data-testid="button-confirm-delete-instagram"
            >
              Delete CDN URLs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDialog === "delete-orphans"} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Orphan Images?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all photo records whose image URL is not referenced by any person, note, interaction, group, or social profile. Their physical files will also be deleted from storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-orphans">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { deleteOrphansMutation.mutate(); setConfirmDialog(null); }}
              data-testid="button-confirm-delete-orphans"
            >
              Delete Orphans
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
