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
} from "@shared/schema";
import { db, pool } from "./db";
import { eq, or, and, ilike, sql, inArray, arrayContains } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";

const PostgresSessionStore = connectPg(session);

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
  getPeoplePaginated(offset: number, limit: number, mePersonId?: string): Promise<Array<Person & { maxRelationshipValue: number | null; relationshipTypeName: string | null; relationshipTypeColor: string | null }>>;
  getPersonById(id: string): Promise<PersonWithRelations | undefined>;
  createPerson(person: InsertPerson): Promise<Person>;
  updatePerson(id: string, person: Partial<InsertPerson>): Promise<Person | undefined>;
  deletePerson(id: string): Promise<void>;

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
    const allPeople = await db.select().from(people);
    
    const peopleWithRelationships = await Promise.all(
      allPeople.map(async (person) => {
        // Get relationships where this person is the "from" person
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

        // Get relationships where this person is the "to" person (bidirectional)
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
          relationships: allRelationships,
        };
      })
    );

    return peopleWithRelationships;
  }

  async getPeoplePaginated(
    offset: number,
    limit: number,
    mePersonId?: string
  ): Promise<Array<Person & { maxRelationshipValue: number | null; relationshipTypeName: string | null; relationshipTypeColor: string | null }>> {
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
        sql`MAX(${relationshipTypes.value}) DESC NULLS LAST`,
        people.firstName,
        people.lastName
      )
      .limit(limit)
      .offset(offset);

    return result.map(row => ({
      ...row.person,
      maxRelationshipValue: row.maxValue,
      relationshipTypeName: row.typeName,
      relationshipTypeColor: row.typeColor,
    }));
  }

  async getPersonById(id: string): Promise<PersonWithRelations | undefined> {
    const [person] = await db.select().from(people).where(eq(people.id, id));
    if (!person) return undefined;

    const personNotes = await db
      .select()
      .from(notes)
      .where(eq(notes.personId, id));

    const personInteractions = await db
      .select()
      .from(interactions)
      .where(sql`${id} = ANY(${interactions.peopleIds})`);

    // Get groups where this person is a member
    const personGroups = await db
      .select()
      .from(groups)
      .where(arrayContains(groups.members, [id]));

    // Get relationships where this person is the "from" person
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
      .where(eq(relationships.fromPersonId, id));

    // Get relationships where this person is the "to" person (bidirectional)
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
      .where(eq(relationships.toPersonId, id));

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
    return await db.select().from(relationshipTypes);
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
    return updated || undefined;
  }

  async deleteRelationshipType(id: string): Promise<void> {
    await db.delete(relationshipTypes).where(eq(relationshipTypes.id, id));
  }

  // Interaction type operations
  async getAllInteractionTypes(): Promise<InteractionType[]> {
    return await db.select().from(interactionTypes);
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
    return updated || undefined;
  }

  async deleteInteractionType(id: string): Promise<void> {
    await db.delete(interactionTypes).where(eq(interactionTypes.id, id));
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

    const groupNotesList = await db
      .select()
      .from(groupNotes)
      .where(eq(groupNotes.groupId, id));

    // Fetch member details
    const memberDetails: Person[] = [];
    if (group.members && group.members.length > 0) {
      const membersData = await db
        .select()
        .from(people)
        .where(inArray(people.id, group.members));
      memberDetails.push(...membersData);
    }

    // Fetch interactions involving this group
    const groupInteractions = await db
      .select()
      .from(interactions)
      .where(arrayContains(interactions.groupIds, [id]));

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
}

export const storage = new DatabaseStorage();
