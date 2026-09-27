// Folding a duplicate account row into the one that has the history
// (account-merge-plan.md). The survivor keeps its id; the other row is
// treated as one more import into it and then deleted.
//
// Two steps, in this order so a failure between them loses nothing:
//   1. applySnapshot() gives the survivor the union of both follow lists —
//      the one writer of social_follows, the count columns and the journal,
//      so this lands in history exactly like a scrape would.
//   2. One transaction repoints everything else by id and deletes the
//      duplicate. Its own edges cascade; they are already on the survivor.
import { eq, or, sql } from "drizzle-orm";
import { db } from "./db";
import { socialAccounts, socialFollows } from "@shared/schema";
import { applySnapshot } from "./social-account-history";

export type MergeCounts = { followers: number; following: number; posts: number };

const parseIds = (json: string | null): string[] => {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export async function mergeSocialAccounts(survivorId: string, duplicateId: string): Promise<MergeCounts> {
  const edges = await db
    .select({ followerId: socialFollows.followerId, followedId: socialFollows.followedId })
    .from(socialFollows)
    .where(
      or(
        eq(socialFollows.followerId, survivorId),
        eq(socialFollows.followedId, survivorId),
        eq(socialFollows.followerId, duplicateId),
        eq(socialFollows.followedId, duplicateId),
      ),
    );
  const ours = new Set([survivorId, duplicateId]);
  const followerIds = [...new Set(edges.filter((e) => ours.has(e.followedId) && !ours.has(e.followerId)).map((e) => e.followerId))];
  const followingIds = [...new Set(edges.filter((e) => ours.has(e.followerId) && !ours.has(e.followedId)).map((e) => e.followedId))];

  const entry = await applySnapshot({ socialAccountId: survivorId, scope: "both", followerIds, followingIds, source: "manual" });

  const posts = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    const rows = await tx
      .select({
        id: socialAccounts.id,
        ownerUuid: socialAccounts.ownerUuid,
        personfaceUuid: socialAccounts.personfaceUuid,
        currentPosts: socialAccounts.currentPosts,
        deletedPosts: socialAccounts.deletedPosts,
      })
      .from(socialAccounts)
      .where(or(eq(socialAccounts.id, survivorId), eq(socialAccounts.id, duplicateId)))
      .for("update");
    const survivor = rows.find((r) => r.id === survivorId);
    const duplicate = rows.find((r) => r.id === duplicateId);
    if (!survivor || !duplicate) throw new Error("Account to merge no longer exists");

    const s = sql`${survivorId}::text`;
    const d = sql`${duplicateId}::text`;

    // Journal and change log: the duplicate's own entries, and mentions of it.
    await tx.execute(sql`UPDATE social_account_history SET social_account_id = ${s} WHERE social_account_id = ${d}`);
    await tx.execute(sql`UPDATE social_account_history SET observed_via_account_id = ${s} WHERE observed_via_account_id = ${d}`);
    await tx.execute(sql`UPDATE social_network_changes SET social_account_id = ${s} WHERE social_account_id = ${d}`);
    await tx.execute(sql`UPDATE social_network_changes SET target_account_id = ${s} WHERE target_account_id = ${d}`);

    // Posts: the same Instagram post scraped under both names is one post.
    await tx.execute(sql`
      DELETE FROM social_account_posts p WHERE p.social_account_id = ${d} AND p.instagram_pk IS NOT NULL
        AND EXISTS (SELECT 1 FROM social_account_posts q WHERE q.social_account_id = ${s} AND q.instagram_pk = p.instagram_pk)`);
    const moved = await tx.execute(sql`UPDATE social_account_posts SET social_account_id = ${s} WHERE social_account_id = ${d}`);
    await tx.execute(sql`
      UPDATE social_account_posts SET coauthor_account_ids = (coauthor_account_ids - ${d} - ${s}) || jsonb_build_array(${s})
      WHERE coauthor_account_ids ? ${d}`);

    await tx.execute(sql`UPDATE tracking_jobs SET social_account_id = ${s} WHERE social_account_id = ${d}`);
    await tx.execute(sql`
      UPDATE osint_scan_queue SET social_account_id = ${s} WHERE social_account_id = ${d}
        AND NOT (status IN ('pending','running') AND EXISTS (SELECT 1 FROM osint_scan_queue o
          WHERE o.social_account_id = ${s} AND o.tool = osint_scan_queue.tool AND o.status IN ('pending','running')))`);
    await tx.execute(sql`UPDATE conversations SET social_account_id = ${s} WHERE social_account_id = ${d}`);
    await tx.execute(sql`UPDATE messages SET sender_social_account_id = ${s} WHERE sender_social_account_id = ${d}`);
    await tx.execute(sql`UPDATE message_recipients SET social_account_id = ${s} WHERE social_account_id = ${d}`);
    await tx.execute(sql`UPDATE conversation_participants SET social_account_id = ${s} WHERE social_account_id = ${d}`);
    await tx.execute(sql`UPDATE groups SET center_account_id = ${s} WHERE center_account_id = ${d}`);
    await tx.execute(sql`UPDATE daily_note_involved_parties SET ref_id = ${s} WHERE party_type = 'social_account' AND ref_id = ${d}`);
    await tx.execute(sql`
      UPDATE people SET social_account_uuids = ARRAY(SELECT DISTINCT unnest(array_replace(social_account_uuids, ${d}, ${s})))
      WHERE ${d} = ANY(social_account_uuids)`);
    await tx.execute(sql`
      UPDATE insights SET applicable_social_account_ids = ARRAY(SELECT DISTINCT unnest(array_replace(applicable_social_account_ids, ${d}, ${s})))
      WHERE ${d} = ANY(applicable_social_account_ids)`);

    const union = (a: string | null, b: string | null) => JSON.stringify([...new Set([...parseIds(a), ...parseIds(b)])]);
    await tx
      .update(socialAccounts)
      .set({
        ownerUuid: survivor.ownerUuid ?? duplicate.ownerUuid,
        personfaceUuid: survivor.personfaceUuid ?? duplicate.personfaceUuid,
        currentPosts: union(survivor.currentPosts, duplicate.currentPosts),
        deletedPosts: union(survivor.deletedPosts, duplicate.deletedPosts),
      })
      .where(eq(socialAccounts.id, survivorId));

    // The duplicate's edges cascade away with it. Step 1 already counted each
    // of them once on the survivor's side, so the neighbours' denormalized
    // counts come back down by the edge they are about to lose — the same
    // delta applySnapshot would move for an unfollow.
    await tx.execute(sql`
      UPDATE social_accounts SET following_count = following_count - 1
      WHERE id IN (SELECT follower_id FROM social_follows WHERE followed_id = ${d} AND follower_id <> ${s})`);
    await tx.execute(sql`
      UPDATE social_accounts SET followers_count = followers_count - 1
      WHERE id IN (SELECT followed_id FROM social_follows WHERE follower_id = ${d} AND followed_id <> ${s})`);

    await tx.delete(socialAccounts).where(eq(socialAccounts.id, duplicateId));
    return moved.rowCount ?? 0;
  });

  return { followers: entry.followersAdded, following: entry.followingAdded, posts };
}
