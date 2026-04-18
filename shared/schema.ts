import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, serial, boolean } from "drizzle-orm/pg-core";
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
  ssoEmail: text("sso_email"),
  imageStorageMode: text("image_storage_mode").notNull().default("s3"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// API Keys table for external API access (NEVER EXPORT THIS TABLE)
export const apiKeys = pgTable("api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // User-friendly name for the key
  key: text("key").notNull().unique(), // The actual API key (hashed)
  keyType: text("key_type").notNull().default("full"), // 'full' = full access
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

// SSO Configuration table for OAuth2/OIDC settings
export const ssoConfig = pgTable("sso_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  enabled: integer("enabled").notNull().default(0), // 0 = disabled, 1 = enabled (SQLite compatibility)
  autoSso: integer("auto_sso").notNull().default(0), // 0 = disabled, 1 = auto-redirect to SSO when not signed in
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(), // Stored encrypted
  authUrl: text("auth_url").notNull(),
  tokenUrl: text("token_url").notNull(),
  userInfoUrl: text("user_info_url").notNull(),
  redirectUrl: text("redirect_url").notNull(),
  logoutUrl: text("logout_url"),
  userIdentifier: text("user_identifier").notNull().default('email'), // Field to match user (e.g., 'email', 'sub')
  scopes: text("scopes").notNull().default('openid'), // Space-separated OAuth scopes
  authStyle: text("auth_style").notNull().default('auto'), // auto, in_params, in_header
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
  socialAccountUuids: text("social_account_uuids").array().default(sql`ARRAY[]::text[]`),
  isStarred: integer("is_starred").notNull().default(0), // 0 = not starred, 1 = starred (SQLite compatibility)
  eloScore: integer("elo_score").notNull().default(1200),
  noSocialMedia: integer("no_social_media").notNull().default(0),
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

// Social account types table
export const socialAccountTypes = pgTable("social_account_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").notNull(), // hex color code
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Social accounts table (Registry - lightweight stable identity)
export const socialAccounts = pgTable("social_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull(),
  ownerUuid: varchar("owner_uuid").references(() => people.id, { onDelete: "cascade" }),
  typeId: varchar("type_id").references(() => socialAccountTypes.id, { onDelete: "set null" }),
  internalAccountCreationDate: timestamp("internal_account_creation_date").notNull().defaultNow(),
  internalAccountCreationType: text("internal_account_creation_type").notNull().default("User"),
  lastScrapedAt: timestamp("last_scraped_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Social profile versions table (Visual Identity History)
export const socialProfileVersions = pgTable("social_profile_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  socialAccountId: varchar("social_account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
  nickname: text("nickname"),
  bio: text("bio"),
  accountUrl: text("account_url"),
  imageUrl: text("image_url"),
  externalImageUrl: text("external_image_url"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  isCurrent: boolean("is_current").notNull().default(true),
});

// Social network state table (Current snapshot - one row per account)
export const socialNetworkState = pgTable("social_network_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  socialAccountId: varchar("social_account_id").notNull().unique().references(() => socialAccounts.id, { onDelete: "cascade" }),
  followerCount: integer("follower_count").notNull().default(0),
  followingCount: integer("following_count").notNull().default(0),
  followers: text("followers").array().default(sql`ARRAY[]::text[]`),
  following: text("following").array().default(sql`ARRAY[]::text[]`),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Social network changes table (Git-like change log)
export const socialNetworkChanges = pgTable("social_network_changes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  socialAccountId: varchar("social_account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
  changeType: text("change_type").notNull(), // 'follow' or 'unfollow'
  direction: text("direction").notNull(), // 'follower' (they follow you) or 'following' (you follow them)
  targetAccountId: text("target_account_id").notNull(), // the account that followed/unfollowed
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  batchId: varchar("batch_id"), // groups changes detected at the same time
});

// Social account posts table
export const socialAccountPosts = pgTable("social_account_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  socialAccountId: varchar("social_account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
  postType: text("post_type").notNull().default("post"), // 'post', 'story', 'reel', etc.
  content: text("content"), // JSON-stringified array of CDN image URLs, e.g. '["https://cdn.example.com/img1.jpg"]', or null
  description: text("description"),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  comments: text("comments"), // JSON string with post comments data
  mentionedAccounts: text("mentioned_accounts"), // Comma-separated list of mentioned account usernames
  isDeleted: boolean("is_deleted").notNull().default(false),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Extension sessions table - holds authenticated Chrome extension sessions
export const extensionSessions = pgTable("extension_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(), // Hashed session token
  name: text("name").notNull().default("Chrome Extension"), // Display name for the session
  lastAccessedAt: timestamp("last_accessed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Extension auth codes table - temporary 4-digit codes for pairing
export const extensionAuthCodes = pgTable("extension_auth_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  code: text("code").notNull(), // 4-digit code
  expiresAt: timestamp("expires_at").notNull(), // Code expires after 60 seconds
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Background tasks table - for long-running operations like image downloads
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // e.g. 'get_img'
  status: text("status").notNull().default("pending"), // 'pending', 'in_progress', 'completed', 'failed'
  payload: text("payload").notNull(), // JSON string with task-specific data
  result: text("result"), // JSON string with task result or error message
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
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

export const socialAccountTypesRelations = relations(socialAccountTypes, ({ many }) => ({
  socialAccounts: many(socialAccounts),
}));

export const socialAccountsRelations = relations(socialAccounts, ({ one, many }) => ({
  type: one(socialAccountTypes, {
    fields: [socialAccounts.typeId],
    references: [socialAccountTypes.id],
  }),
  profileVersions: many(socialProfileVersions),
  networkState: many(socialNetworkState),
  networkChanges: many(socialNetworkChanges),
  posts: many(socialAccountPosts),
}));

export const socialProfileVersionsRelations = relations(socialProfileVersions, ({ one }) => ({
  socialAccount: one(socialAccounts, {
    fields: [socialProfileVersions.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const socialNetworkStateRelations = relations(socialNetworkState, ({ one }) => ({
  socialAccount: one(socialAccounts, {
    fields: [socialNetworkState.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const socialNetworkChangesRelations = relations(socialNetworkChanges, ({ one }) => ({
  socialAccount: one(socialAccounts, {
    fields: [socialNetworkChanges.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const socialAccountPostsRelations = relations(socialAccountPosts, ({ one }) => ({
  socialAccount: one(socialAccounts, {
    fields: [socialAccountPosts.socialAccountId],
    references: [socialAccounts.id],
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

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export const insertSsoConfigSchema = createInsertSchema(ssoConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSocialAccountSchema = createInsertSchema(socialAccounts).omit({
  id: true,
  createdAt: true,
});

export const insertSocialAccountTypeSchema = createInsertSchema(socialAccountTypes).omit({
  id: true,
  createdAt: true,
});

export const insertSocialProfileVersionSchema = createInsertSchema(socialProfileVersions).omit({
  id: true,
  detectedAt: true,
});

export const insertSocialNetworkStateSchema = createInsertSchema(socialNetworkState).omit({
  id: true,
  updatedAt: true,
});

export const insertSocialNetworkChangeSchema = createInsertSchema(socialNetworkChanges).omit({
  id: true,
  detectedAt: true,
});

export const insertSocialAccountPostSchema = createInsertSchema(socialAccountPosts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});

export const insertExtensionSessionSchema = createInsertSchema(extensionSessions).omit({
  id: true,
  createdAt: true,
  lastAccessedAt: true,
});

export const insertExtensionAuthCodeSchema = createInsertSchema(extensionAuthCodes).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type SsoConfig = typeof ssoConfig.$inferSelect;
export type InsertSsoConfig = z.infer<typeof insertSsoConfigSchema>;
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

export type SocialAccount = typeof socialAccounts.$inferSelect;
export type InsertSocialAccount = z.infer<typeof insertSocialAccountSchema>;

export type SocialAccountType = typeof socialAccountTypes.$inferSelect;
export type InsertSocialAccountType = z.infer<typeof insertSocialAccountTypeSchema>;

export type SocialProfileVersion = typeof socialProfileVersions.$inferSelect;
export type InsertSocialProfileVersion = z.infer<typeof insertSocialProfileVersionSchema>;

export type SocialNetworkState = typeof socialNetworkState.$inferSelect;
export type InsertSocialNetworkState = z.infer<typeof insertSocialNetworkStateSchema>;

export type SocialNetworkChange = typeof socialNetworkChanges.$inferSelect;
export type InsertSocialNetworkChange = z.infer<typeof insertSocialNetworkChangeSchema>;

export type SocialAccountPost = typeof socialAccountPosts.$inferSelect;
export type InsertSocialAccountPost = z.infer<typeof insertSocialAccountPostSchema>;

export type SocialAccountWithCurrentProfile = SocialAccount & {
  currentProfile: SocialProfileVersion | null;
  latestState: SocialNetworkState | null;
};

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

export type ExtensionSession = typeof extensionSessions.$inferSelect;
export type InsertExtensionSession = z.infer<typeof insertExtensionSessionSchema>;

export type ExtensionAuthCode = typeof extensionAuthCodes.$inferSelect;
export type InsertExtensionAuthCode = z.infer<typeof insertExtensionAuthCodeSchema>;

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

// Flow item types for unified timeline view
export type FlowItemType = 'note' | 'interaction';

export type FlowItem = {
  id: string;
  type: FlowItemType;
  date: Date;
  content: string;
  // Note-specific
  imageUrl?: string | null;
  // Interaction-specific
  title?: string | null;
  description?: string | null;
  interactionType?: InteractionType | null;
  peopleIds?: string[];
  groupIds?: string[];
};

export type FlowResponse = {
  items: FlowItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type SocialGraphSettings = {
  hideOrphans: boolean;
  minConnections: number;
  limitExtras: boolean;
  maxExtras: number;
  highlightedAccountId: string | null;
  mode: 'default' | 'blob' | 'single-highlight' | 'multi-highlight';
  blobMergeMultiplier: number;
  singleHighlightAccountId?: string | null;
  singleShowFriendLinks?: boolean;
  singleRemoveExtras?: boolean;
  multiHighlightAccountIds?: string[];
};

export type SocialGraphNode = {
  id: string;
  name: string;
  typeColor: string;
  connectionCount: number;
  val: number;
  size: number;
  mergedNames?: string[];
};

export type SocialGraphLink = {
  source: string;
  target: string;
  mutual: boolean;
};

export type SocialGraphData = {
  nodes: SocialGraphNode[];
  links: SocialGraphLink[];
};

export type MegaSearchResult = {
  people: Person[];
  groups: Group[];
  interactions: Interaction[];
  notes: Note[];
  socialProfiles: SocialAccountWithCurrentProfile[];
};
