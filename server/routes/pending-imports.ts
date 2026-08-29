import type { Express, Request, Response } from "express";
import { storage, countPendingImportEntries } from "../storage";
import { db } from "../db";
import { authenticateExtensionToken } from "../auth";
import { runAsUser } from "../access";
import { triggerTaskWorker } from "../task-worker";
import { socialAccounts, socialAccountHistory } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
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
 * Read the extension's declared capture scope off a payload.
 *
 * The extension states what it finished collecting; the server needs it because a
 * scrape is authoritative, so an edge absent from a captured list gets deleted. A
 * truncated follower scroll and a genuinely short follower list produce the same
 * CSV, and only the extension can tell them apart.
 *
 * Returns null for older builds that do not send it, and for anything unrecognised —
 * the import path then infers scope from which lists arrived, exactly as before.
 */
const CAPTURE_SCOPES = ["both", "followers", "following", "profile"];

function parseCaptureScope(value: unknown): string | null {
  const scope = String(value ?? "").trim().toLowerCase();
  return CAPTURE_SCOPES.includes(scope) ? scope : null;
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

          const importPayload = {
            accountUsername: targetAccount || `bulk_import_${Date.now()}`,
            accountDisplayName: targetAccount ? `@${targetAccount} Audience` : "Bulk Scraped Contacts",
            accountFollowers: csvLines || null,
            accountFollowing: null,
            importType: "full",
          };

          const duplicate = await storage.findDuplicatePendingSocialAccountImport(importPayload);
          if (duplicate) {
            return res.status(200).json({ success: true, id: duplicate.id, count: contacts.length, duplicate: true });
          }

          const id = crypto.randomUUID();
          const newImport = await storage.createPendingSocialAccountImport({
            id,
            timestampAdded: body.timestamp ? new Date(body.timestamp) : new Date(),
            alreadyAdded: false,
            ...importPayload,
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

        const importPayload = {
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
          // A tab extraction reads the profile header only; it never opens either list.
          captureScope: "profile",
        };

        const duplicate = await storage.findDuplicatePendingSocialAccountImport(importPayload);
        if (duplicate) {
          return res.status(200).json({ success: true, id: duplicate.id, duplicate: true });
        }

        const id = body.uuid || body.id || crypto.randomUUID();
        const timestampAdded = body.timestamp ? new Date(body.timestamp) : new Date();

        const newImport = await storage.createPendingSocialAccountImport({
          id,
          timestampAdded,
          alreadyAdded: false,
          ...importPayload,
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
        const accountUsername = body.account_username || body.accountUsername;

        if (!accountUsername) {
          return res.status(400).json({ error: "account_username is required" });
        }

        const importPayload = {
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
          captureScope: parseCaptureScope(body.capture_scope ?? body.captureScope),
        };

        const duplicate = await storage.findDuplicatePendingSocialAccountImport(importPayload);
        if (duplicate) {
          return res.status(200).json({ success: true, id: duplicate.id, duplicate: true });
        }

        const id = body.uuid || body.id || crypto.randomUUID();
        const timestampAddedInput = body.timestamp_added || body.timestampAdded;
        const timestampAdded = timestampAddedInput ? new Date(timestampAddedInput) : new Date();

        const newImport = await storage.createPendingSocialAccountImport({
          id,
          timestampAdded,
          alreadyAdded: body.already_added || body.alreadyAdded || false,
          ...importPayload,
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

        // When PRM last actually recorded a change, as opposed to when it last
        // looked. The popup uses the gap between the two to show whether a rescrape
        // is likely to find anything.
        const [lastChange] = account
          ? await db
              .select({ detectedAt: socialAccountHistory.detectedAt })
              .from(socialAccountHistory)
              .where(eq(socialAccountHistory.socialAccountId, account.id))
              .orderBy(desc(socialAccountHistory.detectedAt))
              .limit(1)
          : [];

        res.json({
          exists: Boolean(account),
          isSimple: account?.isSimple ?? true,
          lastScrapedAt: account?.lastScrapedAt ?? null,
          lastChangeAt: lastChange?.detectedAt ?? null,
          // Counts are denormalized onto the account, so this costs nothing.
          followersCount: account?.followersCount ?? null,
          followingCount: account?.followingCount ?? null,
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
   * Queues a background import_social task to ingest followers & following.
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

        const task = await storage.createTask({
          userId: auth.userId,
          type: "import_social",
          status: "pending",
          title: record.accountUsername,
          payload: JSON.stringify({
            pendingImportId: record.id,
            includeGraphImages: Boolean(req.body?.includeGraphImages),
          }),
        });

        triggerTaskWorker();

        res.json({ success: true, taskId: task.id });
      });
    } catch (error) {
      console.error("Error queueing pending import task:", error);
      res.status(500).json({ error: "Failed to queue pending import task" });
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
   * Queues background import_social tasks for multiple pending import records.
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

        const taskIds: string[] = [];
        for (const id of ids) {
          const record = await storage.getPendingSocialAccountImportById(id);
          if (record) {
            const task = await storage.createTask({
              userId: auth.userId,
              type: "import_social",
              status: "pending",
              title: record.accountUsername,
              payload: JSON.stringify({
                pendingImportId: record.id,
                includeGraphImages: Boolean(includeGraphImages),
              }),
            });
            taskIds.push(task.id);
          }
        }

        if (taskIds.length > 0) {
          triggerTaskWorker();
        }

        res.json({ success: true, count: taskIds.length, taskIds });
      });
    } catch (error) {
      console.error("Error bulk queueing pending imports:", error);
      res.status(500).json({ error: "Failed to bulk queue pending imports" });
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
