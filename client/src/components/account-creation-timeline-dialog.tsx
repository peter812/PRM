import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp } from "lucide-react";
import type { SocialAccountDailyStat } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// `period` is "YYYY-MM" for all time, "YYYY" for year, or "MM" for calendar month (Jan…Dec across every year).
type Bucket = { period: string; count: number };
type Granularity = "all" | "year" | "month";
type Range = "week" | "month" | "year" | "all";
type Series = { label: string; color: string; values: (number | null)[] };

const WIDTH = 900;
const HEIGHT = 340;
const PAD = { top: 20, right: 24, bottom: 44, left: 56 };

const periodLabel = (period: string, unit: Granularity, long = false) => {
  const month = long ? "long" : "short";
  if (unit === "year") return period;
  if (unit === "month") return new Date(2000, Number(period) - 1, 1).toLocaleDateString(undefined, { month });
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: "numeric", month });
};

// `day` is "YYYY-MM-DD"; short ranges label by day, long ones by month.
const dayLabel = (day: string, range: Range, long = false) => {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (long) return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return range === "week" || range === "month"
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
};

// Fill in months with no accounts so the x axis is continuous in time.
function fillMonths(buckets: Bucket[]): Bucket[] {
  if (buckets.length === 0) return [];
  const byMonth = new Map(buckets.map((b) => [b.period, b.count]));
  const [y0, m0] = buckets[0].period.split("-").map(Number);
  const [y1, m1] = buckets[buckets.length - 1].period.split("-").map(Number);
  const out: Bucket[] = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ period: key, count: byMonth.get(key) ?? 0 });
  }
  return out;
}

// Sum monthly buckets into calendar years, again with empty years filled in.
function toYears(buckets: Bucket[]): Bucket[] {
  if (buckets.length === 0) return [];
  const byYear = new Map<string, number>();
  for (const b of buckets) {
    const y = b.period.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + b.count);
  }
  const y0 = Number(buckets[0].period.slice(0, 4));
  const y1 = Number(buckets[buckets.length - 1].period.slice(0, 4));
  const out: Bucket[] = [];
  for (let y = y0; y <= y1; y++) out.push({ period: String(y), count: byYear.get(String(y)) ?? 0 });
  return out;
}

// Sum every January together, every February together, and so on: 12 buckets.
function toCalendarMonths(buckets: Bucket[]): Bucket[] {
  if (buckets.length === 0) return [];
  const counts = new Array<number>(12).fill(0);
  for (const b of buckets) counts[Number(b.period.slice(5, 7)) - 1] += b.count;
  return counts.map((count, i) => ({ period: String(i + 1).padStart(2, "0"), count }));
}

// Monotone cubic interpolation: smooth, but never overshoots below zero between points.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : "";
  const n = pts.length;
  const dx: number[] = [], dy: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    dy.push(pts[i + 1].y - pts[i].y);
    m.push(dy[i] / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  }
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i].x + h},${pts[i].y + t[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

// A 1/2/5 × 10ⁿ step at least `raw` wide, so axis labels stay round.
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  return ([1, 2, 5, 10].find((k) => k * pow >= raw) ?? 10) * pow;
}

/**
 * One or more lines over the same periods. `zeroBased` pins the y axis at 0 (counts per period);
 * otherwise it fits the data, so a slowly growing running total still shows its change.
 */
function TimelineChart({ periods, series, label, zeroBased }: {
  periods: string[];
  series: Series[];
  label: (period: string, long?: boolean) => string;
  zeroBased: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { xs, lines, yTicks, xTicks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const rawMin = zeroBased ? 0 : Math.min(...all);
    const rawMax = Math.max(zeroBased ? 1 : rawMin + 1, ...all);
    const step = niceStep((rawMax - rawMin) / 4);
    const lo = Math.floor(rawMin / step) * step;
    const hi = Math.max(lo + step, Math.ceil(rawMax / step) * step);
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const xs = periods.map((_, i) => PAD.left + (periods.length === 1 ? innerW / 2 : (i / (periods.length - 1)) * innerW));
    const yAt = (c: number) => PAD.top + innerH - ((c - lo) / (hi - lo)) * innerH;
    const lines = series.map((s) => {
      const pts = s.values.map((v, i) => (v === null ? null : { x: xs[i], y: yAt(v), i }));
      const shown = pts.filter((p): p is NonNullable<typeof p> => p !== null);
      return { ...s, pts, shown, path: smoothPath(shown) };
    });

    const yTicks: { y: number; label: number }[] = [];
    for (let c = lo; c <= hi; c += step) yTicks.push({ y: yAt(c), label: c });

    // At most 12 labelled x ticks, always including the first and last period.
    const every = Math.max(1, Math.ceil(periods.length / 12));
    const xTicks = periods.map((p, i) => ({ p, x: xs[i], i })).filter(({ i }) => i % every === 0 || i === periods.length - 1);
    return { xs, lines, yTicks, xTicks };
  }, [periods, series, zeroBased]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || xs.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    }
    setHover(best);
  };

  const baseline = HEIGHT - PAD.bottom;
  const showDots = periods.length <= 60;
  const activeTop = hover === null ? 0 : Math.min(...lines.map((l) => l.pts[hover]?.y ?? baseline));

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto select-none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        data-testid="account-timeline-chart"
      >
        {yTicks.map((t) => (
          <g key={t.label}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={t.y} y2={t.y} className="stroke-border" strokeDasharray="3 3" />
            <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{t.label.toLocaleString()}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={baseline} y2={baseline} className="stroke-border" />
        {xTicks.map(({ p, x }) => (
          <text key={p} x={x} y={baseline + 18} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {label(p)}
          </text>
        ))}

        {lines.length === 1 && lines[0].shown.length > 0 && (
          <path
            d={`${lines[0].path} L${lines[0].shown[lines[0].shown.length - 1].x},${baseline} L${lines[0].shown[0].x},${baseline} Z`}
            fill={lines[0].color}
            opacity={0.12}
          />
        )}
        {lines.map((l) => (
          <path key={l.label} d={l.path} fill="none" stroke={l.color} strokeWidth={2.5} strokeLinejoin="round" />
        ))}

        {hover !== null && (
          <line x1={xs[hover]} x2={xs[hover]} y1={PAD.top} y2={baseline} className="stroke-muted-foreground" strokeDasharray="4 4" />
        )}
        {lines.map((l) =>
          l.shown
            .filter((p) => showDots || p.i === hover)
            .map((p) => (
              <circle
                key={`${l.label}-${p.i}`}
                cx={p.x}
                cy={p.y}
                r={p.i === hover ? 6 : 3}
                fill={l.color}
                className="stroke-background"
                strokeWidth={2}
              />
            )),
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm shadow-md"
          style={{ left: `${(xs[hover] / WIDTH) * 100}%`, top: `${(activeTop / HEIGHT) * 100}%`, marginTop: -16 - 20 * (lines.length + 1) }}
          data-testid="account-timeline-tooltip"
        >
          <div className="font-medium">{label(periods[hover], true)}</div>
          {lines.map((l) => (
            <div key={l.label} className="flex items-center gap-2 text-muted-foreground">
              {lines.length > 1 && <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />}
              {l.label}: {l.values[hover] === null ? "—" : l.values[hover]!.toLocaleString()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
        <TimelineChart
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
      <TimelineChart
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
