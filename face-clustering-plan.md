# Face clustering plan (PRM + PRM-compute)

**Date:** 2026-10-14
**Goal:** cut the ~35k-face manual queue down to a few hundred decisions. Today one click names one face; after this, one click should name a whole cluster.

**Decisions taken**
- Clusters live in a **separate `faces.cluster_id`** column that is only a suggestion and is recomputed on every run. Naming a cluster bulk-connects its faces into a real `personface_uuid` group.
- The owner signal shows a **1-click confirm banner** ("Is this @jane_doe?"). Nothing links to an account without a click.
- Auto-assign becomes **two-tier**: ≥ 0.75 assigns automatically, and 0.55–0.75 goes to a "Verify @x" grid. Both thresholds are settings.
- Noise filtering includes a **sharpness score computed in PRM-compute** (Laplacian variance), with a backfill for existing crops.

---

## 0. What already exists (reuse, don't rebuild)

| Piece | Where | Role in this plan |
|---|---|---|
| Insert-time greedy grouping (≥ `sureness` 0.65, else orphan `NULL`) | compute `face_pipeline.process_detected_faces` | Unchanged. Clustering sits on top of it. |
| In-memory normalized embedding matrix | compute `face_index.py` | Input to clustering, with no DB reload. |
| Identity centroids, look-alikes, hourly auto-assign at 0.55 | PRM `server/face-lookalikes.ts`, `recognition.ts` `runAutoAssign` | Gets the two-tier split (§4). |
| `connectFace` / `mergeFaceGroups` / `disassociateFace` | PRM `server/recognition.ts` | Naming a cluster calls these. No new linking logic. |
| Per-photo suggestions (owner / coauthor / mentioned / profile_account) | PRM `server/face-review.ts` `buildPageCaches` | Aggregated per cluster (§3). |
| Profile picture → account linking | PRM `linkProfileFace` / `associateProfileFaces` | Already anchors accounts to faces, which then act as centroids for §4. |
| `face_pair_dismissals`, `faces.dismissed_at`, `auto_match_score` | schema | Cannot-link constraints, the noise destination, and the auto-assign marker. |

The schema is owned by PRM (`server/db-init.ts`). PRM-compute validates columns at startup (`database._validate_schema`), so **deploy order is always PRM first, then compute**.

---

## 1. Schema (PRM `shared/schema.ts` + `server/db-init.ts`)

`faces` (all nullable or defaulted, so existing rows and the current code are unaffected until something writes them):
- `cluster_id VARCHAR NULL`: cluster label from the last run. `NULL` means the face was not clustered (it is named, dismissed, noise, or arrived after the last run).
- `noise_reason TEXT NULL`: `'small' | 'low_conf' | 'blurry' | 'singleton'`, and `NULL` means not noise. The reason matters:
  - The quality reasons (`small`, `low_conf`, `blurry`) are machine judgements on the face itself. They hide it from every queue, including the verify tier.
  - `singleton` only means "seen fewer than 3 times among unnamed faces". A singleton may be a known person seen once, which is exactly what the centroid tier (§4) catches, so **singletons stay eligible for auto-assign and verify**.
  - This is separate from `dismissed_at`, which stays the human "not someone I track" decision.
- `sharpness REAL NULL`: Laplacian variance of the aligned crop. `NULL` means not measured, and the blur check simply doesn't apply until it is measured. Compute writes it.
- `verify_personface_uuid VARCHAR NULL` + `verify_score REAL NULL`: the pending §4 verify-tier suggestion. These are deliberately **not** `auto_match_score`. Today's UI reads `auto_match_score` as "PRM auto-assigned this face", and a face that was only suggested hasn't moved.
- Index on `(cluster_id) WHERE cluster_id IS NOT NULL` and on `(verify_personface_uuid) WHERE verify_personface_uuid IS NOT NULL`.

Columns and tables land in the rollout step that first writes them (§6), not all up front. Only `sharpness` shipped in step 1.

Clearing rules (added with the step that adds the column): every place that decides a face's identity clears `cluster_id`, `verify_personface_uuid` and `verify_score`, the same way `connectFace` already clears `auto_match_score` and `dismissed_at`. That covers `connectFace`, the new `connectFaces`, `disassociateFace`, dismissing a face, and auto-assign moving a face.

New `face_clusters` table (one row per cluster per run; it is rebuilt every run):
- `id`, `size`, `medoid_face_id`, `montage_face_ids JSONB` (the 16 sharpest/most frontal), `suggestions JSONB` (the §3 output, cached), `created_at`. Step 4 shipped it without `suggestions`, which step 5 adds. Ids are `<run>-c_<n>`, so a stale `cluster_id` never matches a new run's cluster.

New `face_cluster_rejections` table for "No, not @x":
- `face_id`, `social_account_id` (or `person_id`), `created_at`, unique on `(face_id, social_account_id)`.
- Rejections are stored against faces, not against `cluster_id`, so they survive re-clustering. A suggestion is suppressed for a cluster when ≥ 50% of the cluster's faces carry a rejection for that account.

Compute `database.py` `Face` gains `sharpness` only, since compute never needs the other new columns. `_validate_schema` only checks the columns the model declares, so an old compute keeps booting against the new PRM schema. A new compute against an old PRM schema fails at startup, so the order is always PRM first.

Backups are whole-database, so the new tables and columns come along with no change. A restored DB carries stale `cluster_id`s, which the post-restore recluster (§3.2) replaces.

---

## 2. PRM-compute: clustering + sharpness

### 2.1 Sharpness at detect time
- `face_engine.ArcFaceONNXProcessor.detect_all` computes `cv2.Laplacian(gray_crop, cv2.CV_64F).var()` on the 112×112 aligned crop, which normalizes it across face sizes, and returns `sharpness` in each detection dict.
- `face_pipeline.process_detected_faces` stores `sharpness` on the new `Face` row and in the result dict.

### 2.2 Sharpness backfill (folded into `POST /api/face/backfill-pose`)
No new endpoint. `backfill-pose` now visits faces where `pitch IS NULL OR sharpness IS NULL` and, from one crop download, writes only the missing values (it never overwrites an existing pose or sharpness). PRM's existing "Measure angle and sharpness of stored faces" button in Recognition settings runs it.

### 2.3 `POST /api/face/cluster`
Request (JSON):
```json
{ "face_ids": ["…"],                  // which faces to cluster (PRM decides eligibility)
  "cannot_link": [["faceA","faceB"]], // optional; see below
  "min_similarity": 0.5, "k": 20, "min_cluster_size": 3 }
```
Response: `{ "labels": {"faceId": "c_<n>" | null}, "medoids": {"c_<n>": "faceId"}, "took_ms": 1234 }`. A `null` label means noise (a cluster smaller than `min_cluster_size`).

Algorithm: **kNN graph + Chinese Whispers**, using numpy only and no new dependency:
1. First run the index's usual `count(*)` freshness check, the same one `search_many` does, so that faces added since startup are in the matrix. Then slice the rows for `face_ids` out of `face_index._matrix`, which is already L2-normalized. Ids the index doesn't hold (unusable embeddings) come back as `null`.
2. Compute cosine kNN with chunked `X[i:i+2048] @ X.T`, keeping only pairs ≥ `min_similarity` and then the top `k` per row (thresholding before ranking is ~2× faster than `argpartition` over the full block). Measured: ~7.5 s for 35k×512 on CPU.
3. Keep only edges with sim ≥ `min_similarity`.
4. Drop edges between faces that share a `photo_id` (`face_index._photo_ids`), since two faces in one photo are two people, plus any `cannot_link` pairs.
5. Run Chinese Whispers with weighted votes, a fixed seed and about 20 iterations.
6. Clusters smaller than `min_cluster_size` get `null`. The medoid is the member with the highest mean similarity to the rest of its cluster.

It runs under `concurrency` like the other CPU-heavy work, off the event loop (`asyncio.to_thread`).

Fallback, only if Chinese Whispers proves too chainy in practice: `sklearn.cluster.HDBSCAN` on the same kNN distances. That adds `scikit-learn` (≥ 1.3, compatible with the `numpy<2` pin). Don't add it up front.

### 2.4 Docs
Add the new endpoints to `react-api-guide.md` and a dated section to `PRM-face-changes-guide.md`.

---

## 3. PRM: clustering job + cluster suggestions

New file `server/face-clusters.ts`.

### 3.1 Noise pre-filter (pure SQL, before clustering)
First clear all quality `noise_reason`s, then set them again for undismissed, unnamed faces where any of the following holds (first match wins):
- `small`: the bbox shorter side is < `face_noise_min_px` (default 30 source pixels). Compute's own `min_face_size` is 40 today, so this mostly catches older detections.
- `low_conf`: `detection_confidence::real < face_noise_min_conf` (default **0.7**; compute's `det_threshold` is 0.6). The first guess of 0.85 would have flagged half of all eligible faces (median confidence 0.852). 0.7 flags about 9% (4,963 of 58,076).
- `blurry`: `sharpness < face_noise_min_sharpness`. This setting stays **unset (off)** until the backfill finishes and a value is picked from the distribution (start at the 15th percentile).

Because the pre-filter recomputes these each run (one `UPDATE` that writes only rows whose reason changes, and clears quality reasons from faces that were named or dismissed since), changing a threshold in settings and reclustering is reversible. The confidence and sharpness cutoffs and `face_cluster_min_similarity` (default 0.5) are app settings. They are served under `clustering` by `GET/POST /api/recognition/auto` and edited in the "Face clustering (dry run)" row of `client/src/pages/recognition-settings.tsx`. The 30 px floor is a constant.

### 3.2 `runFaceClustering()`
1. **Eligible faces:** `dismissed_at IS NULL AND photo_id IS NOT NULL`, no quality `noise_reason`, with an embedding, whose group is unnamed (the same `unnamed` predicate as `runAutoAssign`). That includes both orphans (`personface_uuid IS NULL`) and faces in compute's unnamed insert-time groups. Clustering does not trust those unnamed groups as must-links, because compute's greedy 0.65 grouping can chain. Naming a cluster folds an unnamed group in only when every face of that group is in the named set (§3.4).
2. **Cannot-link:** expand `face_pair_dismissals` group pairs into face pairs (capped and sampled if large). Pairs whose groups are named are irrelevant here, since named faces aren't eligible.
3. Call compute `/api/face/cluster`. On a 404 (compute not updated yet), log it, mark clustering "unavailable", and leave everything as is. The UI hides the Clusters tab's Recluster button and shows "PRM-compute update required".
4. In one transaction, guarded so a face that was named or dismissed while compute was working is skipped (`WHERE` re-checks eligibility): set `cluster_id = NULL` on all faces and clear every `noise_reason` that is `'singleton'`, write the new labels, set `noise_reason = 'singleton'` for faces that came back `null`, and rebuild `face_clusters` with montage ids and the medoid.
5. Compute suggestions (§3.3) per cluster and cache them in `face_clusters.suggestions`.

Triggers (as shipped in step 4): "Run now" on the settings page (`POST /api/face-review/cluster`), and a daily run that starts 15 minutes after start-up. Only one run happens at a time (the same single-flight pattern as `autoAssignFaces`).

Deferred:
- Running after each backfill batch and after a backup restore. After a restore, compute resyncs its index asynchronously, so an immediate run could mark not-yet-indexed faces `singleton`. The daily run catches up.
- The shared lock with auto-assign. It is unnecessary because the result write is guarded on each face's group (as read before the compute call), and every identity change clears `cluster_id`.
- The "unavailable" state on a 404. For now the run throws "PRM-Compute update required", and the settings toast shows it. The Clusters tab (step 5) can add the state if it needs it. Faces detected after a run simply have `cluster_id = NULL` until the next one. Until then they keep going through today's paths (insert-time grouping, auto-assign, the per-photo tabs), so nothing waits on clustering.

### 3.3 Cluster suggestions (weak supervision)
These are computed in SQL per cluster from the photos its faces sit in (`photos.prm_location = 'post:<id>'` → `social_account_posts` → owner account, coauthors, `mentionedAccounts`):

| Signal | Score |
|---|---|
| **Solo-post owner share.** For owner account A: of A's solo posts (photos with exactly 1 detected face), what share have their face in this cluster? Also how much of the cluster is A's solo posts. | Banner when the share is ≥ 0.85 **and** there are ≥ 5 solo posts **and** A is not already linked to a face group. |
| **Owner frequency (any post).** The share of the cluster's photos posted by A. | Ranked suggestion. |
| **Mentions / usertags / coauthors.** How many of the cluster's photos tag or mention @x, weighted up when the photo's other faces are already identified (the "everyone else is accounted for" case). | Ranked suggestion. |
| **Profile anchor.** The cosine between the cluster centroid and the face on each unlinked account's profile picture (faces where `prm_location LIKE 'profile_image:%'` that are not yet linked). | Ranked suggestion. A match ≥ 0.6 counts the same as the banner. |
| **Named-identity look-alike.** The cluster centroid scored against `lookAlikesFor`'s centroid map. | "Merge into @x?" suggestion, which catches clusters that a named identity's §4 sweep missed. |

Rejections (§1) filter all of these.

### 3.4 Actions
- **New `connectFaces(faceIds, { personId | socialAccountId | newPerson })`** in `recognition.ts`, next to `connectFace` and sharing its target-resolution code. Pull that code out into one helper rather than copying it: the account brings its owner, and the target is the person's group, else the account's group, else a new uuid. Calling `connectFace` on the medoid **won't work**. It folds the medoid's whole unnamed group, and that group can contain faces the user just excluded, or faces that clustering put in other clusters. `connectFaces` instead:
  - moves exactly the listed faces;
  - folds an unnamed group via `moveGroup` only when every face of that group is in the list;
  - never pulls a listed face out of a *named* group, the same rule as `connectFace` today. Named faces aren't clustered, so this is only a guard.
  - clears `dismissed_at`, `auto_match_score`, `cluster_id` and the verify fields on the moved faces;
  - runs one `refreshFacialIdsForGroups([target], tx, movedFaceIds)`;
  - sends nothing to compute. PRM and compute share the `faces` table, and compute's index reads `personface_uuid` fresh on every search. The old `syncCompute` follow-up calls (`/api/face/assign`, `/api/person/merge`) were removed in step 1: they only rewrote what PRM had just committed, and because they ran unguarded after commit, they could overwrite a newer human assignment.
  - Then `markFaceIdentitiesDirty()` and `autoAssignFaces()` (§4), so the new centroid immediately sweeps the rest.
- **Name cluster** (`POST /api/faces/clusters/:id/name` with `{faceIds, excludeFaceIds, socialAccountId | personId | newPerson}`):
  - The server checks that the faces still carry that `cluster_id`. On a mismatch it returns 409 and the client refetches. Cluster ids change on every run.
  - It then calls `connectFaces(faceIds − excludeFaceIds)`. Excluded faces keep their `cluster_id` until the next run and drop out of the open card.
- **Reject suggestion**: insert `face_cluster_rejections` rows for the cluster's faces.
- **Strangers**: set `dismissed_at` on every face in the cluster. That is the existing human "not someone I track" flag, so the faces show up in the existing Dismissed filter and can be undone there. The `noise_reason` column stays reserved for machine judgements.
- **Split** is deliberately left out of v1. Exclude plus recluster covers it.

---

## 4. Two-tier auto-propagation (`recognition.ts` `runAutoAssign`)

- The existing setting `face_auto_assign_min_score` changes its default from 0.55 to **0.75**. Add a new setting `face_verify_min_score` with a default of **0.55**.
  - **Stored-value migration**, one-time: if the stored auto-assign value is exactly `0.55` (the old default saved from the settings page) or absent, write `0.75`. Any other stored value was a deliberate choice and is kept.
  - Use whatever migration mechanism `db-init.ts` has when this lands. If `migration-ledger-plan.md` has shipped, make it a named ledger migration; otherwise use an idempotent step keyed by an app setting `face_two_tier_migrated`.
- Faces scoring ≥ the auto-assign value (top match, with the margin rule kept) are auto-assigned and marked with `auto_match_score`, exactly as today.
- Faces scoring between the verify and auto-assign values are **not moved**. They get `verify_personface_uuid` and `verify_score`. Each full run first clears all verify fields and then rewrites them, so they always reflect the current centroids. Faces with a quality `noise_reason` are skipped for both tiers. Singletons are not skipped (see §1).
- Run `autoAssignFaces()` right after any cluster naming or verify confirm, not only hourly.
- **Verify grid** (`GET /api/faces/verify?group=…`): all faces whose `verify_personface_uuid` is that group, sorted by score descending. Two actions:
  - **Confirm all** (minus deselected): `connectFaces(selected, group's identity)`.
  - Each deselected face gets a `face_pair_dismissals` entry (its own group vs. the identity) so it is never offered again, which reuses §8.4 semantics. An orphan face (`personface_uuid IS NULL`) has no group to record, so it is first given a fresh unnamed `personface_uuid`, the same thing `disassociateFace` does.

Existing faces auto-assigned at 0.55–0.75 under the old default are not moved back. They keep their `auto_match_score`, and today's unconfirmed badge still flags them. The Verify tab adds an "Unconfirmed auto-assigned (< 0.75)" section per identity, listing them with the same deselect → Confirm all flow, so they get reviewed instead of silently living at the looser bar. In that section, deselecting a face calls `disassociateFace`, which already records the pair dismissal.

---

## 5. UI (PRM client)

New **Clusters** tab on `client/src/pages/face-review.tsx`, first in the tab list, plus a **Verify** tab. The existing story/profile/post/message per-photo tabs stay for whatever is left.

**Clusters tab**
- Cards sorted by size (largest first), each showing a 4×4 montage from `montage_face_ids`, the size, and the top 3 suggestions as chips.
- Banner on the card: "Is this **@jane_doe**? (42 of her 47 solo posts)" with **Yes** / **No**.
- Clicking a card opens the full grid of faces in that cluster. Click faces to exclude them, then use the "Name as…" picker (the existing person/account search component) or **Strangers**.
- Header counts: clusters, faces in clusters, noise faces broken down by reason (with a "show noise" toggle), and a Recluster button showing the last-run time.

**Verify tab**
- One section per identity with its pending count. The grid is pre-selected; deselect the misses and hit **Confirm all**.

**Existing per-photo tabs (story/profile/post/message)**
- `faceQualifies` in `server/face-review.ts` gains `AND (f.noise_reason IS NULL OR f.noise_reason = 'singleton')`. Quality noise stops holding photos in the queue, and the tab counts drop to match. Singletons stay, since the per-photo view is the only place they get named. The "show noise" toggle passes a flag that drops this clause, so nothing is hidden without a way back.
- A face that has a `cluster_id` gets an "in a cluster of N" chip in its row. Clicking it opens that cluster card, so you can name 500 faces from the photo you happen to be looking at.
- A face with `verify_personface_uuid` shows that identity as its top suggestion, above look-alikes.

**Settings** (wherever the look-alike thresholds live today): auto-assign, verify, noise px/conf/sharpness, and clustering `min_similarity` / `min_cluster_size`.

Mirror any per-person "faces" affordance to `me-profile.tsx` if `person-profile.tsx` gains one (it is not planned for v1).

---

## 6. Rollout order

Each step leaves the app working the way it does today, plus whatever that step adds. No step changes behaviour that a later step is needed to make reviewable.

| # | Ships | User-visible change | Why it's safe on its own |
|---|---|---|---|
| 1 ✅ | **PRM**: nullable `faces.sharpness REAL` (needed by step 2), and removed `syncCompute`'s redundant compute calls. Other columns, tables, `connectFaces` and the clearing rules move to step 4/5/6, whichever first uses them. | None. | Adding a nullable column with no default is metadata-only in Postgres, so no rows are rewritten. Old compute still validates, since it only checks its own columns. |
| 2 ✅ | **Compute sharpness** (§2.1, §2.2), then run the backfill. | None. | It is a new column plus an additive field in the detect response, which today's PRM ignores. The blur cutoff stays off. |
| 3 ✅ | **Compute `/api/face/cluster`** (§2.3), with pytest over a synthetic matrix (well-separated blobs, the same-photo cannot-link, singleton → `null`, unknown ids → `null`). | None. | Nothing calls it yet. |
| 4 ✅ | **PRM `cluster_id`, `noise_reason`, `face_clusters` + clustering job + noise pre-filter**, in **dry-run mode**: it writes `face_clusters` and `cluster_id`, but `faceQualifies` doesn't read `noise_reason` yet. | Only a "Face clustering (dry run)" settings row (thresholds plus Run now, with the summary in a toast). A cluster-size histogram and noise counts go to the log. | Use these numbers to tune `min_similarity`, the noise thresholds and the blur cutoff on real data before anyone sees a cluster. |
| 5 ✅ | **`face_cluster_rejections`, `connectFaces`, suggestions, name/reject/strangers actions, and the Clusters tab** (§3.3, §3.4, §5), plus the noise clause in `faceQualifies` with its show-noise toggle and the "in a cluster" chip. | The Clusters tab appears. Per-photo counts drop by the quality-noise faces. | The noise clause ships together with the toggle that reveals it. Naming goes through `connectFaces`, so the identity model doesn't change. |
| 6 | **`verify_*` columns, two-tier auto-assign + Verify tab** (§4), with the stored-threshold migration in the **same** release. | Fewer silent auto-assigns, and a Verify tab with the 0.55–0.75 faces plus the old unconfirmed ones. | Raising the bar without the Verify tab would strand the 0.55–0.75 faces with no queue to review them in, so the two ship together. |

Compute can lag behind PRM at any step. PRM treats a 404 from `/api/face/cluster` as "clustering unavailable" (§3.2), and a missing `sharpness` simply leaves the blur check off.

## 7. Success check
At step 4 (dry run), and again after step 5 on the real dataset, record: eligible faces, noise faces, the cluster count, faces covered by the top 50 clusters, and banners shown. Target: the top 50 clusters cover ≥ 40% of non-noise faces, and the queue left after naming them is under 1,000 decisions. If clusters are too merged (two people in one), raise `min_similarity` before reaching for HDBSCAN.

**Step 4 dry run (2026-10-16, `min_similarity` 0.5, confidence cutoff 0.7, blur off):**

| Measure | Result |
|---|---|
| Eligible faces | 53,163 |
| Noise faces | 4,967 `low_conf`, 0 `small` |
| Clusters | 3,069, covering 25,143 faces |
| Singletons | 28,020 |
| Largest cluster | 216 faces |
| Size buckets | 3–4: 1,522; 5–9: 929; 10–19: 399; 20–49: 174; 50–99: 36; 100–499: 9 |
| Top 50 clusters | 3,927 faces (7.4%) |
| Clusters of ≥ 10 faces | 618 clusters, 14,120 faces (27%) |
| Clusters of ≥ 20 faces | 219 clusters, 8,717 faces (16%) |

The data is long-tailed, not over-split:
- Only 8% of clusters have another cluster whose centroid is ≥ 0.5 away (1% at ≥ 0.7).
- Only 4% of singletons are ≥ 0.5 from any cluster centroid.
- The large clusters are frontal (mean |yaw| 5–12°) and sharp.

So lowering `min_similarity` would mostly merge different people, and the 40% top-50 target doesn't fit this dataset. Step 5 should instead aim to make the ~600 clusters of ≥ 10 faces quick to name, in size order.

**Step 5 as built (2026-10-16):**
- The cluster routes live under `/api/face-review/clusters` (list, detail, `name`, `reject`, `strangers`), next to the rest of Face review.
- `face_cluster_rejections` has one `identity_id` column, holding either an account id or a person id.
- Suggestions are computed on demand from the per-photo suggestions of the cluster's photos (`photoSuggestions`), so there's no stored `face_clusters.suggestions` column.
- The profile-picture banner is based on membership (the profile face is in the cluster), not on cosine ≥ 0.6. The identified-faces weighting is skipped.
- "New person" is the create flow of the shared `IdentitySearch` picker.
- Chips on the cluster cards are display-only. You name from the banner or from the detail dialog, which lets you click faces to leave them out.
- Banners are rare on this data: the owners of the big clusters are already linked to a person, so §3.3 shows the owner chip instead.

## 8. Open risks
- **Chaining.** Chinese Whispers can merge look-alike siblings. Mitigated by the same-photo cannot-link and by the exclude flow. HDBSCAN is the fallback.
- **Cluster ids change every run.** The UI must not hold a cluster id across a recluster. The name action re-validates that the submitted face ids still share the label, and rejects with 409 so the client refreshes.
- **Overlap with "Likely same".** `findLikelySameCandidatePairs` compares every group centroid, unnamed ones included. Once unnamed faces are clustered, most unnamed-vs-unnamed pairs are better handled by clusters. In v1 leave it untouched. If it gets noisy after step 5, restrict it to pairs where at least one group is named.
- **Owner share on group-heavy accounts.** Accounts that rarely post solo never trigger the banner. They fall back to the ranked owner-frequency suggestion.
