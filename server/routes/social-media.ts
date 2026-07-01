// Generated route module - social-media.ts
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "../storage";
import { db } from "../db";
import { interactions, relationshipTypes, interactionTypes, people, socialNetworkChanges, socialAccountPosts, socialAccounts, socialProfileVersions, aiChats, dailyNotes, photos, notes, faces, type SocialAccountWithCurrentProfile, type ExtensionSession, type AiChatMessage, type AiToolCallTrace } from "@shared/schema";
import { AI_TOOLS, getAiToolByName, listAiToolMetadata, buildOllamaToolsArray } from "../ai-tools";
import { generateFamilyTreeChanges, applyFamilyTreeChanges, type ProposedFamilyChange } from "../family-tree-ai";
import crypto from "crypto";
import { z } from "zod";
import { eq, sql, isNotNull, and, inArray, desc, or } from "drizzle-orm";
import {
  insertPersonSchema,
  insertNoteSchema,
  insertInteractionSchema,
  insertInteractionTypeSchema,
  insertRelationshipSchema,
  insertRelationshipTypeSchema,
  insertGroupSchema,
  insertGroupNoteSchema,
  insertUserSchema,
  insertApiKeySchema,
  insertSocialAccountSchema,
  insertSocialAccountTypeSchema,
  insertSocialAccountPostSchema,
  insertPhotoSchema,
  FAMILY_RELATIONSHIP_TYPES,
  FAMILY_RELATIONSHIP_LABELS,
  FAMILY_RELATIONSHIP_INVERSES,
  FAMILY_RELATIONSHIP_CATEGORIES,
  type FamilyRelationshipType,
} from "@shared/schema";
import multer from "multer";
import { uploadImageToS3, deleteImageFromS3 } from "../s3";
import { uploadImageLocally, deleteImageLocally, getLocalImagePath, isLocalImageUrl } from "../local-storage";
import { hashPassword, requireAuth } from "../auth";
import { triggerTaskWorker, triggerImageTaskWorker, pauseTaskWorker, resumeTaskWorker, isTaskWorkerPaused } from "../task-worker";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import Papa from "papaparse";
import { sendApiError, ErrorCodes } from "../middleware/error-handler";
import { sseManager } from "../middleware/sse";
import {
  loadVectorConfig,
  setVectorSetting,
  getVectorSetting,
  testVectorConnection,
  upsertDailyNoteVector,
  deleteDailyNoteVector,
  syncDailyNoteInBackground,
  searchDailyNotes,
} from "../vector";
import { syncEntityInBackground, deleteEntityVector } from "../vector-universal";
import { runAutomaticImagePassIn, autoPassInImageForSocialAccount } from "../image-pass-in-utils";

const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Flag to track if user creation is allowed (only after database reset)
let isUserCreationAllowed = false;

// NOTE: The global "/api" auth gate (and its PUBLIC_API_PATHS allowlist) lives
// in server/routes/auth-setup.ts, which is registered first and protects every
// /api route in all modules. Do not add a separate allowlist here.



// Bridge old settings functions to centralized storage layer
async function getOllamaSetting(key: string): Promise<string | null> {
  return storage.getAppSetting(key);
}
async function setOllamaSetting(key: string, value: string): Promise<void> {
  await storage.setAppSetting(key, value);
}
async function getPrmFaceSetting(key: string): Promise<string | null> {
  return storage.getAppSetting(key);
}
async function setPrmFaceSetting(key: string, value: string): Promise<void> {
  await storage.setAppSetting(key, value);
}


export function registerRoutes(app: Express) {
    // Social accounts endpoints
    app.get("/api/social-accounts", async (req, res) => {
      try {
        const searchQuery = req.query.search as string | undefined;
        const typeId = req.query.typeId as string | undefined;
        const accounts = await storage.getAllSocialAccounts(searchQuery, typeId);
        res.json(accounts);
      } catch (error) {
        console.error("Error fetching social accounts:", error);
        res.status(500).json({ error: "Failed to fetch social accounts" });
      }
    });
  
    app.post("/api/social-accounts/by-ids", async (req, res) => {
      try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
          return res.status(400).json({ error: "ids must be an array" });
        }
        const accounts = await storage.getSocialAccountsByIds(ids);
        res.json(accounts);
      } catch (error) {
        console.error("Error fetching social accounts by ids:", error);
        res.status(500).json({ error: "Failed to fetch social accounts" });
      }
    });
  
    app.get("/api/social-accounts/paginated", async (req, res) => {
      try {
        const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
        const searchQuery = req.query.search as string | undefined;
        const typeId = req.query.typeId as string | undefined;
        const followsYou = req.query.followsYou === "true";
        const full = req.query.full === "true";
  
        let followsAccountIds: string[] | undefined;
  
        if (followsYou) {
          const userId = req.user?.id;
          if (userId) {
            const mePerson = await storage.getMePerson(userId);
            if (mePerson && mePerson.socialAccountUuids && mePerson.socialAccountUuids.length > 0) {
              followsAccountIds = mePerson.socialAccountUuids;
            } else {
              res.json([]);
              return;
            }
          } else {
            res.json([]);
            return;
          }
        }
  
        const accounts = await storage.getSocialAccountsPaginated({
          offset,
          limit,
          searchQuery: searchQuery || undefined,
          typeId: typeId || undefined,
          followsAccountIds,
        });

        if (full) {
          res.json(accounts);
        } else {
          const sanitized = accounts.map(a => {
            const {
              createdAt,
              deletedPosts,
              internalAccountCreationType,
              latestState,
              ownerUuid,
              vectorId,
              vectorSyncedAt,
              ...rest
            } = a;
            return rest;
          });
          res.json(sanitized);
        }
      } catch (error) {
        console.error("Error fetching paginated social accounts:", error);
        res.status(500).json({ error: "Failed to fetch social accounts" });
      }
    });
  
    app.get("/api/social-accounts/export-xml", async (req, res) => {
      try {
        const ids = req.query.ids as string | undefined;
        const includeHistory = req.query.includeHistory === "true";
  
        const allSocialAccountTypes = await storage.getAllSocialAccountTypes();
  
        const escapeXml = (str: any): string => {
          if (str === null || str === undefined) return "";
          return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
        };
  
        const arrayToXml = (arr: any[], itemName: string): string => {
          if (!arr || arr.length === 0) return "";
          return arr.map(item => `<${itemName}>${escapeXml(item)}</${itemName}>`).join("");
        };
  
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<social_accounts_export>\n';
  
        const typeIdsUsed = new Set<string>();
        const accounts: SocialAccountWithCurrentProfile[] = [];
  
        if (ids) {
          const accountIds = ids.split(",").map(id => id.trim()).filter(Boolean);
          for (const id of accountIds) {
            const account = await storage.getSocialAccountById(id);
            if (account) {
              accounts.push(account);
              if (account.typeId) typeIdsUsed.add(account.typeId);
            }
          }
        } else {
          const allAccounts = await storage.getAllSocialAccounts();
          for (const account of allAccounts) {
            accounts.push(account);
            if (account.typeId) typeIdsUsed.add(account.typeId);
          }
        }
  
        const allNetworkStates = await storage.getAllNetworkStates();
        const networkStateMap = new Map(allNetworkStates.map(s => [s.socialAccountId, s]));
  
        xml += '  <social_account_types>\n';
        for (const type of allSocialAccountTypes) {
          if (typeIdsUsed.has(type.id)) {
            xml += '    <social_account_type>\n';
            xml += `      <id>${escapeXml(type.id)}</id>\n`;
            xml += `      <name>${escapeXml(type.name)}</name>\n`;
            xml += `      <color>${escapeXml(type.color)}</color>\n`;
            xml += `      <created_at>${escapeXml(type.createdAt)}</created_at>\n`;
            xml += '    </social_account_type>\n';
          }
        }
        xml += '  </social_account_types>\n';
  
        xml += '  <social_accounts>\n';
        for (const account of accounts) {
          const accountState = account.latestState || networkStateMap.get(account.id);
          xml += '    <social_account>\n';
          xml += `      <id>${escapeXml(account.id)}</id>\n`;
          xml += `      <username>${escapeXml(account.username)}</username>\n`;
          xml += `      <nickname>${escapeXml(account.currentProfile?.nickname || "")}</nickname>\n`;
          xml += `      <account_url>${escapeXml(account.currentProfile?.accountUrl || "")}</account_url>\n`;
          xml += `      <owner_uuid>${escapeXml(account.ownerUuid || "")}</owner_uuid>\n`;
          xml += `      <type_id>${escapeXml(account.typeId || "")}</type_id>\n`;
          xml += `      <image_url>${escapeXml(account.currentProfile?.imageUrl || "")}</image_url>\n`;
          xml += `      <notes></notes>\n`;
          xml += `      <following>${arrayToXml(accountState?.following || [], "account_id")}</following>\n`;
          xml += `      <followers>${arrayToXml(accountState?.followers || [], "account_id")}</followers>\n`;
          xml += `      <internal_account_creation_date>${escapeXml(account.internalAccountCreationDate)}</internal_account_creation_date>\n`;
          xml += `      <internal_account_creation_type>${escapeXml(account.internalAccountCreationType)}</internal_account_creation_type>\n`;
          xml += `      <created_at>${escapeXml(account.createdAt)}</created_at>\n`;
          xml += '    </social_account>\n';
        }
        xml += '  </social_accounts>\n';
  
        if (includeHistory) {
          xml += '  <social_profile_versions>\n';
          for (const account of accounts) {
            const versions = await storage.getProfileVersions(account.id);
            for (const version of versions) {
              xml += '    <social_profile_version>\n';
              xml += `      <id>${escapeXml(version.id)}</id>\n`;
              xml += `      <social_account_id>${escapeXml(version.socialAccountId)}</social_account_id>\n`;
              xml += `      <nickname>${escapeXml(version.nickname || "")}</nickname>\n`;
              xml += `      <bio>${escapeXml(version.bio || "")}</bio>\n`;
              xml += `      <account_url>${escapeXml(version.accountUrl || "")}</account_url>\n`;
              xml += `      <image_url>${escapeXml(version.imageUrl || "")}</image_url>\n`;
              xml += `      <external_image_url>${escapeXml(version.externalImageUrl || "")}</external_image_url>\n`;
              xml += `      <is_current>${escapeXml(version.isCurrent)}</is_current>\n`;
              xml += `      <detected_at>${escapeXml(version.detectedAt)}</detected_at>\n`;
              xml += '    </social_profile_version>\n';
            }
          }
          xml += '  </social_profile_versions>\n';
  
          xml += '  <social_network_snapshots>\n';
          for (const account of accounts) {
            const state = await storage.getNetworkState(account.id);
            if (state) {
              xml += '    <social_network_snapshot>\n';
              xml += `      <id>${escapeXml(state.id)}</id>\n`;
              xml += `      <social_account_id>${escapeXml(state.socialAccountId)}</social_account_id>\n`;
              xml += `      <follower_count>${escapeXml(state.followerCount)}</follower_count>\n`;
              xml += `      <following_count>${escapeXml(state.followingCount)}</following_count>\n`;
              xml += `      <followers>${arrayToXml(state.followers || [], "account_id")}</followers>\n`;
              xml += `      <following>${arrayToXml(state.following || [], "account_id")}</following>\n`;
              xml += `      <captured_at>${escapeXml(state.updatedAt)}</captured_at>\n`;
              xml += '    </social_network_snapshot>\n';
            }
          }
          xml += '  </social_network_snapshots>\n';
  
          xml += '  <social_network_changes>\n';
          for (const account of accounts) {
            const changes = await storage.getNetworkChanges(account.id);
            for (const change of changes) {
              xml += '    <social_network_change>\n';
              xml += `      <id>${escapeXml(change.id)}</id>\n`;
              xml += `      <social_account_id>${escapeXml(change.socialAccountId)}</social_account_id>\n`;
              xml += `      <change_type>${escapeXml(change.changeType)}</change_type>\n`;
              xml += `      <direction>${escapeXml(change.direction)}</direction>\n`;
              xml += `      <target_account_id>${escapeXml(change.targetAccountId)}</target_account_id>\n`;
              xml += `      <detected_at>${escapeXml(change.detectedAt)}</detected_at>\n`;
              xml += `      <batch_id>${escapeXml(change.batchId || "")}</batch_id>\n`;
              xml += '    </social_network_change>\n';
            }
          }
          xml += '  </social_network_changes>\n';
        }
  
        xml += '</social_accounts_export>\n';
  
        const filename = ids
          ? `social_accounts_export.xml`
          : `social_accounts_export_all.xml`;
        res.setHeader("Content-Type", "application/xml");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(xml);
      } catch (error) {
        console.error("Error exporting social accounts XML:", error);
        res.status(500).json({ error: "Failed to export social accounts" });
      }
    });
  
    app.post("/api/social-accounts/import-xml", upload.single("xml"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No XML file provided" });
        }
  
        const xmlText = req.file.buffer.toString("utf-8");
  
        const parseXmlTag = (tagName: string, text: string): string => {
          const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "s");
          const match = text.match(regex);
          return match ? match[1] : "";
        };
  
        const parseAllTags = (tagName: string, text: string): string[] => {
          const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gs");
          const matches: string[] = [];
          let match;
          while ((match = regex.exec(text)) !== null) {
            matches.push(match[1]);
          }
          return matches;
        };
  
        const parseXmlArray = (parentTag: string, childTag: string, text: string): string[] => {
          const parentContent = parseXmlTag(parentTag, text);
          if (!parentContent) return [];
          return parseAllTags(childTag, parentContent);
        };
  
        const unescapeXml = (str: string): string => {
          return str
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&gt;/g, ">")
            .replace(/&lt;/g, "<")
            .replace(/&amp;/g, "&");
        };
  
        const importedCounts = { socialAccountTypes: 0, socialAccounts: 0, profileVersions: 0, networkChanges: 0 };
        const skippedCounts = { socialAccountTypes: 0, socialAccounts: 0 };
        const failedCounts = { socialAccountTypes: 0, socialAccounts: 0 };
        const importedAccountIds = new Set<string>();
        const socialAccountIdMap = new Map<string, string>();
        const allSocialAccounts = await storage.getAllSocialAccounts();
  
        const socialAccountTypeBlocks = parseAllTags("social_account_type", xmlText);
        for (const block of socialAccountTypeBlocks) {
          try {
            const id = unescapeXml(parseXmlTag("id", block));
            const name = unescapeXml(parseXmlTag("name", block));
            const color = unescapeXml(parseXmlTag("color", block));
  
            if (!id || !name || !color) {
              failedCounts.socialAccountTypes++;
              continue;
            }
  
            const existing = await storage.getSocialAccountTypeById(id);
            if (existing) {
              skippedCounts.socialAccountTypes++;
              continue;
            }
  
            await storage.createSocialAccountTypeWithId({ id, name, color });
            importedCounts.socialAccountTypes++;
          } catch (error) {
            console.error("Error importing social account type:", error);
            failedCounts.socialAccountTypes++;
          }
        }
  
        const socialAccountBlocks = parseAllTags("social_account", xmlText);
        for (const block of socialAccountBlocks) {
          try {
            const id = unescapeXml(parseXmlTag("id", block));
            const username = unescapeXml(parseXmlTag("username", block));
  
            if (!id || !username) {
              failedCounts.socialAccounts++;
              continue;
            }
  
            const nickname = unescapeXml(parseXmlTag("nickname", block));
            const accountUrl = unescapeXml(parseXmlTag("account_url", block));
            const ownerUuid = unescapeXml(parseXmlTag("owner_uuid", block));
            const typeId = unescapeXml(parseXmlTag("type_id", block));
            const imageUrl = unescapeXml(parseXmlTag("image_url", block));
            const following = parseXmlArray("following", "account_id", block);
            const followers = parseXmlArray("followers", "account_id", block);
  
            const existing = allSocialAccounts.find(
              acc => acc.id === id || (acc.username.toLowerCase() === username.toLowerCase() && acc.typeId === (typeId || null))
            );
            if (existing) {
              skippedCounts.socialAccounts++;
              socialAccountIdMap.set(id, existing.id);
              importedAccountIds.add(id);
              continue;
            }
  
            const created = await storage.createSocialAccountWithId({
              id,
              username,
              ownerUuid: ownerUuid || null,
              typeId: typeId || null,
            });
            socialAccountIdMap.set(id, id);
            allSocialAccounts.push(created);
  
            if (nickname || accountUrl || imageUrl) {
              if (created.currentProfile) {
                await storage.updateProfileVersion(created.currentProfile.id, {
                  nickname: nickname || null,
                  accountUrl: accountUrl || null,
                  imageUrl: imageUrl || null,
                });
              }
            }
  
            if ((followers && followers.length > 0) || (following && following.length > 0)) {
              await storage.upsertNetworkState({
                socialAccountId: id,
                followerCount: followers.length,
                followingCount: following.length,
                followers: followers.map((f: string) => unescapeXml(f)),
                following: following.map((f: string) => unescapeXml(f)),
              });
            }
  
            importedCounts.socialAccounts++;
            importedAccountIds.add(id);
          } catch (error) {
            console.error("Error importing social account:", error);
            failedCounts.socialAccounts++;
          }
        }
  
        const profileVersionBlocks = parseAllTags("social_profile_version", xmlText);
        for (const block of profileVersionBlocks) {
          try {
            const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
            const pvNickname = unescapeXml(parseXmlTag("nickname", block));
            const pvBio = unescapeXml(parseXmlTag("bio", block));
            const pvAccountUrl = unescapeXml(parseXmlTag("account_url", block));
            const pvImageUrl = unescapeXml(parseXmlTag("image_url", block));
            const pvExternalImageUrl = unescapeXml(parseXmlTag("external_image_url", block));
            const pvIsCurrent = parseXmlTag("is_current", block) === "true";
  
            if (!socialAccountId || !importedAccountIds.has(socialAccountId)) continue;
  
            const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
            await storage.createProfileVersion({
              socialAccountId: mappedAccountId,
              nickname: pvNickname || null,
              bio: pvBio || null,
              accountUrl: pvAccountUrl || null,
              imageUrl: pvImageUrl || null,
              externalImageUrl: pvExternalImageUrl || null,
              isCurrent: pvIsCurrent,
            });
            importedCounts.profileVersions++;
          } catch (error) {
            console.error("Error importing profile version:", error);
          }
        }
  
        const snapshotBlocks = parseAllTags("social_network_snapshot", xmlText);
        for (const block of snapshotBlocks) {
          try {
            const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
            const followerCount = parseInt(parseXmlTag("follower_count", block)) || 0;
            const followingCount = parseInt(parseXmlTag("following_count", block)) || 0;
            const snFollowers = parseXmlArray("followers", "account_id", block);
            const snFollowing = parseXmlArray("following", "account_id", block);
  
            if (!socialAccountId || !importedAccountIds.has(socialAccountId)) continue;
  
            const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
            await storage.upsertNetworkState({
              socialAccountId: mappedAccountId,
              followerCount,
              followingCount,
              followers: snFollowers,
              following: snFollowing,
            });
          } catch (error) {
            console.error("Error importing network snapshot:", error);
          }
        }
  
        const networkChangeBlocks = parseAllTags("social_network_change", xmlText);
        for (const block of networkChangeBlocks) {
          try {
            const socialAccountId = unescapeXml(parseXmlTag("social_account_id", block));
            const changeType = unescapeXml(parseXmlTag("change_type", block));
            const direction = unescapeXml(parseXmlTag("direction", block));
            const targetAccountId = unescapeXml(parseXmlTag("target_account_id", block));
            const detectedAtStr = unescapeXml(parseXmlTag("detected_at", block));
            const batchId = unescapeXml(parseXmlTag("batch_id", block));
  
            if (!socialAccountId || !importedAccountIds.has(socialAccountId)) continue;
            if (!changeType || !direction || !targetAccountId) continue;
  
            const mappedAccountId = socialAccountIdMap.get(socialAccountId) || socialAccountId;
            await db.insert(socialNetworkChanges).values({
              socialAccountId: mappedAccountId,
              changeType,
              direction,
              targetAccountId,
              detectedAt: detectedAtStr ? new Date(detectedAtStr) : new Date(),
              batchId: batchId || null,
            });
            importedCounts.networkChanges++;
          } catch (error) {
            console.error("Error importing network change:", error);
          }
        }

        await runAutomaticImagePassIn();
  
        res.json({
          imported: importedCounts,
          skipped: skippedCounts,
          failed: failedCounts,
        });
      } catch (error) {
        console.error("Error importing social accounts XML:", error);
        res.status(500).json({ error: "Failed to import social accounts" });
      }
    });
  
    app.get("/api/social-accounts/:id", async (req, res) => {
      try {
        const account = await storage.getSocialAccountById(req.params.id);
        if (!account) {
          return res.status(404).json({ error: "Social account not found" });
        }
        res.json(account);
      } catch (error) {
        console.error("Error fetching social account:", error);
        res.status(500).json({ error: "Failed to fetch social account" });
      }
    });
  
    app.post("/api/social-accounts", async (req, res) => {
      try {
        const validatedData = insertSocialAccountSchema.parse(req.body);
        const account = await storage.createSocialAccount(validatedData);
        sseManager.broadcast("social_account.created", { id: account.id, username: account.username });
        syncEntityInBackground("social_account", account.id);
        res.status(201).json(account);
      } catch (error) {
        console.error("Error creating social account:", error);
        res.status(400).json({ error: "Failed to create social account" });
      }
    });
  
    app.patch("/api/social-accounts/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const body = req.body;
  
        const registryFields: Record<string, any> = {};
        if (body.username !== undefined) registryFields.username = body.username;
        if (body.ownerUuid !== undefined) registryFields.ownerUuid = body.ownerUuid;
        if (body.groupId !== undefined) registryFields.groupId = body.groupId;
        if (body.typeId !== undefined) registryFields.typeId = body.typeId;
        if (body.internalAccountCreationType !== undefined) registryFields.internalAccountCreationType = body.internalAccountCreationType;
        if (body.lastScrapedAt !== undefined) registryFields.lastScrapedAt = body.lastScrapedAt;
  
        if (Object.keys(registryFields).length > 0) {
          await storage.updateSocialAccount(id, registryFields);
        }
  
        const profileFields: Record<string, any> = {};
        if (body.nickname !== undefined) profileFields.nickname = body.nickname;
        if (body.accountUrl !== undefined) profileFields.accountUrl = body.accountUrl;
        if (body.imageUrl !== undefined) profileFields.imageUrl = body.imageUrl;
        if (body.bio !== undefined) profileFields.bio = body.bio;
  
        if (Object.keys(profileFields).length > 0) {
          const currentProfile = await storage.getCurrentProfileVersion(id);
          if (currentProfile) {
            await storage.updateProfileVersion(currentProfile.id, profileFields);
          } else {
            await storage.createProfileVersion({
              socialAccountId: id,
              isCurrent: true,
              ...profileFields,
            });
          }
        }
  
        const account = await storage.getSocialAccountById(id);
        if (!account) {
          return res.status(404).json({ error: "Social account not found" });
        }

        await autoPassInImageForSocialAccount(id);
  
        sseManager.broadcast("social_account.updated", { id });
        syncEntityInBackground("social_account", id);
        res.json(account);
      } catch (error) {
        console.error("Error updating social account:", error);
        res.status(400).json({ error: "Failed to update social account" });
      }
    });
  
    app.delete("/api/social-accounts/delete-all", async (req, res) => {
      try {
        const count = await storage.deleteAllSocialAccounts();
        res.json({ success: true, deleted: count });
      } catch (error) {
        console.error("Error deleting all social accounts:", error);
        res.status(500).json({ error: "Failed to delete all social accounts" });
      }
    });

    app.post("/api/social-accounts/remove-duplicates", async (req, res) => {
      try {
        // Find duplicate accounts and their vector IDs before we delete them
        const allAccounts = await db.select().from(socialAccounts);
        const groups = new Map<string, typeof allAccounts>();
        for (const acc of allAccounts) {
          const key = `${acc.username.toLowerCase()}::${acc.typeId || "null"}`;
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)!.push(acc);
        }

        const duplicateVectorIds: string[] = [];
        const keptAccountIds: string[] = [];

        for (const [key, group] of groups.entries()) {
          if (group.length <= 1) continue;
          const sorted = group.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.getTime() : 0;
            const timeB = b.createdAt ? b.createdAt.getTime() : 0;
            return timeA - timeB;
          });
          const keptAccount = sorted[0];
          keptAccountIds.push(keptAccount.id);
          const duplicates = sorted.slice(1);
          for (const dup of duplicates) {
            if (dup.vectorId) {
              duplicateVectorIds.push(dup.vectorId);
            }
          }
        }

        // Call database cleanup
        const count = await storage.removeDuplicateSocialAccounts();

        // Delete vector points for deleted accounts
        for (const vectorId of duplicateVectorIds) {
          void deleteEntityVector("social_account", vectorId);
        }

        // Sync vector points for kept accounts
        for (const id of keptAccountIds) {
          void syncEntityInBackground("social_account", id);
        }

        res.json({ success: true, deleted: count });
      } catch (error) {
        console.error("Error removing duplicate social accounts:", error);
        res.status(500).json({ error: "Failed to remove duplicate social accounts" });
      }
    });

    app.post("/api/maintenance/remove-duplicate-types", async (req, res) => {
      try {
        const result = await storage.removeDuplicateRelationshipAndInteractionTypes();
        res.json({ success: true, ...result });
      } catch (error) {
        console.error("Error removing duplicate types:", error);
        res.status(500).json({ error: "Failed to remove duplicate types" });
      }
    });
  
    app.delete("/api/social-accounts/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const [row] = await db.select({ vectorId: socialAccounts.vectorId }).from(socialAccounts).where(eq(socialAccounts.id, id));
        await storage.deleteSocialAccount(id);
        if (row?.vectorId) void deleteEntityVector("social_account", row.vectorId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting social account:", error);
        res.status(500).json({ error: "Failed to delete social account" });
      }
    });
  
    // Get accounts that follow a specific account (from network state)
    app.get("/api/social-accounts/:id/followers", async (req, res) => {
      try {
        const { id } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const state = await storage.getNetworkState(id);
  
        if (!state || !state.followers || state.followers.length === 0) {
          return res.json({ items: [], total: 0, page, limit });
        }
  
        const total = state.followers.length;
        const start = (page - 1) * limit;
        const pageIds = state.followers.slice(start, start + limit);
  
        const followerAccounts = [];
        for (const followerId of pageIds) {
          const account = await storage.getSocialAccountById(followerId);
          if (account) {
            followerAccounts.push(account);
          }
        }
  
        res.json({ items: followerAccounts, total, page, limit });
      } catch (error) {
        console.error("Error fetching followers:", error);
        res.status(500).json({ error: "Failed to fetch followers" });
      }
    });
  
    app.get("/api/social-accounts/:id/following", async (req, res) => {
      try {
        const { id } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const state = await storage.getNetworkState(id);
  
        if (!state || !state.following || state.following.length === 0) {
          return res.json({ items: [], total: 0, page, limit });
        }
  
        const total = state.following.length;
        const start = (page - 1) * limit;
        const pageIds = state.following.slice(start, start + limit);
  
        const followingAccounts = [];
        for (const followingId of pageIds) {
          const account = await storage.getSocialAccountById(followingId);
          if (account) {
            followingAccounts.push(account);
          }
        }
  
        res.json({ items: followingAccounts, total, page, limit });
      } catch (error) {
        console.error("Error fetching following:", error);
        res.status(500).json({ error: "Failed to fetch following" });
      }
    });
  
    // Profile versions and network snapshots endpoints
    app.get("/api/social-accounts/:id/profile-versions", async (req, res) => {
      try {
        const { id } = req.params;
        const versions = await storage.getProfileVersions(id);
        res.json(versions);
      } catch (error) {
        console.error("Error fetching profile versions:", error);
        res.status(500).json({ error: "Failed to fetch profile versions" });
      }
    });
  
    app.get("/api/social-accounts/:id/network-changes", async (req, res) => {
      try {
        const { id } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        const changes = await storage.getNetworkChanges(id, limit);
        res.json(changes);
      } catch (error) {
        console.error("Error fetching network changes:", error);
        res.status(500).json({ error: "Failed to fetch network changes" });
      }
    });
  
    app.get("/api/social-accounts/:id/network-state", async (req, res) => {
      try {
        const { id } = req.params;
        const state = await storage.getNetworkState(id);
        res.json(state);
      } catch (error) {
        console.error("Error fetching network state:", error);
        res.status(500).json({ error: "Failed to fetch network state" });
      }
    });
  
    app.post("/api/social-accounts/:id/network-state", async (req, res) => {
      try {
        const { id } = req.params;
        const account = await storage.getSocialAccountById(id);
        if (!account) {
          return res.status(404).json({ error: "Social account not found" });
        }
  
        const oldState = await storage.getNetworkState(id);
        const oldFollowers = new Set(oldState?.followers || []);
        const oldFollowing = new Set(oldState?.following || []);
        const newFollowers = new Set<string>(req.body.followers || []);
        const newFollowing = new Set<string>(req.body.following || []);
  
        const batchId = crypto.randomUUID();
        const changes: { socialAccountId: string; changeType: string; direction: string; targetAccountId: string; batchId: string }[] = [];
  
        for (const f of Array.from(newFollowers)) {
          if (!oldFollowers.has(f)) {
            changes.push({ socialAccountId: id, changeType: 'follow', direction: 'follower', targetAccountId: f, batchId });
          }
        }
        for (const f of Array.from(oldFollowers)) {
          if (!newFollowers.has(f)) {
            changes.push({ socialAccountId: id, changeType: 'unfollow', direction: 'follower', targetAccountId: f, batchId });
          }
        }
        for (const f of Array.from(newFollowing)) {
          if (!oldFollowing.has(f)) {
            changes.push({ socialAccountId: id, changeType: 'follow', direction: 'following', targetAccountId: f, batchId });
          }
        }
        for (const f of Array.from(oldFollowing)) {
          if (!newFollowing.has(f)) {
            changes.push({ socialAccountId: id, changeType: 'unfollow', direction: 'following', targetAccountId: f, batchId });
          }
        }
  
        if (changes.length > 0) {
          await storage.recordNetworkChanges(changes);
        }
  
        const state = await storage.upsertNetworkState({
          socialAccountId: id,
          followerCount: newFollowers.size,
          followingCount: newFollowing.size,
          followers: Array.from(newFollowers),
          following: Array.from(newFollowing),
        });
        res.status(201).json(state);
      } catch (error) {
        console.error("Error updating network state:", error);
        res.status(500).json({ error: "Failed to update network state" });
      }
    });
  
    // Social account post endpoints
    app.get("/api/social-accounts/:id/posts", async (req, res) => {
      try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
        const includeDeleted = req.query.includeDeleted === "true";
        const posts = await storage.getPostsBySocialAccountId(req.params.id, includeDeleted);
        res.json(posts);
      } catch (error) {
        console.error("Error fetching posts:", error);
        res.status(500).json({ error: "Failed to fetch posts" });
      }
    });
  
    app.get("/api/social-account-posts/:id", async (req, res) => {
      try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
        const post = await storage.getPostById(req.params.id);
        if (!post) return res.status(404).json({ error: "Post not found" });
        res.json(post);
      } catch (error) {
        console.error("Error fetching post:", error);
        res.status(500).json({ error: "Failed to fetch post" });
      }
    });
  
    app.post("/api/social-accounts/:id/posts", async (req, res) => {
      try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
        const parsed = insertSocialAccountPostSchema.parse({
          ...req.body,
          socialAccountId: req.params.id,
        });
        const post = await storage.createPost(parsed);
        res.status(201).json(post);
      } catch (error) {
        console.error("Error creating post:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid post data", details: error.errors });
        }
        res.status(500).json({ error: "Failed to create post" });
      }
    });
  
    app.patch("/api/social-account-posts/:id", async (req, res) => {
      try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
        const allowedFields = ["postType", "content", "description", "likeCount", "commentCount", "comments", "mentionedAccounts", "isDeleted", "postedAt"];
        const updateData: Record<string, unknown> = {};
        for (const key of allowedFields) {
          if (key in req.body) {
            updateData[key] = req.body[key];
          }
        }
        const post = await storage.updatePost(req.params.id, updateData);
        if (!post) return res.status(404).json({ error: "Post not found" });
        res.json(post);
      } catch (error) {
        console.error("Error updating post:", error);
        res.status(500).json({ error: "Failed to update post" });
      }
    });
  
    app.delete("/api/social-account-posts/:id", async (req, res) => {
      try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
        await storage.deletePost(req.params.id);
        res.status(204).end();
      } catch (error) {
        console.error("Error deleting post:", error);
        res.status(500).json({ error: "Failed to delete post" });
      }
    });
  
    // Social account types endpoints
    app.get("/api/social-account-types", async (req, res) => {
      try {
        const types = await storage.getAllSocialAccountTypes();
        res.json(types);
      } catch (error) {
        console.error("Error fetching social account types:", error);
        res.status(500).json({ error: "Failed to fetch social account types" });
      }
    });
  
    app.get("/api/social-account-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const type = await storage.getSocialAccountTypeById(id);
  
        if (!type) {
          return res.status(404).json({ error: "Social account type not found" });
        }
  
        res.json(type);
      } catch (error) {
        console.error("Error fetching social account type:", error);
        res.status(500).json({ error: "Failed to fetch social account type" });
      }
    });
  
    app.post("/api/social-account-types", async (req, res) => {
      try {
        const validatedData = insertSocialAccountTypeSchema.parse(req.body);
        const type = await storage.createSocialAccountType(validatedData);
        res.status(201).json(type);
      } catch (error) {
        console.error("Error creating social account type:", error);
        res.status(400).json({ error: "Failed to create social account type" });
      }
    });
  
    app.patch("/api/social-account-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const validatedData = insertSocialAccountTypeSchema.partial().parse(req.body);
        const type = await storage.updateSocialAccountType(id, validatedData);
  
        if (!type) {
          return res.status(404).json({ error: "Social account type not found" });
        }
  
        res.json(type);
      } catch (error) {
        console.error("Error updating social account type:", error);
        res.status(400).json({ error: "Failed to update social account type" });
      }
    });
  
    app.delete("/api/social-account-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        await storage.deleteSocialAccountType(id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting social account type:", error);
        res.status(500).json({ error: "Failed to delete social account type" });
      }
    });
  
    // Relationship types endpoints
    app.get("/api/relationship-types", async (req, res) => {
      try {
        const relationshipTypes = await storage.getAllRelationshipTypes();
        res.json(relationshipTypes);
      } catch (error) {
        console.error("Error fetching relationship types:", error);
        res.status(500).json({ error: "Failed to fetch relationship types" });
      }
    });
  
    app.get("/api/relationship-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const relationshipType = await storage.getRelationshipTypeById(id);
  
        if (!relationshipType) {
          return res.status(404).json({ error: "Relationship type not found" });
        }
  
        res.json(relationshipType);
      } catch (error) {
        console.error("Error fetching relationship type:", error);
        res.status(500).json({ error: "Failed to fetch relationship type" });
      }
    });
  
    app.post("/api/relationship-types", async (req, res) => {
      try {
        const validatedData = insertRelationshipTypeSchema.parse(req.body);
        const relationshipType = await storage.createRelationshipType(validatedData);
        res.status(201).json(relationshipType);
      } catch (error) {
        console.error("Error creating relationship type:", error);
        res.status(400).json({ error: "Failed to create relationship type" });
      }
    });
  
    app.patch("/api/relationship-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const validatedData = insertRelationshipTypeSchema.partial().parse(req.body);
        const relationshipType = await storage.updateRelationshipType(id, validatedData);
  
        if (!relationshipType) {
          return res.status(404).json({ error: "Relationship type not found" });
        }
  
        res.json(relationshipType);
      } catch (error) {
        console.error("Error updating relationship type:", error);
        res.status(400).json({ error: "Failed to update relationship type" });
      }
    });
  
    app.delete("/api/relationship-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        await storage.deleteRelationshipType(id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting relationship type:", error);
        res.status(500).json({ error: "Failed to delete relationship type" });
      }
    });
  
    // Interaction types endpoints
    app.get("/api/interaction-types", async (req, res) => {
      try {
        const interactionTypes = await storage.getAllInteractionTypes();
        res.json(interactionTypes);
      } catch (error) {
        console.error("Error fetching interaction types:", error);
        res.status(500).json({ error: "Failed to fetch interaction types" });
      }
    });
  
    app.get("/api/interaction-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const interactionType = await storage.getInteractionTypeById(id);
  
        if (!interactionType) {
          return res.status(404).json({ error: "Interaction type not found" });
        }
  
        res.json(interactionType);
      } catch (error) {
        console.error("Error fetching interaction type:", error);
        res.status(500).json({ error: "Failed to fetch interaction type" });
      }
    });
  
    app.post("/api/interaction-types", async (req, res) => {
      try {
        const validatedData = insertInteractionTypeSchema.parse(req.body);
        const interactionType = await storage.createInteractionType(validatedData);
        res.status(201).json(interactionType);
      } catch (error) {
        console.error("Error creating interaction type:", error);
        res.status(400).json({ error: "Failed to create interaction type" });
      }
    });
  
    app.patch("/api/interaction-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const validatedData = insertInteractionTypeSchema.partial().parse(req.body);
        const interactionType = await storage.updateInteractionType(id, validatedData);
  
        if (!interactionType) {
          return res.status(404).json({ error: "Interaction type not found" });
        }
  
        res.json(interactionType);
      } catch (error) {
        console.error("Error updating interaction type:", error);
        res.status(400).json({ error: "Failed to update interaction type" });
      }
    });
  
    app.delete("/api/interaction-types/:id", async (req, res) => {
      try {
        const id = req.params.id;
        await storage.deleteInteractionType(id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting interaction type:", error);
        res.status(500).json({ error: "Failed to delete interaction type" });
      }
    });
  
    app.get("/api/account-matching/next", async (req, res) => {
      try {
        const skipParam = req.query.skip as string | undefined;
        const skipIds = skipParam ? skipParam.split(",").filter(Boolean) : [];
  
        const allPeople = await storage.getAllPeople();
        const unmatchedPerson = allPeople.find(
          (p) =>
            (!p.socialAccountUuids || p.socialAccountUuids.length === 0) &&
            p.noSocialMedia === 0 &&
            !skipIds.includes(p.id)
        );
  
        if (!unmatchedPerson) {
          return res.json({ person: null, candidates: [] });
        }
  
        const fullName = `${unmatchedPerson.firstName} ${unmatchedPerson.lastName}`.toLowerCase();
        const firstName = unmatchedPerson.firstName.toLowerCase();
        const lastName = unmatchedPerson.lastName.toLowerCase();
  
        const allAccounts = await storage.getAllSocialAccounts();
        const unownedAccounts = allAccounts.filter((a) => !a.ownerUuid);
  
        const scored = unownedAccounts.map((account) => {
          let score = 0;
          const username = (account.username || "").toLowerCase();
          const nickname = (account.currentProfile?.nickname || "").toLowerCase();
  
          if (nickname === fullName || username === fullName.replace(/\s+/g, "")) {
            score += 100;
          }
          if (nickname.includes(firstName) || username.includes(firstName)) {
            score += 40;
          }
          if (nickname.includes(lastName) || username.includes(lastName)) {
            score += 40;
          }
          if (nickname.includes(fullName) || username.includes(fullName.replace(/\s+/g, ""))) {
            score += 60;
          }
          const nameParts = fullName.split(" ");
          for (const part of nameParts) {
            if (part.length > 2 && (username.includes(part) || nickname.includes(part))) {
              score += 20;
            }
          }
  
          return { account, score };
        });
  
        scored.sort((a, b) => b.score - a.score);
        const candidates = scored.filter((s) => s.score > 0).slice(0, 8);
  
        if (candidates.length < 5) {
          const remaining = unownedAccounts
            .filter((a) => !candidates.find((c) => c.account.id === a.id))
            .slice(0, 8 - candidates.length);
          for (const account of remaining) {
            candidates.push({ account, score: 0 });
          }
        }
  
        const accountTypes = await storage.getAllSocialAccountTypes();
        const candidatesWithType = candidates.slice(0, 8).map((c) => ({
          ...c.account,
          typeName: accountTypes.find((t) => t.id === c.account.typeId)?.name || null,
          typeColor: accountTypes.find((t) => t.id === c.account.typeId)?.color || null,
          matchScore: c.score,
        }));
  
        res.json({ person: unmatchedPerson, candidates: candidatesWithType });
      } catch (error) {
        console.error("Error getting account matching data:", error);
        res.status(500).json({ error: "Failed to get account matching data" });
      }
    });
  
    app.post("/api/account-matching/connect", async (req, res) => {
      try {
        const connectSchema = z.object({
          personId: z.string().min(1),
          socialAccountIds: z.array(z.string()).min(1),
        });
        const { personId, socialAccountIds } = connectSchema.parse(req.body);
  
        const person = await storage.getPersonById(personId);
        if (!person) {
          return res.status(404).json({ error: "Person not found" });
        }
  
        const currentUuids = person.socialAccountUuids || [];
        const combined = [...currentUuids, ...socialAccountIds];
        const newUuids = combined.filter((v, i) => combined.indexOf(v) === i);
  
        await storage.updatePerson(personId, { socialAccountUuids: newUuids });
  
        for (const accountId of socialAccountIds) {
          await storage.updateSocialAccount(accountId, { ownerUuid: personId });
        }
  
        if (!person.imageUrl) {
          for (const accountId of socialAccountIds) {
            const account = await storage.getSocialAccountById(accountId);
            if (account?.currentProfile?.imageUrl) {
              await storage.updatePerson(personId, { imageUrl: account.currentProfile.imageUrl });
              break;
            }
          }
        }
  
        res.json({ success: true });
      } catch (error) {
        console.error("Error connecting accounts:", error);
        res.status(500).json({ error: "Failed to connect accounts" });
      }
    });
  
    app.post("/api/image-pass-in", async (req, res) => {
      try {
        const result = await runAutomaticImagePassIn();
        res.json(result);
      } catch (error) {
        console.error("Error in image pass-in:", error);
        res.status(500).json({ error: "Failed to process image pass-in" });
      }
    });
  
    app.post("/api/account-matching/ignore", async (req, res) => {
      try {
        const ignoreSchema = z.object({ personId: z.string().min(1) });
        const { personId } = ignoreSchema.parse(req.body);
  
        await storage.updatePerson(personId, { noSocialMedia: 1 });
        res.json({ success: true });
      } catch (error) {
        console.error("Error ignoring person:", error);
        res.status(500).json({ error: "Failed to update person" });
      }
    });
  
    // Task management routes
    app.get("/api/tasks", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
        const status = req.query.status as string | undefined;
        let taskList;
        if (status) {
          taskList = await storage.getTasksByStatus(status);
        } else {
          taskList = await storage.getAllTasks(limit);
        }
        // Sanitize sensitive fields and filter by ownership for tasks that carry userId in payload
        const sanitized = taskList.map(t => {
          let payloadObj: Record<string, unknown> = {};
          try { payloadObj = JSON.parse(t.payload || "{}"); } catch {}
          // Skip tasks belonging to another user
          if (payloadObj.userId !== undefined && payloadObj.userId !== req.user!.id) return null;
          // Strip raw XML from import payloads; expose result on completed/failed/cancelled
          if (t.type === "import_xml") {
            const { xml: _dropped, ...rest } = payloadObj as { xml?: string };
            const exposeResult = t.status === "completed" || t.status === "failed" || t.status === "cancelled";
            return { ...t, payload: JSON.stringify(rest), result: exposeResult ? t.result : null };
          }
          // Export: never send large XML in list; expose result on failure for error display
          if (t.type === "export_xml") {
            const exposeResult = t.status === "failed" || t.status === "cancelled";
            return { ...t, result: exposeResult ? t.result : null };
          }
          return t;
        }).filter(Boolean);
        res.json(sanitized);
      } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ error: "Failed to fetch tasks" });
      }
    });
  
    app.get("/api/tasks/social-accounts-brief", async (req, res) => {
      try {
        // Lean query: only fetch the three fields needed, avoiding the heavy full join
        const rows = await db
          .select({
            id: socialAccounts.id,
            username: socialAccounts.username,
            nickname: socialProfileVersions.nickname,
          })
          .from(socialAccounts)
          .leftJoin(
            socialProfileVersions,
            and(
              eq(socialProfileVersions.socialAccountId, socialAccounts.id),
              eq(socialProfileVersions.isCurrent, true)
            )
          )
          .orderBy(socialAccounts.username);
        res.json(rows.map(r => ({ id: r.id, username: r.username, nickname: r.nickname ?? null })));
      } catch (error) {
        console.error("Error fetching brief accounts:", error);
        res.status(500).json({ error: "Failed to fetch accounts" });
      }
    });
  
    app.get("/api/tasks/worker-status", (_req, res) => {
      res.json({ paused: isTaskWorkerPaused() });
    });
  
    app.get("/api/tasks/:id", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const task = await storage.getTaskById(req.params.id);
        if (!task) {
          return res.status(404).json({ error: "Task not found" });
        }
        // Verify ownership for tasks that carry a userId in their payload
        let payloadObj: Record<string, unknown> = {};
        try { payloadObj = JSON.parse(task.payload || "{}"); } catch {}
        if (payloadObj.userId !== undefined && payloadObj.userId !== req.user.id) {
          return res.status(403).json({ error: "Access denied" });
        }
        // Build a sanitized response:
        //   import_xml  — strip raw XML from payload; expose result only on completed/failed
        //   export_xml  — never send large XML result inline; clients fetch via /download
        if (task.type === "import_xml") {
          const { xml: _dropped, ...safePayload } = payloadObj as { xml?: string };
          const exposeResult = task.status === "completed" || task.status === "failed" || task.status === "cancelled";
          return res.json({ ...task, payload: JSON.stringify(safePayload), result: exposeResult ? task.result : null });
        }
        if (task.type === "export_xml") {
          // Expose result on failure so the client can display the error inline
          const exposeResult = task.status === "failed" || task.status === "cancelled";
          return res.json({ ...task, result: exposeResult ? task.result : null });
        }
        res.json(task);
      } catch (error) {
        console.error("Error fetching task:", error);
        res.status(500).json({ error: "Failed to fetch task" });
      }
    });
  
    app.delete("/api/tasks/:id", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const task = await storage.getTaskById(req.params.id);
        if (!task) {
          return res.status(404).json({ error: "Task not found" });
        }
        // Verify ownership for tasks with userId in payload
        try {
          const payload = JSON.parse(task.payload || "{}");
          if (payload.userId !== undefined && payload.userId !== req.user.id) {
            return res.status(403).json({ error: "Access denied" });
          }
        } catch {}
        if (task.status !== "pending" && task.status !== "in_progress") {
          return res.status(400).json({ error: "Can only cancel pending or running tasks" });
        }
        const updated = await storage.updateTaskStatus(req.params.id, "cancelled", "Cancelled by user");
        res.json(updated);
      } catch (error) {
        console.error("Error cancelling task:", error);
        res.status(500).json({ error: "Failed to cancel task" });
      }
    });
  
    app.post("/api/tasks/refresh-follower-count/:socialAccountId", async (req, res) => {
      try {
        const { socialAccountId } = req.params;
        const account = await storage.getSocialAccountById(socialAccountId);
        if (!account) {
          return res.status(404).json({ error: "Social account not found" });
        }
        const task = await storage.createTask({
          type: "refresh_follower_count",
          status: "pending",
          title: account.username,
          payload: JSON.stringify({ socialAccountId }),
        });
        triggerTaskWorker();
        res.json(task);
      } catch (error) {
        console.error("Error creating refresh task:", error);
        res.status(500).json({ error: "Failed to create refresh task" });
      }
    });
  
    app.post("/api/tasks/mass-refresh-follower-count", async (req, res) => {
      try {
        const task = await storage.createTask({
          type: "mass_refresh_follower_count",
          status: "pending",
          payload: JSON.stringify({}),
        });
        triggerTaskWorker();
        res.json(task);
      } catch (error) {
        console.error("Error creating mass refresh task:", error);
        res.status(500).json({ error: "Failed to create mass refresh task" });
      }
    });
  
    // POST /api/tasks/export-xml — creates a background export_xml task
    app.post("/api/tasks/export-xml", async (req, res) => {
      try {
        if (!req.isAuthenticated() || !req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const includeHistory = req.body.includeHistory === true || req.body.includeHistory === "true";
        const task = await storage.createTask({
          type: "export_xml",
          status: "pending",
          payload: JSON.stringify({ includeHistory, userId: req.user.id }),
        });
        triggerTaskWorker();
        res.json(task);
      } catch (error) {
        console.error("Error creating export_xml task:", error);
        res.status(500).json({ error: "Failed to create export task" });
      }
    });
  
    // POST /api/tasks/import-xml — creates a background import_xml task
    app.post("/api/tasks/import-xml", upload.single("xml"), async (req, res) => {
      try {
        if (!req.isAuthenticated() || !req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        if (!req.file) {
          return res.status(400).json({ error: "No XML file provided" });
        }
        const xmlText = req.file.buffer.toString("utf-8");
        const task = await storage.createTask({
          type: "import_xml",
          status: "pending",
          payload: JSON.stringify({ xml: xmlText, userId: req.user.id }),
        });
        triggerTaskWorker();
        res.json(task);
      } catch (error) {
        console.error("Error creating import_xml task:", error);
        res.status(500).json({ error: "Failed to create import task" });
      }
    });

    // POST /api/tasks/multi-image-download — creates a background multi_image_download task
    app.post("/api/tasks/multi-image-download", async (req, res) => {
      try {
        if (!req.isAuthenticated() || !req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        const { images } = req.body;
        if (!Array.isArray(images)) {
          return res.status(400).json({ error: "images must be an array" });
        }

        if (images.length === 0 || images.length > 999) {
          return res.status(400).json({ error: "images array must contain between 1 and 999 items" });
        }

        const resolvedImages = images.map((item: any) => {
          if (typeof item === "string") {
            return {
              url: item,
              uuid: crypto.randomUUID(),
            };
          } else if (item && typeof item === "object" && typeof item.url === "string") {
            return {
              url: item.url,
              uuid: typeof item.uuid === "string" && item.uuid ? item.uuid : crypto.randomUUID(),
              prmLocation: typeof item.prmLocation === "string" ? item.prmLocation : undefined,
              isSubImage: typeof item.isSubImage === "boolean" ? item.isSubImage : undefined,
              metadata: item.metadata,
              ogMetadata: item.ogMetadata,
            };
          } else {
            throw new Error("Each item in images must be a URL string or an object with a url string");
          }
        });

        const task = await storage.createTask({
          type: "multi_image_download",
          status: "pending",
          payload: JSON.stringify({ images: resolvedImages }),
        });

        triggerTaskWorker();

        // Started return: returns the UUIDs for all the images
        res.json({
          taskId: task.id,
          uuids: resolvedImages.map(img => img.uuid),
          status: "pending",
        });
      } catch (error) {
        console.error("Error creating multi_image_download task:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create download task" });
      }
    });

    // GET /api/tasks/:id/download — streams the XML result of a completed export_xml task
    app.get("/api/tasks/:id/download", async (req, res) => {
      try {
        if (!req.isAuthenticated() || !req.user) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        const task = await storage.getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: "Task not found" });
        if (task.type !== "export_xml") return res.status(400).json({ error: "Not an export task" });
        // Verify ownership
        try {
          const payload = JSON.parse(task.payload || "{}");
          if (payload.userId !== undefined && payload.userId !== req.user.id) {
            return res.status(403).json({ error: "Access denied" });
          }
        } catch {}
        if (task.status !== "completed") return res.status(400).json({ error: "Export not yet completed" });
        if (!task.result) return res.status(400).json({ error: "No export data available" });
        const date = new Date().toISOString().split("T")[0];
        res.setHeader("Content-Type", "application/xml");
        res.setHeader("Content-Disposition", `attachment; filename="crm-export-${date}.xml"`);
        // New path: task.result is a relative file path like "exports/crm-export-<id>.xml"
        if (task.result.startsWith("exports/")) {
          const absPath = path.join(process.cwd(), task.result);
          if (fs.existsSync(absPath)) {
            return fs.createReadStream(absPath).pipe(res);
          }
        }
        // Legacy fallback: task.result holds the raw XML blob
        res.send(task.result);
      } catch (error) {
        console.error("Error downloading export:", error);
        res.status(500).json({ error: "Failed to download export" });
      }
    });
  
    app.post("/api/tasks/pause", (_req, res) => {
      pauseTaskWorker();
      res.json({ paused: true });
    });
  
    app.post("/api/tasks/unpause", (_req, res) => {
      resumeTaskWorker();
      res.json({ paused: false });
    });
  
    app.delete("/api/tasks", async (_req, res) => {
      try {
        await storage.deleteAllTasks();
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting all tasks:", error);
        res.status(500).json({ error: "Failed to delete all tasks" });
      }
    });
  
    // ── Image task endpoints ──────────────────────────────────────────────────
  
    // GET /api/image-tasks — list image tasks with optional type/status filter and pagination
    app.get("/api/image-tasks", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const type = typeof req.query.type === "string" ? req.query.type : undefined;
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const parentTaskId = typeof req.query.parentTaskId === "string" ? req.query.parentTaskId : undefined;
        const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
        const limit = 25;
        const offset = (page - 1) * limit;
        const result = await storage.listImageTasks({ type, status, parentTaskId, limit, offset });
        res.json({ items: result.items, total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) });
      } catch (error) {
        console.error("Error listing image tasks:", error);
        res.status(500).json({ error: "Failed to list image tasks" });
      }
    });
  
    // GET /api/image-tasks/:id — get a single image task
    app.get("/api/image-tasks/:id", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const task = await storage.getImageTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: "Image task not found" });
        res.json(task);
      } catch (error) {
        console.error("Error getting image task:", error);
        res.status(500).json({ error: "Failed to get image task" });
      }
    });
  
    // DELETE /api/image-tasks/:id — cancel an image task
    app.delete("/api/image-tasks/:id", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        await storage.cancelImageTask(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error("Error cancelling image task:", error);
        res.status(500).json({ error: "Failed to cancel image task" });
      }
    });
  
    // POST /api/image-tasks/download-instagram — manually enqueue a download_img_instagram task
    app.post("/api/image-tasks/download-instagram", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const { socialAccountId, imageUrl, profileVersionId, parentTaskId } = req.body;
        if (!socialAccountId || typeof socialAccountId !== "string") {
          return res.status(400).json({ error: "socialAccountId is required" });
        }
        if (!imageUrl || typeof imageUrl !== "string") {
          return res.status(400).json({ error: "imageUrl is required" });
        }
        const task = await storage.createImageTask({
          type: "download_img_instagram",
          status: "pending",
          parentTaskId: parentTaskId || null,
          payload: JSON.stringify({
            socialAccountId,
            imageUrl,
            profileVersionId: profileVersionId || null,
          }),
        });
        triggerImageTaskWorker();
        res.status(201).json(task);
      } catch (error) {
        console.error("Error creating download-instagram task:", error);
        res.status(500).json({ error: "Failed to create image task" });
      }
    });
  
    // DELETE /api/image-tasks — cancel all pending/in-progress image tasks (bulk)
    app.delete("/api/image-tasks", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const { items } = await storage.listImageTasks({ status: "pending", limit: 10000 });
        const inProgress = await storage.listImageTasks({ status: "in_progress", limit: 10000 });
        const all = [...items, ...inProgress.items];
        await Promise.all(all.map(t => storage.cancelImageTask(t.id)));
        res.json({ success: true, cancelled: all.length });
      } catch (error) {
        console.error("Error cancelling all image tasks:", error);
        res.status(500).json({ error: "Failed to cancel all image tasks" });
      }
    });
  
    // Image storage settings
    app.get("/api/image-storage/mode", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const mode = await storage.getImageStorageMode(req.user.id);
        const hasS3Creds = !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET);
        res.json({ mode, hasS3Creds });
      } catch (error) {
        console.error("Error getting image storage mode:", error);
        res.status(500).json({ error: "Failed to get image storage mode" });
      }
    });
  
    app.put("/api/image-storage/mode", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const { mode } = req.body;
        if (mode !== "s3" && mode !== "local") {
          return res.status(400).json({ error: "Invalid storage mode. Must be 's3' or 'local'" });
        }
        await storage.setImageStorageMode(req.user.id, mode);
        res.json({ success: true, mode });
      } catch (error) {
        console.error("Error setting image storage mode:", error);
        res.status(500).json({ error: "Failed to set image storage mode" });
      }
    });
  
    app.post("/api/image-storage/transfer-to-local", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const task = await storage.createTask({
          type: "transfer_images_to_local",
          status: "pending",
          payload: JSON.stringify({ userId: req.user.id }),
        });
        triggerTaskWorker();
        res.json(task);
      } catch (error) {
        console.error("Error creating transfer to local task:", error);
        res.status(500).json({ error: "Failed to create transfer task" });
      }
    });
  
    app.post("/api/image-storage/transfer-to-s3", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const task = await storage.createTask({
          type: "transfer_images_to_s3",
          status: "pending",
          payload: JSON.stringify({ userId: req.user.id }),
        });
        triggerTaskWorker();
        res.json(task);
      } catch (error) {
        console.error("Error creating transfer to S3 task:", error);
        res.status(500).json({ error: "Failed to create transfer task" });
      }
    });
  
    app.get("/api/image-storage/stats", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const allUrls = await storage.getAllImageUrls();
        const localCount = allUrls.filter(u => isLocalImageUrl(u.url)).length;
        const s3Count = allUrls.filter(u => !isLocalImageUrl(u.url)).length;
        res.json({ total: allUrls.length, local: localCount, s3: s3Count });
      } catch (error) {
        console.error("Error getting image stats:", error);
        res.status(500).json({ error: "Failed to get image stats" });
      }
    });
  
    // ========================
    // Photos API
    // ========================
  
    app.get("/api/photos", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
        const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
        const prmLocationPrefix = req.query.prmLocation as string | undefined;
        const excludeSubImages = req.query.excludeSubImages === "true";
        const result = await storage.listPhotos({ prmLocationPrefix, limit, offset, excludeSubImages });
        res.json(result);
      } catch (error) {
        console.error("Error listing photos:", error);
        res.status(500).json({ error: "Failed to list photos" });
      }
    });
  
    app.get("/api/photos/:id", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const photo = await storage.getPhotoById(req.params.id);
        if (!photo) {
          return res.status(404).json({ error: "Photo not found" });
        }
        res.json(photo);
      } catch (error) {
        console.error("Error fetching photo:", error);
        res.status(500).json({ error: "Failed to fetch photo" });
      }
    });
  
    app.get("/api/photos/:id/parent", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const parent = await storage.getPhotoParent(req.params.id);
        if (!parent) {
          return res.status(404).json({ error: "Parent photo not found" });
        }
        res.json(parent);
      } catch (error) {
        console.error("Error fetching parent photo:", error);
        res.status(500).json({ error: "Failed to fetch parent photo" });
      }
    });
  
    app.delete("/api/photos/:id", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const { id } = req.params;
        const [photo] = await db.select().from(photos).where(eq(photos.id, id));
        if (!photo) {
          return res.status(404).json({ error: "Photo not found" });
        }

        // 1. Gather all sub-image IDs
        const subImageIds: string[] = [];
        if (photo.faceUuids && Array.isArray(photo.faceUuids)) {
          for (const face of photo.faceUuids as Array<{ subImagePhotoId?: string }>) {
            if (face?.subImagePhotoId) {
              subImageIds.push(face.subImagePhotoId);
            }
          }
        }

        // 2. Gather face UUIDs from facialIds and faceUuids
        const faceUuids: string[] = [];
        if (photo.facialIds && Array.isArray(photo.facialIds)) {
          for (const face of photo.facialIds as Array<{ faceUuid?: string }>) {
            if (face?.faceUuid) {
              faceUuids.push(face.faceUuid);
            }
          }
        }
        if (photo.faceUuids && Array.isArray(photo.faceUuids)) {
          for (const face of photo.faceUuids as Array<{ faceUuid?: string }>) {
            if (face?.faceUuid) {
              faceUuids.push(face.faceUuid);
            }
          }
        }

        // 3. Find all related face records in the database
        const faceConditions = [eq(faces.photoId, id)];
        if (subImageIds.length > 0) {
          faceConditions.push(inArray(faces.photoId, subImageIds));
        }
        if (faceUuids.length > 0) {
          faceConditions.push(inArray(faces.id, faceUuids));
        }
        const dbFaces = await db.select().from(faces).where(or(...faceConditions));

        // 4. Extract all PRM-Face generated image UUIDs and face IDs
        const prmFaceImageUuids = [...new Set(dbFaces.map(f => f.photoId).filter(Boolean))] as string[];
        const faceIdsToDelete = dbFaces.map(f => f.id);

        // 5. Fetch sub-images and PRM-Face photo records
        const subImages = subImageIds.length > 0
          ? await db.select().from(photos).where(inArray(photos.id, subImageIds))
          : [];
        const prmFacePhotos = prmFaceImageUuids.length > 0
          ? await db.select().from(photos).where(inArray(photos.id, prmFaceImageUuids))
          : [];

        const allPhotosToDelete = [photo, ...subImages, ...prmFacePhotos];
        const idsToDelete = allPhotosToDelete.map(p => p.id);
        const locations = allPhotosToDelete.map(p => p.location);

        // 6. Clear imageUrl/location fields in database (people, notes, interactions)
        if (locations.length > 0) {
          await db.update(people).set({ imageUrl: null }).where(inArray(people.imageUrl, locations));
        }
        await db.update(notes).set({ imageUrl: null }).where(inArray(notes.imageUuid, idsToDelete));
        await db.update(interactions).set({ imageUrl: null }).where(inArray(interactions.imageUuid, idsToDelete));

        // 7. Delete physical files from local/S3
        for (const p of allPhotosToDelete) {
          try {
            if (isLocalImageUrl(p.location)) {
              await deleteImageLocally(p.location);
            } else if (p.location.includes(process.env.S3_BUCKET || "")) {
              await deleteImageFromS3(p.location);
            }
          } catch (err) {
            console.error(`Failed to delete physical file for photo ${p.id} at ${p.location}:`, err);
          }
        }

        // 8. Delete faces from database
        if (faceIdsToDelete.length > 0) {
          await db.delete(faces).where(inArray(faces.id, faceIdsToDelete));
        }

        // 9. Delete photos from database
        await db.delete(photos).where(inArray(photos.id, idsToDelete));

        // 10. Delete vectors from universal vector DB
        const vectorIds = allPhotosToDelete.map(p => p.vectorId).filter(Boolean) as string[];
        if (vectorIds.length > 0) {
          void deleteEntityVector("image", vectorIds);
        }

        // 11. Call PRM-Face API delete endpoint (best-effort)
        const apiUrl = await storage.getAppSetting("prm_face_api_url");
        const apiKey = await storage.getAppSetting("prm_face_api_key");
        if (apiUrl && apiKey) {
          const base = apiUrl.replace(/\/+$/, "");
          const faceServiceUuids = [...new Set([id, ...prmFaceImageUuids])];
          for (const faceUuid of faceServiceUuids) {
            try {
              const url = new URL(`${base}/api/img/delete`);
              url.searchParams.set("image_uuid", faceUuid);
              await fetch(url.toString(), {
                method: "DELETE",
                headers: { "x-api-key": apiKey },
                signal: AbortSignal.timeout(10000),
              });
            } catch (err: any) {
              console.warn(`Failed to delete image ${faceUuid} from PRM-Face service:`, err.message);
            }
          }
        }

        res.json({ success: true, deletedCount: idsToDelete.length, facesDeletedCount: faceIdsToDelete.length });
      } catch (error) {
        console.error("Error deleting photo:", error);
        res.status(500).json({ error: "Failed to delete photo" });
      }
    });

    app.post("/api/photos/backfill", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const allUrls = await storage.getAllImageUrls();
        let inserted = 0;
        let skipped = 0;
  
        // Derive a sensible prmLocation from the table/column context
        const derivePrmLocation = (table: string, column: string, id: string): string => {
          const tableMap: Record<string, string> = {
            people: "profile_image",
            notes: "note",
            interactions: "interaction",
            groups: "group_image",
            social_profile_versions: "social_profile_image",
          };
          const prefix = tableMap[table] || table;
          return `${prefix}:${id}`;
        };
  
        for (const entry of allUrls) {
          const existing = await storage.getPhotoByLocation(entry.url);
          if (existing) {
            skipped++;
            continue;
          }
          await storage.insertPhoto({
            location: entry.url,
            prmLocation: derivePrmLocation(entry.table, entry.column, entry.id),
            isSubImage: false,
          });
          inserted++;
        }
  
        res.json({ inserted, skipped, total: allUrls.length });
      } catch (error) {
        console.error("Error backfilling photos:", error);
        res.status(500).json({ error: "Failed to backfill photos" });
      }
    });
  
    app.post("/api/image-storage/delete-instagram-urls", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const result = await storage.deleteInstagramImageUrls();
        const vectorIds = result.deletedPhotos?.map((p) => p.vectorId).filter(Boolean) as string[];
        if (vectorIds?.length) {
          void deleteEntityVector("image", vectorIds);
        }
        res.json(result);
      } catch (error) {
        console.error("Error deleting Instagram image URLs:", error);
        res.status(500).json({ error: "Failed to delete Instagram image URLs" });
      }
    });

    app.post("/api/image-storage/delete-orphans", async (req, res) => {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const result = await storage.deleteOrphanPhotos();
        const vectorIds = result.deletedPhotos?.map((p) => p.vectorId).filter(Boolean) as string[];
        if (vectorIds?.length) {
          void deleteEntityVector("image", vectorIds);
        }
        res.json(result);
      } catch (error) {
        console.error("Error deleting orphan photos:", error);
        res.status(500).json({ error: "Failed to delete orphan photos" });
      }
    });
  
    // ========================
    // V1 API Endpoints
    // ========================
  
    // --- Upgrade #9: Health Check with Service Details ---
    app.get("/api/v1/ping", (_req, res) => {
      res.json({
        status: "ok",
        version: "1.4.0",
        features: [
          "social-account-search",
          "bulk-lookup",
          "sse-events",
          "rate-limiting",
          "etag-caching",
          "structured-errors",
          "compression",
        ],
        timestamp: new Date().toISOString(),
      });
    });
  
    // --- Upgrade #1: Social Account Search Endpoint ---
    app.post("/api/v1/social-accounts/search", async (req, res) => {
      try {
        const { username, platform } = req.body;
        const page = Math.max(1, parseInt(req.body.page as string) || parseInt(req.query.page as string) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(req.body.per_page as string) || parseInt(req.query.per_page as string) || 20));
  
        if (!username || typeof username !== "string") {
          return sendApiError(res, 400, ErrorCodes.VALIDATION_ERROR, "The 'username' field is required and must be a string.", {}, (req as any).requestId);
        }
  
        const { results, total } = await storage.searchSocialAccountsByUsername({
          username: username.trim(),
          platform: platform ? String(platform).trim() : undefined,
          page,
          perPage,
        });
  
        res.json({
          results,
          total,
          page,
          per_page: perPage,
        });
      } catch (error) {
        console.error("Error searching social accounts:", error);
        sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to search social accounts.", {}, (req as any).requestId);
      }
    });
  
    // --- Upgrade #5: Bulk Social Account Lookup Endpoint ---
    app.post("/api/v1/social-accounts/bulk", async (req, res) => {
      try {
        const { usernames } = req.body;
  
        if (!Array.isArray(usernames)) {
          return sendApiError(res, 400, ErrorCodes.VALIDATION_ERROR, "The 'usernames' field must be an array of {username, platform} objects.", {}, (req as any).requestId);
        }
  
        if (usernames.length > 50) {
          return sendApiError(res, 400, ErrorCodes.BULK_LIMIT_EXCEEDED, "Maximum 50 lookups per request.", { limit: 50, received: usernames.length }, (req as any).requestId);
        }
  
        // Validate each entry
        for (const entry of usernames) {
          if (!entry.username || typeof entry.username !== "string" || !entry.platform || typeof entry.platform !== "string") {
            return sendApiError(res, 400, ErrorCodes.VALIDATION_ERROR, "Each entry must have 'username' (string) and 'platform' (string) fields.", {}, (req as any).requestId);
          }
        }
  
        const result = await storage.bulkLookupSocialAccounts(usernames);
        res.json(result);
      } catch (error) {
        console.error("Error in bulk social account lookup:", error);
        sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to perform bulk lookup.", {}, (req as any).requestId);
      }
    });
  
    // --- Upgrade #6: PATCH for Partial Social Account Updates (v1 route) ---
    app.patch("/api/v1/social-accounts/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const body = req.body;
  
        // Check account exists
        const existing = await storage.getSocialAccountById(id);
        if (!existing) {
          return sendApiError(res, 404, ErrorCodes.SOCIAL_ACCOUNT_NOT_FOUND, `No social account found with ID '${id}'.`, {}, (req as any).requestId);
        }
  
        // Update registry fields
        const registryFields: Record<string, any> = {};
        if (body.username !== undefined) registryFields.username = body.username;
        if (body.ownerUuid !== undefined) registryFields.ownerUuid = body.ownerUuid;
        if (body.typeId !== undefined) registryFields.typeId = body.typeId;
        if (body.internalAccountCreationType !== undefined) registryFields.internalAccountCreationType = body.internalAccountCreationType;
        if (body.lastScrapedAt !== undefined) registryFields.lastScrapedAt = body.lastScrapedAt;
  
        if (Object.keys(registryFields).length > 0) {
          await storage.updateSocialAccount(id, registryFields);
        }
  
        // Update profile fields
        const profileFields: Record<string, any> = {};
        if (body.nickname !== undefined) profileFields.nickname = body.nickname;
        if (body.accountUrl !== undefined) profileFields.accountUrl = body.accountUrl;
        if (body.imageUrl !== undefined) profileFields.imageUrl = body.imageUrl;
        if (body.bio !== undefined) profileFields.bio = body.bio;
  
        if (Object.keys(profileFields).length > 0) {
          const currentProfile = await storage.getCurrentProfileVersion(id);
          if (currentProfile) {
            await storage.updateProfileVersion(currentProfile.id, profileFields);
          } else {
            await storage.createProfileVersion({
              socialAccountId: id,
              isCurrent: true,
              ...profileFields,
            });
          }
        }
  
        // Broadcast SSE event
        sseManager.broadcast("social_account.updated", { id });
  
        const account = await storage.getSocialAccountById(id);
        res.json(account);
      } catch (error) {
        console.error("Error updating social account:", error);
        sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to update social account.", {}, (req as any).requestId);
      }
    });
  
    // --- Upgrade #2: Pagination on list endpoints (v1 url-list) ---
    app.get("/api/v1/url-list", async (req, res) => {
      try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string) || 20));
        const offset = (page - 1) * perPage;
        const searchQuery = req.query.search as string | undefined;
        const typeId = req.query.typeId as string | undefined;
  
        const accounts = await storage.getSocialAccountsPaginated({
          offset,
          limit: perPage,
          searchQuery: searchQuery || undefined,
          typeId: typeId || undefined,
        });
  
        // Get total count for pagination metadata
        const allAccounts = await storage.getAllSocialAccounts(searchQuery, typeId);
        const total = allAccounts.length;
  
        res.json({
          results: accounts,
          total,
          page,
          per_page: perPage,
        });
      } catch (error) {
        console.error("Error fetching v1 url-list:", error);
        sendApiError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to fetch URL list.", {}, (req as any).requestId);
      }
    });

    // --- Instagram Post Import Endpoint ---
    const importInstagramPostHandler = async (req: Request, res: Response) => {
      try {
        // 1. Authenticate using X-Extension-Token header
        const token = req.headers["x-extension-token"] as string;
        if (!token) {
          return res.status(401).json({ error: "Extension token required" });
        }

        const session = await authenticateExtensionToken(token);
        if (!session) {
          return res.status(401).json({ error: "Invalid extension token" });
        }

        // Update session's last accessed timestamp
        await storage.updateExtensionSessionLastAccessed(session.id);

        // 2. Validate payload
        const parsedResult = importInstagramPostSchema.safeParse(req.body);
        if (!parsedResult.success) {
          return res.status(400).json({
            error: "Invalid request payload",
            details: parsedResult.error.errors,
          });
        }
        const payload = parsedResult.data;

        // 3. Resolve target account (Instagram)
        const INSTAGRAM_TYPE_ID = "00000000-0000-0000-0001-000000000001";
        const normalizedUsername = payload.username.trim().toLowerCase();

        let targetAccount = await db
          .select()
          .from(socialAccounts)
          .where(
            and(
              eq(socialAccounts.username, normalizedUsername),
              eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID)
            )
          )
          .limit(1)
          .then(rows => rows[0]);

        if (!targetAccount) {
          targetAccount = await storage.createSocialAccount({
            username: normalizedUsername,
            typeId: INSTAGRAM_TYPE_ID,
            internalAccountCreationType: "auto-import",
          });
        }

        // 4. De-duplication check using deterministic post UUID
        const deterministicPostId = generateDeterministicUuid(`instagram:post:${payload.post.post_id}`);
        const [existingPost] = await db
          .select()
          .from(socialAccountPosts)
          .where(eq(socialAccountPosts.id, deterministicPostId))
          .limit(1);

        if (existingPost) {
          return res.status(200).json({
            status: "already_exists",
            message: "Post already exists, skipped duplicate",
            post: existingPost,
          });
        }

        // 5. Process media and upload files
        const storageMode = await storage.getImageStorageMode(session.userId);
        const uploadedUrls: string[] = [];

        for (const mediaItem of payload.post.media) {
          const matches = mediaItem.data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
          if (!matches) {
            return res.status(400).json({
              error: `Invalid media data URL format for file ${mediaItem.filename}`,
            });
          }

          const mimeType = matches[1];
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, "base64");

          let imageUrl: string;
          if (storageMode === "local") {
            imageUrl = await uploadImageLocally(buffer, mediaItem.filename, mimeType);
          } else {
            imageUrl = await uploadImageToS3(buffer, mediaItem.filename, mimeType);
          }
          uploadedUrls.push(imageUrl);

          // Register in photos table with post locator
          try {
            const photo = await storage.insertPhoto({
              location: imageUrl,
              prmLocation: `post:${deterministicPostId}`,
              isSubImage: false,
            });
            // Auto-describe and vectorize images in the background (fire-and-forget)
            syncEntityInBackground("image", photo.id);
          } catch (photoErr) {
            console.error("Warning: failed to register photo in photos table:", photoErr);
          }
        }

        // 6. Create post
        const postType = payload.post.media_type === 2 ? "video" : (payload.post.media_type === 8 ? "carousel" : "post");
        const [createdPost] = await db
          .insert(socialAccountPosts)
          .values({
            id: deterministicPostId,
            socialAccountId: targetAccount.id,
            postType,
            content: JSON.stringify(uploadedUrls),
            description: payload.post.caption || null,
            likeCount: 0,
            commentCount: 0,
            postedAt: new Date(payload.post.taken_at * 1000),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        // Sync social account in background
        syncEntityInBackground("social_account", targetAccount.id);

        res.status(201).json({
          message: "Instagram post imported successfully",
          post: createdPost,
        });
      } catch (error) {
        console.error("Error importing Instagram post:", error);
        res.status(500).json({ error: "Failed to import Instagram post" });
      }
    };

    const checkPostDuplicatesHandler = async (req: Request, res: Response) => {
      try {
        const token = req.headers["x-extension-token"] as string;
        if (!token) {
          return res.status(401).json({ error: "Extension token required" });
        }

        const session = await authenticateExtensionToken(token);
        if (!session) {
          return res.status(401).json({ error: "Invalid extension token" });
        }

        await storage.updateExtensionSessionLastAccessed(session.id);

        const { postIds } = req.body;
        if (!Array.isArray(postIds)) {
          return res.status(400).json({ error: "postIds must be an array of strings" });
        }

        if (postIds.length === 0) {
          return res.json({ existingPostIds: [] });
        }

        const deterministicIds = postIds.map(id => generateDeterministicUuid(`instagram:post:${id}`));

        const existing = await db
          .select({ id: socialAccountPosts.id })
          .from(socialAccountPosts)
          .where(inArray(socialAccountPosts.id, deterministicIds));

        const existingSet = new Set(existing.map(p => p.id));
        const existingPostIds = postIds.filter(id => {
          const detId = generateDeterministicUuid(`instagram:post:${id}`);
          return existingSet.has(detId);
        });

        res.json({ existingPostIds });
      } catch (error) {
        console.error("Error checking post duplicates:", error);
        res.status(500).json({ error: "Failed to check duplicates" });
      }
    };

    app.post("/api/posts/instagram/import", importInstagramPostHandler);
    app.post("/api/v1/posts/import", importInstagramPostHandler);
    app.post("/api/posts/instagram/check", checkPostDuplicatesHandler);
    app.post("/api/v1/posts/check", checkPostDuplicatesHandler);

    // ========================
    // New Social Accounts & Posts Endpoints
    // ========================

    // Add follower
    app.post("/api/social-accounts/:id/followers", async (req, res) => {
      try {
        const { id } = req.params;
        const { followerId } = req.body;
        if (!followerId) {
          return res.status(400).json({ error: "followerId is required" });
        }

        const account = await storage.getSocialAccountById(id);
        const followerAccount = await storage.getSocialAccountById(followerId);
        if (!account || !followerAccount) {
          return res.status(404).json({ error: "One or both social accounts not found" });
        }

        // Update target account's followers
        const targetState = await storage.getNetworkState(id);
        const targetFollowers = new Set(targetState?.followers || []);
        targetFollowers.add(followerId);

        // Update follower account's following
        const followerState = await storage.getNetworkState(followerId);
        const followerFollowing = new Set(followerState?.following || []);
        followerFollowing.add(id);

        const batchId = crypto.randomUUID();
        const changes = [
          { socialAccountId: id, changeType: 'follow', direction: 'follower', targetAccountId: followerId, batchId },
          { socialAccountId: followerId, changeType: 'follow', direction: 'following', targetAccountId: id, batchId }
        ];
        await storage.recordNetworkChanges(changes);

        const updatedTargetState = await storage.upsertNetworkState({
          socialAccountId: id,
          followerCount: targetFollowers.size,
          followingCount: targetState?.followingCount || 0,
          followers: Array.from(targetFollowers),
          following: targetState?.following || [],
        });

        await storage.upsertNetworkState({
          socialAccountId: followerId,
          followerCount: followerState?.followerCount || 0,
          followingCount: followerFollowing.size,
          followers: followerState?.followers || [],
          following: Array.from(followerFollowing),
        });

        res.json({ success: true, networkState: updatedTargetState });
      } catch (error) {
        console.error("Error adding follower:", error);
        res.status(500).json({ error: "Failed to add follower" });
      }
    });

    // Remove follower
    app.delete("/api/social-accounts/:id/followers/:fId", async (req, res) => {
      try {
        const { id, fId } = req.params;
        const account = await storage.getSocialAccountById(id);
        const followerAccount = await storage.getSocialAccountById(fId);
        if (!account || !followerAccount) {
          return res.status(404).json({ error: "One or both social accounts not found" });
        }

        const targetState = await storage.getNetworkState(id);
        const targetFollowers = new Set(targetState?.followers || []);
        if (!targetFollowers.has(fId)) {
          return res.status(400).json({ error: "Follower relationship does not exist" });
        }
        targetFollowers.delete(fId);

        const followerState = await storage.getNetworkState(fId);
        const followerFollowing = new Set(followerState?.following || []);
        followerFollowing.delete(id);

        const batchId = crypto.randomUUID();
        const changes = [
          { socialAccountId: id, changeType: 'unfollow', direction: 'follower', targetAccountId: fId, batchId },
          { socialAccountId: fId, changeType: 'unfollow', direction: 'following', targetAccountId: id, batchId }
        ];
        await storage.recordNetworkChanges(changes);

        const updatedTargetState = await storage.upsertNetworkState({
          socialAccountId: id,
          followerCount: targetFollowers.size,
          followingCount: targetState?.followingCount || 0,
          followers: Array.from(targetFollowers),
          following: targetState?.following || [],
        });

        await storage.upsertNetworkState({
          socialAccountId: fId,
          followerCount: followerState?.followerCount || 0,
          followingCount: followerFollowing.size,
          followers: followerState?.followers || [],
          following: Array.from(followerFollowing),
        });

        res.json({ success: true, networkState: updatedTargetState });
      } catch (error) {
        console.error("Error removing follower:", error);
        res.status(500).json({ error: "Failed to remove follower" });
      }
    });

    // Add following
    app.post("/api/social-accounts/:id/following", async (req, res) => {
      try {
        const { id } = req.params;
        const { followingId } = req.body;
        if (!followingId) {
          return res.status(400).json({ error: "followingId is required" });
        }

        const account = await storage.getSocialAccountById(id);
        const followingAccount = await storage.getSocialAccountById(followingId);
        if (!account || !followingAccount) {
          return res.status(404).json({ error: "One or both social accounts not found" });
        }

        const targetState = await storage.getNetworkState(id);
        const targetFollowing = new Set(targetState?.following || []);
        targetFollowing.add(followingId);

        const followingState = await storage.getNetworkState(followingId);
        const followingFollowers = new Set(followingState?.followers || []);
        followingFollowers.add(id);

        const batchId = crypto.randomUUID();
        const changes = [
          { socialAccountId: id, changeType: 'follow', direction: 'following', targetAccountId: followingId, batchId },
          { socialAccountId: followingId, changeType: 'follow', direction: 'follower', targetAccountId: id, batchId }
        ];
        await storage.recordNetworkChanges(changes);

        const updatedTargetState = await storage.upsertNetworkState({
          socialAccountId: id,
          followerCount: targetState?.followerCount || 0,
          followingCount: targetFollowing.size,
          followers: targetState?.followers || [],
          following: Array.from(targetFollowing),
        });

        await storage.upsertNetworkState({
          socialAccountId: followingId,
          followerCount: followingFollowers.size,
          followingCount: followingState?.followingCount || 0,
          followers: Array.from(followingFollowers),
          following: followingState?.following || [],
        });

        res.json({ success: true, networkState: updatedTargetState });
      } catch (error) {
        console.error("Error adding following:", error);
        res.status(500).json({ error: "Failed to add following" });
      }
    });

    // Remove following
    app.delete("/api/social-accounts/:id/following/:fId", async (req, res) => {
      try {
        const { id, fId } = req.params;
        const account = await storage.getSocialAccountById(id);
        const followingAccount = await storage.getSocialAccountById(fId);
        if (!account || !followingAccount) {
          return res.status(404).json({ error: "One or both social accounts not found" });
        }

        const targetState = await storage.getNetworkState(id);
        const targetFollowing = new Set(targetState?.following || []);
        if (!targetFollowing.has(fId)) {
          return res.status(400).json({ error: "Following relationship does not exist" });
        }
        targetFollowing.delete(fId);

        const followingState = await storage.getNetworkState(fId);
        const followingFollowers = new Set(followingState?.followers || []);
        followingFollowers.delete(id);

        const batchId = crypto.randomUUID();
        const changes = [
          { socialAccountId: id, changeType: 'unfollow', direction: 'following', targetAccountId: fId, batchId },
          { socialAccountId: fId, changeType: 'unfollow', direction: 'follower', targetAccountId: id, batchId }
        ];
        await storage.recordNetworkChanges(changes);

        const updatedTargetState = await storage.upsertNetworkState({
          socialAccountId: id,
          followerCount: targetState?.followerCount || 0,
          followingCount: targetFollowing.size,
          followers: targetState?.followers || [],
          following: Array.from(targetFollowing),
        });

        await storage.upsertNetworkState({
          socialAccountId: fId,
          followerCount: followingFollowers.size,
          followingCount: followingState?.followingCount || 0,
          followers: Array.from(followingFollowers),
          following: followingState?.following || [],
        });

        res.json({ success: true, networkState: updatedTargetState });
      } catch (error) {
        console.error("Error removing following:", error);
        res.status(500).json({ error: "Failed to remove following" });
      }
    });

    // Get social account directly by platform and username
    app.get("/api/social-accounts/platform/:platform/username/:username", async (req, res) => {
      try {
        const { platform, username } = req.params;
        const normalizedUsername = username.trim().toLowerCase();
        
        const type = await storage.getSocialAccountTypeByName(platform);
        if (!type) {
          return res.status(404).json({ error: `Platform '${platform}' not found` });
        }

        const [account] = await db
          .select()
          .from(socialAccounts)
          .where(
            and(
              eq(sql`LOWER(${socialAccounts.username})`, normalizedUsername),
              eq(socialAccounts.typeId, type.id)
            )
          )
          .limit(1);

        if (!account) {
          return res.status(404).json({ error: `Social account not found with username '${username}' on platform '${platform}'` });
        }

        const enriched = await storage.getSocialAccountById(account.id);
        res.json(enriched);
      } catch (error) {
        console.error("Error fetching social account by username:", error);
        res.status(500).json({ error: "Failed to fetch social account" });
      }
    });

    // Get all network changes (paginated)
    app.get("/api/social-accounts/network-changes", async (req, res) => {
      try {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
        const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
        
        const rows = await db
          .select()
          .from(socialNetworkChanges)
          .orderBy(desc(socialNetworkChanges.detectedAt))
          .limit(limit)
          .offset(offset);

        res.json(rows);
      } catch (error) {
        console.error("Error fetching network changes:", error);
        res.status(500).json({ error: "Failed to fetch network changes" });
      }
    });

    // Get all profile versions (paginated)
    app.get("/api/social-accounts/profile-versions", async (req, res) => {
      try {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
        const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

        const rows = await db
          .select()
          .from(socialProfileVersions)
          .orderBy(desc(socialProfileVersions.detectedAt))
          .limit(limit)
          .offset(offset);

        res.json(rows);
      } catch (error) {
        console.error("Error fetching profile versions:", error);
        res.status(500).json({ error: "Failed to fetch profile versions" });
      }
    });

    // List all posts paginated (offset / limit)
    app.get("/api/social-account-posts", async (req, res) => {
      try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
        const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
        const postType = req.query.postType as string | undefined;
        const socialAccountId = req.query.socialAccountId as string | undefined;

        const conditions = [eq(socialAccountPosts.isDeleted, false)];
        if (postType) conditions.push(eq(socialAccountPosts.postType, postType));
        if (socialAccountId) conditions.push(eq(socialAccountPosts.socialAccountId, socialAccountId));

        const rows = await db
          .select()
          .from(socialAccountPosts)
          .where(and(...conditions))
          .orderBy(desc(socialAccountPosts.postedAt))
          .limit(limit)
          .offset(offset);

        res.json(rows);
      } catch (error) {
        console.error("Error fetching posts:", error);
        res.status(500).json({ error: "Failed to fetch posts" });
      }
    });

    // List all posts paginated (V1 structure: page / per_page with totals)
    app.get("/api/v1/posts", async (req, res) => {
      try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string) || 20));
        const offset = (page - 1) * perPage;
        const postType = req.query.postType as string | undefined;
        const socialAccountId = req.query.socialAccountId as string | undefined;

        const conditions = [eq(socialAccountPosts.isDeleted, false)];
        if (postType) conditions.push(eq(socialAccountPosts.postType, postType));
        if (socialAccountId) conditions.push(eq(socialAccountPosts.socialAccountId, socialAccountId));

        const totalRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(socialAccountPosts)
          .where(and(...conditions));
        const total = totalRows[0]?.count || 0;

        const rows = await db
          .select()
          .from(socialAccountPosts)
          .where(and(...conditions))
          .orderBy(desc(socialAccountPosts.postedAt))
          .limit(perPage)
          .offset(offset);

        res.json({
          results: rows,
          total,
          page,
          per_page: perPage,
        });
      } catch (error) {
        console.error("Error fetching v1 posts:", error);
        res.status(500).json({ error: "Failed to fetch posts" });
      }
    });

    // Bulk delete posts
    app.delete("/api/social-account-posts", async (req, res) => {
      try {
        if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
          return res.status(400).json({ error: "ids must be an array" });
        }
        if (ids.length === 0) {
          return res.json({ success: true, deletedCount: 0 });
        }
        await db
          .update(socialAccountPosts)
          .set({ isDeleted: true })
          .where(inArray(socialAccountPosts.id, ids));

        res.json({ success: true, deletedCount: ids.length });
      } catch (error) {
        console.error("Error bulk deleting posts:", error);
        res.status(500).json({ error: "Failed to delete posts" });
      }
    });

}

// --- Instagram Post Import Helper Schemas & Functions ---

const importInstagramPostSchema = z.object({
  username: z.string().min(1),
  platform: z.literal("Instagram"),
  post: z.object({
    post_id: z.string().min(1),
    shortcode: z.string().min(1),
    caption: z.string().optional(),
    taken_at: z.number().int(),
    media_type: z.number().int(),
    media: z.array(
      z.object({
        type: z.literal("image"),
        filename: z.string().min(1),
        data: z.string().min(1),
      })
    ).min(1),
  }),
});

function generateDeterministicUuid(input: string): string {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "5" + hash.substring(13, 16),
    "a" + hash.substring(17, 20),
    hash.substring(20, 32)
  ].join("-");
}

async function authenticateExtensionToken(token: string): Promise<ExtensionSession | null> {
  if (!token) return null;
  try {
    const allSessions = await storage.getAllExtensionSessionsAllUsers();
    for (const session of allSessions) {
      try {
        const [hashed, salt] = session.sessionToken.split(".");
        const hashedBuf = Buffer.from(hashed, "hex");
        const suppliedBuf = (await scryptAsync(token, salt, 64)) as Buffer;
        if (timingSafeEqual(hashedBuf, suppliedBuf)) {
          return session;
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.error("Error authenticating extension token:", error);
  }
  return null;
}
