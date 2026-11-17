import { useMemo, useRef, useState } from "react";

// Shared by the Stats pages and SocialAccountStatsDialog.
// `period` is "YYYY-MM" for all time, "YYYY" for year, or "MM" for calendar month (Jan…Dec across every year).
export type Bucket = { period: string; count: number };
export type Granularity = "all" | "year" | "month";
export type Series = { label: string; color: string; values: (number | null)[] };

const WIDTH = 900;
const HEIGHT = 340;
const PAD = { top: 20, right: 24, bottom: 44, left: 56 };

export const periodLabel = (period: string, unit: Granularity, long = false) => {
  const month = long ? "long" : "short";
  if (unit === "year") return period;
  if (unit === "month") return new Date(2000, Number(period) - 1, 1).toLocaleDateString(undefined, { month });
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: "numeric", month });
};

// Fill in months with no accounts so the x axis is continuous in time.
export function fillMonths(buckets: Bucket[]): Bucket[] {
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
export function toYears(buckets: Bucket[]): Bucket[] {
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
export function toCalendarMonths(buckets: Bucket[]): Bucket[] {
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
export function TimelineChart({ periods, series, label, zeroBased, testId = "timeline-chart" }: {
  periods: string[];
  series: Series[];
  label: (period: string, long?: boolean) => string;
  zeroBased: boolean;
  testId?: string;
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
    // The last period gets a label only when the previous labelled tick isn't right next to it.
    const last = periods.length - 1;
    const xTicks = periods
      .map((p, i) => ({ p, x: xs[i], i }))
      .filter(({ i }) => i % every === 0 ? i === last || last - i >= every / 2 : i === last);
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
        data-testid={testId}
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
          data-testid={`${testId}-tooltip`}
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
