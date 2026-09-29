import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CONNECTION_KINDS,
  CONNECTION_STRENGTH_KEY,
  DEFAULT_CONNECTION_WEIGHTS,
  parseConnectionWeights,
  type ConnectionKind,
  type ConnectionWeights,
} from "@shared/connection-strength";

const LABELS: Record<ConnectionKind, string> = {
  comment: "Comment on a post",
  story_mention: "Mention in a story",
  post_mention: "Mention in a post (tag, caption or face)",
  bio: "Username in bio",
};

/** Weights behind the Connections tab (connection-strength-plan.md §4). Instance-wide, saved on its own. */
export function ConnectionWeightsCard() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Record<string, string | null>>({ queryKey: ["/api/settings"] });
  const [weights, setWeights] = useState<ConnectionWeights>(DEFAULT_CONNECTION_WEIGHTS);

  useEffect(() => {
    if (settings) setWeights(parseConnectionWeights(settings[CONNECTION_STRENGTH_KEY]));
  }, [settings]);

  const save = useMutation({
    mutationFn: (value: ConnectionWeights) =>
      apiRequest("POST", "/api/settings", { key: CONNECTION_STRENGTH_KEY, value: JSON.stringify(value) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/social-accounts" && q.queryKey[2] === "connections" });
      toast({ title: "Connection weights saved" });
    },
    onError: (err: Error) => toast({ title: "Couldn't save weights", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection Strength</CardTitle>
        <CardDescription>
          What each interaction is worth on an account's Connections tab. Every interaction counts in full today, loses value in a
          straight line to half at two years, and keeps half forever after.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {CONNECTION_KINDS.map((kind) => (
          <div key={kind} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{LABELS[kind]}</Label>
              <span className="text-sm font-medium tabular-nums" data-testid={`text-weight-${kind}`}>{weights[kind]}</span>
            </div>
            <Slider
              value={[weights[kind]]}
              min={0}
              max={10}
              step={1}
              onValueChange={(v) => setWeights((w) => ({ ...w, [kind]: v[0] }))}
              data-testid={`slider-weight-${kind}`}
            />
          </div>
        ))}

        <div className="flex items-center justify-between gap-4 pt-2 border-t">
          <Label htmlFor="heart-multiplier">Heart next to the username in a bio multiplies it by</Label>
          <Input
            id="heart-multiplier"
            type="number"
            min={1}
            step={0.5}
            value={weights.heartMultiplier}
            onChange={(e) => setWeights((w) => ({ ...w, heartMultiplier: Math.max(1, Number(e.target.value) || 1) }))}
            className="w-20 h-8"
            data-testid="input-heart-multiplier"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={() => save.mutate(weights)} disabled={save.isPending} data-testid="button-save-connection-weights">
            Save
          </Button>
          <Button variant="outline" onClick={() => setWeights(DEFAULT_CONNECTION_WEIGHTS)} data-testid="button-reset-connection-weights">
            Reset to defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
