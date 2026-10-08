/**
 * clear-empty-face-groups.ts — Unlink people and social accounts whose face
 * group (personface_uuid) no longer contains any faces, so 0-photo identities
 * disappear from the Faces page.
 *
 * Run:  npx tsx scripts/clear-empty-face-groups.ts [--dry-run]
 */
import "dotenv/config";
import { db, pool } from "../server/db";
import "../server/task-worker"; // load first: recognition.ts has a circular import with it
import { clearEmptyGroups } from "../server/recognition";
import { people, socialAccounts, faces } from "@shared/schema";
import { and, isNotNull, sql } from "drizzle-orm";

async function main() {
  if (process.argv.includes("--dry-run")) {
    for (const [label, table] of [["people", people], ["social accounts", socialAccounts]] as const) {
      const rows = await db.select({ id: table.id }).from(table).where(and(
        isNotNull(table.personfaceUuid),
        sql`NOT EXISTS (SELECT 1 FROM ${faces} WHERE ${faces.personfaceUuid} = ${table.personfaceUuid})`,
      ));
      console.log(`[DRY RUN] ${rows.length} ${label} point at an empty face group.`);
    }
  } else {
    console.log(`Unlinked ${await db.transaction((tx) => clearEmptyGroups(tx))} people/accounts from empty face groups.`);
  }
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
