import { db } from "./server/db";
import { people } from "./shared/schema";
import { eq } from "drizzle-orm";
import { searchUniversal } from "./server/vector-universal";

async function run() {
  try {
    const [anna] = await db.select().from(people).where(eq(people.id, "27b5f7f7-27d3-4e9f-a7cc-470166fa2777"));
    if (anna) {
      console.log("Anna Erickson record:");
      console.log("vectorId:", anna.vectorId);
      console.log("vectorSyncedAt:", anna.vectorSyncedAt);
    } else {
      console.log("Anna Erickson not found by ID");
    }

    console.log("\nTesting searchUniversal for 'anna erickson':");
    const results = await searchUniversal("anna erickson", 5);
    console.log(`Found ${results.length} results:`);
    for (const r of results) {
      console.log(`  - Type: ${r.type}, Title: ${r.title}, Score: ${r.score}, EntityId: ${r.entityId}`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
