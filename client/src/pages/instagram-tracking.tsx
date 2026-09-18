import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_LEVEL_CADENCES,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABEL,
  RECENT_CHECK_HOURS,
  TRACKING_KINDS,
  TRACKING_KIND_LABEL,
  TRACKING_SKIP_RECENT_KEY,
  parseLevelCadences,
  skipRecentEnabled,
  type InterestLevel,
  type TrackingKind,
} from "@shared/interest-level";
import type { Settings } from "@/lib/instagram";

/** How often each interest level re-checks each thing, in days (account-tracking-plan.md §1.2). */
function LevelDefaultsCard({ settings }: { settings: Settings }) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const stored = parseLevelCadences(settings.tracking_level_defaults);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const key = (l: InterestLevel, k: TrackingKind) => `${l}.${k}`;
  const save = useMutation({
    mutationFn: async (next: typeof stored) =>
      apiRequest("POST", "/api/settings", { key: "tracking_level_defaults", value: JSON.stringify(next) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: (error: Error) => toast({ title: "Failed to save cadences", description: error.message, variant: "destructive" }),
  });
  const commit = (l: InterestLevel, k: TrackingKind) => {
    const text = draft[key(l, k)];
    if (text === undefined) return;
    const n = Number(text);
    setDraft((d) => { const { [key(l, k)]: _, ...rest } = d; return rest; });
    if (!Number.isInteger(n) || n < 1 || n === stored[l][k]) return;
    save.mutate({ ...stored, [l]: { ...stored[l], [k]: n } });
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Interest level cadences</CardTitle>
        <CardDescription>
          Days between checks for accounts at each level. An account can override these on its own page; changing its level
          resets it to these.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Level</TableHead>
              {TRACKING_KINDS.map((k) => <TableHead key={k}>{TRACKING_KIND_LABEL[k]}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {INTEREST_LEVELS.filter((l) => l !== "none").map((l) => (
              <TableRow key={l}>
                <TableCell className="font-medium">{INTEREST_LEVEL_LABEL[l]}</TableCell>
                {TRACKING_KINDS.map((k) => (
                  <TableCell key={k}>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-20"
                      disabled={!isAdmin}
                      value={draft[key(l, k)] ?? String(stored[l][k] ?? DEFAULT_LEVEL_CADENCES[l][k] ?? "")}
                      onChange={(e) => setDraft((d) => ({ ...d, [key(l, k)]: e.target.value }))}
                      onBlur={() => commit(l, k)}
                      data-testid={`input-cadence-${l}-${k}`}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Bulk queues and the morning tick leave out accounts checked in the last RECENT_CHECK_HOURS; a single account's "run now" never does. */
function SkipRecentCard({ settings }: { settings: Settings }) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async (value: boolean) => apiRequest("POST", "/api/settings", { key: TRACKING_SKIP_RECENT_KEY, value: String(value) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: (error: Error) => toast({ title: "Failed to save setting", description: error.message, variant: "destructive" }),
  });
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Bulk checks</CardTitle>
        <CardDescription>Applies to the Tracking page, the accounts list's selection and the scheduled morning runs — not to "run now" on an account's page.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 md:max-w-md">
          <div>
            <Label htmlFor="tracking-skip-recent">Skip accounts checked in the last {RECENT_CHECK_HOURS} hours</Label>
            <p className="text-xs text-muted-foreground">Per kind of check: a profile check yesterday doesn't skip today's posts check.</p>
          </div>
          <Switch
            id="tracking-skip-recent"
            checked={skipRecentEnabled(settings[TRACKING_SKIP_RECENT_KEY])}
            disabled={!isAdmin}
            onCheckedChange={(v) => save.mutate(v)}
            data-testid="switch-tracking-skip-recent"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default function InstagramTrackingPage() {
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  return (
    <div className="container max-w-full md:max-w-5xl py-3 md:py-8 px-4 md:pl-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Account tracking</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How often accounts are refreshed at each interest level. An account's level and its own overrides live on the
          account page.
        </p>
      </div>
      {settings && <LevelDefaultsCard settings={settings} />}
      {settings && <SkipRecentCard settings={settings} />}
    </div>
  );
}
