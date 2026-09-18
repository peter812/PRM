import crypto from "crypto";
import { db } from "../server/db";
import { photos, socialAccountPosts, socialAccounts } from "../shared/schema";
import { storyPostId } from "../server/routes/stories";
import { eq, inArray } from "drizzle-orm";

const INSTAGRAM_TYPE_ID = "00000000-0000-0000-0001-000000000001";

async function main() {
  console.log("Starting story duplication tests...");

  const testUsername = `test_dup_user_${Date.now()}`;
  const testStoryPk = `story_${Date.now()}`;
  const expectedPostId = storyPostId(testStoryPk);

  console.log(`Test account: ${testUsername}, Story PK: ${testStoryPk}`);
  console.log(`Deterministic Post ID: ${expectedPostId}`);

  // 1. Create a test social account
  const [testAccount] = await db
    .insert(socialAccounts)
    .values({
      username: testUsername,
      typeId: INSTAGRAM_TYPE_ID,
      nickname: "Test User",
    })
    .returning();

  try {
    // 2. Verify pre-check for non-existing story
    const nonExistingId = storyPostId(testStoryPk);
    const [existingCheck1] = await db
      .select({ id: socialAccountPosts.id })
      .from(socialAccountPosts)
      .where(eq(socialAccountPosts.id, nonExistingId));

    if (existingCheck1) {
      throw new Error("Story should not exist before insertion");
    }
    console.log("PASS: Pre-check confirms story does not exist yet.");

    // 3. Insert the story with onConflictDoNothing
    const [inserted1] = await db
      .insert(socialAccountPosts)
      .values({
        id: expectedPostId,
        socialAccountId: testAccount.id,
        postType: "story",
        content: JSON.stringify(["https://example.com/test.jpg"]),
        description: "Test story caption",
        postedAt: new Date(),
      })
      .onConflictDoNothing({ target: socialAccountPosts.id })
      .returning({ id: socialAccountPosts.id });

    if (!inserted1 || inserted1.id !== expectedPostId) {
      throw new Error(`Expected first insert to succeed, got: ${JSON.stringify(inserted1)}`);
    }
    console.log("PASS: First story insertion succeeded.");

    // 4. Test duplicate insertion with onConflictDoNothing
    const [inserted2] = await db
      .insert(socialAccountPosts)
      .values({
        id: expectedPostId,
        socialAccountId: testAccount.id,
        postType: "story",
        content: JSON.stringify(["https://example.com/test.jpg"]),
        description: "Test duplicate story caption",
        postedAt: new Date(),
      })
      .onConflictDoNothing({ target: socialAccountPosts.id })
      .returning({ id: socialAccountPosts.id });

    if (inserted2) {
      throw new Error("Second insert should have returned undefined/null due to onConflictDoNothing");
    }
    console.log("PASS: Second insert cleanly handled duplicate without exception.");

    // 5. Simulate concurrent inserts (race condition test)
    const concurrentPk = `concurrent_${Date.now()}`;
    const concurrentPostId = storyPostId(concurrentPk);

    const results = await Promise.all([
      db.insert(socialAccountPosts).values({
        id: concurrentPostId,
        socialAccountId: testAccount.id,
        postType: "story",
        content: JSON.stringify(["https://example.com/c1.jpg"]),
        postedAt: new Date(),
      }).onConflictDoNothing({ target: socialAccountPosts.id }).returning({ id: socialAccountPosts.id }),
      db.insert(socialAccountPosts).values({
        id: concurrentPostId,
        socialAccountId: testAccount.id,
        postType: "story",
        content: JSON.stringify(["https://example.com/c2.jpg"]),
        postedAt: new Date(),
      }).onConflictDoNothing({ target: socialAccountPosts.id }).returning({ id: socialAccountPosts.id }),
      db.insert(socialAccountPosts).values({
        id: concurrentPostId,
        socialAccountId: testAccount.id,
        postType: "story",
        content: JSON.stringify(["https://example.com/c3.jpg"]),
        postedAt: new Date(),
      }).onConflictDoNothing({ target: socialAccountPosts.id }).returning({ id: socialAccountPosts.id }),
    ]);

    const insertedCount = results.filter((r) => r.length > 0).length;
    const skippedCount = results.filter((r) => r.length === 0).length;

    console.log(`Concurrent results: ${insertedCount} inserted, ${skippedCount} skipped.`);
    if (insertedCount !== 1 || skippedCount !== 2) {
      throw new Error(`Expected exactly 1 insert and 2 skips, got ${insertedCount} / ${skippedCount}`);
    }
    console.log("PASS: Concurrent race-condition test passed.");

    // 6. Test soft-deleted duplicate protection
    const softDeletedPk = `softdel_${Date.now()}`;
    const softDeletedId = storyPostId(softDeletedPk);

    // Insert as soft-deleted
    await db.insert(socialAccountPosts).values({
      id: softDeletedId,
      socialAccountId: testAccount.id,
      postType: "story",
      content: JSON.stringify(["https://example.com/del.jpg"]),
      isDeleted: true,
      postedAt: new Date(),
    });

    // Check query using the same logic as the endpoint:
    const [softDelCheck] = await db
      .select({ id: socialAccountPosts.id })
      .from(socialAccountPosts)
      .where(eq(socialAccountPosts.id, softDeletedId))
      .limit(1);

    if (!softDelCheck) {
      throw new Error("Soft-deleted story should still be detected as existing post");
    }
    console.log("PASS: Soft-deleted story detected as duplicate (prevents resurrection).");

    // 7. Test batch check query logic
    const batchPks = [testStoryPk, concurrentPk, "unseen_story_12345"];
    const idToPkMap = new Map<string, string>();
    for (const pk of batchPks) {
      idToPkMap.set(storyPostId(pk), pk);
    }
    const checkBatch = await db
      .select({ id: socialAccountPosts.id })
      .from(socialAccountPosts)
      .where(inArray(socialAccountPosts.id, Array.from(idToPkMap.keys())));

    const foundPks = checkBatch.map((e) => idToPkMap.get(e.id)!).filter(Boolean);
    console.log(`Batch check found: ${JSON.stringify(foundPks)}`);
    if (!foundPks.includes(testStoryPk) || !foundPks.includes(concurrentPk) || foundPks.includes("unseen_story_12345")) {
      throw new Error("Batch check returned incorrect set of existing PKs");
    }
    console.log("PASS: Batch story PK check accurately identifies existing vs missing stories.");

    // Cleanup test posts
    await db.delete(socialAccountPosts).where(inArray(socialAccountPosts.id, [expectedPostId, concurrentPostId, softDeletedId]));
    console.log("Cleaned up test posts.");
  } finally {
    // Cleanup test account
    await db.delete(socialAccounts).where(eq(socialAccounts.id, testAccount.id));
    console.log("Cleaned up test account.");
  }

  console.log("\nALL TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
