/**
 * End-to-end check of the reworked PRM Chrome import (processImportSocial).
 *
 *   npx tsx scripts/test-import-social.ts
 *
 * Drives real pending-import records through the real task path and asserts the
 * resulting journal. Creates throwaway accounts under a unique username prefix and
 * removes them at the end, so it is safe against a working database.
 *
 * No network: every record here has a null accountImageUrl, so the inline image
 * fetch is skipped. Image behaviour is covered by test-history-diff.ts.
 */
import "dotenv/config";
import { db, pool } from "../server/db";
import { socialAccounts, socialAccountHistory, socialFollows, tasks } from "@shared/schema";
import { processImportSocial } from "../server/task-worker";
import { storage } from "../server/storage";
import { runAsUser } from "../server/access";
import { and, desc, eq, like } from "drizzle-orm";
import crypto from "crypto";

const PREFIX = `__imptest_${Date.now()}_`;
const MAIN = `${PREFIX}main`;

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

/** Queues and runs one import the way the route would, returning the task result. */
async function runImport(fields: Record<string, unknown>) {
  const rec = await storage.createPendingSocialAccountImport({
    id: crypto.randomUUID(),
    timestampAdded: new Date(),
    alreadyAdded: false,
    accountUsername: MAIN,
    importType: "full",
    ...fields,
  } as any);

  const task = await storage.createTask({
    userId: 1, type: "import_social", status: "pending", title: MAIN,
    payload: JSON.stringify({ pendingImportId: rec.id }),
  } as any);

  const out = JSON.parse(await processImportSocial(task.id, { pendingImportId: rec.id }));
  await db.delete(tasks).where(eq(tasks.id, task.id));
  return out;
}

async function account() {
  const [a] = await db.select().from(socialAccounts).where(eq(socialAccounts.username, MAIN));
  return a;
}

async function latestEntry() {
  const [e] = await db
    .select().from(socialAccountHistory)
    .where(and(
      eq(socialAccountHistory.socialAccountId, (await account()).id),
      eq(socialAccountHistory.entryKind, "direct"),
    ))
    .orderBy(desc(socialAccountHistory.detectedAt));
  return e;
}

const csv = (names: string[]) =>
  "username,full_name\n" + names.map(n => `${PREFIX}${n},${n} Name`).join("\n");

async function run() {
  console.log(`\nRunning imports as @${MAIN}\n`);

  // ── 1. First full pull: 5 followers, 8 following ────────────────────────────
  console.log("1. First full pull (5 followers, 8 following)");
  const r1 = await runImport({
    accountDisplayName: "Johnny",
    accountBio: "first bio",
    accountLocationArea: "Austin, TX",
    accountFollowers: csv(["f1", "f2", "f3", "f4", "f5"]),
    accountFollowing: csv(["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"]),
    accountFollowersCount: 5,
    accountFollowingCount: 8,
  });

  check("scope detected", r1.scope, "both");
  check("flagged as initial capture", r1.initialCapture, true);
  check("followers added", r1.followersAdded, 5);
  check("following added", r1.followingAdded, 8);

  const a1 = await account();
  check("account followers_count", a1.followersCount, 5);
  check("account following_count", a1.followingCount, 8);
  check("bio stored on the account", a1.bio, "first bio");
  check("location stored (previously discarded)", a1.location, "Austin, TX");
  check("nickname stored", a1.nickname, "Johnny");
  check("reported count stored", a1.reportedFollowersCount, 5);

  // ── 2. The headline case: rescan finds 10 and 6 ─────────────────────────────
  console.log("\n2. Rescan finds 10 followers, 6 following");
  const r2 = await runImport({
    accountDisplayName: "Johnny",
    accountBio: "second bio",
    accountLocationArea: "Austin, TX",
    accountFollowers: csv(["f1", "f2", "f3", "f4", "f5", "n1", "n2", "n3", "n4", "n5"]),
    accountFollowing: csv(["g1", "g2", "g3", "g4", "g5", "g6"]),
    accountFollowersCount: 10,
    accountFollowingCount: 6,
  });

  check("followers +5", r2.followersAdded, 5);
  check("followers -0", r2.followersLost, 0);
  check("following -2", r2.followingLost, 2);
  check("no longer initial", r2.initialCapture, false);
  check("only bio changed", r2.profileFieldsChanged, ["bio"]);

  const a2 = await account();
  check("account now 10 followers", a2.followersCount, 10);
  check("account now 6 following", a2.followingCount, 6);
  check("bio replaced on the account", a2.bio, "second bio");

  const e2 = await latestEntry();
  check("journal keeps the OLD bio", e2.previousBio, "first bio");
  check("delta lists the 2 lost following", (e2.delta as any).followingLost.length, 2);
  check("entry links its pending import", Boolean(e2.pendingImportId), true);

  // g8 was followed in import 1 and dropped in import 2, so it should carry both
  // sides of that story: one neighbour entry per observation, not a net figure.
  const [g8] = await db.select().from(socialAccounts).where(eq(socialAccounts.username, `${PREFIX}g8`));
  const nEntries = await db.select().from(socialAccountHistory)
    .where(and(
      eq(socialAccountHistory.socialAccountId, g8.id),
      eq(socialAccountHistory.entryKind, "neighbour"),
    ));
  check("neighbour entry per observation", nEntries.length, 2);
  check("one records the gain", nEntries.filter(e => e.followersAdded === 1).length, 1);
  check("one records the loss", nEntries.filter(e => e.followersLost === 1).length, 1);
  check("both attribute the observation", nEntries.every(e => e.observedViaAccountId === a2.id), true);
  check("neighbour count back to zero", (await db.select({ c: socialAccounts.followersCount })
    .from(socialAccounts).where(eq(socialAccounts.id, g8.id)))[0].c, 0);

  // ── 3. A profile-only pull must not touch the graph ─────────────────────────
  console.log("\n3. Profile-only pull leaves the graph alone");
  const r3 = await runImport({
    importType: "account",
    accountBio: "third bio",
    accountFollowersCount: 12400,
    accountFollowers: null,
    accountFollowing: null,
  });

  check("scope detected", r3.scope, "profile");
  check("no followers lost", r3.followersLost, 0);
  check("no following lost", r3.followingLost, 0);

  const a3 = await account();
  check("followers untouched", a3.followersCount, 10);
  check("following untouched", a3.followingCount, 6);
  check("reported count updated", a3.reportedFollowersCount, 12400);

  // ── 4. A followers-only pull must not touch following ───────────────────────
  console.log("\n4. Followers-only pull leaves following alone");
  const r4 = await runImport({
    accountFollowers: csv(["f1", "f2"]),
    accountFollowing: null,
  });

  check("scope detected", r4.scope, "followers");
  check("followers lost", r4.followersLost, 8);
  check("following untouched", r4.followingLost, 0);

  const a4 = await account();
  check("account down to 2 followers", a4.followersCount, 2);
  check("following still 6", a4.followingCount, 6);

  // ── 5. A declared capture scope overrides inference ─────────────────────────
  // The account currently has 2 followers and 6 following. A pull that carries a
  // followers CSV but declares itself profile-only must be believed: the extension
  // is the only thing that knows its scroll was cut off, and without this the two
  // captured rows would read as an unfollow of everyone else.
  console.log("\n5. Declared scope overrides what the CSV implies");
  const r5 = await runImport({
    captureScope: "profile",
    accountFollowers: csv(["f1"]),
    accountBio: "fifth bio",
  });

  check("declared scope wins over inference", r5.scope, "profile");
  check("no followers lost", r5.followersLost, 0);

  const a5 = await account();
  check("followers untouched by a truncated pull", a5.followersCount, 2);
  check("bio still applied", a5.bio, "fifth bio");

  // And with no declaration, the same payload infers followers-only and does delete.
  console.log("\n6. Without a declaration, inference still applies");
  const r6 = await runImport({
    accountFollowers: csv(["f1"]),
  });
  check("inferred scope", r6.scope, "followers");
  check("now it does prune", r6.followersLost, 1);
  check("account down to 1 follower", (await account()).followersCount, 1);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  const mine = await db.select({ id: socialAccounts.id }).from(socialAccounts)
    .where(like(socialAccounts.username, `${PREFIX}%`));
  const ids = mine.map(r => r.id);
  for (const id of ids) {
    await db.delete(socialAccountHistory).where(eq(socialAccountHistory.socialAccountId, id));
    await db.delete(socialFollows).where(eq(socialFollows.followerId, id));
    await db.delete(socialFollows).where(eq(socialFollows.followedId, id));
  }
  await db.delete(socialAccounts).where(like(socialAccounts.username, `${PREFIX}%`));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

runAsUser(1, run).catch(async (err) => {
  console.error("\nTest run threw:", err);
  try {
    await db.delete(socialAccounts).where(like(socialAccounts.username, `${PREFIX}%`));
    await pool.end();
  } catch {}
  process.exit(1);
});
