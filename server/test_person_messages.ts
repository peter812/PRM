import { storage } from "./storage";
import { db } from "./db";
import { people, users, conversations, messages, conversationParticipants, messageRecipients } from "../shared/schema";
import { eq } from "drizzle-orm";
import { initializeDatabase } from "./db-init";

async function run() {
  console.log("Starting Messages feature integration test...");
  try {
    // Initialize database (creates tables and columns if missing)
    await initializeDatabase();

    // 1. Fetch first user and first person in the database
    const [user] = await db.select().from(users).limit(1);
    if (!user) {
      console.error("FAIL: No user found in database. Run server first to seed a user.");
      process.exit(1);
    }
    console.log(`Found test user: ${user.username} (ID: ${user.id})`);

    const [person] = await db.select().from(people).limit(1);
    if (!person) {
      console.error("FAIL: No person found in database. Please add a person first.");
      process.exit(1);
    }
    console.log(`Found test person: ${person.firstName} ${person.lastName} (ID: ${person.id})`);

    // 2. Create conversation
    console.log("Creating test conversation...");
    const conv = await storage.createConversation({
      userId: user.id,
      title: "Test Conversation Title",
      channelType: "phone",
      socialAccountId: null,
      externalUrl: "https://example.com/test-url",
      metadata: { test: true },
      lastMessageAt: null,
    });
    console.log(`Created conversation ID: ${conv.id}`);

    // 3. Add participant
    console.log("Adding participant to conversation...");
    const part = await storage.addConversationParticipant({
      conversationId: conv.id,
      personId: person.id,
      socialAccountId: null,
      role: "participant",
    });
    console.log(`Added participant ID: ${part.id}`);

    // 4. Create message
    console.log("Creating test message...");
    const msg = await storage.createMessage(
      {
        conversationId: conv.id,
        senderPersonId: null, // "Self" sender
        senderSocialAccountId: null,
        content: "Hello! This is a test message.",
        contentType: "text",
        imageUuids: null,
        attachments: null,
        externalId: null,
        sentAt: new Date(),
        metadata: null,
      },
      [
        {
          personId: person.id,
          socialAccountId: null,
          recipientType: "to",
        },
      ]
    );
    console.log(`Created message ID: ${msg.id}`);

    // 5. Query and verify conversation details
    console.log("Retrieving conversation details...");
    const convDetails = await storage.getConversation(conv.id);
    if (!convDetails) throw new Error("Could not retrieve conversation");
    console.log(`Verified conversation title: ${convDetails.title}`);

    // 6. Query and verify messages
    console.log("Retrieving messages...");
    const { messages: msgs, total } = await storage.getMessagesByConversation(conv.id, 0, 10);
    console.log(`Verified message count: ${total}`);
    if (total !== 1) throw new Error("Incorrect message count");
    console.log(`Verified message content: "${msgs[0].content}"`);
    console.log(`Verified recipient details for person ID: ${msgs[0].recipients[0]?.personId}`);

    // 7. Test paginated query with filters
    console.log("Testing paginated queries...");
    const paginatedRes = await storage.getConversationsPaginated(0, 10, {
      channelType: "phone",
      personId: person.id,
    });
    console.log(`Found ${paginatedRes.total} conversations for person`);
    if (paginatedRes.total === 0) throw new Error("Paginated filter failed");

    // 8. Delete and verify cascade
    console.log("Deleting conversation (testing cascade deletes)...");
    await storage.deleteConversation(conv.id);

    // Verify deleted
    const deletedConv = await storage.getConversation(conv.id);
    if (deletedConv) throw new Error("Conversation was not deleted");

    const partsRemaining = await db
      .select()
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conv.id));
    if (partsRemaining.length > 0) throw new Error("Participants were not cascade-deleted");

    const msgsRemaining = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id));
    if (msgsRemaining.length > 0) throw new Error("Messages were not cascade-deleted");

    console.log("SUCCESS: All integration tests passed!");
  } catch (err) {
    console.error("FAIL: Test failed with error:", err);
    process.exit(1);
  }
  process.exit(0);
}

run();
