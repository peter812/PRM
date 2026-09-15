import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Insight } from "@shared/schema";

// Insights about one social account, or about a person (directly or via the
// accounts they own). Exactly one of the two ids is passed.
type Props = { socialAccountId: string } | { personId: string };

export function InsightsTab(props: Props) {
  const queryKey =
    "socialAccountId" in props
      ? ["/api/social-accounts", props.socialAccountId, "insights"]
      : ["/api/people", props.personId, "insights"];

  const { data: insights, isLoading } = useQuery<Insight[]>({ queryKey });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/insights/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!insights?.length) {
    return <p className="p-6 text-sm text-muted-foreground" data-testid="text-insights-empty">No insights yet.</p>;
  }

  return (
    <div className="p-6 space-y-3">
      {insights.map((insight) => (
        <div key={insight.id} className="rounded-md border p-4 space-y-2" data-testid={`insight-${insight.id}`}>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{insight.type}</Badge>
            {insight.source && <span className="text-xs text-muted-foreground">{insight.source}</span>}
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(insight.collectedAt).toLocaleString()}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => deleteMutation.mutate(insight.id)}
              disabled={deleteMutation.isPending}
              aria-label="Delete insight"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <pre className="whitespace-pre-wrap break-words text-sm font-sans">{insight.rawText}</pre>
        </div>
      ))}
    </div>
  );
}
