import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const [u, q, a, s] = await Promise.all([
  p.query("SELECT COUNT(*) FROM people WHERE sex='unknown'"),
  p.query("SELECT COUNT(*) FROM sex_guess_queue WHERE answered=0"),
  p.query("SELECT COUNT(*) FROM sex_guess_queue WHERE answered=0 AND (snooze_until IS NULL OR snooze_until <= NOW())"),
  p.query("SELECT guessed_sex, date_added FROM sex_guess_queue WHERE answered=0 ORDER BY date_added DESC LIMIT 10"),
]);
console.log('unknown people:', u.rows[0].count);
console.log('pending (unanswered):', q.rows[0].count);
console.log('active (not snoozed):', a.rows[0].count);
console.log('sample rows:', JSON.stringify(s.rows, null, 2));
await p.end();
