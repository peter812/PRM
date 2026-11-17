/**
 * Stats section (client/src/pages/stats-layout.tsx): read-only aggregate counts.
 * Response shapes live in shared/stats.ts.
 */
import type { Express, Request, Response } from "express";
import { sql, type SQL } from "drizzle-orm";
import type { StatsOverview, PeopleStats, MessagesStats, GroupsFacesStats, SummariesStats, MonthCount, LabelCount, TopContact, LargestGroup, TopStoryAccount } from "@shared/stats";
import { db } from "../db";
import { requireAuth } from "../auth";
import { storage } from "../storage";

const rows = async <T>(query: SQL) => (await db.execute(query)).rows as T[];
const one = async <T>(query: SQL) => (await rows<T>(query))[0];

/** Wraps a stats handler with the shared auth check and error response. */
function statsRoute(app: Express, path: string, name: string, load: (req: Request) => Promise<unknown>) {
  app.get(path, requireAuth, async (req: Request, res: Response) => {
    try {
      res.json(await load(req));
    } catch (error) {
      console.error(`Error fetching ${name} stats:`, error);
      res.status(500).json({ error: `Failed to fetch ${name} stats` });
    }
  });
}

export function registerRoutes(app: Express) {
  // GET /api/stats/overview — headline totals for the Stats overview page
  statsRoute(app, "/api/stats/overview", "overview", () => one<StatsOverview>(sql`
    select
      (select count(*)::int from people) as "people",
      (select count(*)::int from groups) as "groups",
      (select count(*)::int from social_accounts) as "socialAccounts",
      (select count(*)::int from photos where not is_sub_image) as "photos",
      (select count(*)::int from faces) as "faces",
      (select count(*)::int from messages) as "messages",
      (select count(*)::int from daily_notes) as "dailyNotes"
  `));

  // GET /api/stats/people — breakdowns and data completeness, bulk-imported people left out
  statsRoute(app, "/api/stats/people", "people", async (): Promise<PeopleStats> => {
    const [counts, bySex, relationshipTypes, addedPerMonth] = await Promise.all([
      one<Omit<PeopleStats, "bySex" | "relationshipTypes" | "addedPerMonth" | "completeness"> & PeopleStats["completeness"]>(sql`
        select
          count(*)::int as "total",
          (select count(*)::int from people where is_low_value = 1) as "lowValue",
          count(*) filter (where p.is_starred = 1)::int as "starred",
          count(*) filter (where coalesce(p.image_url, '') <> '')::int as "photo",
          count(*) filter (where coalesce(p.birthday, '') <> '')::int as "birthday",
          count(*) filter (where exists (select 1 from person_addresses a where a.person_id = p.id))::int as "address",
          count(*) filter (where coalesce(cardinality(p.social_account_uuids), 0) > 0)::int as "socialAccount",
          count(*) filter (where coalesce(p.email, '') <> '' or coalesce(jsonb_array_length(p.additional_emails), 0) > 0)::int as "email",
          count(*) filter (where coalesce(p.phone, '') <> '' or coalesce(jsonb_array_length(p.additional_phones), 0) > 0)::int as "phone",
          count(*) filter (where exists (select 1 from relationships r where r.from_person_id = p.id or r.to_person_id = p.id))::int as "relationship",
          count(*) filter (where exists (select 1 from notes n where n.person_id = p.id))::int as "note",
          count(*) filter (where exists (select 1 from groups g where p.id = any(g.members)))::int as "group",
          count(*) filter (where p.personface_uuid is not null)::int as "faceGroup"
        from people p
        where p.is_low_value = 0
      `),
      rows<LabelCount>(sql`
        select sex as "label", count(*)::int as "count"
        from people where is_low_value = 0
        group by sex order by count(*) desc
      `),
      rows<LabelCount>(sql`
        select coalesce(t.name, 'No type') as "label", t.color as "color", count(*)::int as "count"
        from relationships r left join relationship_types t on t.id = r.type_id
        group by t.name, t.color order by count(*) desc
      `),
      rows<MonthCount>(sql`
        select to_char(created_at, 'YYYY-MM') as "month", count(*)::int as "count"
        from people where is_low_value = 0
        group by 1 order by 1
      `),
    ]);
    const { total, lowValue, starred, ...completeness } = counts;
    return { total, lowValue, starred, bySex, relationshipTypes, addedPerMonth, completeness };
  });

  // GET /api/stats/messages — message volume, channels, top contacts, notes
  statsRoute(app, "/api/stats/messages", "messages", async (): Promise<MessagesStats> => {
    const mePersonId = (await storage.getMePersonId()) ?? "";
    const [counts, messagesPerMonth, byChannel, topContacts, dailyNotesPerMonth] = await Promise.all([
      one<Pick<MessagesStats, "messages" | "conversations" | "personNotes" | "groupNotes" | "dailyNotes" | "unfinishedDailyNotes">>(sql`
        select
          (select count(*)::int from messages) as "messages",
          (select count(*)::int from conversations) as "conversations",
          (select count(*)::int from notes) as "personNotes",
          (select count(*)::int from group_notes) as "groupNotes",
          (select count(*)::int from daily_notes where status = 'finished') as "dailyNotes",
          (select count(*)::int from daily_notes where status <> 'finished') as "unfinishedDailyNotes"
      `),
      rows<MonthCount>(sql`
        select to_char(coalesce(sent_at, created_at), 'YYYY-MM') as "month", count(*)::int as "count"
        from messages group by 1 order by 1
      `),
      rows<LabelCount>(sql`
        select c.channel_type as "label", count(m.id)::int as "count"
        from conversations c left join messages m on m.conversation_id = c.id
        group by c.channel_type order by count(m.id) desc
      `),
      // Messages the person sent anywhere, plus both sides of their one-on-one conversations.
      // (Counting every message of a group chat would credit all its members equally.)
      rows<TopContact>(sql`
        with one_on_one as (
          select conversation_id from conversation_participants
          where person_id is not null and person_id <> ${mePersonId}
          group by conversation_id having count(distinct person_id) = 1
        ),
        exchanged as (
          select sender_person_id as person_id, id as message_id from messages where sender_person_id is not null
          union
          select cp.person_id, m.id
          from one_on_one o
          join conversation_participants cp on cp.conversation_id = o.conversation_id and cp.person_id <> ${mePersonId}
          join messages m on m.conversation_id = o.conversation_id
        )
        select p.id as "personId", trim(p.first_name || ' ' || p.last_name) as "name", count(*)::int as "count"
        from exchanged e join people p on p.id = e.person_id
        where e.person_id <> ${mePersonId}
        group by p.id, p.first_name, p.last_name
        order by count(*) desc
        limit 10
      `),
      rows<MonthCount>(sql`
        select substring(date from 1 for 7) as "month", count(*)::int as "count"
        from daily_notes where status = 'finished' and date ~ '^[0-9]{4}-[0-9]{2}'
        group by 1 order by 1
      `),
    ]);
    return { ...counts, messagesPerMonth, byChannel, topContacts, dailyNotesPerMonth };
  });

  // GET /api/stats/groups-faces — group sizes and face recognition coverage
  statsRoute(app, "/api/stats/groups-faces", "groups & faces", async (): Promise<GroupsFacesStats> => {
    const [groupCounts, sizeBuckets, largestGroups, faces, photoCounts] = await Promise.all([
      one<Pick<GroupsFacesStats, "groups" | "subGroups" | "peopleInGroups">>(sql`
        select
          (select count(*)::int from groups) as "groups",
          (select count(*)::int from sub_groups) as "subGroups",
          (select count(distinct m)::int from groups, unnest(members) as m) as "peopleInGroups"
      `),
      rows<LabelCount & { sort: number }>(sql`
        select bucket as "label", count(*)::int as "count", min(sort)::int as "sort"
        from (
          select case
            when n = 0 then 'Empty' when n <= 5 then '1–5' when n <= 20 then '6–20'
            when n <= 50 then '21–50' when n <= 200 then '51–200' else '200+' end as bucket,
            n as sort
          from (select coalesce(cardinality(members), 0) as n from groups) g
        ) b
        group by bucket order by min(sort)
      `),
      rows<LargestGroup>(sql`
        select id, name, color, coalesce(cardinality(members), 0)::int as "members"
        from groups order by 4 desc, name limit 10
      `),
      one<GroupsFacesStats["faces"]>(sql`
        with named as (select distinct personface_uuid from people where personface_uuid is not null)
        select
          count(*)::int as "total",
          count(*) filter (where f.personface_uuid in (select personface_uuid from named))::int as "linkedToPerson",
          count(*) filter (where f.personface_uuid is not null and f.personface_uuid not in (select personface_uuid from named))::int as "groupedUnnamed",
          count(*) filter (where f.personface_uuid is null and f.dismissed_at is null)::int as "awaitingReview",
          count(*) filter (where f.personface_uuid is null and f.dismissed_at is not null)::int as "dismissed",
          count(*) filter (where f.auto_match_score is not null)::int as "autoMatchedUnconfirmed"
        from faces f
      `),
      one<Pick<GroupsFacesStats, "photos" | "photosWithFaces">>(sql`
        select
          (select count(*)::int from photos) as "photos",
          (select count(distinct photo_id)::int from faces where photo_id is not null) as "photosWithFaces"
      `),
    ]);
    return {
      ...groupCounts,
      sizeBuckets: sizeBuckets.map(({ label, count }) => ({ label, count })),
      largestGroups,
      faces,
      ...photoCounts,
    };
  });

  // GET /api/stats/summaries — AI summary coverage and collected stories
  statsRoute(app, "/api/stats/summaries", "summaries", async (): Promise<SummariesStats> => {
    const [counts, byPostType, jobsByStatus, models, summariesPerMonth, storiesPerMonth, topStoryAccounts] = await Promise.all([
      one<Omit<SummariesStats, "byPostType" | "jobsByStatus" | "models" | "summariesPerMonth" | "storiesPerMonth" | "topStoryAccounts">>(sql`
        select
          count(*) filter (where post_type <> 'story')::int as "posts",
          count(*) filter (where post_type <> 'story' and ai_summary is not null)::int as "postsSummarized",
          count(*) filter (where post_type = 'story')::int as "stories",
          count(*) filter (where post_type = 'story' and ai_summary is not null)::int as "storiesSummarized",
          (select count(*)::int from social_accounts a where exists (select 1 from social_account_posts x where x.social_account_id = a.id)) as "accounts",
          (select count(*)::int from social_accounts a where a.ai_summary is not null
            and exists (select 1 from social_account_posts x where x.social_account_id = a.id)) as "accountsSummarized",
          (select count(*)::int from social_accounts a where a.ai_summary is not null and a.ai_summary_invalidated) as "accountsSummaryOutdated"
        from social_account_posts
      `),
      rows<LabelCount>(sql`
        select post_type as "label", count(*)::int as "count"
        from social_account_posts group by post_type order by count(*) desc
      `),
      rows<LabelCount>(sql`
        select status as "label", count(*)::int as "count"
        from summary_jobs group by status order by count(*) desc
      `),
      rows<LabelCount>(sql`
        select model as "label", count(*)::int as "count" from (
          select ai_summary_model as model from social_account_posts where ai_summary is not null
          union all
          select ai_summary_model from social_accounts where ai_summary is not null
        ) m
        group by model order by count(*) desc limit 10
      `),
      rows<MonthCount>(sql`
        select to_char(at, 'YYYY-MM') as "month", count(*)::int as "count" from (
          select ai_summary_at as at from social_account_posts where ai_summary_at is not null
          union all
          select ai_summary_generated_at from social_accounts where ai_summary_generated_at is not null
        ) s
        group by 1 order by 1
      `),
      rows<MonthCount>(sql`
        select to_char(coalesce(posted_at, created_at), 'YYYY-MM') as "month", count(*)::int as "count"
        from social_account_posts where post_type = 'story'
        group by 1 order by 1
      `),
      rows<TopStoryAccount>(sql`
        select a.id, a.username, count(*)::int as "count"
        from social_account_posts p join social_accounts a on a.id = p.social_account_id
        where p.post_type = 'story'
        group by a.id, a.username order by count(*) desc limit 10
      `),
    ]);
    return {
      ...counts,
      byPostType,
      jobsByStatus,
      models: models.map((m) => ({ ...m, label: m.label || "Unknown model" })),
      summariesPerMonth,
      storiesPerMonth,
      topStoryAccounts,
    };
  });
}
