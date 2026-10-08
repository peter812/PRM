# Status dot — plan

A single dot at the far right of the top header shows the health of everything
PRM depends on. Clicking it opens a popover anchored to the top-right corner
with one row per service:

```
┌──────────────────────────────────────────────┐
│ ●  PRM        Online                         │
│ ●  S3         Online                         │
│ ●  Compute    Online, API key setup required │  ← yellow
│ ●  Stories    Paused: rate limit until 3:40p │  ← yellow
└──────────────────────────────────────────────┘
```

- **Dot** (per row): green = working, yellow = issue, red = offline / error.
- **Name**: PRM · S3 · Compute · Stories.
- **Right side**: `Online` when green; otherwise the issue text.
- **Header dot** = the worst of the four rows.

**As built (2026-10-05)** — simpler than the plan below:
- No new status type: the route reuses `ServiceHealthResult` (`online` → green,
  `degraded` / `not_configured` → yellow, `offline` → red).
- No 10 s route cache (S3 already caches its own probe) and no "slow DB"
  threshold or Refresh footer.
- The service stores only `profile/paused-until.txt` (an ISO time) and declines
  with reason **`paused`**, not `rate_limited`. A `rate_limited` run row would
  restart PRM's 48 h backoff on every decline.
- §3.2 step 6 ("one clock") was dropped. PRM keeps its own 48 h clock. When that
  clock ends before the service's, the next start is declined as `paused`, the
  run row shows the end time, and manual jobs retry in 15 minutes.

Companion documents: `stories-queue-plan.md` (which already proposes a
`POST /status` on the stories service) and `instagram-stories-plan.md`.

---

## 1. One status shape

```ts
// shared/schema.ts (next to the other shared API types)
export type ServiceState = "ok" | "issue" | "down";
export type ServiceStatus = { state: ServiceState; message: string };
export type StatusDot = { prm: ServiceStatus; s3: ServiceStatus; compute: ServiceStatus; stories: ServiceStatus };
```

`message` is `"Online"` when `state === "ok"`, and the issue text otherwise.

## 2. Server: `GET /api/status-dot`

Add it to `server/routes/setup-services.ts`, which already contains the S3
and Compute probes. Do not reuse `/api/setup/services/health` as it is: that
route also tests every AI provider, Qdrant and Whisper on each call, which is
too heavy for a 30-second poll.

**Reuse rather than copy.** Move the S3 and Compute blocks of
`/api/setup/services/health` into two helpers, `checkS3()` and
`checkCompute()`, in the same file. Both routes call them.

| Row | Source | ok | issue | down |
|---|---|---|---|---|
| **PRM** | The fact that the route answered, plus `SELECT 1` against Postgres | DB answers | DB query fails or is slow (> 2 s) | Client-side only: the fetch fails, so the backend cannot be reached |
| **S3** | `checkPrmS3Health()` (already cached for 10 s) | `ok` | — | `!ok`, with its message |
| **Compute** | `checkCompute()`, based on today's `/api/setup-status` probe | `setup_completed` | Online but setup not complete, a non-200 response, or no URL configured | Unreachable |
| **Stories** | `checkStories()`, see §3 | Reachable and not paused | Paused (rate limit), needs login or checkpoint, or no importer configured | Unreachable |

Auth: `requireAuth`. The dot only renders for a signed-in user.

Cache the whole result for 10 s, the same way `checkPrmS3Health` does, so
several open tabs share one probe.

## 3. Stories status, and the new rate-limit pause

### 3.1 Today

- PRM-stories detects a rate limit (a 429 response or Instagram's rate-limit
  message, in `src/intercept.ts`), sets `cap.tripwire = "rate_limited"`, ends
  the run, and reports `status: "rate_limited"` in the manifest.
- PRM works out the backoff on its own: `rateLimitedUntil()` in
  `server/stories-scheduler.ts` returns `last run startedAt + 48 h`.
- The service itself does not know it is paused. If it is asked to run during
  the backoff, it runs.

### 3.2 Change: the service owns and reports its pause

In **PRM-stories** (`C:\Repos\PRM-stories`):

1. **Record the pause.** When a run or track ends with
   `tripwire === "rate_limited"`, write `profile/../pause.json`
   (`{ until, reason: "rate_limited", since }`), with
   `until = now + cfg.rateLimitBackoffHours` (default 48). The pause is stored
   on disk so it survives a service restart.
2. **Respect it.** While `until` is in the future, `/run` and `/track` reply
   `409 { ok:false, reason:"rate_limited", until }` without opening Chrome.
   Delete the file once it has expired.
3. **Report it.** Add `POST /status` (authenticated with the same secret,
   alongside `/whoami`):
   ```json
   { "ok": true, "username": "…", "running": false,
     "paused": { "reason": "rate_limited", "until": "2026-10-07T15:40:00Z" } | null }
   ```
   `stories-queue-plan.md` §1.2 already proposes `POST /status`. This adds
   the `paused` and `running` fields, and the queue work can add
   `current` / `queued` to the same response later.

In **PRM**:

4. **`checkStories()`** posts to `${serviceUrl}/status` for each enabled
   importer (using `storiesServiceHeaders`, with a 3 s timeout). The worst
   importer decides the row. If there is more than one importer, the message
   starts with the importer label.
   - unreachable → `down`, "Offline"
   - `paused` → `issue`, "Paused: rate limit backoff until {local time}"
   - last run `needs_login` / `checkpoint` → `issue`, "Needs login" /
     "Instagram checkpoint"
   - no importers → `issue`, "No stories importer configured"
   - otherwise → `ok` (and while `running`, the message is "Online, running")
5. **Scheduler.** Treat a `409 rate_limited` reply in `startRun` as a
   `skipped` run that carries the service's `until`, not as an error.
6. **One clock.** Have `rateLimitedUntil()` prefer the service's
   `paused.until` and fall back to the run-row calculation only when the
   service is unreachable. This keeps the scheduler and the dot in agreement.
   *(See open question 1.)*

## 4. Client

### 4.1 `client/src/components/status-dot.tsx` (new)

- `useQuery<StatusDot>({ queryKey: ["/api/status-dot"], refetchInterval: 30_000, refetchIntervalInBackground: false })`.
  This uses the same polling pattern as `PrmS3StatusGuard`.
- If the query fails, show PRM as `down` ("Backend offline") and the other
  three as `down` ("Unknown, backend offline").
- The trigger is a `Button variant="ghost" size="icon"` containing a 10 px
  dot. Its colour is the worst state: green-500, amber-500 or red-600 (Tailwind
  token classes, so it works in dark mode). When the state is not ok, the dot
  gets an `animate-pulse` ring.
- The panel uses `Popover` from `@/components/ui/popover` with
  `align="end"`. It shows four grid rows (`dot | name | message`), with the
  message right-aligned and wrapping. The footer has a Refresh button and
  shows "checked Ns ago".
- `data-testid`: `button-status-dot`, `status-row-{prm|s3|compute|stories}`.

### 4.2 `App.tsx`

Render `<StatusDot />` as the last child of the header's right-hand
`div.flex.items-center.gap-1` (around `App.tsx:398`), so it sits in the top-right corner,
and only when `user` is set.

### 4.3 Fold the S3 guard into the same poll

`PrmS3StatusGuard` currently runs its own 30-second poll of
`/api/prm-s3/health`. Point it at the `/api/status-dot` query (read `s3`, and
treat a query error as backend offline, as it does today) so the browser polls
once. The blocking modal and the red banner stay unchanged. Keep the
`/api/prm-s3/health` route, because Settings → Image Storage uses it.

## 5. Order of work

1. PRM-stories: `pause.json`, the 409 guard and `POST /status` (§3.2, steps 1–3).
2. PRM server: `ServiceStatus` types, extract `checkS3` / `checkCompute`,
   `checkStories`, `GET /api/status-dot`.
3. PRM scheduler: handle the 409 `rate_limited` reply and the one-clock
   change (§3.2, steps 5–6).
4. Client: `status-dot.tsx`, add it to the header, and move the S3 guard to
   the shared query.
5. Verify in the browser pane:
   - all green;
   - stop PRM-s3 → S3 red (and the existing modal appears);
   - stop compute → red;
   - hand-write a future `pause.json` → Stories yellow showing the time;
   - stop the PRM server → everything red.

## 6. Open questions

1. **Who owns the 48 h backoff?** The recommendation is the service (§3.2),
   with PRM reading it. The alternative is to leave the service unchanged and
   have the dot read PRM's existing `rateLimitedUntil()`. That needs zero
   service changes, but the service still cannot *say* it is paused, which is
   what was asked for.
2. **PRM-stories or PRM-stories-2?** Both folders exist. This plan targets
   `C:\Repos\PRM-stories`.
3. **Not-configured services** (for example, no Compute URL): should they be
   yellow, as planned here, or hidden from the panel?
