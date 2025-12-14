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
      { name: 'Partner', color: '#06b6d4', value: 100, notes: 'Romantic partner' },
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
      },
      social_accounts: {
        notes: "TEXT",
        type_id: "VARCHAR REFERENCES social_account_types(id) ON DELETE SET NULL",
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
    }
  } catch (error) {
    log(`Database initialization failed: ${error}`);
    throw error;
  }
}
