import { storage } from "./storage";
import { syncEntityInBackground } from "./vector-universal";

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
  const allPeople = await storage.getAllPeople();
  const peopleWithoutImages = allPeople.filter(p => !p.imageUrl);

  let updated = 0;
  let skipped = 0;
  let noSocialAccount = 0;
  const updates: { personId: string; personName: string; imageUrl: string }[] = [];

  for (const person of peopleWithoutImages) {
    const socialUuids = person.socialAccountUuids || [];
    if (socialUuids.length === 0) {
      noSocialAccount++;
      continue;
    }

    let foundImage: string | null = null;
    for (const uuid of socialUuids) {
      const account = await storage.getSocialAccountById(uuid);
      if (account?.currentProfile?.imageUrl) {
        foundImage = account.currentProfile.imageUrl;
        break;
      }
    }

    if (foundImage) {
      await storage.updatePerson(person.id, { imageUrl: foundImage });
      syncEntityInBackground("person", person.id);
      updates.push({
        personId: person.id,
        personName: `${person.firstName} ${person.lastName}`.trim(),
        imageUrl: foundImage,
      });
      updated++;
    } else {
      skipped++;
    }
  }

  return {
    totalPeopleWithoutImages: peopleWithoutImages.length,
    updated,
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
  for (const uuid of socialUuids) {
    const account = await storage.getSocialAccountById(uuid);
    if (account?.currentProfile?.imageUrl) {
      await storage.updatePerson(personId, { imageUrl: account.currentProfile.imageUrl });
      syncEntityInBackground("person", personId);
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
      syncEntityInBackground("person", person.id);
      return true;
    }
  }

  // 2. Also search all people whose socialAccountUuids includes this socialAccountId (in case ownerUuid isn't set yet)
  const allPeople = await storage.getAllPeople();
  let updatedAny = false;
  for (const person of allPeople) {
    if (!person.imageUrl && (person.socialAccountUuids || []).includes(socialAccountId)) {
      await storage.updatePerson(person.id, { imageUrl });
      syncEntityInBackground("person", person.id);
      updatedAny = true;
    }
  }

  return updatedAny;
}
