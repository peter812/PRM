import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, serial, boolean, jsonb, unique, AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Career and Education interfaces for database JSONB columns
export interface JobExperience {
  company: string;
  position: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface CollegeExperience {
  name: string;
  degree: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface AdditionalSchoolingExperience {
  name: string;
  course?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

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
  eloRankable: integer("elo_rankable").notNull().default(1), // 1 = rankable, 0 = not rankable
  noSocialMedia: integer("no_social_media").notNull().default(0),
  sex: text("sex").notNull().default("unknown"), // 'male', 'female', or 'unknown'
  vectorId: text("vector_id"), // Qdrant point ID for universal vector search
  vectorSyncedAt: timestamp("vector_synced_at"), // Last successful vector sync
  maidenName: text("maiden_name"),
  jobs: jsonb("jobs").$type<JobExperience[]>().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Notes table
export const notes = pgTable("notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  imageUuid: varchar("image_uuid").references(() => photos.id, { onDelete: "set null" }),
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
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
  imageUuid: varchar("image_uuid").references(() => photos.id, { onDelete: "set null" }),
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
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
  familyRelationshipType: varchar("family_relationship_type", { length: 50 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Lineage table
export const lineage = pgTable("lineage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  childId: varchar("child_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  parentId: varchar("parent_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  lineageType: text("lineage_type").notNull().default("biological"), // 'biological' | 'adoptive' | 'step'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  unq: unique().on(t.childId, t.parentId),
}));

// Partnerships table
export const partnerships = pgTable("partnerships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  person1Id: varchar("person1_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  person2Id: varchar("person2_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("partner"), // 'married' | 'partner' | 'divorced' | 'ex_partner'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  unq: unique().on(t.person1Id, t.person2Id),
}));

// Schooling table
export const schooling = pgTable("schooling", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  highSchool: text("high_school"),
  colleges: jsonb("colleges").$type<CollegeExperience[]>().default(sql`'[]'::jsonb`), // array of { name: string, degree: string, startDate?: string, endDate?: string }
  additionalSchooling: jsonb("additional_schooling").$type<AdditionalSchoolingExperience[]>().default(sql`'[]'::jsonb`), // array of { name: string, course?: string, startDate?: string, endDate?: string }
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
  centerAccountId: varchar("center_account_id").references((): AnyPgColumn => socialAccounts.id, { onDelete: "set null" }),
  crowdMembers: text("crowd_members").array().default(sql`ARRAY[]::text[]`), // list of person UUIDs in the crowd
  crowdLastCalculatedAt: timestamp("crowd_last_calculated_at"),
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
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
  groupId: varchar("group_id").references((): AnyPgColumn => groups.id, { onDelete: "cascade" }),
  typeId: varchar("type_id").references(() => socialAccountTypes.id, { onDelete: "set null" }),
  internalAccountCreationDate: timestamp("internal_account_creation_date").notNull().defaultNow(),
  internalAccountCreationType: text("internal_account_creation_type").notNull().default("User"),
  lastScrapedAt: timestamp("last_scraped_at"),
  currentPosts: text("current_posts"), // JSON array of post UUIDs currently visible on the account, e.g. '["uuid1","uuid2"]'
  deletedPosts: text("deleted_posts"), // JSON array of post UUIDs that were previously seen but are now deleted, e.g. '["uuid3"]'
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
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
  mentionedAccounts: text("mentioned_accounts"), // JSON array of {imageIndex: number, accounts: string[]} objects, e.g. '[{"imageIndex":0,"accounts":["user1"]}]'
  faceIds: text("face_ids"), // JSON array of arrays of face UUIDs, one entry per image, e.g. '[["uuid1","uuid2"],["uuid3"]]'
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

// App settings table - key-value store for application configuration
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Photos table - central registry for every image in the system
export const photos = pgTable("photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  location: text("location").notNull(), // current CDN or local URL/path
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  isSubImage: boolean("is_sub_image").notNull().default(false),
  processedAt: timestamp("processed_at"),
  imageDescriptionAt: timestamp("image_description_at"),
  imageDescription: text("image_description"),
  faceIdAt: timestamp("face_id_at"),
  faceUuids: jsonb("face_uuids"), // Array of { faceUuid: string, subImagePhotoId: string }
  prmLocation: text("prm_location").notNull(), // e.g. "post:UUID", "interaction:UUID", "profile_image:UUID"
  metadata: jsonb("metadata"), // EXIF / image metadata extracted by analyze_img_metadata
  ogMetadata: jsonb("og_metadata"), // OpenGraph-style metadata captured when the file is added to storage (source URL, content-type, content-length, last-modified, etag, etc.)
  fileHash: text("file_hash"), // SHA-256 hash of the file contents for deduplication
  widthPx: integer("width_px"), // Image width in pixels
  heightPx: integer("height_px"), // Image height in pixels
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
});

// Daily notes tables
export const dailyNotes = pgTable("daily_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(), // YYYY-MM-DD format
  userTitle: text("user_title").notNull().default(""),
  body: text("body").notNull().default(""),
  vectorId: text("vector_id"), // Qdrant point ID (set on first vectorization, reused on edit)
  vectorSyncedAt: timestamp("vector_synced_at"), // Timestamp of last successful vector sync; null = needs sync
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"), // Timestamp of last edit; null = never edited
});

export const dailyNoteEvents = pgTable("daily_note_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyNoteId: varchar("daily_note_id").notNull().references(() => dailyNotes.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dailyNoteInvolvedParties = pgTable("daily_note_involved_parties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyNoteId: varchar("daily_note_id").notNull().references(() => dailyNotes.id, { onDelete: "cascade" }),
  partyType: text("party_type").notNull(), // 'person' | 'social_account' | 'group'
  refId: varchar("ref_id").notNull(),
});

// Audit log for daily notes - tracks creation and edit timestamps
export const dailyNoteAuditLogs = pgTable("daily_note_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyNoteId: varchar("daily_note_id").notNull().references(() => dailyNotes.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // 'created' | 'edited'
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  pinUsed: boolean("pin_used").notNull().default(false), // whether PIN authorization was required for this edit
});

// Background tasks table - for long-running operations like image downloads
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // e.g. 'get_img'
  status: text("status").notNull().default("pending"), // 'pending', 'in_progress', 'completed', 'failed'
  title: text("title"), // Name/username of the entity targeted by the task
  payload: text("payload").notNull(), // JSON string with task-specific data
  result: text("result"), // JSON string with task result or error message
  progress: integer("progress").notNull().default(0), // 0-100 percent complete
  progressMessage: text("progress_message"), // human-readable progress description
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// Image tasks table - specialized operations performed on images
export const imageTasks = pgTable("image_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // 'download_img_instagram' | 'analyze_img_full' | 'analyze_img_face' | 'analyze_img_metadata' | 'analyze_img_llm' | 'convert_img'
  status: text("status").notNull().default("pending"), // 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  payload: text("payload").notNull().default("{}"),
  result: text("result"),
  progress: integer("progress").notNull().default(0),
  progressMessage: text("progress_message"),
  parentTaskId: varchar("parent_task_id").references(() => tasks.id, { onDelete: "set null" }),
  photoId: varchar("photo_id").references(() => photos.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

// AI chats table - stores historical AI chat conversations so they can be recalled and continued
export const aiChats = pgTable("ai_chats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  systemMessage: text("system_message").notNull().default(""),
  model: text("model").notNull().default(""),
  messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`), // Array of { role: 'user' | 'assistant', content: string, attachments?: AiChatAttachment[] }
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// App knowledge table - stores chunked app documentation for internal AI tool usage
export const appKnowledge = pgTable("app_knowledge", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  content: text("content").notNull(),
  vectorId: text("vector_id"), // Qdrant point ID for app knowledge semantic search
  vectorSyncedAt: timestamp("vector_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});


// Sex guess queue - LLM-generated guesses for people with unknown sex
export const sexGuessQueue = pgTable("sex_guess_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  guessedSex: text("guessed_sex").notNull(), // 'male' or 'female'
  reasoning: text("reasoning").notNull(),
  dateAdded: timestamp("date_added").notNull().defaultNow(),
  answered: integer("answered").notNull().default(0), // 0 = pending, 1 = answered
  snoozedUntil: timestamp("snooze_until"), // null = not snoozed, otherwise hide until this time
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
  conversationParticipants: many(conversationParticipants),
  sentMessages: many(messages),
  receivedMessages: many(messageRecipients),
  schooling: one(schooling, {
    fields: [people.id],
    references: [schooling.personId],
  }),
}));

export const schoolingRelations = relations(schooling, ({ one }) => ({
  person: one(people, {
    fields: [schooling.personId],
    references: [people.id],
  }),
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
  socialAccounts: many(socialAccounts),
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
  group: one(groups, {
    fields: [socialAccounts.groupId],
    references: [groups.id],
  }),
  profileVersions: many(socialProfileVersions),
  networkState: many(socialNetworkState),
  networkChanges: many(socialNetworkChanges),
  posts: many(socialAccountPosts),
  conversations: many(conversations),
  conversationParticipants: many(conversationParticipants),
  sentMessages: many(messages),
  receivedMessages: many(messageRecipients),
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

export const dailyNotesRelations = relations(dailyNotes, ({ many }) => ({
  events: many(dailyNoteEvents),
  involvedParties: many(dailyNoteInvolvedParties),
  auditLogs: many(dailyNoteAuditLogs),
}));

export const dailyNoteEventsRelations = relations(dailyNoteEvents, ({ one }) => ({
  dailyNote: one(dailyNotes, {
    fields: [dailyNoteEvents.dailyNoteId],
    references: [dailyNotes.id],
  }),
}));

export const dailyNoteInvolvedPartiesRelations = relations(dailyNoteInvolvedParties, ({ one }) => ({
  dailyNote: one(dailyNotes, {
    fields: [dailyNoteInvolvedParties.dailyNoteId],
    references: [dailyNotes.id],
  }),
}));

export const dailyNoteAuditLogsRelations = relations(dailyNoteAuditLogs, ({ one }) => ({
  dailyNote: one(dailyNotes, {
    fields: [dailyNoteAuditLogs.dailyNoteId],
    references: [dailyNotes.id],
  }),
}));

// Insert schemas
export const jobExperienceZodSchema = z.object({
  company: z.string(),
  position: z.string(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const collegeExperienceZodSchema = z.object({
  name: z.string(),
  degree: z.string(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const additionalSchoolingExperienceZodSchema = z.object({
  name: z.string(),
  course: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const insertPersonSchema = createInsertSchema(people)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    jobs: z.array(jobExperienceZodSchema).optional(),
  });

export const insertSchoolingSchema = createInsertSchema(schooling)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    colleges: z.array(collegeExperienceZodSchema).optional(),
    additionalSchooling: z.array(additionalSchoolingExperienceZodSchema).optional(),
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

export const FAMILY_RELATIONSHIP_TYPES = [
  "father", "mother", "child", "son", "daughter",
  "grandfather", "grandmother", "grandchild", "grandson", "granddaughter",
  "great_grandfather", "great_grandmother", "great_grandchild",
  "stepfather", "stepmother", "stepchild", "stepson", "stepdaughter",
  "uncle", "aunt", "nephew", "niece",
  "great_uncle", "great_aunt", "great_nephew", "great_niece",
  "cousin",
  "sibling", "brother", "sister",
  "half_brother", "half_sister", "half_sibling",
  "spouse", "ex_spouse",
  "parent", "grandparent", "stepparent",
  "nephew_or_niece", "uncle_or_aunt",
  "great_nephew_or_niece", "great_uncle_or_aunt",
] as const;

export type FamilyRelationshipType = typeof FAMILY_RELATIONSHIP_TYPES[number];

export const FAMILY_RELATIONSHIP_INVERSES: Record<string, string> = {
  father: "child",
  mother: "child",
  child: "parent",
  son: "parent",
  daughter: "parent",
  grandfather: "grandchild",
  grandmother: "grandchild",
  grandchild: "grandparent",
  grandson: "grandparent",
  granddaughter: "grandparent",
  great_grandfather: "great_grandchild",
  great_grandmother: "great_grandchild",
  great_grandchild: "great_grandfather",
  stepfather: "stepchild",
  stepmother: "stepchild",
  stepchild: "stepparent",
  stepson: "stepparent",
  stepdaughter: "stepparent",
  uncle: "nephew_or_niece",
  aunt: "nephew_or_niece",
  nephew: "uncle_or_aunt",
  niece: "uncle_or_aunt",
  nephew_or_niece: "uncle_or_aunt",
  uncle_or_aunt: "nephew_or_niece",
  great_uncle: "great_nephew_or_niece",
  great_aunt: "great_nephew_or_niece",
  great_nephew: "great_uncle_or_aunt",
  great_niece: "great_uncle_or_aunt",
  great_nephew_or_niece: "great_uncle_or_aunt",
  great_uncle_or_aunt: "great_nephew_or_niece",
  cousin: "cousin",
  sibling: "sibling",
  brother: "sibling",
  sister: "sibling",
  half_brother: "half_sibling",
  half_sister: "half_sibling",
  half_sibling: "half_sibling",
  spouse: "spouse",
  ex_spouse: "ex_spouse",
  parent: "child",
  grandparent: "grandchild",
  stepparent: "stepchild",
};

export const FAMILY_RELATIONSHIP_LABELS: Record<string, string> = {
  father: "Father",
  mother: "Mother",
  child: "Child",
  son: "Son",
  daughter: "Daughter",
  grandfather: "Grandfather",
  grandmother: "Grandmother",
  grandchild: "Grandchild",
  grandson: "Grandson",
  granddaughter: "Granddaughter",
  great_grandfather: "Great-Grandfather",
  great_grandmother: "Great-Grandmother",
  great_grandchild: "Great-Grandchild",
  stepfather: "Stepfather",
  stepmother: "Stepmother",
  stepchild: "Stepchild",
  stepson: "Stepson",
  stepdaughter: "Stepdaughter",
  uncle: "Uncle",
  aunt: "Aunt",
  nephew: "Nephew",
  niece: "Niece",
  nephew_or_niece: "Nephew or Niece",
  uncle_or_aunt: "Uncle or Aunt",
  great_uncle: "Great-Uncle",
  great_aunt: "Great-Aunt",
  great_nephew: "Great-Nephew",
  great_niece: "Great-Niece",
  great_nephew_or_niece: "Great-Nephew or Niece",
  great_uncle_or_aunt: "Great-Uncle or Aunt",
  cousin: "Cousin",
  sibling: "Sibling",
  brother: "Brother",
  sister: "Sister",
  half_brother: "Half-Brother",
  half_sister: "Half-Sister",
  half_sibling: "Half-Sibling",
  spouse: "Spouse",
  ex_spouse: "Ex-Spouse",
  parent: "Parent",
  grandparent: "Grandparent",
  stepparent: "Stepparent",
  partner: "Partner",
  ex_partner: "Ex-Partner",
  married: "Spouse",
  divorced: "Ex-Spouse",
  adoptive_father: "Adoptive Father",
  adoptive_mother: "Adoptive Mother",
  adoptive_parent: "Adoptive Parent",
  adoptive_child: "Adoptive Child",
  adoptive_son: "Adoptive Son",
  adoptive_daughter: "Adoptive Daughter",
};

export function deriveLineageRole(
  isChild: boolean,
  sex: string | null | undefined,
  lineageType: string
): string {
  let role = isChild ? "parent" : "child";
  if (isChild) {
    if (sex === "male") role = "father";
    else if (sex === "female") role = "mother";
  } else {
    if (sex === "male") role = "son";
    else if (sex === "female") role = "daughter";
  }
  if (lineageType === "step") {
    role = "step" + role;
  } else if (lineageType === "adoptive") {
    role = "adoptive_" + role;
  }
  return role;
}

export const FAMILY_RELATIONSHIP_CATEGORIES: Record<string, string> = {
  father: "parent",
  mother: "parent",
  parent: "parent",
  stepfather: "parent",
  stepmother: "parent",
  stepparent: "parent",
  child: "child",
  son: "child",
  daughter: "child",
  stepchild: "child",
  stepson: "child",
  stepdaughter: "child",
  grandfather: "grandparent",
  grandmother: "grandparent",
  grandparent: "grandparent",
  grandchild: "grandchild",
  grandson: "grandchild",
  granddaughter: "grandchild",
  great_grandfather: "great_grandparent",
  great_grandmother: "great_grandparent",
  great_grandchild: "great_grandchild",
  sibling: "sibling",
  brother: "sibling",
  sister: "sibling",
  half_brother: "sibling",
  half_sister: "sibling",
  half_sibling: "sibling",
  uncle: "extended",
  aunt: "extended",
  nephew: "extended",
  niece: "extended",
  nephew_or_niece: "extended",
  uncle_or_aunt: "extended",
  great_uncle: "extended",
  great_aunt: "extended",
  great_nephew: "extended",
  great_niece: "extended",
  great_nephew_or_niece: "extended",
  great_uncle_or_aunt: "extended",
  cousin: "extended",
  spouse: "partner",
  ex_spouse: "partner",
};

export const FAMILY_RELATIONSHIP_RULES: Array<{
  if: [string, string];
  then: string;
}> = [
  { if: ["father", "father"], then: "grandfather" },
  { if: ["mother", "father"], then: "grandfather" },
  { if: ["father", "mother"], then: "grandmother" },
  { if: ["mother", "mother"], then: "grandmother" },
  { if: ["father", "grandfather"], then: "great_grandfather" },
  { if: ["mother", "grandfather"], then: "great_grandfather" },
  { if: ["father", "grandmother"], then: "great_grandmother" },
  { if: ["mother", "grandmother"], then: "great_grandmother" },
  { if: ["sibling", "father"], then: "uncle" },
  { if: ["sibling", "mother"], then: "aunt" },
  { if: ["child", "sibling"], then: "nephew_or_niece" },
  { if: ["child", "uncle"], then: "cousin" },
  { if: ["child", "aunt"], then: "cousin" },
];

export const insertRelationshipSchema = createInsertSchema(relationships).omit({
  id: true,
  createdAt: true,
}).extend({
  familyRelationshipType: z.enum(FAMILY_RELATIONSHIP_TYPES).nullable().optional(),
});

export const insertLineageSchema = createInsertSchema(lineage).omit({
  id: true,
  createdAt: true,
});

export const insertPartnershipSchema = createInsertSchema(partnerships).omit({
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

export const insertAppSettingSchema = createInsertSchema(appSettings);

export const insertPhotoSchema = createInsertSchema(photos).omit({
  uploadedAt: true,
}).extend({
  id: z.string().optional(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});

export const insertImageTaskSchema = createInsertSchema(imageTasks).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});

export const insertAiChatSchema = createInsertSchema(aiChats).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDailyNoteSchema = createInsertSchema(dailyNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDailyNoteEventSchema = createInsertSchema(dailyNoteEvents).omit({
  id: true,
  createdAt: true,
});

export const insertDailyNoteInvolvedPartySchema = createInsertSchema(dailyNoteInvolvedParties).omit({
  id: true,
});

export const insertDailyNoteAuditLogSchema = createInsertSchema(dailyNoteAuditLogs).omit({
  id: true,
  timestamp: true,
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

export const insertAppKnowledgeSchema = createInsertSchema(appKnowledge).omit({
  id: true,
  createdAt: true,
});
export type AppKnowledge = typeof appKnowledge.$inferSelect;
export type InsertAppKnowledge = z.infer<typeof insertAppKnowledgeSchema>;


export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

export type Interaction = typeof interactions.$inferSelect;
export type InsertInteraction = z.infer<typeof insertInteractionSchema>;

export type Relationship = typeof relationships.$inferSelect;
export type InsertRelationship = z.infer<typeof insertRelationshipSchema>;

export type Lineage = typeof lineage.$inferSelect;
export type InsertLineage = z.infer<typeof insertLineageSchema>;
export type Partnership = typeof partnerships.$inferSelect;
export type InsertPartnership = z.infer<typeof insertPartnershipSchema>;

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
  latestImportFollowers?: Date | string | null;
  latestImportFollowing?: Date | string | null;
};

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

export type Photo = typeof photos.$inferSelect;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

export type ImageTask = typeof imageTasks.$inferSelect;
export type InsertImageTask = z.infer<typeof insertImageTaskSchema>;

export type SexGuessQueueItem = typeof sexGuessQueue.$inferSelect;

export type AiChatAttachment = {
  name: string;
  /** Mime type or short kind label (e.g. "text/plain", "application/json"). */
  type: string;
  /** Raw text content of the attachment. Files are read as text on the client. */
  content: string;
};
/**
 * Trace of a tool/skill invocation made by the LLM while answering an assistant
 * turn. Stored on the assistant message so that the icon-box visualization shown
 * in the chat UI survives reload, branch, and regenerate.
 */
export type AiToolCallTrace = {
  /** Stable tool name from the server registry (e.g. "person_search"). */
  name: string;
  /** Icon key from the registry — client maps this to a Lucide icon. */
  icon: string;
  /** Human-readable label for tooltip in the UI. */
  label: string;
  /** Raw JSON args the model passed to the tool (already validated). */
  args: Record<string, unknown>;
  /** Short one-line summary of the tool result (e.g. "Found 3 people"). */
  summary: string;
  /** Whether the tool ran successfully. */
  ok: boolean;
};

export type AiChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: AiChatAttachment[];
  /** Present on assistant messages that involved tool calls. */
  toolCalls?: AiToolCallTrace[];
};
export type AiChat = typeof aiChats.$inferSelect;
export type InsertAiChat = z.infer<typeof insertAiChatSchema>;

export type ExtensionSession = typeof extensionSessions.$inferSelect;
export type InsertExtensionSession = z.infer<typeof insertExtensionSessionSchema>;

export type ExtensionAuthCode = typeof extensionAuthCodes.$inferSelect;
export type InsertExtensionAuthCode = z.infer<typeof insertExtensionAuthCodeSchema>;

export type DailyNote = typeof dailyNotes.$inferSelect;
export type InsertDailyNote = z.infer<typeof insertDailyNoteSchema>;
export type DailyNoteEvent = typeof dailyNoteEvents.$inferSelect;
export type InsertDailyNoteEvent = z.infer<typeof insertDailyNoteEventSchema>;
export type DailyNoteInvolvedParty = typeof dailyNoteInvolvedParties.$inferSelect;
export type InsertDailyNoteInvolvedParty = z.infer<typeof insertDailyNoteInvolvedPartySchema>;
export type DailyNoteAuditLog = typeof dailyNoteAuditLogs.$inferSelect;
export type InsertDailyNoteAuditLog = z.infer<typeof insertDailyNoteAuditLogSchema>;

export type Schooling = typeof schooling.$inferSelect;
export type InsertSchooling = typeof schooling.$inferInsert;

export type DailyNoteInvolvedPartyWithLabel = DailyNoteInvolvedParty & { label: string };

export type DailyNoteWithDetails = DailyNote & {
  events: DailyNoteEvent[];
  involvedParties: DailyNoteInvolvedPartyWithLabel[];
  auditLogs: DailyNoteAuditLog[];
  isEditable: boolean;
  isLockedEditable: boolean; // true if older than 1 day but can be edited with PIN
};

// Extended types for API responses with relations
export type RelationshipWithPerson = Relationship & {
  toPerson: Person;
  type?: RelationshipType;
};

// Response shape for GET /api/people/:personId/relationships-grouped.
// Relationships are grouped by relationship type so the UI can render
// each type's chips together with cached colors in a single API call.
export type RelationshipsGroupedResponse = {
  groups: Array<{
    type: {
      id: string | null;
      name: string;
      color: string;
      value: number;
    };
    relationships: Array<{
      id: string;
      notes: string | null;
      toPerson: {
        id: string;
        firstName: string;
        lastName: string;
        imageUrl: string | null;
        company: string | null;
        title: string | null;
      };
    }>;
  }>;
};

export type PersonWithRelations = Person & {
  notes: Note[];
  interactions: Interaction[];
  groups: Group[];
  relationships: RelationshipWithPerson[];
  schooling?: Schooling | null;
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
  imageUuid?: string | null;
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
  ownerPersonId?: string | null;
  ownerName?: string | null;
  ownerImageUrl?: string | null;
};

export type PersonGraphAccountBrief = {
  id: string;
  username: string;
  typeColor: string | null;
  imageUrl: string | null;
};

export type PersonGraphPerson = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  imageUrl: string | null;
  socialAccountBriefs: PersonGraphAccountBrief[];
};

export type PersonGraphData = {
  view: "person";
  people: PersonGraphPerson[];
  relationships: Array<{
    id: string;
    fromPersonId: string;
    toPersonId: string;
    typeColor: string | null;
  }>;
  groups: Array<{
    id: string;
    name: string;
    color: string;
    members: string[];
    centerAccountId?: string | null;
    crowdMembers?: string[] | null;
    crowdLastCalculatedAt?: string | null;
  }>;
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
  dailyNotes: DailyNote[];
  chats: AiChat[];
};

export type UuidLookupResult = {
  type: 'person' | 'social_account' | 'photo';
  id: string;
  route: string;
};

// ── Conversations & Messages Tables ──

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),                          // Optional display name (e.g. email subject, group chat name)
  channelType: text("channel_type").notNull(),   // "phone" | "instagram" | "email" | "discord" | "x" | "facebook" | "generic"
  socialAccountId: varchar("social_account_id")  // Optional FK
    .references(() => socialAccounts.id, { onDelete: "set null" }),
  externalUrl: text("external_url"),              // Optional link back to source
  metadata: jsonb("metadata"),                   // Extensible JSON
  lastMessageAt: timestamp("last_message_at"),   // Denormalized for sorting
  importDate: timestamp("import_date"),
  importUuid: varchar("import_uuid"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  senderPersonId: varchar("sender_person_id")
    .references(() => people.id, { onDelete: "set null" }),
  senderSocialAccountId: varchar("sender_social_account_id")
    .references(() => socialAccounts.id, { onDelete: "set null" }),
  content: text("content"),                        // Message body (plain text or HTML)
  contentType: text("content_type").notNull().default("text"),  // "text" | "html" | "media"
  imageUuids: text("image_uuids").array().default(sql`ARRAY[]::text[]`),  // Optional array of image UUIDs
  attachments: jsonb("attachments"),               // Array of metadata objects
  externalId: text("external_id"),                 // Platform-specific ID
  sentAt: timestamp("sent_at"),                    // Custom date sent (e.g., historical messages)
  metadata: jsonb("metadata"),                     // Extensible
  importDate: timestamp("import_date"),
  importUuid: varchar("import_uuid"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messageRecipients = pgTable("message_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  personId: varchar("person_id")
    .references(() => people.id, { onDelete: "set null" }),
  socialAccountId: varchar("social_account_id")
    .references(() => socialAccounts.id, { onDelete: "set null" }),
  recipientType: text("recipient_type").notNull().default("to"),  // "to" | "cc" | "bcc"
  importDate: timestamp("import_date"),
  importUuid: varchar("import_uuid"),
});

export const conversationParticipants = pgTable("conversation_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  personId: varchar("person_id")
    .references(() => people.id, { onDelete: "set null" }),
  socialAccountId: varchar("social_account_id")
    .references(() => socialAccounts.id, { onDelete: "set null" }),
  role: text("role").notNull().default("participant"),  // "participant" | "owner"
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  importDate: timestamp("import_date"),
  importUuid: varchar("import_uuid"),
});

// Zod insert schemas
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertMessageRecipientSchema = createInsertSchema(messageRecipients).omit({ id: true });
export const insertConversationParticipantSchema = createInsertSchema(conversationParticipants).omit({ id: true });

// Types
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type MessageRecipient = typeof messageRecipients.$inferSelect;
export type InsertMessageRecipient = z.infer<typeof insertMessageRecipientSchema>;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type InsertConversationParticipant = z.infer<typeof insertConversationParticipantSchema>;

// Relations
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [conversations.socialAccountId],
    references: [socialAccounts.id],
  }),
  messages: many(messages),
  participants: many(conversationParticipants),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  senderPerson: one(people, {
    fields: [messages.senderPersonId],
    references: [people.id],
  }),
  senderSocialAccount: one(socialAccounts, {
    fields: [messages.senderSocialAccountId],
    references: [socialAccounts.id],
  }),
  recipients: many(messageRecipients),
}));

export const messageRecipientsRelations = relations(messageRecipients, ({ one }) => ({
  message: one(messages, {
    fields: [messageRecipients.messageId],
    references: [messages.id],
  }),
  person: one(people, {
    fields: [messageRecipients.personId],
    references: [people.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [messageRecipients.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationParticipants.conversationId],
    references: [conversations.id],
  }),
  person: one(people, {
    fields: [conversationParticipants.personId],
    references: [people.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [conversationParticipants.socialAccountId],
    references: [socialAccounts.id],
  }),
}));
