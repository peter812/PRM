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
    const res = await pool.query(`
      SELECT sns.social_account_id, sa.username, sns.follower_count, sns.following_count, sns.followers, sns.following
      FROM social_network_state sns
      JOIN social_accounts sa ON sa.id = sns.social_account_id
      LIMIT 10
    `);
    console.log("Network States:");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (error) {
    console.error("Query failed:", error);
  } finally {
    await pool.end();
  }
}

main();
