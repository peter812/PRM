import { Router } from "express";
import { storage } from "../storage";
import { z } from "zod";

export function registerRoutes(app: any) {
  const router = Router();

  // Authentication middleware gate for this router
  router.use((req, res, next) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  });

  // GET /api/conversations/paginated
  router.get("/conversations/paginated", async (req, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const limit = parseInt(req.query.limit as string) || 20;
      const channelType = req.query.channelType as string | undefined;
      const personId = req.query.personId as string | undefined;
      const socialAccountId = req.query.socialAccountId as string | undefined;
      const search = req.query.search as string | undefined;

      const result = await storage.getConversationsPaginated(offset, limit, {
        channelType: channelType || undefined,
        personId: personId || undefined,
        socialAccountId: socialAccountId || undefined,
        search: search || undefined,
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching paginated conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // GET /api/conversations/:id
  router.get("/conversations/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const conversation = await storage.getConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Fetch participants details
      const parts = await storage.getConversationParticipants(id);
      const participantsWithDetails = await Promise.all(
        parts.map(async (p) => {
          let person;
          let socialAccount;
          if (p.personId) {
            person = await storage.getPersonById(p.personId);
          }
          if (p.socialAccountId) {
            socialAccount = await storage.getSocialAccountById(p.socialAccountId);
          }
          return {
            ...p,
            person,
            socialAccount,
          };
        })
      );

      res.json({
        ...conversation,
        participants: participantsWithDetails,
      });
    } catch (error) {
      console.error("Error fetching conversation details:", error);
      res.status(500).json({ error: "Failed to fetch conversation details" });
    }
  });

  // POST /api/conversations
  router.post("/conversations", async (req, res) => {
    try {
      const createSchema = z.object({
        title: z.string().nullable().optional(),
        channelType: z.string(),
        socialAccountId: z.string().nullable().optional(),
        externalUrl: z.string().nullable().optional(),
        metadata: z.any().optional(),
        participantPersonIds: z.array(z.string()),
        participantSocialAccountIds: z.array(z.string()).optional(),
      });

      const parsed = createSchema.parse(req.body);
      const userId = req.user!.id;

      // 1. Create conversation
      const conversation = await storage.createConversation({
        userId,
        title: parsed.title || null,
        channelType: parsed.channelType,
        socialAccountId: parsed.socialAccountId || null,
        externalUrl: parsed.externalUrl || null,
        metadata: parsed.metadata || null,
        lastMessageAt: null,
      });

      // 2. Add participants
      for (const pId of parsed.participantPersonIds) {
        await storage.addConversationParticipant({
          conversationId: conversation.id,
          personId: pId,
          socialAccountId: null,
          role: "participant",
        });
      }

      if (parsed.participantSocialAccountIds) {
        for (const saId of parsed.participantSocialAccountIds) {
          await storage.addConversationParticipant({
            conversationId: conversation.id,
            personId: null,
            socialAccountId: saId,
            role: "participant",
          });
        }
      }

      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // PATCH /api/conversations/:id
  router.patch("/conversations/:id", async (req, res) => {
    try {
      const updateSchema = z.object({
        title: z.string().nullable().optional(),
        channelType: z.string().optional(),
        externalUrl: z.string().nullable().optional(),
        metadata: z.any().optional(),
      });

      const parsed = updateSchema.parse(req.body);
      const conversation = await storage.updateConversation(req.params.id, parsed);
      res.json(conversation);
    } catch (error) {
      console.error("Error updating conversation:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update conversation" });
    }
  });

  // DELETE /api/conversations/:id
  router.delete("/conversations/:id", async (req, res) => {
    try {
      await storage.deleteConversation(req.params.id);
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // GET /api/conversations/:id/messages
  router.get("/conversations/:id/messages", async (req, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const limit = parseInt(req.query.limit as string) || 50;
      const result = await storage.getMessagesByConversation(req.params.id, offset, limit);
      res.json(result);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // POST /api/conversations/:id/messages
  router.post("/conversations/:id/messages", async (req, res) => {
    try {
      const postMessageSchema = z.object({
        senderPersonId: z.string().nullable().optional(),
        senderSocialAccountId: z.string().nullable().optional(),
        content: z.string().nullable().optional(),
        contentType: z.string().optional(),
        imageUuids: z.array(z.string()).optional(),
        attachments: z.any().optional(),
        externalId: z.string().optional(),
        sentAt: z.string().optional().transform(val => val ? new Date(val) : new Date()),
        recipients: z.array(
          z.object({
            personId: z.string().nullable().optional(),
            socialAccountId: z.string().nullable().optional(),
            recipientType: z.string().optional(),
          })
        ).optional(),
      });

      const parsed = postMessageSchema.parse(req.body);

      const message = await storage.createMessage(
        {
          conversationId: req.params.id,
          senderPersonId: parsed.senderPersonId || null,
          senderSocialAccountId: parsed.senderSocialAccountId || null,
          content: parsed.content || null,
          contentType: parsed.contentType || "text",
          imageUuids: parsed.imageUuids || null,
          attachments: parsed.attachments || null,
          externalId: parsed.externalId || null,
          sentAt: parsed.sentAt,
          metadata: null,
        },
        parsed.recipients || []
      );

      res.status(201).json(message);
    } catch (error) {
      console.error("Error creating message:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create message" });
    }
  });

  // DELETE /api/messages/:id
  router.delete("/messages/:id", async (req, res) => {
    try {
      await storage.deleteMessage(req.params.id);
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting message:", error);
      res.status(500).json({ error: "Failed to delete message" });
    }
  });

  // POST /api/conversations/:id/participants
  router.post("/conversations/:id/participants", async (req, res) => {
    try {
      const participantSchema = z.object({
        personId: z.string().nullable().optional(),
        socialAccountId: z.string().nullable().optional(),
        role: z.string().optional().default("participant"),
      });

      const parsed = participantSchema.parse(req.body);
      const participant = await storage.addConversationParticipant({
        conversationId: req.params.id,
        personId: parsed.personId || null,
        socialAccountId: parsed.socialAccountId || null,
        role: parsed.role,
      });

      res.status(201).json(participant);
    } catch (error) {
      console.error("Error adding participant:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to add participant" });
    }
  });

  // DELETE /api/conversations/:id/participants/:personId
  router.delete("/conversations/:id/participants/:personId", async (req, res) => {
    try {
      await storage.removeConversationParticipant(req.params.id, req.params.personId);
      res.status(204).end();
    } catch (error) {
      console.error("Error removing participant:", error);
      res.status(500).json({ error: "Failed to remove participant" });
    }
  });

  // GET /api/people/:id/conversations
  router.get("/people/:id/conversations", async (req, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await storage.getConversationsByPerson(req.params.id, offset, limit);
      res.json(result);
    } catch (error) {
      console.error("Error fetching person conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // GET /api/social-accounts/:id/conversations
  router.get("/social-accounts/:id/conversations", async (req, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await storage.getConversationsBySocialAccount(req.params.id, offset, limit);
      res.json(result);
    } catch (error) {
      console.error("Error fetching social account conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.use("/api", router);
}
