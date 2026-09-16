import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ImageIcon, Loader2, Sparkles } from "lucide-react";

export default function ExperimentalFeaturesPage() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/settings"],
  });

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await apiRequest("POST", "/api/settings", { key, value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update setting",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const demosEnabled = settings?.experimental_demos_enabled === "true";
  const imagesTabEnabled = settings?.images_tab_enabled !== "false"; // Defaults to true

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-experimental-features-title">
          Experimental Features
        </h1>
        <p className="text-muted-foreground mt-1">
          Enable or disable preview capabilities and experimental layouts.
        </p>
      </div>

      <div className="space-y-4">
        {/* Switch for Demos section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
              Demos Sidebar Menu
            </CardTitle>
            <CardDescription>
              Show a link to the Demos page in the sidebar menu to explore upcoming features.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <Label htmlFor="demos-switch" className="flex-1 cursor-pointer pr-4">
              Enable Demos Sidebar Link
            </Label>
            <Switch
              id="demos-switch"
              checked={demosEnabled}
              onCheckedChange={(checked) => {
                updateSettingMutation.mutate({
                  key: "experimental_demos_enabled",
                  value: checked ? "true" : "false",
                });
                toast({
                  title: checked ? "Demos sidebar link enabled" : "Demos sidebar link disabled",
                  description: "Changes will reflect in the sidebar menu.",
                });
              }}
              data-testid="switch-experimental-demos"
            />
          </CardContent>
        </Card>

        {/* Switch for Images tab */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
              Profile Images Tab
            </CardTitle>
            <CardDescription>
              Toggle the visibility of the Images/Photos tab on person profile and the "Me" user page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <Label htmlFor="images-switch" className="flex-1 cursor-pointer pr-4">
              Enable Photos/Images Tab
            </Label>
            <Switch
              id="images-switch"
              checked={imagesTabEnabled}
              onCheckedChange={(checked) => {
                updateSettingMutation.mutate({
                  key: "images_tab_enabled",
                  value: checked ? "true" : "false",
                });
                toast({
                  title: checked ? "Photos tab enabled" : "Photos tab disabled",
                  description: "Changes will reflect on profile pages.",
                });
              }}
              data-testid="switch-experimental-images"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
