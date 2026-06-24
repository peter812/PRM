import { storage } from "../server/storage";
import { db } from "../server/db";
import { socialAccounts, socialAccountPosts, extensionSessions, users, photos } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { scrypt } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function test() {
  console.log("Starting Instagram Import Endpoint integration test...");

  // 1. Ensure a user exists
  const allUsers = await storage.getAllUsers();
  let testUser = allUsers[0];
  if (!testUser) {
    console.log("Creating test user...");
    const hashedPassword = await hashPassword("password123");
    testUser = await storage.createUser({
      username: "testuser",
      password: hashedPassword,
      displayName: "Test User",
    });
  }
  console.log(`Using user: ${testUser.username} (ID: ${testUser.id})`);

  // 2. Create a mock extension session
  console.log("Creating extension session...");
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = await hashPassword(rawToken);

  // Clean up any old test extension sessions first
  const existingSessions = await storage.getAllExtensionSessions(testUser.id);
  for (const s of existingSessions) {
    if (s.name === "Test Instagram Import Extension") {
      await storage.deleteExtensionSession(s.id);
    }
  }

  const session = await storage.createExtensionSession({
    userId: testUser.id,
    sessionToken: hashedToken,
    name: "Test Instagram Import Extension",
  });
  console.log(`Extension session created (ID: ${session.id}, Raw Token: ${rawToken})`);

  // 3. Clean up any pre-existing test data to ensure clean run
  const testPostId = "3123456789012345678";
  // Generate deterministic UUID
  const hash = crypto.createHash("sha256").update(`instagram:post:${testPostId}`).digest("hex");
  const deterministicPostId = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "5" + hash.substring(13, 16),
    "a" + hash.substring(17, 20),
    hash.substring(20, 32)
  ].join("-");

  console.log(`Cleaning up old test post and photos for UUID ${deterministicPostId}...`);
  await db.delete(socialAccountPosts).where(eq(socialAccountPosts.id, deterministicPostId));
  await db.delete(photos).where(eq(photos.prmLocation, `post:${deterministicPostId}`));

  // 4. Formulate import request payload
  const payload = {
    username: "test_instagram_coder",
    platform: "Instagram",
    post: {
      post_id: testPostId,
      shortcode: "C8d823xABcd",
      caption: "Had a great time coding today! #prm #test",
      taken_at: 1719182367,
      media_type: 1,
      media: [
        {
          type: "image",
          filename: "C8d823xABcd_0.jpg",
          // Small valid 1x1 pixel JPEG base64
          data: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
        }
      ]
    }
  };

  // 5. Send POST request
  const url = "http://localhost:5000/api/posts/instagram/import";
  console.log(`Sending POST request to ${url}...`);

  const response1 = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Extension-Token": rawToken
    },
    body: JSON.stringify(payload)
  });

  console.log(`Response status: ${response1.status}`);
  const data1 = (await response1.json()) as any;
  console.log("Response data:", JSON.stringify(data1, null, 2));

  if (response1.status !== 201) {
    throw new Error(`Expected 201 Created but got ${response1.status}`);
  }

  // Verify database record
  const [dbPost] = await db.select().from(socialAccountPosts).where(eq(socialAccountPosts.id, deterministicPostId));
  if (!dbPost) {
    throw new Error("Post was not found in the database after successful import!");
  }
  console.log("Verified: Post exists in database.");

  // Verify photos record
  const dbPhotos = await db.select().from(photos).where(eq(photos.prmLocation, `post:${deterministicPostId}`));
  if (dbPhotos.length === 0) {
    throw new Error("Photos were not registered in database after successful import!");
  }
  console.log(`Verified: ${dbPhotos.length} photo(s) registered in database.`);

  // 6. Test de-duplication by sending it again
  console.log("Sending duplicate POST request to test de-duplication...");
  const response2 = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Extension-Token": rawToken
    },
    body: JSON.stringify(payload)
  });

  console.log(`Duplicate response status: ${response2.status}`);
  const data2 = (await response2.json()) as any;
  console.log("Duplicate response data:", JSON.stringify(data2, null, 2));

  if (response2.status !== 200) {
    throw new Error(`Expected 200 OK for duplicate but got ${response2.status}`);
  }
  if (!data2.message || !data2.message.includes("already exists")) {
    throw new Error("Expected de-duplication message in response!");
  }
  console.log("Verified: Duplicate post skipped successfully.");

  // 7. Clean up
  console.log("Cleaning up test data...");
  await db.delete(socialAccountPosts).where(eq(socialAccountPosts.id, deterministicPostId));
  await db.delete(photos).where(eq(photos.prmLocation, `post:${deterministicPostId}`));
  await storage.deleteExtensionSession(session.id);
  console.log("Test cleanup completed successfully.");
  console.log("ALL TESTS PASSED!");
}

test().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
