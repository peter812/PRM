import { useQuery } from "@tanstack/react-query";
import { MessagesSquare, MessageCircle, StickyNote, Users2, BookOpen, PenLine } from "lucide-react";
import type { MessagesStats } from "@shared/stats";
import { StatTile } from "@/components/stats/stat-tile";
import { StatsPage, StatSection, BarList, MonthChart, TILE_GRID } from "@/components/stats/stats-ui";

const CHANNEL_LABELS: Record<string, string> = { phone: "Text messages" };

export default function StatsMessagesPage() {
  const { data, isLoading, isError } = useQuery<MessagesStats>({ queryKey: ["/api/stats/messages"] });

  return (
    <StatsPage title="Messages & Notes" subtitle="Imported conversations and the notes you've written." isError={isError}>
      <div className={TILE_GRID}>
        <StatTile testId="messages" label="Messages" icon={MessagesSquare} value={data?.messages} />
        <StatTile testId="conversations" label="Conversations" icon={MessageCircle} value={data?.conversations} />
        <StatTile testId="person-notes" label="Person notes" icon={StickyNote} value={data?.personNotes} />
        <StatTile testId="group-notes" label="Group notes" icon={Users2} value={data?.groupNotes} />
        <StatTile testId="daily-notes" label="Daily notes" icon={BookOpen} value={data?.dailyNotes} href="~/daily-notes" />
        <StatTile testId="unfinished-daily-notes" label="Daily note drafts" icon={PenLine} value={data?.unfinishedDailyNotes} />
      </div>

      <MonthChart title="Messages over time" seriesLabel="Messages" months={data?.messagesPerMonth} loading={isLoading} testId="messages-per-month" />

      <div className="grid gap-6 md:grid-cols-2">
        <StatSection title="Top contacts" description="Messages they sent, plus both sides of one-on-one chats." loading={isLoading} testId="top-contacts">
          {data && (
            <BarList
              testId="top-contacts"
              items={data.topContacts.map((c) => ({ label: c.name || "Unnamed", count: c.count }))}
              href={(_, i) => `~/person/${data.topContacts[i].personId}`}
              emptyText="No messages linked to people yet."
            />
          )}
        </StatSection>
        <StatSection title="By channel" loading={isLoading} testId="by-channel">
          {data && (
            <BarList
              testId="by-channel"
              items={data.byChannel.map((c) => ({ ...c, label: CHANNEL_LABELS[c.label] ?? c.label }))}
              emptyText="No conversations yet."
            />
          )}
        </StatSection>
      </div>

      <MonthChart title="Daily notes written" seriesLabel="Daily notes" months={data?.dailyNotesPerMonth} loading={isLoading} testId="daily-notes-per-month" />
    </StatsPage>
  );
}
