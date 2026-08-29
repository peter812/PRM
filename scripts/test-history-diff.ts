/**
 * Verifies the social account history diff engine against a live database.
 *
 *   npx tsx scripts/test-history-diff.ts
 *
 * Creates throwaway accounts under a unique username prefix and removes them at
 * the end, so it is safe to run against a working database.
 */
import "dotenv/config";
import { db, pool } from "../server/db";
import { socialAccounts, socialAccountHistory, socialFollows } from "@shared/schema";
import { applySnapshot } from "../server/social-account-history";
import { and, eq, inArray, like, sql } from "drizzle-orm";

const PREFIX = `__histtest_${Date.now()}_`;

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

async function mkAccount(name: string): Promise<string> {
  const [row] = await db
    .insert(socialAccounts)
    .values({ username: `${PREFIX}${name}`, internalAccountCreationType: "test" })
    .returning({ id: socialAccounts.id });
  return row.id;
}

async function counts(id: string) {
  const [row] = await db
    .select({ followers: socialAccounts.followersCount, following: socialAccounts.followingCount })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, id));
  return row;
}

async function entriesFor(id: string) {
  return db
    .select()
    .from(socialAccountHistory)
    .where(eq(socialAccountHistory.socialAccountId, id))
    .orderBy(socialAccountHistory.detectedAt);
}

async function run() {
  console.log(`\nSeeding accounts under ${PREFIX}\n`);

  const main = await mkAccount("main");
  // 8 counterparts: f1..f5 start as followers, g1..g8 as following.
  const f = await Promise.all([1, 2, 3, 4, 5].map((n) => mkAccount(`f${n}`)));
  const g = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => mkAccount(`g${n}`)));
  // Extra accounts that only appear in the second scrape.
  const nf = await Promise.all([1, 2, 3, 4, 5].map((n) => mkAccount(`nf${n}`)));

  // ── 1. Initial capture: 5 followers, 8 following ────────────────────────────
  console.log("1. Initial capture (5 followers, 8 following)");
  const first = await applySnapshot({
    socialAccountId: main,
    scope: "both",
    followerIds: f,
    followingIds: g,
    profile: { nickname: "Johnny", bio: "first bio" },
    source: "extension",
  });

  check("account followers_count", (await counts(main)).followers, 5);
  check("account following_count", (await counts(main)).following, 8);
  check("entry typed as initial capture", first.isInitialCapture, true);
  check("followersAdded", first.followersAdded, 5);
  check("followingAdded", first.followingAdded, 8);
  check("profileFieldsChanged", [...first.profileFieldsChanged].sort(), ["bio", "nickname"]);

  // ── 2. The headline case: 5/8 becomes 10/6 ──────────────────────────────────
  console.log("\n2. Rescan finds 10 followers, 6 following");
  const second = await applySnapshot({
    socialAccountId: main,
    scope: "both",
    followerIds: [...f, ...nf],          // +5, none lost
    followingIds: g.slice(0, 6),         // -2
    profile: { nickname: "Johnny", bio: "second bio" },
    source: "extension",
  });

  check("account followers_count", (await counts(main)).followers, 10);
  check("account following_count", (await counts(main)).following, 6);
  check("followersAdded", second.followersAdded, 5);
  check("followersLost", second.followersLost, 0);
  check("followingAdded", second.followingAdded, 0);
  check("followingLost", second.followingLost, 2);
  check("no longer an initial capture", second.isInitialCapture, false);
  check("only bio recorded as changed", second.profileFieldsChanged, ["bio"]);
  check("previous bio stored, not the new one", second.previousBio, "first bio");
  const d = second.delta as Record<string, string[]>;
  check("delta names the lost following", d.followingLost.sort(), g.slice(6, 8).sort());
  check("delta names the added followers", d.followersAdded.sort(), nf.sort());

  // Neighbour side: g7 lost a follower (main stopped following it).
  const g7Entries = await entriesFor(g[6]);
  const g7Last = g7Entries[g7Entries.length - 1];
  check("neighbour entry kind", g7Last.entryKind, "neighbour");
  check("neighbour attributes the observation", g7Last.observedViaAccountId, main);
  check("neighbour records the loss", g7Last.followersLost, 1);
  check("neighbour carries no delta jsonb", g7Last.delta, null);
  check("neighbour count decremented", (await counts(g[6])).followers, 0);

  // ── 3. Scope isolation: a profile-only scrape must not touch edges ──────────
  console.log("\n3. Profile-only scrape leaves the graph alone");
  const third = await applySnapshot({
    socialAccountId: main,
    scope: "profile",
    profile: { bio: "third bio", reportedFollowersCount: 12400 },
    source: "extension",
  });

  check("followers untouched", (await counts(main)).followers, 10);
  check("following untouched", (await counts(main)).following, 6);
  check("no edges reported added", third.followersAdded + third.followingAdded, 0);
  check("no edges reported lost", third.followersLost + third.followingLost, 0);
  check("reported count captured", third.reportedFollowersAfter, 12400);

  // ── 4. Authoritative deletion regardless of source ──────────────────────────
  console.log("\n4. A manually entered edge is still authoritative-deleted");
  await db.insert(socialFollows).values({ followerId: g[0], followedId: main, source: "manual" });
  await db
    .update(socialAccounts)
    .set({ followersCount: sql`${socialAccounts.followersCount} + 1` })
    .where(eq(socialAccounts.id, main));
  check("manual edge is in place", (await counts(main)).followers, 11);

  const fourth = await applySnapshot({
    socialAccountId: main,
    scope: "followers",
    followerIds: [...f, ...nf],          // manual edge absent
    source: "extension",
  });

  const remaining = await db
    .select({ id: socialFollows.followerId })
    .from(socialFollows)
    .where(and(eq(socialFollows.followedId, main), eq(socialFollows.followerId, g[0])));
  check("manual edge deleted", remaining.length, 0);
  check("loss is journaled", (fourth.delta as Record<string, string[]>).followersLost, [g[0]]);
  check("count back to 10", (await counts(main)).followers, 10);
  check("following untouched by followers-only scrape", (await counts(main)).following, 6);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  const all = [main, ...f, ...g, ...nf];
  await db.delete(socialAccountHistory).where(inArray(socialAccountHistory.socialAccountId, all));
  await db.delete(socialAccounts).where(like(socialAccounts.username, `${PREFIX}%`));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch(async (err) => {
  console.error("\nTest run threw:", err);
  try {
    await db.delete(socialAccounts).where(like(socialAccounts.username, `${PREFIX}%`));
    await pool.end();
  } catch {}
  process.exit(1);
});
