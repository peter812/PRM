import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp } from "lucide-react";
import type { SocialAccountDailyStat } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { TimelineChart, fillMonths, toYears, toCalendarMonths, periodLabel, type Granularity } from "@/components/stats/timeline-chart";

type Range = "week" | "month" | "year" | "all";

// `day` is "YYYY-MM-DD"; short ranges label by day, long ones by month.
const dayLabel = (day: string, range: Range, long = false) => {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (long) return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return range === "week" || range === "month"
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
};

const LOADING = (
  <div className="flex items-center justify-center py-16 text-muted-foreground">
    <Loader2 className="h-5 w-5 animate-spin" />
  </div>
);

const GENERAL_SERIES = [
  { key: "total", label: "Total accounts", color: "hsl(var(--chart-1))" },
  { key: "checked", label: "Checked accounts", color: "hsl(var(--chart-2))" },
  { key: "postsChecked", label: "Posts checked", color: "hsl(var(--chart-3))" },
] as const;

function GeneralStats({ range }: { range: Range }) {
  const { data, isLoading, error } = useQuery<SocialAccountDailyStat[]>({
    queryKey: ["/api/social-accounts/daily-stats", { range }],
  });
  const rows = useMemo(() => data ?? [], [data]);
  const series = useMemo(
    () => GENERAL_SERIES.map((s) => ({ label: s.label, color: s.color, values: rows.map((r) => r[s.key]) })),
    [rows],
  );

  if (isLoading) return LOADING;
  if (error) return <p className="text-sm text-destructive">Failed to load account stats.</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-8 text-center">No snapshots yet.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {series.map((s) => {
          const known = s.values.filter((v): v is number => v !== null);
          const latest = known[known.length - 1];
          const change = known.length > 1 ? latest - known[0] : null;
          return (
            <div key={s.label} className="rounded-md border p-3" data-testid={`stat-${s.label}`}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </div>
              <div className="text-2xl font-semibold tabular-nums">{latest === undefined ? "—" : latest.toLocaleString()}</div>
              {change !== null && (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {change >= 0 ? "+" : ""}{change.toLocaleString()} over this range
                </div>
              )}
            </div>
          );
        })}
      </div>
      {rows.length < 2 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">History builds up from today, one snapshot a day.</p>
      ) : (
        <TimelineChart testId="account-timeline-chart"
          periods={rows.map((r) => r.day)}
          series={series}
          label={(p, long) => dayLabel(p, range, long)}
          zeroBased={false}
        />
      )}
      {series.slice(1).some((s) => s.values.includes(null)) && (
        <p className="text-xs text-muted-foreground">
          Totals before the first snapshot are rebuilt from when each account was added; checked counts start with the first snapshot.
        </p>
      )}
    </div>
  );
}

function CreationDates({ granularity }: { granularity: Granularity }) {
  const { data, isLoading, error } = useQuery<{ month: string; count: number }[]>({
    queryKey: ["/api/social-accounts/joined-histogram"],
  });

  const months = useMemo(() => fillMonths((data ?? []).map((b) => ({ period: b.month, count: b.count }))), [data]);
  const buckets = useMemo(
    () => (granularity === "year" ? toYears(months) : granularity === "month" ? toCalendarMonths(months) : months),
    [months, granularity],
  );
  const series = useMemo(() => [{ label: "Accounts", color: "hsl(var(--chart-1))", values: buckets.map((b) => b.count) }], [buckets]);
  const total = useMemo(() => (data ?? []).reduce((sum, b) => sum + b.count, 0), [data]);

  if (isLoading) return LOADING;
  if (error) return <p className="text-sm text-destructive">Failed to load account creation dates.</p>;
  if (buckets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No accounts have a known creation date yet. Dates are filled in when Instagram tracking
        reads an account's About info.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {`${total} account${total === 1 ? "" : "s"} with a known creation date` +
          (months.length ? `, ${periodLabel(months[0].period, "all")} – ${periodLabel(months[months.length - 1].period, "all")}` : "")}
        {granularity === "month" && ". Each point is a calendar month summed across every year, to show seasonality."}
      </p>
      <TimelineChart testId="account-timeline-chart"
        periods={buckets.map((b) => b.period)}
        series={series}
        label={(p, long) => periodLabel(p, granularity, long)}
        zeroBased
      />
    </div>
  );
}

export function SocialAccountStatsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState<"general" | "creation">("general");
  const [range, setRange] = useState<Range>("month");
  const [granularity, setGranularity] = useState<Granularity>("all");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Account stats
          </DialogTitle>
          <DialogDescription>
            {tab === "general"
              ? "Account totals over time, recorded once a day."
              : granularity === "all" ? "Accounts created per month, all time" : granularity === "year" ? "Accounts created per year" : "Accounts created by calendar month"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="general" data-testid="stats-tab-general">General</TabsTrigger>
              <TabsTrigger value="creation" data-testid="stats-tab-creation">Creation dates</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === "general" ? (
            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
              <SelectTrigger className="w-36" data-testid="select-stats-range"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="year">Year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
              <SelectTrigger className="w-36" data-testid="select-granularity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="year">Year</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        {tab === "general" ? <GeneralStats range={range} /> : <CreationDates granularity={granularity} />}
      </DialogContent>
    </Dialog>
  );
}
