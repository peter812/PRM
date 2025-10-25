// Referenced from javascript_database blueprint - adapted for people management schema
import {
  people,
  notes,
  interactions,
  type Person,
  type InsertPerson,
  type Note,
  type InsertNote,
  type Interaction,
  type InsertInteraction,
  type PersonWithRelations,
} from "@shared/schema";
import { db } from "./db";
import { eq, or, ilike, sql } from "drizzle-orm";

export interface IStorage {
  // People operations
  getAllPeople(searchQuery?: string): Promise<Person[]>;
  getPersonById(id: number): Promise<PersonWithRelations | undefined>;
  createPerson(person: InsertPerson): Promise<Person>;
  updatePerson(id: number, person: Partial<InsertPerson>): Promise<Person | undefined>;
  deletePerson(id: number): Promise<void>;

  // Note operations
  createNote(note: InsertNote): Promise<Note>;
  deleteNote(id: number): Promise<void>;

  // Interaction operations
  createInteraction(interaction: InsertInteraction): Promise<Interaction>;
  deleteInteraction(id: number): Promise<void>;
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

  async getPersonById(id: number): Promise<PersonWithRelations | undefined> {
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

    return {
      ...person,
      notes: personNotes,
      interactions: personInteractions,
    };
  }

  async createPerson(insertPerson: InsertPerson): Promise<Person> {
    const [person] = await db.insert(people).values(insertPerson).returning();
    return person;
  }

  async updatePerson(
    id: number,
    personData: Partial<InsertPerson>
  ): Promise<Person | undefined> {
    const [person] = await db
      .update(people)
      .set(personData)
      .where(eq(people.id, id))
      .returning();
    return person || undefined;
  }

  async deletePerson(id: number): Promise<void> {
    await db.delete(people).where(eq(people.id, id));
  }

  // Note operations
  async createNote(insertNote: InsertNote): Promise<Note> {
    const [note] = await db.insert(notes).values(insertNote).returning();
    return note;
  }

  async deleteNote(id: number): Promise<void> {
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

  async deleteInteraction(id: number): Promise<void> {
    await db.delete(interactions).where(eq(interactions.id, id));
  }
}

export const storage = new DatabaseStorage();
