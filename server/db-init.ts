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
    
    for (const type of defaultTypes) {
      await pool.query(
        `INSERT INTO relationship_types (name, color, value, notes) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
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
    
    for (const type of defaultTypes) {
      await pool.query(
        `INSERT INTO interaction_types (name, color, value, description) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
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
 * Migrates social_accounts from flat model to historical model.
 * Creates social_profile_versions and social_network_state/social_network_changes tables,
 * copies existing data, then drops old columns.
 */
async function migrateSocialAccountsToHistorical(): Promise<void> {
  const profileVersionsExists = await tableExists("social_profile_versions");
  const networkStateExists = await tableExists("social_network_state");
  const networkChangesExists = await tableExists("social_network_changes");

  if (profileVersionsExists && networkStateExists && networkChangesExists) {
    await addColumnIfNotExists("social_accounts", "last_scraped_at", "TIMESTAMP");
    return;
  }

  log("Migrating social_accounts to historical model...");

  // 1. Create social_profile_versions table
  if (!profileVersionsExists) {
    await pool.query(`
      CREATE TABLE social_profile_versions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        social_account_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        nickname TEXT,
        bio TEXT,
        account_url TEXT,
        image_url TEXT,
        external_image_url TEXT,
        detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
        is_current BOOLEAN NOT NULL DEFAULT true
      )
    `);
    log("Created social_profile_versions table");
  }

  // 2. Create social_network_state table
  if (!networkStateExists) {
    await pool.query(`
      CREATE TABLE social_network_state (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        social_account_id VARCHAR NOT NULL UNIQUE REFERENCES social_accounts(id) ON DELETE CASCADE,
        follower_count INTEGER NOT NULL DEFAULT 0,
        following_count INTEGER NOT NULL DEFAULT 0,
        followers TEXT[] DEFAULT ARRAY[]::text[],
        following TEXT[] DEFAULT ARRAY[]::text[],
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    log("Created social_network_state table");
  }

  // 3. Create social_network_changes table
  if (!networkChangesExists) {
    await pool.query(`
      CREATE TABLE social_network_changes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        social_account_id VARCHAR NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
        change_type VARCHAR NOT NULL,
        direction VARCHAR NOT NULL,
        target_account_id VARCHAR NOT NULL,
        detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
        batch_id VARCHAR
      )
    `);
    log("Created social_network_changes table");
  }

  // 4. Migrate data from old social_network_snapshots table if it exists
  const snapshotsExists = await tableExists("social_network_snapshots");
  if (snapshotsExists && !networkStateExists) {
    log("Migrating social_network_snapshots to social_network_state...");
    await pool.query(`
      INSERT INTO social_network_state (social_account_id, follower_count, following_count, followers, following, updated_at)
      SELECT DISTINCT ON (social_account_id) social_account_id, follower_count, following_count,
        COALESCE(followers, ARRAY[]::text[]),
        COALESCE(following, ARRAY[]::text[]),
        captured_at
      FROM social_network_snapshots
      ORDER BY social_account_id, captured_at DESC
    `);
    log("Migrated latest snapshots to social_network_state");

    await pool.query(`DROP TABLE social_network_snapshots`);
    log("Dropped old social_network_snapshots table");
  }

  // 5. Check if old columns exist on social_accounts (original flat model migration)
  const hasNickname = await columnExists("social_accounts", "nickname");
  const hasAccountUrl = await columnExists("social_accounts", "account_url");
  const hasFollowers = await columnExists("social_accounts", "followers");

  if (hasNickname || hasAccountUrl || hasFollowers) {
    log("Copying existing data to new tables...");

    if (hasNickname) {
      await pool.query(`
        INSERT INTO social_profile_versions (social_account_id, nickname, account_url, image_url, detected_at, is_current)
        SELECT id, nickname, account_url, image_url, COALESCE(created_at, NOW()), true
        FROM social_accounts
      `);
      log("Copied profile data to social_profile_versions");
    }

    if (hasFollowers) {
      await pool.query(`
        INSERT INTO social_network_state (social_account_id, follower_count, following_count, followers, following, updated_at)
        SELECT id,
          COALESCE(array_length(followers, 1), 0),
          COALESCE(array_length(following, 1), 0),
          COALESCE(followers, ARRAY[]::text[]),
          COALESCE(following, ARRAY[]::text[]),
          COALESCE(created_at, NOW())
        FROM social_accounts
      `);
      log("Copied network data to social_network_state");
    }

    // 6. Drop old columns
    const columnsToDrop = ['nickname', 'account_url', 'image_url', 'notes', 'following', 'followers', 'latest_import_followers', 'latest_import_following'];
    for (const col of columnsToDrop) {
      const exists = await columnExists("social_accounts", col);
      if (exists) {
        await pool.query(`ALTER TABLE social_accounts DROP COLUMN ${col}`);
        log(`Dropped column social_accounts.${col}`);
      }
    }

    // 7. Add last_scraped_at column
    await addColumnIfNotExists("social_accounts", "last_scraped_at", "TIMESTAMP");

    log("Social accounts migration to historical model complete!");
  } else {
    log("Social accounts already in historical model format.");
    await addColumnIfNotExists("social_accounts", "last_scraped_at", "TIMESTAMP");
  }
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
      },
      photos: {
        og_metadata: "JSONB",
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
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
      },
      social_accounts: {
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
      },
      ai_chats: {
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
      },
      daily_notes: {
        vector_id: "TEXT",
        vector_synced_at: "TIMESTAMP",
        updated_at: "TIMESTAMP",
      },
      relationships: {
        family_relationship_type: "VARCHAR(50)",
      },
      tasks: {
        title: "TEXT",
      },
    };

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
          date TEXT NOT NULL,
          user_title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          vector_id TEXT,
          vector_synced_at TIMESTAMP,
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

    // Migrate social_accounts to historical model (v2)
    await migrateSocialAccountsToHistorical();

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
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("messages table created successfully");
    }

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
          recipient_type TEXT NOT NULL DEFAULT 'to'
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
          joined_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      log("conversation_participants table created successfully");
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
        `INSERT INTO users (name, nickname, username, password)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [userData.name, userData.nickname, userData.username, userData.password]
      );
      const newUserId = userResult.rows[0].id;
      
      // Create the "Me" person for the recreated user
      const personResult = await pool.query(
        `INSERT INTO people (user_id, first_name, last_name) 
         VALUES ($1, $2, $3)
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

      // Always seed defaults so new types (e.g. Ex-spouse) are picked up by existing databases.
      // All seed functions use ON CONFLICT DO NOTHING, making this idempotent.
      await seedRelationshipTypes();
      await seedInteractionTypes();
      await seedSocialAccountTypes();
    }

    // Migrate Partner relationship types to spouse role if needed
    await migratePartnerToSpouse();

    // Migrate family relationships to highly normalized tables
    await migrateFamilyToNormalizedSchema();
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
