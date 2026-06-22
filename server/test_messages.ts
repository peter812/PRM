import { db } from "./db";
import { aiChats } from "../shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  try {
    const chat = await db.query.aiChats.findFirst({
      where: eq(aiChats.id, "293a9113-cb9e-48ac-9d4d-2370d9f9f7a3")
    });
    if (!chat) {
      console.log("Chat not found!");
      return;
    }
    const msgs = chat.messages as any[];
    msgs.forEach((m, i) => {
      console.log(`\n--- Message ${i} [role: ${m.role}] ---`);
      if (m.tool_calls) {
        console.log("tool_calls:", JSON.stringify(m.tool_calls, null, 2));
      }
      if (m.role === "tool") {
        console.log("tool info:", { name: m.name, tool_name: m.tool_name, tool_call_id: m.tool_call_id });
      }
      console.log("content length:", m.content?.length ?? 0);
    });
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
