import { db } from "./db";
import { sql, or, inArray } from "drizzle-orm";
import {
  people,
  socialAccounts,
  groups,
  notes,
  interactions,
  messages,
  socialAccountPosts,
  socialProfileVersions,
} from "@shared/schema";
import type { Photo } from "@shared/schema";

export interface ResolvedPhotoSource {
  type: "person" | "social_account" | "post" | "story" | "group" | "note" | "interaction" | "message";
  id: string;
  label: string;
  href: string;
  sublabel?: string;
  /** The post's stored video, when this photo is its cover frame. */
  videoUrl?: string;
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

interface ParsedPhoto {
  photo: Photo;
  prmLocation: string;
  locationUrl: string;
  prefix: string;
  targetId: string;
}

/**
 * Batched resolution of photo sources.
 * Resolves where multiple photos came from as links the caller may follow.
 */
export async function resolvePhotoSources(photos: Photo[]): Promise<Map<string, ResolvedPhotoSource>> {
  const result = new Map<string, ResolvedPhotoSource>();
  if (!photos || photos.length === 0) return result;

  // 1. Parse all photo.prmLocation strings upfront
  const parsedPhotos: ParsedPhoto[] = photos.map((photo) => {
    const prmLocation = photo.prmLocation ? photo.prmLocation.trim() : "";
    const locationUrl = photo.location ? photo.location.trim() : "";
    let prefix = "";
    let targetId = "";
    if (prmLocation) {
      const colonIndex = prmLocation.indexOf(":");
      prefix = colonIndex >= 0 ? prmLocation.slice(0, colonIndex).trim() : prmLocation;
      targetId = colonIndex >= 0 ? prmLocation.slice(colonIndex + 1).trim() : "";
    }
    return { photo, prmLocation, locationUrl, prefix, targetId };
  });

  // Handle immediate "Me" profile matches (ZERO_UUID)
  for (const p of parsedPhotos) {
    if (p.prefix === "profile_image" || p.prefix === "social_profile_image") {
      if (p.targetId === ZERO_UUID) {
        result.set(p.photo.id, {
          type: "person",
          id: p.targetId,
          label: "Me Profile",
          href: "/me",
        });
      }
    }
  }

  // 2. Profile images and social profile images
  const profilePhotos = parsedPhotos.filter(
    (p) => !result.has(p.photo.id) && (p.prefix === "profile_image" || p.prefix === "social_profile_image") && p.targetId
  );
  const profileTargetIds = Array.from(new Set(profilePhotos.map((p) => p.targetId)));

  if (profileTargetIds.length > 0) {
    // Check if targetId is a Person
    try {
      const peopleRows = await db
        .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(inArray(people.id, profileTargetIds));
      const personById = new Map(peopleRows.map((r) => [r.id, r]));

      for (const p of profilePhotos) {
        if (!result.has(p.photo.id)) {
          const person = personById.get(p.targetId);
          if (person) {
            const name = `${person.firstName || ""} ${person.lastName || ""}`.trim() || "Person Profile";
            result.set(p.photo.id, {
              type: "person",
              id: person.id,
              label: `Person: ${name}`,
              href: `/person/${person.id}`,
            });
          }
        }
      }
    } catch {}

    // Check if targetId is a Social Account
    const remainingSaTargetIds = Array.from(
      new Set(
        profilePhotos
          .filter((p) => !result.has(p.photo.id))
          .map((p) => p.targetId)
      )
    );

    if (remainingSaTargetIds.length > 0) {
      try {
        const saRows = await db
          .select({ id: socialAccounts.id, username: socialAccounts.username, nickname: socialAccounts.nickname })
          .from(socialAccounts)
          .where(inArray(socialAccounts.id, remainingSaTargetIds));
        const saById = new Map(saRows.map((r) => [r.id, r]));

        for (const p of profilePhotos) {
          if (!result.has(p.photo.id)) {
            const account = saById.get(p.targetId);
            if (account) {
              const handle = account.nickname
                ? `@${account.username} (${account.nickname})`
                : `@${account.username}`;
              result.set(p.photo.id, {
                type: "social_account",
                id: account.id,
                label: `Social Account: ${handle}`,
                href: `/social-accounts/${account.id}`,
              });
            }
          }
        }
      } catch {}
    }

    // Check if targetId is a Group
    const remainingGroupTargetIds = Array.from(
      new Set(
        profilePhotos
          .filter((p) => !result.has(p.photo.id))
          .map((p) => p.targetId)
      )
    );

    if (remainingGroupTargetIds.length > 0) {
      try {
        const groupRows = await db
          .select({ id: groups.id, name: groups.name })
          .from(groups)
          .where(inArray(groups.id, remainingGroupTargetIds));
        const groupById = new Map(groupRows.map((r) => [r.id, r]));

        for (const p of profilePhotos) {
          if (!result.has(p.photo.id)) {
            const group = groupById.get(p.targetId);
            if (group) {
              result.set(p.photo.id, {
                type: "group",
                id: group.id,
                label: `Group: ${group.name}`,
                href: `/group/${group.id}`,
              });
            }
          }
        }
      } catch {}
    }

    // If prefix is social_profile_image, targetId might be a social_profile_versions id
    const spvPhotos = profilePhotos.filter((p) => !result.has(p.photo.id) && p.prefix === "social_profile_image");
    const spvTargetIds = Array.from(new Set(spvPhotos.map((p) => p.targetId)));

    if (spvTargetIds.length > 0) {
      try {
        const spvRows = await db
          .select({ id: socialProfileVersions.id, socialAccountId: socialProfileVersions.socialAccountId })
          .from(socialProfileVersions)
          .where(inArray(socialProfileVersions.id, spvTargetIds));

        if (spvRows.length > 0) {
          const saIds = Array.from(new Set(spvRows.map((r) => r.socialAccountId).filter(Boolean)));
          if (saIds.length > 0) {
            const saRows = await db
              .select({ id: socialAccounts.id, username: socialAccounts.username })
              .from(socialAccounts)
              .where(inArray(socialAccounts.id, saIds));
            const saById = new Map(saRows.map((r) => [r.id, r]));
            const saBySpvId = new Map(spvRows.map((r) => [r.id, saById.get(r.socialAccountId)]));

            for (const p of spvPhotos) {
              if (!result.has(p.photo.id)) {
                const account = saBySpvId.get(p.targetId);
                if (account) {
                  result.set(p.photo.id, {
                    type: "social_account",
                    id: account.id,
                    label: `Social Account: @${account.username}`,
                    href: `/social-accounts/${account.id}`,
                  });
                }
              }
            }
          }
        }
      } catch {}
    }
  }

  // 3. Group images
  const groupImagePhotos = parsedPhotos.filter(
    (p) => !result.has(p.photo.id) && p.prefix === "group_image" && p.targetId
  );
  const groupImageTargetIds = Array.from(new Set(groupImagePhotos.map((p) => p.targetId)));
  if (groupImageTargetIds.length > 0) {
    try {
      const groupRows = await db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(inArray(groups.id, groupImageTargetIds));
      const groupById = new Map(groupRows.map((r) => [r.id, r]));
      for (const p of groupImagePhotos) {
        if (!result.has(p.photo.id)) {
          const group = groupById.get(p.targetId);
          if (group) {
            result.set(p.photo.id, {
              type: "group",
              id: group.id,
              label: `Group: ${group.name}`,
              href: `/group/${group.id}`,
            });
          }
        }
      }
    } catch {}
  }

  // 4. Post / story
  const postPhotos = parsedPhotos.filter((p) => !result.has(p.photo.id) && p.prefix === "post" && p.targetId);
  const postTargetIds = Array.from(new Set(postPhotos.map((p) => p.targetId)));

  if (postTargetIds.length > 0) {
    try {
      const postRows = await db
        .select({
          id: socialAccountPosts.id,
          socialAccountId: socialAccountPosts.socialAccountId,
          postType: socialAccountPosts.postType,
          content: socialAccountPosts.content,
          videoUrl: sql<string | null>`${socialAccountPosts.metadata}->>'videoUrl'`,
        })
        .from(socialAccountPosts)
        .where(inArray(socialAccountPosts.id, postTargetIds));
      const postById = new Map(postRows.map((r) => [r.id, r]));

      const saIds = Array.from(new Set(postRows.map((r) => r.socialAccountId).filter(Boolean)));
      if (saIds.length > 0) {
        const saRows = await db
          .select({ id: socialAccounts.id, username: socialAccounts.username })
          .from(socialAccounts)
          .where(inArray(socialAccounts.id, saIds));
        const saById = new Map(saRows.map((r) => [r.id, r]));

        for (const p of postPhotos) {
          if (!result.has(p.photo.id)) {
            const post = postById.get(p.targetId);
            if (post) {
              const account = saById.get(post.socialAccountId);
              if (account) {
                const isStory = post.postType === "story";
                const tab = isStory ? "stories" : "posts";
                const typeLabel = isStory ? "Story" : "Post";
                const handle = account.username ? ` (@${account.username})` : "";
                // The video belongs to the post's first slide, its cover frame.
                let cover: string | undefined;
                try { if (post.videoUrl) cover = JSON.parse(post.content ?? "[]")[0]; } catch {}
                result.set(p.photo.id, {
                  type: isStory ? "story" : "post",
                  id: post.id,
                  label: `${typeLabel}${handle}`,
                  href: `/social-accounts/${post.socialAccountId}?tab=${tab}&postId=${post.id}`,
                  ...(cover && cover === p.locationUrl ? { videoUrl: post.videoUrl! } : {}),
                });
              }
            }
          }
        }
      }
    } catch {}
  }

  // 5. Note
  const notePhotos = parsedPhotos.filter(
    (p) => !result.has(p.photo.id) && p.prefix === "note" && p.targetId && p.targetId !== "pending"
  );
  const noteTargetIds = Array.from(new Set(notePhotos.map((p) => p.targetId)));

  if (noteTargetIds.length > 0) {
    try {
      const noteRows = await db
        .select({ id: notes.id, personId: notes.personId })
        .from(notes)
        .where(inArray(notes.id, noteTargetIds));
      const noteById = new Map(noteRows.map((r) => [r.id, r]));

      const personIds = Array.from(new Set(noteRows.map((r) => r.personId).filter(Boolean)));
      if (personIds.length > 0) {
        const peopleRows = await db
          .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
          .from(people)
          .where(inArray(people.id, personIds));
        const personById = new Map(peopleRows.map((r) => [r.id, r]));

        for (const p of notePhotos) {
          if (!result.has(p.photo.id)) {
            const note = noteById.get(p.targetId);
            if (note) {
              const person = personById.get(note.personId);
              const name = person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : "";
              result.set(p.photo.id, {
                type: "note",
                id: note.id,
                label: name ? `Note (${name})` : "Note",
                href: `/person/${note.personId}?tab=notes`,
              });
            }
          }
        }
      }
    } catch {}
  }

  // 6. Interaction
  const interactionPhotos = parsedPhotos.filter(
    (p) => !result.has(p.photo.id) && p.prefix === "interaction" && p.targetId
  );
  const interactionTargetIds = Array.from(new Set(interactionPhotos.map((p) => p.targetId)));

  if (interactionTargetIds.length > 0) {
    try {
      const interactionRows = await db
        .select({ id: interactions.id, title: interactions.title, peopleIds: interactions.peopleIds })
        .from(interactions)
        .where(inArray(interactions.id, interactionTargetIds));
      const interactionById = new Map(interactionRows.map((r) => [r.id, r]));

      const personIds = Array.from(
        new Set(interactionRows.map((r) => r.peopleIds?.[0]).filter((id): id is string => Boolean(id)))
      );
      const peopleRows = personIds.length > 0
        ? await db
            .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
            .from(people)
            .where(inArray(people.id, personIds))
        : [];
      const personById = new Map(peopleRows.map((r) => [r.id, r]));

      for (const p of interactionPhotos) {
        if (!result.has(p.photo.id)) {
          const interaction = interactionById.get(p.targetId);
          if (interaction) {
            const personId = interaction.peopleIds?.[0];
            const person = personId ? personById.get(personId) : null;
            const name = person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : "";
            const title = interaction.title ? `"${interaction.title}"` : (name ? `Interaction (${name})` : "Interaction");
            result.set(p.photo.id, {
              type: "interaction",
              id: interaction.id,
              label: title,
              href: personId ? `/person/${personId}?tab=interactions` : `/people`,
            });
          }
        }
      }
    } catch {}
  }

  // 7. Message
  const messagePhotos = parsedPhotos.filter(
    (p) => !result.has(p.photo.id) && p.prefix === "message" && p.targetId
  );
  const messageTargetIds = Array.from(new Set(messagePhotos.map((p) => p.targetId)));

  if (messageTargetIds.length > 0) {
    try {
      const messageRows = await db
        .select({
          id: messages.id,
          senderPersonId: messages.senderPersonId,
          senderSocialAccountId: messages.senderSocialAccountId,
        })
        .from(messages)
        .where(inArray(messages.id, messageTargetIds));
      const messageById = new Map(messageRows.map((r) => [r.id, r]));

      const personIds = Array.from(
        new Set(messageRows.map((r) => r.senderPersonId).filter((id): id is string => Boolean(id)))
      );
      const saIds = Array.from(
        new Set(messageRows.map((r) => r.senderSocialAccountId).filter((id): id is string => Boolean(id)))
      );

      const peopleRows = personIds.length > 0
        ? await db
            .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
            .from(people)
            .where(inArray(people.id, personIds))
        : [];
      const personById = new Map(peopleRows.map((r) => [r.id, r]));

      const saRows = saIds.length > 0
        ? await db
            .select({ id: socialAccounts.id, username: socialAccounts.username })
            .from(socialAccounts)
            .where(inArray(socialAccounts.id, saIds))
        : [];
      const saById = new Map(saRows.map((r) => [r.id, r]));

      for (const p of messagePhotos) {
        if (!result.has(p.photo.id)) {
          const message = messageById.get(p.targetId);
          if (message) {
            if (message.senderPersonId) {
              const person = personById.get(message.senderPersonId);
              const name = person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() : "";
              result.set(p.photo.id, {
                type: "message",
                id: message.id,
                label: name ? `Message (${name})` : "Message",
                href: `/person/${message.senderPersonId}?tab=messages`,
              });
            } else if (message.senderSocialAccountId) {
              const account = saById.get(message.senderSocialAccountId);
              const handle = account?.username ? `@${account.username}` : "";
              result.set(p.photo.id, {
                type: "message",
                id: message.id,
                label: handle ? `Message (${handle})` : "Message",
                href: `/social-accounts/${message.senderSocialAccountId}?tab=messages`,
              });
            }
          }
        }
      }
    } catch {}
  }

  // 8. Fallback: Check location against people, socialAccounts, groups, and socialAccountPosts
  const unresolvedWithLocation = parsedPhotos.filter((p) => !result.has(p.photo.id) && p.locationUrl);
  const locationUrls = Array.from(new Set(unresolvedWithLocation.map((p) => p.locationUrl)));

  if (locationUrls.length > 0) {
    // Check against people.imageUrl
    try {
      const matchedPeople = await db
        .select({ id: people.id, firstName: people.firstName, lastName: people.lastName, imageUrl: people.imageUrl })
        .from(people)
        .where(inArray(people.imageUrl, locationUrls));
      const personByUrl = new Map<string, ResolvedPhotoSource>();
      for (const person of matchedPeople) {
        if (person.imageUrl && !personByUrl.has(person.imageUrl)) {
          const name = `${person.firstName || ""} ${person.lastName || ""}`.trim() || "Person Profile";
          personByUrl.set(person.imageUrl, {
            type: "person",
            id: person.id,
            label: `Person: ${name}`,
            href: `/person/${person.id}`,
          });
        }
      }
      for (const p of unresolvedWithLocation) {
        if (!result.has(p.photo.id)) {
          const matched = personByUrl.get(p.locationUrl);
          if (matched) result.set(p.photo.id, matched);
        }
      }
    } catch {}

    // Check against socialAccounts (imageUrl or externalImageUrl)
    const urlsForSa = Array.from(
      new Set(parsedPhotos.filter((p) => !result.has(p.photo.id) && p.locationUrl).map((p) => p.locationUrl))
    );
    if (urlsForSa.length > 0) {
      try {
        const matchedSas = await db
          .select({
            id: socialAccounts.id,
            username: socialAccounts.username,
            nickname: socialAccounts.nickname,
            imageUrl: socialAccounts.imageUrl,
            externalImageUrl: socialAccounts.externalImageUrl,
          })
          .from(socialAccounts)
          .where(
            or(
              inArray(socialAccounts.imageUrl, urlsForSa),
              inArray(socialAccounts.externalImageUrl, urlsForSa)
            )
          );
        const saByUrl = new Map<string, ResolvedPhotoSource>();
        for (const account of matchedSas) {
          const handle = account.nickname
            ? `@${account.username} (${account.nickname})`
            : `@${account.username}`;
          const source: ResolvedPhotoSource = {
            type: "social_account",
            id: account.id,
            label: `Social Account: ${handle}`,
            href: `/social-accounts/${account.id}`,
          };
          if (account.imageUrl && !saByUrl.has(account.imageUrl)) {
            saByUrl.set(account.imageUrl, source);
          }
          if (account.externalImageUrl && !saByUrl.has(account.externalImageUrl)) {
            saByUrl.set(account.externalImageUrl, source);
          }
        }
        for (const p of parsedPhotos) {
          if (!result.has(p.photo.id) && p.locationUrl) {
            const matched = saByUrl.get(p.locationUrl);
            if (matched) result.set(p.photo.id, matched);
          }
        }
      } catch {}
    }

    // Check against groups
    const urlsForGroups = Array.from(
      new Set(parsedPhotos.filter((p) => !result.has(p.photo.id) && p.locationUrl).map((p) => p.locationUrl))
    );
    if (urlsForGroups.length > 0) {
      try {
        const matchedGroups = await db
          .select({ id: groups.id, name: groups.name, imageUrl: groups.imageUrl })
          .from(groups)
          .where(inArray(groups.imageUrl, urlsForGroups));
        const groupByUrl = new Map<string, ResolvedPhotoSource>();
        for (const group of matchedGroups) {
          if (group.imageUrl && !groupByUrl.has(group.imageUrl)) {
            groupByUrl.set(group.imageUrl, {
              type: "group",
              id: group.id,
              label: `Group: ${group.name}`,
              href: `/group/${group.id}`,
            });
          }
        }
        for (const p of parsedPhotos) {
          if (!result.has(p.photo.id) && p.locationUrl) {
            const matched = groupByUrl.get(p.locationUrl);
            if (matched) result.set(p.photo.id, matched);
          }
        }
      } catch {}
    }

    // Check against socialAccountPosts content
    const urlsForPosts = Array.from(
      new Set(parsedPhotos.filter((p) => !result.has(p.photo.id) && p.locationUrl).map((p) => p.locationUrl))
    );
    if (urlsForPosts.length > 0) {
      try {
        const postLikeConditions = urlsForPosts.map((url) => sql`content LIKE ${'%' + url + '%'}`);
        const checkRes: any = await db.execute(sql`
          SELECT id, social_account_id, post_type, content
          FROM social_account_posts
          WHERE is_deleted = false AND (${sql.join(postLikeConditions, sql` OR `)})
        `);
        const matchedRows = (checkRes.rows || []) as {
          id: string;
          social_account_id: string;
          post_type: string;
          content: string;
        }[];

        if (matchedRows.length > 0) {
          const matchedPostByUrl = new Map<string, typeof matchedRows[0]>();
          for (const row of matchedRows) {
            for (const url of urlsForPosts) {
              if (!matchedPostByUrl.has(url) && row.content && row.content.includes(url)) {
                matchedPostByUrl.set(url, row);
              }
            }
          }

          const postSaIds = Array.from(
            new Set(Array.from(matchedPostByUrl.values()).map((r) => r.social_account_id).filter(Boolean))
          );
          if (postSaIds.length > 0) {
            const postSas = await db
              .select({ id: socialAccounts.id, username: socialAccounts.username })
              .from(socialAccounts)
              .where(inArray(socialAccounts.id, postSaIds));
            const postSaById = new Map(postSas.map((a) => [a.id, a]));

            for (const [url, postRow] of matchedPostByUrl.entries()) {
              const account = postSaById.get(postRow.social_account_id);
              if (account) {
                const isStory = postRow.post_type === "story";
                const tab = isStory ? "stories" : "posts";
                const typeLabel = isStory ? "Story" : "Post";
                const handle = account.username ? ` (@${account.username})` : "";
                const source: ResolvedPhotoSource = {
                  type: isStory ? "story" : "post",
                  id: postRow.id,
                  label: `${typeLabel}${handle}`,
                  href: `/social-accounts/${postRow.social_account_id}?tab=${tab}&postId=${postRow.id}`,
                };
                for (const p of parsedPhotos) {
                  if (!result.has(p.photo.id) && p.locationUrl === url) {
                    result.set(p.photo.id, source);
                  }
                }
              }
            }
          }
        }
      } catch {}
    }
  }

  return result;
}

/**
 * Where a photo came from, as a link the caller may follow. Runs as the caller,
 * so a source they can't see (a private person, someone else's account) resolves
 * to null rather than leaking its name.
 */
export async function resolvePhotoSource(photo: Photo): Promise<ResolvedPhotoSource | null> {
  return (await resolvePhotoSources([photo])).get(photo.id) ?? null;
}
