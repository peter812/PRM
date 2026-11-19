import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { people, socialAccounts } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";

const UPDATE_CONCURRENCY = 5;

interface ImagePassInResult {
  totalPeopleWithoutImages: number;
  updated: number;
  skipped: number;
  noSocialAccount: number;
  updates: { personId: string; personName: string; imageUrl: string }[];
}

/**
 * Automatically propagates profile images from social accounts to linked person accounts that do not have an image.
 */
export async function runAutomaticImagePassIn(): Promise<ImagePassInResult> {
  const peopleWithoutImages = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      socialAccountUuids: people.socialAccountUuids,
    })
    .from(people)
    .where(or(isNull(people.imageUrl), eq(people.imageUrl, "")));

  if (peopleWithoutImages.length === 0) {
    return {
      totalPeopleWithoutImages: 0,
      updated: 0,
      skipped: 0,
      noSocialAccount: 0,
      updates: [],
    };
  }

  const accountRows = await db
    .select({
      id: socialAccounts.id,
      ownerUuid: socialAccounts.ownerUuid,
      imageUrl: socialAccounts.imageUrl,
    })
    .from(socialAccounts)
    .where(and(isNotNull(socialAccounts.imageUrl), ne(socialAccounts.imageUrl, "")));

  const accountById = new Map(accountRows.map(row => [row.id, row]));
  const imageByOwnerUuid = new Map<string, string>();
  for (const row of accountRows) {
    if (row.ownerUuid && row.imageUrl && !imageByOwnerUuid.has(row.ownerUuid)) {
      imageByOwnerUuid.set(row.ownerUuid, row.imageUrl);
    }
  }

  let skipped = 0;
  let noSocialAccount = 0;
  const updates: { personId: string; personName: string; imageUrl: string }[] = [];

  for (const person of peopleWithoutImages) {
    const socialUuids = person.socialAccountUuids || [];
    if (socialUuids.length === 0 && !imageByOwnerUuid.has(person.id)) {
      noSocialAccount++;
      continue;
    }

    let foundImage: string | null = null;
    for (const uuid of socialUuids) {
      const account = accountById.get(uuid);
      if (account?.imageUrl) {
        foundImage = account.imageUrl;
        break;
      }
    }
    if (!foundImage) {
      foundImage = imageByOwnerUuid.get(person.id) ?? null;
    }

    if (foundImage) {
      updates.push({
        personId: person.id,
        personName: `${person.firstName} ${person.lastName}`.trim(),
        imageUrl: foundImage,
      });
    } else {
      skipped++;
    }
  }

  for (let i = 0; i < updates.length; i += UPDATE_CONCURRENCY) {
    const batch = updates.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      batch.map(u => storage.updatePerson(u.personId, { imageUrl: u.imageUrl })),
    );
  }

  return {
    totalPeopleWithoutImages: peopleWithoutImages.length,
    updated: updates.length,
    skipped,
    noSocialAccount,
    updates,
  };
}

/**
 * Checks a specific person. If they don't have an image, attempts to pull it from their linked social accounts.
 */
export async function autoPassInImageForPerson(personId: string): Promise<boolean> {
  const person = await storage.getPersonById(personId);
  if (!person || person.imageUrl) return false;

  const socialUuids = person.socialAccountUuids || [];
  if (socialUuids.length === 0) return false;

  const rows = await db
    .select({ id: socialAccounts.id, imageUrl: socialAccounts.imageUrl })
    .from(socialAccounts)
    .where(inArray(socialAccounts.id, socialUuids));
  const imageById = new Map(rows.map(r => [r.id, r.imageUrl]));

  for (const uuid of socialUuids) {
    const imageUrl = imageById.get(uuid);
    if (imageUrl) {
      await storage.updatePerson(personId, { imageUrl });
      return true;
    }
  }
  return false;
}

/**
 * Checks if any person is linked to the given social account and doesn't have an image.
 * If so, propagates the social account's current image to them.
 */
export async function autoPassInImageForSocialAccount(socialAccountId: string): Promise<boolean> {
  const account = await storage.getSocialAccountById(socialAccountId);
  if (!account || !account.currentProfile?.imageUrl) return false;

  const imageUrl = account.currentProfile.imageUrl;

  // 1. Check if the social account has an ownerUuid set
  if (account.ownerUuid) {
    const person = await storage.getPersonById(account.ownerUuid);
    if (person && !person.imageUrl) {
      await storage.updatePerson(person.id, { imageUrl });
      return true;
    }
  }

  // 2. Also search all people whose socialAccountUuids includes this socialAccountId (in case ownerUuid isn't set yet)
  const allPeople = await storage.getAllPeople();
  let updatedAny = false;
  for (const person of allPeople) {
    if (!person.imageUrl && (person.socialAccountUuids || []).includes(socialAccountId)) {
      await storage.updatePerson(person.id, { imageUrl });
      updatedAny = true;
    }
  }

  return updatedAny;
}
