// Storage layer for People Management CRM using external PostgreSQL database
import {
  people,
  notes,
  interactions,
  relationships,
  relationshipTypes,
  users,
  groups,
  groupNotes,
  type Person,
  type InsertPerson,
  type Note,
  type InsertNote,
  type Interaction,
  type InsertInteraction,
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
} from "@shared/schema";
import { db, pool } from "./db";
import { eq, or, ilike, sql, inArray } from "drizzle-orm";
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
  getPersonById(id: string): Promise<PersonWithRelations | undefined>;
  createPerson(person: InsertPerson): Promise<Person>;
  updatePerson(id: string, person: Partial<InsertPerson>): Promise<Person | undefined>;
  deletePerson(id: string): Promise<void>;

  // Note operations
  createNote(note: InsertNote): Promise<Note>;
  deleteNote(id: string): Promise<void>;

  // Interaction operations
  createInteraction(interaction: InsertInteraction): Promise<Interaction>;
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

  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  getUserCount(): Promise<number>;

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
          or(
            ilike(people.firstName, query),
            ilike(people.lastName, query),
            ilike(people.email, query),
            ilike(people.company, query),
            sql`EXISTS (
              SELECT 1 FROM unnest(${people.tags}) AS tag
              WHERE tag ILIKE ${query}
            )`
          )
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
    return await db.select().from(people);
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
      .where(eq(interactions.personId, id));

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
    await db.delete(people).where(eq(people.id, id));
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

    return {
      ...group,
      notes: groupNotesList,
      memberDetails,
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
}

export const storage = new DatabaseStorage();
