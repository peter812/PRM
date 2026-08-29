import { db } from "./db";
import {
  socialAccounts,
  socialAccountHistory,
  socialFollows,
  type SocialAccountHistory,
} from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import crypto from "crypto";

/**
 * Which directions a scrape actually captured.
 *
 * This is the whole safety mechanism behind authoritative deletion: an edge is
 * only ever removed from a direction the scrape genuinely looked at. A
 * profile-only refresh carries no follower list, and without this it would read
 * as an unfollow of every account at once.
 */
export type CaptureScope = "both" | "followers" | "following" | "profile" | "none";

export type ChangeSource = "extension" | "xml-import" | "csv-import" | "manual";

export interface IngestSnapshot {
  socialAccountId: string;
  scope: CaptureScope;
  /** Resolved account ids. Read only for the directions named by `scope`. */
  followerIds?: string[];
  followingIds?: string[];
  profile?: {
    nickname?: string | null;
    bio?: string | null;
    location?: string | null;
    accountUrl?: string | null;
    /** A stable PRM/S3 url. Pass only when the image genuinely changed. */
    imageUrl?: string | null;
    externalImageUrl?: string | null;
    reportedFollowersCount?: number | null;
    reportedFollowingCount?: number | null;
  };
  source: ChangeSource;
  pendingImportId?: string | null;
}

/**
 * Records a profile-image replacement detected outside a scrape.
 *
 * The image pipeline is asynchronous: a scrape queues the download and finishes long
 * before the bytes arrive, so an image change cannot ride along on the scrape's own
 * entry. It gets its own — which is also the more honest record, since that is when
 * the change was actually established.
 *
 * Callers pass the url they compared against, so this never has to guess whether the
 * replacement was real.
 */
export async function recordProfileImageChange(
  socialAccountId: string,
  newImageUrl: string,
  previousImageUrl: string | null,
): Promise<void> {
  if (previousImageUrl === newImageUrl) return;

  await db.transaction(async (tx) => {
    const [account] = await tx
      .select({
        followers: socialAccounts.followersCount,
        following: socialAccounts.followingCount,
      })
      .from(socialAccounts)
      .where(eq(socialAccounts.id, socialAccountId));
    if (!account) return;

    await tx
      .update(socialAccounts)
      .set({ imageUrl: newImageUrl })
      .where(eq(socialAccounts.id, socialAccountId));

    await tx.insert(socialAccountHistory).values({
      socialAccountId,
      batchId: crypto.randomUUID(),
      entryKind: "direct",
      changeSource: "image-pipeline",
      captureScope: "profile",
      followersAfter: account.followers,
      followingAfter: account.following,
      profileFieldsChanged: ["image"],
      previousImageUrl,
    });
  });
}

export const capturesFollowers = (s: CaptureScope) => s === "both" || s === "followers";
export const capturesFollowing = (s: CaptureScope) => s === "both" || s === "following";

/** Postgres caps a statement at 65535 bound parameters; stay well clear of it. */
const CHUNK = 500;

async function chunked<T>(items: T[], run: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    await run(items.slice(i, i + CHUNK));
  }
}

/** Profile fields the journal tracks, paired with where the previous value is stored. */
const TRACKED_FIELDS = [
  { field: "nickname", column: "previousNickname" },
  { field: "bio", column: "previousBio" },
  { field: "location", column: "previousLocation" },
  { field: "image", column: "previousImageUrl" },
] as const;

/**
 * Applies a scrape to the database and journals what changed.
 *
 * The scrape is authoritative: any follow edge in a captured direction that is
 * absent from the snapshot is deleted, whatever its original source — including
 * edges entered by hand or restored from an XML backup. Every removal is written
 * to the journal, so overwritten data stays recoverable rather than silently lost.
 *
 * This is deliberately the only place in the codebase that writes social_follows,
 * social_accounts.followers_count/following_count, or social_account_history. That
 * single-writer rule is what makes the deletion above safe: there is no path that
 * removes an edge without recording it.
 */
export async function applySnapshot(snap: IngestSnapshot): Promise<SocialAccountHistory> {
  const batchId = crypto.randomUUID();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, snap.socialAccountId))
      .for("update");

    if (!before) {
      throw new Error(`Social account ${snap.socialAccountId} not found`);
    }

    // An account is on its first real capture when nothing but the migration's
    // baseline has ever been written for it. The delta lists are still recorded —
    // you want to know who the first five thousand were — but the entry is typed so
    // the UI reads "5,000 captured" rather than "+5,000 gained".
    const [{ count: priorEntries }] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(socialAccountHistory)
      .where(
        and(
          eq(socialAccountHistory.socialAccountId, snap.socialAccountId),
          sql`${socialAccountHistory.entryKind} <> 'baseline'`,
        ),
      );
    const isInitialCapture = priorEntries === 0;

    // ── Edge diff, one direction at a time ────────────────────────────────────
    // `neighbourDelta` accumulates the per-account count moves this run causes on
    // everyone else, so their own history entries and denormalized counts can be
    // written in one pass at the end.
    const neighbourDelta = new Map<string, { followers: number; following: number }>();
    const bump = (id: string, key: "followers" | "following", by: number) => {
      const row = neighbourDelta.get(id) ?? { followers: 0, following: 0 };
      row[key] += by;
      neighbourDelta.set(id, row);
    };

    const diffDirection = async (direction: "followers" | "following") => {
      const isFollowers = direction === "followers";
      const scraped = isFollowers ? snap.followerIds : snap.followingIds;
      if (!scraped) return { added: [] as string[], lost: [] as string[] };

      // An account cannot follow itself, and a duplicate row in the CSV must not
      // read as two separate follows.
      const target = new Set(scraped.filter((id) => id && id !== snap.socialAccountId));

      const selfColumn = isFollowers ? socialFollows.followedId : socialFollows.followerId;
      const otherColumn = isFollowers ? socialFollows.followerId : socialFollows.followedId;

      const existingRows = await tx
        .select({ id: otherColumn })
        .from(socialFollows)
        .where(eq(selfColumn, snap.socialAccountId));
      const existing = new Set(existingRows.map((r) => r.id));

      const added = [...target].filter((id) => !existing.has(id));
      const lost = [...existing].filter((id) => !target.has(id));

      if (added.length) {
        await chunked(added, (batch) =>
          tx
            .insert(socialFollows)
            .values(
              batch.map((id) => ({
                followerId: isFollowers ? id : snap.socialAccountId,
                followedId: isFollowers ? snap.socialAccountId : id,
                source: snap.source,
              })),
            )
            .onConflictDoNothing(),
        );
      }

      if (lost.length) {
        await chunked(lost, (batch) =>
          tx
            .delete(socialFollows)
            .where(and(eq(selfColumn, snap.socialAccountId), inArray(otherColumn, batch))),
        );
      }

      // Gaining a follower means that follower gained a *following*, and vice versa.
      const neighbourKey = isFollowers ? "following" : "followers";
      for (const id of added) bump(id, neighbourKey, 1);
      for (const id of lost) bump(id, neighbourKey, -1);

      return { added, lost };
    };

    const followers = capturesFollowers(snap.scope)
      ? await diffDirection("followers")
      : { added: [], lost: [] };
    const following = capturesFollowing(snap.scope)
      ? await diffDirection("following")
      : { added: [], lost: [] };

    // ── Profile diff ──────────────────────────────────────────────────────────
    // Only fields the snapshot actually carries are considered. `undefined` means
    // the scrape said nothing about that field; an explicit null means it is now
    // empty, and that is a real change worth recording.
    const p = snap.profile ?? {};
    const candidates: Record<string, { next: unknown; prev: unknown }> = {
      nickname: { next: p.nickname, prev: before.nickname },
      bio: { next: p.bio, prev: before.bio },
      location: { next: p.location, prev: before.location },
      image: { next: p.imageUrl, prev: before.imageUrl },
    };

    const profileFieldsChanged: string[] = [];
    const previousValues: Record<string, string | null> = {};
    for (const { field, column } of TRACKED_FIELDS) {
      const { next, prev } = candidates[field];
      if (next === undefined) continue;
      if ((next ?? null) === (prev ?? null)) continue;
      profileFieldsChanged.push(field);
      previousValues[column] = (prev ?? null) as string | null;
    }

    const followersAfter = before.followersCount + followers.added.length - followers.lost.length;
    const followingAfter = before.followingCount + following.added.length - following.lost.length;

    // ── Current state ─────────────────────────────────────────────────────────
    await tx
      .update(socialAccounts)
      .set({
        ...(p.nickname !== undefined ? { nickname: p.nickname } : {}),
        ...(p.bio !== undefined ? { bio: p.bio } : {}),
        ...(p.location !== undefined ? { location: p.location } : {}),
        ...(p.accountUrl !== undefined ? { accountUrl: p.accountUrl } : {}),
        ...(p.imageUrl !== undefined ? { imageUrl: p.imageUrl } : {}),
        ...(p.externalImageUrl !== undefined ? { externalImageUrl: p.externalImageUrl } : {}),
        ...(p.reportedFollowersCount !== undefined
          ? { reportedFollowersCount: p.reportedFollowersCount }
          : {}),
        ...(p.reportedFollowingCount !== undefined
          ? { reportedFollowingCount: p.reportedFollowingCount }
          : {}),
        followersCount: followersAfter,
        followingCount: followingAfter,
        lastScrapedAt: new Date(),
        isSimple: false,
      })
      .where(eq(socialAccounts.id, snap.socialAccountId));

    // ── The direct entry ──────────────────────────────────────────────────────
    const [entry] = await tx
      .insert(socialAccountHistory)
      .values({
        socialAccountId: snap.socialAccountId,
        batchId,
        entryKind: "direct",
        changeSource: snap.source,
        captureScope: snap.scope,
        isInitialCapture,
        pendingImportId: snap.pendingImportId ?? null,
        followersAfter,
        followersAdded: followers.added.length,
        followersLost: followers.lost.length,
        followingAfter,
        followingAdded: following.added.length,
        followingLost: following.lost.length,
        reportedFollowersAfter: p.reportedFollowersCount ?? before.reportedFollowersCount,
        reportedFollowingAfter: p.reportedFollowingCount ?? before.reportedFollowingCount,
        profileFieldsChanged,
        ...previousValues,
        delta: {
          followersAdded: followers.added,
          followersLost: followers.lost,
          followingAdded: following.added,
          followingLost: following.lost,
        },
      })
      .returning();

    // ── Neighbour entries ─────────────────────────────────────────────────────
    // Every account touched by this run gets its own entry, so a change is visible
    // from both sides even though only one of them was scraped. These carry no
    // `delta`: observedViaAccountId plus the count columns already tell the whole
    // story, which is what keeps a 10k-follower import near 2 MB of journal
    // rather than 20 MB.
    if (neighbourDelta.size) {
      const neighbours = [...neighbourDelta.entries()];

      const currentCounts = new Map<string, { followers: number; following: number }>();
      await chunked(neighbours, async (batch) => {
        const rows = await tx
          .select({
            id: socialAccounts.id,
            followers: socialAccounts.followersCount,
            following: socialAccounts.followingCount,
          })
          .from(socialAccounts)
          .where(inArray(socialAccounts.id, batch.map(([id]) => id)));
        for (const r of rows) currentCounts.set(r.id, { followers: r.followers, following: r.following });
      });

      const entries = neighbours
        .filter(([id]) => currentCounts.has(id))
        .map(([id, move]) => {
          const now = currentCounts.get(id)!;
          return {
            id,
            move,
            followersAfter: now.followers + move.followers,
            followingAfter: now.following + move.following,
          };
        });

      await chunked(entries, (batch) =>
        tx.insert(socialAccountHistory).values(
          batch.map((n) => ({
            socialAccountId: n.id,
            batchId,
            entryKind: "neighbour",
            changeSource: snap.source,
            captureScope: "none" as const,
            observedViaAccountId: snap.socialAccountId,
            followersAfter: n.followersAfter,
            followersAdded: Math.max(n.move.followers, 0),
            followersLost: Math.max(-n.move.followers, 0),
            followingAfter: n.followingAfter,
            followingAdded: Math.max(n.move.following, 0),
            followingLost: Math.max(-n.move.following, 0),
          })),
        ),
      );

      await chunked(entries, (batch) =>
        tx.execute(sql`
          UPDATE ${socialAccounts} AS sa
          SET followers_count = v.followers, following_count = v.following
          FROM (VALUES ${sql.join(
            batch.map((n) => sql`(${n.id}, ${n.followersAfter}::int, ${n.followingAfter}::int)`),
            sql`, `,
          )}) AS v(id, followers, following)
          WHERE sa.id = v.id
        `),
      );
    }

    return entry;
  });
}
