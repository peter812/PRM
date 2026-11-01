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

    const sEsc = survivorId.replace(/'/g, "''");
    const dEsc = duplicateId.replace(/'/g, "''");

    // Journal and change log: the duplicate's own entries, and mentions of it.
    await tx.execute(sql.raw(`
      UPDATE social_account_history SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';
      UPDATE social_account_history SET observed_via_account_id = '${sEsc}' WHERE observed_via_account_id = '${dEsc}';
      UPDATE social_network_changes SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';
      UPDATE social_network_changes SET target_account_id = '${sEsc}' WHERE target_account_id = '${dEsc}';
    `));

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

    await tx.execute(sql.raw(`
      INSERT INTO social_account_post_tags (post_id, social_account_id, first_seen_at, last_seen_at, removed_seen_at)
      SELECT
        m.q_id,
        t.social_account_id,
        MIN(t.first_seen_at),
        MAX(t.last_seen_at),
        CASE WHEN bool_or(t.removed_seen_at IS NULL) THEN NULL ELSE MAX(t.removed_seen_at) END
      FROM social_account_post_tags t
      JOIN (
        SELECT p.id AS p_id, (
          SELECT q.id FROM social_account_posts q
          WHERE q.social_account_id = '${sEsc}' AND q.instagram_pk = p.instagram_pk
          ORDER BY q.created_at ASC, q.id ASC LIMIT 1
        ) AS q_id
        FROM social_account_posts p
        WHERE p.social_account_id = '${dEsc}' AND p.instagram_pk IS NOT NULL
      ) m ON t.post_id = m.p_id
      WHERE m.q_id IS NOT NULL
      GROUP BY m.q_id, t.social_account_id
      ON CONFLICT (post_id, social_account_id) DO UPDATE SET
        first_seen_at = LEAST(social_account_post_tags.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(social_account_post_tags.last_seen_at, EXCLUDED.last_seen_at),
        removed_seen_at = CASE
          WHEN social_account_post_tags.removed_seen_at IS NULL OR EXCLUDED.removed_seen_at IS NULL THEN NULL
          ELSE GREATEST(social_account_post_tags.removed_seen_at, EXCLUDED.removed_seen_at)
        END;

      UPDATE social_post_comments c SET post_id = m.q_id
      FROM (
        SELECT p.id AS p_id, (
          SELECT q.id FROM social_account_posts q
          WHERE q.social_account_id = '${sEsc}' AND q.instagram_pk = p.instagram_pk
          ORDER BY q.created_at ASC, q.id ASC LIMIT 1
        ) AS q_id
        FROM social_account_posts p
        WHERE p.social_account_id = '${dEsc}' AND p.instagram_pk IS NOT NULL
      ) m
      WHERE c.post_id = m.p_id AND m.q_id IS NOT NULL;

      UPDATE photos p_ph SET prm_location = 'post:' || m.q_id
      FROM (
        SELECT p.id AS p_id, (
          SELECT q.id FROM social_account_posts q
          WHERE q.social_account_id = '${sEsc}' AND q.instagram_pk = p.instagram_pk
          ORDER BY q.created_at ASC, q.id ASC LIMIT 1
        ) AS q_id
        FROM social_account_posts p
        WHERE p.social_account_id = '${dEsc}' AND p.instagram_pk IS NOT NULL
      ) m
      WHERE p_ph.prm_location = 'post:' || m.p_id AND m.q_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM photos q_ph
          WHERE q_ph.prm_location = 'post:' || m.q_id AND q_ph.location = p_ph.location AND q_ph.is_sub_image = p_ph.is_sub_image
        );

      DELETE FROM social_account_posts p WHERE p.social_account_id = '${dEsc}' AND p.instagram_pk IS NOT NULL
        AND EXISTS (SELECT 1 FROM social_account_posts q WHERE q.social_account_id = '${sEsc}' AND q.instagram_pk = p.instagram_pk);
    `));

    const moved = await tx.execute(
      sql`UPDATE social_account_posts SET social_account_id = ${survivorId} WHERE social_account_id = ${duplicateId}`,
    );

    await tx.execute(sql.raw(`
      UPDATE social_account_posts
      SET coauthor_account_ids = CASE
        WHEN social_account_id = '${sEsc}' THEN coauthor_account_ids - '${dEsc}' - '${sEsc}'
        ELSE (coauthor_account_ids - '${dEsc}' - '${sEsc}') || jsonb_build_array('${sEsc}')
      END
      WHERE coauthor_account_ids ? '${dEsc}' OR (social_account_id = '${sEsc}' AND coauthor_account_ids ? '${sEsc}');

      INSERT INTO social_account_post_tags (post_id, social_account_id, first_seen_at, last_seen_at, removed_seen_at)
      SELECT post_id, '${sEsc}', first_seen_at, last_seen_at, removed_seen_at
      FROM social_account_post_tags
      WHERE social_account_id = '${dEsc}'
      ON CONFLICT (post_id, social_account_id) DO UPDATE SET
        first_seen_at = LEAST(social_account_post_tags.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(social_account_post_tags.last_seen_at, EXCLUDED.last_seen_at),
        removed_seen_at = CASE
          WHEN social_account_post_tags.removed_seen_at IS NULL OR EXCLUDED.removed_seen_at IS NULL THEN NULL
          ELSE GREATEST(social_account_post_tags.removed_seen_at, EXCLUDED.removed_seen_at)
        END;
      DELETE FROM social_account_post_tags WHERE social_account_id = '${dEsc}';

      UPDATE tracking_jobs SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';
      UPDATE image_task_groups SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';
      UPDATE historical_account_summaries SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';
      UPDATE social_profile_versions SET social_account_id = '${sEsc}', is_current = false WHERE social_account_id = '${dEsc}';
      UPDATE social_account_issues SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}' AND status <> 'open';
      UPDATE events SET social_account_ids = ARRAY(SELECT DISTINCT unnest(array_replace(social_account_ids, '${dEsc}', '${sEsc}')))
      WHERE '${dEsc}' = ANY(social_account_ids);

      UPDATE summary_jobs SET status = 'cancelled', completed_at = now() WHERE kind = 'account' AND target_id = '${dEsc}'
        AND status IN ('pending','running') AND EXISTS (SELECT 1 FROM summary_jobs j
          WHERE j.kind = 'account' AND j.target_id = '${sEsc}' AND j.status IN ('pending','running'));
      UPDATE summary_jobs SET target_id = '${sEsc}' WHERE kind = 'account' AND target_id = '${dEsc}';
      UPDATE summary_jobs SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';

      UPDATE instagram_highlight_memberships m SET highlight_id = h2.id
      FROM instagram_highlights h, instagram_highlights h2
      WHERE m.highlight_id = h.id AND h.social_account_id = '${dEsc}'
        AND h2.social_account_id = '${sEsc}' AND h2.instagram_id = h.instagram_id
        AND NOT (m.left_seen_at IS NULL AND EXISTS (SELECT 1 FROM instagram_highlight_memberships o
          WHERE o.highlight_id = h2.id AND o.story_pk = m.story_pk AND o.left_seen_at IS NULL));
      UPDATE instagram_highlights h SET social_account_id = '${sEsc}' WHERE h.social_account_id = '${dEsc}'
        AND NOT EXISTS (SELECT 1 FROM instagram_highlights o WHERE o.social_account_id = '${sEsc}' AND o.instagram_id = h.instagram_id);

      UPDATE osint_scans SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}'
        AND NOT (status IN ('pending','running') AND EXISTS (SELECT 1 FROM osint_scans o
          WHERE o.social_account_id = '${sEsc}' AND o.tool = osint_scans.tool AND o.target = osint_scans.target
            AND o.status IN ('pending','running')));
      UPDATE conversations SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';
      UPDATE messages SET sender_social_account_id = '${sEsc}' WHERE sender_social_account_id = '${dEsc}';
      UPDATE message_recipients SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';
      UPDATE conversation_participants SET social_account_id = '${sEsc}' WHERE social_account_id = '${dEsc}';
      UPDATE groups SET center_account_id = '${sEsc}' WHERE center_account_id = '${dEsc}';
      UPDATE daily_note_involved_parties SET ref_id = '${sEsc}' WHERE party_type = 'social_account' AND ref_id = '${dEsc}';
      UPDATE people SET social_account_uuids = ARRAY(SELECT DISTINCT unnest(array_replace(social_account_uuids, '${dEsc}', '${sEsc}')))
      WHERE '${dEsc}' = ANY(social_account_uuids);
      UPDATE insights SET applicable_social_account_ids = ARRAY(SELECT DISTINCT unnest(array_replace(applicable_social_account_ids, '${dEsc}', '${sEsc}')))
      WHERE '${dEsc}' = ANY(applicable_social_account_ids);
      UPDATE photos SET prm_location = 'profile_image:' || '${sEsc}' WHERE prm_location = 'profile_image:' || '${dEsc}';
      UPDATE photos SET prm_location = 'social_profile_image:' || '${sEsc}' WHERE prm_location = 'social_profile_image:' || '${dEsc}';
      INSERT INTO face_cluster_rejections (face_id, identity_id, created_at)
      SELECT face_id, '${sEsc}', created_at FROM face_cluster_rejections WHERE identity_id = '${dEsc}'
      ON CONFLICT (face_id, identity_id) DO NOTHING;
      DELETE FROM face_cluster_rejections WHERE identity_id = '${dEsc}';
    `));

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
    await tx.execute(sql.raw(`
      UPDATE social_accounts SET following_count = following_count - 1
      WHERE id IN (SELECT follower_id FROM social_follows WHERE followed_id = '${dEsc}' AND follower_id <> '${sEsc}');
      UPDATE social_accounts SET followers_count = followers_count - 1
      WHERE id IN (SELECT followed_id FROM social_follows WHERE follower_id = '${dEsc}' AND followed_id <> '${sEsc}');
      DELETE FROM social_accounts WHERE id = '${dEsc}';
    `));

    return moved.rowCount ?? 0;
  });

  return { followers: entry.followersAdded, following: entry.followingAdded, posts };
}
