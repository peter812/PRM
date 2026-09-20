/**
 * Standalone migration script: Relocate existing images from flat images/ to
 * dedicated folder prefixes (stories/, posts/, profiles/).
 *
 * Usage:
 *   npx tsx scripts/migrate-image-prefixes.ts           # Execute migration
 *   npx tsx scripts/migrate-image-prefixes.ts --dry-run # Preview actions without modifying
 */

import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { getPrmS3Client } from "../server/prm-s3";

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`\n=== PRM Image Prefix Migration ${isDryRun ? "(DRY RUN)" : ""} ===\n`);

  const { client: s3Client, bucket } = await getPrmS3Client();

  // Find all images currently stored under images/ prefix
  const queryResult = await db.execute(sql`
    SELECT 
      p.id, 
      p.location, 
      p.prm_location as "prmLocation", 
      p.og_metadata as "ogMetadata",
      sap.post_type as "postType"
    FROM photos p
    LEFT JOIN social_account_posts sap ON p.prm_location = 'post:' || sap.id
    WHERE p.location LIKE '/api/prm-s3/images/%' 
       OR p.location LIKE 'images/%'
  `);

  const items = queryResult.rows as any[];
  console.log(`Found ${items.length} total photo records under images/ prefix.`);

  if (items.length === 0) {
    console.log("No images to migrate. Everything is already in dedicated folders!");
    process.exit(0);
  }

  const breakdown = { stories: 0, posts: 0, profiles: 0, generic_kept: 0 };
  const toProcess: { item: any; targetPrefix: string; oldKey: string; newKey: string; oldLocation: string; newLocation: string }[] = [];

  for (const item of items) {
    const oldLocation: string = item.location;
    const oldKey = oldLocation.startsWith("/api/prm-s3/")
      ? oldLocation.substring("/api/prm-s3/".length)
      : oldLocation;

    let targetPrefix = "";
    if (item.postType === "story" || item.ogMetadata?.source === "instagram-story") {
      targetPrefix = "stories/";
      breakdown.stories++;
    } else if (item.postType === "post" || item.postType === "video" || item.postType === "carousel" || item.ogMetadata?.source === "instagram-post") {
      targetPrefix = "posts/";
      breakdown.posts++;
    } else if (item.prmLocation?.startsWith("profile_image:") || item.prmLocation?.startsWith("social_profile_image:")) {
      targetPrefix = "profiles/";
      breakdown.profiles++;
    } else {
      breakdown.generic_kept++;
      continue;
    }

    const filename = oldKey.substring("images/".length);
    const newKey = targetPrefix + filename;
    const newLocation = oldLocation.replace("images/" + filename, newKey);

    toProcess.push({ item, targetPrefix, oldKey, newKey, oldLocation, newLocation });
  }

  console.log("\nCategorization breakdown:");
  console.log(`  - Stories (-> stories/):   ${breakdown.stories}`);
  console.log(`  - Posts   (-> posts/):     ${breakdown.posts}`);
  console.log(`  - Profiles(-> profiles/):  ${breakdown.profiles}`);
  console.log(`  - Generic (stays images/): ${breakdown.generic_kept}`);
  console.log(`  - Total to relocate:       ${toProcess.length}\n`);

  if (isDryRun) {
    console.log("Sample migrations that would be performed (first 5):");
    for (const sample of toProcess.slice(0, 5)) {
      console.log(`  [${sample.targetPrefix.toUpperCase()}] ${sample.oldKey} -> ${sample.newKey}`);
    }
    console.log("\n[DRY RUN] No changes were made to storage or database.\n");
    process.exit(0);
  }

  let completed = 0;
  let successCount = 0;
  let failCount = 0;

  // Run with concurrency 4
  const concurrency = 4;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < toProcess.length) {
      const idx = nextIdx++;
      const { item, targetPrefix, oldKey, newKey, oldLocation, newLocation } = toProcess[idx];

      try {
        // 1. Copy original object to new prefix (PRM-s3 bakes the new folder's WebP proxies on write)
        await s3Client.send(new CopyObjectCommand({
          Bucket: bucket,
          CopySource: bucket + "/" + oldKey,
          Key: newKey,
        }));

        // 2. Atomically update DB references
        await db.transaction(async (tx) => {
          await tx.execute(sql`UPDATE photos SET location = ${newLocation} WHERE id = ${item.id}`);
          await tx.execute(sql`
            UPDATE social_account_posts 
            SET content = REPLACE(content, ${oldLocation}, ${newLocation})
            WHERE content LIKE ${'%' + oldLocation + '%'}
          `);
          await tx.execute(sql`UPDATE social_accounts SET image_url = ${newLocation} WHERE image_url = ${oldLocation}`);
          await tx.execute(sql`UPDATE social_account_history SET previous_image_url = ${newLocation} WHERE previous_image_url = ${oldLocation}`);
          await tx.execute(sql`UPDATE people SET image_url = ${newLocation} WHERE image_url = ${oldLocation}`);
          await tx.execute(sql`UPDATE social_profile_versions SET image_url = ${newLocation} WHERE image_url = ${oldLocation}`);
        });

        // 3. Delete old object from images/ (cleans up old key and any old proxies)
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: oldKey,
        }));

        successCount++;
      } catch (err: any) {
        failCount++;
        console.error(`Failed to migrate ${oldKey}:`, err?.message || err);
      }

      completed++;
      if (completed % 20 === 0 || completed === toProcess.length) {
        process.stdout.write(`Progress: ${completed}/${toProcess.length} (${Math.round((completed / toProcess.length) * 100)}%)\r`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log(`\n\nMigration finished!`);
  console.log(`  - Successfully relocated: ${successCount}`);
  console.log(`  - Failed:                 ${failCount}`);
  console.log(`  - Generic kept in images/:${breakdown.generic_kept}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
