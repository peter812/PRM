import { storage } from "./storage";
import { db } from "./db";
import { people, socialAccounts, socialNetworkState, groups, tasks } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";
import { initializeDatabase } from "./db-init";
import { triggerTaskWorker } from "./task-worker";

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollTask(taskId: string, maxRetries = 15): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    const task = await storage.getTaskById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found during polling`);
    console.log(`Polling task status: ${task.status} (Progress: ${task.progress}%)`);
    if (task.status === "completed") {
      return task;
    }
    if (task.status === "failed") {
      throw new Error(`Task failed: ${task.result || "unknown error"}`);
    }
    await delay(1000);
  }
  throw new Error("Task timed out");
}

async function run() {
  console.log("Starting Crowds and LPA Group Clustering integration tests...");
  try {
    // 1. Initialize DB columns and schemas
    await initializeDatabase();

    // Clean up any existing test groups/people to ensure clean run
    console.log("Cleaning up old test data...");
    await db.delete(groups).where(eq(groups.name, "Test Crowd Group"));
    await db.delete(people).where(inArray(people.firstName, ["TestA", "TestB1", "TestB2", "TestB3", "TestB4", "TestB5", "TestB6", "TestD"]));

    // 2. Create test people
    console.log("Creating test people...");
    const [personA] = await db.insert(people).values({
      firstName: "TestA",
      lastName: "CenterOwner",
    }).returning();

    const followerPeople = [];
    for (let i = 1; i <= 6; i++) {
      const [p] = await db.insert(people).values({
        firstName: `TestB${i}`,
        lastName: `Follower${i}`,
      }).returning();
      followerPeople.push(p);
    }

    const [personD] = await db.insert(people).values({
      firstName: "TestD",
      lastName: "CrowdCandidate",
    }).returning();

    // 3. Create test social accounts
    console.log("Creating test social accounts...");
    const [accA] = await db.insert(socialAccounts).values({
      username: "test_center",
      ownerUuid: personA.id,
    }).returning();

    const followerAccounts = [];
    for (let i = 0; i < 6; i++) {
      const [sa] = await db.insert(socialAccounts).values({
        username: `test_follower_${i + 1}`,
        ownerUuid: followerPeople[i].id,
      }).returning();
      followerAccounts.push(sa);
    }

    const [accD] = await db.insert(socialAccounts).values({
      username: "test_candidate_d",
      ownerUuid: personD.id,
    }).returning();

    // Update person social account array references
    await db.update(people).set({ socialAccountUuids: [accA.id] }).where(eq(people.id, personA.id));
    for (let i = 0; i < 6; i++) {
      await db.update(people).set({ socialAccountUuids: [followerAccounts[i].id] }).where(eq(people.id, followerPeople[i].id));
    }
    await db.update(people).set({ socialAccountUuids: [accD.id] }).where(eq(people.id, personD.id));

    // 4. Create follow relationships (Network State)
    console.log("Mocking social network states...");
    const followerIds = followerAccounts.map(sa => sa.id);
    await db.insert(socialNetworkState).values({
      socialAccountId: accA.id,
      followers: followerIds,
      following: [],
    });
    await db.insert(socialNetworkState).values({
      socialAccountId: accD.id,
      followers: [],
      following: followerIds,
    });

    // 5. Create Group with Center Account
    console.log("Creating group with center account A...");
    const [group] = await db.insert(groups).values({
      name: "Test Crowd Group",
      color: "#ec4899",
      centerAccountId: accA.id,
      members: [personA.id],
    }).returning();

    // 6. Queue crowd calculation task
    console.log("Queueing calculate_crowd task...");
    const crowdTask = await storage.createTask({
      type: "calculate_crowd",
      status: "pending",
      title: "Test Crowd Calculation",
      payload: JSON.stringify({ groupId: group.id }),
    });

    triggerTaskWorker();
    const completedCrowdTask = await pollTask(crowdTask.id);
    console.log("Crowd calculation task completed successfully!");

    // Verify crowd members calculated
    const updatedGroup = await storage.getGroupById(group.id);
    if (!updatedGroup) throw new Error("Group not found after calculation");
    console.log("Calculated crowd members:", updatedGroup.crowdMembers);
    
    // Expect Person D to be in the crowd members list since they follow followers of A
    if (!updatedGroup.crowdMembers || !updatedGroup.crowdMembers.includes(personD.id)) {
      throw new Error("FAIL: Person D was not added to the crowd members list!");
    }
    console.log("SUCCESS: Person D correctly identified as crowd member.");

    // 7. Queue community detection LPA clustering task
    console.log("Queueing find_potential_groups task...");
    const lpaTask = await storage.createTask({
      type: "find_potential_groups",
      status: "pending",
      title: "Test LPA Clustering",
      payload: JSON.stringify({
        entityType: "people",
        linkDefinition: "any",
        minGroupSize: 2,
        minDensityMultiplier: 1.0,
      }),
    });

    triggerTaskWorker();
    const completedLpaTask = await pollTask(lpaTask.id);
    console.log("LPA Clustering task completed successfully!");

    // Verify clustering results
    if (!completedLpaTask.result) throw new Error("LPA task result is empty");
    const results = JSON.parse(completedLpaTask.result);
    console.log("LPA Clustering Results:", JSON.stringify(results, null, 2));
    
    if (!Array.isArray(results)) {
      throw new Error("FAIL: LPA results are not an array");
    }
    console.log("SUCCESS: LPA Clustering correctly returned groups.");

    // Clean up
    console.log("Cleaning up test records...");
    await db.delete(groups).where(eq(groups.name, "Test Crowd Group"));
    await db.delete(socialNetworkState).where(inArray(socialNetworkState.socialAccountId, [accA.id, accD.id, ...followerIds]));
    await db.delete(socialAccounts).where(inArray(socialAccounts.id, [accA.id, accD.id, ...followerIds]));
    await db.delete(people).where(inArray(people.id, [personA.id, personD.id, ...followerPeople.map(p => p.id)]));
    await db.delete(tasks).where(inArray(tasks.id, [crowdTask.id, lpaTask.id]));

    console.log("ALL TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } catch (err) {
    console.error("FAIL: Integration tests failed with error:", err);
    process.exit(1);
  }
}

run();
