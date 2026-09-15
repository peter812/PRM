/**
 * Verifies that fetchProfileImage refuses urls it should never request.
 *
 *   npx tsx scripts/test-image-fetch-guard.ts
 *
 * The image url arrives on an extension payload, so it is caller-controlled. Every
 * case below is one a caller could actually send. Nothing here touches the database
 * or the network: each url must be rejected before a socket is opened, and the test
 * fails if any of them is merely slow rather than refused.
 */
import "dotenv/config";
import { fetchProfileImage } from "../server/profile-image";

let passed = 0;
let failed = 0;

async function rejects(label: string, url: string, expect: RegExp) {
  const started = Date.now();
  try {
    await fetchProfileImage(url);
    failed++;
    console.log(`  FAIL ${label}\n         expected a refusal, got a response`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (expect.test(message)) {
      passed++;
      console.log(`  ok   ${label}  (${Date.now() - started}ms)`);
    } else {
      failed++;
      console.log(`  FAIL ${label}\n         expected ${expect}\n         actual   ${message}`);
    }
  }
}

async function main() {
  console.log("\nfetchProfileImage url guard\n");

  // The reason the guard exists: reaching the cloud metadata endpoint would hand back
  // instance credentials, and the fetched bytes are stored and served to the user.
  await rejects("cloud metadata by ip", "http://169.254.169.254/latest/meta-data/", /disallowed host|over http:/);
  await rejects("loopback", "http://localhost:5432/", /disallowed host|over http:/);
  await rejects("private range", "https://10.0.0.5/avatar.jpg", /disallowed host/);

  // Scheme and host are checked independently; neither alone is sufficient.
  await rejects("plain http on an allowed host", "http://scontent.cdninstagram.com/a.jpg", /over http:/);
  await rejects("arbitrary https host", "https://example.com/a.jpg", /disallowed host/);
  await rejects("file url", "file:///etc/passwd", /over file:/);

  // A hostname that merely contains an allowed domain must not pass — the allowlist
  // anchors to the end of the host for exactly this.
  await rejects("suffix lookalike", "https://cdninstagram.com.evil.test/a.jpg", /disallowed host/);
  await rejects("substring lookalike", "https://notcdninstagram.com/a.jpg", /disallowed host/);

  await rejects("malformed url", "not-a-url", /Invalid URL/);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
