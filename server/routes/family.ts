import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import {
  FAMILY_RELATIONSHIP_TYPES,
  FAMILY_RELATIONSHIP_LABELS,
  FAMILY_RELATIONSHIP_CATEGORIES,
  FAMILY_RELATIONSHIP_INVERSES,
  deriveLineageRole,
} from "@shared/schema";

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

  // Delete all family relationships and connections
  app.delete("/api/family/relationships/all", async (_req, res) => {
    try {
      const count = await storage.deleteAllFamilyRelationships();
      res.json({ success: true, count });
    } catch (error) {
      console.error("Error deleting all family relationships:", error);
      res.status(500).json({ error: "Failed to delete all family relationships" });
    }
  });
}

