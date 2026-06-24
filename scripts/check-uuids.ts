import pg from "pg";
const { Pool } = pg;
import dotenv from "dotenv";
import fs from "fs";

if (!fs.existsSync("/.dockerenv")) {
  dotenv.config({ override: true });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString, ssl: false });
  try {
    // 1. Get the list of all followers in social_network_state
    const snsRes = await pool.query("SELECT followers, following FROM social_network_state");
    const followers = snsRes.rows.flatMap(r => r.followers || []);
    const following = snsRes.rows.flatMap(r => r.following || []);
    const uniqueUuids = Array.from(new Set([...followers, ...following]));
    
    console.log(`Total unique UUIDs in followers/following: ${uniqueUuids.length}`);
    
    if (uniqueUuids.length > 0) {
      // 2. Count how many of these exist in social_accounts table
      const existRes = await pool.query(
        "SELECT COUNT(*)::integer as count FROM social_accounts WHERE id = ANY($1)",
        [uniqueUuids]
      );
      console.log(`Number of those UUIDs that exist in social_accounts: ${existRes.rows[0].count}`);

      // Get some examples that don't exist
      const sampleIds = uniqueUuids.slice(0, 50);
      const sampleExistRes = await pool.query(
        "SELECT id FROM social_accounts WHERE id = ANY($1)",
        [sampleIds]
      );
      const existingIds = new Set(sampleExistRes.rows.map(r => r.id));
      const missing = sampleIds.filter(id => !existingIds.has(id));
      console.log(`Sample missing IDs:`, missing.slice(0, 10));
    }
  } catch (error) {
    console.error("Query failed:", error);
  } finally {
    await pool.end();
  }
}

main();
