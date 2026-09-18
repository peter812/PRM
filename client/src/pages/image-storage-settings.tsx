import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { HardDrive, Cloud, Server, ArrowRightLeft, Loader2, ImageIcon, Images, TriangleAlert, Database, Trash2, Wrench, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type StorageMode = "prm-s3" | "s3" | "local";

type StorageModeResponse = {
  mode: StorageMode;
  hasS3Creds: boolean;
  hasPrmS3Creds: boolean;
};

type ImageStats = {
  total: number;
  local: number;
  s3: number;
  prmS3: number;
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

  // Dialog state
  const [transferConfirm, setTransferConfirm] = useState<{ from: StorageMode; to: StorageMode; count: number } | null>(null);
  const [switchModeConfirm, setSwitchModeConfirm] = useState<{ targetMode: StorageMode; sourceMode: StorageMode; count: number } | null>(null);
  const [maintenanceConfirm, setMaintenanceConfirm] = useState<"backfill" | "delete-instagram" | "delete-orphans" | null>(null);

  // PRM-S3 form state
  const [prmS3Endpoint, setPrmS3Endpoint] = useState("http://localhost:9000");
  const [prmS3PublicEndpoint, setPrmS3PublicEndpoint] = useState("");
  const [prmS3DeliveryMode, setPrmS3DeliveryMode] = useState<PrmS3DeliveryMode>("direct");
  const [prmS3Bucket, setPrmS3Bucket] = useState("images");
  const [prmS3Region, setPrmS3Region] = useState("us-east-1");
  const [prmS3AccessKey, setPrmS3AccessKey] = useState("");
  const [prmS3SecretKey, setPrmS3SecretKey] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const { data: storageData, isLoading: modeLoading } = useQuery<StorageModeResponse>({
    queryKey: ["/api/image-storage/mode"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ImageStats>({
    queryKey: ["/api/image-storage/stats"],
  });

  const { data: prmS3Config } = useQuery<PrmS3ConfigResponse>({
    queryKey: ["/api/image-storage/prm-s3/settings"],
  });

  useEffect(() => {
    if (prmS3Config) {
      if (prmS3Config.endpoint) setPrmS3Endpoint(prmS3Config.endpoint);
      setPrmS3PublicEndpoint(prmS3Config.publicEndpoint || "");
      setPrmS3DeliveryMode(prmS3Config.deliveryMode === "proxy" ? "proxy" : "direct");
      if (prmS3Config.bucket) setPrmS3Bucket(prmS3Config.bucket);
      if (prmS3Config.region) setPrmS3Region(prmS3Config.region);
      if (prmS3Config.accessKeyId) setPrmS3AccessKey(prmS3Config.accessKeyId);
      if (prmS3Config.secretAccessKey) setPrmS3SecretKey(prmS3Config.secretAccessKey);
    }
  }, [prmS3Config]);

  const setModeMutation = useMutation({
    mutationFn: async (mode: StorageMode) => {
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

  const savePrmS3ConfigMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/prm-s3/settings", {
        endpoint: prmS3Endpoint,
        publicEndpoint: prmS3PublicEndpoint,
        deliveryMode: prmS3DeliveryMode,
        bucket: prmS3Bucket,
        region: prmS3Region,
        accessKeyId: prmS3AccessKey,
        secretAccessKey: prmS3SecretKey,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/prm-s3/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/mode"] });
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

  const transferMutation = useMutation({
    mutationFn: async ({ from, to }: { from: StorageMode; to: StorageMode }) => {
      const res = await apiRequest("POST", "/api/image-storage/transfer", { from, to });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "Transfer task started",
        description: "A background task has been created. Check the Tasks page to monitor progress.",
      });
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

  const backfillImageTiersMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/backfill-profile-image-tiers");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Backfill started", description: "A background task is sorting profile images into 150px / 1080px tiers. Check the Tasks page for progress." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to start backfill", description: error.message, variant: "destructive" });
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

  const getStorageCount = (mode: StorageMode): number => {
    if (!stats) return 0;
    if (mode === "prm-s3") return stats.prmS3;
    if (mode === "s3") return stats.s3;
    return stats.local;
  };

  const getStorageLabel = (mode: StorageMode): string => {
    if (mode === "prm-s3") return "PRM-S3";
    if (mode === "s3") return "Standard S3";
    return "Local Storage";
  };

  const handleModeChange = (targetMode: StorageMode) => {
    const currentMode = storageData?.mode || "local";
    if (targetMode === currentMode) return;

    const currentCount = getStorageCount(currentMode);
    if (currentCount > 0) {
      setSwitchModeConfirm({
        targetMode,
        sourceMode: currentMode,
        count: currentCount,
      });
    } else {
      setModeMutation.mutate(targetMode);
    }
  };

  const handleConfirmSwitchMode = (transferImages: boolean) => {
    if (!switchModeConfirm) return;
    const { targetMode, sourceMode } = switchModeConfirm;
    setModeMutation.mutate(targetMode);
    if (transferImages) {
      transferMutation.mutate({ from: sourceMode, to: targetMode });
    }
    setSwitchModeConfirm(null);
  };

  if (modeLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-image-storage">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentMode = storageData?.mode || "local";
  const hasS3Creds = storageData?.hasS3Creds || false;
  const hasPrmS3Creds = storageData?.hasPrmS3Creds || false;

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold" data-testid="text-image-storage-title">Image Storage</h1>
        <p className="text-muted-foreground">
          Configure where uploaded images are stored and transfer images between PRM-S3, Standard S3, and Local storage.
        </p>
      </div>

      <div className="settings-cards-grid">
        {/* Card 1: Storage Mode */}
        <Card data-testid="card-storage-mode">
          <CardHeader>
            <CardTitle className="text-lg">Storage Mode</CardTitle>
            <CardDescription>Choose where new image uploads will be stored.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <Select value={currentMode} onValueChange={(val) => handleModeChange(val as StorageMode)} disabled={setModeMutation.isPending}>
                <SelectTrigger className="w-[220px]" data-testid="select-storage-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prm-s3" data-testid="option-prm-s3">
                    <span className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-primary" />
                      PRM-S3 Storage
                    </span>
                  </SelectItem>
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
              <Badge variant={currentMode === "prm-s3" ? "default" : "outline"} data-testid="badge-current-mode">
                {currentMode === "prm-s3" && <Server className="h-3 w-3 mr-1" />}
                {currentMode === "s3" && <Cloud className="h-3 w-3 mr-1" />}
                {currentMode === "local" && <HardDrive className="h-3 w-3 mr-1" />}
                Active: {getStorageLabel(currentMode)}
              </Badge>
              <Badge variant={hasPrmS3Creds ? "outline" : "secondary"} data-testid="badge-prm-s3-status">
                <Server className="h-3 w-3 mr-1" />
                PRM-S3: {hasPrmS3Creds ? "Configured" : "Not Set"}
              </Badge>
              <Badge variant={hasS3Creds ? "outline" : "secondary"} data-testid="badge-s3-status">
                <Cloud className="h-3 w-3 mr-1" />
                Standard S3: {hasS3Creds ? "Configured" : "Not Set"}
              </Badge>
            </div>

            {!hasPrmS3Creds && currentMode === "prm-s3" && (
              <p className="text-sm text-destructive">
                PRM-S3 credentials are not configured. Please fill in the PRM-S3 Server Configuration below.
              </p>
            )}

            {!hasS3Creds && currentMode === "s3" && (
              <p className="text-sm text-destructive">
                Standard S3 credentials are not configured. Uploads will fail until S3 environment variables are set.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Card 2: PRM-S3 Server Configuration */}
        <Card data-testid="card-prm-s3-config">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              PRM-S3 Server Configuration
            </CardTitle>
            <CardDescription>
              Configure the connection settings for your dedicated PRM-s3 service. The server has two
              addresses: an internal one this app and its tools use for uploads and processing, and a
              public one your browser loads images from.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="prm-endpoint">Internal Endpoint URL</Label>
                <Input
                  id="prm-endpoint"
                  value={prmS3Endpoint}
                  onChange={(e) => setPrmS3Endpoint(e.target.value)}
                  placeholder="http://192.168.0.70:9000"
                  data-testid="input-prm-s3-endpoint"
                />
                <p className="text-xs text-muted-foreground">
                  Used by the PRM server and other tools on the local network (PRM-s3 <code>internal_address</code>).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-public-endpoint">Public Endpoint URL</Label>
                <Input
                  id="prm-public-endpoint"
                  value={prmS3PublicEndpoint}
                  onChange={(e) => setPrmS3PublicEndpoint(e.target.value)}
                  placeholder="https://prm-cdn.example.com"
                  data-testid="input-prm-s3-public-endpoint"
                />
                <p className="text-xs text-muted-foreground">
                  Address browsers load media from in direct mode (PRM-s3 <code>public_scheme://domain</code>).
                  Required for direct mode; if blank, media is proxied through the PRM server.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-delivery-mode">Delivery Mode</Label>
                <Select value={prmS3DeliveryMode} onValueChange={(val) => setPrmS3DeliveryMode(val as PrmS3DeliveryMode)}>
                  <SelectTrigger id="prm-delivery-mode" className="w-[260px]" data-testid="select-prm-s3-delivery-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct" data-testid="option-delivery-direct">Direct (default)</SelectItem>
                    <SelectItem value="proxy" data-testid="option-delivery-proxy">Proxy</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {prmS3DeliveryMode === "direct"
                    ? "API responses contain 24-hour signed URLs and the browser loads media straight from PRM-S3 via the public endpoint."
                    : "Media travels PRM-S3 → PRM → browser through /api/prm-s3/. Slower, but PRM-S3 needs no public address."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-bucket">Bucket Name</Label>
                <Input
                  id="prm-bucket"
                  value={prmS3Bucket}
                  onChange={(e) => setPrmS3Bucket(e.target.value)}
                  placeholder="images"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-region">Region</Label>
                <Input
                  id="prm-region"
                  value={prmS3Region}
                  onChange={(e) => setPrmS3Region(e.target.value)}
                  placeholder="us-east-1"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prm-access-key">Access Key ID</Label>
                <Input
                  id="prm-access-key"
                  value={prmS3AccessKey}
                  onChange={(e) => setPrmS3AccessKey(e.target.value)}
                  placeholder="PRM0CDED7B21AD5BF229"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="prm-secret-key">Secret Access Key</Label>
                <Input
                  id="prm-secret-key"
                  type="password"
                  value={prmS3SecretKey}
                  onChange={(e) => setPrmS3SecretKey(e.target.value)}
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

        {/* Card 3: Image Statistics */}
        <Card data-testid="card-image-stats">
          <CardHeader>
            <CardTitle className="text-lg">Image Statistics</CardTitle>
            <CardDescription>Overview of where your images are currently stored across all providers.</CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="flex flex-col p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-1">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Total Images
                  </div>
                  <span className="text-2xl font-bold" data-testid="text-total-images">{stats.total}</span>
                </div>
                <div className="flex flex-col p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-primary text-xs font-medium mb-1">
                    <Server className="h-3.5 w-3.5" />
                    PRM-S3
                  </div>
                  <span className="text-2xl font-bold" data-testid="text-prm-s3-images">{stats.prmS3}</span>
                </div>
                <div className="flex flex-col p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-blue-500 text-xs font-medium mb-1">
                    <Cloud className="h-3.5 w-3.5" />
                    Standard S3
                  </div>
                  <span className="text-2xl font-bold" data-testid="text-s3-images">{stats.s3}</span>
                </div>
                <div className="flex flex-col p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 text-amber-500 text-xs font-medium mb-1">
                    <HardDrive className="h-3.5 w-3.5" />
                    Local
                  </div>
                  <span className="text-2xl font-bold" data-testid="text-local-images">{stats.local}</span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Card 4: Transfer Images */}
        <Card data-testid="card-transfer-images">
          <CardHeader>
            <CardTitle className="text-lg">Transfer Images</CardTitle>
            <CardDescription>
              Move images between any combination of storage servers. Transfers run as asynchronous background tasks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* S3 to S3 Transfers */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-blue-500" />
                <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                <Server className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">S3 to S3 Transfers</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Transfer images directly between Standard S3 and your dedicated PRM-S3 instance.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="justify-start h-auto py-2.5 px-3 text-left"
                  onClick={() => setTransferConfirm({ from: "s3", to: "prm-s3", count: stats?.s3 || 0 })}
                  disabled={transferMutation.isPending || !stats || !hasPrmS3Creds}
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2 shrink-0 text-primary" />
                  <div className="flex flex-col text-xs">
                    <span className="font-medium">Standard S3 → PRM-S3</span>
                    <span className="text-muted-foreground">{stats?.s3 || 0} images available</span>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start h-auto py-2.5 px-3 text-left"
                  onClick={() => setTransferConfirm({ from: "prm-s3", to: "s3", count: stats?.prmS3 || 0 })}
                  disabled={transferMutation.isPending || !stats || !hasS3Creds}
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2 shrink-0 text-blue-500" />
                  <div className="flex flex-col text-xs">
                    <span className="font-medium">PRM-S3 → Standard S3</span>
                    <span className="text-muted-foreground">{stats?.prmS3 || 0} images available</span>
                  </div>
                </Button>
              </div>
            </div>

            {/* S3 to Local Transfers */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-muted-foreground" />
                <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                <HardDrive className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold">S3 to Local Transfers</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Download images from S3 servers to local storage. Updates database records and removes remote files.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="justify-start h-auto py-2.5 px-3 text-left"
                  onClick={() => setTransferConfirm({ from: "prm-s3", to: "local", count: stats?.prmS3 || 0 })}
                  disabled={transferMutation.isPending || !stats}
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2 shrink-0 text-amber-500" />
                  <div className="flex flex-col text-xs">
                    <span className="font-medium">PRM-S3 → Local</span>
                    <span className="text-muted-foreground">{stats?.prmS3 || 0} images available</span>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start h-auto py-2.5 px-3 text-left"
                  onClick={() => setTransferConfirm({ from: "s3", to: "local", count: stats?.s3 || 0 })}
                  disabled={transferMutation.isPending || !stats}
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2 shrink-0 text-amber-500" />
                  <div className="flex flex-col text-xs">
                    <span className="font-medium">Standard S3 → Local</span>
                    <span className="text-muted-foreground">{stats?.s3 || 0} images available</span>
                  </div>
                </Button>
              </div>
            </div>

            {/* Local to S3 Transfers */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-amber-500" />
                <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                <Server className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Local to S3 Transfers</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload local files to PRM-S3 or Standard S3. Updates database records and cleans up local copies.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="justify-start h-auto py-2.5 px-3 text-left"
                  onClick={() => setTransferConfirm({ from: "local", to: "prm-s3", count: stats?.local || 0 })}
                  disabled={transferMutation.isPending || !stats || stats.local === 0 || !hasPrmS3Creds}
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2 shrink-0 text-primary" />
                  <div className="flex flex-col text-xs">
                    <span className="font-medium">Local → PRM-S3</span>
                    <span className="text-muted-foreground">{stats?.local || 0} images available</span>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start h-auto py-2.5 px-3 text-left"
                  onClick={() => setTransferConfirm({ from: "local", to: "s3", count: stats?.local || 0 })}
                  disabled={transferMutation.isPending || !stats || stats.local === 0 || !hasS3Creds}
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2 shrink-0 text-blue-500" />
                  <div className="flex flex-col text-xs">
                    <span className="font-medium">Local → Standard S3</span>
                    <span className="text-muted-foreground">{stats?.local || 0} images available</span>
                  </div>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 5: Storage Maintenance */}
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
                  <p className="text-sm font-medium text-destructive">Danger — do at your own risk</p>
                  <p className="text-xs text-muted-foreground">
                    This scans every image URL in the database and registers it in the photos table. It is safe to run multiple times (duplicates are skipped), but may be slow on large datasets. New uploads are registered automatically going forward.
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

            {/* Section 2: Profile image tiers */}
            <div className="border-t pt-6 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Images className="h-4 w-4" />
                Backfill Profile Image Tiers
              </h3>
              <p className="text-xs text-muted-foreground">
                Social accounts whose list image is a full-size (1080px) picture get it moved to the high-quality slot and a 150px thumbnail generated for list views. Accounts already on a 150px image are left alone. Safe to run more than once; runs as a background task.
              </p>
              <Button
                variant="outline"
                onClick={() => backfillImageTiersMutation.mutate()}
                disabled={backfillImageTiersMutation.isPending}
                data-testid="button-backfill-profile-image-tiers"
              >
                {backfillImageTiersMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Images className="h-4 w-4 mr-2" />
                )}
                Backfill Profile Image Tiers
              </Button>
            </div>

            {/* Section 3: Delete Instagram & Facebook CDN URLs */}
            <div className="border-t pt-6 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Delete Instagram &amp; Facebook CDN Image URLs
              </h3>
              <p className="text-xs text-muted-foreground">
                Remove temporary CDN URLs (cdninstagram.com and fbcdn.net) from images and social profile versions.
              </p>
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
                Remove image records and files that are no longer associated with any people, notes, interactions, groups, or social profile posts.
              </p>
              <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3" data-testid="notice-delete-orphans-danger">
                <TriangleAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">Danger — this will permanently delete files and DB records</p>
                  <p className="text-xs text-muted-foreground">
                    This scans the database for photos that are no longer referenced by any active entity. It will permanently delete these files from storage and remove their entries from the database.
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
      </div>

      {/* Transfer Dialog */}
      <AlertDialog open={!!transferConfirm} onOpenChange={(open) => !open && setTransferConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Transfer Images from {transferConfirm ? getStorageLabel(transferConfirm.from) : ""} to{" "}
              {transferConfirm ? getStorageLabel(transferConfirm.to) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will transfer {transferConfirm?.count || 0} images from {transferConfirm ? getStorageLabel(transferConfirm.from) : ""}{" "}
              to {transferConfirm ? getStorageLabel(transferConfirm.to) : ""}. Each source copy is deleted once the image is in the destination.
              {transferConfirm && transferConfirm.from !== "local"
                ? ` When every image has been moved, ${getStorageLabel(transferConfirm.from)} is swept: any leftover file no record points at is deleted, and references to files that no longer exist are cleared.`
                : ""}{" "}
              A background task will execute this transfer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-transfer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (transferConfirm) {
                  transferMutation.mutate({ from: transferConfirm.from, to: transferConfirm.to });
                  setTransferConfirm(null);
                }
              }}
              data-testid="button-confirm-transfer"
            >
              Start Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mode Switch Dialog */}
      <AlertDialog open={!!switchModeConfirm} onOpenChange={(open) => !open && setSwitchModeConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch Storage Mode to {switchModeConfirm ? getStorageLabel(switchModeConfirm.targetMode) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You currently have {switchModeConfirm?.count || 0} images stored in{" "}
              {switchModeConfirm ? getStorageLabel(switchModeConfirm.sourceMode) : ""}. Would you like to transfer existing images to{" "}
              {switchModeConfirm ? getStorageLabel(switchModeConfirm.targetMode) : ""} as well? New image uploads will use{" "}
              {switchModeConfirm ? getStorageLabel(switchModeConfirm.targetMode) : ""} regardless.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 flex-wrap">
            <AlertDialogCancel data-testid="button-cancel-switch">Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => handleConfirmSwitchMode(false)}
              data-testid="button-switch-no-transfer"
            >
              Switch Without Transfer
            </Button>
            <AlertDialogAction
              onClick={() => handleConfirmSwitchMode(true)}
              data-testid="button-switch-and-transfer"
            >
              Switch and Transfer Images
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
