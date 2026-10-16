# Scan chunks plan

A scan sends what it finds to PRM in **chunks of up to 4 posts** while it is still scraping,
then sends one small **commit** at the end. This replaces the single bundle upload from
account-scan-plan.md §3.2–§5.

## Why

- **Big accounts were rejected.** @emmie.and.pear's full scan (150 posts) was a 463-file,
  272 MB bundle. PRM's 400-file cap refused it with a 400 error, prm-stories never retries a
  4xx, and none of the 150 posts were saved. (The cap has since been raised to 5000 as a
  stopgap.)
- **A crash loses the whole scan.** Nothing reaches PRM until the scan ends. When the browser
  frame detached partway through @_lydianelson, everything already scraped for that account
  was lost.
- **Retries resend everything.** A dropped 272 MB upload restarts from zero.

With chunks, the most a failure can lose is one chunk (≤ 4 posts). Posts show up in PRM
while the scan is still running. Every request is small.

## 1. The contract

A scan makes these calls to PRM:

1. `POST /jobs/:id/start` (unchanged).
2. `POST /jobs/:id/scan/chunks/:seq`, once per chunk, in order. `seq` starts at 1.
3. `POST /jobs/:id/scan/commit`, once, last.

### 1.1 A chunk

One `multipart/form-data` request: a `chunk` field (JSON) plus files whose field names are
paths, using the same path scheme as today's bundle.

```ts
chunk = {
  seq: number,
  info?:  { meta: InfoMeta, image?: "info/profile.jpg" },             // first chunk only
  posts?: { meta: PostMeta, slides: string[], video?: string }[],     // ≤ 4
  stories?: { meta: StoryMeta, image: string, video?: string }[],     // highlight items, ≤ 16
}
// files: info/profile.jpg, posts/<pk>/slide_<n>.jpg, posts/<pk>/video.mp4,
//        highlights/items/<pk>/image.jpg|video.mp4
```

**When a chunk closes:** when it holds 4 posts, or 16 highlight stories, or when the section
it belongs to ends. Posts and stories never share a chunk. Info goes in chunk 1, on its own
or together with the first posts.

A posts chunk is at most 4 × (20 slides + 1 video), and a stories chunk at most 16 × (image +
video), so either fits in 100 files. Most chunks are a few MB; the worst case is a few hundred
MB if every item is a long video, and the existing 50 MB-per-file limit still applies.

### 1.2 The commit

Plain JSON, no files. It carries what only the whole scan knows:

```ts
commit = {
  chunks: number,                    // how many chunks the service sent (last seq)
  status: "completed" | "failed",
  error?: string,
  sections: {
    info:  { status, reason?, error? },
    posts?: { status, reason?, error?, mode, escalated?, seenPks, complete, oldestSeenAt? },
    highlights?: { status, reason?, error?, seenHighlightIds, complete,
                   sets: { meta: HighlightMeta }[] },
  },
  result: { ...counts },
}
```

Highlight **sets go in the commit**. `upsertHighlight` keys memberships by story pk and
doesn't need the story rows to exist yet. Today PRM ignores the cover file anyway, so the
commit drops it and needs no files.

### 1.3 Answers

| Call | Answer | Service does |
|---|---|---|
| chunk | **201** `{ stored, updated, duplicate, errors }` | deletes the chunk's files |
| chunk | **200** `{ duplicate: true }` (this `seq` was already applied) | deletes the chunk's files |
| chunk | **404/409** (job not this run's, or not running) | logs it, stops sending this job's chunks |
| chunk | **5xx / network error** | retries (§3.3) |
| commit | **200** `{ ok, missing: number[] }` | done |
| commit | **409** `{ missing: number[] }` | resends those chunks, then the commit again (once) |

## 2. PRM (`server/routes/tracking.ts`, `server/tracking.ts`)

### 2.1 State

New column `tracking_jobs.scan_chunks jsonb null`:

```ts
{ received: number[]; counts: { stored, updated, duplicate, storiesStored, ... }; errors: number }
```

It's updated in the same request that applies a chunk. Chunks from one service arrive one at a
time, so no locking is needed beyond the duplicate check.

`tracking_jobs.scan_received_at` stays, with a new meaning: when the job's **first chunk**
arrived. The first chunk sets it if it's null; later chunks leave it alone.

### 2.2 `POST /jobs/:id/scan/chunks/:seq`

- `jobFor` auth. The job must be `running` and of kind `scan`.
- If `seq` is already in `received` → 200 duplicate. Its posts would land as `updated`, which
  is harmless, but the counts would be wrong.
- multer **memoryStorage**, 50 MB per file, 100 files. Because a chunk is small, the
  disk-staging and background-ingest machinery isn't needed.
- Applies items **synchronously** through the existing cores:
  - `applyInfo` for `info`, then reloads the account so the posts pass sees the new posts count.
  - `applyPost` for each post.
  - `ingestStoryItem` for each story.

  A bad item counts toward `errors` and doesn't fail the chunk, as today.
- Merges the counts into `scan_chunks`, adds `seq` to `received`, answers 201.
- Broadcasts `social_account.updated` so an open account page refreshes as posts land.

### 2.3 `POST /jobs/:id/scan/commit`

Runs the second half of today's `ingestScan`, unchanged, minus the item loops:

1. If `received` is missing any seq from 1..`chunks` → **409** with the list. On the second
   commit (after the service resent them), whatever is still missing is recorded in
   `result.missingChunks` and the commit goes ahead.
2. `applyPostsSection` if posts `completed`. Deletions still need the complete `seenPks`, so
   this stays at the end.
3. `upsertHighlight` for each set, then `applyHighlightsSection` if highlights `completed`
   and `complete`.
4. Section stamps (`markChecked`), `markScanned`, issue raise/resolve, retry jobs for failed or
   budget-cut sections. This is the current code moved as-is. A scan that crashed partway
   commits with posts `failed`, so this step already queues its manual `posts` job.
5. The job ends `completed` / `skipped` / `failed` with `result` = commit counts + chunk counts.

The commit is idempotent: if the job has already ended, it answers 200 `{ ok, duplicate }`.

### 2.4 A scan that crashes or never commits

Every chunk that arrived **stays stored**; that's the point of chunking. The account isn't
stamped and `scan_due_at` doesn't roll. A manual **`posts` job is queued straight away** (if
none is open) and `kickManualTrackingJobs()` runs, so the rest is picked up without waiting
for the next due date. That posts job uses the per-call routes, and its `posts/check` skips
whatever the chunks already stored.

- **Crash with a commit** (the service caught the error): the commit says posts `failed`, and
  §2.3 step 4 queues the retry.
- **No commit at all** (service died, or the commit never got through): when the run ends,
  `failUnfinishedJobs` fails the job as today. For a `scan` job with `scan_received_at` set,
  it also queues the posts retry.

The job's `result` keeps the chunk counts, so Social Tasks shows "failed, 37 posts saved".

### 2.5 Removed

All of the bundle path goes: the `/scan` route, `receiveBundle`, `answerAfterBody`,
`SCANS_DIR`, `MAX_SCAN_FILES`, `ingestScan`'s item loops, the `ingesting` set, `BOOT_AT`,
`resumeScanIngests` (boot sweep), and the `scanReceivedAt` skip in `failUnfinishedJobs`. With
synchronous chunk ingest, a job is never "done on the service side but still importing", so that
skip has nothing left to protect. `scan_received_at` itself stays (§2.1).

## 3. prm-stories (`src/track.ts`, `src/deliver.ts`)

### 3.1 `chunkSink` replaces `bundleSink`

Same `ScanSink` interface, so `jobScan`, `jobPosts` and `jobHighlights` don't change.

- Writes each item's files to `runs/<stamp>-track/<jobId>/chunks/<seq>/…` and the chunk JSON to
  `chunks/<seq>/chunk.json`.
- After the 4th post or the 16th story, or when `section(...)` marks a section done, it
  **closes** the chunk: writes `chunk.json` and calls `onChunk(seq, dir)`.
- `end(...)` closes any open chunk and writes `commit.json`, with `chunks` set to the last seq.
- `isKnown` answers from `known`, as today.
- The `npm run scan` CLI passes a no-op `onChunk`, so it still writes a complete scan to disk and
  uploads nothing. `knownOnDisk` / `storyPksOnDisk` read `chunks/*/chunk.json` as well as old
  bundles' `manifest.json`.

### 3.2 Delivery overlaps scraping

- `onChunk` pushes the chunk onto the existing upload queue (one upload at a time), so posts
  upload while the next ones are scraped.
- After `jobScan` returns, or throws, the run loop queues the **commit**. Today a crash in
  `jobScan` skips `upload(...)`; now the catch path writes a commit with `status: "failed"`
  and the error, so PRM ends the job straight away instead of waiting for the run to end.
- The run's final `tracking.run(...)` still waits for the queue to drain.

### 3.3 Retries

- Per chunk: the same backoff as today (10 s, 60 s, 5 min). A 4xx is final for that chunk.
- If a chunk is undelivered after its retries, the queue moves on. The commit's 409 tells the
  service which chunks are missing, and it tries those once more before committing.
- A 404/409 on a chunk (job removed on PRM) drops the rest of that job's queue, including its
  commit.

## 4. UI

- **Social Tasks**: a running scan shows "N posts saved so far" from `scan_chunks.counts`. A
  failed scan with chunk counts shows "failed — N posts saved".
- **Account page**: refreshes posts on `social_account.updated`, so posts appear while the scan
  runs. This builds on the fix to `social-account-profile.tsx` that's already in.

## Stages

| # | Repo | Stage | Done when |
|---|---|---|---|
| 1 | PRM | `scan_chunks` column; chunk route; commit route (moving `ingestScan`'s tail into it). The bundle route stays for now. | A hand-built chunk + commit, sent with curl, stores posts and ends the job like a bundle does. Resending a chunk answers duplicate. |
| 2 | PRM-stories | `chunkSink`, chunk/commit delivery, failed-commit on crash, CLI on `chunkSink`. | A tracking run of a 150-post account stores posts while it runs. Killing the browser partway leaves the delivered chunks' posts in PRM, the job failed with counts, and a manual posts job queued. |
| 3 | PRM | Remove the bundle path (§2.5). UI progress (§4). | No `/scan` callers left; Social Tasks shows progress. |

## Decisions (2026-10-13)

- Posts: up to 4 per chunk. Highlight stories: up to 16 per chunk.
- The single-bundle `/scan` path is deleted once chunks work (stage 3).
- `scan_received_at` is kept and means when the first chunk arrived.
- A scan that crashes partway queues a manual `posts` retry immediately (§2.4).
