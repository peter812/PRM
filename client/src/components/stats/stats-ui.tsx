import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { LabelCount, MonthCount } from "@shared/stats";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimelineChart, fillMonths, toYears, toCalendarMonths, periodLabel, type Granularity } from "@/components/stats/timeline-chart";

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** Title, subtitle and error state shared by every Stats page. */
export function StatsPage({ title, subtitle, isError, children }: {
  title: string;
  subtitle: string;
  isError?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>
      {isError ? (
        <p className="text-sm text-destructive" data-testid="text-stats-error">Couldn't load stats.</p>
      ) : (
        children
      )}
    </div>
  );
}

/** A titled card; shows a skeleton until `loading` is false. */
export function StatSection({ title, description, loading, children, testId, action }: {
  title: string;
  description?: string;
  loading?: boolean;
  children: ReactNode;
  testId: string;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-md border bg-card p-4 space-y-3" data-testid={`stat-section-${testId}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {loading ? <Skeleton className="h-32 w-full" /> : children}
    </section>
  );
}

export const TILE_GRID = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3";

/** Horizontal bars, longest first as given. Rows link when `href` returns a path. */
export function BarList({ items, href, emptyText = "Nothing yet.", testId }: {
  items: LabelCount[];
  href?: (item: LabelCount, index: number) => string | undefined;
  emptyText?: string;
  testId: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="space-y-1.5" data-testid={`bar-list-${testId}`}>
      {items.map((item, i) => {
        const to = href?.(item, i);
        const label = to ? <Link href={to} className="hover:underline truncate">{item.label}</Link> : <span className="truncate">{item.label}</span>;
        return (
          <li key={`${item.label}-${i}`} className="text-sm">
            <div className="flex items-center justify-between gap-3">
              {label}
              <span className="tabular-nums text-muted-foreground">{item.count.toLocaleString()}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted mt-0.5 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${(item.count / max) * 100}%`, background: item.color || "hsl(var(--chart-1))" }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "Have X of Y" meters, e.g. how many people have a photo. An item's own `total` overrides the shared one. */
export function CompletenessList({ items, total: sharedTotal = 0, testId }: {
  items: { label: string; count: number; total?: number }[];
  total?: number;
  testId: string;
}) {
  return (
    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2" data-testid={`completeness-${testId}`}>
      {items.map(({ total = sharedTotal, ...item }) => (
        <li key={item.label} className="text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {item.count.toLocaleString()} <span className="text-xs">({pct(item.count, total)}%)</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted mt-0.5 overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct(item.count, total)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A per-month count series with an All time / By year / By month toggle. */
export function MonthChart({ title, description, months, seriesLabel, loading, testId }: {
  title: string;
  description?: string;
  months: MonthCount[] | undefined;
  seriesLabel: string;
  loading?: boolean;
  testId: string;
}) {
  const [granularity, setGranularity] = useState<Granularity>("all");
  const filled = useMemo(() => fillMonths((months ?? []).map((m) => ({ period: m.month, count: m.count }))), [months]);
  const buckets = useMemo(
    () => (granularity === "year" ? toYears(filled) : granularity === "month" ? toCalendarMonths(filled) : filled),
    [filled, granularity],
  );
  const series = useMemo(() => [{ label: seriesLabel, color: "hsl(var(--chart-1))", values: buckets.map((b) => b.count) }], [buckets, seriesLabel]);

  return (
    <StatSection
      title={title}
      description={description}
      loading={loading}
      testId={testId}
      action={
        <Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs" data-testid={`tab-${testId}-all`}>All time</TabsTrigger>
            <TabsTrigger value="year" className="text-xs" data-testid={`tab-${testId}-year`}>By year</TabsTrigger>
            <TabsTrigger value="month" className="text-xs" data-testid={`tab-${testId}-month`}>By month</TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      {buckets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <TimelineChart
          periods={buckets.map((b) => b.period)}
          series={series}
          label={(p, long) => periodLabel(p, granularity, long)}
          zeroBased
          testId={`chart-${testId}`}
        />
      )}
    </StatSection>
  );
}
