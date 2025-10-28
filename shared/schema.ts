import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, serial } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table for authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name"),
  nickname: text("nickname"),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// People table
export const people = pgTable("people", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  title: text("title"),
  tags: text("tags").array().default(sql`ARRAY[]::text[]`),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Notes table
export const notes = pgTable("notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Interaction types table
export const interactionTypes = pgTable("interaction_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").notNull(), // hex color code
  description: text("description"),
  value: integer("value").notNull().default(50), // 1-255
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Interactions table
export const interactions = pgTable("interactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  peopleIds: text("people_ids").array().notNull().default(sql`ARRAY[]::text[]`), // Array of person UUIDs (2 or more)
  groupIds: text("group_ids").array().default(sql`ARRAY[]::text[]`), // Optional array of group UUIDs
  typeId: varchar("type_id").references(() => interactionTypes.id, { onDelete: "set null" }),
  title: text("title"),
  date: timestamp("date").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relationship types table
export const relationshipTypes = pgTable("relationship_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").notNull(), // hex color code
  value: integer("value").notNull().default(50), // 1-255
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relationships table
export const relationships = pgTable("relationships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromPersonId: varchar("from_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  toPersonId: varchar("to_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  typeId: varchar("type_id").references(() => relationshipTypes.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Groups table
export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").notNull(), // hex color code
  type: text("type").array().default(sql`ARRAY[]::text[]`), // list of group types
  members: text("members").array().default(sql`ARRAY[]::text[]`), // list of person UUIDs
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Group notes table
export const groupNotes = pgTable("group_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ one }) => ({
  person: one(people, {
    fields: [users.id],
    references: [people.userId],
  }),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  user: one(users, {
    fields: [people.userId],
    references: [users.id],
  }),
  notes: many(notes),
  relationshipsFrom: many(relationships, { relationName: "relationshipsFrom" }),
  relationshipsTo: many(relationships, { relationName: "relationshipsTo" }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  person: one(people, {
    fields: [notes.personId],
    references: [people.id],
  }),
}));

export const relationshipsRelations = relations(relationships, ({ one }) => ({
  fromPerson: one(people, {
    fields: [relationships.fromPersonId],
    references: [people.id],
    relationName: "relationshipsFrom",
  }),
  toPerson: one(people, {
    fields: [relationships.toPersonId],
    references: [people.id],
    relationName: "relationshipsTo",
  }),
  type: one(relationshipTypes, {
    fields: [relationships.typeId],
    references: [relationshipTypes.id],
  }),
}));

export const relationshipTypesRelations = relations(relationshipTypes, ({ many }) => ({
  relationships: many(relationships),
}));

export const interactionTypesRelations = relations(interactionTypes, ({ many }) => ({
  interactions: many(interactions),
}));

export const interactionsRelations = relations(interactions, ({ one }) => ({
  type: one(interactionTypes, {
    fields: [interactions.typeId],
    references: [interactionTypes.id],
  }),
}));

export const groupsRelations = relations(groups, ({ many }) => ({
  notes: many(groupNotes),
}));

export const groupNotesRelations = relations(groupNotes, ({ one }) => ({
  group: one(groups, {
    fields: [groupNotes.groupId],
    references: [groups.id],
  }),
}));

// Insert schemas
export const insertPersonSchema = createInsertSchema(people).omit({
  id: true,
  createdAt: true,
});

export const insertNoteSchema = createInsertSchema(notes).omit({
  id: true,
  createdAt: true,
});

export const insertInteractionSchema = createInsertSchema(interactions)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    date: z.coerce.date(),
    peopleIds: z.array(z.string()).min(2, "At least 2 people are required"),
    groupIds: z.array(z.string()).optional(),
    typeId: z.string().optional(),
    title: z.string().optional(),
  });

export const insertInteractionTypeSchema = createInsertSchema(interactionTypes)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    value: z.number().int().min(1).max(255),
  });

export const insertRelationshipSchema = createInsertSchema(relationships).omit({
  id: true,
  createdAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertGroupSchema = createInsertSchema(groups).omit({
  id: true,
  createdAt: true,
});

export const insertGroupNoteSchema = createInsertSchema(groupNotes).omit({
  id: true,
  createdAt: true,
});

export const insertRelationshipTypeSchema = createInsertSchema(relationshipTypes)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    value: z.number().int().min(1).max(255),
  });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Person = typeof people.$inferSelect;
export type InsertPerson = z.infer<typeof insertPersonSchema>;

export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

export type Interaction = typeof interactions.$inferSelect;
export type InsertInteraction = z.infer<typeof insertInteractionSchema>;

export type Relationship = typeof relationships.$inferSelect;
export type InsertRelationship = z.infer<typeof insertRelationshipSchema>;

export type Group = typeof groups.$inferSelect;
export type InsertGroup = z.infer<typeof insertGroupSchema>;

export type GroupNote = typeof groupNotes.$inferSelect;
export type InsertGroupNote = z.infer<typeof insertGroupNoteSchema>;

export type RelationshipType = typeof relationshipTypes.$inferSelect;
export type InsertRelationshipType = z.infer<typeof insertRelationshipTypeSchema>;

export type InteractionType = typeof interactionTypes.$inferSelect;
export type InsertInteractionType = z.infer<typeof insertInteractionTypeSchema>;

// Extended types for API responses with relations
export type RelationshipWithPerson = Relationship & {
  toPerson: Person;
  type?: RelationshipType;
};

export type PersonWithRelations = Person & {
  notes: Note[];
  interactions: Interaction[];
  groups: Group[];
  relationships: RelationshipWithPerson[];
};

export type GroupWithNotes = Group & {
  notes: GroupNote[];
};
