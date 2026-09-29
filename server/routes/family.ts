import type { Express } from "express";
import { storage } from "../storage";
import { requireAdmin, requireAuth } from "../auth";
import { z } from "zod";
import {
  FAMILY_RELATIONSHIP_TYPES,
  FAMILY_RELATIONSHIP_LABELS,
  FAMILY_RELATIONSHIP_CATEGORIES,
  FAMILY_RELATIONSHIP_INVERSES,
  deriveLineageRole,
  type PotentialFamilyMember,
  type PotentialFamilySocialAccount,
  type PotentialFamilyGroup,
  type PotentialFamiliesResponse,
} from "@shared/schema";

let cachedPotentialFamilies: {
  groups: PotentialFamilyGroup[];
  stats: PotentialFamiliesResponse["stats"];
  computedAt: number;
} | null = null;
const POTENTIAL_FAMILIES_CACHE_TTL_MS = 60 * 1000;

export function invalidatePotentialFamiliesCache() {
  cachedPotentialFamilies = null;
}

export function registerRoutes(app: Express) {
  // Family relationship type list
  app.get("/api/family-relationships/types", async (_req, res) => {
    try {
      const types = FAMILY_RELATIONSHIP_TYPES.map(value => ({
        value,
        label: FAMILY_RELATIONSHIP_LABELS[value] ?? value,
        category: FAMILY_RELATIONSHIP_CATEGORIES[value] ?? "other",
        inverse: FAMILY_RELATIONSHIP_INVERSES[value] ?? value,
      }));
      res.json({ types });
    } catch (error) {
      console.error("Error fetching family relationship types:", error);
      res.status(500).json({ error: "Failed to fetch family relationship types" });
    }
  });

  // Fetch immediate family for a person profile tab
  app.get("/api/people/:personId/family", async (req, res) => {
    try {
      const { personId } = req.params;
      const person = await storage.getPersonById(personId);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      const lineages = await storage.getLineageForPerson(personId);
      const partnerships = await storage.getPartnershipsForPerson(personId);

      const parents = [];
      const children = [];
      const spouses = [];

      for (const lin of lineages) {
        const isChild = lin.childId === personId;
        const relativeId = isChild ? lin.parentId : lin.childId;
        const relative = await storage.getPersonById(relativeId);
        if (!relative) continue;

        const roleKey = deriveLineageRole(isChild, relative.sex, lin.lineageType);
        const roleLabel = FAMILY_RELATIONSHIP_LABELS[roleKey] || roleKey;
          
        const relativeData = {
          id: lin.id,
          person: {
            id: relative.id,
            firstName: relative.firstName,
            lastName: relative.lastName,
            imageUrl: relative.imageUrl,
            sex: relative.sex,
          },
          lineageType: lin.lineageType,
          roleLabel,
        };

        if (isChild) {
          parents.push(relativeData);
        } else {
          children.push(relativeData);
        }
      }

      for (const part of partnerships) {
        const relativeId = part.person1Id === personId ? part.person2Id : part.person1Id;
        const relative = await storage.getPersonById(relativeId);
        if (!relative) continue;

        const roleLabel = FAMILY_RELATIONSHIP_LABELS[part.status] || part.status;

        spouses.push({
          id: part.id,
          person: {
            id: relative.id,
            firstName: relative.firstName,
            lastName: relative.lastName,
            imageUrl: relative.imageUrl,
            sex: relative.sex,
          },
          status: part.status,
          roleLabel,
        });
      }

      res.json({ parents, spouses, children });
    } catch (error) {
      console.error("Error fetching immediate family:", error);
      res.status(500).json({ error: "Failed to fetch immediate family" });
    }
  });

  // Create Lineage link
  app.post("/api/family/lineage", async (req, res) => {
    try {
      const bodySchema = z.object({
        childId: z.string().min(1),
        parentId: z.string().min(1),
        lineageType: z.enum(["biological", "adoptive", "step"]),
      });
      const body = bodySchema.parse(req.body);

      if (body.childId === body.parentId) {
        return res.status(400).json({ error: "Cannot create lineage link to self" });
      }

      const lin = await storage.createLineage(body);
      res.status(201).json(lin);
    } catch (error) {
      console.error("Error creating lineage:", error);
      res.status(400).json({ error: "Failed to create lineage link" });
    }
  });

  // Update Lineage link
  app.patch("/api/family/lineage/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const bodySchema = z.object({
        lineageType: z.enum(["biological", "adoptive", "step"]),
      });
      const body = bodySchema.parse(req.body);

      const updated = await storage.updateLineage(id, body);
      if (!updated) {
        return res.status(404).json({ error: "Lineage link not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating lineage:", error);
      res.status(400).json({ error: "Failed to update lineage link" });
    }
  });

  // Delete Lineage link
  app.delete("/api/family/lineage/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteLineage(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting lineage:", error);
      res.status(500).json({ error: "Failed to delete lineage link" });
    }
  });

  // Create Partnership
  app.post("/api/family/partnerships", async (req, res) => {
    try {
      const bodySchema = z.object({
        person1Id: z.string().min(1),
        person2Id: z.string().min(1),
        status: z.enum(["married", "partner", "divorced", "ex_partner"]),
      });
      const body = bodySchema.parse(req.body);

      if (body.person1Id === body.person2Id) {
        return res.status(400).json({ error: "Cannot create partnership to self" });
      }

      const part = await storage.createPartnership(body);
      res.status(201).json(part);
    } catch (error) {
      console.error("Error creating partnership:", error);
      res.status(400).json({ error: "Failed to create partnership" });
    }
  });

  // Update Partnership
  app.patch("/api/family/partnerships/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const bodySchema = z.object({
        status: z.enum(["married", "partner", "divorced", "ex_partner"]),
      });
      const body = bodySchema.parse(req.body);

      const updated = await storage.updatePartnership(id, body);
      if (!updated) {
        return res.status(404).json({ error: "Partnership not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating partnership:", error);
      res.status(400).json({ error: "Failed to update partnership" });
    }
  });

  // Delete Partnership
  app.delete("/api/family/partnerships/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deletePartnership(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting partnership:", error);
      res.status(500).json({ error: "Failed to delete partnership" });
    }
  });

  // Delete all family relationships and connections (super_admin only)
  app.delete("/api/family/relationships/all", requireAdmin, async (req, res) => {
    try {
      if (req.user?.role !== "super_admin") {
        return res.status(403).json({ error: "Only super_admin can delete all family relationships" });
      }
      const count = await storage.deleteAllFamilyRelationships();
      res.json({ success: true, count });
    } catch (error) {
      console.error("Error deleting all family relationships:", error);
      res.status(500).json({ error: "Failed to delete all family relationships" });
    }
  });

  // Potential Families: group people and social accounts by surname
  app.get("/api/family-tree/potential-families", async (req, res) => {
    try {
      const minMembers = Math.max(1, parseInt(req.query.minMembers as string, 10) || 1);
      const search = ((req.query.search as string) || "").trim().toLowerCase();
      const unconnectedOnly = req.query.unconnectedOnly === "true";
      const unlinkedSocialOnly = req.query.unlinkedSocialOnly === "true";

      if (
        cachedPotentialFamilies &&
        Date.now() - cachedPotentialFamilies.computedAt < POTENTIAL_FAMILIES_CACHE_TTL_MS &&
        minMembers === 1 &&
        !search &&
        !unconnectedOnly &&
        !unlinkedSocialOnly
      ) {
        return res.json({
          families: cachedPotentialFamilies.groups,
          stats: cachedPotentialFamilies.stats,
        });
      }

      const [allPeople, allSocialAccounts, allAccountTypes, allLineage, allPartnerships] = await Promise.all([
        storage.getAllPeople(),
        storage.getAllSocialAccounts(),
        storage.getAllSocialAccountTypes(),
        storage.getAllLineage(),
        storage.getAllPartnerships(),
      ]);

      const peopleMap = new Map(allPeople.map((p) => [p.id, p]));
      const accountTypeMap = new Map(allAccountTypes.map((t) => [t.id, t]));

      // Group storage: surnameKey -> { surname, peopleMap, socialMap }
      const groupMap = new Map<
        string,
        {
          surname: string;
          peopleMap: Map<string, PotentialFamilyMember>;
          socialMap: Map<string, PotentialFamilySocialAccount>;
        }
      >();

      const getOrCreateGroup = (normalized: string) => {
        const key = normalized.toLowerCase();
        let g = groupMap.get(key);
        if (!g) {
          g = {
            surname: normalized,
            peopleMap: new Map(),
            socialMap: new Map(),
          };
          groupMap.set(key, g);
        }
        return g;
      };

      // 1. Group People by lastName and maidenName
      for (const person of allPeople) {
        if (person.lastName && person.lastName.trim().length >= 2) {
          const surname = normalizeSurname(person.lastName);
          if (surname && !isNoiseName(surname)) {
            const grp = getOrCreateGroup(surname);
            if (!grp.peopleMap.has(person.id)) {
              grp.peopleMap.set(person.id, {
                id: person.id,
                firstName: person.firstName,
                lastName: person.lastName,
                maidenName: person.maidenName,
                imageUrl: person.imageUrl,
                sex: person.sex,
                isStarred: person.isStarred,
                company: person.company,
                title: person.title,
                isMaidenMatch: false,
                inGroupConnections: [],
              });
            }
          }
        }

        // Maiden name grouping
        if (person.maidenName && person.maidenName.trim().length >= 2) {
          const maidenSurname = normalizeSurname(person.maidenName);
          if (maidenSurname && !isNoiseName(maidenSurname)) {
            const currentSurname = person.lastName ? normalizeSurname(person.lastName) : "";
            if (maidenSurname.toLowerCase() !== currentSurname.toLowerCase()) {
              const grp = getOrCreateGroup(maidenSurname);
              if (!grp.peopleMap.has(person.id)) {
                grp.peopleMap.set(person.id, {
                  id: person.id,
                  firstName: person.firstName,
                  lastName: person.lastName,
                  maidenName: person.maidenName,
                  imageUrl: person.imageUrl,
                  sex: person.sex,
                  isStarred: person.isStarred,
                  company: person.company,
                  title: person.title,
                  isMaidenMatch: true,
                  inGroupConnections: [],
                });
              }
            }
          }
        }
      }

      // 2. Group Social Accounts
      for (const account of allSocialAccounts) {
        const typeInfo = account.typeId ? accountTypeMap.get(account.typeId) : null;
        const typeName = typeInfo?.name || null;
        const typeColor = typeInfo?.color || null;
        const displayName = account.nickname || account.currentProfile?.nickname || "";

        if (account.ownerUuid && peopleMap.has(account.ownerUuid)) {
          const owner = peopleMap.get(account.ownerUuid)!;
          if (owner.lastName && owner.lastName.trim().length >= 2) {
            const surname = normalizeSurname(owner.lastName);
            if (surname && !isNoiseName(surname)) {
              const grp = getOrCreateGroup(surname);
              if (!grp.socialMap.has(account.id)) {
                grp.socialMap.set(account.id, {
                  id: account.id,
                  username: account.username,
                  nickname: displayName || null,
                  imageUrl: account.imageUrl || account.currentProfile?.imageUrl || null,
                  typeName,
                  typeColor,
                  ownerUuid: account.ownerUuid,
                  ownerName: `${owner.firstName} ${owner.lastName}`.trim(),
                  isLinked: true,
                  matchSource: "owner",
                });
              }
            }
          }
        } else {
          // Unlinked account: check nickname display name first
          let matchedSurname: string | null = null;
          let matchSource: "display_name" | "username" = "display_name";

          if (displayName) {
            matchedSurname = extractSurnameFromText(displayName);
          }

          // Fallback to username
          if (!matchedSurname && account.username) {
            const fromUser = extractSurnameFromUsername(account.username);
            if (fromUser) {
              matchedSurname = fromUser;
              matchSource = "username";
            }
          }

          if (matchedSurname && !isNoiseName(matchedSurname)) {
            const grp = getOrCreateGroup(matchedSurname);
            if (!grp.socialMap.has(account.id)) {
              grp.socialMap.set(account.id, {
                id: account.id,
                username: account.username,
                nickname: displayName || null,
                imageUrl: account.imageUrl || account.currentProfile?.imageUrl || null,
                typeName,
                typeColor,
                ownerUuid: null,
                ownerName: null,
                isLinked: false,
                matchSource,
              });
            }
          }
        }
      }

      // 3. Compute in-group connections for each group
      const parentToChildren = new Map<string, string[]>();
      const childToParents = new Map<string, string[]>();
      for (const lin of allLineage) {
        if (!parentToChildren.has(lin.parentId)) parentToChildren.set(lin.parentId, []);
        parentToChildren.get(lin.parentId)!.push(lin.childId);

        if (!childToParents.has(lin.childId)) childToParents.set(lin.childId, []);
        childToParents.get(lin.childId)!.push(lin.parentId);
      }

      const partnerMap = new Map<string, string[]>();
      for (const part of allPartnerships) {
        if (!partnerMap.has(part.person1Id)) partnerMap.set(part.person1Id, []);
        partnerMap.get(part.person1Id)!.push(part.person2Id);

        if (!partnerMap.has(part.person2Id)) partnerMap.set(part.person2Id, []);
        partnerMap.get(part.person2Id)!.push(part.person1Id);
      }

      const familyGroups: PotentialFamilyGroup[] = [];

      for (const [, grp] of groupMap.entries()) {
        const peopleList = Array.from(grp.peopleMap.values());
        const socialList = Array.from(grp.socialMap.values());
        const totalCount = peopleList.length + socialList.length;

        // Skip if less than minMembers
        if (totalCount < minMembers) continue;

        // Search filter
        if (search && !grp.surname.toLowerCase().includes(search)) continue;

        const groupPersonIds = new Set(peopleList.map((p) => p.id));
        let connectedPeopleCount = 0;

        for (const person of peopleList) {
          const conns: PotentialFamilyMember["inGroupConnections"] = [];

          // Parents of this person in this group
          const parents = childToParents.get(person.id) || [];
          for (const parentId of parents) {
            if (groupPersonIds.has(parentId)) {
              const relPerson = peopleMap.get(parentId);
              conns.push({
                relatedPersonId: parentId,
                relatedPersonName: relPerson ? `${relPerson.firstName} ${relPerson.lastName}` : "Parent",
                type: "parent",
              });
            }
          }

          // Children of this person in this group
          const children = parentToChildren.get(person.id) || [];
          for (const childId of children) {
            if (groupPersonIds.has(childId)) {
              const relPerson = peopleMap.get(childId);
              conns.push({
                relatedPersonId: childId,
                relatedPersonName: relPerson ? `${relPerson.firstName} ${relPerson.lastName}` : "Child",
                type: "child",
              });
            }
          }

          // Partners of this person in this group
          const partners = partnerMap.get(person.id) || [];
          for (const partnerId of partners) {
            if (groupPersonIds.has(partnerId)) {
              const relPerson = peopleMap.get(partnerId);
              conns.push({
                relatedPersonId: partnerId,
                relatedPersonName: relPerson ? `${relPerson.firstName} ${relPerson.lastName}` : "Partner",
                type: "spouse",
              });
            }
          }

          person.inGroupConnections = conns;
          if (conns.length > 0) {
            connectedPeopleCount++;
          }
        }

        const unconnectedPeopleCount = peopleList.length - connectedPeopleCount;
        const unlinkedSocialCount = socialList.filter((s) => !s.isLinked).length;

        if (unconnectedOnly && unconnectedPeopleCount === 0) continue;
        if (unlinkedSocialOnly && unlinkedSocialCount === 0) continue;

        familyGroups.push({
          surname: grp.surname,
          totalCount,
          peopleCount: peopleList.length,
          socialCount: socialList.length,
          connectedPeopleCount,
          unconnectedPeopleCount,
          unlinkedSocialCount,
          hasExistingTreeLinks: connectedPeopleCount > 0,
          people: peopleList,
          socialAccounts: socialList,
        });
      }

      // Default sort: totalCount desc, then surname asc
      familyGroups.sort((a, b) => b.totalCount - a.totalCount || a.surname.localeCompare(b.surname));

      let statTotalPeople = 0;
      let statTotalSocial = 0;
      let statUnlinkedSocial = 0;
      let statUnconnectedPeople = 0;

      for (const fam of familyGroups) {
        statTotalPeople += fam.peopleCount;
        statTotalSocial += fam.socialCount;
        statUnlinkedSocial += fam.unlinkedSocialCount;
        statUnconnectedPeople += fam.unconnectedPeopleCount;
      }

      const response: PotentialFamiliesResponse = {
        families: familyGroups,
        stats: {
          totalFamilies: familyGroups.length,
          totalPeople: statTotalPeople,
          totalSocialAccounts: statTotalSocial,
          unlinkedSocialCount: statUnlinkedSocial,
          unconnectedPeopleCount: statUnconnectedPeople,
        },
      };

      if (minMembers === 1 && !search && !unconnectedOnly && !unlinkedSocialOnly) {
        cachedPotentialFamilies = {
          groups: familyGroups,
          stats: response.stats,
          computedAt: Date.now(),
        };
      }

      res.json(response);
    } catch (error) {
      console.error("Error fetching potential families:", error);
      res.status(500).json({ error: "Failed to fetch potential families" });
    }
  });
}

const NOISE_NAMES = new Set([
  "unknown",
  "none",
  "null",
  "n/a",
  "na",
  "deleted",
  "anonymous",
  "admin",
  "user",
  "test",
  "account",
  "profile",
]);

function isNoiseName(name: string): boolean {
  return NOISE_NAMES.has(name.toLowerCase());
}

function normalizeSurname(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  // Strip emojis
  s = s.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").trim();
  // Strip common suffixes
  s = s.replace(/,?\s+(jr\.?|sr\.?|ii|iii|iv|v|phd|md|esq\.?|msc|bsc)$/i, "").trim();
  // Strip quotes / brackets
  s = s.replace(/^["'([{]+|[)"'\]}]+$/g, "").trim();
  if (s.length < 2) return "";

  // Title-case parts separated by space or hyphen
  return s
    .split(/([\s-]+)/)
    .map((part) => {
      if (part === " " || part === "-") return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

function extractSurnameFromText(name: string): string | null {
  if (!name) return null;
  let cleaned = name.trim();
  cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").trim();
  cleaned = cleaned.replace(/,?\s+(jr\.?|sr\.?|ii|iii|iv|v|phd|md|esq\.?|msc|bsc)$/i, "").trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (last.length >= 2 && /^[a-zA-Z'-]+$/.test(last)) {
      const normalized = normalizeSurname(last);
      return isNoiseName(normalized) ? null : normalized;
    }
  }
  return null;
}

function extractSurnameFromUsername(username: string): string | null {
  if (!username) return null;
  const parts = username.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (last.length >= 3 && /^[a-zA-Z]+$/.test(last)) {
      const normalized = normalizeSurname(last);
      return isNoiseName(normalized) ? null : normalized;
    }
  }
  return null;
}

