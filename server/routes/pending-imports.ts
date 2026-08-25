import type { Express, Request, Response } from "express";
import { storage, countPendingImportEntries } from "../storage";
import { db } from "../db";
import { authenticateExtensionToken } from "../auth";
import { runAsUser } from "../access";
import { triggerImageTaskWorker } from "../task-worker";
import { socialAccounts, people, socialFollows } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import Papa from "papaparse";
import crypto from "crypto";

/**
 * Coerce a follower/following total off the wire into an integer.
 *
 * Accepts numbers and the abbreviated strings Instagram renders in its meta
 * description — "1,234", "15.3K", "1.2M", "3B". Anything unparseable becomes
 * null rather than NaN, which would blow up the integer column.
 */
function parseCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;

  const raw = String(value).trim().replace(/,/g, "");
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
  if (!match) return null;

  const magnitude = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] || "").toLowerCase()] ?? 1;
  const n = parseFloat(match[1]) * magnitude;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Build the 500 body for a failed extension write.
 *
 * The extension only ever shows the popup's log console, so a bare
 * "Server error (500)" makes a hard database fault — a missing column, say —
 * look like the payload silently vanished. Outside production the real cause
 * travels back so it lands in that log; production keeps the generic message.
 */
function writeFailureBody(message: string, error: unknown): Record<string, string> {
  if (process.env.NODE_ENV === "production") return { error: message };

  // Drizzle wraps driver errors, and its own message is the entire failed SQL
  // statement — which buries the one line that matters. The pg error hanging
  // off `cause` carries the SQLSTATE and the human-readable reason, so prefer
  // it whenever it is there.
  const driver = (error as { cause?: unknown } | null)?.cause;
  const detail = (driver as { code?: string } | null)?.code ? driver : error;

  const reason = detail instanceof Error ? detail.message : String(detail);
  const code = (detail as { code?: string } | null)?.code;
  const suffix = code ? `[${code}] ${reason}` : reason;

  return { error: `${message}: ${suffix.slice(0, 300)}` };
}

/**
 * Helper to authenticate either via standard user session or X-Extension-Token header.
 */
async function authenticateSessionOrExtensionToken(req: Request, res: Response): Promise<{ userId: number } | null> {
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
 * Queue the profile picture behind `imageUrl` for a social account.
 *
 * The download itself belongs to the image worker, which already handles
 * hash/resolution de-duplication, storage upload, the photos row, and passing
 * the result on to a linked person who has no image yet. All this has to do is
 * make sure there is a profile version for it to write the result into —
 * without one the worker uploads the file and then has nowhere to attach it.
 */
async function queueProfileImage(socialAccountId: string, imageUrl: string | null | undefined, userId: number) {
  if (!imageUrl || !imageUrl.trim()) return;

  const current = await storage.getCurrentProfileVersion(socialAccountId);
  const profileVersion = current
    ? (await storage.updateProfileVersion(current.id, { externalImageUrl: imageUrl }), current)
    : await storage.createProfileVersion({
        socialAccountId,
        isCurrent: true,
        externalImageUrl: imageUrl,
      });

  await storage.createImageTask({
    userId,
    type: "download_img_instagram",
    status: "pending",
    payload: JSON.stringify({
      socialAccountId,
      imageUrl,
      profileVersionId: profileVersion.id,
    }),
  });
}

/**
 * Ingestion helper function for a single pending import record.
 *
 * `includeGraphImages` opts into fetching a picture for every follower and
 * following account as well, which at the 3,000-per-side cap is thousands of
 * downloads — so it is off unless the caller asks.
 */
async function ingestPendingImportRecord(
  pendingImport: any,
  userId: number = 1,
  options: { includeGraphImages?: boolean } = {},
) {
  return await runAsUser(userId, async () => {
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

  await storage.updateSocialAccount(mainAccount.id, { isSimple: false, lastScrapedAt: new Date() });

  const profileFields: Record<string, any> = {};
  if (pendingImport.accountDisplayName) profileFields.nickname = pendingImport.accountDisplayName;
  if (pendingImport.accountBio) profileFields.bio = pendingImport.accountBio;
  if (pendingImport.accountWebsite) profileFields.accountUrl = pendingImport.accountWebsite;

  if (Object.keys(profileFields).length > 0) {
    const currentProfile = await storage.getCurrentProfileVersion(mainAccount.id);
    if (currentProfile) {
      await storage.updateProfileVersion(currentProfile.id, profileFields);
    } else {
      await storage.createProfileVersion({
        socialAccountId: mainAccount.id,
        isCurrent: true,
        ...profileFields,
      });
    }
  }

  // The selected account always gets its picture, whatever the import type.
  await queueProfileImage(mainAccount.id, pendingImport.accountImageUrl, userId);

  let totalFollowersIngested = 0;
  let totalFollowingIngested = 0;

  // Helper to process raw CSV lines/rows
  const processCsvPayload = async (csvText: string | null | undefined, isFollower: boolean) => {
    if (!csvText || !csvText.trim()) return 0;

    let rows: any[] = [];
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return 0;

    const firstLine = lines[0].toLowerCase();
    const hasHeaders = firstLine.includes("username") || firstLine.includes("handle") || firstLine.includes(",") || firstLine.includes("account");

    if (hasHeaders) {
      const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      if (parseResult.data && parseResult.data.length > 0) {
        rows = parseResult.data;
      }
    } else {
      // Direct single-column list of usernames/handles without header row
      rows = lines.map(line => ({ username: line.replace(/^@/, "").trim() }));
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

      if (options.includeGraphImages) {
        // The scraped CSV carries each account's picture URL alongside its handle.
        await queueProfileImage(subAccount.id, row.profile_pic_url || row.profilePicUrl, userId);
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

  if (pendingImport.importType !== 'account') {
    totalFollowersIngested = await processCsvPayload(pendingImport.accountFollowers, true);
    totalFollowingIngested = await processCsvPayload(pendingImport.accountFollowing, false);
  }

  // Update status in pending_social_account_imports
  await storage.markPendingImportAsImported(pendingImport.id);

  // Wake the image worker once for the whole record rather than per queued task.
  triggerImageTaskWorker();

  return {
    success: true,
    id: pendingImport.id,
    mainUsername,
    followersIngested: totalFollowersIngested,
    followingIngested: totalFollowingIngested,
  };
  });
}

export function registerPendingImportsRoutes(app: Express) {
  /**
   * POST /api/v1/scrape-results
   * Receives automated tab scrapes or bulk scraped contacts from the Chrome extension.
   */
  app.post("/api/v1/scrape-results", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      await runAsUser(auth.userId, async () => {
        const body = req.body || {};

        // Case 1: Bulk scraped contacts
        if (body.type === "bulk_scrape" && Array.isArray(body.contacts)) {
          const targetAccount = (body.targetAccount || "").trim();
          const contacts = body.contacts;
          const csvLines = contacts.map((c: any) => c.username || c.handle).filter(Boolean).join("\n");

          const id = crypto.randomUUID();
          const newImport = await storage.createPendingSocialAccountImport({
            id,
            timestampAdded: body.timestamp ? new Date(body.timestamp) : new Date(),
            alreadyAdded: false,
            accountUsername: targetAccount || `bulk_import_${Date.now()}`,
            accountDisplayName: targetAccount ? `@${targetAccount} Audience` : "Bulk Scraped Contacts",
            accountFollowers: csvLines || null,
            accountFollowing: null,
            importType: "full",
          });

          return res.status(201).json({ success: true, id: newImport.id, count: contacts.length });
        }

        // Case 2: Standard tab extraction payload
        const data = body.data || body;
        const rawUsername = data.username || data.handle || (typeof body.url === "string" ? body.url.split("/").filter(Boolean).pop() : "") || "";
        const username = rawUsername.replace(/^@/, "").trim().toLowerCase();

        if (!username) {
          return res.status(400).json({ error: "Username could not be determined from scrape payload" });
        }

        const id = body.uuid || body.id || crypto.randomUUID();
        const timestampAdded = body.timestamp ? new Date(body.timestamp) : new Date();

        const newImport = await storage.createPendingSocialAccountImport({
          id,
          timestampAdded,
          alreadyAdded: false,
          accountUsername: username,
          accountDisplayName: data.displayName || data.name || username,
          accountBio: data.bio || data.headline || null,
          accountWebsite: data.bioLink || data.website || null,
          accountLocationArea: data.location || null,
          accountEmail: data.email || null,
          accountPhone: data.phone || null,
          // A tab extraction reports totals off the profile's meta tags — those
          // are counts, not the follower CSV the "full" import produces.
          accountFollowers: null,
          accountFollowing: null,
          accountImageUrl: data.imageUrl || data.profilePicUrl || null,
          accountFollowersCount: parseCount(data.followers),
          accountFollowingCount: parseCount(data.following),
          importType: "account",
        });

        res.status(201).json({ success: true, id: newImport.id });
      });
    } catch (error) {
      console.error("Error handling scrape-results:", error);
      res.status(500).json(writeFailureBody("Failed to process scrape results", error));
    }
  });

  /**
   * POST /api/v1/pending-imports
   * Receives scraped social media data from Chrome extension.
   */
  app.post("/api/v1/pending-imports", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      await runAsUser(auth.userId, async () => {
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
          accountImageUrl: body.account_image_url || body.accountImageUrl || null,
          accountFollowersCount: parseCount(body.account_followers_count ?? body.accountFollowersCount),
          accountFollowingCount: parseCount(body.account_following_count ?? body.accountFollowingCount),
          importType: body.import_type || body.importType || 'full',
        });

        res.status(201).json({ success: true, id: newImport.id });
      });
    } catch (error) {
      console.error("Error saving pending social account import:", error);
      res.status(500).json(writeFailureBody("Failed to save pending social account import", error));
    }
  });

  /**
   * GET /api/v1/account-status?username=
   * What PRM knows about one social account, for the extension's status header.
   *
   *   exists false            → never seen
   *   exists true, isSimple   → a bare reference picked up from someone's graph
   *   exists true, !isSimple  → extracted, with lastScrapedAt saying when
   */
  app.get("/api/v1/account-status", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      await runAsUser(auth.userId, async () => {
        const username = String(req.query.username || "").trim().replace(/^@/, "").toLowerCase();
        if (!username) {
          return res.status(400).json({ error: "username is required" });
        }

        const [account] = await db
          .select()
          .from(socialAccounts)
          .where(eq(socialAccounts.username, username))
          .limit(1);

        res.json({
          exists: Boolean(account),
          isSimple: account?.isSimple ?? true,
          lastScrapedAt: account?.lastScrapedAt ?? null,
        });
      });
    } catch (error) {
      console.error("Error fetching account status:", error);
      res.status(500).json({ error: "Failed to fetch account status" });
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

      await runAsUser(auth.userId, async () => {
        const page = parseInt(req.query.page as string || "1", 10);
        const limit = parseInt(req.query.limit as string || "20", 10);
        const status = (req.query.status as string || "all") as "pending" | "imported" | "all";
        const search = (req.query.search as string || "").trim();

        const result = await storage.getPendingSocialAccountImports({ page, limit, status, search });

        // Compute aggregate metrics
        const allPending = await storage.getPendingSocialAccountImports({ page: 1, limit: 10000, status: "all" });
        const totalPendingCount = allPending.items.filter(i => !i.alreadyAdded).length;
        const totalImportedCount = allPending.items.filter(i => i.alreadyAdded).length;
        // The same account gets pulled more than once — a profile-only grab, then
        // a full CSV pull, then a refresh weeks later — and every pull lands as
        // its own row. Summing all rows counts that account's network once per
        // pull. Items come back newest-first, so the first row seen for a
        // username is its latest pull; count that one and skip its older twins.
        // Only a pull that came back with a CSV captured anything. A profile-only
        // grab reports the totals Instagram prints on the profile, which are a
        // claim about the account rather than accounts we hold — counting those
        // would inflate this by every follower we never actually saw. Such rows
        // are skipped before the de-duplication above, so a later profile-only
        // refresh cannot displace an earlier pull that did capture the graph.
        const seenUsernames = new Set<string>();
        let totalFollowersCaptured = 0;
        for (const item of allPending.items) {
          if (!item.hasFollowersCsv && !item.hasFollowingCsv) continue;

          const username = (item.accountUsername || "").trim().toLowerCase();
          if (username) {
            if (seenUsernames.has(username)) continue;
            seenUsernames.add(username);
          }
          if (item.hasFollowersCsv) totalFollowersCaptured += item.followersCount;
          if (item.hasFollowingCsv) totalFollowersCaptured += item.followingCount;
        }

        res.json({
          ...result,
          metrics: {
            totalPending: totalPendingCount,
            totalImported: totalImportedCount,
            totalFollowersCaptured,
          },
        });
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

      await runAsUser(auth.userId, async () => {
        const record = await storage.getPendingSocialAccountImportById(req.params.id);
        if (!record) {
          return res.status(404).json({ error: "Pending import record not found" });
        }

        const followersCount = countPendingImportEntries(record.accountFollowers, record.accountFollowersCount);
        const followingCount = countPendingImportEntries(record.accountFollowing, record.accountFollowingCount);

        res.json({
          ...record,
          followersCount,
          followingCount,
          hasFollowersCsv: Boolean(record.accountFollowers && record.accountFollowers.trim()),
          hasFollowingCsv: Boolean(record.accountFollowing && record.accountFollowing.trim()),
        });
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

      await runAsUser(auth.userId, async () => {
        const record = await storage.getPendingSocialAccountImportById(req.params.id);
        if (!record) {
          return res.status(404).json({ error: "Pending import record not found" });
        }

        const result = await ingestPendingImportRecord(record, auth.userId, {
          includeGraphImages: Boolean(req.body?.includeGraphImages),
        });
        res.json({ success: true, result });
      });
    } catch (error) {
      console.error("Error ingesting pending import:", error);
      res.status(500).json({ error: "Failed to ingest pending import record" });
    }
  });

  /**
   * DELETE /api/v1/pending-imports
   * Deletes every record matching the same status/search filter the list uses,
   * so it removes exactly what the caller was looking at. Registered ahead of
   * the /:id route, which would otherwise never see a bare path anyway.
   */
  app.delete("/api/v1/pending-imports", async (req: Request, res: Response) => {
    try {
      const auth = await authenticateSessionOrExtensionToken(req, res);
      if (!auth) return;

      await runAsUser(auth.userId, async () => {
        const deletedCount = await storage.deleteAllPendingSocialAccountImports({
          status: (req.query.status as "pending" | "imported" | "all") || "all",
          search: (req.query.search as string) || "",
        });

        res.json({ success: true, deletedCount });
      });
    } catch (error) {
      console.error("Error deleting all pending imports:", error);
      res.status(500).json({ error: "Failed to delete pending imports" });
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

      await runAsUser(auth.userId, async () => {
        const success = await storage.deletePendingSocialAccountImport(req.params.id);
        if (!success) {
          return res.status(404).json({ error: "Pending import record not found" });
        }

        res.json({ success: true });
      });
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

      await runAsUser(auth.userId, async () => {
        const { ids, includeGraphImages } = req.body as { ids?: string[]; includeGraphImages?: boolean };
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ error: "Array of ids is required" });
        }

        const results: any[] = [];
        for (const id of ids) {
          const record = await storage.getPendingSocialAccountImportById(id);
          if (record) {
            const resObj = await ingestPendingImportRecord(record, auth.userId, {
              includeGraphImages: Boolean(includeGraphImages),
            });
            results.push(resObj);
          }
        }

        res.json({ success: true, count: results.length, results });
      });
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

      await runAsUser(auth.userId, async () => {
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
      });
    } catch (error) {
      console.error("Error bulk deleting pending imports:", error);
      res.status(500).json({ error: "Failed to bulk delete pending imports" });
    }
  });
}
