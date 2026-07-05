/**
 * Shared XML‑to‑database import pipeline.
 *
 * Consolidates the identical import logic that was previously duplicated in
 * server/routes/auth-setup.ts (synchronous /api/import-xml endpoint) and
 * server/task-worker.ts (async processImportXmlTask background job).
 *
 * Callers provide an optional `onProgress` callback so the background task can
 * push progress updates while the synchronous endpoint simply omits it.
 */
import { storage } from "./storage";
import { db } from "./db";
import { eq, isNotNull } from "drizzle-orm";
import {
  people,
  relationshipTypes,
  interactionTypes,
  socialNetworkChanges,
  socialAccountPosts,
  lineage,
  partnerships,
  photos,
  dailyNotes,
  dailyNoteEvents,
  dailyNoteInvolvedParties,
  dailyNoteAuditLogs,
  sexGuessQueue,
  aiChats,
  appSettings,
  socialAccounts,
} from "@shared/schema";
import { parseXmlTag, parseAllTags, parseXmlArray, unescapeXml } from "./xml-utils";

export interface XmlImportResult {
  imported: Record<string, number>;
  skipped: Record<string, number>;
}

/**
 * Parse a PRM XML backup and insert every entity into the database.
 *
 * @param xmlText    - Full XML string.
 * @param userId     - The authenticated user's numeric ID (used for AI chats).
 * @param onProgress - Optional callback for progress reporting (percent 0–100, message).
 */
export async function performXmlImport(
  xmlText: string,
  userId: number,
  onProgress?: (percent: number, message: string) => Promise<void>,
): Promise<XmlImportResult> {
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

  const mePersonResult = await db.select().from(people).where(isNotNull(people.userId)).limit(1);
  const mePersonId = mePersonResult[0]?.id || null;

  const replaceZeroUUID = (uuid: string): string => {
    if (!mePersonId) return uuid;
    return uuid === ZERO_UUID ? mePersonId : uuid;
  };

  const mapPrmLocationImport = (loc: string | null): string => {
    if (!loc) return "";
    if (mePersonId && loc.includes(ZERO_UUID)) {
      return loc.replace(ZERO_UUID, mePersonId);
    }
    return loc;
  };

  const imported: Record<string, number> = {
    relationshipTypes: 0, interactionTypes: 0, people: 0, relationships: 0,
    groups: 0, interactions: 0, notes: 0, groupNotes: 0, socialAccounts: 0,
    socialAccountTypes: 0, posts: 0, messages: 0, networkChanges: 0, photos: 0,
    lineages: 0, partnerships: 0, dailyNotes: 0, dailyNoteEvents: 0,
    dailyNoteInvolvedParties: 0, dailyNoteAuditLogs: 0, sexGuessQueue: 0,
    aiChats: 0, appSettings: 0,
  };
  const skipped: Record<string, number> = {
    relationshipTypes: 0, interactionTypes: 0, people: 0, relationships: 0,
    interactions: 0, socialAccounts: 0, socialAccountTypes: 0, messages: 0,
  };

  const progress = async (pct: number, msg: string) => {
    if (onProgress) await onProgress(pct, msg);
  };

  // ── Load existing data (parallel for speed) ────────────────────────────────

  await progress(5, "Loading existing data…");

  const [
    existingRelationshipTypes,
    existingInteractionTypes,
    existingPeople,
    existingRelationships,
    existingInteractions,
    existingSocialAccounts,
  ] = await Promise.all([
    storage.getAllRelationshipTypes(),
    storage.getAllInteractionTypes(),
    storage.getAllPeople(),
    storage.getAllRelationships(),
    storage.getAllInteractions(),
    storage.getAllSocialAccounts(),
  ]);

  const existingRelationshipTypeUuids = new Set(existingRelationshipTypes.map(t => t.id));
  const existingInteractionTypeUuids = new Set(existingInteractionTypes.map(t => t.id));
  const existingRelationshipUuids = new Set(existingRelationships.map(r => r.id));
  const existingInteractionUuids = new Set(existingInteractions.map(i => i.id));
  const existingSocialAccountUuids = new Set(existingSocialAccounts.map(s => s.id));
  const socialAccountIdMap = new Map<string, string>();

  // ── Relationship types ─────────────────────────────────────────────────────

  await progress(10, "Importing relationship types…");

  for (const block of parseAllTags("relationship_type", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const notes = unescapeXml(parseXmlTag("notes", block));
    if (existingRelationshipTypeUuids.has(id)) { skipped.relationshipTypes++; continue; }
    try {
      await db.insert(relationshipTypes).values({ id, name, color, notes: notes || null, value: 50 }).onConflictDoNothing();
      imported.relationshipTypes++;
      existingRelationshipTypeUuids.add(id);
    } catch (e) { console.error(`Error importing relationship type ${id}:`, e); }
  }

  // ── Interaction types ──────────────────────────────────────────────────────

  for (const block of parseAllTags("interaction_type", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const description = unescapeXml(parseXmlTag("description", block));
    const value = parseInt(parseXmlTag("value", block)) || 50;
    if (existingInteractionTypeUuids.has(id)) { skipped.interactionTypes++; continue; }
    try {
      await db.insert(interactionTypes).values({ id, name, color, description: description || null, value }).onConflictDoNothing();
      imported.interactionTypes++;
      existingInteractionTypeUuids.add(id);
    } catch (e) { console.error(`Error importing interaction type ${id}:`, e); }
  }

  // ── Photos (imported early so entity imageUuid references resolve) ─────────

  const photoBlocks = parseAllTags("photo_entry", xmlText);
  for (const block of photoBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const location = unescapeXml(parseXmlTag("location", block));
    const uploadedAtStr = unescapeXml(parseXmlTag("uploaded_at", block));
    const isSubImage = parseXmlTag("is_sub_image", block) === "true";
    const processedAtStr = unescapeXml(parseXmlTag("processed_at", block));
    const imageDescriptionAtStr = unescapeXml(parseXmlTag("image_description_at", block));
    const imageDescription = unescapeXml(parseXmlTag("image_description", block));
    const faceIdAtStr = unescapeXml(parseXmlTag("face_id_at", block));
    const faceUuidsStr = unescapeXml(parseXmlTag("face_uuids", block));
    const prmLocation = mapPrmLocationImport(unescapeXml(parseXmlTag("prm_location", block)));
    const metadataStr = unescapeXml(parseXmlTag("metadata", block));
    const ogMetadataStr = unescapeXml(parseXmlTag("og_metadata", block));
    const fileHash = unescapeXml(parseXmlTag("file_hash", block));
    const widthPxStr = unescapeXml(parseXmlTag("width_px", block));
    const heightPxStr = unescapeXml(parseXmlTag("height_px", block));

    try {
      await db.insert(photos).values({
        id, location,
        uploadedAt: uploadedAtStr ? new Date(uploadedAtStr) : new Date(),
        isSubImage,
        processedAt: processedAtStr ? new Date(processedAtStr) : null,
        imageDescriptionAt: imageDescriptionAtStr ? new Date(imageDescriptionAtStr) : null,
        imageDescription: imageDescription || null,
        faceIdAt: faceIdAtStr ? new Date(faceIdAtStr) : null,
        faceUuids: faceUuidsStr ? JSON.parse(faceUuidsStr) : null,
        prmLocation,
        metadata: metadataStr ? JSON.parse(metadataStr) : null,
        ogMetadata: ogMetadataStr ? JSON.parse(ogMetadataStr) : null,
        fileHash: fileHash || null,
        widthPx: widthPxStr ? parseInt(widthPxStr) : null,
        heightPx: heightPxStr ? parseInt(heightPxStr) : null,
      }).onConflictDoNothing();
      imported.photos++;
    } catch (e) {
      console.error(`Error importing photo entry ${id}:`, e);
    }
  }

  // ── People ─────────────────────────────────────────────────────────────────

  await progress(20, "Importing people…");

  const existingPeopleMap = new Map<string, boolean>();
  for (const p of existingPeople) {
    existingPeopleMap.set(`${p.firstName.toLowerCase()}:${p.id}`, true);
  }
  for (const block of parseAllTags("person", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const firstName = unescapeXml(parseXmlTag("first_name", block));
    const lastName = unescapeXml(parseXmlTag("last_name", block));
    const email = unescapeXml(parseXmlTag("email", block));
    const phone = unescapeXml(parseXmlTag("phone", block));
    const company = unescapeXml(parseXmlTag("company", block));
    const title = unescapeXml(parseXmlTag("title", block));
    const tags = parseXmlArray("tags", "tag", block);
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const socialAccountUuids = parseXmlArray("social_account_uuids", "social_account_uuid", block);
    const isStarred = parseInt(parseXmlTag("is_starred", block)) || 0;
    const eloScore = parseInt(parseXmlTag("elo_score", block)) || 1200;
    const noSocialMedia = parseInt(parseXmlTag("no_social_media", block)) || 0;
    const sex = unescapeXml(parseXmlTag("sex", block)) || "unknown";
    const eloRankable = parseXmlTag("elo_rankable", block) !== "" ? (parseInt(parseXmlTag("elo_rankable", block)) || 0) : 1;
    const lookupKey = `${firstName.toLowerCase()}:${id}`;
    if (existingPeopleMap.has(lookupKey)) { skipped.people++; continue; }
    try {
      await storage.createPersonWithId({
        id, firstName, lastName,
        email: email || null, phone: phone || null, company: company || null, title: title || null,
        tags: tags.length > 0 ? tags : [],
        imageUrl: imageUrl || null,
        socialAccountUuids: socialAccountUuids.length > 0 ? socialAccountUuids : [],
        isStarred, eloScore, noSocialMedia,
        sex, eloRankable,
      });
      imported.people++;
      existingPeopleMap.set(lookupKey, true);
    } catch (e) { console.error(`Error importing person ${id}:`, e); }
  }

  // ── Groups ─────────────────────────────────────────────────────────────────

  await progress(30, "Importing groups…");

  for (const block of parseAllTags("group", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    const type = parseXmlArray("type", "group_type", block);
    const members = parseXmlArray("members", "member_id", block);
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const processedMembers = members.map(m => replaceZeroUUID(m));
    try {
      await storage.createGroupWithId({
        id, name, color,
        type: type.length > 0 ? type : [],
        members: processedMembers.length > 0 ? processedMembers : [],
        imageUrl: imageUrl || null,
      });
      imported.groups++;
    } catch (e) { console.error(`Error importing group ${id}:`, e); }
  }

  // ── Relationships ──────────────────────────────────────────────────────────

  await progress(40, "Importing relationships & interactions…");

  for (const block of parseAllTags("relationship", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const fromPersonId = replaceZeroUUID(unescapeXml(parseXmlTag("from_person_id", block)));
    const toPersonId = replaceZeroUUID(unescapeXml(parseXmlTag("to_person_id", block)));
    const typeId = unescapeXml(parseXmlTag("type_id", block)) || null;
    const notes = unescapeXml(parseXmlTag("notes", block));
    const familyRelationshipType = unescapeXml(parseXmlTag("family_relationship_type", block)) || null;
    if (existingRelationshipUuids.has(id)) { skipped.relationships++; continue; }
    try {
      await storage.createRelationshipWithId({
        id, fromPersonId, toPersonId, typeId,
        notes: notes || null,
        familyRelationshipType: (familyRelationshipType || null) as any,
      });
      imported.relationships++;
      existingRelationshipUuids.add(id);
    } catch (e) { console.error(`Error importing relationship ${id}:`, e); }
  }

  // ── Lineages ───────────────────────────────────────────────────────────────

  const lineageBlocks = parseAllTags("lineage_entry", xmlText);
  for (const block of lineageBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const childId = replaceZeroUUID(unescapeXml(parseXmlTag("child_id", block)));
    const parentId = replaceZeroUUID(unescapeXml(parseXmlTag("parent_id", block)));
    const lineageType = unescapeXml(parseXmlTag("lineage_type", block)) || "biological";
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    try {
      await db.insert(lineage).values({
        id, childId, parentId, lineageType,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      imported.lineages++;
    } catch (e) { console.error(`Error importing lineage entry ${id}:`, e); }
  }

  // ── Partnerships ───────────────────────────────────────────────────────────

  const partnershipBlocks = parseAllTags("partnership_entry", xmlText);
  for (const block of partnershipBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const person1Id = replaceZeroUUID(unescapeXml(parseXmlTag("person1_id", block)));
    const person2Id = replaceZeroUUID(unescapeXml(parseXmlTag("person2_id", block)));
    const status = unescapeXml(parseXmlTag("status", block)) || "partner";
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    try {
      await db.insert(partnerships).values({
        id, person1Id, person2Id, status,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      imported.partnerships++;
    } catch (e) { console.error(`Error importing partnership entry ${id}:`, e); }
  }

  // ── Interactions ───────────────────────────────────────────────────────────

  for (const block of parseAllTags("interaction", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const typeId = unescapeXml(parseXmlTag("type_id", block));
    const interactionTitle = unescapeXml(parseXmlTag("title", block));
    const date = unescapeXml(parseXmlTag("date", block));
    const description = unescapeXml(parseXmlTag("description", block));
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const imageUuid = unescapeXml(parseXmlTag("image_uuid", block));
    const peopleIds = parseXmlArray("people_ids", "person_id", block);
    const groupIds = parseXmlArray("group_ids", "group_id", block);
    const processedPeopleIds = peopleIds.map(p => replaceZeroUUID(p));
    if (existingInteractionUuids.has(id)) { skipped.interactions++; continue; }
    try {
      await storage.createInteractionWithId({
        id, typeId: typeId || undefined,
        title: interactionTitle || undefined,
        date: new Date(date),
        description: description || undefined,
        peopleIds: processedPeopleIds.length > 0 ? processedPeopleIds : [],
        groupIds: groupIds.length > 0 ? groupIds : [],
        imageUrl: imageUrl || undefined,
        imageUuid: imageUuid || undefined,
      });
      imported.interactions++;
      existingInteractionUuids.add(id);
    } catch (e) { console.error(`Error importing interaction ${id}:`, e); }
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  await progress(52, "Importing notes…");

  for (const block of parseAllTags("note", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = unescapeXml(parseXmlTag("person_id", block));
    const content = unescapeXml(parseXmlTag("content", block));
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const imageUuid = unescapeXml(parseXmlTag("image_uuid", block));
    try {
      await storage.createNoteWithId({ id, personId, content, imageUrl: imageUrl || null, imageUuid: imageUuid || null });
      imported.notes++;
    } catch (e) { console.error(`Error importing note ${id}:`, e); }
  }

  for (const block of parseAllTags("group_note", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const groupId = unescapeXml(parseXmlTag("group_id", block));
    const content = unescapeXml(parseXmlTag("content", block));
    try {
      await storage.createGroupNoteWithId({ id, groupId, content });
      imported.groupNotes++;
    } catch (e) { console.error(`Error importing group note ${id}:`, e); }
  }

  // ── Social account types ───────────────────────────────────────────────────

  await progress(62, "Importing social account types…");

  const existingSocialAccountTypeUuids = new Set((await storage.getAllSocialAccountTypes()).map(t => t.id));
  for (const block of parseAllTags("social_account_type", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const name = unescapeXml(parseXmlTag("name", block));
    const color = unescapeXml(parseXmlTag("color", block));
    if (existingSocialAccountTypeUuids.has(id)) { skipped.socialAccountTypes = (skipped.socialAccountTypes || 0) + 1; continue; }
    try {
      await storage.createSocialAccountTypeWithId({ id, name, color });
      imported.socialAccountTypes = (imported.socialAccountTypes || 0) + 1;
      existingSocialAccountTypeUuids.add(id);
    } catch (e) { console.error(`Error importing social account type ${id}:`, e); }
  }

  // ── Social accounts ────────────────────────────────────────────────────────

  await progress(72, "Importing social accounts…");

  for (const block of parseAllTags("social_account", xmlText)) {
    const id = unescapeXml(parseXmlTag("id", block));
    const username = unescapeXml(parseXmlTag("username", block));
    const nickname = unescapeXml(parseXmlTag("nickname", block));
    const accountUrl = unescapeXml(parseXmlTag("account_url", block));
    const ownerUuid = unescapeXml(parseXmlTag("owner_uuid", block));
    const typeId = unescapeXml(parseXmlTag("type_id", block));
    const imageUrl = unescapeXml(parseXmlTag("image_url", block));
    const following = parseXmlArray("following", "account_id", block);
    const followers = parseXmlArray("followers", "account_id", block);
    const internalAccountCreationDateStr = unescapeXml(parseXmlTag("internal_account_creation_date", block));
    const internalAccountCreationType = unescapeXml(parseXmlTag("internal_account_creation_type", block));
    const lastScrapedAtStr = unescapeXml(parseXmlTag("last_scraped_at", block));
    const currentPosts = unescapeXml(parseXmlTag("current_posts", block)) || null;
    const deletedPosts = unescapeXml(parseXmlTag("deleted_posts", block)) || null;

    // Duplicate detection: match by UUID OR by (username + typeId)
    const existing = existingSocialAccounts.find(
      s => s.id === id || (s.username.toLowerCase() === username.toLowerCase() && s.typeId === (typeId || null))
    );
    if (existing) {
      skipped.socialAccounts++;
      socialAccountIdMap.set(id, existing.id);
      existingSocialAccountUuids.add(existing.id);
      continue;
    }

    const processedOwnerUuid = replaceZeroUUID(ownerUuid);
    try {
      const created = await storage.createSocialAccountWithId({
        id, username,
        ownerUuid: processedOwnerUuid || null,
        typeId: typeId || null,
        internalAccountCreationType: internalAccountCreationType || "Import",
        internalAccountCreationDate: internalAccountCreationDateStr ? new Date(internalAccountCreationDateStr) : undefined,
      });

      // Update extra columns using Drizzle
      await db.update(socialAccounts).set({
        lastScrapedAt: lastScrapedAtStr ? new Date(lastScrapedAtStr) : null,
        currentPosts: currentPosts || null,
        deletedPosts: deletedPosts || null,
      }).where(eq(socialAccounts.id, id));

      socialAccountIdMap.set(id, id);
      existingSocialAccountUuids.add(id);
      existingSocialAccounts.push(created);

      if (nickname || accountUrl || imageUrl) {
        if (created.currentProfile) {
          await storage.updateProfileVersion(created.currentProfile.id, {
            nickname: nickname || null, accountUrl: accountUrl || null, imageUrl: imageUrl || null,
          });
        }
      }
      if ((followers && followers.length > 0) || (following && following.length > 0)) {
        await storage.upsertNetworkState({
          socialAccountId: id,
          followerCount: followers.length,
          followingCount: following.length,
          followers, following,
        });
      }
      imported.socialAccounts++;
    } catch (e) { console.error(`Error importing social account ${id}:`, e); }
  }

  // ── Posts ───────────────────────────────────────────────────────────────────

  await progress(80, "Importing posts…");

  const existingPostIds = new Set(
    (await db.select({ id: socialAccountPosts.id }).from(socialAccountPosts)).map(p => p.id)
  );
  for (const block of parseAllTags("social_account_post", xmlText)) {
    try {
      const id = unescapeXml(parseXmlTag("id", block));
      const postSocialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      const postType = unescapeXml(parseXmlTag("post_type", block)) || "post";
      const content = unescapeXml(parseXmlTag("content", block));
      const description = unescapeXml(parseXmlTag("description", block));
      const likeCount = parseInt(parseXmlTag("like_count", block)) || 0;
      const commentCount = parseInt(parseXmlTag("comment_count", block)) || 0;
      const comments = unescapeXml(parseXmlTag("comments", block));
      const mentionedAccounts = unescapeXml(parseXmlTag("mentioned_accounts", block));
      const faceIds = unescapeXml(parseXmlTag("face_ids", block));
      const isDeleted = parseXmlTag("is_deleted", block) === "true";
      const postedAtStr = unescapeXml(parseXmlTag("posted_at", block));
      const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
      if (!id || !postSocialAccountId) continue;
      if (existingPostIds.has(id)) continue;

      const mappedAccountId = socialAccountIdMap.get(postSocialAccountId) || postSocialAccountId;
      if (!existingSocialAccountUuids.has(mappedAccountId)) continue;

      await db.insert(socialAccountPosts).values({
        id, socialAccountId: mappedAccountId, postType,
        content: content || null, description: description || null,
        likeCount, commentCount,
        comments: comments || null, mentionedAccounts: mentionedAccounts || null,
        faceIds: faceIds || null,
        isDeleted,
        postedAt: postedAtStr ? new Date(postedAtStr) : null,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      existingPostIds.add(id);
      imported.posts++;
    } catch (e) { console.error("Error importing post:", e); }
  }

  // ── Profile history ────────────────────────────────────────────────────────

  await progress(88, "Importing profile history…");

  for (const block of parseAllTags("social_profile_version", xmlText)) {
    try {
      const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
      if (!socialAccountId || !existingSocialAccountUuids.has(mappedAccountId)) continue;

      const pvNickname = unescapeXml(parseXmlTag("nickname", block));
      const pvBio = unescapeXml(parseXmlTag("bio", block));
      const pvAccountUrl = unescapeXml(parseXmlTag("account_url", block));
      const pvImageUrl = unescapeXml(parseXmlTag("image_url", block));
      const pvExternalImageUrl = unescapeXml(parseXmlTag("external_image_url", block));
      const pvIsCurrent = parseXmlTag("is_current", block) === "true";
      await storage.createProfileVersion({
        socialAccountId: mappedAccountId, nickname: pvNickname || null, bio: pvBio || null,
        accountUrl: pvAccountUrl || null, imageUrl: pvImageUrl || null,
        externalImageUrl: pvExternalImageUrl || null, isCurrent: pvIsCurrent,
      });
    } catch (e) { console.error("Error importing profile version:", e); }
  }

  // ── Network snapshots ──────────────────────────────────────────────────────

  for (const block of parseAllTags("social_network_snapshot", xmlText)) {
    try {
      const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
      if (!socialAccountId || !existingSocialAccountUuids.has(mappedAccountId)) continue;

      const followerCount = parseInt(parseXmlTag("follower_count", block)) || 0;
      const followingCount = parseInt(parseXmlTag("following_count", block)) || 0;
      const snFollowers = parseXmlArray("followers", "account_id", block);
      const snFollowing = parseXmlArray("following", "account_id", block);
      await storage.upsertNetworkState({ socialAccountId: mappedAccountId, followerCount, followingCount, followers: snFollowers, following: snFollowing });
    } catch (e) { console.error("Error importing network snapshot:", e); }
  }

  // ── Network changes ────────────────────────────────────────────────────────

  await progress(94, "Importing network changes…");

  for (const block of parseAllTags("social_network_change", xmlText)) {
    try {
      const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
      const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
      if (!socialAccountId || !existingSocialAccountUuids.has(mappedAccountId)) continue;

      const changeType = unescapeXml(parseXmlTag("change_type", block));
      const direction = unescapeXml(parseXmlTag("direction", block));
      const targetAccountId = unescapeXml(parseXmlTag("target_account_id", block));
      const detectedAtStr = unescapeXml(parseXmlTag("detected_at", block));
      const batchId = unescapeXml(parseXmlTag("batch_id", block));
      if (!changeType || !direction || !targetAccountId) continue;
      await db.insert(socialNetworkChanges).values({
        socialAccountId: mappedAccountId, changeType, direction, targetAccountId,
        detectedAt: detectedAtStr ? new Date(detectedAtStr) : new Date(),
        batchId: batchId || null,
      });
      imported.networkChanges = (imported.networkChanges || 0) + 1;
    } catch (e) { console.error("Error importing network change:", e); }
  }

  // ── Daily notes ────────────────────────────────────────────────────────────

  const dailyNoteBlocks = parseAllTags("daily_note_entry", xmlText);
  for (const block of dailyNoteBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const date = unescapeXml(parseXmlTag("date", block));
    const userTitle = unescapeXml(parseXmlTag("user_title", block));
    const body = unescapeXml(parseXmlTag("body", block));
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    const updatedAtStr = unescapeXml(parseXmlTag("updated_at", block));
    try {
      await db.insert(dailyNotes).values({
        id, date, userTitle, body,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
        updatedAt: updatedAtStr ? new Date(updatedAtStr) : null,
      }).onConflictDoNothing();
      imported.dailyNotes++;
    } catch (e) { console.error(`Error importing daily note ${id}:`, e); }
  }

  // ── Daily note events ──────────────────────────────────────────────────────

  const dailyNoteEventBlocks = parseAllTags("daily_note_event_entry", xmlText);
  for (const block of dailyNoteEventBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    const text = unescapeXml(parseXmlTag("text", block));
    const position = parseInt(parseXmlTag("position", block)) || 0;
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    try {
      await db.insert(dailyNoteEvents).values({
        id, dailyNoteId, text, position,
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
      }).onConflictDoNothing();
      imported.dailyNoteEvents++;
    } catch (e) { console.error(`Error importing daily note event ${id}:`, e); }
  }

  // ── Daily note involved parties ────────────────────────────────────────────

  const involvedPartyBlocks = parseAllTags("daily_note_involved_party_entry", xmlText);
  for (const block of involvedPartyBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    const partyType = unescapeXml(parseXmlTag("party_type", block));
    let refId = unescapeXml(parseXmlTag("ref_id", block));
    if (partyType === "person") {
      refId = replaceZeroUUID(refId);
    }
    try {
      await db.insert(dailyNoteInvolvedParties).values({
        id, dailyNoteId, partyType, refId,
      }).onConflictDoNothing();
      imported.dailyNoteInvolvedParties++;
    } catch (e) { console.error(`Error importing daily note involved party ${id}:`, e); }
  }

  // ── Daily note audit logs ──────────────────────────────────────────────────

  const auditLogBlocks = parseAllTags("daily_note_audit_log_entry", xmlText);
  for (const block of auditLogBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const dailyNoteId = unescapeXml(parseXmlTag("daily_note_id", block));
    const action = unescapeXml(parseXmlTag("action", block));
    const timestampStr = unescapeXml(parseXmlTag("timestamp", block));
    const pinUsed = parseXmlTag("pin_used", block) === "true";
    try {
      await db.insert(dailyNoteAuditLogs).values({
        id, dailyNoteId, action,
        timestamp: timestampStr ? new Date(timestampStr) : new Date(),
        pinUsed,
      }).onConflictDoNothing();
      imported.dailyNoteAuditLogs++;
    } catch (e) { console.error(`Error importing daily note audit log ${id}:`, e); }
  }

  // ── Sex guess records ──────────────────────────────────────────────────────

  const sexGuessBlocks = parseAllTags("sex_guess_entry", xmlText);
  for (const block of sexGuessBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const personId = replaceZeroUUID(unescapeXml(parseXmlTag("person_id", block)));
    const guessedSex = unescapeXml(parseXmlTag("guessed_sex", block));
    const reasoning = unescapeXml(parseXmlTag("reasoning", block));
    const dateAddedStr = unescapeXml(parseXmlTag("date_added", block));
    const answered = parseInt(parseXmlTag("answered", block)) || 0;
    const snoozeUntilStr = unescapeXml(parseXmlTag("snooze_until", block));
    try {
      await db.insert(sexGuessQueue).values({
        id, personId, guessedSex, reasoning,
        dateAdded: dateAddedStr ? new Date(dateAddedStr) : new Date(),
        answered,
        snoozedUntil: snoozeUntilStr ? new Date(snoozeUntilStr) : null,
      }).onConflictDoNothing();
      imported.sexGuessQueue++;
    } catch (e) { console.error(`Error importing sex guess entry ${id}:`, e); }
  }

  // ── AI chats ───────────────────────────────────────────────────────────────

  const aiChatBlocks = parseAllTags("ai_chat_entry", xmlText);
  for (const block of aiChatBlocks) {
    const id = unescapeXml(parseXmlTag("id", block));
    const title = unescapeXml(parseXmlTag("title", block)) || "New chat";
    const systemMessage = unescapeXml(parseXmlTag("system_message", block));
    const model = unescapeXml(parseXmlTag("model", block));
    const messagesStr = unescapeXml(parseXmlTag("messages", block));
    const createdAtStr = unescapeXml(parseXmlTag("created_at", block));
    const updatedAtStr = unescapeXml(parseXmlTag("updated_at", block));
    try {
      await db.insert(aiChats).values({
        id, userId, title, systemMessage, model,
        messages: messagesStr ? JSON.parse(messagesStr) : [],
        createdAt: createdAtStr ? new Date(createdAtStr) : new Date(),
        updatedAt: updatedAtStr ? new Date(updatedAtStr) : new Date(),
      }).onConflictDoNothing();
      imported.aiChats++;
    } catch (e) { console.error(`Error importing AI chat ${id}:`, e); }
  }

  // ── App settings ───────────────────────────────────────────────────────────

  const appSettingBlocks = parseAllTags("app_setting_entry", xmlText);
  for (const block of appSettingBlocks) {
    const key = unescapeXml(parseXmlTag("key", block));
    const value = unescapeXml(parseXmlTag("value", block));
    if (!key) continue;
    try {
      await db.insert(appSettings).values({ key, value })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value }
        });
      imported.appSettings++;
    } catch (e) { console.error(`Error importing app setting ${key}:`, e); }
  }

  await progress(99, "Finalizing…");

  return { imported, skipped };
}
