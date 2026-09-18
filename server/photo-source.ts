import { db } from "./db";
import { storage } from "./storage";
import { sql, eq, and } from "drizzle-orm";
import { people, socialAccounts, groups, notes, interactions, messages, socialAccountPosts } from "@shared/schema";
import type { Photo } from "@shared/schema";
import { visibleShared } from "./access";

export interface ResolvedPhotoSource {
  type: "person" | "social_account" | "post" | "story" | "group" | "note" | "interaction" | "message";
  id: string;
  label: string;
  href: string;
  sublabel?: string;
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Where a photo came from, as a link the caller may follow. Runs as the caller,
 * so a source they can't see (a private person, someone else's account) resolves
 * to null rather than leaking its name.
 */
export async function resolvePhotoSource(photo: Photo): Promise<ResolvedPhotoSource | null> {
  const prmLocation = photo.prmLocation ? photo.prmLocation.trim() : "";
  const locationUrl = photo.location ? photo.location.trim() : "";

  if (prmLocation) {
    const colonIndex = prmLocation.indexOf(":");
    const prefix = colonIndex >= 0 ? prmLocation.slice(0, colonIndex).trim() : prmLocation;
    const targetId = colonIndex >= 0 ? prmLocation.slice(colonIndex + 1).trim() : "";

    // 1. Profile image / social profile image
    if (prefix === "profile_image" || prefix === "social_profile_image") {
      if (targetId) {
        if (targetId === ZERO_UUID) {
          return {
            type: "person",
            id: targetId,
            label: "Me Profile",
            href: "/me",
          };
        }

        // Check if targetId is a Person
        try {
          const person = await storage.getPersonById(targetId);
          if (person) {
            const name = `${person.firstName || ""} ${person.lastName || ""}`.trim() || "Person Profile";
            return {
              type: "person",
              id: person.id,
              label: `Person: ${name}`,
              href: `/person/${person.id}`,
            };
          }
        } catch {}

        // Check if targetId is a Social Account
        try {
          const account = await storage.getSocialAccountById(targetId);
          if (account) {
            const handle = account.currentProfile?.nickname
              ? `@${account.username} (${account.currentProfile.nickname})`
              : `@${account.username}`;
            return {
              type: "social_account",
              id: account.id,
              label: `Social Account: ${handle}`,
              href: `/social-accounts/${account.id}`,
            };
          }
        } catch {}

        // Check if targetId is a Group
        try {
          const group = await storage.getGroupById(targetId);
          if (group) {
            return {
              type: "group",
              id: group.id,
              label: `Group: ${group.name}`,
              href: `/group/${group.id}`,
            };
          }
        } catch {}

        // If prefix is social_profile_image, targetId might be a social_profile_version id
        if (prefix === "social_profile_image") {
          try {
            const versionRes: any = await db.execute(
              sql`SELECT social_account_id FROM social_profile_versions WHERE id = ${targetId} LIMIT 1`
            );
            const saId = versionRes.rows?.[0]?.social_account_id as string | undefined;
            if (saId) {
              const account = await storage.getSocialAccountById(saId);
              if (account) {
                return {
                  type: "social_account",
                  id: account.id,
                  label: `Social Account: @${account.username}`,
                  href: `/social-accounts/${account.id}`,
                };
              }
            }
          } catch {}
        }
      }

      // If bare "profile_image" or targetId didn't match an active record:
      // Try resolving by matching image URL against known tables
      if (locationUrl) {
        try {
          const [matchedPerson] = await db
            .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
            .from(people)
            .where(and(eq(people.imageUrl, locationUrl), visibleShared(people.visibility, people.createdByUserId)))
            .limit(1);
          if (matchedPerson) {
            const name = `${matchedPerson.firstName || ""} ${matchedPerson.lastName || ""}`.trim() || "Person Profile";
            return {
              type: "person",
              id: matchedPerson.id,
              label: `Person: ${name}`,
              href: `/person/${matchedPerson.id}`,
            };
          }
        } catch {}

        try {
          const [matchedAccount] = await db
            .select({ id: socialAccounts.id, username: socialAccounts.username, nickname: socialAccounts.nickname })
            .from(socialAccounts)
            .where(and(
              sql`(${socialAccounts.imageUrl} = ${locationUrl} OR ${socialAccounts.externalImageUrl} = ${locationUrl})`,
              visibleShared(socialAccounts.visibility, socialAccounts.createdByUserId),
            ))
            .limit(1);
          if (matchedAccount) {
            const handle = matchedAccount.nickname
              ? `@${matchedAccount.username} (${matchedAccount.nickname})`
              : `@${matchedAccount.username}`;
            return {
              type: "social_account",
              id: matchedAccount.id,
              label: `Social Account: ${handle}`,
              href: `/social-accounts/${matchedAccount.id}`,
            };
          }
        } catch {}

        try {
          const [matchedGroup] = await db
            .select({ id: groups.id, name: groups.name })
            .from(groups)
            .where(and(eq(groups.imageUrl, locationUrl), visibleShared(groups.visibility, groups.createdByUserId)))
            .limit(1);
          if (matchedGroup) {
            return {
              type: "group",
              id: matchedGroup.id,
              label: `Group: ${matchedGroup.name}`,
              href: `/group/${matchedGroup.id}`,
            };
          }
        } catch {}
      }
    }

    // 2. Post / story
    if (prefix === "post") {
      if (targetId) {
        try {
          const post = await storage.getPostById(targetId);
          // getPostById isn't visibility-scoped; the account lookup is.
          const account = post ? await storage.getSocialAccountById(post.socialAccountId) : undefined;
          if (post && account) {
            const isStory = post.postType === "story";
            const tab = isStory ? "stories" : "posts";
            const typeLabel = isStory ? "Story" : "Post";
            const handle = account.username ? ` (@${account.username})` : "";
            return {
              type: isStory ? "story" : "post",
              id: post.id,
              label: `${typeLabel}${handle}`,
              href: `/social-accounts/${post.socialAccountId}?tab=${tab}&postId=${post.id}`,
            };
          }
        } catch {}
      }

      // If bare "post" or targetId didn't match: look for the image URL in a
      // post's content. Only a non-empty URL may match, or `LIKE '%%'` would
      // hand back whichever post the planner reaches first.
      if (locationUrl) {
        try {
          const checkRes: any = await db.execute(
            sql`SELECT id, social_account_id, post_type FROM social_account_posts WHERE content LIKE ${'%' + locationUrl + '%'} AND is_deleted = false LIMIT 1`
          );
          const matchedPost = checkRes.rows?.[0] as { id: string; social_account_id: string; post_type: string } | undefined;
          // The account lookup is the visibility check.
          const account = matchedPost ? await storage.getSocialAccountById(matchedPost.social_account_id) : undefined;
          if (matchedPost && account) {
            const isStory = matchedPost.post_type === "story";
            const tab = isStory ? "stories" : "posts";
            const typeLabel = isStory ? "Story" : "Post";
            const handle = account.username ? ` (@${account.username})` : "";
            return {
              type: isStory ? "story" : "post",
              id: matchedPost.id,
              label: `${typeLabel}${handle}`,
              href: `/social-accounts/${matchedPost.social_account_id}?tab=${tab}&postId=${matchedPost.id}`,
            };
          }
        } catch {}
      }
    }

    // 3. Group image
    if (prefix === "group_image") {
      if (targetId) {
        try {
          const group = await storage.getGroupById(targetId);
          if (group) {
            return {
              type: "group",
              id: group.id,
              label: `Group: ${group.name}`,
              href: `/group/${group.id}`,
            };
          }
        } catch {}
      }
    }

    // 4. Note
    if (prefix === "note") {
      if (targetId && targetId !== "pending") {
        try {
          const [note] = await db.select().from(notes).where(eq(notes.id, targetId)).limit(1);
          if (note) {
            const person = await storage.getPersonById(note.personId);
            const name = person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : "";
            return {
              type: "note",
              id: note.id,
              label: name ? `Note (${name})` : "Note",
              href: `/person/${note.personId}?tab=notes`,
            };
          }
        } catch {}
      }
    }

    // 5. Interaction
    if (prefix === "interaction") {
      if (targetId) {
        try {
          const [interaction] = await db.select().from(interactions).where(eq(interactions.id, targetId)).limit(1);
          if (interaction) {
            const personId = interaction.peopleIds?.[0];
            const person = personId ? await storage.getPersonById(personId) : null;
            const name = person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : "";
            const title = interaction.title ? `"${interaction.title}"` : (name ? `Interaction (${name})` : "Interaction");
            return {
              type: "interaction",
              id: interaction.id,
              label: title,
              href: personId ? `/person/${personId}?tab=interactions` : `/people`,
            };
          }
        } catch {}
      }
    }

    // 6. Message
    if (prefix === "message") {
      if (targetId) {
        try {
          const [message] = await db.select().from(messages).where(eq(messages.id, targetId)).limit(1);
          if (message) {
            if (message.senderPersonId) {
              const person = await storage.getPersonById(message.senderPersonId);
              const name = person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : "";
              return {
                type: "message",
                id: message.id,
                label: name ? `Message (${name})` : "Message",
                href: `/person/${message.senderPersonId}?tab=messages`,
              };
            } else if (message.senderSocialAccountId) {
              const account = await storage.getSocialAccountById(message.senderSocialAccountId);
              const handle = account?.username ? `@${account.username}` : "";
              return {
                type: "message",
                id: message.id,
                label: handle ? `Message (${handle})` : "Message",
                href: `/social-accounts/${message.senderSocialAccountId}?tab=messages`,
              };
            }
          }
        } catch {}
      }
    }
  }

  // Fallback: If not matched or explicit separate image (e.g. manual-interactive-upload, unknown, etc.)
  return null;
}
