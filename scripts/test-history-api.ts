/**
 * Covers the social account history API — the storage layer behind
 * /api/social-accounts/:id/history, /history/summary and /history/:entryId.
 *
 *   npx tsx scripts/test-history-api.ts
 *
 * The database as it stands holds nothing but migration baselines, so a test that
 * only queried it would pass vacuously and prove nothing — in particular it would
 * never catch a filter spelled "neighbor". This creates its own direct and
 * neighbour entries by driving real pending imports through processImportSocial,
 * under a unique username prefix, and removes them at the end.
 */
import "dotenv/config";
import { db, pool } from "../server/db";
import { socialAccounts, socialAccountHistory, socialFollows, tasks } from "@shared/schema";
import { processImportSocial } from "../server/task-worker";
import { storage } from "../server/storage";
import { runAsUser } from "../server/access";
import { eq, like, sql } from "drizzle-orm";
import crypto from "crypto";

const PREFIX = `__apitest_${Date.now()}_`;
const MAIN = `${PREFIX}main`;

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

function ok(label: string, condition: boolean) {
  check(label, condition, true);
}

/** Queues and runs one import the way the route would. */
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

const csv = (names: string[]) =>
  "username,full_name\n" + names.map(n => `${PREFIX}${n},${n} Name`).join("\n");

async function accountId(username: string) {
  const [a] = await db.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.username, username));
  return a?.id;
}

async function run() {
  console.log(`\nSeeding history for @${MAIN}\n`);

  // Two imports: the first is the initial capture, the second moves edges in both
  // directions so there are real gains and losses to page through.
  await runImport({
    accountDisplayName: "Johnny",
    accountBio: "first bio",
    accountLocationArea: "Austin, TX",
    accountFollowers: csv(["f1", "f2", "f3", "f4", "f5"]),
    accountFollowing: csv(["g1", "g2", "g3"]),
    accountFollowersCount: 12400,
  });
  await runImport({
    accountBio: "second bio",
    accountFollowers: csv(["f1", "f2", "f3", "f4", "f5", "n1", "n2"]),
    accountFollowing: csv(["g1"]),
  });

  const main = (await accountId(MAIN))!;
  const neighbour = (await accountId(`${PREFIX}n1`))!;

  // ── 1. The list never carries `delta` ───────────────────────────────────────
  console.log("1. List endpoint omits the delta column");
  const list = await storage.getSocialAccountHistory(main, { kind: "all" });
  ok("some entries returned", list.items.length > 0);
  ok("no item has a delta key at all", list.items.every(i => !("delta" in i)));
  check("pagination reported", { page: list.page, totalPages: list.totalPages }, { page: 1, totalPages: 1 });

  // ── 2. kind=neighbour matches rows (the British-spelling trap) ──────────────
  console.log("\n2. kind=neighbour selects rows");
  const neighbours = await storage.getSocialAccountHistory(neighbour, { kind: "neighbour" });
  ok("neighbour rows exist (a zero here is the spelling trap)", neighbours.total > 0);
  ok("every row is a neighbour entry", neighbours.items.every(i => i.entryKind === "neighbour"));

  // ── 3. observedVia hydration ────────────────────────────────────────────────
  console.log("\n3. observedVia is hydrated on neighbour rows only");
  check("observedVia username", neighbours.items[0].observedVia?.username, MAIN);
  const direct = await storage.getSocialAccountHistory(main, { kind: "direct" });
  ok("direct rows carry no observedVia", direct.items.every(i => i.observedVia === null));

  // ── 4. Detail endpoint resolves ids, and its lists page ─────────────────────
  console.log("\n4. Detail endpoint resolves delta ids to accounts");
  const secondEntry = direct.items[0];   // newest first
  const detail = (await storage.getSocialAccountHistoryEntry(secondEntry.id))!;
  check("followers added total", detail.followersAddedList.total, 2);
  check("followers added usernames",
    detail.followersAddedList.items.map(i => i.username).sort(),
    [`${PREFIX}n1`, `${PREFIX}n2`]);
  check("following lost total", detail.followingLostList.total, 2);
  ok("resolved accounts carry an id", detail.followingLostList.items.every(i => !!i.id));

  const firstPage = (await storage.getSocialAccountHistoryEntry(secondEntry.id, { listLimit: 1, listOffset: 0 }))!;
  const secondPage = (await storage.getSocialAccountHistoryEntry(secondEntry.id, { listLimit: 1, listOffset: 1 }))!;
  check("listLimit caps the page", firstPage.followersAddedList.items.length, 1);
  check("total is the whole list, not the page", firstPage.followersAddedList.total, 2);
  ok("listOffset moves the window",
    firstPage.followersAddedList.items[0].id !== secondPage.followersAddedList.items[0].id);

  // ── 5. Summary matches a direct GROUP BY ────────────────────────────────────
  console.log("\n5. Summary counts match the table");
  const summary = await storage.getSocialAccountHistorySummary(main);
  const grouped = await db
    .select({ kind: socialAccountHistory.entryKind, count: sql<number>`count(*)::int` })
    .from(socialAccountHistory)
    .where(eq(socialAccountHistory.socialAccountId, main))
    .groupBy(socialAccountHistory.entryKind);
  const expected = { direct: 0, neighbour: 0, baseline: 0 };
  for (const row of grouped) (expected as Record<string, number>)[row.kind] = row.count;
  check("counts by kind",
    { direct: summary.direct, neighbour: summary.neighbour, baseline: summary.baseline },
    expected);
  ok("first entry is not after the last",
    new Date(summary.firstEntryAt!).getTime() <= new Date(summary.lastEntryAt!).getTime());

  // ── 6. The initial capture is distinguishable ───────────────────────────────
  console.log("\n6. The initial capture is flagged in the response");
  const initial = direct.items.find(i => i.isInitialCapture);
  ok("an initial capture entry is present", !!initial);
  check("it is the older of the two", initial!.id, direct.items[direct.items.length - 1].id);
  check("its followersAfter is the whole captured list, not a gain", initial!.followersAfter, 5);
  check("reported count survives to the entry", initial!.reportedFollowersAfter, 12400);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  const mine = await db.select({ id: socialAccounts.id }).from(socialAccounts)
    .where(like(socialAccounts.username, `${PREFIX}%`));
  for (const { id } of mine) {
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
