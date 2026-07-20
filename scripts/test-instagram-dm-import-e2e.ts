// End-to-end test of the Instagram backup import task against the real database.
// Run: npx tsx scripts/test-instagram-dm-import-e2e.ts <backup.zip> <rootUsername>
//
// Runs the import twice: the second pass must skip every thread via the hash.

import fs from "fs";
import path from "path";
import os from "os";
import { db } from "../server/db";
import { users } from "@shared/schema";
import { storage } from "../server/storage";
import { processImportInstagramBackup } from "../server/task-worker";

async function resolveRootAccount(username: string): Promise<string> {
  const all = await storage.getAllSocialAccounts();
  const existing = all.find((a) => a.username.toLowerCase() === username.toLowerCase());
  if (existing) return existing.id;
  const instagramType = await storage.getSocialAccountTypeByName("instagram");
  const created = await storage.createSocialAccount({
    username,
    ownerUuid: null,
    typeId: instagramType?.id || null,
    internalAccountCreationType: "dm backup import (e2e test)",
  });
  return created.id;
}

async function runOnce(
  zipSource: string,
  userId: number,
  rootSocialAccountId: string,
  rootUsername: string,
  label: string
) {
  // The task deletes its zip when done — hand it a copy
  const zipCopy = path.join(os.tmpdir(), `prm-dm-e2e-${Date.now()}.zip`);
  fs.copyFileSync(zipSource, zipCopy);

  const task = await storage.createTask({
    type: "import_instagram_backup",
    status: "in_progress",
    payload: JSON.stringify({ userId, zipPath: zipCopy, rootSocialAccountId, rootUsername }),
  });

  const result = await processImportInstagramBackup(task.id, {
    userId,
    zipPath: zipCopy,
    rootSocialAccountId,
    rootUsername,
    options: {},
  });
  await storage.updateTaskStatus(task.id, "completed", result);

  console.log(`\n[${label}]`, JSON.stringify(JSON.parse(result), null, 2));
  return JSON.parse(result);
}

async function main() {
  const zipSource = process.argv[2];
  const rootUsername = process.argv[3];
  if (!zipSource || !fs.existsSync(zipSource) || !rootUsername) {
    console.error("Usage: npx tsx scripts/test-instagram-dm-import-e2e.ts <backup.zip> <rootUsername>");
    process.exit(1);
  }

  const [user] = await db.select().from(users).limit(1);
  if (!user) {
    console.error("No user found in database");
    process.exit(1);
  }
  const rootSocialAccountId = await resolveRootAccount(rootUsername);
  console.log(`Importing as user #${user.id} (${user.username}), root account @${rootUsername} (${rootSocialAccountId})`);

  const first = await runOnce(zipSource, user.id, rootSocialAccountId, rootUsername, "first run");
  const second = await runOnce(zipSource, user.id, rootSocialAccountId, rootUsername, "second run (idempotency)");

  let failed = false;
  if (second.inserted !== 0) {
    console.error(`FAIL: second run inserted ${second.inserted} messages, expected 0`);
    failed = true;
  }
  if (second.photosImported > 0 || second.videosImported > 0) {
    console.error("FAIL: second run re-imported media");
    failed = true;
  }
  if (first.threads !== second.threads) {
    console.error("FAIL: thread counts differ between runs");
    failed = true;
  }
  // First run stores the hash; second run's content is identical so it must
  // take the fast path and skip the whole thread without per-message work
  if (first.threadsSkippedUnchanged !== 0) {
    console.error(`FAIL: first run skipped ${first.threadsSkippedUnchanged} threads, expected 0`);
    failed = true;
  }
  if (second.threadsSkippedUnchanged !== second.threads) {
    console.error(
      `FAIL: second run skipped ${second.threadsSkippedUnchanged}/${second.threads} threads via hash, expected all`
    );
    failed = true;
  }
  if (second.skippedDuplicates !== 0) {
    console.error(
      `FAIL: second run did per-message dedup (${second.skippedDuplicates}) instead of the hash fast-path`
    );
    failed = true;
  }

  console.log(failed ? "\nE2E FAILED" : "\nE2E passed: import is idempotent");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
