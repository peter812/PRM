import pg from "pg";
const { Pool } = pg;
import dotenv from "dotenv";
import fs from "fs";
import { storage } from "../server/storage";

if (!fs.existsSync("/.dockerenv")) {
  dotenv.config({ override: true });
}

async function main() {
  const id = "1d8cd2b4-56b5-4f78-93af-98ae4efe545b";
  console.log(`Querying getSocialAccountById for ID: ${id}`);
  try {
    const account = await storage.getSocialAccountById(id);
    console.log("Account result:", JSON.stringify(account, null, 2));
  } catch (error) {
    console.error("Failed:", error);
  }
}

main();
