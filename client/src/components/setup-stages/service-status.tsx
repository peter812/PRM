import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";

type HealthStatus = "online" | "degraded" | "offline" | "not_configured" | "testing";

/** One service's entry from GET /api/setup/services/health. */
export interface HealthResult {
  ok: boolean;
  status: HealthStatus;
  message: string;
  details?: Record<string, any>;
}

export const HEALTH_KEY = ["/api/setup/services/health"];

export function ServiceStatusBadge({ result }: { result?: HealthResult }) {
  if (!result) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground border-dashed">
        <HelpCircle className="h-3 w-3" /> Unknown
      </Badge>
    );
  }
  if (result.status === "online") {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1">
        <CheckCircle2 className="h-3 w-3" /> Online
      </Badge>
    );
  }
  if (result.status === "degraded") {
    return (
      <Badge className="bg-amber-600 hover:bg-amber-700 text-white gap-1">
        <AlertTriangle className="h-3 w-3" /> Setup Needed
      </Badge>
    );
  }
  if (result.status === "not_configured") {
    return (
      <Badge variant="secondary" className="gap-1 text-muted-foreground">
        <HelpCircle className="h-3 w-3" /> Unconfigured
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" /> Offline
    </Badge>
  );
}
