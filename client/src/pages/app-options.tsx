import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Network, Chrome, Key, Search, Sparkles, Layers, Trash2, ChevronRight } from "lucide-react";

const APP_OPTIONS = [
  {
    href: "/social-graph",
    icon: Network,
    title: "Social Graph",
    description: "Set the default mode and account for the social account graph view",
    testId: "card-social-graph-link",
  },
  {
    href: "/chrome-extension",
    icon: Chrome,
    title: "Chrome Extension",
    description: "Configure the Chrome extension connection and sync settings",
    testId: "card-chrome-extension-link",
  },
  {
    href: "/api/settings",
    icon: Key,
    title: "API Settings",
    description: "Manage API keys and access credentials for external integrations",
    testId: "card-api-settings-link",
  },
  {
    href: "/search",
    icon: Search,
    title: "Search Options",
    description: "Customize the order and visibility of global search results",
    testId: "card-search-options-link",
  },
  {
    href: "/experimental",
    icon: Sparkles,
    title: "Experimental Features",
    description: "Enable and test experimental tools and integrations",
    testId: "card-experimental-features-link",
  },
  {
    href: "/data-types",
    icon: Layers,
    title: "Data Types",
    description: "Manage relationship types, interaction types, and social account types",
    testId: "card-data-types-link",
  },
  {
    href: "/delete",
    icon: Trash2,
    title: "Delete Options",
    description: "Reset or clean up database records, media, and cached data",
    testId: "card-delete-options-link",
  },
];

export default function AppOptionsPage() {
  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" data-testid="text-app-options-title">
          App Options
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure application-level settings and integrations.
        </p>
      </div>

      <div className="space-y-3">
        {APP_OPTIONS.map(({ href, icon: Icon, title, description, testId }) => (
          <Link key={href} href={href}>
            <Card className="hover-elevate cursor-pointer" data-testid={testId}>
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 py-4">
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <CardTitle className="text-base">{title}</CardTitle>
                    <CardDescription className="mt-0.5">{description}</CardDescription>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
