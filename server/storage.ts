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
  messages,
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
  tasks,
  type Message,
  type InsertMessage,
  type Task,
  type InsertTask,
  type FlowItem,
  type FlowResponse,
  type MegaSearchResult,
  type SocialGraphSettings,
  type SocialGraphData,
  type SocialGraphNode,
  type SocialGraphLink,
} from "@shared/schema";
import { db, pool } from "./db";
import { eq, or, and, ilike, sql, inArray, arrayContains } from "drizzle-orm";
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

export interface IStorage {
  // Graph operations
  getGraphData(): Promise<{
    people: Array<{ id: string; firstName: string; lastName: string; company: string | null }>;
    relationships: Array<{ id: string; fromPersonId: string; toPersonId: string; typeColor: string | null }>;
    groups: Array<{ id: string; name: string; color: string; members: string[] }>;
  }>;

  // People operations
  getAllPeople(searchQuery?: string): Promise<Person[]>;
  getAllPeopleWithRelationships(): Promise<Array<Person & { relationships: RelationshipWithPerson[] }>>;
  getPeoplePaginated(offset: number, limit: number, mePersonId?: string, sortByElo?: boolean): Promise<Array<Person & { maxRelationshipValue: number | null; relationshipTypeName: string | null; relationshipTypeColor: string | null; groupCount: number }>>;
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
  getAllSocialAccounts(searchQuery?: string, typeId?: string): Promise<SocialAccount[]>;
  getSocialAccountsPaginated(options: {
    offset: number;
    limit: number;
    searchQuery?: string;
    typeId?: string;
    followsAccountIds?: string[];
  }): Promise<SocialAccount[]>;
  getSocialAccountById(id: string): Promise<SocialAccount | undefined>;
  createSocialAccount(account: InsertSocialAccount): Promise<SocialAccount>;
  updateSocialAccount(id: string, account: Partial<InsertSocialAccount>): Promise<SocialAccount | undefined>;
  deleteSocialAccount(id: string): Promise<void>;
  deleteAllSocialAccounts(): Promise<number>;
  addFollower(accountId: string, followerId: string): Promise<void>;
  removeFollower(accountId: string, followerId: string): Promise<void>;
  addFollowing(accountId: string, followingId: string): Promise<void>;
  removeFollowing(accountId: string, followingId: string): Promise<void>;

  // Social account type operations
  getAllSocialAccountTypes(): Promise<SocialAccountType[]>;
  getSocialAccountTypeById(id: string): Promise<SocialAccountType | undefined>;
  getSocialAccountTypeByName(name: string): Promise<SocialAccountType | undefined>;
  createSocialAccountType(type: InsertSocialAccountType): Promise<SocialAccountType>;
  createSocialAccountTypeWithId(type: InsertSocialAccountType & { id: string }): Promise<SocialAccountType>;
  updateSocialAccountType(id: string, type: Partial<InsertSocialAccountType>): Promise<SocialAccountType | undefined>;
  deleteSocialAccountType(id: string): Promise<void>;

  // Message operations
  getAllMessages(): Promise<Message[]>;
  getMessageById(id: string): Promise<Message | undefined>;
  getMessagesBySenderOrReceiver(identifier: string): Promise<Message[]>;
  getOrphanMessages(): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  createMessageWithId(message: InsertMessage & { id: string }): Promise<Message>;
  updateMessage(id: string, message: Partial<InsertMessage>): Promise<Message | undefined>;
  deleteMessage(id: string): Promise<void>;
  deleteMultipleMessages(ids: string[]): Promise<void>;
  deleteAllMessages(messageType?: string): Promise<number>;
  updateMessageOrphanStatus(id: string, isOrphan: boolean): Promise<Message | undefined>;
  
  // Flow operations (unified timeline)
  getFlowData(personId: string, limit: number, cursor?: string): Promise<FlowResponse>;
  
  // Mega search operations
  megaSearch(query: string, options: {
    includePeople?: boolean;
    includeGroups?: boolean;
    includeInteractions?: boolean;
    includeNotes?: boolean;
    includeSocialProfiles?: boolean;
    includeMessages?: boolean;
  }): Promise<MegaSearchResult>;
  
  // Task operations
  createTask(task: InsertTask): Promise<Task>;
  getNextPendingTask(): Promise<Task | undefined>;
  updateTaskStatus(id: string, status: string, result?: string): Promise<Task | undefined>;
  getTasksByStatus(status: string): Promise<Task[]>;

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
    people: Array<{ id: string; firstName: string; lastName: string; company: string | null }>;
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
      people: peopleData,
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
    sortByElo?: boolean
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
        ...(sortByElo
          ? [sql`${people.eloScore} DESC`, people.firstName, people.lastName]
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
    const [personNotes, personInteractions, personGroups, personMessages, relationshipsFrom, relationshipsTo] = await Promise.all([
      db.select().from(notes).where(eq(notes.personId, id)),
      db.select().from(interactions).where(sql`${id} = ANY(${interactions.peopleIds})`),
      db.select().from(groups).where(arrayContains(groups.members, [id])),
      // Get messages where person's identifiers appear in sender or receivers
      identifiers.length > 0
        ? db
            .select()
            .from(messages)
            .where(
              or(
                inArray(messages.sender, identifiers),
                sql`${messages.receivers} && ${sql`ARRAY[${sql.join(identifiers.map(i => sql`${i}`), sql`, `)}]::text[]`}`
              )
            )
            .orderBy(messages.sentTimestamp)
        : Promise.resolve([]),
      db
        .select({
          id: relationships.id,
          fromPersonId: relationships.fromPersonId,
          toPersonId: relationships.toPersonId,
          typeId: relationships.typeId,
          notes: relationships.notes,
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
      messages: personMessages,
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
    const allAccounts = await db.select().from(socialAccounts);
    const allTypes = await db.select().from(socialAccountTypes);

    const typeColorMap = new Map<string, string>();
    allTypes.forEach(t => {
      if (t.color) typeColorMap.set(t.id, t.color);
    });

    const allAccountIds = new Set(allAccounts.map(a => a.id));

    const directConnectionsMap = new Map<string, Set<string>>();
    allAccounts.forEach(a => directConnectionsMap.set(a.id, new Set()));

    allAccounts.forEach(account => {
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

    let filtered = allAccounts;

    if (settings.hideOrphans) {
      filtered = filtered.filter(a => (uniqueConnectionCounts.get(a.id) || 0) > 0);
    }

    if (settings.minConnections > 0) {
      filtered = filtered.filter(a => (uniqueConnectionCounts.get(a.id) || 0) >= settings.minConnections);
    }

    if (settings.limitExtras && settings.minConnections < 2) {
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

    let nodes: SocialGraphNode[] = filtered.map(a => ({
      id: a.id,
      name: a.nickname || a.username,
      typeColor: (a.typeId ? typeColorMap.get(a.typeId) : null) || '#10b981',
      connectionCount: uniqueConnectionCounts.get(a.id) || 0,
      val: 10,
      size: 50,
    }));

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

  // Social account operations
  async getAllSocialAccounts(searchQuery?: string, typeId?: string): Promise<SocialAccount[]> {
    const conditions = [];
    
    if (searchQuery) {
      const query = `%${searchQuery}%`;
      conditions.push(
        or(
          ilike(socialAccounts.username, query),
          ilike(socialAccounts.accountUrl, query)
        )
      );
    }
    
    if (typeId) {
      conditions.push(eq(socialAccounts.typeId, typeId));
    }
    
    if (conditions.length === 0) {
      return await db.select().from(socialAccounts).orderBy(socialAccounts.username);
    }

    const startQuery = searchQuery ? `${searchQuery}%` : null;
    
    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
    
    return await db
      .select()
      .from(socialAccounts)
      .where(whereClause)
      .orderBy(
        startQuery 
          ? sql`CASE WHEN ${socialAccounts.username} ILIKE ${startQuery} THEN 0 ELSE 1 END`
          : socialAccounts.username,
        socialAccounts.username
      );
  }

  async getSocialAccountsPaginated(options: {
    offset: number;
    limit: number;
    searchQuery?: string;
    typeId?: string;
    followsAccountIds?: string[];
  }): Promise<SocialAccount[]> {
    const { offset, limit, searchQuery, typeId, followsAccountIds } = options;
    const conditions = [];

    if (searchQuery) {
      const query = `%${searchQuery}%`;
      conditions.push(
        or(
          ilike(socialAccounts.username, query),
          ilike(socialAccounts.accountUrl, query),
          ilike(socialAccounts.nickname, query)
        )
      );
    }

    if (typeId) {
      conditions.push(eq(socialAccounts.typeId, typeId));
    }

    if (followsAccountIds && followsAccountIds.length > 0) {
      const followConditions = followsAccountIds.map(id =>
        arrayContains(socialAccounts.following, [id])
      );
      conditions.push(
        followConditions.length === 1 ? followConditions[0]! : or(...followConditions)!
      );
    }

    const whereClause = conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

    const startQuery = searchQuery ? `${searchQuery}%` : null;

    const query = db
      .select()
      .from(socialAccounts);

    if (whereClause) {
      return await query
        .where(whereClause)
        .orderBy(
          startQuery
            ? sql`CASE WHEN ${socialAccounts.username} ILIKE ${startQuery} THEN 0 ELSE 1 END`
            : socialAccounts.username,
          socialAccounts.username
        )
        .offset(offset)
        .limit(limit);
    }

    return await query
      .orderBy(socialAccounts.username)
      .offset(offset)
      .limit(limit);
  }

  async getSocialAccountById(id: string): Promise<SocialAccount | undefined> {
    const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, id));
    return account || undefined;
  }

  async createSocialAccount(insertAccount: InsertSocialAccount): Promise<SocialAccount> {
    const [account] = await db.insert(socialAccounts).values({
      ...insertAccount,
      internalAccountCreationDate: new Date(),
      internalAccountCreationType: insertAccount.internalAccountCreationType || "User",
    }).returning();
    return account;
  }

  async updateSocialAccount(
    id: string,
    accountData: Partial<InsertSocialAccount>
  ): Promise<SocialAccount | undefined> {
    const [account] = await db
      .update(socialAccounts)
      .set(accountData)
      .where(eq(socialAccounts.id, id))
      .returning();
    return account || undefined;
  }

  async deleteSocialAccount(id: string): Promise<void> {
    // Remove from people's socialAccountUuids
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
    
    // Delete the social account
    await db.delete(socialAccounts).where(eq(socialAccounts.id, id));
  }

  async deleteAllSocialAccounts(): Promise<number> {
    // Get the count before deletion
    const allAccounts = await db.select().from(socialAccounts);
    const count = allAccounts.length;

    // Clear all people's socialAccountUuids
    await db.update(people).set({ socialAccountUuids: [] });

    // Delete all social accounts
    await db.delete(socialAccounts);

    return count;
  }

  async addFollower(accountId: string, followerId: string): Promise<void> {
    const account = await this.getSocialAccountById(accountId);
    if (!account) throw new Error("Account not found");
    
    const currentFollowers = account.followers || [];
    if (!currentFollowers.includes(followerId)) {
      await db
        .update(socialAccounts)
        .set({ followers: [...currentFollowers, followerId] })
        .where(eq(socialAccounts.id, accountId));
    }
  }

  async removeFollower(accountId: string, followerId: string): Promise<void> {
    const account = await this.getSocialAccountById(accountId);
    if (!account) throw new Error("Account not found");
    
    const currentFollowers = account.followers || [];
    const updatedFollowers = currentFollowers.filter(id => id !== followerId);
    await db
      .update(socialAccounts)
      .set({ followers: updatedFollowers })
      .where(eq(socialAccounts.id, accountId));
  }

  async addFollowing(accountId: string, followingId: string): Promise<void> {
    const account = await this.getSocialAccountById(accountId);
    if (!account) throw new Error("Account not found");
    
    const currentFollowing = account.following || [];
    if (!currentFollowing.includes(followingId)) {
      await db
        .update(socialAccounts)
        .set({ following: [...currentFollowing, followingId] })
        .where(eq(socialAccounts.id, accountId));
    }
  }

  async removeFollowing(accountId: string, followingId: string): Promise<void> {
    const account = await this.getSocialAccountById(accountId);
    if (!account) throw new Error("Account not found");
    
    const currentFollowing = account.following || [];
    const updatedFollowing = currentFollowing.filter(id => id !== followingId);
    await db
      .update(socialAccounts)
      .set({ following: updatedFollowing })
      .where(eq(socialAccounts.id, accountId));
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

  async createSocialAccountWithId(account: InsertSocialAccount & { id: string }): Promise<SocialAccount> {
    const [newAccount] = await db.insert(socialAccounts).values({
      ...account,
      internalAccountCreationDate: new Date(),
      internalAccountCreationType: account.internalAccountCreationType || "User",
    }).returning();
    return newAccount;
  }

  // Message operations
  async getAllMessages(): Promise<Message[]> {
    return await db.select().from(messages).orderBy(messages.sentTimestamp);
  }

  async getMessageById(id: string): Promise<Message | undefined> {
    const [result] = await db.select().from(messages).where(eq(messages.id, id));
    return result || undefined;
  }

  async getMessagesBySenderOrReceiver(identifier: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(
        or(
          eq(messages.sender, identifier),
          sql`${identifier} = ANY(${messages.receivers})`
        )
      )
      .orderBy(messages.sentTimestamp);
  }

  async getOrphanMessages(): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.isOrphan, true))
      .orderBy(messages.sentTimestamp);
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [created] = await db
      .insert(messages)
      .values(message)
      .returning();
    return created;
  }

  async createMessageWithId(message: InsertMessage & { id: string; uploadTimestamp?: Date }): Promise<Message> {
    const [newMessage] = await db.insert(messages).values(message).returning();
    return newMessage;
  }

  async updateMessage(
    id: string,
    message: Partial<InsertMessage>
  ): Promise<Message | undefined> {
    const [updated] = await db
      .update(messages)
      .set(message)
      .where(eq(messages.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteMessage(id: string): Promise<void> {
    await db.delete(messages).where(eq(messages.id, id));
  }

  async deleteMultipleMessages(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(messages).where(inArray(messages.id, ids));
  }

  async deleteAllMessages(messageType?: string): Promise<number> {
    if (messageType && messageType !== "all") {
      const matchingMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.type, messageType));
      const count = matchingMessages.length;
      if (count > 0) {
        await db.delete(messages).where(eq(messages.type, messageType));
      }
      return count;
    } else {
      const allMessages = await db.select().from(messages);
      const count = allMessages.length;
      await db.delete(messages);
      return count;
    }
  }

  async updateMessageOrphanStatus(id: string, isOrphan: boolean): Promise<Message | undefined> {
    const [updated] = await db
      .update(messages)
      .set({ isOrphan })
      .where(eq(messages.id, id))
      .returning();
    return updated || undefined;
  }

  async getFlowData(personId: string, limit: number, cursor?: string): Promise<FlowResponse> {
    const cursorDate = cursor ? new Date(cursor) : new Date();
    
    // Get person to find their identifiers
    const [person] = await db.select().from(people).where(eq(people.id, personId));
    
    // Build list of identifiers for this person
    const identifiers: string[] = [];
    if (person) {
      if (person.email) identifiers.push(person.email);
      if (person.phone) identifiers.push(person.phone);
      if (person.socialAccountUuids && person.socialAccountUuids.length > 0) {
        identifiers.push(...person.socialAccountUuids);
      }
    }
    
    // Fetch all three data types in parallel
    const [personNotes, personInteractions, personMessages] = await Promise.all([
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
      // Get messages where person's identifiers appear in sender or receivers
      identifiers.length > 0
        ? db
            .select()
            .from(messages)
            .where(and(
              or(
                inArray(messages.sender, identifiers),
                sql`${messages.receivers} && ${sql`ARRAY[${sql.join(identifiers.map(i => sql`${i}`), sql`, `)}]::text[]`}`
              ),
              sql`${messages.sentTimestamp} < ${cursorDate}`
            ))
            .orderBy(sql`${messages.sentTimestamp} DESC`)
            .limit(limit + 1)
        : Promise.resolve([]),
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

    const messageItems: FlowItem[] = personMessages.map(msg => ({
      id: msg.id,
      type: 'message' as const,
      date: msg.sentTimestamp,
      content: msg.content || '',
      messageType: msg.type as 'email' | 'phone' | 'social',
      sender: msg.sender,
      receivers: msg.receivers || [],
      imageUrls: msg.imageUrls,
      isOrphan: msg.isOrphan,
    }));

    // Merge and sort all items by date descending
    const allItems = [...noteItems, ...interactionItems, ...messageItems]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Check if there are more items
    const hasMore = allItems.length > limit;
    const items = allItems.slice(0, limit);

    // Calculate next cursor from the oldest item
    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1].date.toISOString()
      : null;

    // Build identifier to name mapping for all unique senders/receivers in messages
    const allMessageIdentifiers = new Set<string>();
    for (const msg of personMessages) {
      if (msg.sender) allMessageIdentifiers.add(msg.sender);
      if (msg.receivers) {
        for (const r of msg.receivers) {
          allMessageIdentifiers.add(r);
        }
      }
    }

    // Look up names for identifiers by matching against people's phone/email
    const identifierToName: Record<string, string> = {};
    if (allMessageIdentifiers.size > 0) {
      const identifierArray = Array.from(allMessageIdentifiers);
      const matchingPeople = await db.select({
        firstName: people.firstName,
        lastName: people.lastName,
        phone: people.phone,
        email: people.email,
      }).from(people).where(
        or(
          inArray(people.phone, identifierArray),
          inArray(people.email, identifierArray)
        )
      );

      for (const p of matchingPeople) {
        const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
        if (p.phone && identifierArray.includes(p.phone)) {
          identifierToName[p.phone] = name;
        }
        if (p.email && identifierArray.includes(p.email)) {
          identifierToName[p.email] = name;
        }
      }
    }

    return {
      items,
      nextCursor,
      hasMore,
      personIdentifiers: identifiers,
      identifierToName,
    };
  }

  async megaSearch(query: string, options: {
    includePeople?: boolean;
    includeGroups?: boolean;
    includeInteractions?: boolean;
    includeNotes?: boolean;
    includeSocialProfiles?: boolean;
    includeMessages?: boolean;
  }): Promise<MegaSearchResult> {
    const searchPattern = `%${query}%`;
    const startPattern = `${query}%`;
    
    const results: MegaSearchResult = {
      people: [],
      groups: [],
      interactions: [],
      notes: [],
      socialProfiles: [],
      messages: [],
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
            ilike(people.email, searchPattern)
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
        db.select().from(socialAccounts)
          .where(or(
            ilike(socialAccounts.username, searchPattern),
            ilike(socialAccounts.accountUrl, searchPattern)
          ))
          .orderBy(
            sql`CASE WHEN ${socialAccounts.username} ILIKE ${startPattern} THEN 0 ELSE 1 END`,
            socialAccounts.username
          )
          .limit(10)
          .then(res => { results.socialProfiles = res; })
      );
    }

    if (options.includeMessages !== false) {
      searchPromises.push(
        db.select().from(messages)
          .where(ilike(messages.content, searchPattern))
          .orderBy(messages.sentTimestamp)
          .limit(10)
          .then(res => { results.messages = res; })
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
    const updates: any = { status };
    if (status === "in_progress") {
      updates.startedAt = new Date();
    }
    if (status === "completed" || status === "failed") {
      updates.completedAt = new Date();
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

  async getTasksByStatus(status: string): Promise<Task[]> {
    return await db
      .select()
      .from(tasks)
      .where(eq(tasks.status, status))
      .orderBy(tasks.createdAt);
  }
}

export const storage = new DatabaseStorage();
