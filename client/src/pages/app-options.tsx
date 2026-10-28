import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Network, Chrome, Key, Search, Sparkles, Layers, Trash2, ChevronRight } from "lucide-react";

const APP_OPTIONS = [
  {
    href: "~/settings/social-graph",
    icon: Network,
    title: "Social Graph",
    description: "Set the default mode and account for the social account graph view",
    testId: "card-social-graph-link",
  },
  {
    href: "~/settings/chrome-extension",
    icon: Chrome,
    title: "Chrome Extension",
    description: "Configure the Chrome extension connection and sync settings",
    testId: "card-chrome-extension-link",
  },
  {
    href: "~/settings/api/settings",
    icon: Key,
    title: "API Settings",
    description: "Manage API keys and access credentials for external integrations",
    testId: "card-api-settings-link",
  },
  {
    href: "~/settings/search",
    icon: Search,
    title: "Search Options",
    description: "Customize the order and visibility of global search results",
    testId: "card-search-options-link",
  },
  {
    href: "~/settings/data-types",
    icon: Layers,
    title: "Data Types",
    description: "Manage relationship types, interaction types, and social account types",
    testId: "card-data-types-link",
  },
  {
    href: "~/settings/delete",
    icon: Trash2,
    title: "Delete Options",
    description: "Reset or clean up database records, media, and cached data",
    testId: "card-delete-options-link",
  },
];

export default function AppOptionsPage() {
  const { toast } = useToast();

  const { data: settings } = useQuery<Record<string, string | null>>({
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

  const demosEnabled = settings?.experimental_demos_enabled === "true";

  return (
    <div className="container max-w-full py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold" data-testid="text-app-options-title">
          App Options
        </h1>
        <p className="text-muted-foreground">
          Configure application-level settings and integrations.
        </p>
      </div>

      <div className="settings-cards-grid">
        {APP_OPTIONS.map(({ href, icon: Icon, title, description, testId }) => (
          <Link key={href} href={href} className="block">
            <Card className="hover-elevate cursor-pointer" data-testid={testId}>
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 p-5">
                <div className="flex items-center gap-4">
                  <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="space-y-1">
                    <CardTitle className="text-base font-semibold">{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-10 mb-6 max-w-3xl">
        <h2 className="text-xl font-semibold" data-testid="text-experimental-features-title">
          Experimental Features
        </h2>
        <p className="text-muted-foreground mt-1">
          Enable or disable preview capabilities and experimental layouts.
        </p>
      </div>

      <div className="settings-cards-grid">
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
              disabled={!settings}
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
      </div>
    </div>
  );
}
