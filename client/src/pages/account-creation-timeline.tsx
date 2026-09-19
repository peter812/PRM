import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// `period` is "YYYY-MM" for all time, "YYYY" for year, or "MM" for calendar month (Jan…Dec across every year).
type Bucket = { period: string; count: number };
type Granularity = "all" | "year" | "month";

const WIDTH = 900;
const HEIGHT = 340;
const PAD = { top: 20, right: 24, bottom: 44, left: 48 };

const periodLabel = (period: string, unit: Granularity, long = false) => {
  const month = long ? "long" : "short";
  if (unit === "year") return period;
  if (unit === "month") return new Date(2000, Number(period) - 1, 1).toLocaleDateString(undefined, { month });
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: "numeric", month });
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

function TimelineChart({ data, unit }: { data: Bucket[]; unit: Granularity }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { points, path, yTicks, xTicks, maxCount } = useMemo(() => {
    const maxCount = Math.max(1, ...data.map((d) => d.count));
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const xAt = (i: number) => PAD.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const yAt = (c: number) => PAD.top + innerH - (c / maxCount) * innerH;
    const points = data.map((d, i) => ({ ...d, x: xAt(i), y: yAt(d.count) }));
    const path = smoothPath(points);

    const yStep = Math.max(1, Math.ceil(maxCount / 4));
    const yTicks: { y: number; label: number }[] = [];
    for (let c = 0; c <= maxCount; c += yStep) yTicks.push({ y: yAt(c), label: c });

    // At most 12 labelled x ticks, always including the first and last period.
    const every = Math.max(1, Math.ceil(data.length / 12));
    const xTicks = points.filter((_, i) => i % every === 0 || i === points.length - 1);
    return { points, path, yTicks, xTicks, maxCount };
  }, [data]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
    }
    setHover(best);
  };

  const active = hover !== null ? points[hover] : null;
  const baseline = HEIGHT - PAD.bottom;

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
            <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{t.label}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={baseline} y2={baseline} className="stroke-border" />
        {xTicks.map((p) => (
          <text key={p.period} x={p.x} y={baseline + 18} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {periodLabel(p.period, unit)}
          </text>
        ))}

        <path
          d={`${path} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`}
          fill="hsl(var(--chart-1))"
          opacity={0.12}
        />
        <path d={path} fill="none" stroke="hsl(var(--chart-1))" strokeWidth={2.5} strokeLinejoin="round" />

        {active && (
          <line x1={active.x} x2={active.x} y1={PAD.top} y2={baseline} className="stroke-muted-foreground" strokeDasharray="4 4" />
        )}
        {points.map((p, i) => (
          <circle
            key={p.period}
            cx={p.x}
            cy={p.y}
            r={i === hover ? 6 : 3}
            fill="hsl(var(--chart-1))"
            className="stroke-background"
            strokeWidth={2}
          />
        ))}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-sm shadow-md"
          style={{ left: `${(active.x / WIDTH) * 100}%`, top: `${(active.y / HEIGHT) * 100}%`, marginTop: -56 }}
          data-testid="account-timeline-tooltip"
        >
          <div className="font-medium">{periodLabel(active.period, unit, true)}</div>
          <div className="text-muted-foreground">
            {active.count} account{active.count === 1 ? "" : "s"}
          </div>
        </div>
      )}
      <p className="sr-only">Peak of {maxCount} accounts in a single point.</p>
    </div>
  );
}

export default function AccountCreationTimelinePage() {
  const { data, isLoading, error } = useQuery<{ month: string; count: number }[]>({
    queryKey: ["/api/social-accounts/joined-histogram"],
  });
  const [granularity, setGranularity] = useState<Granularity>("all");

  const months = useMemo(() => fillMonths((data ?? []).map((b) => ({ period: b.month, count: b.count }))), [data]);
  const series = useMemo(
    () => (granularity === "year" ? toYears(months) : granularity === "month" ? toCalendarMonths(months) : months),
    [months, granularity],
  );
  const total = useMemo(() => (data ?? []).reduce((sum, b) => sum + b.count, 0), [data]);

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <Link href="/demos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Demos
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <TrendingUp className="h-7 w-7" />
          Account Creation Timeline
        </h1>
        <p className="text-muted-foreground text-lg">
          When the social accounts you track were created, oldest on the left to youngest on the right.{" "}
          {granularity === "month"
            ? "Each point is a calendar month summed across every year, to show seasonality."
            : `Higher means more accounts were created in that ${granularity === "year" ? "year" : "month"}.`}{" "}
          Hover a point for exact numbers.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>
              {granularity === "all" ? "Accounts created per month, all time" : granularity === "year" ? "Accounts created per year" : "Accounts created by calendar month"}
            </CardTitle>
            <CardDescription>
              {isLoading
                ? "Loading…"
                : `${total} account${total === 1 ? "" : "s"} with a known creation date` +
                  (months.length ? `, ${periodLabel(months[0].period, "all")} – ${periodLabel(months[months.length - 1].period, "all")}` : "")}
            </CardDescription>
          </div>
          <Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <TabsList>
              <TabsTrigger value="all" data-testid="granularity-all">All time</TabsTrigger>
              <TabsTrigger value="year" data-testid="granularity-year">Year</TabsTrigger>
              <TabsTrigger value="month" data-testid="granularity-month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load account creation dates.</p>
          ) : series.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No accounts have a known creation date yet. Dates are filled in when Instagram tracking
              reads an account's About info.
            </p>
          ) : (
            <TimelineChart data={series} unit={granularity} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
