/**
 * Applies the story reshares found by PRM-stories' scripts/export-reshares.ts to stories PRM
 * already holds: sets metadata.resharedPost and adds the original author to the story's
 * mentioned accounts, which is how the connection score counts them.
 *
 *   npx tsx scripts/backfill-story-reshares.ts <reshares.json> [--dry-run]
 *
 * Safe to re-run: a story already carrying the author is left alone.
 */
import "dotenv/config";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { socialAccountPosts } from "@shared/schema";
import { storyPostId } from "../server/routes/stories";

const file = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!file) {
  console.error("usage: npx tsx scripts/backfill-story-reshares.ts <reshares.json> [--dry-run]");
  process.exit(1);
}

const reshares = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { resharedPost: { ownerUsername: string | null }; mentions: string[] }>;
let updated = 0, unchanged = 0, missing = 0;

for (const [storyPk, { resharedPost, mentions }] of Object.entries(reshares)) {
  const [row] = await db
    .select({ id: socialAccountPosts.id, mentionedAccounts: socialAccountPosts.mentionedAccounts, metadata: socialAccountPosts.metadata })
    .from(socialAccountPosts)
    .where(eq(socialAccountPosts.id, storyPostId(storyPk)))
    .limit(1);
  if (!row) { missing++; continue; }

  const groups = (row.mentionedAccounts ? JSON.parse(row.mentionedAccounts) : []) as { imageIndex: number; accounts: string[] }[];
  const have = new Set(groups.flatMap((g) => g.accounts.map((a) => a.toLowerCase())));
  const toAdd = mentions.filter((m) => !have.has(m.toLowerCase()));
  const hasReshare = Boolean((row.metadata as Record<string, unknown> | null)?.resharedPost);
  if (!toAdd.length && hasReshare) { unchanged++; continue; }

  if (toAdd.length) {
    const first = groups[0] ?? { imageIndex: 0, accounts: [] };
    groups.splice(0, 1, { ...first, accounts: [...first.accounts, ...toAdd] });
  }
  if (!dryRun) {
    await db
      .update(socialAccountPosts)
      .set({
        mentionedAccounts: JSON.stringify(groups),
        metadata: { ...((row.metadata as Record<string, unknown> | null) ?? {}), resharedPost },
      })
      .where(eq(socialAccountPosts.id, row.id));
  }
  updated++;
}

console.log(`${dryRun ? "would update" : "updated"} ${updated}, already done ${unchanged}, not in PRM ${missing}`);
await pool.end();
