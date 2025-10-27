import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertPersonSchema,
  insertNoteSchema,
  insertInteractionSchema,
  insertRelationshipSchema,
  insertRelationshipTypeSchema,
  insertGroupSchema,
  insertGroupNoteSchema,
  insertUserSchema,
} from "@shared/schema";
import multer from "multer";
import { uploadImageToS3, deleteImageFromS3 } from "./s3";
import { hashPassword } from "./auth";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  // Image upload endpoint
  app.post("/api/upload-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const imageUrl = await uploadImageToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      res.json({ imageUrl });
    } catch (error) {
      console.error("Error uploading image:", error);
      res.status(500).json({ error: "Failed to upload image" });
    }
  });

  // Delete image endpoint
  app.delete("/api/delete-image", async (req, res) => {
    try {
      const { imageUrl } = req.body;
      if (!imageUrl) {
        return res.status(400).json({ error: "No image URL provided" });
      }

      await deleteImageFromS3(imageUrl);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting image:", error);
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // Setup endpoints
  app.get("/api/setup/status", async (req, res) => {
    try {
      const userCount = await storage.getUserCount();
      res.json({ isSetupNeeded: userCount === 0 });
    } catch (error) {
      console.error("Error checking setup status:", error);
      res.status(500).json({ error: "Failed to check setup status" });
    }
  });

  app.post("/api/setup/initialize", async (req, res) => {
    try {
      const userCount = await storage.getUserCount();
      if (userCount > 0) {
        return res.status(400).json({ error: "Setup already completed" });
      }

      const validatedData = insertUserSchema.parse({
        name: req.body.name,
        nickname: req.body.nickname,
        username: req.body.username,
        password: await hashPassword(req.body.password),
      });

      const user = await storage.createUser(validatedData);
      
      // Log the user in automatically
      req.login(user, (err) => {
        if (err) {
          console.error("Error logging in after setup:", err);
          return res.status(500).json({ error: "Setup completed but login failed" });
        }
        res.status(201).json(user);
      });
    } catch (error) {
      console.error("Error initializing setup:", error);
      res.status(400).json({ error: "Failed to initialize setup" });
    }
  });

  // Search endpoint
  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string | undefined;
      
      if (!query) {
        return res.json({ people: [], groups: [] });
      }

      const [people, groups] = await Promise.all([
        storage.getAllPeople(query),
        storage.getAllGroups(query),
      ]);

      res.json({ people, groups });
    } catch (error) {
      console.error("Error searching:", error);
      res.status(500).json({ error: "Failed to search" });
    }
  });

  // User endpoints
  app.patch("/api/user", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { name, nickname, username, currentPassword, newPassword } = req.body;
      const updateData: any = {};

      // Validate and add basic fields
      if (name !== undefined) updateData.name = name;
      if (nickname !== undefined) updateData.nickname = nickname;
      if (username !== undefined) {
        // Check if username is already taken by another user
        const existingUser = await storage.getUserByUsername(username);
        if (existingUser && existingUser.id !== req.user.id) {
          return res.status(400).json({ error: "Username already taken" });
        }
        updateData.username = username;
      }

      // Handle password change
      if (newPassword && currentPassword) {
        // Verify current password
        const user = await storage.getUser(req.user.id);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const [hashed, salt] = user.password.split(".");
        const hashedBuf = Buffer.from(hashed, "hex");
        const suppliedBuf = (await scryptAsync(currentPassword, salt, 64)) as Buffer;
        
        if (!timingSafeEqual(hashedBuf, suppliedBuf)) {
          return res.status(400).json({ error: "Current password is incorrect" });
        }

        // Hash new password
        updateData.password = await hashPassword(newPassword);
      } else if (newPassword || currentPassword) {
        return res.status(400).json({ error: "Both current and new password are required to change password" });
      }

      const updatedUser = await storage.updateUser(req.user.id, updateData);
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(400).json({ error: "Failed to update user" });
    }
  });

  // People endpoints
  app.get("/api/people", async (req, res) => {
    try {
      const includeRelationships = req.query.includeRelationships === 'true';
      
      if (includeRelationships) {
        const people = await storage.getAllPeopleWithRelationships();
        res.json(people);
      } else {
        const people = await storage.getAllPeople();
        res.json(people);
      }
    } catch (error) {
      console.error("Error fetching people:", error);
      res.status(500).json({ error: "Failed to fetch people" });
    }
  });

  app.get("/api/people/search", async (req, res) => {
    try {
      const query = req.query.q as string | undefined;
      
      if (!query) {
        return res.status(400).json({ error: "Search query parameter 'q' is required" });
      }

      const people = await storage.getAllPeople(query);
      res.json(people);
    } catch (error) {
      console.error("Error searching people:", error);
      res.status(500).json({ error: "Failed to search people" });
    }
  });

  app.get("/api/people/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const person = await storage.getPersonById(id);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      res.json(person);
    } catch (error) {
      console.error("Error fetching person:", error);
      res.status(500).json({ error: "Failed to fetch person" });
    }
  });

  app.post("/api/people", async (req, res) => {
    try {
      const validatedData = insertPersonSchema.parse(req.body);
      const person = await storage.createPerson(validatedData);
      res.status(201).json(person);
    } catch (error) {
      console.error("Error creating person:", error);
      res.status(400).json({ error: "Failed to create person" });
    }
  });

  app.patch("/api/people/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertPersonSchema.partial().parse(req.body);
      const person = await storage.updatePerson(id, validatedData);

      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      res.json(person);
    } catch (error) {
      console.error("Error updating person:", error);
      res.status(400).json({ error: "Failed to update person" });
    }
  });

  app.delete("/api/people/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deletePerson(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting person:", error);
      res.status(500).json({ error: "Failed to delete person" });
    }
  });

  // Notes endpoints
  app.post("/api/notes", async (req, res) => {
    try {
      const validatedData = insertNoteSchema.parse(req.body);
      const note = await storage.createNote(validatedData);
      res.status(201).json(note);
    } catch (error) {
      console.error("Error creating note:", error);
      res.status(400).json({ error: "Failed to create note" });
    }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteNote(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting note:", error);
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  // Interactions endpoints
  app.post("/api/interactions", async (req, res) => {
    try {
      const validatedData = insertInteractionSchema.parse(req.body);
      const interaction = await storage.createInteraction(validatedData);
      res.status(201).json(interaction);
    } catch (error) {
      console.error("Error creating interaction:", error);
      res.status(400).json({ error: "Failed to create interaction" });
    }
  });

  app.delete("/api/interactions/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteInteraction(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting interaction:", error);
      res.status(500).json({ error: "Failed to delete interaction" });
    }
  });

  // Relationships endpoints
  app.post("/api/relationships", async (req, res) => {
    try {
      const validatedData = insertRelationshipSchema.parse(req.body);
      const relationship = await storage.createRelationship(validatedData);
      res.status(201).json(relationship);
    } catch (error) {
      console.error("Error creating relationship:", error);
      res.status(400).json({ error: "Failed to create relationship" });
    }
  });

  app.patch("/api/relationships/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertRelationshipSchema.partial().parse(req.body);
      const relationship = await storage.updateRelationship(id, validatedData);

      if (!relationship) {
        return res.status(404).json({ error: "Relationship not found" });
      }

      res.json(relationship);
    } catch (error) {
      console.error("Error updating relationship:", error);
      res.status(400).json({ error: "Failed to update relationship" });
    }
  });

  app.delete("/api/relationships/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteRelationship(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting relationship:", error);
      res.status(500).json({ error: "Failed to delete relationship" });
    }
  });

  // Groups endpoints
  app.get("/api/groups", async (req, res) => {
    try {
      const groups = await storage.getAllGroups();
      res.json(groups);
    } catch (error) {
      console.error("Error fetching groups:", error);
      res.status(500).json({ error: "Failed to fetch groups" });
    }
  });

  app.get("/api/groups/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const group = await storage.getGroupById(id);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
      res.json(group);
    } catch (error) {
      console.error("Error fetching group:", error);
      res.status(500).json({ error: "Failed to fetch group" });
    }
  });

  app.post("/api/groups", async (req, res) => {
    try {
      const validatedData = insertGroupSchema.parse(req.body);
      const group = await storage.createGroup(validatedData);
      res.status(201).json(group);
    } catch (error) {
      console.error("Error creating group:", error);
      res.status(400).json({ error: "Failed to create group" });
    }
  });

  app.patch("/api/groups/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const validatedData = insertGroupSchema.partial().parse(req.body);
      const group = await storage.updateGroup(id, validatedData);

      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }

      res.json(group);
    } catch (error) {
      console.error("Error updating group:", error);
      res.status(400).json({ error: "Failed to update group" });
    }
  });

  app.delete("/api/groups/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteGroup(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting group:", error);
      res.status(500).json({ error: "Failed to delete group" });
    }
  });

  // Group notes endpoints
  app.post("/api/group-notes", async (req, res) => {
    try {
      const validatedData = insertGroupNoteSchema.parse(req.body);
      const groupNote = await storage.createGroupNote(validatedData);
      res.status(201).json(groupNote);
    } catch (error) {
      console.error("Error creating group note:", error);
      res.status(400).json({ error: "Failed to create group note" });
    }
  });

  app.delete("/api/group-notes/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await storage.deleteGroupNote(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting group note:", error);
      res.status(500).json({ error: "Failed to delete group note" });
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

  const httpServer = createServer(app);
  return httpServer;
}
