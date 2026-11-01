// Scheduled XML backups (auto-backup-plan.md). Settings live in one app_settings row; a missed
// slot (server down) is skipped rather than caught up.

import fs from "fs";
import path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { tasks } from "@shared/schema";
import { triggerTaskWorker } from "./task-worker";
import { log } from "./vite";

const SETTING_KEY = "backup_schedule";
const BACKUPS_DIR = path.join(process.cwd(), "backups");
const CHECK_MS = 5 * 60 * 1000;
const RUN_WINDOW_MS = 15 * 60 * 1000;

export const BACKUP_INTERVAL_DAYS = [1, 3, 7, 14, 30];
export const BACKUP_KEEP_OPTIONS = [3, 5, 10, 20, 0]; // 0 = keep all

export interface BackupSchedule {
  enabled: boolean;
  intervalDays: number;
  time: string; // "HH:MM", server local time
  includeHistory: boolean;
  keepLast: number;
  lastRunAt: string | null;
}

const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: true,
  intervalDays: 7,
  time: "03:00",
  includeHistory: false,
  keepLast: 5,
  lastRunAt: null,
};

export async function getBackupSchedule(): Promise<BackupSchedule> {
  const raw = await storage.getAppSetting(SETTING_KEY);
  if (!raw) return { ...DEFAULT_SCHEDULE };
  try {
    return { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

export async function saveBackupSchedule(schedule: BackupSchedule): Promise<void> {
  await storage.setAppSetting(SETTING_KEY, JSON.stringify(schedule));
}

function atTime(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** The slot of `time` on or after `now`. */
function nextOccurrence(time: string, now: Date): Date {
  const today = atTime(now, time);
  if (today >= now) return today;
  today.setDate(today.getDate() + 1);
  return today;
}

/** When the next backup is due; a slot missed by more than the run window rolls to the next day's slot. */
export function nextBackupAt(schedule: BackupSchedule, now = new Date()): Date {
  if (!schedule.lastRunAt) return nextOccurrence(schedule.time, new Date(now.getTime() - RUN_WINDOW_MS));
  const due = atTime(new Date(schedule.lastRunAt), schedule.time);
  due.setDate(due.getDate() + schedule.intervalDays);
  if (now.getTime() - due.getTime() > RUN_WINDOW_MS) {
    return nextOccurrence(schedule.time, new Date(now.getTime() - RUN_WINDOW_MS));
  }
  return due;
}

function autoBackupName(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${now.getFullYear()}-autobackup`;
}

/** Delete the oldest *-autobackup.xml files beyond `keepLast`; manual backups are never touched. */
export async function pruneAutoBackups(): Promise<void> {
  const { keepLast } = await getBackupSchedule();
  if (!keepLast) return;
  const files = (await fs.promises.readdir(BACKUPS_DIR)).filter((f) => f.includes("-autobackup") && f.endsWith(".xml"));
  const withTimes = await Promise.all(
    files.map(async (f) => ({ f, mtime: (await fs.promises.stat(path.join(BACKUPS_DIR, f))).mtimeMs })),
  );
  withTimes.sort((a, b) => b.mtime - a.mtime);
  for (const { f } of withTimes.slice(keepLast)) {
    await fs.promises.unlink(path.join(BACKUPS_DIR, f)).catch(() => {});
    log(`[AutoBackup] pruned ${f}`);
  }
}

async function tick(): Promise<void> {
  const schedule = await getBackupSchedule();
  if (!schedule.enabled) return;
  const now = new Date();
  const due = nextBackupAt(schedule, now);
  if (now < due || now.getTime() - due.getTime() > RUN_WINDOW_MS) return;

  const [active] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.type, "export_xml"), inArray(tasks.status, ["pending", "in_progress"])))
    .limit(1);
  if (active) return;

  await storage.createTask({
    type: "export_xml",
    status: "pending",
    payload: JSON.stringify({ filename: autoBackupName(now), includeHistory: schedule.includeHistory, auto: true }),
  });
  await saveBackupSchedule({ ...schedule, lastRunAt: now.toISOString() });
  triggerTaskWorker();
  log(`[AutoBackup] started ${autoBackupName(now)}.xml`);
}

export function startBackupScheduler(): void {
  const run = () => tick().catch((err) => log(`[AutoBackup] tick failed: ${err?.message ?? err}`));
  void run();
  setInterval(run, CHECK_MS);
}
