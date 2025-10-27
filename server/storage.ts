// Referenced from javascript_database blueprint - adapted for people management schema
import {
  people,
  notes,
  interactions,
  relationships,
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

  // People operations
  async getAllPeople(searchQuery?: string): Promise<Person[]> {
    if (searchQuery) {
      const query = `%${searchQuery}%`;
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
        );
    }
    return await db.select().from(people);
  }

  async getAllPeopleWithRelationships(): Promise<Array<Person & { relationships: RelationshipWithPerson[] }>> {
    const allPeople = await db.select().from(people);
    
    const peopleWithRelationships = await Promise.all(
      allPeople.map(async (person) => {
        const personRelationships = await db
          .select({
            id: relationships.id,
            fromPersonId: relationships.fromPersonId,
            toPersonId: relationships.toPersonId,
            level: relationships.level,
            notes: relationships.notes,
            createdAt: relationships.createdAt,
            toPerson: people,
          })
          .from(relationships)
          .innerJoin(people, eq(relationships.toPersonId, people.id))
          .where(eq(relationships.fromPersonId, person.id));

        return {
          ...person,
          relationships: personRelationships,
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

    const personRelationships = await db
      .select({
        id: relationships.id,
        fromPersonId: relationships.fromPersonId,
        toPersonId: relationships.toPersonId,
        level: relationships.level,
        notes: relationships.notes,
        createdAt: relationships.createdAt,
        toPerson: people,
      })
      .from(relationships)
      .innerJoin(people, eq(relationships.toPersonId, people.id))
      .where(eq(relationships.fromPersonId, id));

    return {
      ...person,
      notes: personNotes,
      interactions: personInteractions,
      relationships: personRelationships,
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
    return await db
      .select()
      .from(groups)
      .where(
        or(
          ilike(groups.name, query),
        )
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
