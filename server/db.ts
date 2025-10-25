import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

const { Pool } = pg;

const connectionString = 'postgresql://people:people812@pbe.im:3306/people';

export const pool = new Pool({ 
  connectionString,
  ssl: false,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle({ client: pool, schema });
