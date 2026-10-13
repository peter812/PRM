# Summary Host Pool — spread social-media summary runs across several Ollama hosts

## Goal

When summary jobs are queued, send their AI calls to different Ollama hosts so a
backlog finishes faster. **Scope: social-media summary runs only.** Ask-AI chat,
describe-me, find-name, embeddings and vector reindex keep using their
single configured provider, unchanged.

## Decisions (from Q&A)

| Question | Decision |
|---|---|
| Config model | A **pool of existing providers**. Each host is still its own row in `ai_providers` (own URL and auth); the pool lists which ones summary runs may use. |
| Models | **Assume every pool member has the same models.** The scene model and text model names in summary settings apply on every host. |
| Scope | Summary queue only, with **order kept**: image descriptions, then the post summary; post summaries, then the account summary. |
| Slots and failures | Each member has a **configurable slot count** (default 1, matching its `OLLAMA_NUM_PARALLEL`). An unreachable host is **skipped for 30 s** and the call retries on another host. |

## Current state (what changes)

- `server/summary-queue.ts` `wakeSummaryRunner()` drains jobs **one at a time**
  (`while (await processNextJob())`). This is the only real bottleneck.
- `claimNextSummaryJob()` already uses `FOR UPDATE SKIP LOCKED`, and it holds
  back an account job while any post job for that account is `pending` or
  `running`. Claiming several jobs at once is therefore already safe, and the
  post-to-account ordering already holds.
- `runPostSummaryJob()` describes images **one after another** in a `for` loop,
  then makes one text call.
- `runStorySummary()` makes one multi-image vision call, then one text call.
- `runAccountSummaryJob()` makes one text call.
- `describeImage()` already takes `override: { providerId, model }`, so a
  chosen host can be passed straight through.

## Ordering rules (hard requirements)

1. **Image to post:** a post's text-summary call is not sent until every one of
   its image descriptions has finished, whether it succeeded or failed. Each
   image can go to a different host.
2. **Post to account:** an account summary is not claimed until all of that
   account's post jobs are done. The existing claim query already enforces
   this, because `running` counts as not done.
3. **Story:** the vision call finishes before the text call, which is already
   sequential inside one job.

These rules come from `await`ing inside a job. The pool only decides **which
host** runs each call and **when a slot frees up**. It never reorders calls
within a job.

## Design

### 1. Storage: one app setting, no new table

The pool is used only by summary runs, so it lives with the other summary
settings:

```
summary_host_pool = '[{"providerId":"<uuid>","slots":2},{"providerId":"<uuid>","slots":1}]'
```

- An empty value or `[]` means pool off. Behaviour is exactly as today: one
  job at a time on `summary_scene_provider` and `summary_text_provider`.
- Pool on means the scene and text **provider** settings are ignored, and the
  scene and text **model** names are used on every member.
- Deleting a provider in Settings → Intelligence drops it from the pool, or
  the pool loader skips missing ids.

If pools are later wanted outside summaries, promote this to an
`ai_provider_pools` table. That is not needed now.

### 2. `server/ai/host-pool.ts` (new, about 80 lines)

An in-process slot scheduler, modelled on the lane dispatcher in
`task-worker.ts`:

```ts
type Member = { provider: AiProvider; slots: number; inFlight: number; downUntil: number };

class HostPool {
  constructor(members: Member[]);
  /** Wait for a free slot on a live host, run fn on it, release the slot. Retries once per other host on ProviderUnreachableError. */
  run<T>(fn: (provider: AiProvider) => Promise<T>): Promise<T>;
  get totalSlots(): number;
}
```

- **Picking a host:** among live members with `inFlight < slots`, take the one
  with the lowest `inFlight / slots`, rotating round-robin on ties. If none is
  free, wait in a FIFO list that is woken on release.
- **Unreachable host:** set `downUntil = now + 30s`, release the slot and
  re-run `fn` on another host. This does **not** count against the job's
  `MAX_ATTEMPTS`. If every member is down, wait for the earliest `downUntil`
  rather than failing the job.
- **Other errors** (model error, HTTP 4xx/5xx, timeout) are passed back to the
  caller as they are today, and the job's normal retry logic handles them.
  A timeout is not treated as "host down", because a slow model is not a
  dead host.
- The pool is rebuilt from settings whenever summary settings are saved, which
  is where `routes/summaries.ts` already writes them. A rebuild waits for
  in-flight calls on removed hosts to finish naturally.

### 3. `server/ai/http.ts`: tell unreachable apart from other errors

Add `export class ProviderUnreachableError extends Error {}` and throw it from
the `catch` in `postJson` and `getJson` for the "Failed to reach …" case only.
The message text stays the same, so existing callers see no difference.

### 4. `server/summary-queue.ts`

**a. Concurrent runner.** Replace the sequential `while` loop with a
dispatcher:

```
maxJobs = pool ? pool.totalSlots + 1 : 1      // +1 keeps the next job's image fetch overlapping
while (running < maxJobs && aiEnabled && (job = claimNextSummaryJob())):
    running++; processJob(job).finally(() => { running--; wake() })
```

Keep the `redispatch` flag pattern from `dispatchImageTasks` so a
`wakeSummaryRunner()` call during a pass is not lost. With the pool off,
`maxJobs = 1`, which is today's behaviour.

**b. Route each AI call through the pool.** Add a helper:

```ts
const onPool = <T>(step: { providerId: string; model: string }, fn: (sel) => Promise<T>) =>
  pool ? pool.run((p) => fn({ providerId: p.id, model: step.model })) : fn(step);
```

Use it at the four call sites:

- post images: `describeImage(buffer, { override: sel, … })`
- post text: `chat(resolveModel("text", sel), …)`
- story vision and story text
- account text

**c. Describe a post's images in parallel.** Replace the `for` loop with
`await Promise.all(images.map(describeOne))`. Each image waits for a pool
slot on its own, so a 6-image post on 3 hosts runs 3 at a time. The text call
comes after the `Promise.all`, which enforces ordering rule 1. With the pool
off, run the images one at a time as today, so a single host is never
flooded.

**d. Write progress in order.** Concurrent images all call `saveProgress()`
on the same `progress` object. Chain the writes per job
(`saveChain = saveChain.then(write)`) so an older snapshot can never land
after a newer one.

**e. Startup reset is unchanged.** `startSummaryRunner()` already resets
`running` to `pending`.

### 5. API: `server/routes/summaries.ts`

- Add `hostPool: { providerId, slots }[]` to the summary settings GET and
  PUT.
- Validate on PUT: every `providerId` exists and is `kind = 'ollama'`, slots
  are an integer from 1 to 16, and there are no duplicates.
- Rebuild the pool and call `wakeSummaryRunner()` after saving.
- Optional `GET /api/summaries/host-pool/status` returns
  `[{ name, slots, inFlight, downUntil }]` for the live view below.

### 6. UI: `client/src/pages/instagram-summaries.tsx` settings

- Add a **"Hosts"** section: a list of Ollama providers with a checkbox and a
  slots number input each, plus a note to set slots to match each host's
  `OLLAMA_NUM_PARALLEL`.
- When at least one host is checked, hide the scene and text **provider**
  pickers and keep the **model** pickers, listing models from the first
  checked host.
- In the queue panel, show per-host status: in-flight / slots and a
  "down, retrying in Ns" badge. Read this from the status endpoint on the
  page's existing refresh interval.

## Things deliberately left out

- No model-aware routing. Every host is assumed to have the models; a
  missing model surfaces as a normal job error.
- No pooling for chat, embeddings, describe-me or find-name.
- No new DB table or migration, only a new app setting key.
- No cross-process coordination. Pool state is in-memory, the same as the
  current `runningPass` flag. This is fine because PRM runs as a single
  server process.

## Build order

1. `ProviderUnreachableError` in `http.ts`.
2. `host-pool.ts`, plus a quick script test with two fake members (one
   refusing connections) to confirm backoff, retry and slot limits.
3. Summary queue: dispatcher, `onPool` helper, parallel images, ordered
   progress writes. With the pool empty, confirm behaviour matches today.
4. Settings API and validation.
5. UI: hosts section, then the live status.
6. End-to-end: two Ollama hosts with 1 slot each. Queue an account with about
   20 posts and check that:
   - both hosts stay busy;
   - no post text call starts before its images finish;
   - the account summary starts only after its posts;
   - stopping one host mid-run shifts all work to the other with no failed
     jobs.

## Open points to confirm while building

- Whether `maxJobs = totalSlots + 1` is the right job-concurrency headroom, or
  whether it should be its own setting. Start with the formula and add a
  setting only if needed.
- Large account-summary prompts on a small host: with the same models assumed
  this should be fine, but watch for context-length errors on weaker
  machines.
