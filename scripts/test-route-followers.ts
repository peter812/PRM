import pg from "pg";
const { Pool } = pg;
import dotenv from "dotenv";
import fs from "fs";
import { storage } from "../server/storage";

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
    // 1. Find a social account that has followers
    const res = await pool.query(`
      SELECT social_account_id, follower_count, followers 
      FROM social_network_state 
      WHERE follower_count > 0 
      LIMIT 1
    `);
    
    if (res.rows.length === 0) {
      console.log("No social network states with followers > 0 found!");
      return;
    }
    
    const accountId = res.rows[0].social_account_id;
    console.log(`Testing accountId: ${accountId} (with ${res.rows[0].follower_count} followers)`);

    // Let's call the logic of the route handler manually:
    const state = await storage.getNetworkState(accountId);
    console.log("State exists:", !!state);
    console.log("State followers length:", state?.followers?.length);

    if (state && state.followers) {
      const pageIds = state.followers.slice(0, 20);
      console.log("Page IDs:", pageIds.slice(0, 3));
      
      const followerAccounts = [];
      for (const followerId of pageIds) {
        const account = await storage.getSocialAccountById(followerId);
        if (account) {
          followerAccounts.push(account.username);
        } else {
          console.log(`Could not find account for follower ID: ${followerId}`);
        }
      }
      console.log(`Found ${followerAccounts.length} follower accounts:`, followerAccounts.slice(0, 5));
    }
  } catch (error) {
    console.error("Failed:", error);
  } finally {
    await pool.end();
  }
}

main();
