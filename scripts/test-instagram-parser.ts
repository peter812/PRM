// Verification script for server/instagram-dm-import.ts
// Run: npx tsx scripts/test-instagram-parser.ts
//
// Optionally set REAL_THREAD_DIR to a full export thread folder to also parse
// a real thread end-to-end, e.g.:
//   REAL_THREAD_DIR="C:\...\inbox\laylabug_587235216244212" npx tsx scripts/test-instagram-parser.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  decodeMetaString,
  parseThreadFolderName,
  parseInstagramThread,
  loadThreadFolder,
  type ParsedThread,
} from "../server/instagram-dm-import";

let failures = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

function assertUniqueExternalIds(thread: ParsedThread, label: string) {
  const ids = new Set(thread.messages.map((m) => m.externalId));
  check(`${label}: externalIds unique`, ids.size === thread.messages.length, {
    messages: thread.messages.length,
    unique: ids.size,
  });
}

function assertAscending(thread: ParsedThread, label: string) {
  let ascending = true;
  for (let i = 1; i < thread.messages.length; i++) {
    if (thread.messages[i].sentAt.getTime() < thread.messages[i - 1].sentAt.getTime()) {
      ascending = false;
      break;
    }
  }
  check(`${label}: messages ascending by sentAt`, ascending);
}

// ── decodeMetaString unit checks ──

console.log("decodeMetaString:");
check("plain ascii untouched", decodeMetaString("hello") === "hello");
check("mojibake ladybug decodes", decodeMetaString("lAylAbUgð") === "lAylAbUg\u{1F41E}");
check("mojibake heart decodes", decodeMetaString("â¤") === "❤");
check("mojibake apostrophe decodes", decodeMetaString("didnât") === "didn’t");
check("already-decoded emoji untouched", decodeMetaString("café \u{1F41E}") === "café \u{1F41E}");

// ── parseThreadFolderName ──

console.log("parseThreadFolderName:");
{
  const r = parseThreadFolderName("laylabug_587235216244212");
  check("username", r.username === "laylabug", r);
  check("threadId", r.threadId === "587235216244212", r);
  const g = parseThreadFolderName("some_group_chat");
  check("non-matching folder falls back", g.username === "some_group_chat" && g.threadId === "some_group_chat", g);
}

// ── Fixture thread ──

console.log("fixture thread:");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(scriptDir, "..", "test", "fixtures", "instagram-thread", "laylabug_587235216244212");
const thread = loadThreadFolder(fixtureDir);

check("threadId parsed", thread.threadId === "587235216244212");
check("username parsed", thread.username === "laylabug");
check("two files merged (23 messages)", thread.messages.length === 23, thread.messages.length);
check("participants decoded", thread.participants.includes("lAylAbUg\u{1F41E}"), thread.participants);
assertAscending(thread, "fixture");
assertUniqueExternalIds(thread, "fixture");

// Content hash: present, stable across reloads, and sensitive to content changes
check("contentHash is a sha256 hex", /^[0-9a-f]{64}$/.test(thread.contentHash), thread.contentHash);
check("contentHash deterministic across reloads", loadThreadFolder(fixtureDir).contentHash === thread.contentHash);
{
  const files = ["message_1.json", "message_2.json"].map((name) => ({
    name,
    raw: fs.readFileSync(path.join(fixtureDir, name), "utf8"),
    json: JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8")),
  }));
  const same = parseInstagramThread(files, "laylabug_587235216244212").contentHash;
  check("contentHash independent of file order", same === thread.contentHash);
  const mutated = files.map((f) => ({ ...f, raw: f.raw + " " }));
  const changed = parseInstagramThread(mutated, "laylabug_587235216244212").contentHash;
  check("contentHash changes when content changes", changed !== thread.contentHash);
}

const kinds = (k: string) => thread.messages.flatMap((m) => m.media).filter((x) => x.kind === k);
check("has photos", kinds("photo").length >= 3, kinds("photo").length);
check("has videos", kinds("video").length >= 2, kinds("video").length);
check("has audio", kinds("audio").length >= 2, kinds("audio").length);
check("extensionless photo present", kinds("photo").some((x) => !path.basename(x.uri).includes(".")));
check(
  "remote audio flagged, local not",
  kinds("audio").some((x) => x.isRemote) && kinds("audio").some((x) => !x.isRemote),
);
check("local media uris relative", thread.messages.flatMap((m) => m.media).every((x) => x.isRemote === /^https?:/i.test(x.uri)));

check("share link present", thread.messages.some((m) => m.share?.link?.includes("instagram.com")));
check(
  "reactions decoded to real emoji",
  thread.messages.some((m) => m.reactions.some((r) => r.emoji === "❤")),
  thread.messages.flatMap((m) => m.reactions),
);
check("call durations present", thread.messages.filter((m) => m.callDurationSec !== undefined).length >= 2);
check("noise flagged", thread.messages.filter((m) => m.isSystemNoise).length >= 2);
check(
  "mojibake content decoded (no stray Ã/Â pairs)",
  thread.messages.every((m) => !m.content || !/[ÂÃ][-¿]/.test(m.content)),
);
check(
  "same-ms collision got suffixed id",
  thread.messages.some((m) => /:\d+$/.test(m.externalId.split(":").slice(3).join(":")) || m.externalId.split(":").length === 4),
);

// ── Optional: real thread ──

const realDir = process.env.REAL_THREAD_DIR;
if (realDir) {
  console.log(`real thread (${realDir}):`);
  const real = loadThreadFolder(realDir);
  console.log(`  parsed ${real.messages.length} messages, ${real.participants.length} participants`);
  assertAscending(real, "real");
  assertUniqueExternalIds(real, "real");
  const media = real.messages.flatMap((m) => m.media);
  console.log(
    `  media: ${media.filter((x) => x.kind === "photo").length} photos, ` +
      `${media.filter((x) => x.kind === "video").length} videos, ` +
      `${media.filter((x) => x.kind === "audio").length} audio (${media.filter((x) => x.kind === "audio" && x.isRemote).length} remote)`,
  );
  console.log(`  calls: ${real.messages.filter((m) => m.callDurationSec !== undefined).length}`);
  console.log(`  noise: ${real.messages.filter((m) => m.isSystemNoise).length}`);
} else {
  console.log("(set REAL_THREAD_DIR to also test against a full export thread)");
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nall checks passed");
