# Honey pot plan (face clustering)

**Date:** 2026-11-10
**Goal:** give the really blurry faces somewhere to go. You can send a face, or a whole cluster, to the **Honey pot**. Later faces that look like what's already in it go there automatically, so they stop showing up in Clusters, Verify and the review queues.

**Decisions**
- A honey pot face is **dismissed + tagged**. It sets `dismissed_at`, which already removes it from every queue, from clustering eligibility, from auto-assign and from the identity centroids (12 call sites, no new filters needed). A new `honeypot` column tells it apart from a plain "not someone I track" dismissal.
- Matching is **nearest exemplar, not centroid**. Blurry crops come from many different people, so averaging them into one centroid would match badly. They do sit close together in embedding space, though, and that closeness is what makes this feature work. A new face goes to the honey pot when its best cosine against any **manually** honey-potted face is ≥ `face_honeypot_min_score` **and** it beats the face's best named-identity score.
- **Only manual entries teach.** Auto-sent faces are not exemplars, the same rule as `auto_match_score` faces, which don't shape centroids. That stops the pot from drifting outward one auto-match at a time. In the Honey pot view, "Confirm" promotes an auto entry to a manual one.
- **Releasing is sticky.** A face you pull out is marked `released` and is never auto-sent again.

---

## 1. Schema (`shared/schema.ts` + `server/db-init.ts`)

`faces` gets three nullable columns, so existing rows are unaffected:
- `honeypot TEXT NULL`: `'manual' | 'auto' | 'released'`. `NULL` means the face was never in the honey pot.
- `honeypot_score REAL NULL`: the exemplar score an `auto` entry was sent at. `NULL` for manual entries.
- `honeypot_at TIMESTAMPTZ NULL`: when the face entered, for sorting the view.
- Partial index on `(honeypot_at) WHERE honeypot IN ('manual','auto')`.

Invariant: `honeypot IN ('manual','auto')` ⇒ `dismissed_at IS NOT NULL`.

Clearing rules:
- `connectFace` / `connectFaces`, which name a face, already set `dismissed_at = null`. They also set `honeypot = null, honeypot_score = null, honeypot_at = null`. Add these three fields to the identity branch of those two updates, **not** to `clearedSuggestions`. `clearedSuggestions` is also spread by the dismiss paths, and those must keep `honeypot` intact.
- Undismiss (`/api/face-review/undismiss`) sets `honeypot = 'released'` when the face was in the honey pot.

No compute change is needed. Compute never reads these columns, so the deploy order doesn't matter.

---

## 2. Server

### 2.1 `server/face-honeypot.ts` (new, small)
- `sendToHoneypot(faceIds)`: for faces not in a named group, sets `dismissed_at = now(), honeypot = 'manual', honeypot_score = null, honeypot_at = now(), ...clearedSuggestions`. A face that **is** in a named group is first pulled out with `disassociateFaces` (a blurry crop shouldn't keep feeding a person's centroid), then marked. Calls `markHoneypotDirty()` and runs `honeypotSweep()` in the background.
- `releaseFromHoneypot(faceIds)`: sets `dismissed_at = null, honeypot = 'released', honeypot_score = null`. The face goes back into the normal queues and the next cluster run.
- `confirmHoneypot(faceIds)`: changes `auto` to `manual`, which makes the face an exemplar.
- `listHoneypot({ source: 'manual'|'auto'|'all', cursor, limit })` and `honeypotCounts()`.

### 2.2 Exemplar matching (in `server/face-lookalikes.ts`, next to the centroids)
- A second in-memory cache, `honeypotExemplars: Float32Array[]`, loaded from `faces WHERE honeypot = 'manual' AND embedding IS NOT NULL`. It is rebuilt lazily when dirty, exactly like `ensureCentroids`, and `markHoneypotDirty()` mirrors `markFaceIdentitiesDirty()`.
- `honeypotScoresFor(faceIds): Map<faceId, number>` returns the best dot product against any exemplar. It's brute force: scoring a new photo's handful of faces against a few thousand exemplars takes milliseconds.
- Cost of the full sweep: 35k open faces × N exemplars × 512. At N = 2k that is about 36G multiply-adds. That is acceptable hourly but slow in JS, so **measure it in step 2**. If it's too slow, collapse the exemplars into ≤ 256 k-means sub-centroids at load time. Don't build that until a measurement shows it's needed.

### 2.3 Hook into auto-assign (`runAutoAssign` in `server/recognition.ts`)
Do this inside the existing run rather than as a separate job, so a face is never both auto-assigned to a person and sent to the honey pot:
- Candidates: the same filter as today, plus `honeypot IS DISTINCT FROM 'released'` for the honey pot branch only. A released face can still be auto-assigned to a person.
- For each candidate, compute `hp = honeypotScoresFor(...)` alongside `lookAlikesFor`.
- If `hp ≥ face_honeypot_min_score` **and** `hp > top.score` (the best named score, or 0), add the face to `honeypotPicks` and skip the person pick and the verify pick.
- In the same transaction, run a guarded `UPDATE ... SET dismissed_at = now(), honeypot = 'auto', honeypot_score = v.score, honeypot_at = now(), cluster_id = NULL, verify_* = NULL WHERE dismissed_at IS NULL AND personface_uuid IS NOT DISTINCT FROM v.old_group`.
- `AutoAssignResult` gains `honeypot: number`, and the log line reports it.

Since `autoAssignFaces(faceIds)` already runs right after each photo is recognised, **new** blurry faces are caught at detect time with no extra trigger. The hourly full run catches older faces once new exemplars exist.

### 2.4 Clusters
- `honeypotCluster(clusterId, faceIds?)` in `face-clusters.ts`: the same shape and `cluster_id` guard as `dismissClusterFaces` (`face-clusters.ts:378`), but it calls `sendToHoneypot`.
- No suggestion logic in v1. A later option is a "Looks like honey pot" chip when the cluster medoid's exemplar score is ≥ the threshold, but only after the basic flow has proven itself.

### 2.5 Routes (`server/routes/face-review.ts`)
| Route | Body | Does |
|---|---|---|
| `POST /api/face-review/honeypot` | `{ faceUuids }` | `sendToHoneypot` |
| `POST /api/face-review/honeypot/release` | `{ faceUuids }` | `releaseFromHoneypot` |
| `POST /api/face-review/honeypot/confirm` | `{ faceUuids }` | `confirmHoneypot` |
| `GET /api/face-review/honeypot` | `?source=&cursor=` | paged face list (crop URL, photo id, source, score, sharpness) |
| `POST /api/face-review/clusters/:id/honeypot` | `{ faceIds? }` | `honeypotCluster` (409 when the cluster is stale, like `/name`) |

`/api/face-review/counts` gains `honeypot`.

### 2.6 Setting
`face_honeypot_auto` (on/off, **off by default**) and `face_honeypot_min_score` (default **0.6**, then tune it from real data), served as `honeypot: { auto, minScore }` by `GET/POST /api/recognition/auto` and set from the "Honey pot routing" row in Recognition settings. With routing on but no manual faces yet, nothing is matched.

### 2.7 Dismissed filter
`faceQualifies(dismissed=true)` in `server/face-review.ts:99` adds `AND f.honeypot IS NULL`, so honey pot faces don't fill the Dismissed list, and the `dismissed` count excludes them too.

---

## 3. Client

- **Face review tabs** (`client/src/pages/face-review.tsx`): add a **Honey pot** tab next to Clusters and Verify, showing its count, rendered by a new `face-honeypot-tab.tsx`.
  - A grid of crops, newest first. Filter chips: All / Manual / Auto, and auto entries show their score.
  - Multi-select actions: **Release** and **Confirm** (auto only). Clicking a crop opens the photo, the same as the Verify grid.
- **Cluster card** (`face-clusters-tab.tsx`): a **Honey pot** button beside "Strangers", which respects the current exclusions. It shows an undo toast that releases the faces just sent.
- **Per-face**: a honey pot action next to Dismiss in the review row, with keyboard **H** next to **D**, and in `photo-faces.tsx`. Honey pot faces stay drawn on photos, with a muted "honey pot" badge in place of a name.
- **Settings** (`recognition-settings.tsx`, "Face clustering" row): a "Honey pot match score" input, plus the honey pot count from the last auto-assign run.

---

## 4. Rollout

1. **Schema + manual send/release.** Columns, `sendToHoneypot` / `release` / `list`, the routes, the Honey pot tab, the cluster button, and the per-face action. That alone is useful: blurry faces are out of the way.
2. **Auto-routing.** The exemplar cache, the hook into `runAutoAssign`, the setting, and Confirm. Time the full sweep with real exemplar counts (§2.2).
3. **Tune.** Pick the default threshold by sending a few junk clusters to the pot, running auto-assign in a dry-run log mode, and checking the false positives in the Auto filter.

## 5. Edge cases
- **A named person's blurry face:** sending it pulls it out of the group (§2.1), and the group's centroid is rebuilt. If that empties a group, `clearEmptyGroups` already handles it.
- **A face you later recognise:** naming it from anywhere (photo view, Release then assign) clears the honey pot fields via `connectFace`.
- **Recluster:** honey pot faces are dismissed, so they're never eligible and never appear in a cluster.
- **Backup/restore:** these are ordinary columns, so they come along. The exemplar cache rebuilds on first use.
- **Not in scope:** auto-sending by sharpness alone. `noise_reason = 'blurry'` with `face_noise_min_sharpness` already covers that machine judgement. The honey pot is the human-taught complement and can be used next to it.
