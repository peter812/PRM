import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

const connectionString = process.env.DATABASE_URL || 'postgresql://people:people812@pbe.im:3306/people';

export const pool = new Pool({ 
  connectionString,
  ssl: false
});

export const db = drizzle({ client: pool, schema });
