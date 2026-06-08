import { Plug } from "lucide-react";

export default function IntelligenceExternalToolsSettingsPage() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center min-h-[60vh] px-4 text-center"
      data-testid="page-intelligence-external-tools"
    >
      <Plug className="h-10 w-10 text-muted-foreground mb-4" />
      <h1
        className="text-3xl font-semibold tracking-tight"
        data-testid="text-external-tools-coming-soon"
      >
        Coming Soon
      </h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">
        External tools will let the AI call custom APIs, n8n webhooks, and other
        outside services from inside PRM.
      </p>
    </div>
  );
}
