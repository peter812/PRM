import { Route, Switch } from "wouter";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

const StatsOverviewPage = lazy(() => import("@/pages/stats/overview"));
const StatsPeoplePage = lazy(() => import("@/pages/stats/people"));
const StatsMessagesPage = lazy(() => import("@/pages/stats/messages"));
const StatsGroupsFacesPage = lazy(() => import("@/pages/stats/groups-faces"));
const StatsSummariesPage = lazy(() => import("@/pages/stats/summaries"));
const StatsInstagramRunsPage = lazy(() => import("@/pages/stats/instagram-runs"));
const NotFound = lazy(() => import("@/pages/not-found"));

export default function StatsLayout() {
  return (
    <div className="relative flex-1 overflow-auto h-full">
      <Suspense fallback={
        <div className="flex items-center justify-center h-full w-full">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }>
        <Switch>
          <Route path="/" component={StatsOverviewPage} />
          <Route path="/people" component={StatsPeoplePage} />
          <Route path="/messages" component={StatsMessagesPage} />
          <Route path="/groups-faces" component={StatsGroupsFacesPage} />
          <Route path="/summaries" component={StatsSummariesPage} />
          <Route path="/instagram-runs" component={StatsInstagramRunsPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </div>
  );
}
