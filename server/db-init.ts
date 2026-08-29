import { execSync } from "child_process";
import { pool } from "./db";
import { log } from "./vite";

/**
 * Drops all tables in the database
 */
async function dropAllTables(): Promise<void> {
  log("Dropping all database tables...");
  
  try {
    // Get all table names from the current schema
    const result = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);
    
    const tables = result.rows.map(row => row.tablename);
    
    if (tables.length === 0) {
      log("No tables to drop");
      return;
    }
    
    // Drop all tables in one query (CASCADE to handle foreign key constraints)
    const dropQuery = `DROP TABLE IF EXISTS ${tables.map(t => `"${t}"`).join(', ')} CASCADE`;
    await pool.query(dropQuery);
    
    log(`Dropped ${tables.length} tables: ${tables.join(', ')}`);
  } catch (error) {
    log(`Error dropping tables: ${error}`);
    throw error;
  }
}

/**
 * Runs database migrations to create all tables
 */
async function runMigrations(): Promise<void> {
  log("Running database migrations...");
  
  try {
    // Run drizzle-kit push to create all tables
    execSync("npm run db:push -- --force", { 
      stdio: "inherit",
      env: { ...process.env }
    });
    
    log("Database migrations completed successfully");
  } catch (error) {
    log(`Error running migrations: ${error}`);
    throw error;
  }
}

/**
 * Seeds the database with default relationship types
 */
async function seedRelationshipTypes(): Promise<void> {
  log("Seeding default relationship types...");
  
  try {
    const defaultTypes = [
      { name: 'Acquaintance', color: '#10b981', value: 10, notes: 'Someone you know casually' },
      { name: 'Friend', color: '#3b82f6', value: 40, notes: 'A good friend' },
      { name: 'Good Friend', color: '#8b5cf6', value: 60, notes: 'A close friend' },
      { name: 'Best Friend', color: '#ec4899', value: 80, notes: 'Your best friend' },
      { name: 'Colleague', color: '#f59e0b', value: 30, notes: 'Someone you work with' },
      { name: 'Family', color: '#ef4444', value: 90, notes: 'Family member' },
      { name: 'Ex-spouse', color: '#6b7280', value: 70, notes: 'Former spouse' },
    ];
    
    // Check which names already exist to avoid creating duplicates
    const existing = await pool.query(`SELECT LOWER(name) as name FROM relationship_types`);
    const existingNames = new Set(existing.rows.map((r: any) => r.name));
    
    for (const type of defaultTypes) {
      if (existingNames.has(type.name.toLowerCase())) continue;
      await pool.query(
        `INSERT INTO relationship_types (name, color, value, notes) 
         VALUES ($1, $2, $3, $4)`,
        [type.name, type.color, type.value, type.notes]
      );
    }
    
    log("Seeded default relationship types");
  } catch (error) {
    log(`Error seeding relationship types: ${error}`);
    // Don't throw - seeding is optional
  }
}

/**
 * Seeds the database with default interaction types
 */
async function seedInteractionTypes(): Promise<void> {
  log("Seeding default interaction types...");
  
  try {
    const defaultTypes = [
      { name: 'Generic', color: '#6b7280', value: 50, description: 'General interaction (cannot be deleted)' },
      { name: 'Meeting', color: '#3b82f6', value: 70, description: 'In-person or virtual meeting' },
      { name: 'Call', color: '#10b981', value: 60, description: 'Phone or video call' },
      { name: 'Email', color: '#f59e0b', value: 40, description: 'Email correspondence' },
      { name: 'Other', color: '#8b5cf6', value: 30, description: 'Other type of interaction' },
    ];
    
    // Check which names already exist to avoid creating duplicates
    const existing = await pool.query(`SELECT LOWER(name) as name FROM interaction_types`);
    const existingNames = new Set(existing.rows.map((r: any) => r.name));
    
    for (const type of defaultTypes) {
      if (existingNames.has(type.name.toLowerCase())) continue;
      await pool.query(
        `INSERT INTO interaction_types (name, color, value, description) 
         VALUES ($1, $2, $3, $4)`,
        [type.name, type.color, type.value, type.description]
      );
    }
    
    log("Seeded default interaction types");
  } catch (error) {
    log(`Error seeding interaction types: ${error}`);
    // Don't throw - seeding is optional
  }
}

/**
 * Seeds the database with default social account types
 */
async function seedSocialAccountTypes(): Promise<void> {
  log("Seeding default social account types...");
  
  try {
    const defaultTypes = [
      { id: '00000000-0000-0000-0001-000000000001', name: 'Instagram', color: '#E4405F' },
      { id: '00000000-0000-0000-0001-000000000002', name: 'Facebook', color: '#1877F2' },
      { id: '00000000-0000-0000-0001-000000000003', name: 'Discord', color: '#5865F2' },
      { id: '00000000-0000-0000-0001-000000000004', name: 'X.com', color: '#000000' },
      { id: '00000000-0000-0000-0001-000000000005', name: 'Generic', color: '#6b7280' },
    ];
    
    for (const type of defaultTypes) {
      await pool.query(
        `INSERT INTO social_account_types (id, name, color) 
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [type.id, type.name, type.color]
      );
    }
    
    log("Seeded default social account types");
  } catch (error) {
    log(`Error seeding social account types: ${error}`);
    // Don't throw - seeding is optional
  }
}

/**
 * Checks if there are any users in the database
 */
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

/**
 * Checks if a table exists in the database
 */
async function tableExists(tableName: string): Promise<boolean> {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      ) as exists
    `, [tableName]);
    return result.rows[0]?.exists || false;
  } catch (error) {
    log(`Error checking if table ${tableName} exists: ${error}`);
    return false;
  }
}

/**
 * Checks if a column exists in a table
 */
async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = $1 
        AND column_name = $2
      ) as exists
    `, [tableName, columnName]);
    return result.rows[0]?.exists || false;
  } catch (error) {
    log(`Error checking if column ${tableName}.${columnName} exists: ${error}`);
    return false;
  }
}

/**
 * Adds a column to a table if it doesn't exist
 */
async function addColumnIfNotExists(
  tableName: string,
  columnName: string,
  columnDefinition: string
): Promise<void> {
  try {
    const exists = await columnExists(tableName, columnName);
    if (!exists) {
      log(`Adding missing column: ${tableName}.${columnName}`);
      await pool.query(`
        ALTER TABLE ${tableName} 
        ADD COLUMN ${columnName} ${columnDefinition}
      `);
      log(`Column ${tableName}.${columnName} added successfully`);
    }
  } catch (error) {
    log(`Error adding column ${tableName}.${columnName}: ${error}`);
    // Don't throw - continue with other migrations
  }
}

/**
 * Migrates follower/following storage to the social_follows edge table.
 * Creates social_follows, backfills it from the deprecated social_network_state
 * arrays (and legacy social_network_snapshots) if present, then drops them.
 */
async function migrateToSocialFollows(): Promise<void> {
  const followsExists = await tableExists("social_follows");
  if (!followsExists) {
    await pool.query(`
      CREATE TABLE social_follows (
        follower_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        followed_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
        source TEXT,
        PRIMARY KEY (follower_id, followed_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS social_follows_followed_id_idx ON social_follows(followed_id)`);
    log("Created social_follows table");
  }

  // Backfill from social_network_state arrays, then drop the table.
  // Entries in the arrays that don't reference an existing account are skipped.
  const stateExists = await tableExists("social_network_state");
  if (stateExists) {
    log("Migrating social_network_state arrays to social_follows...");
    await pool.query(`
      INSERT INTO social_follows (follower_id, followed_id, source)
      SELECT DISTINCT f.fid, sns.social_account_id, 'migration'
      FROM social_network_state sns, unnest(sns.followers) AS f(fid)
      WHERE EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.id = f.fid)
        AND f.fid <> sns.social_account_id
      ON CONFLICT DO NOTHING
    `);
    await pool.query(`
      INSERT INTO social_follows (follower_id, followed_id, source)
      SELECT DISTINCT sns.social_account_id, g.gid, 'migration'
      FROM social_network_state sns, unnest(sns.following) AS g(gid)
      WHERE EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.id = g.gid)
        AND g.gid <> sns.social_account_id
      ON CONFLICT DO NOTHING
    `);
    await pool.query(`DROP TABLE social_network_state`);
    log("Migrated social_network_state to social_follows and dropped old table");
  }

  // Very old databases: latest snapshot per account from social_network_snapshots.
  const snapshotsExists = await tableExists("social_network_snapshots");
  if (snapshotsExists) {
    log("Migrating social_network_snapshots to social_follows...");
    await pool.query(`
      INSERT INTO social_follows (follower_id, followed_id, source)
      SELECT DISTINCT f.fid, s.social_account_id, 'migration'
      FROM (
        SELECT DISTINCT ON (social_account_id) social_account_id, followers
        FROM social_network_snapshots ORDER BY social_account_id, captured_at DESC
      ) s, unnest(COALESCE(s.followers, ARRAY[]::text[])) AS f(fid)
      WHERE EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.id = f.fid)
        AND f.fid <> s.social_account_id
      ON CONFLICT DO NOTHING
    `);
    await pool.query(`
      INSERT INTO social_follows (follower_id, followed_id, source)
      SELECT DISTINCT s.social_account_id, g.gid, 'migration'
      FROM (
        SELECT DISTINCT ON (social_account_id) social_account_id, following
        FROM social_network_snapshots ORDER BY social_account_id, captured_at DESC
      ) s, unnest(COALESCE(s.following, ARRAY[]::text[])) AS g(gid)
      WHERE EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.id = g.gid)
        AND g.gid <> s.social_account_id
      ON CONFLICT DO NOTHING
    `);
    await pool.query(`DROP TABLE social_network_snapshots`);
    log("Migrated social_network_snapshots to social_follows and dropped old table");
  }
}

/**
 * Flattens the current profile back onto social_accounts and builds the
 * social_account_history journal (v4).
 *
 * This replaces the older migrateSocialAccountsToHistorical(), which moved the
 * other direction — into social_profile_versions. That function had to be deleted
 * rather than merely left unused: it keyed off `social_profile_versions exists`
 * and `social_accounts.nickname exists`, so once this migration re-added nickname
 * it would have re-created the versions table and then DROPPED the flattened
 * columns on the very next boot.
 *
 * The two legacy tables are intentionally NOT dropped here. ~214 server references
 * and 21 client files still read them; the drop is a separate guarded step that
 * runs only once those readers are repointed (see dropLegacyProfileTables below).
 */
async function migrateSocialAccountsToJournal(): Promise<void> {
  // 1. Current-profile columns on social_accounts.
  await addColumnIfNotExists("social_accounts", "last_scraped_at", "TIMESTAMP");
  await addColumnIfNotExists("social_accounts", "nickname", "TEXT");
  await addColumnIfNotExists("social_accounts", "bio", "TEXT");
  await addColumnIfNotExists("social_accounts", "account_url", "TEXT");
  await addColumnIfNotExists("social_accounts", "image_url", "TEXT");
  await addColumnIfNotExists("social_accounts", "external_image_url", "TEXT");
  await addColumnIfNotExists("social_accounts", "location", "TEXT");
  await addColumnIfNotExists("social_accounts", "followers_count", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfNotExists("social_accounts", "following_count", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfNotExists("social_accounts", "reported_followers_count", "INTEGER");
  await addColumnIfNotExists("social_accounts", "reported_following_count", "INTEGER");

  // 2. The journal itself.
  if (!(await tableExists("social_account_history"))) {
    await pool.query(`
      CREATE TABLE social_account_history (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        social_account_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        batch_id VARCHAR NOT NULL,
        entry_kind TEXT NOT NULL,
        change_source TEXT NOT NULL,
        capture_scope TEXT NOT NULL DEFAULT 'none',
        is_initial_capture BOOLEAN NOT NULL DEFAULT false,
        pending_import_id VARCHAR,
        observed_via_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE SET NULL,
        detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
        followers_after INTEGER NOT NULL DEFAULT 0,
        followers_added INTEGER NOT NULL DEFAULT 0,
        followers_lost INTEGER NOT NULL DEFAULT 0,
        following_after INTEGER NOT NULL DEFAULT 0,
        following_added INTEGER NOT NULL DEFAULT 0,
        following_lost INTEGER NOT NULL DEFAULT 0,
        reported_followers_after INTEGER,
        reported_following_after INTEGER,
        profile_fields_changed TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        previous_nickname TEXT,
        previous_bio TEXT,
        previous_location TEXT,
        previous_image_url TEXT,
        delta JSONB
      )
    `);
    await pool.query(`CREATE INDEX social_account_history_account_idx ON social_account_history (social_account_id, detected_at)`);
    await pool.query(`CREATE INDEX social_account_history_kind_idx ON social_account_history (social_account_id, entry_kind, detected_at)`);
    log("Created social_account_history table");
  }

  // 2a. What the extension reports it finished collecting (contract v2). Null on
  //     payloads from older builds, which the import path still infers scope for.
  await addColumnIfNotExists("pending_social_account_imports", "capture_scope", "TEXT");

  // 2b. Indexes the ingest path depends on.
  //
  // shared/schema.ts declares these, but nothing ever created them: the tables here
  // are built with raw CREATE TABLE and drizzle-kit push has not run against this
  // database. `social_accounts` was carrying nothing but its primary key, so every
  // username lookup was a sequential scan over the whole table — which is what made
  // the old per-row import (one lookup per CSV row) so expensive.
  //
  // Only the two the import and diff engine actually use are created here. The other
  // declared-but-absent indexes on social_accounts (visibility, owner_uuid, group_id,
  // type_id) affect other pages and are left alone deliberately.
  await pool.query(`CREATE INDEX IF NOT EXISTS social_accounts_username_idx ON social_accounts (username)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_follows_follower_id_idx ON social_follows (follower_id)`);

  // Everything below backfills from the legacy tables, and is first-run-only: these
  // are full-table statements that have no business running on every boot. The
  // baseline count is the marker — it is written at the end of this function and
  // never removed, so its presence means the backfill has already happened.
  const { rows: [{ count: baselineCount }] } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM social_account_history WHERE entry_kind = 'baseline'`
  );
  if (baselineCount > 0) return;

  const hasLegacyVersions = await tableExists("social_profile_versions");

  // 3. Copy each account's current profile down onto the account row. Only fills
  //    columns that are still empty, so re-running can never clobber newer writes.
  if (hasLegacyVersions) {
    await pool.query(`
      UPDATE social_accounts sa SET
        nickname           = COALESCE(sa.nickname, spv.nickname),
        bio                = COALESCE(sa.bio, spv.bio),
        account_url        = COALESCE(sa.account_url, spv.account_url),
        image_url          = COALESCE(sa.image_url, spv.image_url),
        external_image_url = COALESCE(sa.external_image_url, spv.external_image_url)
      FROM social_profile_versions spv
      WHERE spv.social_account_id = sa.id AND spv.is_current = true
    `);
    log("Flattened current profile versions onto social_accounts");
  }

  // 4. Seed the denormalized counts from the live edge table. After this point
  //    applySnapshot() is the only writer of these two columns.
  await pool.query(`
    UPDATE social_accounts sa SET
      followers_count = (SELECT COUNT(*) FROM social_follows WHERE followed_id = sa.id),
      following_count = (SELECT COUNT(*) FROM social_follows WHERE follower_id = sa.id)
  `);

  // 5. One synthetic baseline per account, so the History tab is not empty on day one
  //    and the next real scrape has something to diff against. Writing this last is
  //    what makes the early return at the top of this section correct.
  await pool.query(`
    INSERT INTO social_account_history (
      social_account_id, batch_id, entry_kind, change_source, capture_scope,
      detected_at, followers_after, following_after
    )
    SELECT sa.id, gen_random_uuid(), 'baseline', 'migration', 'none',
           COALESCE(sa.last_scraped_at, sa.created_at, NOW()),
           sa.followers_count, sa.following_count
    FROM social_accounts sa
  `);
  log("Seeded edge counts and wrote baseline history entries");
}

/**
 * Validates and syncs all database tables and columns with the schema
 */
async function validateAndSyncSchema(): Promise<void> {
  log("Validating database schema...");
  
  try {
    // Define all tables and their required columns with definitions
    const schemaDefinitions: Record<string, Record<string, string>> = {
      users: {
        sso_email: "TEXT",
        image_storage_mode: "TEXT NOT NULL DEFAULT 's3'",
      },
      people: {
        social_account_uuids: "TEXT[]",
        elo_rankable: "INTEGER NOT NULL DEFAULT 1",
        sex: "TEXT NOT NULL DEFAULT 'unknown'",
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        maiden_name: "TEXT",
        jobs: "JSONB DEFAULT '[]'::jsonb",
        personface_uuid: "VARCHAR",
      },
      schooling: {
        high_school: "TEXT",
        colleges: "JSONB DEFAULT '[]'::jsonb",
        additional_schooling: "JSONB DEFAULT '[]'::jsonb",
      },
      photos: {
        og_metadata: "JSONB",
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        facial_ids: "JSONB DEFAULT '[]'::jsonb",
      },
      notes: {
        image_uuid: "VARCHAR",
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
      },
      interactions: {
        image_uuid: "VARCHAR",
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
      },
      groups: {
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        center_account_id: "VARCHAR(255) REFERENCES social_accounts(id) ON DELETE SET NULL",
        crowd_members: "TEXT[] DEFAULT ARRAY[]::text[]",
        crowd_last_calculated_at: "TIMESTAMP",
        crowd_mode: "TEXT DEFAULT 'social_accounts'",
        crowd_follow_threshold: "INTEGER DEFAULT 5",
      },
      social_accounts: {
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        is_simple: "BOOLEAN NOT NULL DEFAULT TRUE",
      },
      ai_chats: {
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        agent_mode: "BOOLEAN NOT NULL DEFAULT FALSE",
      },
      daily_notes: {
        user_id: "INTEGER REFERENCES users(id) ON DELETE CASCADE",
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        updated_at: "TIMESTAMP",
        status: "TEXT NOT NULL DEFAULT 'finished'",
      },
      relationships: {
        family_relationship_type: "VARCHAR(50)",
      },
      tasks: {
        title: "TEXT",
      },
      conversations: {
        import_date: "TIMESTAMP",
        import_uuid: "VARCHAR",
      },
      messages: {
        import_date: "TIMESTAMP",
        import_uuid: "VARCHAR",
      },
      message_recipients: {
        import_date: "TIMESTAMP",
        import_uuid: "VARCHAR",
      },
      conversation_participants: {
        import_date: "TIMESTAMP",
        import_uuid: "VARCHAR",
      },
      // Chrome-extension scrape staging area. Columns added after the table's
      // original migration land here so existing databases pick them up on boot.
      pending_social_account_imports: {
        import_type: "TEXT NOT NULL DEFAULT 'full'",
        account_followers_count: "INTEGER",
        account_following_count: "INTEGER",
        account_image_url: "TEXT",
      },
    };

    // The pending-imports table is written by the Chrome extension over
    // X-Extension-Token, so a database that predates it 500s on every
    // POST /api/v1/pending-imports and on the settings page that reads it.
    // The loop below only ever ADDs columns to tables that already exist, so
    // the table itself has to be created here for already-seeded databases —
    // db:push only runs on a full reset, and migrations/*.sql are never applied.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_social_account_imports (
        id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp_added TIMESTAMP WITH TIME ZONE NOT NULL,
        timestamp_imported TIMESTAMP WITH TIME ZONE,
        already_added BOOLEAN NOT NULL DEFAULT false,
        account_username VARCHAR(255) NOT NULL,
        account_display_name VARCHAR(255),
        account_bio TEXT,
        account_website VARCHAR(500),
        account_email VARCHAR(255),
        account_phone VARCHAR(100),
        account_location_area VARCHAR(255),
        account_followers TEXT,
        account_following TEXT,
        account_image_url TEXT,
        account_followers_count INTEGER,
        account_following_count INTEGER,
        import_type TEXT NOT NULL DEFAULT 'full',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_imports_username
      ON pending_social_account_imports (account_username)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_imports_already_added
      ON pending_social_account_imports (already_added)
    `);

    // Check and add missing columns
    for (const [tableName, columns] of Object.entries(schemaDefinitions)) {
      const exists = await tableExists(tableName);
      if (!exists) {
        log(`Warning: Expected table ${tableName} not found. It should be created by migrations.`);
        continue;
      }

      for (const [columnName, columnDef] of Object.entries(columns)) {
        await addColumnIfNotExists(tableName, columnName, columnDef);
      }
    }

    // Backfill image_uuid for notes and interactions from the photos table
    // (safe to run repeatedly — only updates rows where image_uuid is still NULL)
    const photosExists = await tableExists("photos");
    if (photosExists) {
      await pool.query(`
        UPDATE notes n
        SET image_uuid = p.id
        FROM photos p
        WHERE n.image_url IS NOT NULL
          AND n.image_url <> ''
          AND n.image_uuid IS NULL
          AND p.location = n.image_url
      `);
      await pool.query(`
        UPDATE interactions i
        SET image_uuid = p.id
        FROM photos p
        WHERE i.image_url IS NOT NULL
          AND i.image_url <> ''
          AND i.image_uuid IS NULL
          AND p.location = i.image_url
      `);
      log("Backfilled image_uuid for notes and interactions from photos table");
    }

    // Ensure lineage table exists
    const lineageExists = await tableExists("lineage");
    if (!lineageExists) {
      log("Creating lineage table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lineage (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          child_id VARCHAR NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          parent_id VARCHAR NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          lineage_type TEXT NOT NULL DEFAULT 'biological',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT lineage_child_parent_unq UNIQUE (child_id, parent_id)
        )
      `);
      log("Lineage table created successfully");
    }

    // Ensure schooling table exists
    const schoolingExists = await tableExists("schooling");
    if (!schoolingExists) {
      log("Creating schooling table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schooling (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          person_id VARCHAR NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          high_school TEXT,
          colleges JSONB DEFAULT '[]'::jsonb,
          additional_schooling JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("Schooling table created successfully");
    }

    // Ensure partnerships table exists
    const partnershipsExists = await tableExists("partnerships");
    if (!partnershipsExists) {
      log("Creating partnerships table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS partnerships (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          person1_id VARCHAR NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          person2_id VARCHAR NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'partner',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          CONSTRAINT partnerships_person1_person2_unq UNIQUE (person1_id, person2_id)
        )
      `);
      log("Partnerships table created successfully");
    }

    // Ensure tasks table exists
    const tasksExists = await tableExists("tasks");
    if (!tasksExists) {
      log("Creating tasks table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          title TEXT,
          payload TEXT NOT NULL,
          result TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          started_at TIMESTAMP,
          completed_at TIMESTAMP
        )
      `);
      log("Tasks table created successfully");
    }

    // Ensure app_settings table exists
    const appSettingsExists = await tableExists("app_settings");
    if (!appSettingsExists) {
      log("Creating app_settings table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      log("app_settings table created successfully");
    }

    // Ensure ai_chats table exists
    const aiChatsExists = await tableExists("ai_chats");
    if (!aiChatsExists) {
      log("Creating ai_chats table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_chats (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT 'New chat',
          system_message TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          messages JSONB NOT NULL DEFAULT '[]'::jsonb,
          agent_mode BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("ai_chats table created successfully");
    } else {
      // Ensure newer columns exist on pre-existing installations
      await addColumnIfNotExists("ai_chats", "model", "TEXT NOT NULL DEFAULT ''");
    }

    // Ensure sex_guess_queue table exists
    const sexGuessQueueExists = await tableExists("sex_guess_queue");
    if (!sexGuessQueueExists) {
      log("Creating sex_guess_queue table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sex_guess_queue (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          person_id VARCHAR NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          guessed_sex TEXT NOT NULL,
          reasoning TEXT NOT NULL,
          date_added TIMESTAMP NOT NULL DEFAULT NOW(),
          answered INTEGER NOT NULL DEFAULT 0
        )
      `);
      log("sex_guess_queue table created successfully");
    }
    // Ensure snooze_until column exists (added in later migration)
    await addColumnIfNotExists("sex_guess_queue", "snooze_until", "TIMESTAMP");

    // Ensure daily_notes tables exist
    const dailyNotesExists = await tableExists("daily_notes");
    if (!dailyNotesExists) {
      log("Creating daily_notes tables...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_notes (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          user_title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'finished',
          vector_id TEXT,
          vector_synced_at TIMESTAMP,
          updated_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_note_events (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          daily_note_id VARCHAR NOT NULL REFERENCES daily_notes(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_note_involved_parties (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          daily_note_id VARCHAR NOT NULL REFERENCES daily_notes(id) ON DELETE CASCADE,
          party_type TEXT NOT NULL,
          ref_id VARCHAR NOT NULL
        )
      `);
      log("daily_notes tables created successfully");
    }

    // Ensure daily_note_audit_logs table exists
    const dailyNoteAuditLogsExists = await tableExists("daily_note_audit_logs");
    if (!dailyNoteAuditLogsExists) {
      log("Creating daily_note_audit_logs table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_note_audit_logs (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          daily_note_id VARCHAR NOT NULL REFERENCES daily_notes(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
          pin_used BOOLEAN NOT NULL DEFAULT false
        )
      `);
      log("daily_note_audit_logs table created successfully");
    }

    // Migrate follower/following storage to the social_follows edge table (v3)
    await migrateToSocialFollows();

    // Flatten the current profile back onto social_accounts and build the history journal (v4)
    await migrateSocialAccountsToJournal();

    // Create conversations table if it doesn't exist
    const conversationsExists = await tableExists("conversations");
    if (!conversationsExists) {
      log("Creating conversations table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          title TEXT,
          channel_type TEXT NOT NULL,
          social_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE SET NULL,
          external_url TEXT,
          metadata JSONB,
          last_message_at TIMESTAMP,
          import_date TIMESTAMP,
          import_uuid VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("conversations table created successfully");
    }

    // Create messages table if it doesn't exist
    const messagesExists = await tableExists("messages");
    if (!messagesExists) {
      log("Creating messages table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id VARCHAR NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          sender_person_id VARCHAR REFERENCES people(id) ON DELETE SET NULL,
          sender_social_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE SET NULL,
          content TEXT,
          content_type TEXT NOT NULL DEFAULT 'text',
          image_uuids TEXT[] DEFAULT ARRAY[]::text[],
          attachments JSONB,
          external_id TEXT,
          sent_at TIMESTAMP,
          metadata JSONB,
          vector_id TEXT,
          vector_synced_at TIMESTAMP,
          import_date TIMESTAMP,
          import_uuid VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("messages table created successfully");
    }

    // Ensure vector columns exist on messages table
    await addColumnIfNotExists("messages", "vector_id", "TEXT");
    await addColumnIfNotExists("messages", "vector_synced_at", "TIMESTAMP");

    // Create message_recipients table if it doesn't exist
    const recipientsExists = await tableExists("message_recipients");
    if (!recipientsExists) {
      log("Creating message_recipients table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_recipients (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          message_id VARCHAR NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          person_id VARCHAR REFERENCES people(id) ON DELETE SET NULL,
          social_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE SET NULL,
          recipient_type TEXT NOT NULL DEFAULT 'to',
          import_date TIMESTAMP,
          import_uuid VARCHAR
        )
      `);
      log("message_recipients table created successfully");
    }

    // Create conversation_participants table if it doesn't exist
    const participantsExists = await tableExists("conversation_participants");
    if (!participantsExists) {
      log("Creating conversation_participants table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS conversation_participants (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id VARCHAR NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          person_id VARCHAR REFERENCES people(id) ON DELETE SET NULL,
          social_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE SET NULL,
          role TEXT NOT NULL DEFAULT 'participant',
          joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
          import_date TIMESTAMP,
          import_uuid VARCHAR
        )
      `);
      log("conversation_participants table created successfully");
    }

    // Ensure faces table exists
    const facesExists = await tableExists("faces");
    if (!facesExists) {
      log("Creating faces table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS faces (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          photo_id VARCHAR REFERENCES photos(id) ON DELETE CASCADE,
          s3_url TEXT NOT NULL,
          embedding JSONB NOT NULL,
          personface_uuid VARCHAR,
          detection_confidence TEXT,
          coordinates JSONB,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("faces table created successfully");
    }

    // Ensure image_questions table exists
    const imageQuestionsExists = await tableExists("image_questions");
    if (!imageQuestionsExists) {
      log("Creating image_questions table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS image_questions (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          photo_id VARCHAR NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
          face_uuid VARCHAR NOT NULL,
          sub_image_url TEXT NOT NULL,
          coordinates JSONB NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          resolved_as TEXT,
          resolved_person_id VARCHAR REFERENCES people(id) ON DELETE SET NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMP
        )
      `);
      log("image_questions table created successfully");
    }

    // Ensure people.tps_id exists (TruePeopleSearch person link)
    await addColumnIfNotExists("people", "tps_id", "TEXT");
    await addColumnIfNotExists("people", "birthday", "TEXT");
    await addColumnIfNotExists("people", "address", "TEXT");
    await addColumnIfNotExists("people", "additional_emails", "JSONB NOT NULL DEFAULT '[]'::jsonb");
    await addColumnIfNotExists("people", "additional_phones", "JSONB NOT NULL DEFAULT '[]'::jsonb");
    await addColumnIfNotExists("people", "denied_recommendations", "JSONB NOT NULL DEFAULT '[]'::jsonb");

    // Ensure true_person_search table exists (TruePeopleSearch scraped records)
    const truePersonSearchExists = await tableExists("true_person_search");
    if (!truePersonSearchExists) {
      log("Creating true_person_search table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS true_person_search (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          tps_id TEXT NOT NULL,
          person_id VARCHAR REFERENCES people(id) ON DELETE SET NULL,
          import_date TIMESTAMP NOT NULL DEFAULT NOW(),
          full_name TEXT,
          akas JSONB NOT NULL DEFAULT '[]'::jsonb,
          birthday TEXT,
          current_address TEXT,
          current_address_property_details TEXT,
          current_address_property_url TEXT,
          addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
          phone_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
          emails JSONB NOT NULL DEFAULT '[]'::jsonb,
          relatives JSONB NOT NULL DEFAULT '[]'::jsonb,
          associates JSONB NOT NULL DEFAULT '[]'::jsonb,
          background_profile TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("true_person_search table created successfully");
    } else {
      // Drop unique constraint on true_person_search.tps_id to allow multiple entries
      try {
        await pool.query(`
          ALTER TABLE true_person_search DROP CONSTRAINT IF EXISTS true_person_search_tps_id_key;
        `);
      } catch (err) {
        log(`Error dropping unique constraint on true_person_search.tps_id: ${err}`);
      }
    }

    log("Schema validation completed");
  } catch (error) {
    log(`Schema validation error: ${error}`);
    // Don't throw - continue initialization
  }
}

/**
 * Ensures the sso_email column exists in the users table
 * Adds it retroactively if it doesn't exist
 */
async function ensureSsoEmailColumn(): Promise<void> {
  try {
    // Check if the column exists
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'sso_email'
      ) as column_exists
    `);
    
    const columnExists = result.rows[0]?.column_exists || false;
    
    if (!columnExists) {
      log("sso_email column not found. Adding it to users table...");
      
      // Add the column
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN sso_email TEXT
      `);
      
      log("sso_email column added successfully");
    }
  } catch (error) {
    log(`Note: Could not check/add sso_email column: ${error}`);
    // Don't throw - this is a non-critical migration
  }
}

/**
 * Migrates existing data to the multi-user model (Guides/pathway-to-multi-user.md §3).
 *
 * Adds created_by_user_id and visibility to shared tables, backfills from the
 * primary user, and only then promotes the user-private columns to NOT NULL.
 * This cannot live in `schemaDefinitions` because ADD COLUMN ... NOT NULL fails
 * on a table that already has rows — the backfill has to happen in between.
 *
 * Idempotent: safe to run on every boot.
 */
async function migrateToMultiUser(): Promise<void> {
  // The single owner of everything that exists today. Prefer the super admin;
  // then whoever owns the "Me" person; fall back to the lowest user id.
  const primary = await pool.query(`
    SELECT COALESCE(
      (SELECT id FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1),
      (SELECT user_id FROM people WHERE user_id IS NOT NULL ORDER BY user_id LIMIT 1),
      (SELECT id FROM users ORDER BY id LIMIT 1)
    ) AS id
  `);
  const primaryUserId: number | null = primary.rows[0]?.id ?? null;
  if (primaryUserId === null) {
    log("Multi-user migration: no users yet, skipping backfill");
    return;
  }
  log(`Multi-user migration: attributing existing rows to user ${primaryUserId}`);

  // Shared-by-default entities: creator attribution + a visibility flag.
  // `conversations` defaults to private (§8.1); the rest default to public.
  const sharedTables: Array<[table: string, defaultVisibility: string]> = [
    ["people", "public"],
    ["social_accounts", "public"],
    ["groups", "public"],
    ["interactions", "public"],
    ["conversations", "private"],
  ];
  for (const [table, defaultVisibility] of sharedTables) {
    if (!(await tableExists(table))) continue;
    await addColumnIfNotExists(table, "created_by_user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
    await addColumnIfNotExists(table, "visibility", `TEXT NOT NULL DEFAULT '${defaultVisibility}'`);
    await pool.query(
      `UPDATE ${table} SET created_by_user_id = $1 WHERE created_by_user_id IS NULL`,
      [primaryUserId],
    );
  }

  // Attribution only — visibility is derived from their parent rows (§2.4, §3.3).
  for (const table of ["relationships", "photos"]) {
    if (!(await tableExists(table))) continue;
    await addColumnIfNotExists(table, "created_by_user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");
    await pool.query(
      `UPDATE ${table} SET created_by_user_id = $1 WHERE created_by_user_id IS NULL`,
      [primaryUserId],
    );
  }

  // `conversations` previously carried a nullable `user_id`. Fold it into
  // `created_by_user_id` (preferring the real owner over the primary-user
  // default written above) and drop it.
  if (await columnExists("conversations", "user_id")) {
    await pool.query(`UPDATE conversations SET created_by_user_id = user_id WHERE user_id IS NOT NULL`);
    await pool.query(`ALTER TABLE conversations DROP COLUMN user_id`);
    log("Folded conversations.user_id into created_by_user_id");
  }

  // User-private entities: add nullable, backfill, then enforce NOT NULL.
  for (const table of ["notes", "daily_notes", "tasks", "image_tasks"]) {
    if (!(await tableExists(table))) continue;
    await addColumnIfNotExists(table, "user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE");
    await pool.query(`UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`, [primaryUserId]);
    await pool.query(`ALTER TABLE ${table} ALTER COLUMN user_id SET NOT NULL`);
  }

  // One "Me" person per user (§8.4). This fails if existing data has more than
  // one people row per user — historically `people.user_id` was also (mis)used
  // as an owner column. Don't take the whole app down over it; the operator
  // needs to dedupe by hand.
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS people_me_user_id_uniq
      ON people(user_id) WHERE user_id IS NOT NULL
    `);
  } catch (error) {
    log(
      `WARNING: could not create people_me_user_id_uniq (${error}). ` +
      `More than one person row shares a user_id. Resolve with: ` +
      `SELECT user_id, count(*) FROM people WHERE user_id IS NOT NULL GROUP BY user_id HAVING count(*) > 1;`,
    );
  }

  // Per-user settings (§3.4). Instance-wide config stays in app_settings.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )
  `);

  // The bootstrap user owns the instance (§8.5). It becomes the super admin —
  // the one account ordinary admins cannot demote, rename, or delete — and an
  // instance always has at least one.
  await addColumnIfNotExists("users", "role", "TEXT NOT NULL DEFAULT 'user'");
  await pool.query(
    `UPDATE users SET role = 'super_admin'
      WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin')`,
    [primaryUserId],
  );

  log("Multi-user migration complete");
}

/**
 * Seeds example people and groups for demo purposes
 */
async function seedExampleData(userId: number, mePerson: any): Promise<void> {
  log("Seeding example people and groups...");
  
  try {
    // Create 6 example people
    const examplePeople = [
      { firstName: 'Sarah', lastName: 'Johnson', email: 'sarah.johnson@example.com', company: 'Tech Corp', title: 'Senior Developer' },
      { firstName: 'Michael', lastName: 'Chen', email: 'michael.chen@example.com', company: 'Design Studio', title: 'Creative Director' },
      { firstName: 'Emily', lastName: 'Rodriguez', email: 'emily.rodriguez@example.com', company: 'Marketing Plus', title: 'Marketing Manager' },
      { firstName: 'David', lastName: 'Thompson', email: 'david.thompson@example.com', company: 'Startup Inc', title: 'CEO' },
      { firstName: 'Jessica', lastName: 'Williams', email: 'jessica.williams@example.com', company: 'Finance Group', title: 'Financial Analyst' },
      { firstName: 'Alex', lastName: 'Martinez', email: 'alex.martinez@example.com', company: 'Consulting Firm', title: 'Consultant' },
    ];
    
    const createdPeopleIds: string[] = [];
    for (const person of examplePeople) {
      const result = await pool.query(
        `INSERT INTO people (first_name, last_name, email, company, title, created_by_user_id) 
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [person.firstName, person.lastName, person.email, person.company, person.title, userId]
      );
      createdPeopleIds.push(result.rows[0].id);
    }
    
    // Create 2 example groups with members
    const group1Members = [createdPeopleIds[0], createdPeopleIds[1], mePerson.id]; // Sarah, Michael, Me
    const group2Members = [createdPeopleIds[2], createdPeopleIds[3], mePerson.id]; // Emily, David, Me
    
    await pool.query(
      `INSERT INTO groups (name, color, members, created_by_user_id) 
       VALUES ($1, $2, $3, $4)`,
      ['Work Team', '#3b82f6', group1Members, userId]
    );
    
    await pool.query(
      `INSERT INTO groups (name, color, members, created_by_user_id) 
       VALUES ($1, $2, $3, $4)`,
      ['Close Friends', '#ec4899', group2Members, userId]
    );
    
    log("Seeded 6 example people and 2 groups");
  } catch (error) {
    log(`Error seeding example data: ${error}`);
    // Don't throw - example data is optional
  }
}

/**
 * Resets the database and seeds it with default data
 * Optionally recreates a user and seeds example people and groups
 */
export async function resetDatabase(
  userData: { name: string; nickname: string | null; username: string; password: string } | null,
  includeExamples: boolean
): Promise<void> {
  try {
    log("Resetting database...");
    
    // Drop all existing tables (including session table)
    await dropAllTables();
    
    // Create new tables from schema
    await runMigrations();
    
    // Recreate the session table (connect-pg-simple will do this automatically on next access)
    // But we'll force it now to avoid errors
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      ) WITH (OIDS=FALSE);
      
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
    
    // Seed default relationship, interaction, and social account types
    await seedRelationshipTypes();
    await seedInteractionTypes();
    await seedSocialAccountTypes();
    
    // Only recreate user if userData is provided
    if (userData) {
      // Recreate the user (will get a new ID, likely 1)
      const userResult = await pool.query(
        `INSERT INTO users (name, nickname, username, password, role)
         VALUES ($1, $2, $3, $4, 'super_admin')
         RETURNING id`,
        [userData.name, userData.nickname, userData.username, userData.password]
      );
      const newUserId = userResult.rows[0].id;
      
      // Create the "Me" person for the recreated user
      const personResult = await pool.query(
        `INSERT INTO people (user_id, created_by_user_id, first_name, last_name) 
         VALUES ($1, $1, $2, $3)
         RETURNING *`,
        [newUserId, userData.name, '']
      );
      const mePerson = personResult.rows[0];
      
      // Optionally seed example data
      if (includeExamples) {
        await seedExampleData(newUserId, mePerson);
      }
    }
    
    log("Database reset successfully!");
  } catch (error) {
    log(`Database reset failed: ${error}`);
    throw error;
  }
}

/**
 * Initializes the database:
 * - If no users exist, drops all tables and recreates them
 * - Seeds default data (relationship types)
 * - Validates schema and adds missing columns
 */
export async function initializeDatabase(): Promise<void> {
  try {
    log("Checking database initialization status...");
    
    const usersExist = await hasUsers();
    
    if (!usersExist) {
      log("No users found in database. Resetting database...");
      
      // Drop all existing tables
      await dropAllTables();
      
      // Create new tables from schema
      await runMigrations();
      
      // Seed default data
      await seedRelationshipTypes();
      await seedInteractionTypes();
      await seedSocialAccountTypes();
      
      log("Database initialized successfully!");
    } else {
      log("Users found in database. Skipping initialization.");
      
      // Validate schema and add missing columns if needed
      await validateAndSyncSchema();

      // Ownership + visibility columns, backfilled to the primary user.
      await migrateToMultiUser();

      // Always seed defaults so new types (e.g. Ex-spouse) are picked up by existing databases.
      // Seed functions check for existing names before inserting, making this idempotent.
      await seedRelationshipTypes();
      await seedInteractionTypes();
      await seedSocialAccountTypes();
    }

    // Assign any unassigned daily notes to the super admin owner
    await migrateUnassignedDailyNotesToSuperAdmin();

    // Migrate Partner relationship types to spouse role if needed
    await migratePartnerToSpouse();

    // Migrate family relationships to highly normalized tables
    await migrateFamilyToNormalizedSchema();

    // Migrate old pending-import creation types to PRM-chrome import
    await migratePendingImportCreationType();
  } catch (error) {
    log(`Database initialization failed: ${error}`);
    throw error;
  }
}

/**
 * Migrates existing 'Partner' relationship types to 'Family' relationship type
 * with 'spouse' family relationship type role, then deletes the 'Partner' type.
 */
async function migratePartnerToSpouse(): Promise<void> {
  log("Migrating 'Partner' relationship type to family 'spouse'...");
  try {
    // 1. Get 'Partner' type ID
    const partnerTypeRes = await pool.query(
      "SELECT id FROM relationship_types WHERE LOWER(name) = 'partner'"
    );
    if (partnerTypeRes.rows.length === 0) {
      log("'Partner' relationship type not found. Skipping migration.");
      return;
    }
    const partnerTypeId = partnerTypeRes.rows[0].id;

    // 2. Get or create 'Family' type ID
    let familyTypeId;
    const familyTypeRes = await pool.query(
      "SELECT id FROM relationship_types WHERE LOWER(name) = 'family'"
    );
    if (familyTypeRes.rows.length === 0) {
      log("'Family' relationship type not found. Creating it...");
      const insertRes = await pool.query(
        `INSERT INTO relationship_types (name, color, value, notes)
         VALUES ('Family', '#ef4444', 90, 'Family member')
         RETURNING id`
      );
      familyTypeId = insertRes.rows[0].id;
    } else {
      familyTypeId = familyTypeRes.rows[0].id;
    }

    // 3. Find all relationships of type 'Partner'
    const partnerRels = await pool.query(
      "SELECT id, from_person_id, to_person_id FROM relationships WHERE type_id = $1",
      [partnerTypeId]
    );

    log(`Found ${partnerRels.rows.length} relationships of type 'Partner' to migrate.`);

    for (const rel of partnerRels.rows) {
      // Check if a family relationship already exists between these people
      const existingFamilyRes = await pool.query(
        `SELECT id FROM relationships 
         WHERE from_person_id = $1 AND to_person_id = $2 
           AND family_relationship_type IS NOT NULL`,
        [rel.from_person_id, rel.to_person_id]
      );

      if (existingFamilyRes.rows.length > 0) {
        // Duplicate relationship: delete the partner one
        log(`Deleting duplicate partner relationship (ID: ${rel.id}) between ${rel.from_person_id} and ${rel.to_person_id}`);
        await pool.query("DELETE FROM relationships WHERE id = $1", [rel.id]);
      } else {
        // Update to Family with familyRelationshipType = 'spouse'
        log(`Migrating relationship (ID: ${rel.id}) to Family ('spouse')`);
        await pool.query(
          `UPDATE relationships 
           SET type_id = $1, family_relationship_type = 'spouse' 
           WHERE id = $2`,
          [familyTypeId, rel.id]
        );
      }
    }

    // 4. Delete the 'Partner' relationship type
    await pool.query("DELETE FROM relationship_types WHERE id = $1", [partnerTypeId]);
    log("Removed 'Partner' relationship type from database.");

  } catch (error) {
    log(`Error migrating Partner to spouse: ${error}`);
  }
}

/**
 * Migrates family relationships from the generic `relationships` table
 * to `lineage` and `partnerships` tables, then prunes them and deletes the 'Family' relationship type.
 */
async function migrateFamilyToNormalizedSchema(): Promise<void> {
  log("Checking for family migration to normalized schema...");
  try {
    // 1. Check if lineage and partnerships tables are empty
    const lineageCountRes = await pool.query("SELECT COUNT(*) FROM lineage");
    const partnershipsCountRes = await pool.query("SELECT COUNT(*) FROM partnerships");
    const lineageCount = parseInt(lineageCountRes.rows[0].count, 10);
    const partnershipsCount = parseInt(partnershipsCountRes.rows[0].count, 10);

    if (lineageCount > 0 || partnershipsCount > 0) {
      log("Lineage or partnerships tables already have data. Skipping migration.");
      return;
    }

    // 2. Query all relationships that have a familyRelationshipType
    const familyRelsRes = await pool.query(`
      SELECT id, from_person_id, to_person_id, family_relationship_type, notes, created_at
      FROM relationships
      WHERE family_relationship_type IS NOT NULL
    `);

    log(`Found ${familyRelsRes.rows.length} family relationships to migrate.`);

    let lineageMigrated = 0;
    let partnershipsMigrated = 0;

    for (const rel of familyRelsRes.rows) {
      const { from_person_id, to_person_id, family_relationship_type, created_at } = rel;
      const type = family_relationship_type.toLowerCase();

      // Parent-child roles
      const parentRoles = ["father", "mother", "parent", "stepfather", "stepmother", "stepparent"];
      const childRoles = ["child", "son", "daughter", "stepchild", "stepson", "stepdaughter"];
      // Partner roles
      const partnerRoles = ["spouse", "partner", "ex_spouse", "ex_partner"];

      if (parentRoles.includes(type) || childRoles.includes(type)) {
        let parentId: string;
        let childId: string;

        if (parentRoles.includes(type)) {
          parentId = to_person_id;
          childId = from_person_id;
        } else {
          parentId = from_person_id;
          childId = to_person_id;
        }

        const isStep = type.startsWith("step");
        const lineageType = isStep ? "step" : "biological";

        // Insert into lineage
        await pool.query(`
          INSERT INTO lineage (child_id, parent_id, lineage_type, created_at)
          VALUES ($1, $2, $3, COALESCE($4, NOW()))
          ON CONFLICT (child_id, parent_id) DO NOTHING
        `, [childId, parentId, lineageType, created_at]);
        lineageMigrated++;
      } else if (partnerRoles.includes(type)) {
        // Enforce canon order person1Id < person2Id
        const person1Id = from_person_id < to_person_id ? from_person_id : to_person_id;
        const person2Id = from_person_id < to_person_id ? to_person_id : from_person_id;

        // Map status
        let status = "partner";
        if (type === "spouse") status = "married";
        else if (type === "ex_spouse") status = "divorced";
        else if (type === "partner") status = "partner";
        else if (type === "ex_partner") status = "ex_partner";

        // Insert into partnerships
        await pool.query(`
          INSERT INTO partnerships (person1_id, person2_id, status, created_at)
          VALUES ($1, $2, $3, COALESCE($4, NOW()))
          ON CONFLICT (person1_id, person2_id) DO NOTHING
        `, [person1Id, person2Id, status, created_at]);
        partnershipsMigrated++;
      }
    }

    log(`Migrated ${lineageMigrated} lineage records and ${partnershipsMigrated} partnership records.`);

    // 3. Prune these family rows from relationships
    if (familyRelsRes.rows.length > 0) {
      const pruneRes = await pool.query(`
        DELETE FROM relationships
        WHERE family_relationship_type IS NOT NULL
      `);
      log(`Pruned ${pruneRes.rowCount} family relationships from generic table.`);
    }

    // 4. Delete the "Family" type from relationship_types
    await pool.query(`
      DELETE FROM relationship_types
      WHERE LOWER(name) = 'family'
    `);
    log("Deleted 'Family' relationship type from database.");

  } catch (error) {
    log(`Error migrating family relationships to normalized schema: ${error}`);
  }
}

/**
 * Assigns any unassigned daily notes (where user_id is NULL or references a non-existent user)
 * to the super admin instance owner.
 */
async function migrateUnassignedDailyNotesToSuperAdmin(): Promise<void> {
  log("Checking for unassigned daily notes to assign to super admin...");
  try {
    if (!(await tableExists("daily_notes")) || !(await tableExists("users"))) {
      return;
    }

    // Ensure user_id column exists
    await addColumnIfNotExists(
      "daily_notes",
      "user_id",
      "INTEGER REFERENCES users(id) ON DELETE CASCADE"
    );

    // Find the super admin owner (prefer role = 'super_admin', fallback to Me user or first user)
    const superAdminRes = await pool.query(`
      SELECT COALESCE(
        (SELECT id FROM users WHERE role = 'super_admin' ORDER BY id ASC LIMIT 1),
        (SELECT user_id FROM people WHERE user_id IS NOT NULL ORDER BY user_id ASC LIMIT 1),
        (SELECT id FROM users ORDER BY id ASC LIMIT 1)
      ) AS id
    `);

    const superAdminId: number | null = superAdminRes.rows[0]?.id ?? null;
    if (!superAdminId) {
      log("No users found to assign daily notes to. Skipping daily notes assignment.");
      return;
    }

    // Check count of unassigned or invalid-owner daily notes
    const unassignedCountRes = await pool.query(`
      SELECT COUNT(*) as count FROM daily_notes
      WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM users)
    `);
    const count = parseInt(unassignedCountRes.rows[0]?.count || "0", 10);

    if (count > 0) {
      log(`Assigning ${count} unassigned daily note(s) to super admin (user id: ${superAdminId})...`);
      await pool.query(
        `UPDATE daily_notes
         SET user_id = $1
         WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM users)`,
        [superAdminId]
      );
      log(`Successfully assigned ${count} daily note(s) to super admin (user id: ${superAdminId})`);
    }

    // Enforce NOT NULL on user_id if there are no remaining NULLs
    try {
      await pool.query(`ALTER TABLE daily_notes ALTER COLUMN user_id SET NOT NULL`);
    } catch (e) {
      log(`Note: could not enforce NOT NULL on daily_notes.user_id: ${e}`);
    }

    // Ensure index on user_id exists
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS daily_notes_user_id_idx ON daily_notes(user_id)`);
    } catch (e) {
      log(`Note: could not create index daily_notes_user_id_idx: ${e}`);
    }
  } catch (error) {
    log(`Error assigning unassigned daily notes to super admin: ${error}`);
  }
}

/**
 * Migrates existing 'pending-import-ingest' and 'pending-import-contact' creation types
 * on social_accounts to 'PRM-chrome import'.
 */
async function migratePendingImportCreationType(): Promise<void> {
  try {
    if (await tableExists("social_accounts")) {
      const res = await pool.query(`
        UPDATE social_accounts
        SET internal_account_creation_type = 'PRM-chrome import'
        WHERE internal_account_creation_type IN ('pending-import-ingest', 'pending-import-contact')
      `);
      if (res.rowCount && res.rowCount > 0) {
        log(`Updated ${res.rowCount} social account(s) creation type to 'PRM-chrome import'`);
      }
    }

    if (await tableExists("social_profile_versions") && await tableExists("social_accounts")) {
      const resUrl = await pool.query(`
        UPDATE social_profile_versions spv
        SET account_url = 'https://instagram.com/' || sa.username
        FROM social_accounts sa
        WHERE spv.social_account_id = sa.id
          AND spv.is_current = true
          AND sa.internal_account_creation_type = 'PRM-chrome import'
          AND (spv.account_url IS NULL OR spv.account_url = '' OR spv.account_url NOT LIKE '%instagram.com%')
      `);
      if (resUrl.rowCount && resUrl.rowCount > 0) {
        log(`Populated account_url for ${resUrl.rowCount} PRM-chrome imported profile version(s)`);
      }
    }
  } catch (error) {
    log(`Note: could not update pending import creation type or account url: ${error}`);
  }
}


