// Verification script for the media half of server/local-storage.ts
// Run: npx tsx scripts/test-media-storage.ts
// Writes into ./uploads (same dir the server uses) and cleans up after itself.

import fs from "fs";
import path from "path";
import {
  uploadMediaLocally,
  deleteMediaLocally,
  getLocalMediaPath,
  isLocalMediaUrl,
} from "../server/local-storage";

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

async function main() {
  // Minimal valid-enough mp4 header bytes (ftyp box) — content doesn't matter here
  const fakeMp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypmp42"),
    Buffer.alloc(64, 0x42),
  ]);

  console.log("uploadMediaLocally:");
  const url = await uploadMediaLocally(fakeMp4, "clip.mp4", "video/mp4");
  check("returns /api/media/ url", url.startsWith("/api/media/"), url);
  check("isLocalMediaUrl", isLocalMediaUrl(url));

  const fileName = url.split("/api/media/")[1];
  const diskPath = getLocalMediaPath(fileName);
  check("file exists on disk", diskPath !== null && fs.existsSync(diskPath), diskPath);
  check("contents round-trip", diskPath !== null && fs.readFileSync(diskPath).equals(fakeMp4));

  console.log("audio:");
  const audioUrl = await uploadMediaLocally(fakeMp4, "voice.m4a", "audio/mp4");
  check("m4a keeps extension", audioUrl.endsWith(".m4a"), audioUrl);

  console.log("rejection:");
  let rejected = false;
  try {
    await uploadMediaLocally(Buffer.from("MZ"), "evil.exe", "application/octet-stream");
  } catch {
    rejected = true;
  }
  check("rejects non-media mime", rejected);

  let imageRejected = false;
  try {
    await uploadMediaLocally(fakeMp4, "photo.jpg", "image/jpeg");
  } catch {
    imageRejected = true;
  }
  check("rejects image mime (images use uploadImageLocally)", imageRejected);

  console.log("path safety:");
  check("traversal blocked", getLocalMediaPath("../package.json") === null);
  check("non-media extension blocked", getLocalMediaPath("something.txt") === null);

  console.log("delete:");
  await deleteMediaLocally(url);
  await deleteMediaLocally(audioUrl);
  check("file removed", getLocalMediaPath(fileName) === null);

  if (failures) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
