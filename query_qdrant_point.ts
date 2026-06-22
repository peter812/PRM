import { upsertEntityVector, searchUniversal } from "./server/vector-universal";
import { db } from "./server/db";
import { people } from "./shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  try {
    console.log("\nRe-upserting Anna Erickson...");
    const [anna] = await db.select().from(people).where(eq(people.id, "27b5f7f7-27d3-4e9f-a7cc-470166fa2777"));
    if (anna) {
      const newPointId = await upsertEntityVector("person", anna.id, anna, anna.vectorId);
      console.log("Re-upserted successfully! New/existing point ID:", newPointId);
    } else {
      console.log("Could not find Anna Erickson in DB");
    }

    console.log("\nTesting searchUniversal for 'anna erickson' post-upsert:");
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
