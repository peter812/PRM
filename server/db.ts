import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import fs from 'fs';
import dotenv from 'dotenv';

if (!fs.existsSync('/.dockerenv')) {
  dotenv.config({ override: true });
}

const { Pool } = pg;

// External PostgreSQL database connection
// Note: Despite port 3306 (typically MySQL), this is a PostgreSQL database at pbe.im
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required. Configure your external PostgreSQL database connection.");
}

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db']);

/**
 * Determine TLS/SSL configuration for the PostgreSQL pool.
 * Explicit DATABASE_SSL ("true"/"false") takes precedence, followed by sslmode
 * in DATABASE_URL, then defaulting to TLS enabled for remote hosts and disabled
 * for local/container dev hosts without SSL.
 */
function resolveSslConfig(databaseUrl: string): boolean | { rejectUnauthorized: boolean } {
  const sslOptions = {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };

  if (process.env.DATABASE_SSL === 'true') {
    return sslOptions;
  }
  if (process.env.DATABASE_SSL === 'false') {
    return false;
  }

  try {
    const parsed = new URL(databaseUrl);
    const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
    if (sslMode === 'disable') {
      return false;
    }
    if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
      return sslOptions;
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (LOCAL_DB_HOSTS.has(hostname)) {
      return false;
    }
  } catch {
    if (/sslmode=disable/i.test(databaseUrl)) {
      return false;
    }
  }

  return sslOptions;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSslConfig(process.env.DATABASE_URL),
  max: 25,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  statement_timeout: 30000, // Prevent runaway unindexed queries from permanently locking pool slots
  query_timeout: 35000,
  keepAlive: true,
});

// Idle clients can be dropped by the server/network (ECONNRESET). pg-pool emits
// 'error' on the pool for these; without a listener Node crashes the process.
// The pool discards the dead client and reconnects on the next query.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

export const db = drizzle({ client: pool, schema });
