# PRM Database & Schema Audit: The Good, The Bad, and The Ugly

**Auditor:** Technical Auditor & Database Architect  
**Scope:** PostgreSQL Database Layer, Schema Architecture, Initialization, Migrations, and Integrity Constraints (Excluding Social Media Infrastructure)  
**Target Files Inspected:**
- [`shared/schema.ts`](file:///c:/Repos/PRM/shared/schema.ts) (Core non-social tables, types, relations, Zod schemas)
- [`server/db.ts`](file:///c:/Repos/PRM/server/db.ts) (PostgreSQL connection pool, client configuration, environment)
- [`server/db-init.ts`](file:///c:/Repos/PRM/server/db-init.ts) (Initialization lifecycle, sync engine, manual migrations, reset)
- [`server/storage.ts`](file:///c:/Repos/PRM/server/storage.ts) (Data access layer, multi-step operations, deletion cascades)
- [`drizzle.config.ts`](file:///c:/Repos/PRM/drizzle.config.ts) & [`migrations/`](file:///c:/Repos/PRM/migrations) (Migration configuration, generated SQL, journal)

---

## Executive Summary

The database layer of the Personal Relationship Manager (PRM) is built on PostgreSQL using Drizzle ORM and `node-postgres` (`pg.Pool`). While the application benefits from modern TypeScript ORM tooling, strong Zod schema generation, and thoughtful multi-tenant ownership models, the underlying database infrastructure suffers from **critical architectural liabilities**.

Most notably:
1. **Catastrophic Boot Wipe Vulnerability:** [`server/db-init.ts`](file:///c:/Repos/PRM/server/db-init.ts#L1311-L1325) drops and wipes all public tables with `CASCADE` on startup if `hasUsers()` returns false—which occurs during transient network/connection failures or if the user table is empty.
2. **Dual-Universe Schema Drift & Bypassed Migrations:** The Drizzle migration directory ([`migrations/*.sql`](file:///c:/Repos/PRM/migrations)) is **never executed**. Instead, a 65 KB, 1,654-line procedural monolith ([`server/db-init.ts`](file:///c:/Repos/PRM/server/db-init.ts)) runs dozens of manual `ALTER TABLE` and `CREATE TABLE IF NOT EXISTS` statements on every boot, leading to divergent schemas between fresh installs and existing databases.
3. **Broken Referential Integrity via Denormalized String Arrays:** Core entities like `groups` and `interactions` store foreign identifiers inside `text[]` arrays (`members`, `crowd_members`, `people_ids`, `group_ids`) rather than relational junction tables. This bypasses all database-level foreign key cascades, requiring dangerous, un-transactional application-level array scrubbing that leaves ghost UUIDs upon record deletion.
4. **Missing Indexes on High-Throughput Tables:** The [`messages`](file:///c:/Repos/PRM/shared/schema.ts#L1953-L1973) table carries zero indexes (even on its foreign key `conversation_id`), photos deduplication relies on an unindexed `file_hash`, and 9 separate tables with universal vector columns trigger full table scans during synchronization.

---

## 1. The Good: Architectural Strengths & Sound Patterns

### 1.1 Type Safety & Runtime Schema Generation
* **Single Source of Schema Truth via Drizzle-Zod:** In [`shared/schema.ts:L4-L5`](file:///c:/Repos/PRM/shared/schema.ts#L4-L5), Drizzle ORM is integrated with `drizzle-zod` (`createInsertSchema`), generating runtime Zod validators directly from database table definitions (e.g., [`insertConversationSchema`](file:///c:/Repos/PRM/shared/schema.ts#L2003-L2008)). This prevents drift between API contract validation and database constraints.
* **Strict TypeScript Typing for JSONB Columns:** Rather than allowing untyped `jsonb`, structured complex types are enforced via Drizzle's `.$type<T>()` modifier:
  * `people.jobs`: [`JobExperience[]`](file:///c:/Repos/PRM/shared/schema.ts#L8-L13) at [`schema.ts:L190`](file:///c:/Repos/PRM/shared/schema.ts#L190)
  * `schooling.colleges`: [`CollegeExperience[]`](file:///c:/Repos/PRM/shared/schema.ts#L15-L20) at [`schema.ts:L318`](file:///c:/Repos/PRM/shared/schema.ts#L318)
  * `schooling.additionalSchooling`: [`AdditionalSchoolingExperience[]`](file:///c:/Repos/PRM/shared/schema.ts#L22-L27) at [`schema.ts:L319`](file:///c:/Repos/PRM/shared/schema.ts#L319)
  * `truePersonSearch.addresses`: [`TpsAddress[]`](file:///c:/Repos/PRM/shared/schema.ts#L30-L33) at [`schema.ts:L779`](file:///c:/Repos/PRM/shared/schema.ts#L779)
  * `truePersonSearch.relatives`: [`TpsRelation[]`](file:///c:/Repos/PRM/shared/schema.ts#L35-L39) at [`schema.ts:L782`](file:///c:/Repos/PRM/shared/schema.ts#L782)
  * `messages.attachments`: [`MessageAttachment[]`](file:///c:/Repos/PRM/shared/schema.ts#L2013-L2026) at [`schema.ts:L1964`](file:///c:/Repos/PRM/shared/schema.ts#L1964)

### 1.2 Multi-Tenant Ownership & Visibility Pattern
* **Reusable Ownership Abstraction:** The [`sharedOwnership`](file:///c:/Repos/PRM/shared/schema.ts#L162-L165) higher-order helper attaches standardized ownership metadata across shared-by-default tables (`people`, `groups`, `interactions`, `conversations`):
  ```typescript
  const sharedOwnership = (defaultVisibility: Visibility = "public") => ({
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    visibility: text("visibility").$type<Visibility>().notNull().default(defaultVisibility),
  });
  ```
  This cleanly decouples user deletion from data destruction: when a user account is deleted, their shared contributions are preserved with `created_by_user_id = NULL` rather than destroying shared institutional knowledge.
* **Partial Unique Index on "Me" Person:** In [`shared/schema.ts:L198-L200`](file:///c:/Repos/PRM/shared/schema.ts#L198-L200), the schema uses a partial unique index:
  ```typescript
  uniqueIndex("people_me_user_id_uniq").on(t.userId).where(sql`user_id IS NOT NULL`)
  ```
  This enforces that each user has at most one associated "Me" contact profile while allowing the vast majority of non-user contact rows to have `user_id = NULL` without constraint collisions.

### 1.3 Normalized Relational Sub-Schemas
* **Normalized Family Structure:** The introduction of dedicated relational tables for biological/adoptive lineage ([`lineage`](file:///c:/Repos/PRM/shared/schema.ts#L288-L298)) and spousal partnerships ([`partnerships`](file:///c:/Repos/PRM/shared/schema.ts#L301-L311)) represents a strong improvement over generic directed edges. Both tables feature compound foreign key indexes and `ON DELETE CASCADE`.
* **Audit Logs and Daily Note Decomposition:** Daily notes are properly decomposed into `daily_notes`, `daily_note_events`, `daily_note_involved_parties`, and `daily_note_audit_logs` ([`schema.ts:L614-L659`](file:///c:/Repos/PRM/shared/schema.ts#L614-L659)), with foreign keys cascading from the parent note.

### 1.4 Selective GIN Indexing
* **PostgreSQL GIN Indexes for Array/JSONB Search:** GIN indexes are applied to select multi-value columns to accelerate containment queries:
  * [`interactions.peopleIds`](file:///c:/Repos/PRM/shared/schema.ts#L256): `interactions_people_ids_gin_idx` using `gin`
  * [`groups.members`](file:///c:/Repos/PRM/shared/schema.ts#L345): `groups_members_gin_idx` using `gin`
  * [`groups.crowdMembers`](file:///c:/Repos/PRM/shared/schema.ts#L346): `groups_crowd_members_gin_idx` using `gin`
  * [`photos.faceUuids`](file:///c:/Repos/PRM/shared/schema.ts#L609): `photos_face_uuids_gin_idx` using `gin`
  * [`photos.facialIds`](file:///c:/Repos/PRM/shared/schema.ts#L610): `photos_facial_ids_gin_idx` using `gin`

---

## 2. The Bad: Suboptimal Schemas, Redundancies & Weak Constraints

### 2.1 SQLite Legacy Artifacts in PostgreSQL
Despite using PostgreSQL, multiple tables retain integer columns mimicking SQLite's lack of a boolean type:
* [`sso_config.enabled`](file:///c:/Repos/PRM/shared/schema.ts#L134): `integer("enabled").notNull().default(0)`
* [`sso_config.autoSso`](file:///c:/Repos/PRM/shared/schema.ts#L135): `integer("auto_sso").notNull().default(0)`
* [`people.isStarred`](file:///c:/Repos/PRM/shared/schema.ts#L181): `integer("is_starred").notNull().default(0)`
* [`people.eloRankable`](file:///c:/Repos/PRM/shared/schema.ts#L183): `integer("elo_rankable").notNull().default(1)`
* [`people.noSocialMedia`](file:///c:/Repos/PRM/shared/schema.ts#L184): `integer("no_social_media").notNull().default(0)`
* [`sex_guess_queue.answered`](file:///c:/Repos/PRM/shared/schema.ts#L798): `integer("answered").notNull().default(0)`

Meanwhile, other tables use native PostgreSQL `boolean` ([`photos.isSubImage`](file:///c:/Repos/PRM/shared/schema.ts#L593), [`daily_note_audit_logs.pinUsed`](file:///c:/Repos/PRM/shared/schema.ts#L656), [`ai_chats.agentMode`](file:///c:/Repos/PRM/shared/schema.ts#L748)). This causes query inconsistency (`WHERE is_starred = 1` vs `WHERE is_sub_image IS TRUE`), prevents PostgreSQL query optimizer boolean transformations, and complicates TypeScript type coercion.

### 2.2 Denormalized Text Arrays Over Proper Junction Tables
Instead of standard relational junction tables (`group_members`, `interaction_attendees`), the schema relies on raw `text[]` arrays:
* [`groups.members`](file:///c:/Repos/PRM/shared/schema.ts#L332): `text("members").array().default(sql`ARRAY[]::text[]`)`
* [`groups.crowdMembers`](file:///c:/Repos/PRM/shared/schema.ts#L335): `text("crowd_members").array().default(sql`ARRAY[]::text[]`)`
* [`interactions.peopleIds`](file:///c:/Repos/PRM/shared/schema.ts#L241): `text("people_ids").array().notNull().default(sql`ARRAY[]::text[]`)`
* [`interactions.groupIds`](file:///c:/Repos/PRM/shared/schema.ts#L242): `text("group_ids").array().default(sql`ARRAY[]::text[]`)`
* [`messages.imageUuids`](file:///c:/Repos/PRM/shared/schema.ts#L1963): `text("image_uuids").array().default(sql`ARRAY[]::text[]`)`

**Architectural Deficiencies:**
* **Zero Database Referential Integrity:** PostgreSQL cannot enforce foreign key constraints on array elements. If person `abc-123` is deleted, PostgreSQL will not touch `groups.members` or `interactions.peopleIds`.
* **Application Bloat:** Complex array manipulation logic must be written in TypeScript ([`server/storage.ts:L1233-L1242`](file:///c:/Repos/PRM/server/storage.ts#L1233-L1242), [`storage.ts:L1374-L1395`](file:///c:/Repos/PRM/server/storage.ts#L1374-L1395)).
* **Race Conditions & Concurrency Hazards:** Two concurrent requests updating members on the same group will overwrite each other's array updates (lost update anomaly), whereas a junction table with row-level locks avoids this entirely.

### 2.3 Polymorphic Foreign Key Anti-Pattern
* In [`daily_note_involved_parties`](file:///c:/Repos/PRM/shared/schema.ts#L640-L648):
  ```typescript
  partyType: text("party_type").notNull(), // 'person' | 'social_account' | 'group'
  refId: varchar("ref_id").notNull(),
  ```
  `ref_id` has no foreign key constraint. It points to three completely different tables without integrity checks. When a person or group is deleted, orphan records permanently persist in `daily_note_involved_parties`.

### 2.4 Redundant Columns and Incomplete Migrations
* **Dual Image Storage:** 
  * [`notes.imageUrl`](file:///c:/Repos/PRM/shared/schema.ts#L216) (`text`) alongside [`notes.imageUuid`](file:///c:/Repos/PRM/shared/schema.ts#L217) (`varchar REFERENCES photos(id)`)
  * [`interactions.imageUrl`](file:///c:/Repos/PRM/shared/schema.ts#L247) (`text`) alongside [`interactions.imageUuid`](file:///c:/Repos/PRM/shared/schema.ts#L248) (`varchar REFERENCES photos(id)`)
  * [`people.imageUrl`](file:///c:/Repos/PRM/shared/schema.ts#L179) has no FK link to `photos` at all.
* **Redundant Family Column:** [`relationships.familyRelationshipType`](file:///c:/Repos/PRM/shared/schema.ts#L279) exists despite the creation of normalized `lineage` and `partnerships` tables. A manual backfill script in [`server/db-init.ts:L1445-L1546`](file:///c:/Repos/PRM/server/db-init.ts#L1445-L1546) attempts to prune them, but the column remains in the core table definition.

### 2.5 Text-Based Date Columns
* [`daily_notes.date`](file:///c:/Repos/PRM/shared/schema.ts#L617): Defined as `text("date").notNull()` (e.g. `"2026-08-29"`) rather than native `date` or `timestamp`.
  * Allows malformed strings (e.g., `"2026-8-5"`, `"invalid"`).
  * Prevents PostgreSQL calendar arithmetic, timezone offsets, and interval partition pruning.

### 2.6 Missing Critical Indexes
| Table | Column(s) | Impact / Risk | File Citation |
|---|---|---|---|
| `messages` | `conversation_id` | **Catastrophic.** Every query retrieving messages for a chat performs a sequential table scan across all messages in the DB. | [`schema.ts:L1953-L1973`](file:///c:/Repos/PRM/shared/schema.ts#L1953-L1973) |
| `messages` | `sent_at` | Sorting conversation messages chronologically triggers in-memory sorts across unindexed timestamps. | [`schema.ts:L1966`](file:///c:/Repos/PRM/shared/schema.ts#L1966) |
| `messages` | `sender_person_id` | Foreign key has no index; cascades and sender queries require full scans. | [`schema.ts:L1957`](file:///c:/Repos/PRM/shared/schema.ts#L1957) |
| `message_recipients` | `message_id`, `person_id` | Foreign keys lack indexes; cascade deletes scan entire recipients table. | [`schema.ts:L1975-L1986`](file:///c:/Repos/PRM/shared/schema.ts#L1975-L1986) |
| `conversation_participants` | `conversation_id`, `person_id` | Participant lookups require sequential scans. | [`schema.ts:L1988-L2000`](file:///c:/Repos/PRM/shared/schema.ts#L1988-L2000) |
| `photos` | `file_hash` | Central photo deduplication check does a full table scan on every file upload. | [`schema.ts:L603`](file:///c:/Repos/PRM/shared/schema.ts#L603) |
| `photos` | `prm_location` | Finding photos attached to an entity (e.g. `"interaction:UUID"`) requires sequential scan. | [`schema.ts:L600`](file:///c:/Repos/PRM/shared/schema.ts#L600) |
| All 9 Vector Tables | `vector_synced_at` | [`bulkSyncAll()`](file:///c:/Repos/PRM/server/vector-universal.ts#L538-L542) queries `WHERE vector_synced_at IS NULL` on 9 tables; all 9 execute full table scans. | [`vector-universal.ts:L538`](file:///c:/Repos/PRM/server/vector-universal.ts#L538) |

### 2.7 Missing Integrity Constraints
* **Unconstrained Multi-Day Notes:** [`daily_notes`](file:///c:/Repos/PRM/shared/schema.ts#L614-L628) lacks a `UNIQUE (user_id, date)` constraint. Concurrent autosaves or duplicate clicks create duplicate notes for the same date.
* **Duplicate Relationships & Self-Edges:** [`relationships`](file:///c:/Repos/PRM/shared/schema.ts#L270-L285) lacks a `UNIQUE (from_person_id, to_person_id, type_id)` constraint and lacks a `CHECK (from_person_id <> to_person_id)` constraint. Person A can be related to Person A, and 100 identical edges can exist between Person A and Person B.
* **Asymmetric Partnership Duplication:** [`partnerships`](file:///c:/Repos/PRM/shared/schema.ts#L301-L311) has `unique().on(t.person1Id, t.person2Id)`. However, it does not enforce ordering (`CHECK (person1_id < person2_id)`), permitting both `(A, B)` and `(B, A)` to exist simultaneously.
* **Schooling Relational Mismatch:** [`peopleRelations`](file:///c:/Repos/PRM/shared/schema.ts#L861-L864) declares `schooling: one(schooling)`, but `schooling.personId` is not constrained to be unique. Multiple schooling records for a person will crash Drizzle's relational query engine.

---

## 3. The Ugly: Critical Data Loss Risks, Cascades & Monolithic Drift

```
                               CATASTROPHIC BOOT SEQUENCE
                               
   Server Boots (server/index.ts:128)
                  │
                  ▼
       initializeDatabase() (db-init.ts:1311)
                  │
                  ▼
             hasUsers()? (db-init.ts:163)
                  ├─── Query error? (Connection timeout, pool busy, network hiccup)
                  │    └──> Catches error & returns FALSE
                  └─── 0 rows? (Fresh install, maintenance, or truncated users table)
                       └──> Returns FALSE
                                 │
                                 ▼
                     ═════════════════════════════════
                     CRITICAL DATA DESTRUCTION TRIGGER
                     ═════════════════════════════════
                                 │
                                 ▼
                      dropAllTables() (db-init.ts:8)
                                 │
                                 ▼
              "DROP TABLE IF EXISTS <all_tables> CASCADE"
                                 │
                                 ▼
             ALL DATA PERMANENTLY DESTROYED FROM DATABASE
```

### 3.1 Silent, Catastrophic Boot Wipe (`initializeDatabase` & `hasUsers`)
In [`server/db-init.ts:L1311-L1325`](file:///c:/Repos/PRM/server/db-init.ts#L1311-L1325):
```typescript
export async function initializeDatabase(): Promise<void> {
  log("Checking database initialization status...");
  const usersExist = await hasUsers();
  
  if (!usersExist) {
    log("No users found in database. Resetting database...");
    await dropAllTables();
    await runMigrations();
    ...
```
Examining `hasUsers()` ([`server/db-init.ts:L163-L173`](file:///c:/Repos/PRM/server/db-init.ts#L163-L173)):
```typescript
async function hasUsers(): Promise<boolean> {
  try {
    const result = await pool.query(`
      SELECT EXISTS(SELECT 1 FROM users LIMIT 1) as has_users
    `);
    return result.rows[0]?.has_users || false;
  } catch (error) {
    // If the query fails, it likely means the users table doesn't exist
    return false;
  }
}
```
And examining `dropAllTables()` ([`server/db-init.ts:L8-L35`](file:///c:/Repos/PRM/server/db-init.ts#L8-L35)):
```typescript
const dropQuery = `DROP TABLE IF EXISTS ${tables.map(t => `"${t}"`).join(', ')} CASCADE`;
await pool.query(dropQuery);
```

**The Threat:**
1. If the database experiences a transient connection timeout, socket error, or locks during startup, `pool.query()` throws.
2. `hasUsers()` silently catches the error and returns `false`.
3. `initializeDatabase()` assumes the database is uninitialized and calls `dropAllTables()`.
4. `dropAllTables()` queries `pg_tables`, discovers all tables, and executes `DROP TABLE IF EXISTS ... CASCADE`.
5. **Every table in the database—contacts, notes, photos, messages, interactions, lineages—is wiped clean in milliseconds.**
6. Furthermore, if an administrator clears the `users` table during account maintenance or migration, restarting the Node process instantly destroys all other non-user data in the public schema.

### 3.2 Total Migration Bypass & Dual Schema Drift
Drizzle migrations exist in the repository under [`migrations/`](file:///c:/Repos/PRM/migrations) (`0000_wooden_skreet.sql` through `0004_create_pending_social_account_imports_table.sql`). However:
* **The Drizzle migration engine (`drizzle-orm/node-postgres/migrator`) is never called anywhere in the codebase.**
* In fact, [`server/db-init.ts:L598`](file:///c:/Repos/PRM/server/db-init.ts#L598) explicitly confesses:
  ```typescript
  // db:push only runs on a full reset, and migrations/*.sql are never applied.
  ```
* When `runMigrations()` executes during a reset ([`server/db-init.ts:L45`](file:///c:/Repos/PRM/server/db-init.ts#L45)), it runs:
  ```typescript
  execSync("npm run db:push -- --force", { stdio: "inherit", env: { ...process.env } });
  ```
  `drizzle-kit push --force` completely bypasses the migration journal, inspecting current schema vs database and executing brute-force DDL.
* On existing databases, schema synchronization is performed procedurally by the 65 KB, 1,654-line file [`server/db-init.ts`](file:///c:/Repos/PRM/server/db-init.ts).
* Over 500 lines of manual SQL in `validateAndSyncSchema()` ([`db-init.ts:L494-L1036`](file:///c:/Repos/PRM/server/db-init.ts#L494-L1036)) query `information_schema.columns` and run ad-hoc `ALTER TABLE ADD COLUMN`.

**Consequences of Schema Drift:**
* **Divergent Table Definitions:**
  * In [`db-init.ts:L860-L873`](file:///c:/Repos/PRM/server/db-init.ts#L860-L873), `conversations` is created with column `user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`.
  * In [`shared/schema.ts:L1935-L1947`](file:///c:/Repos/PRM/shared/schema.ts#L1935-L1947), `conversations` does **not** have `user_id`; it uses `createdByUserId` and `visibility`.
  * If a fresh database is built with `db:push`, it gets one structure. If an older database boots through `db-init.ts`, it gets a different structure mutated through `migrateToMultiUser()`.
* **Manual Constraint Dropping:** In [`db-init.ts:L1024`](file:///c:/Repos/PRM/server/db-init.ts#L1024), the script executes:
  ```sql
  ALTER TABLE true_person_search DROP CONSTRAINT IF EXISTS true_person_search_tps_id_key;
  ```
  This directly contradicts [`shared/schema.ts:L770`](file:///c:/Repos/PRM/shared/schema.ts#L770), which specifies `tpsId` as an "idempotency key".

### 3.3 Deletion Cascades Leave Ghost UUIDs Across the Graph
Because groups and interactions use denormalized string arrays rather than foreign-keyed rows:
1. When a person is deleted via application code ([`server/storage.ts:L1228-L1246`](file:///c:/Repos/PRM/server/storage.ts#L1228-L1246)):
   ```typescript
   async deletePerson(id: string): Promise<void> {
     await this.removePersonFromInteractions(id);
     const allGroups = await db.select().from(groups);
     for (const group of allGroups) {
       if (group.members && group.members.includes(id)) {
         const updatedMembers = group.members.filter((memberId) => memberId !== id);
         await db.update(groups).set({ members: updatedMembers }).where(eq(groups.id, group.id));
       }
     }
     await db.delete(people).where(eq(people.id, id));
   }
   ```
   * **Missing Crowd Member Scrubbing:** It scrubs `group.members`, but **forgets** `group.crowdMembers`! The deleted person's UUID remains permanently stranded in `crowdMembers`.
   * **Unindexed Group Loop:** Pulls **all** groups from the database into Node.js heap memory, filters arrays in JavaScript, and issues individual SQL update statements one by one.
2. **User Deletion Bypasses All Array Scrubbing:**
   When a user is deleted via [`storage.deleteUser(id)`](file:///c:/Repos/PRM/server/storage.ts#L2239-L2241):
   ```typescript
   await db.delete(users).where(eq(users.id, id));
   ```
   PostgreSQL executes the foreign key constraint `people.userId ON DELETE CASCADE` and deletes the user's "Me" person row.
   **Crucially:** PostgreSQL cascades happen strictly within the database engine. They do **not** trigger Node.js application methods (`removePersonFromInteractions` or group scrubbing).
   * Result: The "Me" person is deleted, but their ID remains stranded inside `interactions.people_ids`, `groups.members`, and `groups.crowd_members`. The entire graph visualization and contact query layer will now encounter non-existent person IDs.

### 3.4 Multi-Step Migrations Executed Without Transactions
In [`server/db-init.ts:L1445-L1546`](file:///c:/Repos/PRM/server/db-init.ts#L1445-L1546), `migrateFamilyToNormalizedSchema()`:
1. Queries all family relationships: `SELECT ... FROM relationships WHERE family_relationship_type IS NOT NULL`.
2. Loops through rows in JavaScript and executes individual `INSERT INTO lineage` and `INSERT INTO partnerships`.
3. Runs `DELETE FROM relationships WHERE family_relationship_type IS NOT NULL`.
4. Runs `DELETE FROM relationship_types WHERE LOWER(name) = 'family'`.

**The Flaw:**
* **No Database Transaction (`BEGIN ... COMMIT`):** If the process crashes or an error occurs during step 2 after migrating 100 out of 500 rows, partial data is committed.
* **Irreversible Migration Lock:** On the next boot, step 1 runs:
  ```typescript
  if (lineageCount > 0 || partnershipsCount > 0) {
    log("Lineage or partnerships tables already have data. Skipping migration.");
    return;
  }
  ```
  Because partial records were inserted, `lineageCount > 0` is true. The function **aborts permanently**. The remaining 400 family relationships are never migrated, leaving the database in a permanently corrupted split-state.
* **Boot-Loop Conflict:** [`seedRelationshipTypes()`](file:///c:/Repos/PRM/server/db-init.ts#L70) re-inserts `Family` on line 1343, and `migrateFamilyToNormalizedSchema()` deletes `Family` on line 1537. This creates an unprincipled tug-of-war on every startup.

### 3.5 Database Connection Pool & Security Flaws (`server/db.ts`)
Inspecting [`server/db.ts`](file:///c:/Repos/PRM/server/db.ts):
```typescript
// External PostgreSQL database connection
// Note: Despite port 3306 (typically MySQL), this is a PostgreSQL database at pbe.im
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required. Configure your external PostgreSQL database connection.");
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 20,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});
```
1. **Unencrypted Remote Traffic (`ssl: false`):** The comment notes that this connects to a remote host (`pbe.im`). Setting `ssl: false` transmits all database queries, unhashed user session cookies, plaintext passwords during authentication, and personal data unencrypted over the public internet.
2. **Unhandled Pool Errors Crash Node Process:** There is no `pool.on('error', (err) => { ... })` listener. According to official `pg` driver documentation, an unexpected error on an idle pool client (such as a remote server dropping an idle TCP socket) emits an unhandled `'error'` event on the `pool` instance, which immediately terminates the Node.js process.

---

## 4. Comprehensive Database Schema Matrix

*Non-social core tables evaluated for referential integrity, indexing, and constraint health:*

| Table | Primary Key | Foreign Keys | Key Indexes | Constraint & Integrity Issues | Health Rating |
|---|---|---|---|---|---|
| [`users`](file:///c:/Repos/PRM/shared/schema.ts#L42) | `serial("id")` | None | `username (UQ)` | Passwords stored as plaintext/scrypt without DB validation; relies on app code. | 🟡 Fair |
| [`user_settings`](file:///c:/Repos/PRM/shared/schema.ts#L111) | `(userId, key)` | `userId -> users.id (CASCADE)` | Compound PK | Clean design. | 🟢 Good |
| [`api_keys`](file:///c:/Repos/PRM/shared/schema.ts#L120) | `varchar("id")` | `userId -> users.id (CASCADE)` | `key (UQ)` | Clean design. | 🟢 Good |
| [`sso_config`](file:///c:/Repos/PRM/shared/schema.ts#L131) | `varchar("id")` | `userId -> users.id (CASCADE)` | `userId (UQ)` | Uses integer `0/1` instead of boolean for `enabled` and `autoSso`. | 🟡 Fair |
| [`people`](file:///c:/Repos/PRM/shared/schema.ts#L168) | `varchar("id")` | `userId -> users.id (CASCADE)`, `createdByUserId -> users.id (SET NULL)` | `userId (partial UQ)`, `lastName`, `eloScore`, `createdAt`, `isStarred`, `personfaceUuid` | `socialAccountUuids` is unvalidated `text[]`; integer `isStarred`/`eloRankable`; `imageUrl` unlinked to `photos`. | 🟡 Fair |
| [`notes`](file:///c:/Repos/PRM/shared/schema.ts#L211) | `varchar("id")` | `userId -> users.id (CASCADE)`, `personId -> people.id (CASCADE)`, `imageUuid -> photos.id (SET NULL)` | `personId`, `userId`, `imageUuid` | Redundant `imageUrl` and `imageUuid`; missing index on `vector_synced_at`. | 🟡 Fair |
| [`interaction_types`](file:///c:/Repos/PRM/shared/schema.ts#L228) | `varchar("id")` | None | None | Clean lookup table. | 🟢 Good |
| [`interactions`](file:///c:/Repos/PRM/shared/schema.ts#L238) | `varchar("id")` | `typeId -> interaction_types.id (SET NULL)`, `imageUuid -> photos.id (SET NULL)`, `createdByUserId -> users.id (SET NULL)` | `typeId`, `visibility`, `imageUuid`, `peopleIds (GIN)` | `peopleIds` and `groupIds` are `text[]` arrays without foreign keys; redundant `imageUrl`. | 🔴 Poor |
| [`relationship_types`](file:///c:/Repos/PRM/shared/schema.ts#L260) | `varchar("id")` | None | None | Constant churn between seed script and migration script deleting `'Family'`. | 🟡 Fair |
| [`relationships`](file:///c:/Repos/PRM/shared/schema.ts#L270) | `varchar("id")` | `fromPersonId -> people.id (CASCADE)`, `toPersonId -> people.id (CASCADE)`, `typeId -> relationship_types.id (SET NULL)` | `fromPersonId`, `toPersonId`, `typeId` | **No unique constraint** on `(from, to, type)`; no `CHECK (from <> to)`; redundant legacy `familyRelationshipType`. | 🔴 Poor |
| [`lineage`](file:///c:/Repos/PRM/shared/schema.ts#L288) | `varchar("id")` | `childId -> people.id (CASCADE)`, `parentId -> people.id (CASCADE)` | `(childId, parentId) (UQ)`, `childId`, `parentId` | Lacks `CHECK (child_id <> parent_id)`. | 🟢 Good |
| [`partnerships`](file:///c:/Repos/PRM/shared/schema.ts#L301) | `varchar("id")` | `person1Id -> people.id (CASCADE)`, `person2Id -> people.id (CASCADE)` | `(person1Id, person2Id) (UQ)`, `person1Id`, `person2Id` | Lacks symmetric constraint or order check, allowing both `(A, B)` and `(B, A)`. | 🟡 Fair |
| [`schooling`](file:///c:/Repos/PRM/shared/schema.ts#L314) | `varchar("id")` | `personId -> people.id (CASCADE)` | `personId` | `personId` lacks unique constraint, but Drizzle relations declare `one(schooling)`. | 🟡 Fair |
| [`groups`](file:///c:/Repos/PRM/shared/schema.ts#L326) | `varchar("id")` | `createdByUserId -> users.id (SET NULL)` | `centerAccountId`, `visibility`, `members (GIN)`, `crowdMembers (GIN)` | `members` and `crowdMembers` are raw `text[]` without FKs; deleted people leave ghost IDs. | 🔴 Poor |
| [`group_notes`](file:///c:/Repos/PRM/shared/schema.ts#L350) | `varchar("id")` | `groupId -> groups.id (CASCADE)` | `groupId` | Clean child table. | 🟢 Good |
| [`sub_groups`](file:///c:/Repos/PRM/shared/schema.ts#L360) | `varchar("id")` | `groupId -> groups.id (CASCADE)` | `groupId` | Clean child table. | 🟢 Good |
| [`photos`](file:///c:/Repos/PRM/shared/schema.ts#L586) | `varchar("id")` | `createdByUserId -> users.id (SET NULL)` | `faceUuids (GIN)`, `facialIds (GIN)` | **Missing index on `fileHash`** (dedup bottleneck); missing index on `prmLocation`; missing index on `vector_synced_at`. | 🟡 Fair |
| [`daily_notes`](file:///c:/Repos/PRM/shared/schema.ts#L614) | `varchar("id")` | `userId -> users.id (CASCADE)` | `date`, `userId` | `date` is `TEXT` instead of `DATE`; **no unique constraint** on `(userId, date)`. | 🔴 Poor |
| [`daily_note_events`](file:///c:/Repos/PRM/shared/schema.ts#L630) | `varchar("id")` | `dailyNoteId -> dailyNotes.id (CASCADE)` | `dailyNoteId` | Clean child table. | 🟢 Good |
| [`daily_note_involved_parties`](file:///c:/Repos/PRM/shared/schema.ts#L640) | `varchar("id")` | `dailyNoteId -> dailyNotes.id (CASCADE)` | `dailyNoteId`, `refId` | `refId` is untyped polymorphic reference without foreign keys. | 🔴 Poor |
| [`daily_note_audit_logs`](file:///c:/Repos/PRM/shared/schema.ts#L651) | `varchar("id")` | `dailyNoteId -> dailyNotes.id (CASCADE)` | `dailyNoteId` | Clean audit trail. | 🟢 Good |
| [`tasks`](file:///c:/Repos/PRM/shared/schema.ts#L662) | `varchar("id")` | `userId -> users.id (CASCADE)` | `userId`, `status`, `(userId, status)` | `payload` and `result` are `TEXT` instead of `JSONB`. | 🟡 Fair |
| [`image_tasks`](file:///c:/Repos/PRM/shared/schema.ts#L682) | `varchar("id")` | `userId -> users.id (CASCADE)`, `parentTaskId -> tasks.id (SET NULL)`, `photoId -> photos.id (SET NULL)` | `parentTaskId`, `userId`, `photoId`, `status`, `(userId, status)` | `payload` and `result` are `TEXT` instead of `JSONB`. | 🟡 Fair |
| [`image_questions`](file:///c:/Repos/PRM/shared/schema.ts#L705) | `varchar("id")` | `photoId -> photos.id (CASCADE)`, `resolvedPersonId -> people.id (SET NULL)` | `photoId`, `resolvedPersonId` | Clean design. | 🟢 Good |
| [`faces`](file:///c:/Repos/PRM/shared/schema.ts#L724) | `varchar("id")` | `photoId -> photos.id (CASCADE)` | `photoId`, `personfaceUuid` | `embedding` stored as raw `jsonb` rather than `pgvector` extension vector. | 🟡 Fair |
| [`ai_chats`](file:///c:/Repos/PRM/shared/schema.ts#L739) | `varchar("id")` | `userId -> users.id (CASCADE)` | `userId` | Missing index on `vector_synced_at`. | 🟡 Fair |
| [`app_knowledge`](file:///c:/Repos/PRM/shared/schema.ts#L756) | `varchar("id")` | None | None | No indexes defined. | 🟡 Fair |
| [`true_person_search`](file:///c:/Repos/PRM/shared/schema.ts#L768) | `varchar("id")` | `personId -> people.id (SET NULL)` | `personId` | **Unique constraint on `tpsId` explicitly dropped** by migration; allows duplicates. | 🔴 Poor |
| [`sex_guess_queue`](file:///c:/Repos/PRM/shared/schema.ts#L792) | `varchar("id")` | `personId -> people.id (CASCADE)` | `personId` | Integer `answered`; no unique constraint on `personId` (can queue duplicate guesses). | 🟡 Fair |
| [`conversations`](file:///c:/Repos/PRM/shared/schema.ts#L1935) | `varchar("id")` | `createdByUserId -> users.id (SET NULL)` | `visibility`, `createdByUserId` | Schema mismatch between `schema.ts` and `db-init.ts` (`user_id` vs `created_by_user_id`). | 🟡 Fair |
| [`messages`](file:///c:/Repos/PRM/shared/schema.ts#L1953) | `varchar("id")` | `conversationId -> conversations.id (CASCADE)`, `senderPersonId -> people.id (SET NULL)` | **NONE** | **Zero indexes defined.** Sequential scan on every conversation load. | 🔴 Poor |
| [`message_recipients`](file:///c:/Repos/PRM/shared/schema.ts#L1975) | `varchar("id")` | `messageId -> messages.id (CASCADE)`, `personId -> people.id (SET NULL)` | **NONE** | Foreign keys have zero indexes. | 🔴 Poor |
| [`conversation_participants`](file:///c:/Repos/PRM/shared/schema.ts#L1988) | `varchar("id")` | `conversationId -> conversations.id (CASCADE)`, `personId -> people.id (SET NULL)` | **NONE** | **No unique constraint** on `(conversationId, personId)`; zero indexes. | 🔴 Poor |

---

## 5. Actionable Remediation Plan

### Phase 1: Immediate Hotfixes (Emergency Priority)

1. **Defuse the Boot Data-Wipe Mechanism:**
   * In [`server/db-init.ts:L1311-L1325`](file:///c:/Repos/PRM/server/db-init.ts#L1311-L1325), **remove** the automatic call to `dropAllTables()`.
   * If `hasUsers()` returns false, the application should simply ensure schema tables exist via non-destructive DDL and permit the super-admin registration flow. `dropAllTables()` must **only** be callable via explicit, authenticated administrator action (`POST /api/reset-database`).
   * Fix `hasUsers()` in [`server/db-init.ts:L163-L173`](file:///c:/Repos/PRM/server/db-init.ts#L163-L173): re-throw connection errors rather than swallowing them and returning `false`.
2. **Add Missing Critical Indexes via SQL Migration:**
   Add immediate B-tree indexes to eliminate query performance cliffs:
   ```sql
   -- Messages & Conversations
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_sent ON messages (conversation_id, sent_at DESC);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender ON messages (sender_person_id);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_recipients_msg ON message_recipients (message_id);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_participants_lookup ON conversation_participants (conversation_id, person_id);

   -- Photos Deduplication & Lookup
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_photos_file_hash ON photos (file_hash) WHERE file_hash IS NOT NULL;
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_photos_prm_location ON photos (prm_location);

   -- Vector Sync Scans
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_people_vector_synced ON people (vector_synced_at) WHERE vector_synced_at IS NULL;
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_vector_synced ON notes (vector_synced_at) WHERE vector_synced_at IS NULL;
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_vector_synced ON interactions (vector_synced_at) WHERE vector_synced_at IS NULL;
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_vector_synced ON messages (vector_synced_at) WHERE vector_synced_at IS NULL;
   ```
3. **Stabilize Database Pool in [`server/db.ts`](file:///c:/Repos/PRM/server/db.ts):**
   * Attach `pool.on('error', (err) => console.error('[Postgres Pool Error]', err))` to prevent unhandled idle socket drops from crashing the Node process.
   * Enable SSL with proper TLS configuration (`ssl: { rejectUnauthorized: false }` or root CA verification).

### Phase 2: Schema Normalization & Transaction Boundaries

1. **Replace Array Columns with Relational Junction Tables:**
   * Create `group_members (group_id VARCHAR REFERENCES groups(id) ON DELETE CASCADE, person_id VARCHAR REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (group_id, person_id))`.
   * Create `group_crowd_members (group_id VARCHAR REFERENCES groups(id) ON DELETE CASCADE, entity_id VARCHAR NOT NULL, PRIMARY KEY (group_id, entity_id))`.
   * Create `interaction_participants (interaction_id VARCHAR REFERENCES interactions(id) ON DELETE CASCADE, person_id VARCHAR REFERENCES people(id) ON DELETE CASCADE, PRIMARY KEY (interaction_id, person_id))`.
   * Remove all manual array filtering loops in [`server/storage.ts`](file:///c:/Repos/PRM/server/storage.ts). Person deletion will then cleanly cascade at the database engine level with zero ghost UUIDs.
2. **Enforce Hard Integrity Constraints in [`shared/schema.ts`](file:///c:/Repos/PRM/shared/schema.ts):**
   * Add `unique().on(dailyNotes.userId, dailyNotes.date)` to prevent duplicate daily notes.
   * Add `unique().on(relationships.fromPersonId, relationships.toPersonId, relationships.typeId)` to prevent duplicate relationship edges.
   * Add `unique().on(conversationParticipants.conversationId, conversationParticipants.personId)`.
   * Convert `daily_notes.date` from `TEXT` to native PostgreSQL `DATE`.
   * Convert legacy integer flag columns (`is_starred`, `elo_rankable`, `enabled`) to native PostgreSQL `BOOLEAN`.
3. **Wrap All Multi-Step Database Operations in Transactions:**
   * In [`server/storage.ts:deletePerson`](file:///c:/Repos/PRM/server/storage.ts#L1228), wrap operations inside `db.transaction(async (tx) => { ... })`.
   * In [`server/db-init.ts`](file:///c:/Repos/PRM/server/db-init.ts), wrap all migration loops inside database client transactions with explicit rollback on error.

### Phase 3: Migration System Overhaul

1. **Retire the 65 KB `db-init.ts` Procedural Monolith:**
   * Adopt standard Drizzle migrations using `drizzle-orm/node-postgres/migrator`.
   * On startup, run `await migrate(db, { migrationsFolder: "./migrations" })`.
   * Remove the 500+ lines of imperative `validateAndSyncSchema()` and manual `addColumnIfNotExists` queries.
2. **Reconcile Schema Drift:**
   * Generate a clean baseline migration (`drizzle-kit generate`) that mirrors the desired end state of [`shared/schema.ts`](file:///c:/Repos/PRM/shared/schema.ts).
   * Eliminate contradictory column definitions (e.g. `conversations.user_id` vs `conversations.created_by_user_id`).
   * Clean up retired columns (`notes.image_url`, `interactions.image_url`, `relationships.family_relationship_type`).
