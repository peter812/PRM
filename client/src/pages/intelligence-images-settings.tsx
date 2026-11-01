import { useState } from "react";
import { Link } from "wouter";
import { useLoadOnce } from "@/hooks/use-load-once";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, ImageIcon, Cpu, MessageSquare, AlertCircle } from "lucide-react";
import { ProviderModelPicker, apiErrorMessage, type ModelSelection } from "@/components/provider-model-picker";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type AiSettings = {
  autoDescribeImages: boolean;
  vision: ModelSelection;
};

export default function IntelligenceImagesSettingsPage() {
  const { toast } = useToast();

  const [autoDescribeImages, setAutoDescribeImages] = useState(false);
  const [vision, setVision] = useState<ModelSelection>({ providerId: "", model: "" });

  const { data: settings, isLoading } = useQuery<AiSettings>({
    queryKey: ["/api/ai/settings"],
  });

  useLoadOnce(settings, (s) => {
    setAutoDescribeImages(s.autoDescribeImages ?? false);
    if (s.vision) setVision(s.vision);
  });

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ai/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: apiErrorMessage(error), variant: "destructive" });
    },
  });

  const handleToggleAutoDescribe = (checked: boolean) => {
    setAutoDescribeImages(checked);
    saveMutation.mutate({ autoDescribeImages: checked });
  };

  const handleSaveModel = () => {
    saveMutation.mutate({ vision });
  };

  const aiReady = !!settings?.vision?.model;
  const visionChanged = vision.model !== (settings?.vision?.model ?? "") || vision.providerId !== (settings?.vision?.providerId ?? "");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="loading-intelligence-images-settings">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-intelligence-images-title">
          <ImageIcon className="h-6 w-6" />
          Images
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure AI-powered image description settings.
        </p>
      </div>

      <div className="settings-cards-grid">
        <Card data-testid="card-auto-describe">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Auto-describe Uploaded Images
            </CardTitle>
            <CardDescription>
              When enabled, every image you upload (except profile images) is automatically sent to
              the configured vision model to generate a description. The description is saved in the
              background — uploads are not delayed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="auto-describe-toggle"
                checked={autoDescribeImages}
                onCheckedChange={handleToggleAutoDescribe}
                disabled={saveMutation.isPending}
                data-testid="switch-auto-describe"
              />
              <Label htmlFor="auto-describe-toggle" className="cursor-pointer">
                {autoDescribeImages ? "Enabled" : "Disabled"}
              </Label>
            </div>
            {autoDescribeImages && !aiReady && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Auto-describe is on but no vision model is selected below.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-vision-model">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Image Description Model
            </CardTitle>
            <CardDescription>
              Choose a vision-capable model (e.g. llava, qwen2.5vl, gpt-4o-mini) and the provider it runs on.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ProviderModelPicker value={vision} onChange={setVision} testId="picker-vision" />
            <div className="flex justify-end">
              <Button
                onClick={handleSaveModel}
                disabled={!vision.model || !visionChanged || saveMutation.isPending}
                data-testid="button-save-model"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-vision-prompt">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Image Description Prompt
            </CardTitle>
            <CardDescription>
              The instruction sent to the model with each image. It lives on the Prompts page with the other AI prompts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild data-testid="link-vision-prompt">
              <Link href="/intelligence/prompts?prompt=imageDescribe">Open prompt</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
