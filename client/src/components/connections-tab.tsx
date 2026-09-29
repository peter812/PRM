import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getInitials } from "@/lib/utils";
import { withImageSize } from "@shared/image-size";
import {
  CONNECTION_KINDS,
  scoreAt,
  type ConnectionEvent,
  type ConnectionKind,
  type ConnectionWeights,
} from "@shared/connection-strength";

// Who this account interacts with, strongest first (connection-strength-plan.md §6).

type Connection = {
  account: { id: string; username: string; nickname: string | null; imageUrl: string | null };
  score: number;
  in: number;
  out: number;
  byKind: Record<ConnectionKind, number>;
  lastInteractionAt: string;
  events: ConnectionEvent[];
};
type ConnectionsResponse = { since: string; weights: ConnectionWeights; connections: Connection[] };

const KIND_LABEL: Record<ConnectionKind, { icon: string; name: string }> = {
  comment: { icon: "💬", name: "Comments" },
  story_mention: { icon: "📖", name: "Story mentions" },
  post_mention: { icon: "🏷️", name: "Post mentions and faces" },
  bio: { icon: "🔗", name: "Bio mentions" },
};

const DAY_MS = 86_400_000;
const MAX_SAMPLES = 120;
const GRAPH_W = 180;
const GRAPH_H = 36;

/** Sample times from `since` to now: monthly, or coarser so a row never draws more than MAX_SAMPLES points. */
function sampleTimes(since: number, now: number): number[] {
  const step = Math.max(30 * DAY_MS, (now - since) / MAX_SAMPLES);
  const out: number[] = [];
  for (let t = since; t < now; t += step) out.push(t);
  out.push(now);
  return out;
}

function Sparkline({ values, max }: { values: number[]; max: number }) {
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n === 1 ? GRAPH_W : (i / (n - 1)) * GRAPH_W;
    const y = GRAPH_H - (max > 0 ? (v / max) * (GRAPH_H - 2) : 0);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={GRAPH_W} height={GRAPH_H} viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} className="text-primary shrink-0" aria-hidden>
      <line x1={0} y1={GRAPH_H - 0.5} x2={GRAPH_W} y2={GRAPH_H - 0.5} className="stroke-border" strokeWidth={1} />
      <polygon points={`0,${GRAPH_H} ${pts.join(" ")} ${GRAPH_W},${GRAPH_H}`} fill="currentColor" fillOpacity={0.15} />
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));

export function ConnectionsTab({ socialAccountId }: { socialAccountId: string }) {
  const { data, isLoading, error } = useQuery<ConnectionsResponse>({
    queryKey: ["/api/social-accounts", socialAccountId, "connections"],
  });
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"score" | "recent">("score");

  // Every row's running strength on one time axis and one height scale, so a taller graph is a stronger connection.
  const graphs = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const times = sampleTimes(Date.parse(data.since), now);
    const series = new Map(data.connections.map((c) => [c.account.id, times.map((t) => scoreAt(c.events, data.weights, t))]));
    let max = 0;
    for (const values of series.values()) for (const v of values) max = Math.max(max, v);
    return { series, max };
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase().replace(/^@/, "");
    const matched = q
      ? data.connections.filter((c) => c.account.username.toLowerCase().includes(q) || c.account.nickname?.toLowerCase().includes(q))
      : data.connections;
    return sort === "recent" ? [...matched].sort((a, b) => b.lastInteractionAt.localeCompare(a.lastInteractionAt)) : matched;
  }, [data, filter, sort]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Scoring connections…
      </div>
    );
  }
  if (error || !data) {
    return <p className="p-6 text-sm text-destructive">Couldn't load connections.</p>;
  }
  if (!data.connections.length) {
    return (
      <p className="p-6 text-sm text-muted-foreground" data-testid="text-connections-empty">
        No interactions found yet. Comments, story and post mentions, faces in photos and bio mentions show up here once they've been imported.
      </p>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter accounts…"
          className="max-w-xs h-8"
          data-testid="input-connections-filter"
        />
        <Select value={sort} onValueChange={(v) => setSort(v as "score" | "recent")}>
          <SelectTrigger className="w-44 h-8" data-testid="select-connections-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Strongest first</SelectItem>
            <SelectItem value="recent">Most recent first</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} of {data.connections.length} · graphs run {new Date(data.since).toLocaleDateString()} → today
        </span>
      </div>

      <div className="divide-y rounded-md border">
        {rows.map((c) => (
          <Link key={c.account.id} href={`/social-accounts/${c.account.id}?tab=connections`}>
            <a className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50" data-testid={`connection-${c.account.id}`}>
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarImage src={withImageSize(c.account.imageUrl, 64)} />
                <AvatarFallback>{getInitials(c.account.nickname || c.account.username)}</AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-medium truncate">@{c.account.username}</span>
                  {c.account.nickname && <span className="text-xs text-muted-foreground truncate">{c.account.nickname}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {CONNECTION_KINDS.filter((k) => c.byKind[k] > 0).map((k) => {
                    const count = c.events.filter((e) => e.kind === k).length;
                    const hearted = k === "bio" && c.events.some((e) => e.kind === "bio" && e.heart);
                    return (
                      <Tooltip key={k}>
                        <TooltipTrigger asChild>
                          <span>
                            {KIND_LABEL[k].icon} {count}
                            {hearted && " ❤️"}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {KIND_LABEL[k].name}: {count} worth {fmt(c.byKind[k])}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                  <span>last {new Date(c.lastInteractionAt).toLocaleDateString()}</span>
                </div>
              </div>

              {graphs && <Sparkline values={graphs.series.get(c.account.id)!} max={graphs.max} />}

              <div className="w-20 shrink-0 text-right">
                <div className="font-semibold tabular-nums" data-testid={`connection-score-${c.account.id}`}>{fmt(c.score)}</div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex justify-end gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                      <span className="flex items-center"><ArrowUpRight className="h-3 w-3" />{fmt(c.out)}</span>
                      <span className="flex items-center"><ArrowDownLeft className="h-3 w-3" />{fmt(c.in)}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Out: what this account did toward @{c.account.username}. In: what they did back.</TooltipContent>
                </Tooltip>
              </div>
            </a>
          </Link>
        ))}
      </div>
    </div>
  );
}
