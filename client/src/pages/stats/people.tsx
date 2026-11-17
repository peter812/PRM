import { useQuery } from "@tanstack/react-query";
import { Users, Star, Archive } from "lucide-react";
import type { PeopleStats } from "@shared/stats";
import { StatTile } from "@/components/stats/stat-tile";
import { StatsPage, StatSection, BarList, CompletenessList, MonthChart, TILE_GRID } from "@/components/stats/stats-ui";

const COMPLETENESS: { key: keyof PeopleStats["completeness"]; label: string }[] = [
  { key: "photo", label: "Profile photo" },
  { key: "faceGroup", label: "Linked face group" },
  { key: "socialAccount", label: "Linked social account" },
  { key: "group", label: "In a group" },
  { key: "relationship", label: "Has a relationship" },
  { key: "note", label: "Has a note" },
  { key: "address", label: "Has an address" },
  { key: "phone", label: "Phone number" },
  { key: "email", label: "Email" },
  { key: "birthday", label: "Birthday" },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function StatsPeoplePage() {
  const { data, isLoading, isError } = useQuery<PeopleStats>({ queryKey: ["/api/stats/people"] });

  return (
    <StatsPage title="People" subtitle="Who's in PRM and how complete their profiles are. Bulk-imported people are left out." isError={isError}>
      <div className={TILE_GRID}>
        <StatTile testId="people-total" label="People" icon={Users} value={data?.total} href="~/people" />
        <StatTile testId="people-starred" label="Starred" icon={Star} value={data?.starred} />
        <StatTile testId="people-low-value" label="Bulk-imported" icon={Archive} value={data?.lowValue} />
      </div>

      <StatSection title="Data completeness" description="How many people have each piece of information." loading={isLoading} testId="completeness">
        {data && (
          <CompletenessList
            testId="people"
            total={data.total}
            items={COMPLETENESS.map(({ key, label }) => ({ label, count: data.completeness[key] }))}
          />
        )}
      </StatSection>

      <div className="grid gap-6 md:grid-cols-2">
        <StatSection title="By sex" loading={isLoading} testId="by-sex">
          {data && <BarList testId="by-sex" items={data.bySex.map((s) => ({ ...s, label: capitalize(s.label) }))} />}
        </StatSection>
        <StatSection title="Relationships by type" loading={isLoading} testId="relationship-types">
          {data && <BarList testId="relationship-types" items={data.relationshipTypes} emptyText="No relationships yet." />}
        </StatSection>
      </div>

      <MonthChart title="People added" seriesLabel="People added" months={data?.addedPerMonth} loading={isLoading} testId="people-added" />
    </StatsPage>
  );
}
