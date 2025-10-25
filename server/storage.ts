// Referenced from javascript_database blueprint - adapted for people management schema
import {
  people,
  notes,
  interactions,
  relationships,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, or, ilike, sql } from "drizzle-orm";

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
}

export class DatabaseStorage implements IStorage {
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
}

export const storage = new DatabaseStorage();
