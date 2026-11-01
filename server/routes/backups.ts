import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { storage } from "../storage";
import { triggerTaskWorker } from "../task-worker";
import { requireAuth } from "../auth";
import {
  BACKUP_INTERVAL_DAYS,
  BACKUP_KEEP_OPTIONS,
  getBackupSchedule,
  nextBackupAt,
  saveBackupSchedule,
  type BackupSchedule,
} from "../backup-scheduler";

const BACKUPS_DIR = path.join(process.cwd(), "backups");

async function ensureBackupsDir() {
  await fs.promises.mkdir(BACKUPS_DIR, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
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
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureBackupsDir()
        .then(() => cb(null, BACKUPS_DIR))
        .catch((err) => cb(err, BACKUPS_DIR));
    },
    filename: (_req, file, cb) => {
      (async () => {
        let targetName = sanitizeFilename(file.originalname);
        const targetPath = path.join(BACKUPS_DIR, targetName);
        if (await fileExists(targetPath)) {
          const baseWithoutExt = targetName.replace(/\.xml$/, "");
          targetName = `${baseWithoutExt}-${Date.now()}.xml`;
        }
        cb(null, targetName);
      })().catch((err) => cb(err, ""));
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith(".xml") || file.mimetype === "application/xml" || file.mimetype === "text/xml") {
      cb(null, true);
    } else {
      cb(new Error("Only .xml files are allowed"));
    }
  },
});

export function registerRoutes(app: Express) {
  app.use("/api/backups", requireAuth);

  // GET /api/backups - List all past backups
  app.get("/api/backups", async (_req: Request, res: Response) => {
    try {
      await ensureBackupsDir();
      const files = await fs.promises.readdir(BACKUPS_DIR);
      const xmlFiles = files.filter((file) => file.endsWith(".xml") && file !== ".gitkeep");
      const backupList = (
        await Promise.all(
          xmlFiles.map(async (filename) => {
            const filePath = path.join(BACKUPS_DIR, filename);
            const stat = await fs.promises.stat(filePath);
            return {
              filename,
              size: stat.size,
              createdAt: stat.birthtime.toISOString(),
              modifiedAt: stat.mtime.toISOString(),
            };
          }),
        )
      ).sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

      res.json(backupList);
    } catch (error) {
      console.error("Error listing backups:", error);
      res.status(500).json({ error: "Failed to list backups" });
    }
  });

  const scheduleResponse = (schedule: BackupSchedule) => ({
    ...schedule,
    nextRunAt: schedule.enabled ? nextBackupAt(schedule).toISOString() : null,
  });

  // GET /api/backups/schedule - Auto backup settings plus the next run time
  app.get("/api/backups/schedule", async (_req: Request, res: Response) => {
    try {
      res.json(scheduleResponse(await getBackupSchedule()));
    } catch (error) {
      console.error("Error reading backup schedule:", error);
      res.status(500).json({ error: "Failed to read backup schedule" });
    }
  });

  // PUT /api/backups/schedule - Update auto backup settings
  app.put("/api/backups/schedule", async (req: Request, res: Response) => {
    try {
      const current = await getBackupSchedule();
      const { enabled, intervalDays, time, includeHistory, keepLast } = req.body ?? {};
      if (intervalDays !== undefined && !BACKUP_INTERVAL_DAYS.includes(intervalDays)) {
        return res.status(400).json({ error: "Invalid backup frequency" });
      }
      if (keepLast !== undefined && !BACKUP_KEEP_OPTIONS.includes(keepLast)) {
        return res.status(400).json({ error: "Invalid retention count" });
      }
      if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return res.status(400).json({ error: "Invalid backup time" });
      }
      const next: BackupSchedule = {
        ...current,
        ...(typeof enabled === "boolean" ? { enabled } : {}),
        ...(intervalDays !== undefined ? { intervalDays } : {}),
        ...(time !== undefined ? { time } : {}),
        ...(typeof includeHistory === "boolean" ? { includeHistory } : {}),
        ...(keepLast !== undefined ? { keepLast } : {}),
      };
      await saveBackupSchedule(next);
      res.json(scheduleResponse(next));
    } catch (error) {
      console.error("Error saving backup schedule:", error);
      res.status(500).json({ error: "Failed to save backup schedule" });
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
        if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No XML file uploaded" });
      }

      const targetName = req.file.filename;
      const targetPath = req.file.path;

      const handle = await fs.promises.open(targetPath, "r");
      let header = "";
      try {
        const buf = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(buf, 0, 4096, 0);
        header = buf.subarray(0, bytesRead).toString("utf-8").trimStart();
      } finally {
        await handle.close();
      }

      if (!header.startsWith("<?xml") && !header.startsWith("<export")) {
        await fs.promises.unlink(targetPath).catch(() => {});
        return res.status(400).json({ error: "Invalid XML backup file: must start with <?xml or <export>" });
      }

      const stat = await fs.promises.stat(targetPath);
      res.json({
        success: true,
        filename: targetName,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (error) {
      if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
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
      if (!(await fileExists(filePath))) {
        return res.status(404).json({ error: "Backup file not found" });
      }

      await fs.promises.unlink(filePath);
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

      await ensureBackupsDir();
      const oldPath = path.join(BACKUPS_DIR, filename);
      const newPath = path.join(BACKUPS_DIR, sanitizedNewName);

      if (!(await fileExists(oldPath))) {
        return res.status(404).json({ error: "Backup file not found" });
      }

      if (oldPath !== newPath && (await fileExists(newPath))) {
        return res.status(400).json({ error: `A backup named "${sanitizedNewName}" already exists` });
      }

      if (oldPath !== newPath) {
        await fs.promises.rename(oldPath, newPath);
      }

      const stat = await fs.promises.stat(newPath);
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
      if (!(await fileExists(filePath))) {
        return res.status(404).json({ error: "Backup file not found" });
      }

      res.download(filePath, filename, (err) => {
        if (err) {
          console.error("Error downloading backup:", err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to download backup" });
          }
        }
      });
    } catch (error) {
      console.error("Error downloading backup:", error);
      res.status(500).json({ error: "Failed to download backup" });
    }
  });

  // POST /api/backups/:filename/restore - Restore from a backup XML file
  app.post("/api/backups/:filename/restore", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { filename } = req.params;
      if (!isSafeFilename(filename)) {
        return res.status(400).json({ error: "Invalid backup filename" });
      }

      const filePath = path.join(BACKUPS_DIR, filename);
      if (!(await fileExists(filePath))) {
        return res.status(404).json({ error: "Backup file not found" });
      }

      const task = await storage.createTask({
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
