import { db } from "./server/db";
import { aiChats } from "./shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  try {
    const [chat] = await db.select().from(aiChats).where(eq(aiChats.id, "293a9113-cb9e-48ac-9d4d-2370d9f9f7a3"));
    if (chat) {
      console.log("=========================================");
      console.log(`Chat ID: ${chat.id}`);
      console.log(`Title: ${chat.title}`);
      console.log(`Model: ${chat.model}`);
      console.log("Messages:");
      console.log(JSON.stringify(chat.messages, null, 2));
    } else {
      console.log("Chat not found!");
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
