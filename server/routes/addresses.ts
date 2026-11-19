// Address history routes (address-history-plan.md §3). Rules live in ../person-addresses.
import type { Express, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { insertPersonAddressSchema, people } from "@shared/schema";
import { db } from "../db";
import {
  AddressError,
  createPersonAddress,
  deletePersonAddress,
  getPersonAddresses,
  updatePersonAddress,
} from "../person-addresses";

function sendError(res: Response, error: unknown, action: string) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message });
  if (error instanceof AddressError) return res.status(error.status).json({ error: error.message });
  console.error(`Error ${action} address:`, error);
  res.status(500).json({ error: `Failed to ${action} address` });
}

export function registerRoutes(app: Express) {
  app.get("/api/people/:id/addresses", async (req, res) => {
    try {
      res.json(await getPersonAddresses(req.params.id));
    } catch (error) {
      sendError(res, error, "fetch");
    }
  });

  app.post("/api/people/:id/addresses", async (req, res) => {
    try {
      const [person] = await db.select({ id: people.id }).from(people).where(eq(people.id, req.params.id)).limit(1);
      if (!person) return res.status(404).json({ error: "Person not found" });
      res.status(201).json(await createPersonAddress(req.params.id, insertPersonAddressSchema.parse(req.body)));
    } catch (error) {
      sendError(res, error, "create");
    }
  });

  app.patch("/api/addresses/:id", async (req, res) => {
    try {
      const row = await updatePersonAddress(req.params.id, insertPersonAddressSchema.partial().parse(req.body));
      if (!row) return res.status(404).json({ error: "Address not found" });
      res.json(row);
    } catch (error) {
      sendError(res, error, "update");
    }
  });

  app.delete("/api/addresses/:id", async (req, res) => {
    try {
      if (!(await deletePersonAddress(req.params.id))) return res.status(404).json({ error: "Address not found" });
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "delete");
    }
  });
}
