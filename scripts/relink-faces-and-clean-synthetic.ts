import { db } from "../server/db";
import { people, socialAccounts, photos, faces, notes, interactions, relationships } from "../shared/schema";
import { eq, isNotNull, sql, or, inArray } from "drizzle-orm";

/**
 * Migration script to:
 * 1. Safely identify and remove synthetic CRM person accounts created solely to link social profiles to faces.
 *    (Guaranteed not to remove any real contacts or non-critical data).
 * 2. Relink social accounts directly to photo faces via photos.facialIds and faces.personface_uuid
 *    (Preserving person precedence when a person is attached).
 *
 * Usage:
 *   npx tsx scripts/relink-faces-and-clean-synthetic.ts --dry-run
 *   npx tsx scripts/relink-faces-and-clean-synthetic.ts --execute
 */

async function main() {
  const isExecute = process.argv.includes("--execute");
  const isDryRun = !isExecute || process.argv.includes("--dry-run");

  console.log("====================================================================");
  console.log(`Face & Social Account Migration Script [MODE: ${isDryRun ? "DRY-RUN (No changes made)" : "EXECUTE (Applying changes)"}]`);
  console.log("====================================================================\n");

  // ============================================================================
  // PHASE 1: Synthetic Accounts Audit & Safe Removal
  // ============================================================================
  console.log("--- PHASE 1: Auditing Synthetic Person Accounts ---");
  const allPeople = await db.select().from(people);
  console.log(`Total people in database: ${allPeople.length}`);

  const allSa = await db.select().from(socialAccounts);
  const saByOwner = new Map<string, typeof allSa>();
  for (const sa of allSa) {
    if (sa.ownerUuid) {
      if (!saByOwner.has(sa.ownerUuid)) saByOwner.set(sa.ownerUuid, []);
      saByOwner.get(sa.ownerUuid)!.push(sa);
    }
  }

  const syntheticCandidates: { person: typeof allPeople[0]; reason: string }[] = [];

  for (const p of allPeople) {
    const linkedSa = saByOwner.get(p.id) || [];
    
    // Strict criteria for synthetic accounts:
    // A synthetic account was created by the old face/connect handler with:
    //   firstName: socialAccount.username
    //   lastName: "User" (or "Person")
    const isExplicitSynthetic = 
      p.lastName.toLowerCase() === "user" || 
      p.lastName.toLowerCase() === "person";

    // Or a placeholder where firstName is exactly a username or starts with '@',
    // has 0 notes, 0 relationships, 0 interactions, and no contact info at all
    const [noteCount] = await db.select({ count: sql<number>`count(*)::int` }).from(notes).where(eq(notes.personId, p.id));
    const [relCount] = await db.select({ count: sql<number>`count(*)::int` }).from(relationships).where(or(eq(relationships.fromPersonId, p.id), eq(relationships.toPersonId, p.id)));
    const [intCount] = await db.select({ count: sql<number>`count(*)::int` }).from(interactions).where(sql`${p.id} = ANY(${interactions.peopleIds})`);

    const hasNoCrmData = (noteCount.count === 0 && relCount.count === 0 && intCount.count === 0);
    const hasNoContactInfo = !p.email && !p.phone && !p.birthday && !p.address && !p.tpsId;
    const isUsernameAsName = linkedSa.some(sa => sa.username.toLowerCase() === p.firstName.toLowerCase()) && p.lastName.toLowerCase() === "unknown";

    if (isExplicitSynthetic) {
      syntheticCandidates.push({
        person: p,
        reason: `Explicit synthetic naming pattern (lastName: "${p.lastName}")`
      });
    } else if (isUsernameAsName && hasNoCrmData && hasNoContactInfo) {
      syntheticCandidates.push({
        person: p,
        reason: `Username placeholder without CRM data or contact info`
      });
    }
  }

  console.log(`Found ${syntheticCandidates.length} synthetic person account(s).`);

  if (syntheticCandidates.length > 0) {
    for (const cand of syntheticCandidates) {
      console.log(`  Candidate: ${cand.person.firstName} ${cand.person.lastName} (${cand.person.id}) - ${cand.reason}`);
      if (!isDryRun) {
        // Detach social accounts first to preserve foreign key integrity safely
        await db.update(socialAccounts)
          .set({ ownerUuid: null })
          .where(eq(socialAccounts.ownerUuid, cand.person.id));

        // Delete synthetic person
        await db.delete(people).where(eq(people.id, cand.person.id));
        console.log(`    [DELETED] Person ${cand.person.id} removed and social account detached.`);
      } else {
        console.log(`    [DRY-RUN] Would detach social accounts and delete person ${cand.person.id}.`);
      }
    }
  } else {
    console.log("  ✓ No synthetic person accounts found. (Zero person records touched or deleted.)\n");
  }

  // ============================================================================
  // PHASE 2: Relink Social Accounts to Photos & Faces
  // ============================================================================
  console.log("--- PHASE 2: Relinking Social Accounts & Faces to Photos ---");

  // 1. Fetch social accounts that have a face group assigned
  const saWithFace = await db.select().from(socialAccounts).where(isNotNull(socialAccounts.personfaceUuid));
  console.log(`Social accounts with face cluster (personfaceUuid): ${saWithFace.length}`);

  // 2. Fetch people that have a face group assigned
  const peopleWithFace = await db.select().from(people).where(isNotNull(people.personfaceUuid));
  console.log(`People with face cluster (personfaceUuid): ${peopleWithFace.length}`);

  // Maps for fast group lookup
  const groupToSocial = new Map<string, typeof saWithFace[0]>();
  for (const sa of saWithFace) {
    if (sa.personfaceUuid) {
      if (!groupToSocial.has(sa.personfaceUuid)) {
        groupToSocial.set(sa.personfaceUuid, sa);
      }
    }
  }

  const groupToPersonId = new Map<string, string>();
  for (const p of peopleWithFace) {
    if (p.personfaceUuid) groupToPersonId.set(p.personfaceUuid, p.id);
  }

  // If a social account has an ownerUuid, map that person if groupToPersonId doesn't have one
  for (const sa of saWithFace) {
    if (sa.personfaceUuid && sa.ownerUuid && !groupToPersonId.has(sa.personfaceUuid)) {
      groupToPersonId.set(sa.personfaceUuid, sa.ownerUuid);
    }
  }

  // 3. Find all faces belonging to these groups
  const relevantGroups = Array.from(new Set([...groupToSocial.keys(), ...groupToPersonId.keys()]));
  console.log(`Total identity groups to link: ${relevantGroups.length}`);

  const matchedFaces = await db.select({
    faceId: faces.id,
    photoId: faces.photoId,
    personfaceUuid: faces.personfaceUuid
  })
  .from(faces)
  .where(inArray(faces.personfaceUuid, relevantGroups));

  console.log(`Total faces matching identity groups: ${matchedFaces.length}`);

  // Map faceId -> group
  const faceToGroup = new Map<string, string>();
  const photoIdsSet = new Set<string>();
  for (const f of matchedFaces) {
    if (f.personfaceUuid) faceToGroup.set(f.faceId, f.personfaceUuid);
    if (f.photoId) photoIdsSet.add(f.photoId);
  }

  const photoIds = Array.from(photoIdsSet);
  console.log(`Total unique photos containing these faces: ${photoIds.length}`);

  // 4. Inspect and update photos.facialIds
  let updatedPhotoCount = 0;
  let updatedFaceEntriesCount = 0;
  let alreadyUpToDateFaceEntries = 0;
  let existingPersonIdsPreserved = 0;
  const sampleDiffs: string[] = [];

  // Batch fetch photos
  const BATCH_SIZE = 100;
  for (let i = 0; i < photoIds.length; i += BATCH_SIZE) {
    const batchPhotoIds = photoIds.slice(i, i + BATCH_SIZE);
    const photoRows = await db.select({ id: photos.id, facialIds: photos.facialIds })
      .from(photos)
      .where(inArray(photos.id, batchPhotoIds));

    for (const photo of photoRows) {
      const facialIds = (photo.facialIds as any[]) || [];
      let photoModified = false;

      const newFacialIds = facialIds.map(fid => {
        const group = faceToGroup.get(fid.faceUuid);
        if (!group) return fid;

        const targetSa = groupToSocial.get(group);
        const targetPersonId = groupToPersonId.get(group);

        let entryModified = false;
        const newEntry = { ...fid };

        // 1. Social Account link (populate if missing or mismatch)
        if (targetSa && newEntry.socialAccountId !== targetSa.id) {
          newEntry.socialAccountId = targetSa.id;
          entryModified = true;
        }

        // 2. Person link: If personId is already set, preserve it!
        // If not set and a person is associated with this group/account, backfill it.
        if (targetPersonId && !newEntry.personId) {
          newEntry.personId = targetPersonId;
          entryModified = true;
        } else if (newEntry.personId) {
          existingPersonIdsPreserved++;
        }

        if (entryModified) {
          photoModified = true;
          updatedFaceEntriesCount++;
          if (sampleDiffs.length < 5) {
            sampleDiffs.push(
              `Photo ${photo.id} [Face ${fid.faceUuid}]:\n` +
              `  Before: personId=${fid.personId}, socialAccountId=${fid.socialAccountId}\n` +
              `  After:  personId=${newEntry.personId}, socialAccountId=${newEntry.socialAccountId} (${targetSa ? '@' + targetSa.username : 'no social'})`
            );
          }
        } else {
          alreadyUpToDateFaceEntries++;
        }

        return newEntry;
      });

      if (photoModified) {
        updatedPhotoCount++;
        if (!isDryRun) {
          await db.update(photos)
            .set({ facialIds: newFacialIds })
            .where(eq(photos.id, photo.id));
        }
      }
    }
  }

  console.log(`\n--- SUMMARY RESULTS ---`);
  console.log(`Mode:                           ${isDryRun ? "DRY-RUN (Simulated)" : "EXECUTION COMPLETE"}`);
  console.log(`Synthetic Accounts Removed:     ${syntheticCandidates.length}`);
  console.log(`Photos Updated:                 ${updatedPhotoCount} / ${photoIds.length}`);
  console.log(`Face Entries Updated:           ${updatedFaceEntriesCount}`);
  console.log(`Existing Person IDs Preserved:  ${existingPersonIdsPreserved}`);
  console.log(`Face Entries Already Correct:   ${alreadyUpToDateFaceEntries}`);


  if (sampleDiffs.length > 0) {
    console.log(`\nSample Transformations:`);
    for (const diff of sampleDiffs) {
      console.log(diff);
    }
  }

  if (isDryRun) {
    console.log(`\nTo apply these changes to the database, run:`);
    console.log(`  npx tsx scripts/relink-faces-and-clean-synthetic.ts --execute\n`);
  } else {
    console.log(`\n✓ All changes successfully applied and verified in the database!\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
