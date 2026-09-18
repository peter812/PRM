# Stories service queue — plan

Today every task PRM hands to a prm-stories install is one Chrome launch:
`POST /run` or `POST /track` opens the profile, does the work, closes the
browser. A second request while one is running is refused
(`already_running`) and PRM retries later. With stories, scheduled tracking
and manual jobs all landing on the same install, that means several launches
an evening and work that waits for no reason.

This plan gives the service a **queue of exactly one extra slot** and gives
PRM a **task list** that feeds that slot one item at a time. When a task ends
and the slot holds another, the service moves on to it in the same Chrome
window; when the slot is empty, it leaves Instagram the way a person does and
closes. PRM never sends more than the service can hold: it asks the service
what it holds before it sends anything.

Companion documents: `instagram-stories-plan.md` (the service, its auth and
run rows) and `account-tracking-plan.md` (tracking jobs, claiming, budgets).

Decisions (2026-09-16):

| Question | Answer |
|---|---|
| How the service knows there is more work | PRM pushes into a one-slot queue on the service; the service continues with whatever is in the slot and closes when it is empty. No pull endpoint, no polling |
| What the service continues with | Anything in the slot — eligibility is PRM's decision, made in its task list |
| Tracking granularity | A batch of jobs per task, as today (`trackingMaxJobs`, a budget) |
| Session ceiling | None. Chrome stays open as long as PRM keeps the slot fed |

---

## 1. The service (PRM-stories)

### 1.1 State

`index.ts` replaces the `running` boolean with:

```ts
type Task = { kind: "stories" | "tracking"; runId: string; token: string; body: TaskBody };
let current: Task | "login" | null = null;   // what Chrome is doing
let queued: Task | null = null;              // the one extra slot
```

`"login"` is the login window (`/login`), which still takes the whole
profile and accepts nothing into the slot.

### 1.2 Endpoints

| Route | Idle | Busy, slot empty | Busy, slot full |
|---|---|---|---|
| `POST /run`, `POST /track` | start now; answer after the session check as today: `200 {ok, username}` / `409 {ok:false, reason}` | put it in the slot; `202 {ok:true, queued:true, username}` (the username Chrome is logged in as) | `409 {ok:false, reason:"queue_full"}` |
| `POST /status` (new) | `{current:null, queued:null}` | `{current:{runId,kind}, queued:null, username}` | `{current, queued:{runId,kind}, username}` |
| `POST /login` | opens the window | `409 already_running` | `409 already_running` |

Every request still needs the secret; `/run` and `/track` still confirm the
token with PRM (`acceptToken`) before anything is stored, so a queued task is
already authenticated when its turn comes. `/status` is what PRM consults
before sending, so the DB mirror (§2.2) can never make PRM overfill the slot
after a service restart.

### 1.3 The session and the task loop

New `src/session.ts` owns the browser for the whole sitting:

```ts
type Session = { browser: Browser; page: Page; human: Human; username: string };
openSession(): Promise<Session | { state: SessionState | "no_username" }>
   // launch(false), goto instagram.com, sessionState, loggedInUsername — the
   // checks runOnce/trackOnce do first today, once per sitting
closeSession(s): // "leave the way a person does": home feed, scrollFeed(1), browser.close()
```

`runOnce` and `trackOnce` stop launching and closing Chrome. Each takes the
`Session` plus its own run dir, attaches its own capture (`attach` returns a
`detach()` that removes the `page.on("response")` listener so raw dumps and
tripwires stay per task), and returns its manifest. Their `onSession`
callback goes: the session check happens in `openSession` and the loop
reports it.

The loop in `index.ts`:

```
startSitting(first):
  s = openSession()
  if not ok: answer first with the reason; drop `queued` (§1.5); return
  answer first with {ok, username}
  task = first
  while task:
    m = runTask(s, task)          // runOnce / trackOnce with the task's token active
    deliverPending()
    if m.status is a tripwire / needs_login / error that ends the sitting: break
    task = queued; queued = null
    if task: transition(s)        // §1.4
  drop whatever is still queued (§1.5)
  closeSession(s)
  current = null
```

`current` is set for the whole sitting; `queued` is written only by the HTTP
handler and read only by the loop, so no locking is needed beyond the
single-threaded event loop.

**Tokens.** `deliver.ts` keeps one active token; the loop sets it when a task
starts (`useToken(task.token)`). PRM accepts any live token for any run, so
`deliverPending` retries from the previous task under the next task's token
are fine.

**Run directories.** Unchanged: `runs/<date>/` for stories (a second stories
run the same day shares it, as a "Run now" does today), `runs/<date>T<HHMM>-track/`
for tracking. `logTo(runDir)` switches per task.

### 1.4 Transition between tasks

Between two tasks the person "comes back to the feed": `page.goto("/")`,
`pause(8, 25)`, `chance(0.5) && scrollFeed(1–2)`. Both runners already start
with a `goto("/")` and a `sessionState` check, so a session Instagram dropped
mid-sitting is caught by the next task and ends it with `needs_login` as
today. Nothing else about the human pacing inside a task changes.

### 1.5 Ending a sitting with a task still queued

If the sitting ends before the queued task ran — a tripwire (`rate_limited`,
`checkpoint`), `needs_login`, an unhandled error, or `openSession` failing —
the queued task never starts. The service posts a manifest for it with
`status: "not_started"` and `error: "sitting ended: <reason>"` under its own
token, so PRM's row does not stay `queued` forever. PRM treats `not_started`
like a declined start: tracking jobs are **released** (`releaseTrackingJobs`),
not failed, so manual jobs stay queued and schedule jobs come back tomorrow.

### 1.6 Service restart

A restart loses `current` and `queued`. PRM's rows for them stay `running` /
`queued` until the 6-hour token expires; the next `feed` (§2.3) calls
`/status`, sees the service idle, marks those rows `lost`
(`error: "service restarted"`), releases their tracking jobs, and sends the
next pending item. This also covers today's gap where a service crash leaves
a run `running` indefinitely.

---

## 2. PRM: the task list and the dispatcher

### 2.1 Run rows as the task list

`story_scrape_runs` already has one row per task and a `kind`. Two statuses
are added ahead of `starting`:

| Status | Meaning |
|---|---|
| `pending` | In PRM's list, not yet sent. No token, no jobs claimed |
| `queued` | Sent; sitting in the service's slot. Token minted, tracking jobs claimed and stamped with the run id |
| `starting` → `running` → terminal | As today |
| `not_started`, `lost`, `nothing_due` | New terminal statuses (§1.5, §1.6, §2.3) |

A row is created `pending` by every source that today calls the service
directly:

| Source | Today | After |
|---|---|---|
| Stories tick (`tickStories`) | `triggerStoriesRun` | insert `pending` stories row, then `feed(importer)` |
| Tracking tick (`tickTracking`) | claim + `triggerTrackingRun`, retry in 30 min on `already_running` | insert `pending` tracking row (only if none pending/queued for the importer), then `feed`. The 30-minute retry goes away |
| Manual jobs (`kickManualTrackingJobs`) | claim manual-only + trigger | insert `pending` tracking row `{manualOnly: true}` if none pending/queued, then `feed` |
| "Run now" | `triggerStoriesRun` | insert `pending`, `feed`; the reply says `running` / `queued` / `pending` |
| "Track now" | claim + trigger | same as manual jobs, but not `manualOnly` |

Pending tracking rows are deduplicated per importer because a batch claims
whatever is due at send time — two pending batches would just claim the same
queue twice. Pending stories rows are not deduplicated (a "Run now" after the
evening run is a deliberate second pass).

`skipToday` (rate-limit backoff, random day off) still runs at tick time and
still records a `skipped` row instead of a `pending` one.

What dispatch needs to build a pending tracking row's payload —
`{ manualOnly?: boolean, budgetMinutes?: number }` — goes in a new nullable
`params jsonb` column on `story_scrape_runs`.

### 2.2 The mirror

PRM's picture of the service is the importer's rows with status `queued`
or `running`/`starting`. It is a cache: `feed` always confirms with `/status`
before sending (§1.2), and reconciles the rows to what the service says.

### 2.3 `feed(importer)`

One function in `stories-scheduler.ts`, serialized per importer with an
in-memory `Map<importerId, Promise>` so the tick, a manifest ending and a
"Run now" can't all send at once:

```
feed(importer):
  status = POST /status            (unreachable → leave everything pending; log)
  reconcile: rows running/queued that the service doesn't hold → lost (§1.6)
  if status.queued: return         // slot full; nothing to do
  next = oldest pending row for importer
  if !next: return
  build the payload:
    stories:  { videos: importer.downloadVideos }
    tracking: claim jobs (manualOnly per params; limit trackingMaxJobs);
              none → row becomes `nothing_due` (terminal), loop to the next pending row
              budget = params.budgetMinutes ?? max(minutes left in the tracking window, 60)
  mint token; row → starting (as startRun does today)
  POST /run | /track
    200 ok            → running, scrapedFrom = username
    202 queued        → queued, scrapedFrom = username
    409 queue_full /
        already_running → back to pending (mirror was stale), return
    other decline / unreachable → terminal as today; tracking jobs released
  if the service was idle and now has an empty slot: loop once more so the
  slot is filled right away
```

`startRun` becomes the "build, mint, POST, record" half of this; the
`triggerStoriesRun` / `triggerTrackingRun` exports go away in favour of
`enqueue(importer, kind, params)` + `feed`.

### 2.4 When the slot frees

The manifest route (`POST /api/v1/stories/runs`) already sees every run end.
After it records a terminal status it calls `feed(importer)` for the run's
importer (in place of today's `kickManualTrackingJobs()`, which becomes
"insert a pending manual batch if any manual jobs are queued, then feed").
A `running` manifest for a row that was `queued` flips it to `running` —
stories runs already post the manifest after every account and tracking
after every job; add one at task start for both so PRM's list moves the
moment the slot is taken.

The scheduler tick also calls `feed` for every enabled importer that has a
pending row, so a service that was unreachable is retried every minute
without any special casing.

### 2.5 Budgets and windows

A pending tracking row created inside the morning window may not be sent
until the evening stories run is over. Its budget is computed at send time:
the minutes left in the tracking window, but never under 60 — so a batch
sent after the window still gets a full hour rather than the 15-minute floor
`tickTracking` uses today. Nothing is dropped for being late; that is what
"no session cap" means.

---

## 3. Protocol summary

Service ← PRM (all with `x-stories-secret`):

| | Body | Replies |
|---|---|---|
| `POST /run` | `{runId, token, videos}` | `200 {ok:true, username}` · `202 {ok:true, queued:true, username}` · `409 {ok:false, reason: needs_login \| checkpoint \| no_username \| queue_full \| already_running \| bad_token \| …}` |
| `POST /track` | `{runId, token, jobs, budgetMinutes, posts}` | same |
| `POST /status` | — | `200 {current: {runId, kind} \| null, queued: {runId, kind} \| null, username: string \| null}` |
| `POST /login` | — | as today |

PRM ← service (with `x-stories-token`): unchanged routes. New manifest
status PRM must accept: `not_started` (release jobs, no `failUnfinishedJobs`).

---

## 4. UI

- `social-tasks.tsx` / `instagram-runs.tsx`: `pending`, `queued`,
  `not_started`, `lost`, `nothing_due` in `STATUS_VARIANT` with labels
  ("Waiting in PRM", "Queued on the service", …). Pending and queued rows
  sort to the top of the list. Deleting a `pending` row (existing delete
  route) is how a task is cancelled; deleting a `queued` one is refused
  (the service already holds it).
- Importer card (`instagram-importers.tsx`): under the schedule, one line of
  live state from the rows: *Idle* / *Running: stories (as @x)* / *Running:
  tracking · Queued: stories* / *+ N waiting in PRM*. "Run now" and "Track
  now" toasts say where the task went: started, queued on the service, or
  waiting behind N others.
- Status copy in `client/src/lib/instagram.ts` for the new statuses.

---

## 5. Files

PRM-stories:
`src/index.ts` (state, endpoints, sitting loop) · new `src/session.ts` ·
`src/run.ts`, `src/track.ts` (take a `Session`; no launch/close) ·
`src/intercept.ts` (`detach`) · `src/deliver.ts` (`useToken`, `not_started`
manifest helper) · `README.md`.

PRM:
`shared/schema.ts` (`params` column on `story_scrape_runs`; status comment) ·
`server/db-init.ts` (the column) · `server/stories-scheduler.ts` (`enqueue`,
`feed`, `/status` client, reconcile; ticks insert instead of trigger) ·
`server/routes/stories.ts` (manifest → `feed`; `not_started`; run-now /
track-now enqueue; refuse deleting `queued`) · `server/routes/tracking.ts`
(manual kick → enqueue) · `server/tracking.ts` (no change beyond reuse of
`releaseTrackingJobs`) · client pages above.

Order of work: service first (it stays backward compatible — an old PRM
still gets `200`/`409` from `/run`), then PRM's schema + scheduler, then
routes, then UI.

---

## 6. Assumptions made here (say so if any is wrong)

1. **Kinds mix freely in one sitting.** The slot takes a stories task after a
   tracking one and vice versa; PRM's list is a single FIFO per importer.
2. **Late tracking batches still run**, with a 60-minute floor on the budget
   (§2.5), rather than being dropped when their window has passed.
3. **Two pending stories runs are allowed**; pending tracking batches are
   deduplicated per importer (§2.1).
4. **Cancelling** is PRM-side only (delete a pending row). There is no
   "stop the current task" or "drop the queued task" call to the service.
5. **The login window is not queued behind**: `/login` while a sitting is
   open still answers `already_running`; the settings page keeps its toast.
6. **`lost` reconciliation only happens on `feed`**, i.e. when there is
   something to send or a tick runs; there is no separate watchdog.
