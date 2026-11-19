import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { InstagramRun } from "@shared/stats";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsPage, StatSection } from "@/components/stats/stats-ui";
import { cn } from "@/lib/utils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Story runs and account (tracking) runs per day, in a month calendar. */
export default function StatsInstagramRunsPage() {
  const now = new Date();
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const isCurrent = month.year === now.getFullYear() && month.month === now.getMonth();

  const from = new Date(month.year, month.month, 1);
  const to = new Date(month.year, month.month + 1, 1);
  const { data, isLoading, isError } = useQuery<InstagramRun[]>({
    queryKey: ["/api/stats/instagram-runs", from.toISOString()],
    queryFn: async () => (await apiRequest("GET", `/api/stats/instagram-runs?from=${from.toISOString()}&to=${to.toISOString()}`)).json(),
  });

  const counts = useMemo(() => {
    const byDay = new Map<string, { accounts: number; stories: number }>();
    for (const run of data ?? []) {
      const key = dayKey(new Date(run.startedAt));
      const c = byDay.get(key) ?? { accounts: 0, stories: 0 };
      if (run.kind === "stories") c.stories++;
      else c.accounts++;
      byDay.set(key, c);
    }
    return byDay;
  }, [data]);

  const shift = (by: number) => setMonth(({ year, month }) => {
    const d = new Date(year, month + by, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(from.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 5 + i);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <StatsPage title="Instagram Runs" subtitle="How many account runs and story runs ran each day. Days with no story run are red." isError={isError}>
      <div className="flex flex-wrap items-center gap-2" data-testid="instagram-runs-month-picker">
        <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month" data-testid="button-prev-month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Select value={String(month.month)} onValueChange={(v) => setMonth((m) => ({ ...m, month: Number(v) }))}>
          <SelectTrigger className="w-36" data-testid="select-month"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, i) => <SelectItem key={name} value={String(i)}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(month.year)} onValueChange={(v) => setMonth((m) => ({ ...m, year: Number(v) }))}>
          <SelectTrigger className="w-24" data-testid="select-year"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next month" data-testid="button-next-month">
          <ChevronRight className="h-4 w-4" />
        </Button>
        {!isCurrent && (
          <Button variant="ghost" onClick={() => setMonth({ year: now.getFullYear(), month: now.getMonth() })} data-testid="button-current-month">
            Back to current month
          </Button>
        )}
      </div>

      <StatSection title={`${MONTHS[month.month]} ${month.year}`} description="A = account runs, S = story runs." loading={isLoading} testId="instagram-runs-calendar">
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {WEEKDAYS.map((d) => <div key={d} className="text-xs font-medium text-muted-foreground text-center">{d}</div>)}
          {cells.map((day, i) => {
            if (day === null) return <div key={`blank-${i}`} />;
            const date = new Date(month.year, month.month, day);
            const c = counts.get(dayKey(date)) ?? { accounts: 0, stories: 0 };
            // Future days, and today until its story run happens, aren't judged yet.
            const judged = date < today || c.stories > 0;
            return (
              <div
                key={day}
                className={cn(
                  "rounded-md border p-1.5 sm:p-2 min-h-16 flex flex-col gap-1",
                  judged && (c.stories > 0
                    ? "bg-green-100 border-green-300 dark:bg-green-950 dark:border-green-800"
                    : "bg-red-100 border-red-300 dark:bg-red-950 dark:border-red-800"),
                  date.getTime() === today.getTime() && "ring-2 ring-primary",
                )}
                data-testid={`calendar-day-${day}`}
              >
                <span className="text-xs font-semibold">{day}</span>
                <span className="text-xs tabular-nums" title="Account runs">A {c.accounts}</span>
                <span className="text-xs tabular-nums" title="Story runs">S {c.stories}</span>
              </div>
            );
          })}
        </div>
      </StatSection>
    </StatsPage>
  );
}
