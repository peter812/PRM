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
 * Initializes the database:
 * - If no users exist, drops all tables and recreates them
 * - Seeds default data (relationship types)
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
      
      log("Database initialized successfully!");
    } else {
      log("Users found in database. Skipping initialization.");
    }
  } catch (error) {
    log(`Database initialization failed: ${error}`);
    throw error;
  }
}
