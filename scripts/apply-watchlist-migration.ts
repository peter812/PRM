import pg from "pg";
const { Pool } = pg;
import dotenv from "dotenv";
import fs from "fs";

if (!fs.existsSync("/.dockerenv")) {
  dotenv.config({ override: true });
}

async function main() {
  console.log("Applying manual database migrations...");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString, ssl: false });
  try {
    // Add is_watched to people table
    await pool.query(`
      ALTER TABLE people 
      ADD COLUMN IF NOT EXISTS is_watched BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log("✓ Added 'is_watched' column to 'people' table (if not exists)");

    // Add summary to social_account_posts table
    await pool.query(`
      ALTER TABLE social_account_posts 
      ADD COLUMN IF NOT EXISTS summary TEXT;
    `);
    console.log("✓ Added 'summary' column to 'social_account_posts' table (if not exists)");

    // Add summary_creation_date to social_account_posts table
    await pool.query(`
      ALTER TABLE social_account_posts 
      ADD COLUMN IF NOT EXISTS summary_creation_date TIMESTAMP;
    `);
    console.log("✓ Added 'summary_creation_date' column to 'social_account_posts' table (if not exists)");

    // Add summary_tooling_version to social_account_posts table
    await pool.query(`
      ALTER TABLE social_account_posts 
      ADD COLUMN IF NOT EXISTS summary_tooling_version TEXT;
    `);
    console.log("✓ Added 'summary_tooling_version' column to 'social_account_posts' table (if not exists)");

    console.log("All migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
