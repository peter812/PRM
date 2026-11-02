import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ImporterList } from "@/components/instagram-importer-list";
import { HEALTH_KEY, ServiceStatusBadge, type HealthResult } from "./service-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  HardDrive,
  Scan,
  Instagram,
  ExternalLink,
  RefreshCw,
  Loader2,
  Terminal,
  Save,
} from "lucide-react";

export function StageServices() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Unified health query
  const {
    data: health,
    isLoading: isHealthLoading,
    refetch: refetchHealth,
    isFetching: isHealthFetching,
  } = useQuery<Record<string, HealthResult>>({
    queryKey: HEALTH_KEY,
    refetchInterval: false,
  });

  // Settings Queries
  const { data: s3Settings } = useQuery<{
    endpoint: string;
    publicEndpoint: string;
    bucket: string;
  }>({
    queryKey: ["/api/image-storage/prm-s3/settings"],
  });

  const { data: computeSettings } = useQuery<{
    apiUrl: string;
    hasApiKey: boolean;
  }>({
    queryKey: ["/api/prm-compute/settings"],
  });

  // Local Form States
  const [s3Endpoint, setS3Endpoint] = useState<string>("");
  const [s3Bucket, setS3Bucket] = useState<string>("");

  const [computeUrl, setComputeUrl] = useState<string>("");
  const [computeSetupCode, setComputeSetupCode] = useState<string>("");

  // Populate from query results when loaded
  useEffect(() => {
    if (s3Settings) {
      setS3Endpoint(s3Settings.endpoint || "http://localhost:9000");
      setS3Bucket(s3Settings.bucket || "images");
    }
  }, [s3Settings]);

  useEffect(() => {
    if (computeSettings) {
      setComputeUrl(computeSettings.apiUrl || "http://localhost:8001");
    }
  }, [computeSettings]);


  // Individual test states
  const [testingService, setTestingService] = useState<string | null>(null);

  // Mutations
  const saveS3Mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-storage/prm-s3/settings", {
        endpoint: s3Endpoint || "http://localhost:9000",
        bucket: s3Bucket || "images",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-storage/prm-s3/settings"] });
      refetchHealth();
      toast({ title: "PRM-S3 settings saved" });
    },
  });

  const saveComputeMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { apiUrl: computeUrl || "http://localhost:8001" };
      if (computeSetupCode.trim()) body.setupCode = computeSetupCode.trim();
      const res = await apiRequest("POST", "/api/prm-compute/settings", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prm-compute/settings"] });
      refetchHealth();
      toast({ title: "PRM-Compute settings saved" });
    },
  });

  // Single test handler
  const handleTestService = async (service: string) => {
    setTestingService(service);
    try {
      if (service === "s3") {
        const res = await apiRequest("POST", "/api/image-storage/prm-s3/test");
        const data = await res.json();
        toast({
          title: data.ok ? "PRM-S3 Connected" : "PRM-S3 Test Failed",
          description: data.message,
          variant: data.ok ? "default" : "destructive",
        });
      } else if (service === "compute") {
        const res = await apiRequest("POST", "/api/prm-compute/test");
        const data = await res.json();
        toast({
          title: data.ok ? "PRM-Compute Connected" : "PRM-Compute Test Failed",
          description: data.message,
          variant: data.ok ? "default" : "destructive",
        });
      }
      refetchHealth();
    } catch (err: any) {
      toast({
        title: "Test Error",
        description: err.message || "Failed to reach endpoint",
        variant: "destructive",
      });
    } finally {
      setTestingService(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Test All button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-muted/40 border">
        <div>
          <h3 className="font-semibold text-base">PRM Distributed Sub-Services</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            PRM uses companion microservices for storage, face recognition, and Instagram stories.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetchHealth()}
          disabled={isHealthFetching}
          className="gap-2 shrink-0 self-start sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isHealthFetching ? "animate-spin" : ""}`} />
          {isHealthFetching ? "Testing Services..." : "Test All Connections"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* 1. PRM-S3 */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-sky-500/10 text-sky-500">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">PRM-S3 (Media Store)</CardTitle>
                    <a
                      href="https://github.com/peter812/PRM-s3"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 hover:underline"
                    >
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <CardDescription className="text-xs">
                    Stores all photos, high-res images, and face cutouts in local S3 storage.
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0"><ServiceStatusBadge result={health?.s3} /></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            {health?.s3?.message && (
              <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px]">
                {health.s3.message}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="s3-endpoint" className="text-xs">S3 Endpoint</Label>
                <Input
                  id="s3-endpoint"
                  size={1}
                  className="h-8 text-xs"
                  placeholder="http://localhost:9000"
                  value={s3Endpoint}
                  onChange={(e) => setS3Endpoint(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="s3-bucket" className="text-xs">Bucket Name</Label>
                <Input
                  id="s3-bucket"
                  size={1}
                  className="h-8 text-xs"
                  placeholder="images"
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" /> Port 9000 (Go / MinIO compatible)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleTestService("s3")}
                  disabled={testingService === "s3"}
                >
                  {testingService === "s3" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => saveS3Mutation.mutate()}
                  disabled={saveS3Mutation.isPending}
                >
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. PRM Compute */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-purple-500/10 text-purple-500">
                  <Scan className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">PRM Compute</CardTitle>
                    <a
                      href="https://github.com/peter812/PRM-face"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 hover:underline"
                    >
                      GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <CardDescription className="text-xs">
                    Python microservice for face detection, 512D embeddings, and clustering.
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0"><ServiceStatusBadge result={health?.compute} /></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            {health?.compute?.message && (
              <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px]">
                {health.compute.message}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="compute-url" className="text-xs">API Endpoint URL</Label>
                <Input
                  id="compute-url"
                  className="h-8 text-xs"
                  placeholder="http://localhost:8001"
                  value={computeUrl}
                  onChange={(e) => setComputeUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="compute-code" className="text-xs">Setup Code (Printed in Terminal)</Label>
                <Input
                  id="compute-code"
                  type="password"
                  className="h-8 text-xs"
                  placeholder="Setup code from PRM-face boot log"
                  value={computeSetupCode}
                  onChange={(e) => setComputeSetupCode(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" /> Port 8001 (FastAPI / InsightFace)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleTestService("compute")}
                  disabled={testingService === "compute"}
                >
                  {testingService === "compute" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => saveComputeMutation.mutate()}
                  disabled={saveComputeMutation.isPending}
                >
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. PRM-stories */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-pink-500/10 text-pink-500">
                  <Instagram className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">PRM-stories (Instagram)</CardTitle>
                  <CardDescription className="text-xs">
                    Drives a logged-in Chrome window to collect Instagram stories and posts. One service per Instagram account.
                  </CardDescription>
                </div>
              </div>
              <div className="shrink-0"><ServiceStatusBadge result={health?.stories} /></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-xs">
            {health?.stories?.message && (
              <p className="text-muted-foreground bg-muted/50 p-2 rounded text-[11px]">
                {health.stories.message}
              </p>
            )}
            <ImporterList onChange={() => refetchHealth()} />
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3 w-3" /> Port 5055 (Node / Chrome)
              </span>
              <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                <Link href="~/settings/instagram">
                  Setup Guide <ExternalLink className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
