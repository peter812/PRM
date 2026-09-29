/**
 * repair-face-groups.ts — One-time fix for faces whose personface_uuid was
 * overwritten with a social_accounts.id by the syncCompute bug.
 *
 * Run:  npx tsx scripts/repair-face-groups.ts [--dry-run]
 *
 * What it does:
 * 1. Finds faces where faces.personface_uuid = social_accounts.id
 *    (the account row ID, not a proper group UUID).
 * 2. For each such account, looks up social_accounts.personface_uuid
 *    (the correct group UUID).
 * 3. Re-points those faces to the correct group.
 * 4. Refreshes photos.facial_ids for affected photos.
 */
import { db } from "../server/db";
import { faces, socialAccounts, photos, people } from "@shared/schema";
import { eq, sql, inArray } from "drizzle-orm";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "[DRY RUN] No writes will be made.\n" : "");

  // Find faces whose personface_uuid matches a social_accounts.id
  // and that account has a *different* personface_uuid (the correct group).
  const corrupted = await db.execute(sql`
    SELECT f.id AS face_id,
           f.personface_uuid AS bad_group,
           sa.id AS account_id,
           sa.personface_uuid AS correct_group
    FROM faces f
    JOIN social_accounts sa ON sa.id = f.personface_uuid
    WHERE sa.personface_uuid IS NOT NULL
      AND sa.personface_uuid <> f.personface_uuid
  `);

  const rows = (corrupted as unknown as { rows: { face_id: string; bad_group: string; account_id: string; correct_group: string }[] }).rows;

  if (!rows.length) {
    console.log("No corrupted face rows found. Nothing to do.");
    process.exit(0);
  }

  console.log(`Found ${rows.length} corrupted face(s):\n`);
  for (const r of rows) {
    console.log(`  face ${r.face_id}`);
    console.log(`    bad group:     ${r.bad_group} (= account ${r.account_id})`);
    console.log(`    correct group: ${r.correct_group}`);
  }

  if (dryRun) {
    console.log("\n[DRY RUN] Would fix the above. Run without --dry-run to apply.");
    process.exit(0);
  }

  // Group by bad_group -> correct_group for batch updates
  const fixes = new Map<string, string>();
  for (const r of rows) fixes.set(r.bad_group, r.correct_group);

  let totalFixed = 0;
  const affectedPhotoIds = new Set<string>();

  for (const [badGroup, correctGroup] of fixes) {
    // Find all faces in the bad group (there may be more than just the ones
    // joined above if multiple faces share the same corrupted group).
    const affected = await db
      .select({ id: faces.id, photoId: faces.photoId })
      .from(faces)
      .where(eq(faces.personfaceUuid, badGroup));

    await db
      .update(faces)
      .set({ personfaceUuid: correctGroup })
      .where(eq(faces.personfaceUuid, badGroup));

    for (const f of affected) {
      if (f.photoId) affectedPhotoIds.add(f.photoId);
    }
    const faceIds = affected.map((a) => a.id);
    if (faceIds.length) {
      const extraPhotos = await db.execute(sql`
        SELECT p.id
        FROM photos p,
             jsonb_array_elements(COALESCE(p.facial_ids, '[]'::jsonb)) elem
        WHERE elem->>'faceUuid' = ANY(${faceIds})
      `);
      for (const row of extraPhotos.rows as { id: string }[]) {
        affectedPhotoIds.add(row.id);
      }
    }
    totalFixed += affected.length;
    console.log(`\n  Moved ${affected.length} face(s) from ${badGroup} -> ${correctGroup}`);
  }

  // Refresh facial_ids on affected photos so the embedded personId/socialAccountId
  // entries pick up the corrected groups.
  if (affectedPhotoIds.size) {
    const photoIds = Array.from(affectedPhotoIds);
    console.log(`\nRefreshing facial_ids on ${photoIds.length} photo(s)...`);

    for (const photoId of photoIds) {
      const [photo] = await db.select({ id: photos.id, facialIds: photos.facialIds }).from(photos).where(eq(photos.id, photoId));
      if (!photo?.facialIds) continue;

      const entries = photo.facialIds as { faceUuid?: string; personId?: string | null; socialAccountId?: string | null; [k: string]: unknown }[];
      const faceUuids = entries.map((e) => e.faceUuid).filter((u): u is string => !!u);
      if (!faceUuids.length) continue;

      const faceRows = await db
        .select({ id: faces.id, personfaceUuid: faces.personfaceUuid })
        .from(faces)
        .where(inArray(faces.id, faceUuids));
      const groupOf = new Map(faceRows.map((r) => [r.id, r.personfaceUuid]));

      const groups = Array.from(new Set(faceRows.map((r) => r.personfaceUuid).filter((g): g is string => !!g)));
      const [saRows, personRows] = await Promise.all([
        groups.length
          ? db.select({ id: socialAccounts.id, ownerUuid: socialAccounts.ownerUuid, personfaceUuid: socialAccounts.personfaceUuid }).from(socialAccounts).where(inArray(socialAccounts.personfaceUuid, groups))
          : [],
        groups.length
          ? db.select({ id: people.id, personfaceUuid: people.personfaceUuid }).from(people).where(inArray(people.personfaceUuid, groups))
          : [],
      ]);
      const accountOf = new Map<string, { id: string; ownerUuid: string | null }>();
      for (const r of saRows) if (r.personfaceUuid && !accountOf.has(r.personfaceUuid)) accountOf.set(r.personfaceUuid, r);
      const personOf = new Map<string, string>();
      for (const r of personRows) if (r.personfaceUuid && !personOf.has(r.personfaceUuid)) personOf.set(r.personfaceUuid, r.id);

      let changed = false;
      const next = entries.map((f) => {
        if (!f.faceUuid || !groupOf.has(f.faceUuid)) return f;
        const group = groupOf.get(f.faceUuid);
        const account = group ? accountOf.get(group) : undefined;
        const personId = (group && personOf.get(group)) || account?.ownerUuid || null;
        const socialAccountId = account?.id ?? null;
        if (personId === f.personId && socialAccountId === f.socialAccountId) return f;
        changed = true;
        return { ...f, personId, socialAccountId };
      });
      if (changed) {
        await db.update(photos).set({ facialIds: next }).where(eq(photos.id, photoId));
      }
    }
  }

  console.log(`\nDone. Fixed ${totalFixed} face(s) across ${affectedPhotoIds.size} photo(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
