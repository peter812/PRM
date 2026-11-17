import { useQuery } from "@tanstack/react-query";
import { Users2, Layers, Users, ScanFace, ImageIcon, HelpCircle } from "lucide-react";
import type { GroupsFacesStats } from "@shared/stats";
import { StatTile } from "@/components/stats/stat-tile";
import { StatsPage, StatSection, BarList, CompletenessList, TILE_GRID } from "@/components/stats/stats-ui";

export default function StatsGroupsFacesPage() {
  const { data, isLoading, isError } = useQuery<GroupsFacesStats>({ queryKey: ["/api/stats/groups-faces"] });
  const faces = data?.faces;

  return (
    <StatsPage title="Groups & Faces" subtitle="Group sizes and how far face recognition has got." isError={isError}>
      <div className={TILE_GRID}>
        <StatTile testId="groups" label="Groups" icon={Users2} value={data?.groups} href="~/groups" />
        <StatTile testId="sub-groups" label="Subgroups" icon={Layers} value={data?.subGroups} />
        <StatTile testId="people-in-groups" label="Grouped people" icon={Users} value={data?.peopleInGroups} />
        <StatTile testId="faces" label="Faces" icon={ScanFace} value={faces?.total} href="~/faces" />
        <StatTile testId="photos-with-faces" label="Face photos" icon={ImageIcon} value={data?.photosWithFaces} />
        <StatTile testId="faces-awaiting-review" label="To review" icon={HelpCircle} value={faces?.awaitingReview} href="~/face-review" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <StatSection title="Largest groups" loading={isLoading} testId="largest-groups">
          {data && (
            <BarList
              testId="largest-groups"
              items={data.largestGroups.map((g) => ({ label: g.name, count: g.members, color: g.color }))}
              href={(_, i) => `~/group/${data.largestGroups[i].id}`}
              emptyText="No groups yet."
            />
          )}
        </StatSection>
        <StatSection title="Group sizes" description="Number of groups by member count." loading={isLoading} testId="group-sizes">
          {data && <BarList testId="group-sizes" items={data.sizeBuckets} emptyText="No groups yet." />}
        </StatSection>
      </div>

      <StatSection title="Face recognition" description="Where every detected face stands." loading={isLoading} testId="face-status">
        {faces && (
          <CompletenessList
            testId="faces"
            total={faces.total}
            items={[
              { label: "Linked to a person", count: faces.linkedToPerson },
              { label: "Grouped, not named yet", count: faces.groupedUnnamed },
              { label: "Awaiting review", count: faces.awaitingReview },
              { label: "Dismissed", count: faces.dismissed },
              { label: "Auto-matched, not confirmed", count: faces.autoMatchedUnconfirmed },
            ]}
          />
        )}
      </StatSection>
    </StatsPage>
  );
}
