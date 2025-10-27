import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

const { Pool } = pg;

// External PostgreSQL database connection
// Note: Despite port 3306 (typically MySQL), this is a PostgreSQL database at pbe.im
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required. Configure your external PostgreSQL database connection.");
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle({ client: pool, schema });
