# Nightly Dev Updates Plan

A dev tester runs one script once. From then on their PRM-dev instance pulls its branch every
night and restarts itself.

## What already exists (and what we reuse)

- `start-dev.bat` / `start-dev.sh`: start Whisper in Docker (`docker-compose.whisper.yml`), then
  `npm run dev`. The nightly script runs these same two steps, so dev testers get the same app.
- `server/db-init.ts` runs `npm run db:push -- --force` on every boot, so **a restart applies
  schema changes on its own**. The script needs no migration step.
- `PORT` from `.env` (default 5000) picks the port; the health check reads the same value.
- The server has no SIGTERM handler, so stopping it is a hard kill either way. That's fine for a
  dev instance; jobs that were running get picked up again by the task worker.

## Usage

```powershell
# One-time setup: switch to the branch, start PRM-dev, register the nightly task
.\scripts\prm-dev-nightly.ps1 -Install -Branch Version-3

# Change the branch later (updates the saved config, pulls and restarts right away)
.\scripts\prm-dev-nightly.ps1 -Install -Branch main

# Run tonight's update now
.\scripts\prm-dev-nightly.ps1 -Update

# Remove the scheduled task and stop PRM-dev
.\scripts\prm-dev-nightly.ps1 -Uninstall
```

| Flag | Default | Meaning |
|---|---|---|
| `-Branch <name>` | current branch | Branch to track. Saved, so the nightly run doesn't need it. |
| `-Time <HH:mm>` | `00:00` | Nightly run time (24h). |
| `-Install` / `-Update` / `-Uninstall` / `-Start` / `-Stop` | none | What to do. `-Start` is what the logon trigger runs. |

## Files

- `scripts/prm-dev-nightly.ps1`: the script (Windows, matching `start-dev.bat`).
- `.prm-dev/` (gitignored): `config.json` (branch, time), `prm.pid`, `logs/`.
- `.gitignore`: add `/.prm-dev/`.
- `QUICKSTART.md`: a short "Dev tester: nightly updates" section.

## Nightly update flow (`-Update`)

1. **Lock**: skip if another update is still running (`.prm-dev/update.lock`).
2. **Dirty-tree guard**: if `git status --porcelain` shows tracked changes, log it, **don't
   pull**, and just restart. Never `reset`, `stash` or `checkout --` to make a pull work,
   because the tester's local edits matter more than tonight's update.
3. **Pull**: `git fetch origin <branch>`. If the current branch isn't `<branch>`, run
   `git switch <branch>` (create it tracking `origin/<branch>` when needed). Then run
   `git merge --ff-only origin/<branch>`. If the branch can't fast-forward (it was force-pushed
   or has local commits), log it and keep the current commit.
4. **Dependencies**: compare `package-lock.json` between the old and new HEAD
   (`git diff --quiet <old> <new> -- package-lock.json`). Run `npm install` only if it changed.
5. **Stop**: kill the process tree in `prm.pid` (`taskkill /T /F /PID`). `npm` → `tsx` → `node`
   is a tree, so killing only `npm` would leave `node` holding the port. Fallback: kill whatever
   owns `PORT` (`Get-NetTCPConnection -LocalPort`), but **only if** its command line points at
   this repo, so the script never kills another PRM.
6. **Start**: `docker compose -f docker-compose.whisper.yml up -d`, then `npm run dev` hidden,
   with stdout/stderr going to `logs/app-YYYY-MM-DD.log`. Write the new PID.
7. **Health check**: poll `http://localhost:$PORT/` for up to ~3 minutes, since the boot
   migration takes a while. Log `OK <old-sha> → <new-sha>` or `FAILED` along with the last
   50 lines of the app log.
8. **Prune**: delete logs older than 14 days.

Per the request, the restart happens **every night**, even with no new commits. That also clears
any memory the long-running dev server has built up.

## Scheduling (`-Install`)

Two `Register-ScheduledTask` tasks, named after the clone folder so two clones don't collide:

- `PRM-dev (<folder>) nightly update`: daily at `-Time` → `-Update`.
- `PRM-dev (<folder>) start at logon`: at logon → `-Start`, so PRM-dev comes back after a reboot.
- Settings: `-StartWhenAvailable` (runs a missed update if the PC was off at midnight),
  `-WakeToRun`, and an execution time limit of 1 hour.
- Runs as the current user, "only when logged on". "Whether logged on or not" needs the tester
  to type their Windows password into Task Scheduler themselves. The plan notes this and leaves
  it to them.

`-Install` also runs the first `-Update` right away, so the tester sees it working.

## Prerequisites (checked by `-Install`, with a clear message if missing)

- A **separate clone** for PRM-dev, e.g. `C:\Repos\PRM-dev`, not a working checkout someone
  develops in. The dirty-tree guard protects a working checkout, but a dedicated clone is the
  intended setup.
- `.env` exists. Use a **separate `DATABASE_URL`** (a dev database) and its own `PORT` (e.g.
  5050). The boot `db:push --force` can drop columns when you switch to an older branch, so
  PRM-dev must not share a database with real data.
- `git`, `node`/`npm` and `docker` are on PATH. PRM-S3 is reachable at `PRM_S3_ENDPOINT` (if
  not, warn but continue).

## Out of scope (for now)

- Rolling back automatically when the health check fails. A failure gets logged and the instance
  stays on the new commit, so the tester can see what broke.
- A Linux/macOS version (`prm-dev-nightly.sh` with cron + `nohup`). If testers need it, it's a
  straightforward port of the same flow.
- Notifications (email/Slack) on failure.

## Verification

1. Run `-Install -Branch <test-branch>` on a scratch clone. Check that the task exists
   (`Get-ScheduledTask 'PRM-dev*'`), the app answers on `PORT`, and the PID is
   saved.
2. Push a commit to the test branch, run `-Update`, and check the log shows `old → new` and the
   app restarted (new PID).
3. Change `package-lock.json` in a commit and confirm `npm install` runs; on a commit without
   that change, confirm it's skipped.
4. Edit a tracked file locally, run `-Update`, and confirm it logs "dirty, skipped pull" and the
   edit is untouched.
5. Run `Start-ScheduledTask` to fire the real task once, end to end.
6. Run `-Uninstall`: the task is gone and nothing is listening on the port.
