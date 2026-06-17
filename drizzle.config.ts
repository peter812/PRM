import { defineConfig } from "drizzle-kit";
import fs from "fs";
import dotenv from "dotenv";

if (!fs.existsSync("/.dockerenv")) {
  dotenv.config({ override: true });
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
