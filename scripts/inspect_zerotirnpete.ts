import { db } from "../server/db";
import { socialAccounts, conversations, conversationParticipants, messages } from "../shared/schema";
import { eq, ilike } from "drizzle-orm";

async function main() {
  console.log("Broad search for social accounts...");
  const peteAccounts = await db.select().from(socialAccounts).where(ilike(socialAccounts.username, "%pete%"));
  console.log("Accounts matching 'pete':", JSON.stringify(peteAccounts, null, 2));

  const zeroAccounts = await db.select().from(socialAccounts).where(ilike(socialAccounts.username, "%zero%"));
  console.log("Accounts matching 'zero':", JSON.stringify(zeroAccounts, null, 2));

  const count = await db.select().from(socialAccounts);
  console.log(`Total social accounts in DB: ${count.length}`);
  if (count.length > 0) {
    console.log("Sample accounts:", JSON.stringify(count.slice(0, 10), null, 2));
  }

  const convCount = await db.select().from(conversations);
  console.log(`Total conversations in DB: ${convCount.length}`);
  if (convCount.length > 0) {
    console.log("Sample conversations:", JSON.stringify(convCount.slice(0, 5), null, 2));
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
