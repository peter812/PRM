import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { authenticateExtensionToken } from "../auth";
import { socialAccounts, people, socialFollows } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import Papa from "papaparse";
import crypto from "crypto";

/**
 * Helper to authenticate either via standard user session or X-Extension-Token header.
 */
async function authenticateSessionOrExtensionToken(req: Request, res: Response): Promise<{ userId?: number } | null> {
  if (req.isAuthenticated() && req.user) {
    return { userId: req.user.id };
  }

  const token = req.headers["x-extension-token"] as string | undefined;
  if (token) {
    const session = await authenticateExtensionToken(token);
    if (session) {
      await storage.updateExtensionSessionLastAccessed(session.id);
      return { userId: session.userId };
    }
  }

  res.status(401).json({ error: "Authentication required (session cookie or X-Extension-Token header)" });
  return null;
}

/**
 * Ingestion helper function for a single pending import record.
 */
async function ingestPendingImportRecord(pendingImport: any, userId: number = 1) {
  const instagramType = await storage.getSocialAccountTypeByName("instagram");
  const typeId = instagramType?.id || null;

  // 1. Resolve or create main social account
  const mainUsername = pendingImport.accountUsername.trim().toLowerCase();
  let [mainAccount] = await db.select().from(socialAccounts).where(eq(socialAccounts.username, mainUsername)).limit(1);

  let personId: string | null = mainAccount?.ownerUuid || null;

  if (!personId) {
    // Check if a person with this display name or username already exists
    const displayName = pendingImport.accountDisplayName || mainUsername;
    const nameParts = displayName.split(" ");
    const firstName = nameParts[0] || mainUsername;
    const lastName = nameParts.slice(1).join(" ") || "";

    const newPerson = await storage.createPerson({
      firstName,
      lastName,
      email: pendingImport.accountEmail || null,
      phone: pendingImport.accountPhone || null,
      address: pendingImport.accountLocationArea || null,
    });
    personId = newPerson.id;
  }

  if (!mainAccount) {
    mainAccount = await storage.createSocialAccount({
      username: mainUsername,
      typeId: typeId || undefined,
      ownerUuid: personId,
      internalAccountCreationType: "pending-import-ingest",
    });
  } else if (!mainAccount.ownerUuid) {
    await storage.updateSocialAccount(mainAccount.id, { ownerUuid: personId });
  }

  let totalFollowersIngested = 0;
  let totalFollowingIngested = 0;

  // Helper to process raw CSV lines/rows
  const processCsvPayload = async (csvText: string | null | undefined, isFollower: boolean) => {
    if (!csvText || !csvText.trim()) return 0;

    let rows: any[] = [];
    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    if (parseResult.data && parseResult.data.length > 0) {
      rows = parseResult.data;
    } else {
      // Fallback if raw text lines without headers
      rows = csvText.split("\n").map(line => ({ username: line.trim() })).filter(r => r.username);
    }

    let count = 0;
    for (const row of rows) {
      const handle = (row.username || row.handle || row.Account || row.Username || "").toString().trim().replace(/^@/, "").toLowerCase();
      if (!handle) continue;

      let [subAccount] = await db.select().from(socialAccounts).where(eq(socialAccounts.username, handle)).limit(1);

      if (!subAccount) {
        const subPerson = await storage.createPerson({
          firstName: row.full_name || row.displayName || handle,
          lastName: "",
        });

        subAccount = await storage.createSocialAccount({
          username: handle,
          typeId: typeId || undefined,
          ownerUuid: subPerson.id,
          internalAccountCreationType: "pending-import-contact",
        });
      }

      // Link social follow relationship
      const followerId = isFollower ? subAccount.id : mainAccount.id;
      const followedId = isFollower ? mainAccount.id : subAccount.id;

      const [existingFollow] = await db.select().from(socialFollows).where(
        and(
          eq(socialFollows.followerId, followerId),
          eq(socialFollows.followedId, followedId)
        )
      ).limit(1);

      if (!existingFollow) {
        await db.insert(socialFollows).values({
          followerId,
          followedId,
          source: "extension-pending-import",
        });
      }
      count++;
    }
    return count;
  };

  totalFollowersIngested = await processCsvPayload(pendingImport.accountFollowers, true);
  totalFollowingIngested = await processCsvPayload(pendingImport.accountFollowing, false);

  // Update status in pending_social_account_imports
  await storage.markPendingImportAsImported(pendingImport.id);

  return {
    success: true,
    id: pendingImport.id,
    mainUsername,
    followersIngested: totalFollowersIngested,
    followingIngested: totalFollowingIngested,
  };
}

export function registerPendingImportsRoutes(app: Express) {
  /**
   * POST /api/v1/pending-imports
   * Receives scraped social media data from Chrome extension.
   */
  app.post("/api/v1/pending-imports", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      const body = req.body || {};
      const id = body.uuid || body.id || crypto.randomUUID();
      const accountUsername = body.account_username || body.accountUsername;

      if (!accountUsername) {
        return res.status(400).json({ error: "account_username is required" });
      }

      const timestampAddedInput = body.timestamp_added || body.timestampAdded;
      const timestampAdded = timestampAddedInput ? new Date(timestampAddedInput) : new Date();

      const newImport = await storage.createPendingSocialAccountImport({
        id,
        timestampAdded,
        alreadyAdded: body.already_added || body.alreadyAdded || false,
        accountUsername: accountUsername.trim(),
        accountDisplayName: body.account_display_name || body.accountDisplayName || null,
        accountBio: body.account_bio || body.accountBio || null,
        accountWebsite: body.account_website || body.accountWebsite || null,
        accountEmail: body.account_email || body.accountEmail || null,
        accountPhone: body.account_phone || body.accountPhone || null,
        accountLocationArea: body.account_location_area || body.accountLocationArea || null,
        accountFollowers: body.account_followers || body.accountFollowers || null,
        accountFollowing: body.account_following || body.accountFollowing || null,
      });

      res.status(201).json({ success: true, id: newImport.id });
    } catch (error) {
      console.error("Error saving pending social account import:", error);
      res.status(500).json({ error: "Failed to save pending social account import" });
    }
  });

  /**
   * GET /api/v1/pending-imports
   * List pending imports with pagination, filter, and metrics summary.
   */
  app.get("/api/v1/pending-imports", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      const page = parseInt(req.query.page as string || "1", 10);
      const limit = parseInt(req.query.limit as string || "20", 10);
      const status = (req.query.status as string || "all") as "pending" | "imported" | "all";
      const search = (req.query.search as string || "").trim();

      const result = await storage.getPendingSocialAccountImports({ page, limit, status, search });

      // Compute aggregate metrics
      const allPending = await storage.getPendingSocialAccountImports({ page: 1, limit: 10000, status: "all" });
      const totalPendingCount = allPending.items.filter(i => !i.alreadyAdded).length;
      const totalImportedCount = allPending.items.filter(i => i.alreadyAdded).length;
      const totalFollowersCaptured = allPending.items.reduce((sum, item) => sum + item.followersCount + item.followingCount, 0);

      res.json({
        ...result,
        metrics: {
          totalPending: totalPendingCount,
          totalImported: totalImportedCount,
          totalFollowersCaptured,
        },
      });
    } catch (error) {
      console.error("Error fetching pending social account imports:", error);
      res.status(500).json({ error: "Failed to fetch pending social account imports" });
    }
  });

  /**
   * GET /api/v1/pending-imports/:id
   * Get single pending import details.
   */
  app.get("/api/v1/pending-imports/:id", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      const record = await storage.getPendingSocialAccountImportById(req.params.id);
      if (!record) {
        return res.status(404).json({ error: "Pending import record not found" });
      }

      const followersCount = record.accountFollowers ? record.accountFollowers.split("\n").filter(l => l.trim().length > 0).length : 0;
      const followingCount = record.accountFollowing ? record.accountFollowing.split("\n").filter(l => l.trim().length > 0).length : 0;

      res.json({
        ...record,
        followersCount,
        followingCount,
      });
    } catch (error) {
      console.error("Error fetching pending import detail:", error);
      res.status(500).json({ error: "Failed to fetch pending import detail" });
    }
  });

  /**
   * POST /api/v1/pending-imports/:id/import
   * Ingests followers & following CSVs into PRM main contact list.
   */
  app.post("/api/v1/pending-imports/:id/import", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      const record = await storage.getPendingSocialAccountImportById(req.params.id);
      if (!record) {
        return res.status(404).json({ error: "Pending import record not found" });
      }

      const result = await ingestPendingImportRecord(record, auth.userId || 1);
      res.json({ success: true, result });
    } catch (error) {
      console.error("Error ingesting pending import:", error);
      res.status(500).json({ error: "Failed to ingest pending import record" });
    }
  });

  /**
   * DELETE /api/v1/pending-imports/:id
   * Deletes a pending import record.
   */
  app.delete("/api/v1/pending-imports/:id", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      const success = await storage.deletePendingSocialAccountImport(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Pending import record not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting pending import:", error);
      res.status(500).json({ error: "Failed to delete pending import" });
    }
  });

  /**
   * POST /api/v1/pending-imports/bulk-import
   * Ingests multiple pending import records.
   */
  app.post("/api/v1/pending-imports/bulk-import", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      const { ids } = req.body as { ids?: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Array of ids is required" });
      }

      const results: any[] = [];
      for (const id of ids) {
        const record = await storage.getPendingSocialAccountImportById(id);
        if (record) {
          const resObj = await ingestPendingImportRecord(record, auth.userId || 1);
          results.push(resObj);
        }
      }

      res.json({ success: true, count: results.length, results });
    } catch (error) {
      console.error("Error bulk ingesting pending imports:", error);
      res.status(500).json({ error: "Failed to bulk ingest pending imports" });
    }
  });

  /**
   * POST /api/v1/pending-imports/bulk-delete
   * Deletes multiple pending import records.
   */
  app.post("/api/v1/pending-imports/bulk-delete", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      const { ids } = req.body as { ids?: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Array of ids is required" });
      }

      let deletedCount = 0;
      for (const id of ids) {
        const ok = await storage.deletePendingSocialAccountImport(id);
        if (ok) deletedCount++;
      }

      res.json({ success: true, deletedCount });
    } catch (error) {
      console.error("Error bulk deleting pending imports:", error);
      res.status(500).json({ error: "Failed to bulk delete pending imports" });
    }
  });
}
