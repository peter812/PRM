// Event producers: write rows to the events table when something changes that
// the user and external agents should know about. One deleted post is one
// event; several from the same check are a parent with one sub-event per post.
import { inArray } from "drizzle-orm";
import { events, socialAccountPosts, type EventLogEntry, type InsertEvent, type SocialAccount } from "@shared/schema";
import { db } from "./db";

export function logEntry(action: string, extra: Partial<EventLogEntry> = {}): EventLogEntry {
  return { at: new Date().toISOString(), action, ...extra };
}

export function nextStepsXml(...steps: string[]) {
  return `<nextSteps>\n${steps.map((s) => `  <step>${s}</step>`).join("\n")}\n</nextSteps>`;
}

const DELETED_NEXT_STEPS = nextStepsXml(
  "Check whether the post was archived or deleted",
  "Keep the saved copy in post history",
);

/** A posts check marked these posts deleted: raise the instagram_post_deleted event(s). */
export async function recordPostsDeletedEvents(
  account: Pick<SocialAccount, "id" | "username" | "ownerUuid">,
  postIds: string[],
): Promise<void> {
  if (postIds.length === 0) return;
  const posts = await db
    .select({
      postId: socialAccountPosts.id,
      postType: socialAccountPosts.postType,
      instagramPk: socialAccountPosts.instagramPk,
      caption: socialAccountPosts.description,
      postedAt: socialAccountPosts.postedAt,
    })
    .from(socialAccountPosts)
    .where(inArray(socialAccountPosts.id, postIds));

  const links = { socialAccountIds: [account.id], personIds: account.ownerUuid ? [account.ownerUuid] : [] };
  const postEvent = (p: (typeof posts)[number]): InsertEvent => ({
    type: "instagram_post_deleted",
    title: "Instagram post deleted",
    subTitle: `@${account.username} removed a ${p.postType}${p.postedAt ? ` from ${p.postedAt.toISOString().slice(0, 10)}` : ""}`,
    log: [logEntry("created", { data: p })],
    ...links,
  });

  if (posts.length === 1) {
    await db.insert(events).values({ ...postEvent(posts[0]), nextSteps: DELETED_NEXT_STEPS });
    return;
  }
  await db.transaction(async (tx) => {
    const [parent] = await tx
      .insert(events)
      .values({
        type: "instagram_posts_deleted",
        title: `${posts.length} Instagram posts deleted`,
        subTitle: `@${account.username} removed ${posts.length} posts`,
        nextSteps: DELETED_NEXT_STEPS,
        log: [logEntry("created", { data: { postIds: posts.map((p) => p.postId) } })],
        ...links,
      })
      .returning({ id: events.id });
    await tx.insert(events).values(posts.map((p) => ({ ...postEvent(p), parentEventId: parent.id })));
  });
}
