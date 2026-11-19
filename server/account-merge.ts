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
import { socialAccounts, socialFollows, type AiBackendNote, type SentNote } from "@shared/schema";
import { applySnapshot } from "./social-account-history";
import { mergeFaceGroups } from "./recognition";

export type MergeCounts = { followers: number; following: number; posts: number };

const parseIds = (json: string | null): string[] => {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const mergeSentNotes = (a: SentNote[] | null | undefined, b: SentNote[] | null | undefined): SentNote[] => {
  const byId = new Map<string, SentNote>();
  for (const n of [...(a ?? []), ...(b ?? [])]) {
    const prev = byId.get(n.noteId);
    if (!prev) byId.set(n.noteId, { ...n, seenAt: [...(n.seenAt ?? [])].sort() });
    else byId.set(n.noteId, { ...prev, seenAt: [...new Set([...(prev.seenAt ?? []), ...(n.seenAt ?? [])])].sort() });
  }
  return [...byId.values()];
};

const mergeAiBackendNotes = (
  a: AiBackendNote[] | null | undefined,
  b: AiBackendNote[] | null | undefined,
  replacedPostId: Map<string, string>,
): AiBackendNote[] => {
  const out: AiBackendNote[] = [];
  const seen = new Set<string>();
  for (const raw of [...(a ?? []), ...(b ?? [])]) {
    const n: AiBackendNote =
      raw.source?.kind === "post_append" && replacedPostId.has(raw.source.postId)
        ? { ...raw, source: { ...raw.source, postId: replacedPostId.get(raw.source.postId)! } }
        : raw;
    const key = `${n.text}|${n.source?.kind === "post_append" ? `${n.source.postId}:${n.source.imageIndex}` : "manual"}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  }
  return out;
};

export async function mergeSocialAccounts(survivorId: string, duplicateId: string): Promise<MergeCounts> {
  if (survivorId === duplicateId) {
    throw new Error("Cannot merge an account into itself");
  }

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
        sentNotes: socialAccounts.sentNotes,
        aiBackendNotes: socialAccounts.aiBackendNotes,
      })
      .from(socialAccounts)
      .where(or(eq(socialAccounts.id, survivorId), eq(socialAccounts.id, duplicateId)))
      .for("update");
    const survivor = rows.find((r) => r.id === survivorId);
    const duplicate = rows.find((r) => r.id === duplicateId);
    if (!survivor || !duplicate) throw new Error("Account to merge no longer exists");

    // Journal and change log: the duplicate's own entries, and mentions of it.
    await tx.execute(sql`UPDATE social_account_history SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE social_account_history SET observed_via_account_id = ${survivorId} WHERE observed_via_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE social_network_changes SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE social_network_changes SET target_account_id = ${survivorId} WHERE target_account_id = ${duplicateId}`);

    // Posts: the same Instagram post scraped under both names is one post.
    // Before deleting the duplicate's copy `p`, move its tags, comments and unique photos onto the survivor's copy `q`.
    const dupPosts = (
      await tx.execute<{ p_id: string; q_id: string }>(sql`
        SELECT p.id AS p_id, (
          SELECT q.id FROM social_account_posts q
          WHERE q.social_account_id = ${survivorId} AND q.instagram_pk = p.instagram_pk
          ORDER BY q.created_at ASC, q.id ASC LIMIT 1
        ) AS q_id
        FROM social_account_posts p
        WHERE p.social_account_id = ${duplicateId} AND p.instagram_pk IS NOT NULL
          AND EXISTS (SELECT 1 FROM social_account_posts q WHERE q.social_account_id = ${survivorId} AND q.instagram_pk = p.instagram_pk)`)
    ).rows;
    const replacedPostId = new Map(dupPosts.map((r) => [r.p_id, r.q_id]));

    if (dupPosts.length > 0) {
      const dupValues = sql.join(dupPosts.map((r) => sql`(${r.p_id}, ${r.q_id})`), sql`, `);
      const dupPIds = sql.join(dupPosts.map((r) => sql`${r.p_id}`), sql`, `);

      await tx.execute(sql`
        INSERT INTO social_account_post_tags (post_id, social_account_id, first_seen_at, last_seen_at, removed_seen_at)
        SELECT
          m.q_id,
          t.social_account_id,
          MIN(t.first_seen_at),
          MAX(t.last_seen_at),
          CASE WHEN bool_or(t.removed_seen_at IS NULL) THEN NULL ELSE MAX(t.removed_seen_at) END
        FROM social_account_post_tags t
        JOIN (VALUES ${dupValues}) AS m(p_id, q_id) ON t.post_id = m.p_id
        GROUP BY m.q_id, t.social_account_id
        ON CONFLICT (post_id, social_account_id) DO UPDATE SET
          first_seen_at = LEAST(social_account_post_tags.first_seen_at, EXCLUDED.first_seen_at),
          last_seen_at = GREATEST(social_account_post_tags.last_seen_at, EXCLUDED.last_seen_at),
          removed_seen_at = CASE
            WHEN social_account_post_tags.removed_seen_at IS NULL OR EXCLUDED.removed_seen_at IS NULL THEN NULL
            ELSE GREATEST(social_account_post_tags.removed_seen_at, EXCLUDED.removed_seen_at)
          END
      `);

      await tx.execute(sql`
        UPDATE social_post_comments c SET post_id = m.q_id
        FROM (VALUES ${dupValues}) AS m(p_id, q_id)
        WHERE c.post_id = m.p_id
      `);

      await tx.execute(sql`
        UPDATE photos p_ph SET prm_location = 'post:' || m.q_id
        FROM (VALUES ${dupValues}) AS m(p_id, q_id)
        WHERE p_ph.prm_location = 'post:' || m.p_id
          AND NOT EXISTS (
            SELECT 1 FROM photos q_ph
            WHERE q_ph.prm_location = 'post:' || m.q_id AND q_ph.location = p_ph.location AND q_ph.is_sub_image = p_ph.is_sub_image
          )
      `);

      await tx.execute(sql`
        DELETE FROM social_account_posts WHERE id IN (${dupPIds})
      `);
    }

    const moved = await tx.execute(
      sql`UPDATE social_account_posts SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`,
    );

    await tx.execute(sql`
      UPDATE social_account_posts
      SET coauthor_account_ids = CASE
        WHEN social_account_id = ${survivorId} THEN coauthor_account_ids - ${duplicateId} - ${survivorId}
        ELSE (coauthor_account_ids - ${duplicateId} - ${survivorId}) || jsonb_build_array(${survivorId}::text)
      END
      WHERE coauthor_account_ids ? ${duplicateId} OR (social_account_id = ${survivorId} AND coauthor_account_ids ? ${survivorId})
    `);

    await tx.execute(sql`
      INSERT INTO social_account_post_tags (post_id, social_account_id, first_seen_at, last_seen_at, removed_seen_at)
      SELECT post_id, ${survivorId}, first_seen_at, last_seen_at, removed_seen_at
      FROM social_account_post_tags
      WHERE social_account_id = ${duplicateId}
      ON CONFLICT (post_id, social_account_id) DO UPDATE SET
        first_seen_at = LEAST(social_account_post_tags.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(social_account_post_tags.last_seen_at, EXCLUDED.last_seen_at),
        removed_seen_at = CASE
          WHEN social_account_post_tags.removed_seen_at IS NULL OR EXCLUDED.removed_seen_at IS NULL THEN NULL
          ELSE GREATEST(social_account_post_tags.removed_seen_at, EXCLUDED.removed_seen_at)
        END
    `);
    await tx.execute(sql`DELETE FROM social_account_post_tags WHERE social_account_id = ${duplicateId}`);

    await tx.execute(sql`UPDATE tracking_jobs SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE image_task_groups SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE historical_account_summaries SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE social_profile_versions SET social_account_id = ${survivorId}, is_current = false WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE social_account_issues SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId} AND status <> 'open'`);
    await tx.execute(sql`
      UPDATE events SET social_account_ids = ARRAY(SELECT DISTINCT unnest(array_replace(social_account_ids, ${duplicateId}, ${survivorId})))
      WHERE ${duplicateId} = ANY(social_account_ids)
    `);

    await tx.execute(sql`
      UPDATE summary_jobs SET status = 'cancelled', completed_at = now() WHERE kind = 'account' AND target_id = ${duplicateId}
        AND status IN ('pending','running') AND EXISTS (SELECT 1 FROM summary_jobs j
          WHERE j.kind = 'account' AND j.target_id = ${survivorId} AND j.status IN ('pending','running'))
    `);
    await tx.execute(sql`UPDATE summary_jobs SET target_id = ${survivorId} WHERE kind = 'account' AND target_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE summary_jobs SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);

    await tx.execute(sql`
      UPDATE instagram_highlight_memberships m SET highlight_id = h2.id
      FROM instagram_highlights h, instagram_highlights h2
      WHERE m.highlight_id = h.id AND h.social_account_id = ${duplicateId}
        AND h2.social_account_id = ${survivorId} AND h2.instagram_id = h.instagram_id
        AND NOT (m.left_seen_at IS NULL AND EXISTS (SELECT 1 FROM instagram_highlight_memberships o
          WHERE o.highlight_id = h2.id AND o.story_pk = m.story_pk AND o.left_seen_at IS NULL))
    `);
    await tx.execute(sql`
      UPDATE instagram_highlights h SET social_account_id = ${survivorId} WHERE h.social_account_id = ${duplicateId}
        AND NOT EXISTS (SELECT 1 FROM instagram_highlights o WHERE o.social_account_id = ${survivorId} AND o.instagram_id = h.instagram_id)
    `);

    await tx.execute(sql`
      UPDATE osint_scans SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}
        AND NOT (status IN ('pending','running') AND EXISTS (SELECT 1 FROM osint_scans o
          WHERE o.social_account_id = ${survivorId} AND o.tool = osint_scans.tool AND o.target = osint_scans.target
            AND o.status IN ('pending','running')))
    `);
    await tx.execute(sql`UPDATE conversations SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE messages SET sender_social_account_id = ${survivorId} WHERE sender_social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE message_recipients SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE conversation_participants SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE groups SET center_account_id = ${survivorId} WHERE center_account_id = ${duplicateId}`);
    await tx.execute(sql`UPDATE daily_note_involved_parties SET ref_id = ${survivorId} WHERE party_type = 'social_account' AND ref_id = ${duplicateId}`);
    await tx.execute(sql`
      UPDATE people SET social_account_uuids = ARRAY(SELECT DISTINCT unnest(array_replace(social_account_uuids, ${duplicateId}, ${survivorId})))
      WHERE ${duplicateId} = ANY(social_account_uuids)
    `);
    await tx.execute(sql`
      UPDATE insights SET applicable_social_account_ids = ARRAY(SELECT DISTINCT unnest(array_replace(applicable_social_account_ids, ${duplicateId}, ${survivorId})))
      WHERE ${duplicateId} = ANY(applicable_social_account_ids)
    `);
    await tx.execute(sql`UPDATE photos SET prm_location = 'profile_image:' || ${survivorId} WHERE prm_location = 'profile_image:' || ${duplicateId}`);
    await tx.execute(sql`UPDATE photos SET prm_location = 'social_profile_image:' || ${survivorId} WHERE prm_location = 'social_profile_image:' || ${duplicateId}`);
    await tx.execute(sql`
      INSERT INTO face_cluster_rejections (face_id, identity_id, created_at)
      SELECT face_id, ${survivorId}, created_at FROM face_cluster_rejections WHERE identity_id = ${duplicateId}
      ON CONFLICT (face_id, identity_id) DO NOTHING
    `);
    await tx.execute(sql`DELETE FROM face_cluster_rejections WHERE identity_id = ${duplicateId}`);

    // When both accounts have a face group, merge duplicate's faces into survivor's group and update photos.facial_ids.
    if (survivor.personfaceUuid && duplicate.personfaceUuid) {
      await mergeFaceGroups(survivor.personfaceUuid, duplicate.personfaceUuid, tx);
    }

    const remap = (ids: string[]) => ids.map((id) => replacedPostId.get(id) ?? id);
    const union = (a: string | null, b: string | null) => JSON.stringify([...new Set([...remap(parseIds(a)), ...remap(parseIds(b))])]);
    await tx
      .update(socialAccounts)
      .set({
        ownerUuid: survivor.ownerUuid ?? duplicate.ownerUuid,
        personfaceUuid: survivor.personfaceUuid ?? duplicate.personfaceUuid,
        currentPosts: union(survivor.currentPosts, duplicate.currentPosts),
        deletedPosts: union(survivor.deletedPosts, duplicate.deletedPosts),
        sentNotes: mergeSentNotes(survivor.sentNotes, duplicate.sentNotes),
        aiBackendNotes: mergeAiBackendNotes(survivor.aiBackendNotes, duplicate.aiBackendNotes, replacedPostId),
      })
      .where(eq(socialAccounts.id, survivorId));

    // The duplicate's edges cascade away with it. Step 1 already counted each
    // of them once on the survivor's side, so the neighbours' denormalized
    // counts come back down by the edge they are about to lose — the same
    // delta applySnapshot would move for an unfollow.
    await tx.execute(sql`
      UPDATE social_accounts SET following_count = following_count - 1
      WHERE id IN (SELECT follower_id FROM social_follows WHERE followed_id = ${duplicateId} AND follower_id <> ${survivorId})
    `);
    await tx.execute(sql`
      UPDATE social_accounts SET followers_count = followers_count - 1
      WHERE id IN (SELECT followed_id FROM social_follows WHERE follower_id = ${duplicateId} AND followed_id <> ${survivorId})
    `);
    await tx.execute(sql`DELETE FROM social_accounts WHERE id = ${duplicateId}`);

    return moved.rowCount ?? 0;
  });

  return { followers: entry.followersAdded, following: entry.followingAdded, posts };
}
