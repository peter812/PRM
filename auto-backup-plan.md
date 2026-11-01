# Auto Backup Plan

Scheduled XML backups from the Backups page, reusing the existing `export_xml` task.

## Defaults
- Enabled, every **7 days**, at **3:00 AM** (server local time)
- Filename: `MM-DD-YYYY-autobackup.xml` (e.g. `10-28-2026-autobackup.xml`). A same-day collision already gets `-<timestamp>` appended by `processExportXmlTask`.

## Decisions
- Retention: keep the newest **5** `*-autobackup.xml` files (count editable); manual backups never pruned.
- Missed run (server off at the slot): **no catch-up** — wait for the next 3 AM (the following day), not on startup.
- Social history: **off** by default, toggle on the card.
- Timezone: **server local time** (Docker = UTC unless `TZ` is set — the card shows server-time label).

## 1. Settings (no schema change)
One `app_settings` row, key `backup_schedule`, JSON via `storage.getAppSetting`/`setAppSetting`:
```ts
{ enabled: true, intervalDays: 7, time: "03:00", includeHistory: false, keepLast: 5, lastRunAt: string | null }
```
Missing row → defaults above.

## 2. Scheduler — `server/backup-scheduler.ts` (new)
- `startBackupScheduler()` registered in `server/index.ts` next to `startFaceClusteringScheduler()`.
- Checks every 5 minutes (same `setInterval` style as the other schedulers); restart-safe because state lives in the DB.
- `nextRunAt(schedule, now)`:
  - due = no `lastRunAt` ? next occurrence of `time` : calendar date of `lastRunAt` + `intervalDays`, at `time`
  - if `now` is more than 15 min past `due` (missed slot) → next occurrence of `time` after `now` (tomorrow's 3 AM)
- On tick, if `enabled && due <= now <= due + 15min` and no `export_xml` task is pending/running:
  create `export_xml` task with `{ filename: "MM-DD-YYYY-autobackup", includeHistory, auto: true }`, `triggerTaskWorker()`, save `lastRunAt = now`.
- Pruning: in `processExportXmlTask`, after a successful `auto` export, delete `*-autobackup.xml` beyond the newest `keepLast` (by mtime).

## 3. Routes — `server/routes/backups.ts`
- `GET /api/backups/schedule` → `{ ...schedule, nextRunAt }`
- `PUT /api/backups/schedule` → validate (`intervalDays` in allowed list, `time` matches `HH:MM`), save, return same shape.

## 4. UI — `client/src/pages/backups-page.tsx`
New **Automatic Backups** card above "Past Backups":
- Switch: Enabled
- Select **Frequency**: Daily / Every 3 days / Weekly (default) / Every 2 weeks / Every 30 days
- Select **Time**: 30-minute steps, 12:00 AM – 11:30 PM (default 3:00 AM)
- Switch: Include Social Account History
- Select **Keep last**: 3 / 5 (default) / 10 / 20 / All
- Line: "Next backup: Tue, Nov 4, 3:00 AM" · "Last: …"
- Saves on change (PUT + invalidate `/api/backups/schedule`)
- Past Backups rows ending `-autobackup.xml` get a small "Auto" badge.

## Verify
- Set time a few minutes ahead, interval Daily → file appears in `backups/` with the right name.
- Restart server → doesn't double-run; `nextRunAt` unchanged.
- Disable → no runs.
