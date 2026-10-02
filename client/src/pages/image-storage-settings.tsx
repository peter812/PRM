import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Server, Loader2, ImageIcon, Images, TriangleAlert, Database, Trash2, Wrench, CheckCircle2, XCircle, Sparkles, Video, Files } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { formatBytes } from "@/lib/utils";

type ImageStats = {
  images: number; // one per picture, however many sizes are baked
  videos: number;
  variants: number;
  total: number; // every file in PRM-S3: objects + variants
  objectBytes: number;
  variantBytes: number;
};

type PrmS3DeliveryMode = "direct" | "proxy";

type PrmS3ConfigResponse = {
  endpoint: string;
  publicEndpoint: string;
  deliveryMode: PrmS3DeliveryMode;
  bucket: string;
  region: string;
  hasAccessKey: boolean;
  hasSecretKey: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

type BackfillResult = {
  inserted: number;
  skipped: number;
  total: number;
};

type DeleteInstagramResult = {
  profileImagesCleared: number;
  postsCleared: number;
  photosDeleted: number;
};

type DeleteOrphansResult = {
  photosDeleted: number;
  filesDeleted: number;
};

export default function ImageStorageSettingsPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  // Dialog state
  const [maintenanceConfirm, setMaintenanceConfirm] = useState<"backfill" | "delete-instagram" | "delete-orphans" | null>(null);

  // PRM-S3 form state
  const [form, setForm] = useState({
    endpoint: "http://localhost:9000",
    publicEndpoint: "",
    deliveryMode: "direct" as PrmS3DeliveryMode,
    bucket: "images",
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
  });
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<ImageStats>({
    queryKey: ["/api/image-storage/stats"],
  });

  const { data: prmS3Config } = useQuery<PrmS3ConfigResponse>({
    queryKey: ["/api/image-storage/prm-s3/settings"],
    enabled: isAdmin,
  });

  useEffect(() => {
    if (prmS3Config) {
      setForm({
        endpoint: prmS3Config.endpoint || "http://localhost:9000",
        publicEndpoint: prmS3Config.publicEndpoint || "",
        deliveryMode: prmS3Config.deliveryMode === "proxy" ? "proxy" : "direct",
        bucket: prmS3Config.bucket || "images",
        region: prmS3Config.region || "us-east-1",
        accessKeyId: prmS3Config.accessKeyId || "",
        secretAccessKey: prmS3Config.secretAccessKey || "",
      });
    }
  }, [prmS3Config]);

  const savePrmS3ConfigMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/prm-s3/settings", form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/prm-s3/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prm-s3/health"] });
      toast({ title: "PRM-S3 settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save PRM-S3 settings", description: error.message, variant: "destructive" });
    },
  });

  const testPrmS3Mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/prm-s3/test");
      return res.json() as Promise<{ ok: boolean; message?: string }>;
    },
    onSuccess: (data) => {
      setTestResult(data);
      if (data.ok) {
        toast({ title: "PRM-S3 Connection Successful", description: data.message });
      } else {
        toast({ title: "PRM-S3 Connection Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      setTestResult({ ok: false, message: error.message });
      toast({ title: "PRM-S3 Connection Failed", description: error.message, variant: "destructive" });
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

  const migrateImageTiersMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/migrate-profile-image-tiers");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "Migration started",
        description: "A background task is migrating profile image tiers and references. Check the Tasks page for progress.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start migration", description: error.message, variant: "destructive" });
    },
  });

  const bakeImageVariantsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/bake-image-variants");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "Bake task started",
        description: "A background task is baking webp size variants (64, 150, 1080) for all images. Check the Tasks page for progress.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start bake task", description: error.message, variant: "destructive" });
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
        description: `${data.profileImagesCleared} profile image${data.profileImagesCleared !== 1 ? "s" : ""}, ${data.postsCleared} post${data.postsCleared !== 1 ? "s" : ""}, ${data.photosDeleted} photo record${data.photosDeleted !== 1 ? "s" : ""} cleared.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteOrphansMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/delete-orphans");
      return res.json() as Promise<DeleteOrphansResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });
      toast({
        title: "Orphan images removed",
        description: `Deleted ${data.photosDeleted} photo database record${data.photosDeleted !== 1 ? "s" : ""} and ${data.filesDeleted} physical image file${data.filesDeleted !== 1 ? "s" : ""}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold" data-testid="text-image-storage-title">Image Storage</h1>
        <p className="text-muted-foreground">
          Every image and video the app stores — uploads, profile pictures, posts, stories, message
          attachments and face crops — lives in PRM-S3. {isAdmin ? "The connection settings apply to all users." : "Only admins can change the connection."}
        </p>
      </div>

      <div className="settings-cards-grid">
        {/* PRM-S3 Server Configuration (admins only; the endpoint is admin-gated) */}
        {isAdmin && (
        <Card data-testid="card-prm-s3-config">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              PRM-S3 Server Configuration
            </CardTitle>
            <CardDescription>
              Connection settings for the PRM-s3 object storage service.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="prm-endpoint">Internal Endpoint URL</Label>
                <Input
                  id="prm-endpoint"
                  value={form.endpoint}
                  onChange={(e) => setForm((prev) => ({ ...prev, endpoint: e.target.value }))}
                  placeholder="http://192.168.0.70:9000"
                  data-testid="input-prm-s3-endpoint"
                />
                <p className="text-xs text-muted-foreground">
                  Internal LAN address for backend uploads.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-public-endpoint">Public Endpoint URL</Label>
                <Input
                  id="prm-public-endpoint"
                  value={form.publicEndpoint}
                  onChange={(e) => setForm((prev) => ({ ...prev, publicEndpoint: e.target.value }))}
                  placeholder="https://prm-cdn.example.com"
                  data-testid="input-prm-s3-public-endpoint"
                />
                <p className="text-xs text-muted-foreground">
                  Public address for browser direct loading. If blank, media is proxied.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-delivery-mode">Delivery Mode</Label>
                <Select value={form.deliveryMode} onValueChange={(val) => setForm((prev) => ({ ...prev, deliveryMode: val as PrmS3DeliveryMode }))}>
                  <SelectTrigger id="prm-delivery-mode" className="w-[260px]" data-testid="select-prm-s3-delivery-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct" data-testid="option-delivery-direct">Direct (default)</SelectItem>
                    <SelectItem value="proxy" data-testid="option-delivery-proxy">Proxy</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {form.deliveryMode === "direct"
                    ? "Direct: Browser loads signed URLs directly from PRM-S3."
                    : "Proxy: Media streams securely through the PRM server."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-bucket">Bucket Name</Label>
                <Input
                  id="prm-bucket"
                  value={form.bucket}
                  onChange={(e) => setForm((prev) => ({ ...prev, bucket: e.target.value }))}
                  placeholder="images"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-region">Region</Label>
                <Input
                  id="prm-region"
                  value={form.region}
                  onChange={(e) => setForm((prev) => ({ ...prev, region: e.target.value }))}
                  placeholder="us-east-1"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-access-key">Access Key ID</Label>
                <Input
                  id="prm-access-key"
                  value={form.accessKeyId}
                  onChange={(e) => setForm((prev) => ({ ...prev, accessKeyId: e.target.value }))}
                  placeholder="PRM0CDED7B21AD5BF229"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="prm-secret-key">Secret Access Key</Label>
                <Input
                  id="prm-secret-key"
                  type="password"
                  value={form.secretAccessKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, secretAccessKey: e.target.value }))}
                  placeholder="••••••••"
                />
              </div>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-md flex items-center gap-2 text-sm ${
                  testResult.ok
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                    : "bg-destructive/10 text-destructive border border-destructive/20"
                }`}
              >
                {testResult.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                <span>{testResult.message || (testResult.ok ? "Connected successfully" : "Connection failed")}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="default"
                onClick={() => savePrmS3ConfigMutation.mutate()}
                disabled={savePrmS3ConfigMutation.isPending}
              >
                {savePrmS3ConfigMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Settings
              </Button>
              <Button
                variant="outline"
                onClick={() => testPrmS3Mutation.mutate()}
                disabled={testPrmS3Mutation.isPending}
              >
                {testPrmS3Mutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Server className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Stats */}
        <Card data-testid="card-image-stats">
          <CardHeader>
            <CardTitle className="text-lg">Stats</CardTitle>
            <CardDescription>What PRM-S3 holds. An image counts once no matter how many sizes are baked for it.</CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : stats ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                    <ImageIcon className="h-4 w-4 text-primary" />
                    Images
                  </div>
                  <span className="text-3xl font-bold" data-testid="text-total-images">{stats.images.toLocaleString()}</span>
                </div>
                <div className="flex flex-col p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                    <Video className="h-4 w-4 text-primary" />
                    Videos
                  </div>
                  <span className="text-3xl font-bold" data-testid="text-total-videos">{stats.videos.toLocaleString()}</span>
                </div>
                <div className="flex flex-col p-4 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                    <Files className="h-4 w-4 text-primary" />
                    Total
                  </div>
                  <span className="text-3xl font-bold" data-testid="text-total-files">{stats.total.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground mt-1">
                    includes {stats.variants.toLocaleString()} size variants · {formatBytes(stats.objectBytes + stats.variantBytes)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-stats-unavailable">Stats unavailable — PRM-S3 could not be reached.</p>
            )}
          </CardContent>
        </Card>

        {/* Storage maintenance (admins only; the endpoints are admin-gated) */}
        {isAdmin && (
        <Card data-testid="card-storage-maintenance">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Storage Maintenance
            </CardTitle>
            <CardDescription>Perform database cleanup and maintenance tasks for your images.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Section 1: Add Photos to DB */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Database className="h-4 w-4" />
                Add Photos to DB
              </h3>
              <p className="text-xs text-muted-foreground">
                Register existing image URLs in the photos table.
              </p>
              <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3" data-testid="notice-backfill-danger">
                <TriangleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">Caution</p>
                  <p className="text-xs text-muted-foreground">
                    Scans database image URLs and registers missing entries in the photos table. Safe to run multiple times.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setMaintenanceConfirm("backfill")}
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
            </div>

            {/* Section 2: Migrate profile image tiers */}
            <div className="border-t pt-6 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Images className="h-4 w-4" />
                Migrate Profile Image Tiers
              </h3>
              <p className="text-xs text-muted-foreground">
                Migrates social accounts to canonical image URLs with PRM-S3 size variants. Runs as background task.
              </p>
              <Button
                variant="outline"
                onClick={() => migrateImageTiersMutation.mutate()}
                disabled={migrateImageTiersMutation.isPending}
                data-testid="button-migrate-profile-image-tiers"
              >
                {migrateImageTiersMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Images className="h-4 w-4 mr-2" />
                )}
                Migrate Profile Image Tiers
              </Button>
            </div>

            {/* Section 2b: Bake Image Variants */}
            <div className="border-t pt-6 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Bake Image Variants
              </h3>
              <p className="text-xs text-muted-foreground">
                Pre-bakes WebP size variants (64px, 150px, 1080px) for all images in PRM-S3.
              </p>
              <Button
                variant="outline"
                onClick={() => bakeImageVariantsMutation.mutate()}
                disabled={bakeImageVariantsMutation.isPending}
                data-testid="button-bake-image-variants"
              >
                {bakeImageVariantsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Bake Image Variants
              </Button>
            </div>

            {/* Section 3: Delete Instagram & Facebook CDN URLs */}
            <div className="border-t pt-6 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Delete Instagram &amp; Facebook CDN Image URLs
              </h3>
              <p className="text-xs text-muted-foreground">
                Remove temporary CDN URLs (cdninstagram.com and fbcdn.net) from images and profiles.
              </p>
              <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3" data-testid="notice-instagram-danger">
                <TriangleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">Destructive action</p>
                  <p className="text-xs text-muted-foreground">
                    Removes all temporary CDN URLs from posts and profile photos.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setMaintenanceConfirm("delete-instagram")}
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
            </div>

            {/* Section 4: Delete Orphan Images */}
            <div className="border-t pt-6 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-destructive" />
                Delete Orphan Images
              </h3>
              <p className="text-xs text-muted-foreground">
                Remove unreferenced image files and database records.
              </p>
              <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3" data-testid="notice-delete-orphans-danger">
                <TriangleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">Destructive action</p>
                  <p className="text-xs text-muted-foreground">
                    Permanently deletes files from storage and removes unreferenced database entries.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setMaintenanceConfirm("delete-orphans")}
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
            </div>
          </CardContent>
        </Card>
        )}
      </div>

      {/* Backfill Dialog */}
      <AlertDialog open={maintenanceConfirm === "backfill"} onOpenChange={(open) => !open && setMaintenanceConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Scan and Register Photos?</AlertDialogTitle>
            <AlertDialogDescription>
              This will scan all image URLs in the database and create a row in the photos table for each one that is not already registered. Already-registered photos are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-backfill">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { backfillMutation.mutate(); setMaintenanceConfirm(null); }}
              data-testid="button-confirm-backfill"
            >
              Register Photos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Instagram Dialog */}
      <AlertDialog open={maintenanceConfirm === "delete-instagram"} onOpenChange={(open) => !open && setMaintenanceConfirm(null)}>
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
              onClick={() => { deleteInstagramMutation.mutate(); setMaintenanceConfirm(null); }}
              data-testid="button-confirm-delete-instagram"
            >
              Delete CDN URLs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Orphans Dialog */}
      <AlertDialog open={maintenanceConfirm === "delete-orphans"} onOpenChange={(open) => !open && setMaintenanceConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Orphan Images?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all image records in the photos database table that are no longer referenced by any active entity, and delete their physical files from storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-orphans">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { deleteOrphansMutation.mutate(); setMaintenanceConfirm(null); }}
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
