import { execSync } from "child_process";
import { pool } from "./db";
import { log } from "./vite";
import { applyBigAccountRule, applyMeRule } from "./tracking";

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
  } catch (error: any) {
    // Only a missing users table means "empty"; any other error (e.g. a network
    // blip) must not send boot down the drop-all-tables path.
    if (error?.code === "42P01") return false;
    throw error;
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
 * The retired `_hq` url columns (image-sizes-plan.md Phase 3), read raw so the
 * migrate_profile_image_tiers job and the orphan sweep work whether or not the
 * columns still exist: empty once they are gone.
 */
export async function legacyHqImageUrls(): Promise<{
  accounts: { id: string; imageUrl: string | null; imageUrlHq: string }[];
  history: { id: string; previousImageUrlHq: string }[];
}> {
  const accounts = (await columnExists("social_accounts", "image_url_hq"))
    ? (await pool.query(`SELECT id, image_url AS "imageUrl", image_url_hq AS "imageUrlHq" FROM social_accounts WHERE image_url_hq IS NOT NULL`)).rows
    : [];
  const history = (await columnExists("social_account_history", "previous_image_url_hq"))
    ? (await pool.query(`SELECT id, previous_image_url_hq AS "previousImageUrlHq" FROM social_account_history WHERE previous_image_url_hq IS NOT NULL`)).rows
    : [];
  return { accounts, history };
}

/**
 * What still blocks dropping the `_hq` columns; all zero once migrate_profile_image_tiers
 * has run. A thumb whose parent row is gone is not counted: the job leaves it alone.
 */
export async function legacyProfileImagesPending(): Promise<{ hqAccounts: number; hqHistory: number; thumbs: number }> {
  const { accounts, history } = await legacyHqImageUrls();
  const { rows } = await pool.query(`
    SELECT count(*)::int AS n FROM photos t
    WHERE t.is_sub_image AND t.prm_location LIKE 'profile_image:%'
      AND EXISTS (SELECT 1 FROM photos p WHERE p.id = t.og_metadata->>'derivedFromPhotoId')
  `);
  return { hqAccounts: accounts.length, hqHistory: history.length, thumbs: rows[0].n };
}

/** Creates the social_follows edge table on databases that predate it. */
async function ensureSocialFollowsTable(): Promise<void> {
  if (await tableExists("social_follows")) return;
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

/**
 * The current-profile columns on social_accounts and the social_account_history
 * journal (v4). The legacy social_profile_versions table is intentionally kept:
 * code still reads it.
 */
async function ensureSocialAccountHistorySchema(): Promise<void> {
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
        previous_username TEXT,
        previous_nickname TEXT,
        previous_bio TEXT,
        previous_location TEXT,
        previous_image_url TEXT,
        delta JSONB
      )
    `);
    await pool.query(`CREATE INDEX social_account_history_account_idx ON social_account_history (social_account_id, detected_at)`);
    log("Created social_account_history table");
  }

  // The kind index is partial. Neighbour rows are the bulk of this table, and the only
  // kind-filtered listing anyone browses is 'direct', so restricting the index means
  // the neighbour insert path maintains one index instead of two.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS social_account_history_direct_idx
    ON social_account_history (social_account_id, detected_at DESC)
    WHERE entry_kind = 'direct'
  `);

  // 2a. What the extension reports it finished collecting (contract v2). Null on
  //     payloads from older builds, which the import path still infers scope for.
  await addColumnIfNotExists("pending_social_account_imports", "capture_scope", "TEXT");
  await addColumnIfNotExists("social_account_history", "previous_username", "TEXT");
  // 2c. Posts checks journal what they imported and marked deleted.
  await addColumnIfNotExists("social_account_history", "posts_added", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfNotExists("social_account_history", "posts_deleted", "INTEGER NOT NULL DEFAULT 0");
  // 2d. Profile image tiers (profile-image-tiers-plan.md §2, image-sizes-plan.md Phase 3).
  await addColumnIfNotExists("social_accounts", "is_hq_image", "BOOLEAN NOT NULL DEFAULT FALSE");
  await addColumnIfNotExists("social_account_history", "image_change", "TEXT");

  // Non-unique index matching shared/schema.ts: multiple platforms (or pre-merge duplicates)
  // can share a username, while bulk imports and lookups still rely on an index over username.
  await pool.query(`CREATE INDEX IF NOT EXISTS social_accounts_username_idx ON social_accounts (username)`);
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
      },
      people: {
        social_account_uuids: "TEXT[]",
        elo_rankable: "INTEGER NOT NULL DEFAULT 1",
        sex: "TEXT NOT NULL DEFAULT 'unknown'",
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        maiden_name: "TEXT",
        nickname: "TEXT",
        jobs: "JSONB DEFAULT '[]'::jsonb",
        personface_uuid: "VARCHAR",
        last_described_at: "TIMESTAMP",
        political_left_right: "REAL",
        political_lib_auth: "REAL",
        political_updated_at: "TIMESTAMP",
        ai_backend_notes: "JSONB NOT NULL DEFAULT '[]'::jsonb",
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
        perceptual_hash: "TEXT",
        // Read/written by PRM-Compute (database.py Photo). PRM-Compute never
        // alters the schema itself; it fails on startup if these are missing.
        s3_key: "VARCHAR(512)",
        file_hash: "TEXT",
        face_id_at: "TIMESTAMPTZ",
        ocr_at: "TIMESTAMPTZ",
        ocr_data: "JSONB",
      },
      image_tasks: {
        logs: "TEXT", // PRM-Compute worker.py writes per-task log text here
        image_task_group_id: "VARCHAR REFERENCES image_task_groups(id) ON DELETE CASCADE",
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
        sent_notes: "JSONB NOT NULL DEFAULT '[]'::jsonb", // inbox-notes-plan.md
        // Tracking (account-tracking-plan.md §7)
        interest_level: "TEXT NOT NULL DEFAULT 'none'",
        interest_level_manual: "BOOLEAN NOT NULL DEFAULT FALSE",
        scan_every_days: "INTEGER",
        scan_checked_at: "TIMESTAMP",
        scan_due_at: "TIMESTAMP",
        info_checked_at: "TIMESTAMP",
        follows_checked_at: "TIMESTAMP",
        posts_checked_at: "TIMESTAMP",
        highlights_checked_at: "TIMESTAMP",
        tagged_checked_at: "TIMESTAMP",
        joined_at: "TIMESTAMP",
        reported_posts_count: "INTEGER",
        is_private: "BOOLEAN",
        is_hq_image: "BOOLEAN NOT NULL DEFAULT FALSE",
        personface_uuid: "VARCHAR",
        no_face: "BOOLEAN NOT NULL DEFAULT FALSE",
        banned_actions: "TEXT[] NOT NULL DEFAULT '{}'",
        skip_stories: "BOOLEAN NOT NULL DEFAULT FALSE",
        is_starred: "BOOLEAN NOT NULL DEFAULT FALSE",
        ai_summary: "JSONB",
        ai_summary_generated_at: "TIMESTAMP",
        ai_summary_invalidated: "BOOLEAN NOT NULL DEFAULT FALSE",
        ai_summary_invalidated_at: "TIMESTAMP",
        ai_summary_model: "TEXT",
        ai_backend_notes: "JSONB NOT NULL DEFAULT '[]'::jsonb",
      },
      ai_chats: {
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        agent_mode: "BOOLEAN NOT NULL DEFAULT FALSE",
        context_entities: "JSONB NOT NULL DEFAULT '[]'::jsonb",
        provider_id: "TEXT NOT NULL DEFAULT ''",
      },
      daily_notes: {
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
        progress: "INTEGER NOT NULL DEFAULT 0",
        progress_message: "TEXT",
      },
      conversations: {
        chunked_at: "TIMESTAMP",
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
      social_account_posts: {
        metadata: "JSONB",
        scraped_from: "TEXT",
        likes_hidden: "BOOLEAN NOT NULL DEFAULT false",
        instagram_pk: "TEXT",
        coauthor_account_ids: "JSONB NOT NULL DEFAULT '[]'::jsonb",
        video_transcript: "JSONB",
        video_transcript_at: "TIMESTAMPTZ",
        ai_summary: "JSONB",
        ai_summary_at: "TIMESTAMP",
        ai_summary_model: "TEXT",
        seen_by: "JSONB",
        capture_type: "TEXT",
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
      },
      story_scrape_runs: {
        token_hash: "TEXT",
        token_expires_at: "TIMESTAMP",
        importer_id: "VARCHAR REFERENCES story_importers(id) ON DELETE SET NULL",
        scraped_from: "TEXT",
        kind: "TEXT NOT NULL DEFAULT 'stories'",
      },
      story_importers: {
        service_secret: "TEXT NOT NULL DEFAULT ''",
        tracking_enabled: "BOOLEAN NOT NULL DEFAULT FALSE",
        tracking_window: "TEXT NOT NULL DEFAULT '07:00-10:00'",
        tracking_max_jobs: "INTEGER NOT NULL DEFAULT 40",
        next_tracking_run_at: "TIMESTAMP",
        unseen_only: "BOOLEAN NOT NULL DEFAULT FALSE",
        run_now_unseen_only: "BOOLEAN NOT NULL DEFAULT FALSE",
      },
      tracking_jobs: {
        batch_id: "VARCHAR",
        attempts: "INTEGER NOT NULL DEFAULT 0",
        scan_mode: "TEXT",
        scan_received_at: "TIMESTAMP",
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

    // Same reason: events post-date every existing database.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        sub_title TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        log JSONB NOT NULL DEFAULT '[]'::jsonb,
        seen_at TIMESTAMP,
        acknowledged_at TIMESTAMP,
        ai_seen_at TIMESTAMP,
        parent_event_id VARCHAR REFERENCES events(id) ON DELETE CASCADE,
        person_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        social_account_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[]
      );
      CREATE INDEX IF NOT EXISTS events_created_at_idx ON events (created_at);
      CREATE INDEX IF NOT EXISTS events_parent_idx ON events (parent_event_id);
      CREATE INDEX IF NOT EXISTS events_people_gin ON events USING gin (person_ids);
      CREATE INDEX IF NOT EXISTS events_social_accounts_gin ON events USING gin (social_account_ids);
      ALTER TABLE events ADD COLUMN IF NOT EXISTS next_steps TEXT;
    `);

    // Same reason as above: these two tables post-date most databases.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS insights (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        source TEXT,
        collected_at TIMESTAMP NOT NULL DEFAULT now(),
        raw_text TEXT,
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        applicable_people_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
        applicable_social_account_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[]
      );
      CREATE INDEX IF NOT EXISTS insights_collected_at_idx ON insights (collected_at);
      CREATE INDEX IF NOT EXISTS insights_people_gin ON insights USING gin (applicable_people_ids);
      CREATE INDEX IF NOT EXISTS insights_social_accounts_gin ON insights USING gin (applicable_social_account_ids);
      CREATE TABLE IF NOT EXISTS osint_scans (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        tool TEXT NOT NULL,
        target TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'username',
        options JSONB NOT NULL DEFAULT '{}'::jsonb,
        social_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        compute_job_id TEXT,
        error TEXT,
        result JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS osint_scans_status_created_idx ON osint_scans (status, created_at);
      CREATE INDEX IF NOT EXISTS osint_scans_social_tool_status_idx ON osint_scans (social_account_id, tool, status, completed_at);
      CREATE INDEX IF NOT EXISTS osint_scans_person_tool_status_idx ON osint_scans (person_id, tool, status, completed_at);
      ALTER TABLE osint_scans ADD COLUMN IF NOT EXISTS person_id VARCHAR REFERENCES people(id) ON DELETE CASCADE;
      -- Live rows are unique per owner (account or person) + tool + target: a person has several targets.
      CREATE UNIQUE INDEX IF NOT EXISTS osint_scans_live_owner_uniq ON osint_scans ((coalesce(social_account_id, person_id)), tool, target)
        WHERE status IN ('pending','running');
      CREATE UNIQUE INDEX IF NOT EXISTS osint_scans_live_demo_uniq ON osint_scans (tool, target)
        WHERE social_account_id IS NULL AND person_id IS NULL AND status IN ('pending','running');
      CREATE TABLE IF NOT EXISTS story_scrape_runs (
        id VARCHAR PRIMARY KEY,
        status TEXT NOT NULL,
        started_at TIMESTAMP NOT NULL,
        finished_at TIMESTAMP,
        counts JSONB NOT NULL DEFAULT '{}'::jsonb,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        error TEXT,
        token_hash TEXT,
        token_expires_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS story_scrape_runs_started_idx ON story_scrape_runs (started_at);
      CREATE INDEX IF NOT EXISTS story_scrape_runs_token_idx ON story_scrape_runs (token_hash);
      CREATE TABLE IF NOT EXISTS image_summary_word_clouds (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        status TEXT NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT now(),
        finished_at TIMESTAMP,
        posts_total INTEGER NOT NULL DEFAULT 0,
        posts_processed INTEGER NOT NULL DEFAULT 0,
        summaries_processed INTEGER NOT NULL DEFAULT 0,
        words_counted INTEGER NOT NULL DEFAULT 0,
        words JSONB NOT NULL DEFAULT '[]'::jsonb,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS story_importers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        label TEXT NOT NULL,
        service_url TEXT NOT NULL DEFAULT '',
        service_secret TEXT NOT NULL DEFAULT '',
        enabled BOOLEAN NOT NULL DEFAULT false,
        run_every_days INTEGER NOT NULL DEFAULT 1,
        run_window TEXT NOT NULL DEFAULT '19:30-22:30',
        skip_day_probability REAL NOT NULL DEFAULT 0.08,
        download_videos BOOLEAN NOT NULL DEFAULT false,
        unseen_only BOOLEAN NOT NULL DEFAULT false,
        run_now_unseen_only BOOLEAN NOT NULL DEFAULT false,
        next_run_at TIMESTAMP,
        last_username TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS tracking_jobs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        social_account_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        origin TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        importer_id VARCHAR REFERENCES story_importers(id) ON DELETE SET NULL,
        run_id VARCHAR REFERENCES story_scrape_runs(id) ON DELETE SET NULL,
        result JSONB,
        error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        started_at TIMESTAMP,
        finished_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS tracking_jobs_status_idx ON tracking_jobs (status);
      CREATE INDEX IF NOT EXISTS tracking_jobs_account_idx ON tracking_jobs (social_account_id, created_at);
      CREATE TABLE IF NOT EXISTS social_post_comments (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id VARCHAR NOT NULL REFERENCES social_account_posts(id) ON DELETE CASCADE,
        instagram_comment_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        like_count INTEGER NOT NULL DEFAULT 0,
        posted_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS social_post_comments_post_id_idx ON social_post_comments (post_id);
      CREATE INDEX IF NOT EXISTS social_post_comments_username_idx ON social_post_comments (username);
      CREATE TABLE IF NOT EXISTS social_account_issues (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        social_account_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        job_id VARCHAR REFERENCES tracking_jobs(id) ON DELETE SET NULL,
        job_kind TEXT,
        times_seen INTEGER NOT NULL DEFAULT 1,
        first_seen_at TIMESTAMP NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMP NOT NULL DEFAULT now(),
        resolution TEXT,
        previous_username TEXT,
        resolved_at TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS social_account_issues_open_uniq ON social_account_issues (social_account_id, kind) WHERE status = 'open';
      CREATE INDEX IF NOT EXISTS social_account_issues_account_idx ON social_account_issues (social_account_id);
      CREATE TABLE IF NOT EXISTS historical_account_summaries (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        social_account_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        content JSONB NOT NULL,
        model TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        invalidated_at TIMESTAMP,
        replaced_at TIMESTAMP NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS historical_account_summaries_account_idx ON historical_account_summaries (social_account_id, replaced_at);
      CREATE TABLE IF NOT EXISTS summary_jobs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        kind TEXT NOT NULL,
        target_id VARCHAR NOT NULL,
        social_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        options JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS summary_jobs_status_created_idx ON summary_jobs (status, created_at);
      CREATE INDEX IF NOT EXISTS summary_jobs_account_idx ON summary_jobs (social_account_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS summary_jobs_live_uniq ON summary_jobs (kind, target_id) WHERE status IN ('pending', 'running');
      ALTER TABLE summary_jobs ADD COLUMN IF NOT EXISTS progress JSONB;
      CREATE TABLE IF NOT EXISTS image_task_groups (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'general',
        status TEXT NOT NULL DEFAULT 'pending',
        parent_task_id VARCHAR REFERENCES tasks(id) ON DELETE SET NULL,
        social_run_id VARCHAR REFERENCES story_scrape_runs(id) ON DELETE SET NULL,
        social_account_id VARCHAR REFERENCES social_accounts(id) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS image_task_groups_status_idx ON image_task_groups (status);
      CREATE INDEX IF NOT EXISTS image_task_groups_parent_task_id_idx ON image_task_groups (parent_task_id);
      CREATE INDEX IF NOT EXISTS image_task_groups_social_run_id_idx ON image_task_groups (social_run_id);
      CREATE INDEX IF NOT EXISTS image_task_groups_created_at_idx ON image_task_groups (created_at);
      CREATE INDEX IF NOT EXISTS image_tasks_group_id_idx ON image_tasks (image_task_group_id);
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

    // Posts/stories: these indexes need the columns the loop above just added.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS social_account_posts_scraped_from_idx ON social_account_posts (scraped_from);
      CREATE INDEX IF NOT EXISTS social_account_posts_instagram_pk_idx ON social_account_posts (instagram_pk);
      CREATE INDEX IF NOT EXISTS social_account_posts_coauthor_account_ids_idx ON social_account_posts USING gin (coauthor_account_ids);
      CREATE INDEX IF NOT EXISTS tracking_jobs_batch_idx ON tracking_jobs (batch_id);
      CREATE INDEX IF NOT EXISTS photos_prm_location_idx ON photos (prm_location);
    `);

    // Tracking: the due-date index needs the column the loop above just added, and
    // the "me" rule (accounts on either side of a me account start at medium) is
    // idempotent, so it simply runs on every boot.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS social_accounts_interest_level_idx ON social_accounts (interest_level);
      CREATE INDEX IF NOT EXISTS social_accounts_scan_due_idx ON social_accounts (scan_due_at) WHERE scan_due_at IS NOT NULL;
      -- Story items find their account by LOWER(username).
      CREATE INDEX IF NOT EXISTS social_accounts_username_lower_idx ON social_accounts (LOWER(username));
    `);
    await applyMeRule();
    await applyBigAccountRule();

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
          progress INTEGER NOT NULL DEFAULT 0,
          progress_message TEXT,
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

    // AI provider connections (Ollama / OpenAI-compatible)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_providers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_url TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'none',
        username TEXT NOT NULL DEFAULT '',
        secret TEXT NOT NULL DEFAULT '',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        is_external BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Ensure ai_chats table exists
    const aiChatsExists = await tableExists("ai_chats");
    if (!aiChatsExists) {
      log("Creating ai_chats table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_chats (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          title TEXT NOT NULL DEFAULT 'New chat',
          system_message TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          messages JSONB NOT NULL DEFAULT '[]'::jsonb,
          agent_mode BOOLEAN NOT NULL DEFAULT FALSE,
          context_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
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
    // Ensure snooze_until column exists
    await addColumnIfNotExists("sex_guess_queue", "snooze_until", "TIMESTAMP");

    // Ensure daily_notes tables exist
    const dailyNotesExists = await tableExists("daily_notes");
    if (!dailyNotesExists) {
      log("Creating daily_notes tables...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_notes (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
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

    // Follower/following edges, and the social account history journal
    await ensureSocialFollowsTable();
    await ensureSocialAccountHistorySchema();

    // Create conversations table if it doesn't exist
    const conversationsExists = await tableExists("conversations");
    if (!conversationsExists) {
      log("Creating conversations table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
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
          import_date TIMESTAMP,
          import_uuid VARCHAR,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("messages table created successfully");
    }

    // Messages are vectorized as overlapping chunks (server/message-chunks.ts)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_chunks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id VARCHAR NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        message_ids TEXT[] NOT NULL,
        start_at TIMESTAMP,
        end_at TIMESTAMP,
        char_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        vector_synced_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS message_chunks_conversation_idx ON message_chunks (conversation_id, seq)`);

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

    await pool.query(`CREATE INDEX IF NOT EXISTS social_accounts_personface_uuid_idx ON social_accounts (personface_uuid)`);

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
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      log("faces table created successfully");
    }
    await addColumnIfNotExists("faces", "dismissed_at", "TIMESTAMPTZ");
    await addColumnIfNotExists("faces", "auto_match_score", "REAL");
    await addColumnIfNotExists("faces", "yaw", "REAL");
    await addColumnIfNotExists("faces", "pitch", "REAL");
    await addColumnIfNotExists("faces", "roll", "REAL");
    await addColumnIfNotExists("faces", "sharpness", "REAL");
    await addColumnIfNotExists("faces", "cluster_id", "VARCHAR");
    await addColumnIfNotExists("faces", "noise_reason", "TEXT");
    await pool.query(`CREATE INDEX IF NOT EXISTS faces_cluster_id_idx ON faces (cluster_id) WHERE cluster_id IS NOT NULL`);
    await addColumnIfNotExists("faces", "verify_personface_uuid", "VARCHAR");
    await addColumnIfNotExists("faces", "verify_score", "REAL");
    await pool.query(`CREATE INDEX IF NOT EXISTS faces_verify_personface_uuid_idx ON faces (verify_personface_uuid) WHERE verify_personface_uuid IS NOT NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS face_clusters (
        id VARCHAR PRIMARY KEY,
        size INTEGER NOT NULL,
        medoid_face_id VARCHAR NOT NULL,
        montage_face_ids JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS face_cluster_rejections (
        face_id VARCHAR NOT NULL,
        identity_id VARCHAR NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (face_id, identity_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reference_records (
        id VARCHAR PRIMARY KEY,
        crop_url TEXT NOT NULL,
        name TEXT,
        bio TEXT,
        location JSONB NOT NULL,
        collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE reference_records ADD COLUMN IF NOT EXISTS role TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS reference_records_collected_at_idx ON reference_records (collected_at)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reference_vectors (
        id VARCHAR(36) PRIMARY KEY,
        embedding JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS faces_photo_id_idx ON faces (photo_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS faces_personface_uuid_idx ON faces (personface_uuid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS people_personface_uuid_idx ON people (personface_uuid)`);

    // People list / family-tree lookups: relationships only had its PK, and the
    // lineage/partnership unique indexes only cover lookups on their first column.
    await pool.query(`CREATE INDEX IF NOT EXISTS relationships_from_person_idx ON relationships (from_person_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS relationships_to_person_idx ON relationships (to_person_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS lineage_parent_id_idx ON lineage (parent_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS partnerships_person2_id_idx ON partnerships (person2_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS social_accounts_created_at_idx ON social_accounts (created_at DESC)`);

    // Ensure face_pair_dismissals table exists
    const facePairDismissalsExists = await tableExists("face_pair_dismissals");
    if (!facePairDismissalsExists) {
      log("Creating face_pair_dismissals table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS face_pair_dismissals (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          group_a_uuid VARCHAR NOT NULL,
          group_b_uuid VARCHAR NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      log("face_pair_dismissals table created successfully");
    }
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS face_pair_dismissals_pair_idx ON face_pair_dismissals (group_a_uuid, group_b_uuid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS face_pair_dismissals_group_a_idx ON face_pair_dismissals (group_a_uuid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS face_pair_dismissals_group_b_idx ON face_pair_dismissals (group_b_uuid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS image_tasks_pending_idx ON image_tasks (type, created_at) WHERE status = 'pending'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS tasks_type_created_at_idx ON tasks (type, created_at DESC)`);

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
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        )
      `);
      log("image_questions table created successfully");
    }

    // PRM-Compute's own tables (database.py ApiKey / SetupState / OsintJob).
    // PRM owns the schema for the shared database; PRM-Compute only validates
    // it on startup and errors out if anything it expects is missing.
    if (!(await tableExists("prm_face_api_keys"))) {
      log("Creating prm_face_api_keys table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS prm_face_api_keys (
          id VARCHAR(36) PRIMARY KEY,
          key_hash VARCHAR(64) NOT NULL UNIQUE,
          label VARCHAR(255),
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ
        )
      `);
      log("prm_face_api_keys table created successfully");
    }

    if (!(await tableExists("social_account_daily_stats"))) {
      log("Creating social_account_daily_stats table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS social_account_daily_stats (
          day DATE PRIMARY KEY,
          total_accounts INTEGER NOT NULL,
          checked_accounts INTEGER,
          posts_checked_accounts INTEGER,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      // Totals for every past day can be rebuilt from created_at (accounts deleted since are missing);
      // checked counts can't, so those stay null until the scheduler's first snapshot.
      await pool.query(`
        WITH created AS (SELECT created_at::date AS day, count(*) AS n FROM social_accounts GROUP BY 1),
        days AS (SELECT d::date AS day FROM generate_series((SELECT min(day) FROM created), CURRENT_DATE - 1, interval '1 day') d)
        INSERT INTO social_account_daily_stats (day, total_accounts)
        SELECT days.day, (sum(coalesce(created.n, 0)) OVER (ORDER BY days.day))::int
        FROM days LEFT JOIN created USING (day)
        ON CONFLICT (day) DO NOTHING
      `);
      log("social_account_daily_stats table created successfully");
    }

    if (!(await tableExists("setup_state"))) {
      log("Creating setup_state table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS setup_state (
          id VARCHAR(4) PRIMARY KEY,
          setup_completed BOOLEAN NOT NULL DEFAULT FALSE,
          setup_code_hash VARCHAR(64)
        )
      `);
      log("setup_state table created successfully");
    }

    if (!(await tableExists("osint_jobs"))) {
      log("Creating osint_jobs table...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS osint_jobs (
          id VARCHAR(36) PRIMARY KEY,
          tool VARCHAR(64) NOT NULL,
          target VARCHAR(128) NOT NULL,
          target_type VARCHAR(32) NOT NULL,
          options JSON NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL,
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ,
          result JSON,
          error TEXT,
          raw_output_path TEXT
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS ix_osint_jobs_status ON osint_jobs(status)`);
      log("osint_jobs table created successfully");
    }

    // Ensure people.tps_id exists (TruePeopleSearch person link)
    await addColumnIfNotExists("people", "tps_id", "TEXT");
    await addColumnIfNotExists("people", "birthday", "TEXT");
    await addColumnIfNotExists("people", "additional_emails", "JSONB NOT NULL DEFAULT '[]'::jsonb");
    await addColumnIfNotExists("people", "additional_phones", "JSONB NOT NULL DEFAULT '[]'::jsonb");
    await addColumnIfNotExists("people", "osint_runs", `JSONB NOT NULL DEFAULT '{"emails":[],"phones":[],"usernames":[]}'::jsonb`);
    await addColumnIfNotExists("people", "denied_recommendations", "JSONB NOT NULL DEFAULT '[]'::jsonb");
    await addColumnIfNotExists("people", "is_low_value", "INTEGER NOT NULL DEFAULT 0");
    await pool.query(`CREATE INDEX IF NOT EXISTS people_is_low_value_idx ON people (is_low_value)`);

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
          business_connections JSONB NOT NULL DEFAULT '[]'::jsonb,
          jobs JSONB NOT NULL DEFAULT '[]'::jsonb,
          colleges JSONB NOT NULL DEFAULT '[]'::jsonb,
          background_profile TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("true_person_search table created successfully");
    }
    await pool.query(`
      ALTER TABLE true_person_search ADD COLUMN IF NOT EXISTS business_connections JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE true_person_search ADD COLUMN IF NOT EXISTS jobs JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE true_person_search ADD COLUMN IF NOT EXISTS colleges JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    // Map demo geocode cache (map-page-plan.md §2)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS geocodes (
        query TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        display_name TEXT,
        geocoded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Address history (address-history-plan.md §2); same as personAddresses in shared/schema.ts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS person_addresses (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        person_id VARCHAR NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        label TEXT,
        start_date TEXT,
        end_date TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual',
        property_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS person_addresses_person_id_idx ON person_addresses(person_id)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS person_addresses_one_primary ON person_addresses(person_id) WHERE is_primary = 1`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS person_addresses_person_query ON person_addresses(person_id, lower(regexp_replace(trim(address), '[[:space:]]+', ' ', 'g')))`);

    // Instagram highlights (pinned-stories-plan.md); same as instagramHighlights / instagramHighlightMemberships in shared/schema.ts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS instagram_highlights (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        social_account_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        instagram_id TEXT NOT NULL,
        title TEXT,
        color TEXT NOT NULL,
        first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_seen_at TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS instagram_highlights_account_ig_idx ON instagram_highlights(social_account_id, instagram_id);
      CREATE TABLE IF NOT EXISTS instagram_highlight_memberships (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        highlight_id VARCHAR NOT NULL REFERENCES instagram_highlights(id) ON DELETE CASCADE,
        story_pk TEXT NOT NULL,
        position INTEGER NOT NULL,
        placed_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_confirmed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        left_seen_at TIMESTAMP,
        left_reason TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS instagram_highlight_memberships_open_idx ON instagram_highlight_memberships(highlight_id, story_pk) WHERE left_seen_at IS NULL;
    `);

    // Tagged posts (tagged-posts-plan.md); same as socialAccountPostTags in shared/schema.ts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_account_post_tags (
        post_id VARCHAR NOT NULL REFERENCES social_account_posts(id) ON DELETE CASCADE,
        social_account_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        removed_seen_at TIMESTAMP,
        PRIMARY KEY (post_id, social_account_id)
      );
      CREATE INDEX IF NOT EXISTS social_account_post_tags_account_idx ON social_account_post_tags(social_account_id);
    `);

    log("Schema validation completed");
  } catch (error) {
    log(`Schema validation error: ${error}`);
    // Don't throw - continue initialization
  }
}

/**
 * Seeds example people and groups for demo purposes
 */
async function seedExampleData(mePerson: any): Promise<void> {
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
        `INSERT INTO people (first_name, last_name, email, company, title) 
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [person.firstName, person.lastName, person.email, person.company, person.title]
      );
      createdPeopleIds.push(result.rows[0].id);
    }
    
    // Create 2 example groups with members
    const group1Members = [createdPeopleIds[0], createdPeopleIds[1], mePerson.id]; // Sarah, Michael, Me
    const group2Members = [createdPeopleIds[2], createdPeopleIds[3], mePerson.id]; // Emily, David, Me
    
    await pool.query(
      `INSERT INTO groups (name, color, members) 
       VALUES ($1, $2, $3)`,
      ['Work Team', '#3b82f6', group1Members]
    );
    
    await pool.query(
      `INSERT INTO groups (name, color, members) 
       VALUES ($1, $2, $3)`,
      ['Close Friends', '#ec4899', group2Members]
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

    // Ensure PRM-Compute tables, columns, and custom SQL indexes exist
    await validateAndSyncSchema();
    
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
      await pool.query(
        `INSERT INTO users (name, nickname, username, password)
         VALUES ($1, $2, $3, $4)`,
        [userData.name, userData.nickname, userData.username, userData.password]
      );
      
      // Create the "Me" person for the recreated user
      const personResult = await pool.query(
        `INSERT INTO people (first_name, last_name) 
         VALUES ($1, $2)
         RETURNING *`,
        [userData.name, '']
      );
      const mePerson = personResult.rows[0];
      await pool.query(
        `INSERT INTO app_settings (key, value) VALUES ('me_person_id', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [mePerson.id]
      );
      
      // Optionally seed example data
      if (includeExamples) {
        await seedExampleData(mePerson);
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

      // Ensure PRM-Compute tables, columns, and custom SQL indexes exist
      await validateAndSyncSchema();
      
      // Seed default data
      await seedRelationshipTypes();
      await seedInteractionTypes();
      await seedSocialAccountTypes();
      
      log("Database initialized successfully!");
    } else {
      log("Users found in database. Skipping initialization.");
      
      // Validate schema and add missing columns if needed
      await validateAndSyncSchema();

      // Always seed defaults so new types (e.g. Ex-spouse) are picked up by existing databases.
      // Seed functions check for existing names before inserting, making this idempotent.
      await seedRelationshipTypes();
      await seedInteractionTypes();
      await seedSocialAccountTypes();
    }
  } catch (error) {
    log(`Database initialization failed: ${error}`);
    throw error;
  }
}
