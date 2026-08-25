import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { storage } from "../storage";
import { triggerTaskWorker } from "../task-worker";
import { requireAdmin } from "../auth";

const BACKUPS_DIR = path.join(process.cwd(), "backups");

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.endsWith(".xml") ? base : `${base}.xml`;
}

function isSafeFilename(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  return name.endsWith(".xml");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith(".xml") || file.mimetype === "application/xml" || file.mimetype === "text/xml") {
      cb(null, true);
    } else {
      cb(new Error("Only .xml files are allowed"));
    }
  },
});

export function registerRoutes(app: Express) {
  // All backup operations require admin privileges
  app.use("/api/backups", requireAdmin);

  // GET /api/backups - List all past backups
  app.get("/api/backups", async (req: Request, res: Response) => {
    try {
      ensureBackupsDir();
      const files = fs.readdirSync(BACKUPS_DIR);
      const backupList = files
        .filter((file) => file.endsWith(".xml") && file !== ".gitkeep")
        .map((filename) => {
          const filePath = path.join(BACKUPS_DIR, filename);
          const stat = fs.statSync(filePath);
          return {
            filename,
            size: stat.size,
            createdAt: stat.birthtime.toISOString(),
            modifiedAt: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

      res.json(backupList);
    } catch (error) {
      console.error("Error listing backups:", error);
      res.status(500).json({ error: "Failed to list backups" });
    }
  });

  // POST /api/backups/create - Start an export task into backups/
  app.post("/api/backups/create", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const includeHistory = req.body.includeHistory === true || req.body.includeHistory === "true";
      const customName = req.body.filename ? sanitizeFilename(req.body.filename) : undefined;

      const task = await storage.createTask({
        userId: req.user.id,
        type: "export_xml",
        status: "pending",
        payload: JSON.stringify({
          includeHistory,
          userId: req.user.id,
          filename: customName,
        }),
      });

      triggerTaskWorker();
      res.json(task);
    } catch (error) {
      console.error("Error creating backup task:", error);
      res.status(500).json({ error: "Failed to create backup task" });
    }
  });

  // POST /api/backups/upload - Upload a backup XML file to backups/
  app.post("/api/backups/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No XML file uploaded" });
      }

      ensureBackupsDir();
      let targetName = sanitizeFilename(req.file.originalname);
      let targetPath = path.join(BACKUPS_DIR, targetName);

      if (fs.existsSync(targetPath)) {
        const baseWithoutExt = targetName.replace(/\.xml$/, "");
        targetName = `${baseWithoutExt}-${Date.now()}.xml`;
        targetPath = path.join(BACKUPS_DIR, targetName);
      }

      fs.writeFileSync(targetPath, req.file.buffer);

      const stat = fs.statSync(targetPath);
      res.json({
        success: true,
        filename: targetName,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (error) {
      console.error("Error uploading backup:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to upload backup" });
    }
  });

  // DELETE /api/backups/:filename - Delete a backup file
  app.delete("/api/backups/:filename", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { filename } = req.params;
      if (!isSafeFilename(filename)) {
        return res.status(400).json({ error: "Invalid backup filename" });
      }

      const filePath = path.join(BACKUPS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Backup file not found" });
      }

      fs.unlinkSync(filePath);
      res.json({ success: true, filename });
    } catch (error) {
      console.error("Error deleting backup:", error);
      res.status(500).json({ error: "Failed to delete backup" });
    }
  });

  // PATCH /api/backups/:filename/rename - Rename a backup file
  app.patch("/api/backups/:filename/rename", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { filename } = req.params;
      const { newFilename } = req.body;

      if (!isSafeFilename(filename)) {
        return res.status(400).json({ error: "Invalid existing backup filename" });
      }
      if (!newFilename || typeof newFilename !== "string") {
        return res.status(400).json({ error: "New filename is required" });
      }

      const sanitizedNewName = sanitizeFilename(newFilename);
      if (!isSafeFilename(sanitizedNewName)) {
        return res.status(400).json({ error: "Invalid new backup filename" });
      }

      ensureBackupsDir();
      const oldPath = path.join(BACKUPS_DIR, filename);
      const newPath = path.join(BACKUPS_DIR, sanitizedNewName);

      if (!fs.existsSync(oldPath)) {
        return res.status(404).json({ error: "Backup file not found" });
      }

      if (oldPath !== newPath && fs.existsSync(newPath)) {
        return res.status(400).json({ error: `A backup named "${sanitizedNewName}" already exists` });
      }

      if (oldPath !== newPath) {
        fs.renameSync(oldPath, newPath);
      }

      const stat = fs.statSync(newPath);
      res.json({
        success: true,
        oldFilename: filename,
        newFilename: sanitizedNewName,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (error) {
      console.error("Error renaming backup:", error);
      res.status(500).json({ error: "Failed to rename backup" });
    }
  });

  // GET /api/backups/:filename/download - Stream backup file for download
  app.get("/api/backups/:filename/download", async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { filename } = req.params;
      if (!isSafeFilename(filename)) {
        return res.status(400).json({ error: "Invalid backup filename" });
      }

      const filePath = path.join(BACKUPS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Backup file not found" });
      }

      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      console.error("Error downloading backup:", error);
      res.status(500).json({ error: "Failed to download backup" });
    }
  });

  // POST /api/backups/:filename/restore - Restore from a backup XML file
  app.post("/api/backups/:filename/restore", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { filename } = req.params;
      if (!isSafeFilename(filename)) {
        return res.status(400).json({ error: "Invalid backup filename" });
      }

      const filePath = path.join(BACKUPS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Backup file not found" });
      }

      const task = await storage.createTask({
        userId: req.user.id,
        type: "import_xml",
        status: "pending",
        payload: JSON.stringify({
          filePath: `backups/${filename}`,
          userId: req.user.id,
        }),
      });

      triggerTaskWorker();
      res.json(task);
    } catch (error) {
      console.error("Error creating restore task:", error);
      res.status(500).json({ error: "Failed to create restore task" });
    }
  });
}
