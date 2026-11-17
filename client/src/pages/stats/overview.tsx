import { useQuery } from "@tanstack/react-query";
import { Users, Users2, AtSign, ImageIcon, ScanFace, MessagesSquare, BookOpen } from "lucide-react";
import type { StatsOverview } from "@shared/stats";
import { StatTile } from "@/components/stats/stat-tile";
import { StatsPage, TILE_GRID } from "@/components/stats/stats-ui";

export default function StatsOverviewPage() {
  const { data, isError } = useQuery<StatsOverview>({ queryKey: ["/api/stats/overview"] });

  const tiles = [
    { key: "people", label: "People", icon: Users, value: data?.people, href: "~/stats/people" },
    { key: "groups", label: "Groups", icon: Users2, value: data?.groups, href: "~/stats/groups-faces" },
    { key: "social-accounts", label: "Social accounts", icon: AtSign, value: data?.socialAccounts, href: "~/stats/summaries" },
    { key: "photos", label: "Photos", icon: ImageIcon, value: data?.photos },
    { key: "faces", label: "Faces", icon: ScanFace, value: data?.faces, href: "~/stats/groups-faces" },
    { key: "messages", label: "Messages", icon: MessagesSquare, value: data?.messages, href: "~/stats/messages" },
    { key: "daily-notes", label: "Daily notes", icon: BookOpen, value: data?.dailyNotes, href: "~/stats/messages" },
  ];

  return (
    <StatsPage title="Stats" subtitle="Totals across everything in PRM." isError={isError}>
      <div className={TILE_GRID}>
        {tiles.map((t) => (
          <StatTile key={t.key} testId={t.key} label={t.label} icon={t.icon} value={t.value} href={t.href} />
        ))}
      </div>
    </StatsPage>
  );
}
