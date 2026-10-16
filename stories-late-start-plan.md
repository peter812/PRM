# Queued scans don't start when prm-stories comes up after PRM

## Symptom

PRM is running with a manual scan queued (Social Tasks shows it "queued"). prm-stories is
started afterwards. The scan doesn't start, or starts only after a long, unexplained wait.

## Cause

Manual jobs only move when something calls `kickManualTrackingJobs()`
(`server/stories-scheduler.ts:303`). Nothing calls it when prm-stories comes up:

1. **The scan was queued while PRM was already up.** The kick claimed the job, `startRun` got a
   fetch error, and the run was recorded as `unreachable`. The job was released back to
   `queued`, and the only retry is an in-memory `setTimeout` of `UNREACHABLE_RETRY_MS`
   (15 min, line 319). Starting prm-stories during that window changes nothing. The scan waits
   up to 15 minutes, which looks like it's stuck.
2. **The scan was queued before PRM (re)started.** That timer died with the old process.
   `startStoriesScheduler()` never kicks, and `tick()` handles only the scheduled
   stories and tracking windows, not manual jobs. The scan stays queued until the next
   morning tracking window claims it, and only if `trackingEnabled` is on. If it's off, the
   scan never starts.

prm-stories doesn't tell PRM it's up. It listens, runs `ensureLoggedIn()` (holding `running = true`), and then waits.

## Fix

### 1. prm-stories tells PRM when it's ready (the main fix)

- **PRM**, `server/routes/stories.ts`: add `POST /api/v1/stories/ready`, which calls
  `kickManualTrackingJobs()` and returns `{ ok: true }`. It needs no token. The kick is
  debounced, idempotent, and only acts on jobs that are already queued, and
  `hasRunInFlight` keeps it from minting a second run. So an unauthenticated caller can do no
  more than click "Run" on the queue.
- **prm-stories**, `src/deliver.ts`: add `announceReady()`, which sends a best-effort
  `fetch(`${cfg.prmUrl}/api/v1/stories/ready`, { method: "POST" })`. It swallows errors,
  because PRM may be down and then fix 2 covers it.
- **prm-stories**, `src/index.ts`: call `announceReady()` in two places:
  - at the end of `ensureLoggedIn()` on the logged-in path, after `running = false`. Calling it
    earlier would get `already_running` back, which costs a 60 s `BUSY_RETRY_MS`.
  - after `confirmAndCacheLogin()` succeeds, which covers both the startup login window and
    `POST /login`. A scan that was queued while the profile was logged out starts as soon as
    the login finishes.

### 2. PRM kicks on startup

- `startStoriesScheduler()`: call `kickManualTrackingJobs(15_000)` beside the first `tick`.
  This covers case 2. If prm-stories is already up, the scan starts right away. If it isn't,
  the kick falls into the existing 15-minute retry chain, and fix 1 cuts that short once the
  service comes up.

### Not doing

- Shortening `UNREACHABLE_RETRY_MS`: with fix 1 it's only a backstop, and polling a service
  that's down every minute adds noise to the run history.
- Making `tick()` look for queued manual jobs every minute: fixes 1 and 2 cover both ways a
  kick gets lost. Add this only if a third way turns up.

## Steps

| # | Repo | Change | Verify |
|---|------|--------|--------|
| 1 | PRM | `POST /api/v1/stories/ready` route; startup kick in `startStoriesScheduler` | Stop prm-stories, queue a scan: the run is logged `unreachable`. Restart PRM: the log shows the kick, and the scan is still queued. |
| 2 | PRM-stories | `announceReady()` after a confirmed login (startup and `/login`) | With PRM up and a scan queued, start prm-stories. Once it logs "profile is logged in", PRM logs a tracking run `running` within seconds, with no 15-minute wait. |
| 3 | both | Edge cases | Start prm-stories logged out with a scan queued: the scan starts after the login window closes. Start prm-stories while PRM is down: no crash, and when PRM starts later, its startup kick picks the scan up. |
