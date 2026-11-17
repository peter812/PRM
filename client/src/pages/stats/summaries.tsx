import { useQuery } from "@tanstack/react-query";
import { FileText, CircleDashed, AtSign, Sparkles } from "lucide-react";
import type { SummariesStats } from "@shared/stats";
import { StatTile } from "@/components/stats/stat-tile";
import { StatsPage, StatSection, BarList, CompletenessList, MonthChart, TILE_GRID } from "@/components/stats/stats-ui";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function StatsSummariesPage() {
  const { data, isLoading, isError } = useQuery<SummariesStats>({ queryKey: ["/api/stats/summaries"] });
  const summarized = data && data.postsSummarized + data.storiesSummarized + data.accountsSummarized;

  return (
    <StatsPage title="Summaries & Stories" subtitle="Collected posts and stories, and how many have an AI summary." isError={isError}>
      <div className={TILE_GRID}>
        <StatTile testId="posts" label="Posts" icon={FileText} value={data?.posts} />
        <StatTile testId="stories" label="Stories" icon={CircleDashed} value={data?.stories} />
        <StatTile testId="accounts-with-posts" label="Accounts" icon={AtSign} value={data?.accounts} />
        <StatTile testId="summaries" label="AI summaries" icon={Sparkles} value={summarized} href="~/social-accounts/summaries" />
      </div>

      <StatSection title="Summary coverage" description="How much of what's collected has an AI summary." loading={isLoading} testId="summary-coverage">
        {data && (
          <CompletenessList
            testId="summaries"
            items={[
              { label: "Posts summarized", count: data.postsSummarized, total: data.posts },
              { label: "Stories summarized", count: data.storiesSummarized, total: data.stories },
              { label: "Accounts summarized", count: data.accountsSummarized, total: data.accounts },
              { label: "Account summaries out of date", count: data.accountsSummaryOutdated, total: data.accounts },
            ]}
          />
        )}
      </StatSection>

      <MonthChart title="Summaries written" seriesLabel="Summaries" months={data?.summariesPerMonth} loading={isLoading} testId="summaries-per-month" />

      <div className="grid gap-6 md:grid-cols-2">
        <StatSection title="Most stories" description="Accounts with the most collected stories." loading={isLoading} testId="top-story-accounts">
          {data && (
            <BarList
              testId="top-story-accounts"
              items={data.topStoryAccounts.map((a) => ({ label: `@${a.username}`, count: a.count }))}
              href={(_, i) => `~/social-accounts/${data.topStoryAccounts[i].id}`}
              emptyText="No stories collected yet."
            />
          )}
        </StatSection>
        <StatSection title="By post type" loading={isLoading} testId="by-post-type">
          {data && <BarList testId="by-post-type" items={data.byPostType.map((t) => ({ ...t, label: capitalize(t.label) }))} emptyText="No posts collected yet." />}
        </StatSection>
        <StatSection title="Summary jobs" description="Every queued summary, by status." loading={isLoading} testId="summary-jobs">
          {data && <BarList testId="summary-jobs" items={data.jobsByStatus.map((j) => ({ ...j, label: capitalize(j.label) }))} emptyText="No summary jobs yet." />}
        </StatSection>
        <StatSection title="Models used" loading={isLoading} testId="summary-models">
          {data && <BarList testId="summary-models" items={data.models} emptyText="No summaries yet." />}
        </StatSection>
      </div>

      <MonthChart title="Stories collected" description="By the date each story was posted." seriesLabel="Stories" months={data?.storiesPerMonth} loading={isLoading} testId="stories-per-month" />
    </StatsPage>
  );
}
