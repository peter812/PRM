// Storage layer for People Management CRM using external PostgreSQL database
import {
  people,
  notes,
  interactions,
  interactionTypes,
  relationships,
  relationshipTypes,
  users,
  groups,
  groupNotes,
  apiKeys,
  ssoConfig,
  socialAccounts,
  socialAccountTypes,
  socialProfileVersions,
  socialNetworkState,
  socialNetworkChanges,
  socialAccountPosts,
  photos,
  imageTasks,
  dailyNotes,
  dailyNoteEvents,
  dailyNoteInvolvedParties,
  type DailyNote,
  type InsertDailyNote,
  type DailyNoteEvent,
  type InsertDailyNoteEvent,
  type DailyNoteInvolvedParty,
  type InsertDailyNoteInvolvedParty,
  type DailyNoteInvolvedPartyWithLabel,
  type DailyNoteWithDetails,
  type ImageTask,
  type InsertImageTask,
  type Person,
  type InsertPerson,
  type Note,
  type InsertNote,
  type Interaction,
  type InsertInteraction,
  type InteractionType,
  type InsertInteractionType,
  type Relationship,
  type InsertRelationship,
  type RelationshipType,
  type InsertRelationshipType,
  type PersonWithRelations,
  type RelationshipWithPerson,
  type User,
  type InsertUser,
  type Group,
  type InsertGroup,
  type GroupNote,
  type InsertGroupNote,
  type GroupWithNotes,
  type ApiKey,
  type InsertApiKey,
  type SsoConfig,
  type InsertSsoConfig,
  type SocialAccount,
  type InsertSocialAccount,
  type SocialAccountType,
  type InsertSocialAccountType,
  type SocialProfileVersion,
  type InsertSocialProfileVersion,
  type SocialNetworkState,
  type InsertSocialNetworkState,
  type SocialNetworkChange,
  type InsertSocialNetworkChange,
  type SocialAccountWithCurrentProfile,
  type SocialAccountPost,
  type InsertSocialAccountPost,
  tasks,
  type Task,
  type InsertTask,
  extensionSessions,
  type ExtensionSession,
  type InsertExtensionSession,
  extensionAuthCodes,
  type ExtensionAuthCode,
  type InsertExtensionAuthCode,
  type FlowItem,
  type FlowResponse,
  type MegaSearchResult,
  type SocialGraphSettings,
  type SocialGraphData,
  type SocialGraphNode,
  type SocialGraphLink,
  type PersonGraphData,
  type PersonGraphPerson,
  type Photo,
  type InsertPhoto,
  FAMILY_RELATIONSHIP_INVERSES,
  type FamilyRelationshipType,
} from "@shared/schema";
import { db, pool } from "./db";
import { eq, or, and, ilike, sql, inArray, arrayContains, desc, lt, isNotNull } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";

const PostgresSessionStore = connectPg(session);

// Simple TTL-based cache for static data
class TTLCache<T> {
  private cache: Map<string, { data: T; expiry: number }> = new Map();
  private ttlMs: number;

  constructor(ttlSeconds: number = 300) {
    this.ttlMs = ttlSeconds * 1000;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T): void {
    this.cache.set(key, { data, expiry: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Cache instances for static data (5 minute TTL)
const relationshipTypesCache = new TTLCache<RelationshipType[]>(300);
const interactionTypesCache = new TTLCache<InteractionType[]>(300);
const socialAccountTypesCache = new TTLCache<SocialAccountType[]>(300);

// Family tree types
export interface MissingLink {
  personId: string;
  missingRole: string;
  context: string;
  relatedPersonId: string;
}

export interface FamilyTreePersonEntry {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  depth: number;
}

export interface FamilyTreeResult {
  people: FamilyTreePersonEntry[];
  relationships: Array<{
    id: string;
    fromPersonId: string;
    toPersonId: string;
    familyRelationshipType: string;
  }>;
  missingLinks: MissingLink[];
}

export interface SuggestedFamilyConnection {
  personId: string;
  firstName: string;
  lastName: string;
  suggestedRelationship: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface IStorage {
  // Graph operations
  getGraphData(): Promise<{
    people: Array<{ id: string; firstName: string; lastName: string; company: string | null; imageUrl: string | null; socialAccountUuids: string[] }>;
    relationships: Array<{ id: string; fromPersonId: string; toPersonId: string; typeColor: string | null }>;
    groups: Array<{ id: string; name: string; color: string; members: string[] }>;
  }>;
  getPersonGraph(): Promise<PersonGraphData>;

  // People operations
  getAllPeople(searchQuery?: string): Promise<Person[]>;
  getAllPeopleWithRelationships(): Promise<Array<Person & { relationships: RelationshipWithPerson[] }>>;
  getPeoplePaginated(offset: number, limit: number, mePersonId?: string, sortBy?: string): Promise<Array<Person & { maxRelationshipValue: number | null; relationshipTypeName: string | null; relationshipTypeColor: string | null; groupCount: number }>>;
  getPersonById(id: string): Promise<PersonWithRelations | undefined>;
  createPerson(person: InsertPerson): Promise<Person>;
  updatePerson(id: string, person: Partial<InsertPerson>): Promise<Person | undefined>;
  deletePerson(id: string): Promise<void>;
  updateEloScores(winnerId: string, loserId: string): Promise<{ winner: Person; loser: Person }>;
  getRandomPeoplePair(): Promise<Person[]>;

  // Note operations
  createNote(note: InsertNote): Promise<Note>;
  deleteNote(id: string): Promise<void>;

  // Interaction operations
  createInteraction(interaction: InsertInteraction): Promise<Interaction>;
  updateInteraction(id: string, interaction: Partial<InsertInteraction>): Promise<Interaction | undefined>;
  deleteInteraction(id: string): Promise<void>;

  // Relationship operations
  createRelationship(relationship: InsertRelationship): Promise<Relationship>;
  updateRelationship(id: string, relationship: Partial<InsertRelationship>): Promise<Relationship | undefined>;
  deleteRelationship(id: string): Promise<void>;

  // Family tree operations
  getRelationshipById(id: string): Promise<Relationship | undefined>;
  getFamilyRelationshipsForPerson(personId: string): Promise<Relationship[]>;
  findFamilyRelationship(fromPersonId: string, toPersonId: string): Promise<Relationship | undefined>;
  getFamilyTree(personId: string, maxDepth: number): Promise<FamilyTreeResult>;
  detectMissingFamilyLinks(personIds: string[], rels: Array<{ fromPersonId: string; toPersonId: string; familyRelationshipType: string | null }>): MissingLink[];
  propagateFamilyRelationship(relationshipId: string): Promise<Relationship[]>;
  createFamilyRelationshipWithInverse(data: InsertRelationship): Promise<{ relationship: Relationship; inverseRelationship: Relationship | null; propagated: Relationship[] }>;
  getPeopleByLastName(lastName: string): Promise<Person[]>;
  getSuggestedFamilyConnections(personId: string): Promise<SuggestedFamilyConnection[]>;

  // Relationship type operations
  getAllRelationshipTypes(): Promise<RelationshipType[]>;
  getRelationshipTypeById(id: string): Promise<RelationshipType | undefined>;
  createRelationshipType(relationshipType: InsertRelationshipType): Promise<RelationshipType>;
  updateRelationshipType(id: string, relationshipType: Partial<InsertRelationshipType>): Promise<RelationshipType | undefined>;
  deleteRelationshipType(id: string): Promise<void>;

  // Interaction type operations
  getAllInteractionTypes(): Promise<InteractionType[]>;
  getInteractionTypeById(id: string): Promise<InteractionType | undefined>;
  createInteractionType(interactionType: InsertInteractionType): Promise<InteractionType>;
  updateInteractionType(id: string, interactionType: Partial<InsertInteractionType>): Promise<InteractionType | undefined>;
  deleteInteractionType(id: string): Promise<void>;

  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  getUserCount(): Promise<number>;
  updateUserPerson(userId: number, person: Partial<InsertPerson>): Promise<void>;
  getMePerson(userId: number): Promise<PersonWithRelations | undefined>;
  getImageStorageMode(userId: number): Promise<string>;
  setImageStorageMode(userId: number, mode: string): Promise<void>;
  getAllImageUrls(): Promise<Array<{ table: string; id: string; column: string; url: string }>>;
  updateImageUrl(table: string, id: string, column: string, oldUrl: string, newUrl: string): Promise<void>;

  // API Key operations
  getAllApiKeys(userId: number): Promise<ApiKey[]>;
  getApiKeyByKey(key: string): Promise<ApiKey | undefined>;
  createApiKey(apiKey: InsertApiKey): Promise<ApiKey>;
  deleteApiKey(id: string): Promise<void>;
  updateApiKeyLastUsed(id: string): Promise<void>;

  // SSO Config operations
  getSsoConfig(userId: number): Promise<SsoConfig | undefined>;
  createSsoConfig(config: InsertSsoConfig): Promise<SsoConfig>;
  updateSsoConfig(userId: number, config: Partial<InsertSsoConfig>): Promise<SsoConfig | undefined>;
  deleteSsoConfig(userId: number): Promise<void>;
  getUserBySsoEmail(ssoEmail: string): Promise<User | undefined>;

  // Extension session operations
  getAllExtensionSessions(userId: number): Promise<ExtensionSession[]>;
  getExtensionSessionByToken(tokenHash: string): Promise<ExtensionSession | undefined>;
  createExtensionSession(session: InsertExtensionSession): Promise<ExtensionSession>;
  deleteExtensionSession(id: string): Promise<void>;
  updateExtensionSessionLastAccessed(id: string): Promise<void>;

  // Extension auth code operations
  getExtensionAuthCode(userId: number): Promise<ExtensionAuthCode | undefined>;
  upsertExtensionAuthCode(code: InsertExtensionAuthCode): Promise<ExtensionAuthCode>;
  deleteExpiredExtensionAuthCodes(): Promise<void>;
  deleteExtensionAuthCodeByUserId(userId: number): Promise<void>;
  getExtensionAuthCodeByCode(code: string): Promise<ExtensionAuthCode | undefined>;
  getAllExtensionSessionsAllUsers(): Promise<ExtensionSession[]>;

  // Group operations
  getAllGroups(searchQuery?: string): Promise<Group[]>;
  getGroupById(id: string): Promise<any>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroup(id: string, group: Partial<InsertGroup>): Promise<Group | undefined>;
  deleteGroup(id: string): Promise<void>;

  // Group note operations
  createGroupNote(note: InsertGroupNote): Promise<GroupNote>;
  deleteGroupNote(id: string): Promise<void>;

  // Social graph operations
  getSocialGraph(settings: SocialGraphSettings): Promise<SocialGraphData>;

  // Social account operations
  getAllSocialAccounts(searchQuery?: string, typeId?: string): Promise<SocialAccountWithCurrentProfile[]>;
  getSocialAccountsPaginated(options: {
    offset: number;
    limit: number;
    searchQuery?: string;
    typeId?: string;
    followsAccountIds?: string[];
  }): Promise<SocialAccountWithCurrentProfile[]>;
  getSocialAccountById(id: string): Promise<SocialAccountWithCurrentProfile | undefined>;
  getSocialAccountsByIds(ids: string[]): Promise<SocialAccountWithCurrentProfile[]>;
  createSocialAccount(account: InsertSocialAccount): Promise<SocialAccountWithCurrentProfile>;
  updateSocialAccount(id: string, account: Partial<InsertSocialAccount>): Promise<SocialAccount | undefined>;
  deleteSocialAccount(id: string): Promise<void>;
  deleteAllSocialAccounts(): Promise<number>;

  // V1 Social account search/bulk operations
  searchSocialAccountsByUsername(options: {
    username: string;
    platform?: string;
    page: number;
    perPage: number;
  }): Promise<{ results: SocialAccountWithCurrentProfile[]; total: number }>;
  bulkLookupSocialAccounts(
    lookups: Array<{ username: string; platform: string }>
  ): Promise<{ results: Record<string, SocialAccountWithCurrentProfile>; not_found: string[] }>;

  // Social profile version operations
  getCurrentProfileVersion(socialAccountId: string): Promise<SocialProfileVersion | null>;
  getProfileVersions(socialAccountId: string): Promise<SocialProfileVersion[]>;
  createProfileVersion(version: InsertSocialProfileVersion): Promise<SocialProfileVersion>;
  updateProfileVersion(id: string, data: Partial<InsertSocialProfileVersion>): Promise<SocialProfileVersion | undefined>;
  getAllProfileVersions(): Promise<SocialProfileVersion[]>;

  // Social network state operations
  getNetworkState(socialAccountId: string): Promise<SocialNetworkState | null>;
  upsertNetworkState(state: InsertSocialNetworkState): Promise<SocialNetworkState>;
  getAllNetworkStates(): Promise<SocialNetworkState[]>;

  // Social network change operations
  recordNetworkChanges(changes: InsertSocialNetworkChange[]): Promise<SocialNetworkChange[]>;
  getNetworkChanges(socialAccountId: string, limit?: number): Promise<SocialNetworkChange[]>;
  getAllNetworkChanges(): Promise<SocialNetworkChange[]>;

  // Social account type operations
  getAllSocialAccountTypes(): Promise<SocialAccountType[]>;
  getSocialAccountTypeById(id: string): Promise<SocialAccountType | undefined>;
  getSocialAccountTypeByName(name: string): Promise<SocialAccountType | undefined>;
  createSocialAccountType(type: InsertSocialAccountType): Promise<SocialAccountType>;
  createSocialAccountTypeWithId(type: InsertSocialAccountType & { id: string }): Promise<SocialAccountType>;
  updateSocialAccountType(id: string, type: Partial<InsertSocialAccountType>): Promise<SocialAccountType | undefined>;
  deleteSocialAccountType(id: string): Promise<void>;

  // Social account post operations
  getPostsBySocialAccountId(socialAccountId: string, includeDeleted?: boolean): Promise<SocialAccountPost[]>;
  getAllPosts(): Promise<SocialAccountPost[]>;
  getPostById(id: string): Promise<SocialAccountPost | undefined>;
  createPost(post: InsertSocialAccountPost): Promise<SocialAccountPost>;
  updatePost(id: string, post: Partial<InsertSocialAccountPost>): Promise<SocialAccountPost | undefined>;
  deletePost(id: string): Promise<void>;

  // Flow operations (unified timeline)
  getFlowData(personId: string, limit: number, cursor?: string): Promise<FlowResponse>;
  
  // Mega search operations
  megaSearch(query: string, options: {
    includePeople?: boolean;
    includeGroups?: boolean;
    includeInteractions?: boolean;
    includeNotes?: boolean;
    includeSocialProfiles?: boolean;
  }): Promise<MegaSearchResult>;
  
  // Task operations
  createTask(task: InsertTask): Promise<Task>;
  getNextPendingTask(): Promise<Task | undefined>;
  updateTaskStatus(id: string, status: string, result?: string): Promise<Task | undefined>;
  updateTaskProgress(id: string, progress: number, message?: string): Promise<void>;
  getTasksByStatus(status: string): Promise<Task[]>;
  getAllTasks(limit?: number): Promise<Task[]>;
  getTaskById(id: string): Promise<Task | undefined>;
  deleteAllTasks(): Promise<void>;

  // Photo operations
  insertPhoto(photo: InsertPhoto): Promise<Photo>;
  getPhotoById(id: string): Promise<Photo | undefined>;
  getPhotoByLocation(location: string): Promise<Photo | undefined>;
  listPhotos(options?: { prmLocationPrefix?: string; limit?: number; offset?: number }): Promise<{ items: Photo[]; total: number }>;
  updatePhotoLocation(oldLocation: string, newLocation: string): Promise<void>;
  updatePhotoMeta(id: string, data: Partial<Pick<Photo, 'fileHash' | 'widthPx' | 'heightPx' | 'metadata' | 'imageDescription' | 'imageDescriptionAt' | 'faceUuids' | 'faceIdAt' | 'processedAt'>>): Promise<void>;
  getPhotoByHash(fileHash: string): Promise<Photo | undefined>;
  getPhotoParent(subImageId: string): Promise<Photo | undefined>;
  deleteInstagramImageUrls(): Promise<{ profileVersionsCleared: number; postsCleared: number; photosDeleted: number }>;

  // Image task operations
  createImageTask(task: InsertImageTask): Promise<ImageTask>;
  getImageTaskById(id: string): Promise<ImageTask | undefined>;
  getNextPendingImageTask(): Promise<ImageTask | undefined>;
  updateImageTaskStatus(id: string, status: string, result?: string): Promise<void>;
  updateImageTaskProgress(id: string, progress: number, message?: string): Promise<void>;
  listImageTasks(options?: { type?: string; status?: string; parentTaskId?: string; limit?: number; offset?: number }): Promise<{ items: ImageTask[]; total: number }>;
  cancelImageTask(id: string): Promise<void>;

  // Daily note operations
  listDailyNotes(): Promise<DailyNoteWithDetails[]>;
  getDailyNoteById(id: string): Promise<DailyNoteWithDetails | undefined>;
  getDailyNoteByDate(date: string): Promise<DailyNoteWithDetails | undefined>;
  createDailyNote(note: InsertDailyNote): Promise<DailyNoteWithDetails>;
  updateDailyNote(id: string, data: Partial<InsertDailyNote>): Promise<DailyNoteWithDetails | undefined>;
  deleteDailyNote(id: string): Promise<void>;
  replaceDailyNoteEvents(dailyNoteId: string, events: Array<{ text: string; position: number }>): Promise<DailyNoteEvent[]>;
  replaceDailyNoteParties(dailyNoteId: string, parties: Array<{ partyType: string; refId: string }>): Promise<DailyNoteInvolvedParty[]>;

  // Session store
  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ pool, createTableIfMissing: true });
  }

  // Graph operations
  async getGraphData(): Promise<{
    people: Array<{ id: string; firstName: string; lastName: string; company: string | null; imageUrl: string | null; socialAccountUuids: string[] }>;
    relationships: Array<{ id: string; fromPersonId: string; toPersonId: string; typeColor: string | null }>;
    groups: Array<{ id: string; name: string; color: string; members: string[] }>;
  }> {
    // Fetch minimal people data
    const peopleData = await db
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        company: people.company,
        imageUrl: people.imageUrl,
        socialAccountUuids: people.socialAccountUuids,
      })
      .from(people);

    // Fetch all relationships with type colors in a single query
    const relationshipsData = await db
      .select({
        id: relationships.id,
        fromPersonId: relationships.fromPersonId,
        toPersonId: relationships.toPersonId,
        typeColor: relationshipTypes.color,
      })
      .from(relationships)
      .leftJoin(relationshipTypes, eq(relationships.typeId, relationshipTypes.id));

    // Fetch minimal groups data
    const groupsData = await db
      .select({
        id: groups.id,
        name: groups.name,
        color: groups.color,
        members: groups.members,
      })
      .from(groups);

    return {
      people: peopleData.map(p => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        company: p.company,
        imageUrl: p.imageUrl,
        socialAccountUuids: p.socialAccountUuids || [],
      })),
      relationships: relationshipsData.map(rel => ({
        id: rel.id,
        fromPersonId: rel.fromPersonId,
        toPersonId: rel.toPersonId,
        typeColor: rel.typeColor || null,
      })),
      groups: groupsData.map(g => ({
        id: g.id,
        name: g.name,
        color: g.color,
        members: g.members || [],
      })),
    };
  }

  async getPersonGraph(): Promise<PersonGraphData> {
    const base = await this.getGraphData();

    const accountIdSet = new Set<string>();
    base.people.forEach(p => {
      (p.socialAccountUuids || []).forEach(id => accountIdSet.add(id));
    });

    const accountIds = Array.from(accountIdSet);

    const [accounts, types, currentProfiles] = await Promise.all([
      accountIds.length
        ? db.select({ id: socialAccounts.id, username: socialAccounts.username, typeId: socialAccounts.typeId })
            .from(socialAccounts)
            .where(inArray(socialAccounts.id, accountIds))
        : Promise.resolve([] as Array<{ id: string; username: string; typeId: string | null }>),
      db.select({ id: socialAccountTypes.id, color: socialAccountTypes.color }).from(socialAccountTypes),
      accountIds.length
        ? db.select({ socialAccountId: socialProfileVersions.socialAccountId, imageUrl: socialProfileVersions.imageUrl })
            .from(socialProfileVersions)
            .where(and(eq(socialProfileVersions.isCurrent, true), inArray(socialProfileVersions.socialAccountId, accountIds)))
        : Promise.resolve([] as Array<{ socialAccountId: string; imageUrl: string | null }>),
    ]);

    const typeColorById = new Map<string, string | null>();
    types.forEach(t => typeColorById.set(t.id, t.color || null));

    const profileImageById = new Map<string, string | null>();
    currentProfiles.forEach(p => profileImageById.set(p.socialAccountId, p.imageUrl || null));

    const briefById = new Map<string, { id: string; username: string; typeColor: string | null; imageUrl: string | null }>();
    accounts.forEach(a => {
      briefById.set(a.id, {
        id: a.id,
        username: a.username,
        typeColor: a.typeId ? (typeColorById.get(a.typeId) ?? null) : null,
        imageUrl: profileImageById.get(a.id) ?? null,
      });
    });

    const people: PersonGraphPerson[] = base.people.map(p => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      company: p.company,
      imageUrl: p.imageUrl,
      socialAccountBriefs: (p.socialAccountUuids || [])
        .map(uuid => briefById.get(uuid))
        .filter((b): b is { id: string; username: string; typeColor: string | null; imageUrl: string | null } => !!b),
    }));

    return {
      view: "person",
      people,
      relationships: base.relationships,
      groups: base.groups,
    };
  }

  // People operations
  async getAllPeople(searchQuery?: string): Promise<Person[]> {
    if (searchQuery) {
      const query = `%${searchQuery}%`;
      const startQuery = `${searchQuery}%`;
      
      return await db
        .select()
        .from(people)
        .where(
          sql`${people.userId} IS NULL AND (
            ${people.firstName} ILIKE ${query} OR
            ${people.lastName} ILIKE ${query} OR
            CONCAT(${people.firstName}, ' ', ${people.lastName}) ILIKE ${query} OR
            CONCAT(${people.lastName}, ' ', ${people.firstName}) ILIKE ${query} OR
            ${people.email} ILIKE ${query} OR
            ${people.company} ILIKE ${query} OR
            EXISTS (
              SELECT 1 FROM unnest(${people.tags}) AS tag
              WHERE tag ILIKE ${query}
            )
          )`
        )
        .orderBy(
          sql`CASE
            WHEN ${people.firstName} ILIKE ${startQuery} THEN 0
            WHEN ${people.lastName} ILIKE ${startQuery} THEN 1
            ELSE 2
          END`,
          sql`CASE
            WHEN ${people.firstName} ILIKE ${startQuery} THEN ${people.firstName}
            WHEN ${people.lastName} ILIKE ${startQuery} THEN ${people.lastName}
            ELSE ${people.firstName}
          END`,
          sql`CASE
            WHEN ${people.firstName} ILIKE ${startQuery} THEN ${people.lastName}
            WHEN ${people.lastName} ILIKE ${startQuery} THEN ${people.firstName}
            ELSE ${people.lastName}
          END`
        );
    }
    return await db.select().from(people).where(sql`${people.userId} IS NULL`);
  }

  async getAllPeopleWithRelationships(): Promise<Array<Person & { relationships: RelationshipWithPerson[] }>> {
    // Fetch all people and all relationships in just 2 queries (instead of N+1)
    const [allPeople, allRelationshipsData] = await Promise.all([
      db.select().from(people),
      db
        .select({
          id: relationships.id,
          fromPersonId: relationships.fromPersonId,
          toPersonId: relationships.toPersonId,
          typeId: relationships.typeId,
          notes: relationships.notes,
          createdAt: relationships.createdAt,
          relatedPerson: people,
          type: relationshipTypes,
          direction: sql<string>`'from'`.as('direction'),
        })
        .from(relationships)
        .innerJoin(people, eq(relationships.toPersonId, people.id))
        .leftJoin(relationshipTypes, eq(relationships.typeId, relationshipTypes.id))
        .unionAll(
          db
            .select({
              id: relationships.id,
              fromPersonId: relationships.fromPersonId,
              toPersonId: relationships.toPersonId,
              typeId: relationships.typeId,
              notes: relationships.notes,
              createdAt: relationships.createdAt,
              relatedPerson: people,
              type: relationshipTypes,
              direction: sql<string>`'to'`.as('direction'),
            })
            .from(relationships)
            .innerJoin(people, eq(relationships.fromPersonId, people.id))
            .leftJoin(relationshipTypes, eq(relationships.typeId, relationshipTypes.id))
        ),
    ]);

    // Group relationships by person ID in memory
    const relationshipsByPersonId = new Map<string, any[]>();
    for (const rel of allRelationshipsData) {
      const personId = rel.direction === 'from' ? rel.fromPersonId : rel.toPersonId;
      if (!relationshipsByPersonId.has(personId)) {
        relationshipsByPersonId.set(personId, []);
      }
      relationshipsByPersonId.get(personId)!.push({
        id: rel.id,
        fromPersonId: rel.fromPersonId,
        toPersonId: rel.toPersonId,
        typeId: rel.typeId,
        notes: rel.notes,
        createdAt: rel.createdAt,
        toPerson: rel.relatedPerson,
        type: rel.type || undefined,
      });
    }

    // Map people with their relationships
    return allPeople.map(person => ({
      ...person,
      relationships: relationshipsByPersonId.get(person.id) || [],
    }));
  }

  async getPeoplePaginated(
    offset: number,
    limit: number,
    mePersonId?: string,
    sortBy?: string
  ): Promise<Array<Person & { maxRelationshipValue: number | null; relationshipTypeName: string | null; relationshipTypeColor: string | null; groupCount: number }>> {
    // Get all people (excluding ME user) with their highest-value relationship WITH THE ME USER
    const result = await db
      .select({
        person: people,
        maxValue: sql<number | null>`MAX(${relationshipTypes.value})`.as('max_value'),
        typeName: sql<string | null>`MAX(CASE WHEN ${relationshipTypes.value} = (
          SELECT MAX(rt2.value) 
          FROM ${relationshipTypes} rt2 
          INNER JOIN ${relationships} r2 ON rt2.id = r2.type_id 
          WHERE ${mePersonId ? sql`(
            (r2.from_person_id = ${people.id} AND r2.to_person_id = ${mePersonId}) OR 
            (r2.to_person_id = ${people.id} AND r2.from_person_id = ${mePersonId})
          )` : sql`(r2.from_person_id = ${people.id} OR r2.to_person_id = ${people.id})`}
        ) THEN ${relationshipTypes.name} ELSE NULL END)`.as('type_name'),
        typeColor: sql<string | null>`MAX(CASE WHEN ${relationshipTypes.value} = (
          SELECT MAX(rt2.value) 
          FROM ${relationshipTypes} rt2 
          INNER JOIN ${relationships} r2 ON rt2.id = r2.type_id 
          WHERE ${mePersonId ? sql`(
            (r2.from_person_id = ${people.id} AND r2.to_person_id = ${mePersonId}) OR 
            (r2.to_person_id = ${people.id} AND r2.from_person_id = ${mePersonId})
          )` : sql`(r2.from_person_id = ${people.id} OR r2.to_person_id = ${people.id})`}
        ) THEN ${relationshipTypes.color} ELSE NULL END)`.as('type_color'),
        groupCount: sql<number>`(
          SELECT COUNT(*)::int 
          FROM ${groups} 
          WHERE ${people.id} = ANY(${groups.members})
        )`.as('group_count'),
      })
      .from(people)
      .leftJoin(
        relationships,
        mePersonId 
          ? or(
              and(eq(relationships.fromPersonId, people.id), eq(relationships.toPersonId, mePersonId)),
              and(eq(relationships.toPersonId, people.id), eq(relationships.fromPersonId, mePersonId))
            )
          : or(
              eq(relationships.fromPersonId, people.id),
              eq(relationships.toPersonId, people.id)
            )
      )
      .leftJoin(relationshipTypes, eq(relationships.typeId, relationshipTypes.id))
      .where(sql`${people.userId} IS NULL`)
      .groupBy(people.id)
      .orderBy(
        ...(sortBy === 'elo_high'
          ? [sql`${people.eloScore} DESC`, people.firstName, people.lastName]
          : sortBy === 'elo_low'
          ? [sql`${people.eloScore} ASC`, people.firstName, people.lastName]
          : sortBy === 'added'
          ? [sql`${people.createdAt} DESC`, people.firstName, people.lastName]
          : sortBy === 'starred'
          ? [sql`${people.isStarred} DESC NULLS LAST`, sql`MAX(${relationshipTypes.value}) DESC NULLS LAST`, people.firstName, people.lastName]
          : [sql`MAX(${relationshipTypes.value}) DESC NULLS LAST`, people.firstName, people.lastName]
        )
      )
      .limit(limit)
      .offset(offset);

    return result.map(row => ({
      ...row.person,
      maxRelationshipValue: row.maxValue,
      relationshipTypeName: row.typeName,
      relationshipTypeColor: row.typeColor,
      groupCount: row.groupCount,
    }));
  }

  async getPersonById(id: string): Promise<PersonWithRelations | undefined> {
    const [person] = await db.select().from(people).where(eq(people.id, id));
    if (!person) return undefined;

    // Build list of identifiers for this person (email, phone, social account UUIDs)
    const identifiers: string[] = [];
    if (person.email) identifiers.push(person.email);
    if (person.phone) identifiers.push(person.phone);
    if (person.socialAccountUuids && person.socialAccountUuids.length > 0) {
      identifiers.push(...person.socialAccountUuids);
    }

    // Run all independent queries in parallel
    const [personNotes, personInteractions, personGroups, relationshipsFrom, relationshipsTo] = await Promise.all([
      db.select().from(notes).where(eq(notes.personId, id)),
      db.select().from(interactions).where(sql`${id} = ANY(${interactions.peopleIds})`),
      db.select().from(groups).where(arrayContains(groups.members, [id])),
      db
        .select({
          id: relationships.id,
          fromPersonId: relationships.fromPersonId,
          toPersonId: relationships.toPersonId,
          typeId: relationships.typeId,
          notes: relationships.notes,
          familyRelationshipType: relationships.familyRelationshipType,
          createdAt: relationships.createdAt,
          toPerson: people,
          type: relationshipTypes,
        })
        .from(relationships)
        .innerJoin(people, eq(relationships.toPersonId, people.id))
        .leftJoin(relationshipTypes, eq(relationships.typeId, relationshipTypes.id))
        .where(eq(relationships.fromPersonId, id)),
      db
        .select({
          id: relationships.id,
          fromPersonId: relationships.fromPersonId,
          toPersonId: relationships.toPersonId,
          typeId: relationships.typeId,
          notes: relationships.notes,
          familyRelationshipType: relationships.familyRelationshipType,
          createdAt: relationships.createdAt,
          toPerson: people,
          type: relationshipTypes,
        })
        .from(relationships)
        .innerJoin(people, eq(relationships.fromPersonId, people.id))
        .leftJoin(relationshipTypes, eq(relationships.typeId, relationshipTypes.id))
        .where(eq(relationships.toPersonId, id)),
    ]);

    // Combine both directions
    const allRelationships = [
      ...relationshipsFrom.map(rel => ({
        ...rel,
        type: rel.type || undefined,
      })),
      ...relationshipsTo.map(rel => ({
        ...rel,
        type: rel.type || undefined,
      }))
    ];

    return {
      ...person,
      notes: personNotes,
      interactions: personInteractions,
      groups: personGroups,
      relationships: allRelationships,
    };
  }

  async createPerson(insertPerson: InsertPerson): Promise<Person> {
    const [person] = await db.insert(people).values(insertPerson).returning();
    return person;
  }

  async updatePerson(
    id: string,
    personData: Partial<InsertPerson>
  ): Promise<Person | undefined> {
    const [person] = await db
      .update(people)
      .set(personData)
      .where(eq(people.id, id))
      .returning();
    return person || undefined;
  }

  async deletePerson(id: string): Promise<void> {
    // Remove person from all interactions
    await this.removePersonFromInteractions(id);
    
    // Remove person from all groups
    const allGroups = await db.select().from(groups);
    for (const group of allGroups) {
      if (group.members && group.members.includes(id)) {
        const updatedMembers = group.members.filter((memberId) => memberId !== id);
        await db
          .update(groups)
          .set({ members: updatedMembers })
          .where(eq(groups.id, group.id));
      }
    }
    
    // Delete person (cascade will handle notes, relationships)
    await db.delete(people).where(eq(people.id, id));
  }

  async updateEloScores(winnerId: string, loserId: string): Promise<{ winner: Person; loser: Person }> {
    const K = 32;
    const [winnerPerson] = await db.select().from(people).where(eq(people.id, winnerId));
    const [loserPerson] = await db.select().from(people).where(eq(people.id, loserId));

    if (!winnerPerson || !loserPerson) {
      throw new Error("One or both people not found");
    }

    const rA = winnerPerson.eloScore;
    const rB = loserPerson.eloScore;

    const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const expectedB = 1 / (1 + Math.pow(10, (rA - rB) / 400));

    const newRatingA = Math.round(rA + K * (1 - expectedA));
    const newRatingB = Math.round(rB + K * (0 - expectedB));

    const [updatedWinner] = await db.update(people).set({ eloScore: newRatingA }).where(eq(people.id, winnerId)).returning();
    const [updatedLoser] = await db.update(people).set({ eloScore: newRatingB }).where(eq(people.id, loserId)).returning();

    return { winner: updatedWinner, loser: updatedLoser };
  }

  async getRandomPeoplePair(): Promise<Person[]> {
    const result = await db
      .select()
      .from(people)
      .where(sql`${people.userId} IS NULL`)
      .orderBy(sql`RANDOM()`)
      .limit(2);
    return result;
  }

  private async removePersonFromInteractions(personId: string): Promise<void> {
    // Get all interactions that include this person
    const affectedInteractions = await db
      .select()
      .from(interactions)
      .where(sql`${personId} = ANY(${interactions.peopleIds})`);

    for (const interaction of affectedInteractions) {
      const updatedPeopleIds = interaction.peopleIds.filter((id) => id !== personId);
      
      // If less than 2 people remain, delete the interaction
      if (updatedPeopleIds.length < 2) {
        await db.delete(interactions).where(eq(interactions.id, interaction.id));
      } else {
        // Otherwise update with removed person
        await db
          .update(interactions)
          .set({ peopleIds: updatedPeopleIds })
          .where(eq(interactions.id, interaction.id));
      }
    }
  }

  private async removeGroupFromInteractions(groupId: string): Promise<void> {
    // Get all interactions that include this group
    const affectedInteractions = await db
      .select()
      .from(interactions)
      .where(sql`${groupId} = ANY(${interactions.groupIds})`);

    for (const interaction of affectedInteractions) {
      const updatedGroupIds = (interaction.groupIds || []).filter((id) => id !== groupId);
      
      await db
        .update(interactions)
        .set({ groupIds: updatedGroupIds })
        .where(eq(interactions.id, interaction.id));
    }
  }

  // Note operations
  async createNote(insertNote: InsertNote): Promise<Note> {
    const [note] = await db.insert(notes).values(insertNote).returning();
    return note;
  }

  async deleteNote(id: string): Promise<void> {
    await db.delete(notes).where(eq(notes.id, id));
  }

  async getNoteById(id: string): Promise<Note | undefined> {
    const [note] = await db.select().from(notes).where(eq(notes.id, id));
    return note || undefined;
  }

  // Interaction operations
  async createInteraction(
    insertInteraction: InsertInteraction
  ): Promise<Interaction> {
    const [interaction] = await db
      .insert(interactions)
      .values(insertInteraction)
      .returning();
    return interaction;
  }

  async updateInteraction(
    id: string,
    interactionData: Partial<InsertInteraction>
  ): Promise<Interaction | undefined> {
    const [interaction] = await db
      .update(interactions)
      .set(interactionData)
      .where(eq(interactions.id, id))
      .returning();
    return interaction || undefined;
  }

  async deleteInteraction(id: string): Promise<void> {
    await db.delete(interactions).where(eq(interactions.id, id));
  }

  // Relationship operations
  async createRelationship(insertRelationship: InsertRelationship): Promise<Relationship> {
    const [relationship] = await db
      .insert(relationships)
      .values(insertRelationship)
      .returning();
    return relationship;
  }

  async updateRelationship(
    id: string,
    relationshipData: Partial<InsertRelationship>
  ): Promise<Relationship | undefined> {
    const [relationship] = await db
      .update(relationships)
      .set(relationshipData)
      .where(eq(relationships.id, id))
      .returning();
    return relationship || undefined;
  }

  async deleteRelationship(id: string): Promise<void> {
    await db.delete(relationships).where(eq(relationships.id, id));
  }

  // Family tree operations

  async getRelationshipById(id: string): Promise<Relationship | undefined> {
    const [rel] = await db.select().from(relationships).where(eq(relationships.id, id));
    return rel || undefined;
  }

  async getFamilyRelationshipsForPerson(personId: string): Promise<Relationship[]> {
    return db
      .select()
      .from(relationships)
      .where(
        and(
          isNotNull(relationships.familyRelationshipType),
          or(
            eq(relationships.fromPersonId, personId),
            eq(relationships.toPersonId, personId)
          )
        )
      );
  }

  async findFamilyRelationship(fromPersonId: string, toPersonId: string): Promise<Relationship | undefined> {
    const [rel] = await db
      .select()
      .from(relationships)
      .where(
        and(
          eq(relationships.fromPersonId, fromPersonId),
          eq(relationships.toPersonId, toPersonId),
          isNotNull(relationships.familyRelationshipType)
        )
      );
    return rel || undefined;
  }

  async getFamilyTree(personId: string, maxDepth: number): Promise<FamilyTreeResult> {
    const visitedPeople = new Map<string, number>(); // personId -> depth
    const treeRelationships: Array<{ id: string; fromPersonId: string; toPersonId: string; familyRelationshipType: string }> = [];
    const treeRelIds = new Set<string>();

    visitedPeople.set(personId, 0);
    let frontier = [personId];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];

      const rels = await db
        .select()
        .from(relationships)
        .where(
          and(
            isNotNull(relationships.familyRelationshipType),
            or(
              inArray(relationships.fromPersonId, frontier),
              inArray(relationships.toPersonId, frontier)
            )
          )
        );

      for (const rel of rels) {
        if (!treeRelIds.has(rel.id) && rel.familyRelationshipType) {
          treeRelIds.add(rel.id);
          treeRelationships.push({
            id: rel.id,
            fromPersonId: rel.fromPersonId,
            toPersonId: rel.toPersonId,
            familyRelationshipType: rel.familyRelationshipType,
          });
        }

        for (const otherId of [rel.fromPersonId, rel.toPersonId]) {
          if (!visitedPeople.has(otherId)) {
            visitedPeople.set(otherId, depth + 1);
            nextFrontier.push(otherId);
          }
        }
      }

      frontier = nextFrontier;
    }

    const personIds = Array.from(visitedPeople.keys());
    const peopleRows = personIds.length > 0
      ? await db.select().from(people).where(inArray(people.id, personIds))
      : [];

    const treePeople: FamilyTreePersonEntry[] = peopleRows.map(p => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName ?? "",
      avatarUrl: p.imageUrl ?? null,
      depth: visitedPeople.get(p.id) ?? 0,
    }));

    const missingLinks = this.detectMissingFamilyLinks(personIds, treeRelationships);

    return { people: treePeople, relationships: treeRelationships, missingLinks };
  }

  detectMissingFamilyLinks(personIds: string[], rels: Array<{ fromPersonId: string; toPersonId: string; familyRelationshipType: string | null }>): MissingLink[] {
    const missing: MissingLink[] = [];
    const seen = new Set<string>();

    const personIdSet = new Set(personIds);

    for (const pid of personIds) {
      const personRels = rels.filter(r =>
        (r.fromPersonId === pid || r.toPersonId === pid) && r.familyRelationshipType
      );

      // asToTypes: relationship types where this person is the "to" person
      // meaning "fromPerson is [type] of this person"
      const asToTypes = personRels.filter(r => r.toPersonId === pid).map(r => r.familyRelationshipType!);
      const asFromTypes = personRels.filter(r => r.fromPersonId === pid).map(r => r.familyRelationshipType!);

      // A person "has a father" if someone is their father (asToTypes includes "father")
      // OR they are someone's child via a father relationship (asFromTypes includes "child" with a father as the target doesn't help - we need to check the inverse row)
      const hasFather = asToTypes.includes("father") || asToTypes.includes("parent");
      const hasMother = asToTypes.includes("mother") || asToTypes.includes("parent");
      const hasAnyParent = hasFather || hasMother;
      const hasGrandparent = asToTypes.some(t => t === "grandfather" || t === "grandmother" || t === "grandparent");
      const hasChildren = asFromTypes.some(t => t === "father" || t === "mother" || t === "parent") ||
        asToTypes.some(t => t === "child" || t === "son" || t === "daughter");
      const hasSpouse = asFromTypes.includes("spouse") || asToTypes.includes("spouse");

      // Only flag missing parent when the OTHER parent exists (partial family info)
      if (hasMother && !hasFather) {
        const key = `${pid}:father`;
        if (!seen.has(key) && personIdSet.has(pid)) {
          seen.add(key);
          missing.push({ personId: pid, missingRole: "father", context: `Father of person ${pid}`, relatedPersonId: pid });
        }
      }
      if (hasFather && !hasMother) {
        const key = `${pid}:mother`;
        if (!seen.has(key) && personIdSet.has(pid)) {
          seen.add(key);
          missing.push({ personId: pid, missingRole: "mother", context: `Mother of person ${pid}`, relatedPersonId: pid });
        }
      }

      // Generation gap: grandparent exists but no intermediate parent
      if (hasGrandparent && !hasAnyParent) {
        const key = `${pid}:parent_gap`;
        if (!seen.has(key)) {
          seen.add(key);
          missing.push({ personId: pid, missingRole: "parent", context: `Missing parent between grandparent and person ${pid}`, relatedPersonId: pid });
        }
      }

      // Spouse missing: has children but no spouse
      if (hasChildren && !hasSpouse) {
        const key = `${pid}:spouse`;
        if (!seen.has(key)) {
          seen.add(key);
          missing.push({ personId: pid, missingRole: "spouse", context: `Spouse of person with children ${pid}`, relatedPersonId: pid });
        }
      }
    }

    return missing;
  }

  async propagateFamilyRelationship(relationshipId: string): Promise<Relationship[]> {
    const { propagateRelationship } = await import("./family-propagation");
    return propagateRelationship(relationshipId, this);
  }

  async createFamilyRelationshipWithInverse(data: InsertRelationship): Promise<{
    relationship: Relationship;
    inverseRelationship: Relationship | null;
    propagated: Relationship[];
  }> {
    const relationship = await this.createRelationship(data);

    let inverseRelationship: Relationship | null = null;
    if (data.familyRelationshipType) {
      const inverseType = FAMILY_RELATIONSHIP_INVERSES[data.familyRelationshipType];
      if (inverseType) {
        const existingInverse = await this.findFamilyRelationship(data.toPersonId, data.fromPersonId);
        if (!existingInverse) {
          inverseRelationship = await this.createRelationship({
            fromPersonId: data.toPersonId,
            toPersonId: data.fromPersonId,
            familyRelationshipType: inverseType as FamilyRelationshipType,
            typeId: data.typeId,
            notes: data.notes,
          });
        } else {
          inverseRelationship = existingInverse;
        }
      }
    }

    const propagated = await this.propagateFamilyRelationship(relationship.id);

    return { relationship, inverseRelationship, propagated };
  }

  async getPeopleByLastName(lastName: string): Promise<Person[]> {
    // Escape ILIKE special characters: backslash first, then wildcards
    const escapedName = lastName
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    return db.select().from(people).where(ilike(people.lastName, escapedName));
  }

  async getSuggestedFamilyConnections(personId: string): Promise<SuggestedFamilyConnection[]> {
    const person = await db.select().from(people).where(eq(people.id, personId)).then(r => r[0]);
    if (!person) return [];

    const existingRels = await db
      .select()
      .from(relationships)
      .where(or(eq(relationships.fromPersonId, personId), eq(relationships.toPersonId, personId)));

    const connectedIds = new Set(existingRels.map(r =>
      r.fromPersonId === personId ? r.toPersonId : r.fromPersonId
    ));
    connectedIds.add(personId);

    const suggestions: SuggestedFamilyConnection[] = [];

    if (person.lastName) {
      const sameLastName = await this.getPeopleByLastName(person.lastName);
      for (const p of sameLastName) {
        if (connectedIds.has(p.id)) continue;

        const confidence: "high" | "medium" | "low" = "low";
        const reason = `Same last name: ${person.lastName}`;

        suggestions.push({
          personId: p.id,
          firstName: p.firstName,
          lastName: p.lastName ?? "",
          suggestedRelationship: "sibling",
          confidence,
          reason,
        });
      }
    }

    return suggestions.slice(0, 20);
  }

  // Relationship type operations
  async getAllRelationshipTypes(): Promise<RelationshipType[]> {
    const cached = relationshipTypesCache.get('all');
    if (cached) return cached;
    
    const result = await db.select().from(relationshipTypes);
    relationshipTypesCache.set('all', result);
    return result;
  }

  async getRelationshipTypeById(id: string): Promise<RelationshipType | undefined> {
    const [relationshipType] = await db
      .select()
      .from(relationshipTypes)
      .where(eq(relationshipTypes.id, id));
    return relationshipType || undefined;
  }

  async createRelationshipType(relationshipType: InsertRelationshipType): Promise<RelationshipType> {
    const [created] = await db
      .insert(relationshipTypes)
      .values(relationshipType)
      .returning();
    relationshipTypesCache.invalidate('all');
    return created;
  }

  async updateRelationshipType(
    id: string,
    relationshipType: Partial<InsertRelationshipType>
  ): Promise<RelationshipType | undefined> {
    const [updated] = await db
      .update(relationshipTypes)
      .set(relationshipType)
      .where(eq(relationshipTypes.id, id))
      .returning();
    relationshipTypesCache.invalidate('all');
    return updated || undefined;
  }

  async deleteRelationshipType(id: string): Promise<void> {
    await db.delete(relationshipTypes).where(eq(relationshipTypes.id, id));
    relationshipTypesCache.invalidate('all');
  }

  // Interaction type operations
  async getAllInteractionTypes(): Promise<InteractionType[]> {
    const cached = interactionTypesCache.get('all');
    if (cached) return cached;
    
    const result = await db.select().from(interactionTypes);
    interactionTypesCache.set('all', result);
    return result;
  }

  async getInteractionTypeById(id: string): Promise<InteractionType | undefined> {
    const [interactionType] = await db
      .select()
      .from(interactionTypes)
      .where(eq(interactionTypes.id, id));
    return interactionType || undefined;
  }

  async createInteractionType(interactionType: InsertInteractionType): Promise<InteractionType> {
    const [created] = await db
      .insert(interactionTypes)
      .values(interactionType)
      .returning();
    interactionTypesCache.invalidate('all');
    return created;
  }

  async updateInteractionType(
    id: string,
    interactionType: Partial<InsertInteractionType>
  ): Promise<InteractionType | undefined> {
    const [updated] = await db
      .update(interactionTypes)
      .set(interactionType)
      .where(eq(interactionTypes.id, id))
      .returning();
    interactionTypesCache.invalidate('all');
    return updated || undefined;
  }

  async deleteInteractionType(id: string): Promise<void> {
    await db.delete(interactionTypes).where(eq(interactionTypes.id, id));
    interactionTypesCache.invalidate('all');
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(userData)
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async getUserCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(users);
    return Number(result[0].count);
  }

  async updateUserPerson(userId: number, personData: Partial<InsertPerson>): Promise<void> {
    await db
      .update(people)
      .set(personData)
      .where(eq(people.userId, userId));
  }

  async getMePerson(userId: number): Promise<PersonWithRelations | undefined> {
    const [person] = await db.select().from(people).where(eq(people.userId, userId));
    
    if (!person) {
      return undefined;
    }

    // Get notes
    const personNotes = await db
      .select()
      .from(notes)
      .where(eq(notes.personId, person.id));

    // Get interactions
    const personInteractions = await db
      .select()
      .from(interactions)
      .where(sql`${person.id} = ANY(${interactions.peopleIds})`);

    // Get groups where this person is a member
    const personGroups = await db
      .select()
      .from(groups)
      .where(arrayContains(groups.members, [person.id]));

    // Get relationships (bidirectional)
    const relationshipsFrom = await db
      .select({
        id: relationships.id,
        fromPersonId: relationships.fromPersonId,
        toPersonId: relationships.toPersonId,
        typeId: relationships.typeId,
        notes: relationships.notes,
        familyRelationshipType: relationships.familyRelationshipType,
        createdAt: relationships.createdAt,
        toPerson: people,
        type: relationshipTypes,
      })
      .from(relationships)
      .innerJoin(people, eq(relationships.toPersonId, people.id))
      .leftJoin(relationshipTypes, eq(relationships.typeId, relationshipTypes.id))
      .where(eq(relationships.fromPersonId, person.id));

    const relationshipsTo = await db
      .select({
        id: relationships.id,
        fromPersonId: relationships.fromPersonId,
        toPersonId: relationships.toPersonId,
        typeId: relationships.typeId,
        notes: relationships.notes,
        familyRelationshipType: relationships.familyRelationshipType,
        createdAt: relationships.createdAt,
        toPerson: people,
        type: relationshipTypes,
      })
      .from(relationships)
      .innerJoin(people, eq(relationships.fromPersonId, people.id))
      .leftJoin(relationshipTypes, eq(relationships.typeId, relationshipTypes.id))
      .where(eq(relationships.toPersonId, person.id));

    const allRelationships = [
      ...relationshipsFrom.map(rel => ({
        id: rel.id,
        fromPersonId: rel.fromPersonId,
        toPersonId: rel.toPersonId,
        typeId: rel.typeId,
        notes: rel.notes,
        familyRelationshipType: rel.familyRelationshipType,
        createdAt: rel.createdAt,
        toPerson: rel.toPerson,
        type: rel.type || undefined,
      })),
      ...relationshipsTo.map(rel => ({
        id: rel.id,
        fromPersonId: rel.fromPersonId,
        toPersonId: rel.toPersonId,
        typeId: rel.typeId,
        notes: rel.notes,
        familyRelationshipType: rel.familyRelationshipType,
        createdAt: rel.createdAt,
        toPerson: rel.toPerson,
        type: rel.type || undefined,
      })),
    ];

    return {
      ...person,
      notes: personNotes,
      interactions: personInteractions,
      groups: personGroups,
      relationships: allRelationships,
    };
  }

  async getImageStorageMode(userId: number): Promise<string> {
    const [user] = await db.select({ imageStorageMode: users.imageStorageMode }).from(users).where(eq(users.id, userId));
    return user?.imageStorageMode || "s3";
  }

  async setImageStorageMode(userId: number, mode: string): Promise<void> {
    await db.update(users).set({ imageStorageMode: mode }).where(eq(users.id, userId));
  }

  async getAllImageUrls(): Promise<Array<{ table: string; id: string; column: string; url: string }>> {
    const results: Array<{ table: string; id: string; column: string; url: string }> = [];

    const peopleRows = await db.select({ id: people.id, imageUrl: people.imageUrl }).from(people);
    for (const row of peopleRows) {
      if (row.imageUrl) results.push({ table: "people", id: row.id, column: "imageUrl", url: row.imageUrl });
    }

    const noteRows = await db.select({ id: notes.id, imageUrl: notes.imageUrl }).from(notes);
    for (const row of noteRows) {
      if (row.imageUrl) results.push({ table: "notes", id: row.id, column: "imageUrl", url: row.imageUrl });
    }

    const interactionRows = await db.select({ id: interactions.id, imageUrl: interactions.imageUrl }).from(interactions);
    for (const row of interactionRows) {
      if (row.imageUrl) results.push({ table: "interactions", id: row.id, column: "imageUrl", url: row.imageUrl });
    }

    const groupRows = await db.select({ id: groups.id, imageUrl: groups.imageUrl }).from(groups);
    for (const row of groupRows) {
      if (row.imageUrl) results.push({ table: "groups", id: row.id, column: "imageUrl", url: row.imageUrl });
    }

    const socialProfileRows = await db.select({ id: socialProfileVersions.id, imageUrl: socialProfileVersions.imageUrl }).from(socialProfileVersions);
    for (const row of socialProfileRows) {
      if (row.imageUrl) results.push({ table: "social_profile_versions", id: row.id, column: "imageUrl", url: row.imageUrl });
    }

    return results;
  }

  async updateImageUrl(table: string, id: string, column: string, oldUrl: string, newUrl: string): Promise<void> {
    switch (table) {
      case "people":
        await db.update(people).set({ imageUrl: newUrl }).where(eq(people.id, id));
        break;
      case "notes":
        await db.update(notes).set({ imageUrl: newUrl }).where(eq(notes.id, id));
        break;
      case "interactions":
        await db.update(interactions).set({ imageUrl: newUrl }).where(eq(interactions.id, id));
        break;
      case "groups":
        await db.update(groups).set({ imageUrl: newUrl }).where(eq(groups.id, id));
        break;
      case "social_profile_versions":
        await db.update(socialProfileVersions).set({ imageUrl: newUrl }).where(eq(socialProfileVersions.id, id));
        break;
      case "messages": {
        // The `messages` table is not defined in the Drizzle schema; this
        // branch is preserved for parity with legacy callers but is currently
        // unreachable. Suppress the resulting "cannot find name" errors.
        // @ts-expect-error - messages table is not part of the current schema
        const [msg] = await db.select({ imageUrls: messages.imageUrls }).from(messages).where(eq(messages.id, id));
        if (msg?.imageUrls) {
          const updatedUrls = msg.imageUrls.map((u: string) => u === oldUrl ? newUrl : u);
          // @ts-expect-error - messages table is not part of the current schema
          await db.update(messages).set({ imageUrls: updatedUrls }).where(eq(messages.id, id));
        }
        break;
      }
    }
  }

  // API Key operations
  async getAllApiKeys(userId: number): Promise<ApiKey[]> {
    return await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));
  }

  async getApiKeyByKey(key: string): Promise<ApiKey | undefined> {
    const [apiKey] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.key, key));
    return apiKey || undefined;
  }

  async createApiKey(insertApiKey: InsertApiKey): Promise<ApiKey> {
    const [apiKey] = await db
      .insert(apiKeys)
      .values(insertApiKey)
      .returning();
    return apiKey;
  }

  async deleteApiKey(id: string): Promise<void> {
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }

  // SSO Config operations
  async getSsoConfig(userId: number): Promise<SsoConfig | undefined> {
    const [config] = await db
      .select()
      .from(ssoConfig)
      .where(eq(ssoConfig.userId, userId));
    return config || undefined;
  }

  async createSsoConfig(insertConfig: InsertSsoConfig): Promise<SsoConfig> {
    const [config] = await db
      .insert(ssoConfig)
      .values(insertConfig)
      .returning();
    return config;
  }

  async updateSsoConfig(userId: number, updateData: Partial<InsertSsoConfig>): Promise<SsoConfig | undefined> {
    const [config] = await db
      .update(ssoConfig)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(ssoConfig.userId, userId))
      .returning();
    return config || undefined;
  }

  async deleteSsoConfig(userId: number): Promise<void> {
    await db.delete(ssoConfig).where(eq(ssoConfig.userId, userId));
  }

  async getUserBySsoEmail(ssoEmail: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.ssoEmail, ssoEmail));
    return user || undefined;
  }

  // Extension session operations
  async getAllExtensionSessions(userId: number): Promise<ExtensionSession[]> {
    return await db
      .select()
      .from(extensionSessions)
      .where(eq(extensionSessions.userId, userId));
  }

  async getExtensionSessionByToken(tokenHash: string): Promise<ExtensionSession | undefined> {
    const [session] = await db
      .select()
      .from(extensionSessions)
      .where(eq(extensionSessions.sessionToken, tokenHash));
    return session || undefined;
  }

  async createExtensionSession(insertSession: InsertExtensionSession): Promise<ExtensionSession> {
    const [session] = await db
      .insert(extensionSessions)
      .values(insertSession)
      .returning();
    return session;
  }

  async deleteExtensionSession(id: string): Promise<void> {
    await db.delete(extensionSessions).where(eq(extensionSessions.id, id));
  }

  async updateExtensionSessionLastAccessed(id: string): Promise<void> {
    await db
      .update(extensionSessions)
      .set({ lastAccessedAt: new Date() })
      .where(eq(extensionSessions.id, id));
  }

  // Extension auth code operations
  async getExtensionAuthCode(userId: number): Promise<ExtensionAuthCode | undefined> {
    const [code] = await db
      .select()
      .from(extensionAuthCodes)
      .where(eq(extensionAuthCodes.userId, userId));
    return code || undefined;
  }

  async upsertExtensionAuthCode(insertCode: InsertExtensionAuthCode): Promise<ExtensionAuthCode> {
    const [code] = await db
      .insert(extensionAuthCodes)
      .values(insertCode)
      .onConflictDoUpdate({
        target: extensionAuthCodes.userId,
        set: {
          code: insertCode.code,
          expiresAt: insertCode.expiresAt,
        },
      })
      .returning();
    return code;
  }

  async deleteExpiredExtensionAuthCodes(): Promise<void> {
    await db
      .delete(extensionAuthCodes)
      .where(lt(extensionAuthCodes.expiresAt, new Date()));
  }

  async getExtensionAuthCodeByCode(code: string): Promise<ExtensionAuthCode | undefined> {
    const [authCode] = await db
      .select()
      .from(extensionAuthCodes)
      .where(eq(extensionAuthCodes.code, code));
    return authCode || undefined;
  }

  async deleteExtensionAuthCodeByUserId(userId: number): Promise<void> {
    await db
      .delete(extensionAuthCodes)
      .where(eq(extensionAuthCodes.userId, userId));
  }

  async getAllExtensionSessionsAllUsers(): Promise<ExtensionSession[]> {
    return await db.select().from(extensionSessions);
  }

  // Group operations
  async getAllGroups(searchQuery?: string): Promise<Group[]> {
    if (!searchQuery) {
      return await db.select().from(groups);
    }

    const query = `%${searchQuery}%`;
    const startQuery = `${searchQuery}%`;
    
    return await db
      .select()
      .from(groups)
      .where(
        or(
          ilike(groups.name, query),
        )
      )
      .orderBy(
        sql`CASE
          WHEN ${groups.name} ILIKE ${startQuery} THEN 0
          ELSE 1
        END`,
        groups.name
      );
  }

  async getGroupById(id: string): Promise<any> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    if (!group) return undefined;

    // Run all independent queries in parallel
    const [groupNotesList, memberDetails, groupInteractions] = await Promise.all([
      db.select().from(groupNotes).where(eq(groupNotes.groupId, id)),
      group.members && group.members.length > 0
        ? db.select().from(people).where(inArray(people.id, group.members))
        : Promise.resolve([]),
      db.select().from(interactions).where(arrayContains(interactions.groupIds, [id])),
    ]);

    return {
      ...group,
      notes: groupNotesList,
      memberDetails,
      interactions: groupInteractions,
    };
  }

  async createGroup(insertGroup: InsertGroup): Promise<Group> {
    const [group] = await db.insert(groups).values(insertGroup).returning();
    return group;
  }

  async updateGroup(
    id: string,
    groupData: Partial<InsertGroup>
  ): Promise<Group | undefined> {
    const [group] = await db
      .update(groups)
      .set(groupData)
      .where(eq(groups.id, id))
      .returning();
    return group || undefined;
  }

  async deleteGroup(id: string): Promise<void> {
    // Remove group from all interactions
    await this.removeGroupFromInteractions(id);
    
    // Delete group (cascade will handle group notes)
    await db.delete(groups).where(eq(groups.id, id));
  }

  // Group note operations
  async createGroupNote(insertGroupNote: InsertGroupNote): Promise<GroupNote> {
    const [groupNote] = await db.insert(groupNotes).values(insertGroupNote).returning();
    return groupNote;
  }

  async deleteGroupNote(id: string): Promise<void> {
    await db.delete(groupNotes).where(eq(groupNotes.id, id));
  }

  // Social graph operations
  async getSocialGraph(settings: SocialGraphSettings): Promise<SocialGraphData> {
    const [allAccounts, allTypes, allStates, allCurrentProfiles] = await Promise.all([
      db.select().from(socialAccounts),
      db.select().from(socialAccountTypes),
      db.select().from(socialNetworkState),
      db.select().from(socialProfileVersions).where(eq(socialProfileVersions.isCurrent, true)),
    ]);

    const typeColorMap = new Map<string, string>();
    allTypes.forEach(t => {
      if (t.color) typeColorMap.set(t.id, t.color);
    });

    const profileMap = new Map<string, SocialProfileVersion>();
    allCurrentProfiles.forEach(p => profileMap.set(p.socialAccountId, p));

    const stateMap = new Map<string, SocialNetworkState>();
    allStates.forEach(state => {
      stateMap.set(state.socialAccountId, state);
    });

    const allAccountIds = new Set(allAccounts.map(a => a.id));

    type AccountWithFollowing = SocialAccount & { following: string[] | null };
    const accountsWithFollowing: AccountWithFollowing[] = allAccounts.map(a => ({
      ...a,
      following: stateMap.get(a.id)?.following || null,
    }));

    const directConnectionsMap = new Map<string, Set<string>>();
    accountsWithFollowing.forEach(a => directConnectionsMap.set(a.id, new Set()));

    accountsWithFollowing.forEach(account => {
      if (account.following) {
        account.following.forEach(followedId => {
          if (allAccountIds.has(followedId)) {
            directConnectionsMap.get(account.id)!.add(followedId);
            directConnectionsMap.get(followedId)!.add(account.id);
          }
        });
      }
    });

    const uniqueConnectionCounts = new Map<string, number>();
    directConnectionsMap.forEach((peers, id) => {
      uniqueConnectionCounts.set(id, peers.size);
    });

    let filtered = accountsWithFollowing;

    const isSingleHighlightActive = settings.mode === 'single-highlight' && !!settings.singleHighlightAccountId;

    if (!isSingleHighlightActive) {
      if (settings.hideOrphans) {
        filtered = filtered.filter(a => (uniqueConnectionCounts.get(a.id) || 0) > 0);
      }

      if (settings.minConnections > 0) {
        filtered = filtered.filter(a => (uniqueConnectionCounts.get(a.id) || 0) >= settings.minConnections);
      }
    }

    if (!isSingleHighlightActive && settings.limitExtras && settings.minConnections < 2) {
      const safeIds = new Set<string>();
      const extraIds = new Set<string>();
      filtered.forEach(a => {
        if ((uniqueConnectionCounts.get(a.id) || 0) >= 2) {
          safeIds.add(a.id);
        } else {
          extraIds.add(a.id);
        }
      });

      const filteredIds = new Set(filtered.map(a => a.id));
      const claimedExtras = new Set<string>();

      const sortedSafeIds = Array.from(safeIds).sort();
      sortedSafeIds.forEach(safeId => {
        const peers = directConnectionsMap.get(safeId) || new Set();
        const sortedPeers = Array.from(peers).filter(id => filteredIds.has(id)).sort();
        let claimed = 0;
        sortedPeers.forEach(peerId => {
          if (claimed >= settings.maxExtras) return;
          if (extraIds.has(peerId) && !claimedExtras.has(peerId)) {
            claimedExtras.add(peerId);
            claimed++;
          }
        });
      });

      filtered = filtered.filter(a => safeIds.has(a.id) || claimedExtras.has(a.id));
    }

    if (settings.highlightedAccountId && settings.mode !== 'single-highlight' && settings.mode !== 'multi-highlight') {
      const connectedIds = new Set<string>([settings.highlightedAccountId]);
      const highlightedAccount = filtered.find(a => a.id === settings.highlightedAccountId);

      filtered.forEach(a => {
        if (a.following?.includes(settings.highlightedAccountId!)) {
          connectedIds.add(a.id);
        }
      });

      if (highlightedAccount?.following) {
        const filteredIds = new Set(filtered.map(a => a.id));
        highlightedAccount.following.forEach(id => {
          if (filteredIds.has(id)) connectedIds.add(id);
        });
      }

      filtered = filtered.filter(a => connectedIds.has(a.id));
    }

    if (settings.mode === 'single-highlight' && settings.singleHighlightAccountId) {
      const targetId = settings.singleHighlightAccountId;
      const connectedIds = new Set<string>([targetId]);
      const filteredIds = new Set(filtered.map(a => a.id));

      const targetAccount = filtered.find(a => a.id === targetId);
      if (targetAccount?.following) {
        targetAccount.following.forEach(id => {
          if (filteredIds.has(id)) connectedIds.add(id);
        });
      }
      filtered.forEach(a => {
        if (a.following?.includes(targetId)) {
          connectedIds.add(a.id);
        }
      });

      filtered = filtered.filter(a => connectedIds.has(a.id));

      if (settings.singleRemoveExtras) {
        const neighborIds = new Set(connectedIds);
        neighborIds.delete(targetId);
        const neighborLinkCount = new Map<string, number>();
        neighborIds.forEach(id => neighborLinkCount.set(id, 0));

        filtered.forEach(account => {
          if (account.id === targetId) return;
          if (account.following) {
            account.following.forEach(followedId => {
              if (neighborIds.has(account.id) && connectedIds.has(followedId) && followedId !== targetId) {
                neighborLinkCount.set(account.id, (neighborLinkCount.get(account.id) || 0) + 1);
              }
              if (neighborIds.has(followedId) && connectedIds.has(account.id) && account.id !== targetId) {
                neighborLinkCount.set(followedId, (neighborLinkCount.get(followedId) || 0) + 1);
              }
            });
          }
        });

        filtered = filtered.filter(a => {
          if (a.id === targetId) return true;
          return (neighborLinkCount.get(a.id) || 0) > 0;
        });
      }
    }

    if (settings.mode === 'multi-highlight' && settings.multiHighlightAccountIds && settings.multiHighlightAccountIds.length >= 2) {
      const selectedIds = new Set(settings.multiHighlightAccountIds);
      const filteredIds = new Set(filtered.map(a => a.id));
      const relevantIds = new Set<string>(selectedIds);

      selectedIds.forEach(selectedId => {
        const account = filtered.find(a => a.id === selectedId);
        if (account?.following) {
          account.following.forEach(followedId => {
            if (filteredIds.has(followedId)) {
              const followedAccount = filtered.find(a => a.id === followedId);
              if (followedAccount?.following) {
                for (const otherId of Array.from(selectedIds)) {
                  if (otherId !== selectedId && followedAccount.following.includes(otherId)) {
                    relevantIds.add(followedId);
                    break;
                  }
                }
              }
              if (selectedIds.has(followedId)) {
                relevantIds.add(followedId);
              }
            }
          });
        }
        filtered.forEach(a => {
          if (a.following?.includes(selectedId) && selectedIds.has(a.id)) {
            relevantIds.add(a.id);
          }
        });
      });

      selectedIds.forEach(selectedId => {
        const account = filtered.find(a => a.id === selectedId);
        if (account?.following) {
          account.following.forEach(followedId => {
            if (filteredIds.has(followedId)) relevantIds.add(followedId);
          });
        }
        filtered.forEach(a => {
          if (a.following?.includes(selectedId)) relevantIds.add(a.id);
        });
      });

      filtered = filtered.filter(a => relevantIds.has(a.id));
    }

    const accountIds = new Set(filtered.map(a => a.id));
    const filteredMap = new Map(filtered.map(a => [a.id, a]));

    const ownerIds = Array.from(new Set(filtered.map(a => a.ownerUuid).filter((u): u is string => !!u)));
    const ownerRows = ownerIds.length
      ? await db
          .select({ id: people.id, firstName: people.firstName, lastName: people.lastName, imageUrl: people.imageUrl })
          .from(people)
          .where(inArray(people.id, ownerIds))
      : [];
    const ownerMap = new Map<string, { id: string; firstName: string; lastName: string; imageUrl: string | null }>();
    ownerRows.forEach(o => ownerMap.set(o.id, o));

    let nodes: SocialGraphNode[] = filtered.map(a => {
      const profile = profileMap.get(a.id);
      const owner = a.ownerUuid ? ownerMap.get(a.ownerUuid) : undefined;
      return {
        id: a.id,
        name: profile?.nickname || a.username,
        typeColor: (a.typeId ? typeColorMap.get(a.typeId) : null) || '#10b981',
        connectionCount: uniqueConnectionCounts.get(a.id) || 0,
        val: 10,
        size: 50,
        ownerPersonId: owner?.id ?? null,
        ownerName: owner ? `${owner.firstName} ${owner.lastName}` : null,
        ownerImageUrl: owner?.imageUrl ?? null,
      };
    });

    let links: SocialGraphLink[] = [];
    const mutualPairs = new Set<string>();

    filtered.forEach(account => {
      if (account.following) {
        account.following.forEach(followedId => {
          if (!accountIds.has(followedId)) return;

          const followedAccount = filteredMap.get(followedId);
          const isMutual = followedAccount?.following?.includes(account.id) || false;

          if (isMutual) {
            const pairKey = [account.id, followedId].sort().join('-');
            if (mutualPairs.has(pairKey)) return;
            mutualPairs.add(pairKey);
            links.push({ source: account.id, target: followedId, mutual: true });
          } else {
            links.push({ source: account.id, target: followedId, mutual: false });
          }
        });
      }
    });

    if (settings.mode === 'blob') {
      const nodeLinkCount = new Map<string, number>();
      nodes.forEach(n => nodeLinkCount.set(n.id, 0));
      links.forEach(l => {
        const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
        nodeLinkCount.set(src, (nodeLinkCount.get(src) || 0) + 1);
        nodeLinkCount.set(tgt, (nodeLinkCount.get(tgt) || 0) + 1);
      });

      const singleConnectionNodes = nodes.filter(n => (nodeLinkCount.get(n.id) || 0) === 1);
      const mergedInto = new Map<string, string>();

      const nodeLinkIndex = new Map<string, SocialGraphLink>();
      links.forEach(l => {
        const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
        if (!nodeLinkIndex.has(src)) nodeLinkIndex.set(src, l);
        if (!nodeLinkIndex.has(tgt)) nodeLinkIndex.set(tgt, l);
      });

      for (const singleNode of singleConnectionNodes) {
        const connectedLink = nodeLinkIndex.get(singleNode.id);
        if (!connectedLink) continue;

        const src = typeof connectedLink.source === 'string' ? connectedLink.source : (connectedLink.source as any).id;
        const tgt = typeof connectedLink.target === 'string' ? connectedLink.target : (connectedLink.target as any).id;
        const partnerId = src === singleNode.id ? tgt : src;
        const partnerLinkCount = nodeLinkCount.get(partnerId) || 0;

        if (partnerLinkCount > 1) {
          mergedInto.set(singleNode.id, partnerId);
        }
      }

      const removedIds = new Set(mergedInto.keys());

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      for (const [removedId, absorberId] of Array.from(mergedInto.entries())) {
        const absorber = nodeMap.get(absorberId);
        if (absorber) {
          absorber.size += (settings.blobMergeMultiplier ?? 0.5);
          const removedNode = nodeMap.get(removedId);
          if (removedNode) {
            if (!absorber.mergedNames) absorber.mergedNames = [];
            absorber.mergedNames.push(removedNode.name);
          }
        }
      }

      nodes = nodes.filter(n => !removedIds.has(n.id));
      links = links.filter(l => {
        const src = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as any).id;
        return !removedIds.has(src) && !removedIds.has(tgt);
      });
    }

    return { nodes, links };
  }

  private buildSocialAccountWithProfile(
    account: SocialAccount,
    profile: SocialProfileVersion | null,
    state: SocialNetworkState | null
  ): SocialAccountWithCurrentProfile {
    return {
      ...account,
      currentProfile: profile || null,
      latestState: state || null,
    };
  }

  // Social account operations
  async getAllSocialAccounts(searchQuery?: string, typeId?: string): Promise<SocialAccountWithCurrentProfile[]> {
    const conditions = [];
    
    if (searchQuery) {
      const query = `%${searchQuery}%`;
      conditions.push(
        or(
          ilike(socialAccounts.username, query),
          ilike(socialProfileVersions.nickname, query),
          ilike(socialProfileVersions.accountUrl, query)
        )
      );
    }
    
    if (typeId) {
      conditions.push(eq(socialAccounts.typeId, typeId));
    }

    const startQuery = searchQuery ? `${searchQuery}%` : null;

    let rows;
    if (conditions.length === 0) {
      rows = await db
        .select({
          account: socialAccounts,
          profile: socialProfileVersions,
        })
        .from(socialAccounts)
        .leftJoin(
          socialProfileVersions,
          and(
            eq(socialProfileVersions.socialAccountId, socialAccounts.id),
            eq(socialProfileVersions.isCurrent, true)
          )
        )
        .orderBy(socialAccounts.username);
    } else {
      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
      rows = await db
        .select({
          account: socialAccounts,
          profile: socialProfileVersions,
        })
        .from(socialAccounts)
        .leftJoin(
          socialProfileVersions,
          and(
            eq(socialProfileVersions.socialAccountId, socialAccounts.id),
            eq(socialProfileVersions.isCurrent, true)
          )
        )
        .where(whereClause)
        .orderBy(
          startQuery 
            ? sql`CASE WHEN ${socialAccounts.username} ILIKE ${startQuery} THEN 0 ELSE 1 END`
            : socialAccounts.username,
          socialAccounts.username
        );
    }

    return rows.map(row => this.buildSocialAccountWithProfile(row.account, row.profile, null));
  }

  async getSocialAccountsPaginated(options: {
    offset: number;
    limit: number;
    searchQuery?: string;
    typeId?: string;
    followsAccountIds?: string[];
  }): Promise<SocialAccountWithCurrentProfile[]> {
    const { offset, limit, searchQuery, typeId, followsAccountIds } = options;
    const conditions = [];

    if (searchQuery) {
      const query = `%${searchQuery}%`;
      conditions.push(
        or(
          ilike(socialAccounts.username, query),
          ilike(socialProfileVersions.nickname, query),
          ilike(socialProfileVersions.accountUrl, query)
        )
      );
    }

    if (typeId) {
      conditions.push(eq(socialAccounts.typeId, typeId));
    }

    if (followsAccountIds && followsAccountIds.length > 0) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${socialNetworkState} sns
          WHERE sns.social_account_id = ${socialAccounts.id}
          AND (${sql.join(
            followsAccountIds.map(id => sql`${id} = ANY(sns.following)`),
            sql` OR `
          )})
        )`
      );
    }

    const whereClause = conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

    const startQuery = searchQuery ? `${searchQuery}%` : null;

    const selectFields = {
      account: socialAccounts,
      profile: socialProfileVersions,
      stateId: socialNetworkState.id,
      stateSocialAccountId: socialNetworkState.socialAccountId,
      followerCount: socialNetworkState.followerCount,
      followingCount: socialNetworkState.followingCount,
      stateUpdatedAt: socialNetworkState.updatedAt,
    };

    let rows;
    if (whereClause) {
      rows = await db
        .select(selectFields)
        .from(socialAccounts)
        .leftJoin(
          socialProfileVersions,
          and(
            eq(socialProfileVersions.socialAccountId, socialAccounts.id),
            eq(socialProfileVersions.isCurrent, true)
          )
        )
        .leftJoin(
          socialNetworkState,
          eq(socialNetworkState.socialAccountId, socialAccounts.id)
        )
        .where(whereClause)
        .orderBy(
          startQuery
            ? sql`CASE WHEN ${socialAccounts.username} ILIKE ${startQuery} THEN 0 ELSE 1 END`
            : socialAccounts.username,
          socialAccounts.username
        )
        .offset(offset)
        .limit(limit);
    } else {
      rows = await db
        .select(selectFields)
        .from(socialAccounts)
        .leftJoin(
          socialProfileVersions,
          and(
            eq(socialProfileVersions.socialAccountId, socialAccounts.id),
            eq(socialProfileVersions.isCurrent, true)
          )
        )
        .leftJoin(
          socialNetworkState,
          eq(socialNetworkState.socialAccountId, socialAccounts.id)
        )
        .orderBy(socialAccounts.username)
        .offset(offset)
        .limit(limit);
    }

    return rows.map(row => {
      const state = row.stateId ? {
        id: row.stateId,
        socialAccountId: row.stateSocialAccountId,
        followerCount: row.followerCount,
        followingCount: row.followingCount,
        followers: null,
        following: null,
        updatedAt: row.stateUpdatedAt,
      } as unknown as SocialNetworkState : null;
      return this.buildSocialAccountWithProfile(row.account, row.profile, state);
    });
  }

  async getSocialAccountById(id: string): Promise<SocialAccountWithCurrentProfile | undefined> {
    const [row] = await db
      .select({
        account: socialAccounts,
        profile: socialProfileVersions,
      })
      .from(socialAccounts)
      .leftJoin(
        socialProfileVersions,
        and(
          eq(socialProfileVersions.socialAccountId, socialAccounts.id),
          eq(socialProfileVersions.isCurrent, true)
        )
      )
      .where(eq(socialAccounts.id, id));

    if (!row) return undefined;

    const [currentState] = await db
      .select()
      .from(socialNetworkState)
      .where(eq(socialNetworkState.socialAccountId, id));

    return this.buildSocialAccountWithProfile(row.account, row.profile, currentState || null);
  }

  async getSocialAccountsByIds(ids: string[]): Promise<SocialAccountWithCurrentProfile[]> {
    if (ids.length === 0) return [];

    const rows = await db
      .select({
        account: socialAccounts,
        profile: socialProfileVersions,
      })
      .from(socialAccounts)
      .leftJoin(
        socialProfileVersions,
        and(
          eq(socialProfileVersions.socialAccountId, socialAccounts.id),
          eq(socialProfileVersions.isCurrent, true)
        )
      )
      .where(inArray(socialAccounts.id, ids));

    return rows.map(row => this.buildSocialAccountWithProfile(row.account, row.profile, null));
  }

  async createSocialAccount(insertAccount: InsertSocialAccount): Promise<SocialAccountWithCurrentProfile> {
    const [account] = await db.insert(socialAccounts).values({
      ...insertAccount,
      internalAccountCreationDate: new Date(),
      internalAccountCreationType: insertAccount.internalAccountCreationType || "User",
    }).returning();

    const [profileVersion] = await db.insert(socialProfileVersions).values({
      socialAccountId: account.id,
      isCurrent: true,
    }).returning();

    return this.buildSocialAccountWithProfile(account, profileVersion, null);
  }

  async updateSocialAccount(
    id: string,
    accountData: Partial<InsertSocialAccount>
  ): Promise<SocialAccount | undefined> {
    const { username, ownerUuid, typeId, internalAccountCreationType, lastScrapedAt } = accountData as any;
    const updateFields: Record<string, any> = {};
    if (username !== undefined) updateFields.username = username;
    if (ownerUuid !== undefined) updateFields.ownerUuid = ownerUuid;
    if (typeId !== undefined) updateFields.typeId = typeId;
    if (internalAccountCreationType !== undefined) updateFields.internalAccountCreationType = internalAccountCreationType;
    if (lastScrapedAt !== undefined) updateFields.lastScrapedAt = lastScrapedAt;

    if (Object.keys(updateFields).length === 0) return undefined;

    const [account] = await db
      .update(socialAccounts)
      .set(updateFields)
      .where(eq(socialAccounts.id, id))
      .returning();
    return account || undefined;
  }

  async deleteSocialAccount(id: string): Promise<void> {
    const allPeople = await db.select().from(people);
    for (const person of allPeople) {
      if (person.socialAccountUuids && person.socialAccountUuids.includes(id)) {
        const updatedAccounts = person.socialAccountUuids.filter((accountId) => accountId !== id);
        await db
          .update(people)
          .set({ socialAccountUuids: updatedAccounts })
          .where(eq(people.id, person.id));
      }
    }
    
    await db.delete(socialAccounts).where(eq(socialAccounts.id, id));
  }

  async deleteAllSocialAccounts(): Promise<number> {
    const allAccounts = await db.select().from(socialAccounts);
    const count = allAccounts.length;

    await db.update(people).set({ socialAccountUuids: [] });

    await db.delete(socialAccounts);

    return count;
  }

  // V1 Social account search by username with fuzzy matching and pagination
  async searchSocialAccountsByUsername(options: {
    username: string;
    platform?: string;
    page: number;
    perPage: number;
  }): Promise<{ results: SocialAccountWithCurrentProfile[]; total: number }> {
    const { username, platform, page, perPage } = options;
    const offset = (page - 1) * perPage;
    const fuzzyQuery = `%${username}%`;

    const conditions = [
      ilike(socialAccounts.username, fuzzyQuery),
    ];

    // If platform is specified, filter by social account type name
    if (platform) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${socialAccountTypes} sat
          WHERE sat.id = ${socialAccounts.typeId}
          AND LOWER(sat.name) = LOWER(${platform})
        )`
      );
    }

    const whereClause = conditions.length === 1 ? conditions[0]! : and(...conditions);

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(socialAccounts)
      .leftJoin(
        socialProfileVersions,
        and(
          eq(socialProfileVersions.socialAccountId, socialAccounts.id),
          eq(socialProfileVersions.isCurrent, true)
        )
      )
      .where(whereClause);
    const total = Number(countResult?.count || 0);

    // Prioritize exact username match, then prefix, then fuzzy
    const startQuery = `${username}%`;
    const rows = await db
      .select({
        account: socialAccounts,
        profile: socialProfileVersions,
        stateId: socialNetworkState.id,
        stateSocialAccountId: socialNetworkState.socialAccountId,
        followerCount: socialNetworkState.followerCount,
        followingCount: socialNetworkState.followingCount,
        stateUpdatedAt: socialNetworkState.updatedAt,
      })
      .from(socialAccounts)
      .leftJoin(
        socialProfileVersions,
        and(
          eq(socialProfileVersions.socialAccountId, socialAccounts.id),
          eq(socialProfileVersions.isCurrent, true)
        )
      )
      .leftJoin(
        socialNetworkState,
        eq(socialNetworkState.socialAccountId, socialAccounts.id)
      )
      .where(whereClause)
      .orderBy(
        sql`CASE
          WHEN LOWER(${socialAccounts.username}) = LOWER(${username}) THEN 0
          WHEN ${socialAccounts.username} ILIKE ${startQuery} THEN 1
          ELSE 2
        END`,
        socialAccounts.username
      )
      .offset(offset)
      .limit(perPage);

    const results = rows.map(row => {
      const state = row.stateId ? {
        id: row.stateId,
        socialAccountId: row.stateSocialAccountId,
        followerCount: row.followerCount,
        followingCount: row.followingCount,
        followers: null,
        following: null,
        updatedAt: row.stateUpdatedAt,
      } as unknown as SocialNetworkState : null;
      return this.buildSocialAccountWithProfile(row.account, row.profile, state);
    });

    return { results, total };
  }

  // V1 Bulk lookup social accounts by username+platform pairs
  async bulkLookupSocialAccounts(
    lookups: Array<{ username: string; platform: string }>
  ): Promise<{ results: Record<string, SocialAccountWithCurrentProfile>; not_found: string[] }> {
    const results: Record<string, SocialAccountWithCurrentProfile> = {};
    const notFound: string[] = [];

    for (const lookup of lookups) {
      const platformCondition = sql`EXISTS (
        SELECT 1 FROM ${socialAccountTypes} sat
        WHERE sat.id = ${socialAccounts.typeId}
        AND LOWER(sat.name) = LOWER(${lookup.platform})
      )`;

      const rows = await db
        .select({
          account: socialAccounts,
          profile: socialProfileVersions,
          stateId: socialNetworkState.id,
          stateSocialAccountId: socialNetworkState.socialAccountId,
          followerCount: socialNetworkState.followerCount,
          followingCount: socialNetworkState.followingCount,
          stateUpdatedAt: socialNetworkState.updatedAt,
        })
        .from(socialAccounts)
        .leftJoin(
          socialProfileVersions,
          and(
            eq(socialProfileVersions.socialAccountId, socialAccounts.id),
            eq(socialProfileVersions.isCurrent, true)
          )
        )
        .leftJoin(
          socialNetworkState,
          eq(socialNetworkState.socialAccountId, socialAccounts.id)
        )
        .where(
          and(
            eq(socialAccounts.username, lookup.username),
            platformCondition
          )
        )
        .limit(1);

      if (rows.length > 0) {
        const row = rows[0];
        const state = row.stateId ? {
          id: row.stateId,
          socialAccountId: row.stateSocialAccountId,
          followerCount: row.followerCount,
          followingCount: row.followingCount,
          followers: null,
          following: null,
          updatedAt: row.stateUpdatedAt,
        } as unknown as SocialNetworkState : null;
        results[lookup.username] = this.buildSocialAccountWithProfile(row.account, row.profile, state);
      } else {
        notFound.push(lookup.username);
      }
    }

    return { results, not_found: notFound };
  }

  // Social profile version operations
  async getCurrentProfileVersion(socialAccountId: string): Promise<SocialProfileVersion | null> {
    const [version] = await db
      .select()
      .from(socialProfileVersions)
      .where(
        and(
          eq(socialProfileVersions.socialAccountId, socialAccountId),
          eq(socialProfileVersions.isCurrent, true)
        )
      );
    return version || null;
  }

  async getProfileVersions(socialAccountId: string): Promise<SocialProfileVersion[]> {
    return await db
      .select()
      .from(socialProfileVersions)
      .where(eq(socialProfileVersions.socialAccountId, socialAccountId))
      .orderBy(desc(socialProfileVersions.detectedAt));
  }

  async createProfileVersion(version: InsertSocialProfileVersion): Promise<SocialProfileVersion> {
    if (version.isCurrent) {
      await db
        .update(socialProfileVersions)
        .set({ isCurrent: false })
        .where(
          and(
            eq(socialProfileVersions.socialAccountId, version.socialAccountId),
            eq(socialProfileVersions.isCurrent, true)
          )
        );
    }
    const [created] = await db.insert(socialProfileVersions).values(version).returning();
    return created;
  }

  async updateProfileVersion(id: string, data: Partial<InsertSocialProfileVersion>): Promise<SocialProfileVersion | undefined> {
    const [updated] = await db
      .update(socialProfileVersions)
      .set(data)
      .where(eq(socialProfileVersions.id, id))
      .returning();
    return updated || undefined;
  }

  async getAllProfileVersions(): Promise<SocialProfileVersion[]> {
    return await db.select().from(socialProfileVersions).orderBy(socialProfileVersions.detectedAt);
  }

  // Social network state operations
  async getNetworkState(socialAccountId: string): Promise<SocialNetworkState | null> {
    const [state] = await db
      .select()
      .from(socialNetworkState)
      .where(eq(socialNetworkState.socialAccountId, socialAccountId));
    return state || null;
  }

  async upsertNetworkState(state: InsertSocialNetworkState): Promise<SocialNetworkState> {
    const followerCount = state.followers?.length || 0;
    const followingCount = state.following?.length || 0;
    const values = { ...state, followerCount, followingCount };
    const [upserted] = await db
      .insert(socialNetworkState)
      .values(values)
      .onConflictDoUpdate({
        target: socialNetworkState.socialAccountId,
        set: {
          followerCount,
          followingCount,
          followers: state.followers,
          following: state.following,
          updatedAt: new Date(),
        },
      })
      .returning();
    return upserted;
  }

  async getAllNetworkStates(): Promise<SocialNetworkState[]> {
    return await db.select().from(socialNetworkState);
  }

  // Social network change operations
  async recordNetworkChanges(changes: InsertSocialNetworkChange[]): Promise<SocialNetworkChange[]> {
    if (changes.length === 0) return [];
    const created = await db.insert(socialNetworkChanges).values(changes).returning();
    return created;
  }

  async getNetworkChanges(socialAccountId: string, limit?: number): Promise<SocialNetworkChange[]> {
    let query = db
      .select()
      .from(socialNetworkChanges)
      .where(eq(socialNetworkChanges.socialAccountId, socialAccountId))
      .orderBy(desc(socialNetworkChanges.detectedAt));
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  async getAllNetworkChanges(): Promise<SocialNetworkChange[]> {
    return await db.select().from(socialNetworkChanges).orderBy(socialNetworkChanges.detectedAt);
  }

  // Social account type operations
  async getAllSocialAccountTypes(): Promise<SocialAccountType[]> {
    const cached = socialAccountTypesCache.get('all');
    if (cached) return cached;
    
    const result = await db.select().from(socialAccountTypes);
    socialAccountTypesCache.set('all', result);
    return result;
  }

  async getSocialAccountTypeById(id: string): Promise<SocialAccountType | undefined> {
    const [type] = await db
      .select()
      .from(socialAccountTypes)
      .where(eq(socialAccountTypes.id, id));
    return type || undefined;
  }

  async getSocialAccountTypeByName(name: string): Promise<SocialAccountType | undefined> {
    const [type] = await db
      .select()
      .from(socialAccountTypes)
      .where(sql`LOWER(${socialAccountTypes.name}) = LOWER(${name})`);
    return type || undefined;
  }

  async createSocialAccountType(type: InsertSocialAccountType): Promise<SocialAccountType> {
    const [created] = await db
      .insert(socialAccountTypes)
      .values(type)
      .returning();
    socialAccountTypesCache.invalidate('all');
    return created;
  }

  async createSocialAccountTypeWithId(type: InsertSocialAccountType & { id: string }): Promise<SocialAccountType> {
    const [created] = await db
      .insert(socialAccountTypes)
      .values(type)
      .onConflictDoNothing()
      .returning();
    socialAccountTypesCache.invalidate('all');
    return created;
  }

  async updateSocialAccountType(
    id: string,
    type: Partial<InsertSocialAccountType>
  ): Promise<SocialAccountType | undefined> {
    const [updated] = await db
      .update(socialAccountTypes)
      .set(type)
      .where(eq(socialAccountTypes.id, id))
      .returning();
    socialAccountTypesCache.invalidate('all');
    return updated || undefined;
  }

  async deleteSocialAccountType(id: string): Promise<void> {
    await db.delete(socialAccountTypes).where(eq(socialAccountTypes.id, id));
    socialAccountTypesCache.invalidate('all');
  }

  // Export helper methods
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getAllRelationships(): Promise<Relationship[]> {
    return await db.select().from(relationships);
  }

  async getAllInteractions(): Promise<Interaction[]> {
    return await db.select().from(interactions);
  }

  async getAllNotes(): Promise<Note[]> {
    return await db.select().from(notes);
  }

  async getAllGroupNotes(): Promise<GroupNote[]> {
    return await db.select().from(groupNotes);
  }

  // Import helper methods (with ID specification)
  async createPersonWithId(person: InsertPerson & { id: string }): Promise<Person> {
    const [newPerson] = await db.insert(people).values(person).returning();
    return newPerson;
  }

  async createGroupWithId(group: InsertGroup & { id: string }): Promise<Group> {
    const [newGroup] = await db.insert(groups).values(group).returning();
    return newGroup;
  }

  async createRelationshipWithId(relationship: InsertRelationship & { id: string }): Promise<Relationship> {
    const [newRelationship] = await db.insert(relationships).values(relationship).returning();
    return newRelationship;
  }

  async createInteractionWithId(interaction: InsertInteraction & { id: string }): Promise<Interaction> {
    const [newInteraction] = await db.insert(interactions).values(interaction).returning();
    return newInteraction;
  }

  async createNoteWithId(note: InsertNote & { id: string }): Promise<Note> {
    const [newNote] = await db.insert(notes).values(note).returning();
    return newNote;
  }

  async createGroupNoteWithId(groupNote: InsertGroupNote & { id: string }): Promise<GroupNote> {
    const [newGroupNote] = await db.insert(groupNotes).values(groupNote).returning();
    return newGroupNote;
  }

  async createSocialAccountWithId(account: InsertSocialAccount & { id: string }): Promise<SocialAccountWithCurrentProfile> {
    const [newAccount] = await db.insert(socialAccounts).values({
      ...account,
      internalAccountCreationDate: account.internalAccountCreationDate || new Date(),
      internalAccountCreationType: account.internalAccountCreationType || "User",
    }).returning();

    const [profileVersion] = await db.insert(socialProfileVersions).values({
      socialAccountId: newAccount.id,
      isCurrent: true,
    }).returning();

    return this.buildSocialAccountWithProfile(newAccount, profileVersion, null);
  }

  async getFlowData(personId: string, limit: number, cursor?: string): Promise<FlowResponse> {
    const cursorDate = cursor ? new Date(cursor) : new Date();
    
    // Fetch notes and interactions in parallel
    const [personNotes, personInteractions] = await Promise.all([
      db
        .select()
        .from(notes)
        .where(and(
          eq(notes.personId, personId),
          sql`${notes.createdAt} < ${cursorDate}`
        ))
        .orderBy(sql`${notes.createdAt} DESC`)
        .limit(limit + 1),
      db
        .select({
          id: interactions.id,
          peopleIds: interactions.peopleIds,
          groupIds: interactions.groupIds,
          typeId: interactions.typeId,
          title: interactions.title,
          date: interactions.date,
          description: interactions.description,
          imageUrl: interactions.imageUrl,
          createdAt: interactions.createdAt,
          type: interactionTypes,
        })
        .from(interactions)
        .leftJoin(interactionTypes, eq(interactions.typeId, interactionTypes.id))
        .where(and(
          sql`${personId} = ANY(${interactions.peopleIds})`,
          sql`${interactions.date} < ${cursorDate}`
        ))
        .orderBy(sql`${interactions.date} DESC`)
        .limit(limit + 1),
    ]);

    // Transform each type into FlowItem format
    const noteItems: FlowItem[] = personNotes.map(note => ({
      id: note.id,
      type: 'note' as const,
      date: note.createdAt,
      content: note.content,
      imageUrl: note.imageUrl,
    }));

    const interactionItems: FlowItem[] = personInteractions.map(interaction => ({
      id: interaction.id,
      type: 'interaction' as const,
      date: interaction.date,
      content: interaction.description || '',
      title: interaction.title,
      description: interaction.description,
      interactionType: interaction.type || undefined,
      peopleIds: interaction.peopleIds || [],
      groupIds: interaction.groupIds || [],
      imageUrl: interaction.imageUrl,
    }));

    // Merge and sort all items by date descending
    const allItems = [...noteItems, ...interactionItems]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Check if there are more items
    const hasMore = allItems.length > limit;
    const items = allItems.slice(0, limit);

    // Calculate next cursor from the oldest item
    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1].date.toISOString()
      : null;

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  async megaSearch(query: string, options: {
    includePeople?: boolean;
    includeGroups?: boolean;
    includeInteractions?: boolean;
    includeNotes?: boolean;
    includeSocialProfiles?: boolean;
  }): Promise<MegaSearchResult> {
    const searchPattern = `%${query}%`;
    const startPattern = `${query}%`;
    
    const results: MegaSearchResult = {
      people: [],
      groups: [],
      interactions: [],
      notes: [],
      socialProfiles: [],
    };

    const searchPromises: Promise<void>[] = [];

    if (options.includePeople !== false) {
      searchPromises.push(
        db.select().from(people)
          .where(or(
            ilike(people.firstName, searchPattern),
            ilike(people.lastName, searchPattern),
            ilike(people.company, searchPattern),
            ilike(people.title, searchPattern),
            ilike(people.email, searchPattern),
            ilike(people.phone, searchPattern),
            sql`EXISTS (SELECT 1 FROM unnest(${people.tags}) AS t WHERE t ILIKE ${searchPattern})`
          ))
          .orderBy(
            sql`CASE WHEN ${people.firstName} ILIKE ${startPattern} OR ${people.lastName} ILIKE ${startPattern} THEN 0 ELSE 1 END`,
            people.firstName,
            people.lastName
          )
          .limit(10)
          .then(res => { results.people = res; })
      );
    }

    if (options.includeGroups !== false) {
      searchPromises.push(
        db.select().from(groups)
          .where(ilike(groups.name, searchPattern))
          .orderBy(
            sql`CASE WHEN ${groups.name} ILIKE ${startPattern} THEN 0 ELSE 1 END`,
            groups.name
          )
          .limit(10)
          .then(res => { results.groups = res; })
      );
    }

    if (options.includeInteractions !== false) {
      searchPromises.push(
        db.select().from(interactions)
          .where(or(
            ilike(interactions.title, searchPattern),
            ilike(interactions.description, searchPattern)
          ))
          .orderBy(interactions.date)
          .limit(10)
          .then(res => { results.interactions = res; })
      );
    }

    if (options.includeNotes !== false) {
      searchPromises.push(
        db.select().from(notes)
          .where(ilike(notes.content, searchPattern))
          .orderBy(notes.createdAt)
          .limit(10)
          .then(res => { results.notes = res; })
      );
    }

    if (options.includeSocialProfiles !== false) {
      searchPromises.push(
        db.select({
            account: socialAccounts,
            profile: socialProfileVersions,
          })
          .from(socialAccounts)
          .leftJoin(
            socialProfileVersions,
            and(
              eq(socialProfileVersions.socialAccountId, socialAccounts.id),
              eq(socialProfileVersions.isCurrent, true)
            )
          )
          .where(or(
            ilike(socialAccounts.username, searchPattern),
            ilike(socialProfileVersions.nickname, searchPattern),
            ilike(socialProfileVersions.bio, searchPattern),
            ilike(socialProfileVersions.accountUrl, searchPattern)
          ))
          .orderBy(
            sql`CASE WHEN ${socialAccounts.username} ILIKE ${startPattern} THEN 0 ELSE 1 END`,
            socialAccounts.username
          )
          .limit(10)
          .then(rows => {
            results.socialProfiles = rows.map(row => ({
              ...row.account,
              currentProfile: row.profile || null,
              latestState: null,
            }));
          })
      );
    }

    await Promise.all(searchPromises);

    return results;
  }

  // Task operations
  async createTask(insertTask: InsertTask): Promise<Task> {
    const [task] = await db.insert(tasks).values(insertTask).returning();
    return task;
  }

  async getNextPendingTask(): Promise<Task | undefined> {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.status, "pending"))
      .orderBy(tasks.createdAt)
      .limit(1);
    return task || undefined;
  }

  async updateTaskStatus(id: string, status: string, result?: string): Promise<Task | undefined> {
    const updates: Partial<typeof tasks.$inferInsert> & { startedAt?: Date; completedAt?: Date } = { status };
    if (status === "in_progress") {
      updates.startedAt = new Date();
    }
    if (status === "completed" || status === "failed") {
      updates.completedAt = new Date();
      updates.progress = 100;
    }
    if (result !== undefined) {
      updates.result = result;
    }
    const [task] = await db
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, id))
      .returning();
    return task || undefined;
  }

  async updateTaskProgress(id: string, progress: number, message?: string): Promise<void> {
    const updates: Partial<typeof tasks.$inferInsert> = { progress };
    if (message !== undefined) {
      updates.progressMessage = message;
    }
    await db.update(tasks).set(updates).where(eq(tasks.id, id));
  }

  async getTasksByStatus(status: string): Promise<Task[]> {
    const rows = await db
      .select({
        id: tasks.id,
        type: tasks.type,
        status: tasks.status,
        payload: tasks.payload,
        result: sql<string | null>`LEFT(${tasks.result}, 2000)`,
        progress: tasks.progress,
        progressMessage: tasks.progressMessage,
        createdAt: tasks.createdAt,
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(eq(tasks.status, status))
      .orderBy(tasks.createdAt);
    return rows as Task[];
  }

  async getAllTasks(limit: number = 100): Promise<Task[]> {
    const rows = await db
      .select({
        id: tasks.id,
        type: tasks.type,
        status: tasks.status,
        payload: tasks.payload,
        result: sql<string | null>`LEFT(${tasks.result}, 2000)`,
        progress: tasks.progress,
        progressMessage: tasks.progressMessage,
        createdAt: tasks.createdAt,
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .orderBy(desc(tasks.createdAt))
      .limit(limit);
    return rows as Task[];
  }

  async getTaskById(id: string): Promise<Task | undefined> {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id));
    return task || undefined;
  }

  async deleteAllTasks(): Promise<void> {
    await db.delete(tasks);
  }

  // Social account post operations
  async getPostsBySocialAccountId(socialAccountId: string, includeDeleted: boolean = false): Promise<SocialAccountPost[]> {
    const conditions = [eq(socialAccountPosts.socialAccountId, socialAccountId)];
    if (!includeDeleted) {
      conditions.push(eq(socialAccountPosts.isDeleted, false));
    }
    return await db
      .select()
      .from(socialAccountPosts)
      .where(and(...conditions))
      .orderBy(desc(socialAccountPosts.createdAt));
  }

  async getAllPosts(): Promise<SocialAccountPost[]> {
    return await db
      .select()
      .from(socialAccountPosts)
      .where(eq(socialAccountPosts.isDeleted, false))
      .orderBy(desc(socialAccountPosts.createdAt));
  }

  async getPostById(id: string): Promise<SocialAccountPost | undefined> {
    const [post] = await db
      .select()
      .from(socialAccountPosts)
      .where(eq(socialAccountPosts.id, id));
    return post || undefined;
  }

  async createPost(post: InsertSocialAccountPost): Promise<SocialAccountPost> {
    const [created] = await db
      .insert(socialAccountPosts)
      .values(post)
      .returning();
    return created;
  }

  async updatePost(id: string, post: Partial<InsertSocialAccountPost>): Promise<SocialAccountPost | undefined> {
    const [updated] = await db
      .update(socialAccountPosts)
      .set({ ...post, updatedAt: new Date() })
      .where(eq(socialAccountPosts.id, id))
      .returning();
    return updated || undefined;
  }

  async deletePost(id: string): Promise<void> {
    await db.delete(socialAccountPosts).where(eq(socialAccountPosts.id, id));
  }

  // Photo operations
  async insertPhoto(photo: InsertPhoto): Promise<Photo> {
    const [created] = await db
      .insert(photos)
      .values(photo)
      .returning();
    return created;
  }

  async getPhotoById(id: string): Promise<Photo | undefined> {
    const [photo] = await db
      .select()
      .from(photos)
      .where(eq(photos.id, id));
    return photo || undefined;
  }

  async getPhotoByLocation(location: string): Promise<Photo | undefined> {
    const [photo] = await db
      .select()
      .from(photos)
      .where(eq(photos.location, location));
    return photo || undefined;
  }

  async listPhotos(options: { prmLocationPrefix?: string; limit?: number; offset?: number } = {}): Promise<{ items: Photo[]; total: number }> {
    const { prmLocationPrefix, limit = 100, offset = 0 } = options;
    const whereCondition = prmLocationPrefix
      ? sql`${photos.prmLocation} LIKE ${prmLocationPrefix + '%'}`
      : undefined;

    const [items, countResult] = await Promise.all([
      whereCondition
        ? db.select().from(photos).where(whereCondition).orderBy(desc(photos.uploadedAt)).limit(limit).offset(offset)
        : db.select().from(photos).orderBy(desc(photos.uploadedAt)).limit(limit).offset(offset),
      whereCondition
        ? db.select({ count: sql<number>`count(*)::int` }).from(photos).where(whereCondition)
        : db.select({ count: sql<number>`count(*)::int` }).from(photos),
    ]);

    return { items, total: countResult[0]?.count ?? 0 };
  }

  async updatePhotoLocation(oldLocation: string, newLocation: string): Promise<void> {
    await db
      .update(photos)
      .set({ location: newLocation })
      .where(eq(photos.location, oldLocation));
  }

  async updatePhotoMeta(id: string, data: Partial<Pick<Photo, 'fileHash' | 'widthPx' | 'heightPx' | 'metadata' | 'imageDescription' | 'imageDescriptionAt' | 'faceUuids' | 'faceIdAt' | 'processedAt'>>): Promise<void> {
    if (Object.keys(data).length === 0) return;
    await db.update(photos).set(data as any).where(eq(photos.id, id));
  }

  async getPhotoByHash(fileHash: string): Promise<Photo | undefined> {
    const [photo] = await db.select().from(photos).where(eq(photos.fileHash, fileHash));
    return photo || undefined;
  }

  async getPhotoParent(subImageId: string): Promise<Photo | undefined> {
    // Find a photo whose faceUuids JSONB array contains an entry with this subImagePhotoId
    const [photo] = await db
      .select()
      .from(photos)
      .where(sql`${photos.faceUuids} @> ${JSON.stringify([{ subImagePhotoId: subImageId }])}::jsonb`)
      .limit(1);
    return photo || undefined;
  }

  // Image task operations
  async createImageTask(task: InsertImageTask): Promise<ImageTask> {
    const [created] = await db.insert(imageTasks).values(task).returning();
    return created;
  }

  async getImageTaskById(id: string): Promise<ImageTask | undefined> {
    const [task] = await db.select().from(imageTasks).where(eq(imageTasks.id, id));
    return task || undefined;
  }

  async getNextPendingImageTask(): Promise<ImageTask | undefined> {
    const [task] = await db
      .select()
      .from(imageTasks)
      .where(eq(imageTasks.status, "pending"))
      .orderBy(imageTasks.createdAt)
      .limit(1);
    return task || undefined;
  }

  async updateImageTaskStatus(id: string, status: string, result?: string): Promise<void> {
    const updates: Partial<typeof imageTasks.$inferInsert> & { startedAt?: Date; completedAt?: Date } = { status };
    if (status === "in_progress") updates.startedAt = new Date();
    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.completedAt = new Date();
      if (status === "completed") updates.progress = 100;
    }
    if (result !== undefined) updates.result = result;
    await db.update(imageTasks).set(updates).where(eq(imageTasks.id, id));
  }

  async updateImageTaskProgress(id: string, progress: number, message?: string): Promise<void> {
    const updates: Partial<typeof imageTasks.$inferInsert> = { progress };
    if (message !== undefined) updates.progressMessage = message;
    await db.update(imageTasks).set(updates).where(eq(imageTasks.id, id));
  }

  async listImageTasks(options: { type?: string; status?: string; parentTaskId?: string; limit?: number; offset?: number } = {}): Promise<{ items: ImageTask[]; total: number }> {
    const { type, status, parentTaskId, limit = 25, offset = 0 } = options;
    const conditions = [];
    if (type) conditions.push(eq(imageTasks.type, type));
    if (status) conditions.push(eq(imageTasks.status, status));
    if (parentTaskId) conditions.push(eq(imageTasks.parentTaskId, parentTaskId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, countResult] = await Promise.all([
      whereClause
        ? db.select().from(imageTasks).where(whereClause).orderBy(desc(imageTasks.createdAt)).limit(limit).offset(offset)
        : db.select().from(imageTasks).orderBy(desc(imageTasks.createdAt)).limit(limit).offset(offset),
      whereClause
        ? db.select({ count: sql<number>`count(*)::int` }).from(imageTasks).where(whereClause)
        : db.select({ count: sql<number>`count(*)::int` }).from(imageTasks),
    ]);
    return { items, total: countResult[0]?.count ?? 0 };
  }

  async cancelImageTask(id: string): Promise<void> {
    await db
      .update(imageTasks)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(imageTasks.id, id), sql`${imageTasks.status} IN ('pending', 'in_progress')`));
  }

  // Daily note helpers
  private isDailyNoteEditable(dateStr: string): boolean {
    const today = new Date();
    const noteDate = new Date(dateStr + "T00:00:00");
    const diffMs = today.getTime() - noteDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays <= 1;
  }

  private async buildDailyNoteWithDetails(note: DailyNote): Promise<DailyNoteWithDetails> {
    const [events, parties] = await Promise.all([
      db.select().from(dailyNoteEvents).where(eq(dailyNoteEvents.dailyNoteId, note.id)).orderBy(dailyNoteEvents.position),
      db.select().from(dailyNoteInvolvedParties).where(eq(dailyNoteInvolvedParties.dailyNoteId, note.id)),
    ]);

    // Resolve human-readable labels for each party
    const personIds = parties.filter(p => p.partyType === "person").map(p => p.refId);
    const groupIds = parties.filter(p => p.partyType === "group").map(p => p.refId);
    const socialIds = parties.filter(p => p.partyType === "social_account").map(p => p.refId);

    const [personRows, groupRows, socialRows] = await Promise.all([
      personIds.length > 0
        ? db.select({ id: people.id, firstName: people.firstName, lastName: people.lastName }).from(people).where(inArray(people.id, personIds))
        : [],
      groupIds.length > 0
        ? db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupIds))
        : [],
      socialIds.length > 0
        ? db.select({ id: socialAccounts.id, username: socialAccounts.username }).from(socialAccounts).where(inArray(socialAccounts.id, socialIds))
        : [],
    ]);

    const labelMap: Record<string, string> = {};
    (personRows as { id: string; firstName: string | null; lastName: string | null }[]).forEach(p => {
      labelMap[p.id] = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.id;
    });
    (groupRows as { id: string; name: string }[]).forEach(g => { labelMap[g.id] = g.name || g.id; });
    (socialRows as { id: string; username: string }[]).forEach(s => { labelMap[s.id] = s.username || s.id; });

    const involvedParties: DailyNoteInvolvedPartyWithLabel[] = parties.map(p => ({
      ...p,
      label: labelMap[p.refId] ?? p.refId,
    }));

    return { ...note, events, involvedParties, isEditable: this.isDailyNoteEditable(note.date) };
  }

  async listDailyNotes(): Promise<DailyNoteWithDetails[]> {
    const allNotes = await db.select().from(dailyNotes).orderBy(desc(dailyNotes.date));
    return Promise.all(allNotes.map(n => this.buildDailyNoteWithDetails(n)));
  }

  async getDailyNoteById(id: string): Promise<DailyNoteWithDetails | undefined> {
    const [note] = await db.select().from(dailyNotes).where(eq(dailyNotes.id, id));
    if (!note) return undefined;
    return this.buildDailyNoteWithDetails(note);
  }

  async getDailyNoteByDate(date: string): Promise<DailyNoteWithDetails | undefined> {
    const [note] = await db.select().from(dailyNotes).where(eq(dailyNotes.date, date));
    if (!note) return undefined;
    return this.buildDailyNoteWithDetails(note);
  }

  async createDailyNote(data: InsertDailyNote): Promise<DailyNoteWithDetails> {
    const [note] = await db.insert(dailyNotes).values(data).returning();
    return this.buildDailyNoteWithDetails(note);
  }

  async updateDailyNote(id: string, data: Partial<InsertDailyNote>): Promise<DailyNoteWithDetails | undefined> {
    const [updated] = await db.update(dailyNotes).set(data).where(eq(dailyNotes.id, id)).returning();
    if (!updated) return undefined;
    return this.buildDailyNoteWithDetails(updated);
  }

  async deleteDailyNote(id: string): Promise<void> {
    await db.delete(dailyNotes).where(eq(dailyNotes.id, id));
  }

  async replaceDailyNoteEvents(dailyNoteId: string, events: Array<{ text: string; position: number }>): Promise<DailyNoteEvent[]> {
    await db.delete(dailyNoteEvents).where(eq(dailyNoteEvents.dailyNoteId, dailyNoteId));
    if (events.length === 0) return [];
    const inserted = await db.insert(dailyNoteEvents).values(events.map(e => ({ dailyNoteId, text: e.text, position: e.position }))).returning();
    return inserted.sort((a, b) => a.position - b.position);
  }

  async replaceDailyNoteParties(dailyNoteId: string, parties: Array<{ partyType: string; refId: string }>): Promise<DailyNoteInvolvedParty[]> {
    await db.delete(dailyNoteInvolvedParties).where(eq(dailyNoteInvolvedParties.dailyNoteId, dailyNoteId));
    if (parties.length === 0) return [];
    const inserted = await db.insert(dailyNoteInvolvedParties).values(parties.map(p => ({ dailyNoteId, partyType: p.partyType, refId: p.refId }))).returning();
    return inserted;
  }

  async deleteInstagramImageUrls(): Promise<{ profileVersionsCleared: number; postsCleared: number; photosDeleted: number }> {
    const igPattern = '(cdninstagram\\.com|fbcdn\\.net)';

    const [imgUrlResult, extImgUrlResult, postsResult, photosResult] = await Promise.all([
      db
        .update(socialProfileVersions)
        .set({ imageUrl: null })
        .where(sql`${socialProfileVersions.imageUrl} ~ ${igPattern}`)
        .returning({ id: socialProfileVersions.id }),
      db
        .update(socialProfileVersions)
        .set({ externalImageUrl: null })
        .where(sql`${socialProfileVersions.externalImageUrl} ~ ${igPattern}`)
        .returning({ id: socialProfileVersions.id }),
      db
        .update(socialAccountPosts)
        .set({ content: null })
        .where(sql`${socialAccountPosts.content} ~ ${igPattern}`)
        .returning({ id: socialAccountPosts.id }),
      db
        .delete(photos)
        .where(sql`${photos.location} ~ ${igPattern}`)
        .returning({ id: photos.id }),
    ]);

    const clearedProfileVersionIds = new Set([
      ...imgUrlResult.map((r) => r.id),
      ...extImgUrlResult.map((r) => r.id),
    ]);

    return {
      profileVersionsCleared: clearedProfileVersionIds.size,
      postsCleared: postsResult.length,
      photosDeleted: photosResult.length,
    };
  }
}

export const storage = new DatabaseStorage();
