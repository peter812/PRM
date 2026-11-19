/** Response shapes for the Stats section endpoints (server/routes/stats.ts). */

export type MonthCount = { month: string; count: number }; // month = "YYYY-MM"
export type LabelCount = { label: string; count: number; color?: string | null };

export type StatsOverview = {
  people: number;
  groups: number;
  socialAccounts: number;
  photos: number;
  faces: number;
  messages: number;
  dailyNotes: number;
};

export type PeopleStats = {
  total: number; // excludes bulk-imported (low-value) people
  lowValue: number;
  starred: number;
  bySex: LabelCount[];
  relationshipTypes: LabelCount[];
  addedPerMonth: MonthCount[];
  completeness: {
    photo: number;
    birthday: number;
    address: number;
    socialAccount: number;
    email: number;
    phone: number;
    relationship: number;
    note: number;
    group: number;
    faceGroup: number;
  };
};

export type TopContact = { personId: string; name: string; count: number };

export type MessagesStats = {
  messages: number;
  conversations: number;
  personNotes: number;
  groupNotes: number;
  dailyNotes: number;
  unfinishedDailyNotes: number;
  messagesPerMonth: MonthCount[];
  byChannel: LabelCount[];
  topContacts: TopContact[];
  dailyNotesPerMonth: MonthCount[];
};

export type TopStoryAccount = { id: string; username: string; count: number };

export type SummariesStats = {
  posts: number; // everything but stories (posts, reels, …)
  postsSummarized: number;
  stories: number;
  storiesSummarized: number;
  accounts: number; // accounts with at least one collected post or story
  accountsSummarized: number;
  accountsSummaryOutdated: number;
  byPostType: LabelCount[];
  jobsByStatus: LabelCount[];
  models: LabelCount[];
  summariesPerMonth: MonthCount[];
  storiesPerMonth: MonthCount[];
  topStoryAccounts: TopStoryAccount[];
};

export type LargestGroup = { id: string; name: string; color: string; members: number };

export type GroupsFacesStats = {
  groups: number;
  subGroups: number;
  peopleInGroups: number;
  sizeBuckets: LabelCount[];
  largestGroups: LargestGroup[];
  faces: {
    total: number;
    linkedToPerson: number;
    groupedUnnamed: number;
    awaitingReview: number;
    dismissed: number;
    autoMatchedUnconfirmed: number;
  };
  photos: number;
  photosWithFaces: number;
};

/** One Instagram run that reached Instagram; the client buckets them by local day. */
export type InstagramRun = { kind: "stories" | "tracking"; startedAt: string };
