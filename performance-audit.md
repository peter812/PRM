# PRM Performance Audit & Remediation Guide

Generated: 2026-11-17

This document consolidates the findings from an 8-area performance audit of PRM, ranked by severity (**Critical**, **High**, **Medium**, **Low**), along with concrete solutions for every issue.

---

## Table of Contents

- [Summary of Systemic Bottlenecks](#summary-of-systemic-bottlenecks)
- [Critical Issues](#critical-issues)
- [High Issues](#high-issues)
- [Medium Issues](#medium-issues)
- [Low Issues](#low-issues)
- [Well-Configured Baselines](#well-configured-baselines)

---

## Summary of Systemic Bottlenecks

1. **Main-thread / Event-loop blocking:** Synchronous zip/XML/file I/O in imports, $O(N^2)$ pairwise cosine similarity for face lookalikes, and synchronous Louvain clustering / pixel-remapping loops.
2. **Database over-fetching, missing indexes, and N+1 queries:** Unpaginated full-table loads (`getAllPeople`, `getSocialGraph`, `deleteOrphanPhotos`, `photos` full scans in face review), missing FK/GIN/composite indexes, and sequential per-row queries in storage and route handlers.
3. **Global per-request overhead:** Synchronous `JSON.stringify` in the API logger, recursive JSON tree walking in `prmS3DirectMiddleware`, and sequential `app_settings` lookups.
4. **Frontend rendering & data-fetching bottlenecks:** Unmemoized Pixi.js WebGL rebuilds and $O(N^2 + N \cdot E)$ simulation loops, unvirtualized/unpaginated post/story/face grids without `loading="lazy"` or `withImageSize`, and continuous background polling.

---

## Critical Issues

### C1. [Area 5] $O(N^2)$ Pairwise Cosine Similarity in JS on Every Request + Full Embedding Load
- **Location:** `server/face-lookalikes.ts:135-175` (`loadCentroids`), `server/face-lookalikes.ts:293-336` (`findLikelySameCandidatePairs`), `server/faces.ts:317-339` (`getLikelySameFaces`), `server/routes/faces.ts:143-152` (`GET /api/faces/likely-same`)
- **Problem:** `loadCentroids` fetches every non-dismissed, confirmed face embedding into Node memory and averages them in JS. `findLikelySameCandidatePairs` loads all `facePairDismissals` and runs an uncached nested $O(N^2)$ dot-product loop across all identity centroids on every request.
- **Solution:**
  - Store precomputed identity centroids in a Postgres table (or materialized view) using `pgvector` (`vector` column with an HNSW index) or in Qdrant, updated incrementally only when a face is confirmed/unconfirmed/deleted.
  - Replace the $O(N^2)$ JS loop with a top-$K$ ANN query (`<=>` cosine distance) per centroid or precompute and cache `likely-same` candidate pairs in a background job invalidated when centroids or `facePairDismissals` change.

### C2. [Area 5] Full-Table Scan of `photos` with 8 Correlated JSONB Subqueries in Face Review Counts
- **Location:** `server/face-review.ts:101-189` (`faceQualifies`, `queueCondition`), `server/face-review.ts:194-212` (`getFaceReviewCounts`)
- **Problem:** Executes 8 separate `COUNT(*) FILTER (WHERE ...)` clauses mixing `LIKE`, `substring(prm_location ...)`, and `jsonb_array_elements(photos.facial_ids)` subqueries, forcing a full sequential scan of `photos` on every `/api/face-review/counts` request.
- **Solution:**
  - Cache `/api/face-review/counts` in memory with a short TTL (e.g., 30–60s) and explicit invalidation on face-review mutations.
  - Denormalize or index queue eligibility (e.g., a `face_review_bucket` or boolean flags / partial indexes on `photos`, or query `faces` directly where `person_id IS NULL` / `dismissed_at IS NULL` instead of expanding `jsonb_array_elements` per photo row).

### C3. [Area 3] Synchronous Zip Extraction, File I/O, and JSON Parsing in Instagram DM Backup Imports
- **Location:** `server/task-worker.ts:3962-3981` (`findThreadFolders`), `server/task-worker.ts:4242,4277` (`importOneDmThread`), `server/task-worker.ts:4634-4698` (`processImportInstagramBackup`), `server/instagram-dm-import.ts:266-278` (`loadThreadFolder`)
- **Problem:** Calls `new AdmZip(zipPath).extractAllTo(...)`, recursive `fs.readdirSync`, `fs.rmSync`, and per-file `fs.readFileSync` + `JSON.parse` synchronously on the main event loop, freezing all HTTP requests and SSE streams during large Meta exports.
- **Solution:**
  - Replace `AdmZip` with a streaming async extractor (`yauzl` / `unzipper`) or extract in a `worker_threads` worker / child process.
  - Convert `findThreadFolders`, `loadThreadFolder`, `resolveMediaPath`, and media reads to `fs.promises` (`readdir`, `readFile`, `stat`, `rm`).
  - Stream media uploads directly from file streams (`fs.createReadStream`) rather than buffering entire videos/photos into memory.

### C4. [Area 3] Unbounded Full-File XML Loading & Synchronous Regex/Stream Parsing in SMS & XML Backup Imports/Exports
- **Location:** `server/task-worker.ts:460-477` (`XmlFileWriter`), `server/task-worker.ts:479-603` (`generateExportXml`), `server/task-worker.ts:1671-3371` (`executeImportXml`), `server/task-worker.ts:4716,4870` (`processImportSms`), `server/sms-import.ts:58-135` (`parseSmsBackup`)
- **Problem:** SMS import reads multi-hundred-MB XML files synchronously via `fs.readFileSync` and runs global regexes. XML import buffers the entire file and all parsed batch arrays in memory simultaneously. XML export loads entire DB tables into memory at once and flushes 8 MB chunks via synchronous `fs.writeSync`.
- **Solution:**
  - **SMS & XML Imports:** Use a streaming SAX/pull XML parser (`sax` or `saxes`) reading from `fs.createReadStream`, flushing batches of 500–1,000 rows to the DB as each section streams in so heap usage stays bounded.
  - **XML Export:** Stream each table using keyset/cursor pagination (`WHERE id > lastId ORDER BY id LIMIT 2000`) and write asynchronously via `fs.createWriteStream` (awaiting `'drain'` when `write()` returns `false`).

### C5. [Area 6] Sequential Per-Item Disk Reads, S3 Uploads, and DB Writes in Scan & Story Ingest
- **Location:** `server/routes/tracking.ts:343-464` (`applyPost`), `server/routes/tracking.ts:742-795` (`ingestScan`), `server/routes/stories.ts:202-287` (`ingestStoryItem`)
- **Problem:** `ingestScan` processes `posts.items`, `highlights.items`, and `highlights.sets` in sequential `for` loops. `applyPost` awaits video uploads before slide uploads, queries `getPhotoByFileHash` per slide instead of batching, and runs `queueMentioned`/`appSettings` queries per post/story item.
- **Solution:**
  - Process post/highlight/story items with a bounded concurrency pool (e.g., `p-limit` / `runPool` with concurrency 4–6).
  - Run video and slide uploads concurrently via `Promise.all`.
  - Batch `getPhotoByFileHash` lookups using `inArray(photos.fileHash, hashes)`.
  - Hoist `appSettings` reads once per scan/ingest batch rather than inside `queueMentioned` per item.

### C6. [Area 6] Uncached `getConnections` Running Leading-Wildcard `ILIKE` Full-Table Scans
- **Location:** `server/connection-strength.ts:160-370` (`getConnections`), `server/connection-strength.ts:400-439` (`connectionsForPrompt`)
- **Problem:** `getConnections()` has no cache (unlike `getConnectionNetwork()`) and runs sequential leading-wildcard `LIKE`/`ILIKE '%...'` queries across `social_account_posts`, `social_accounts`, and `social_account_history`.
- **Solution:**
  - Add a TTL cache (e.g., 5 minutes with in-flight promise deduplication) keyed by `personId` / `accountId`, invalidated on relevant post/account mutations.
  - Add `pg_trgm` GIN indexes (`gin_trgm_ops`) on `social_account_posts.mentioned_accounts`, `social_account_posts.description`, `social_accounts.bio`, and `social_account_history.previous_bio`, or normalize `@mention` extractions into a dedicated indexed table.
  - Run independent queries (`myPosts`, `myComments`, `naming`, `taggedMine`, `nowNaming`/`onceNaming`) in parallel with `Promise.all`.

### C7. [Area 1] N+1 Query Pattern in `bulkLookupSocialAccounts`
- **Location:** `server/storage.ts:4036-4079` (`DatabaseStorage.bulkLookupSocialAccounts`)
- **Problem:** Loops over `lookups` issuing a separate `db.select(...)` per item, each with an `EXISTS` subquery and two correlated `COUNT(*)` subqueries on `social_follows`.
- **Solution:**
  - Replace the per-item loop with a single batched SQL query using `unnest($1::text[], $2::text[])` (or `VALUES (...)`) joined against `social_accounts` and `social_account_types` on `(LOWER(username), LOWER(platform))`, and compute follower/following counts with a single grouped `LEFT JOIN` or `ANY` aggregation.

### C8. [Area 1] Unbounded Full-Table Loads & Over-Fetching in `getSocialGraph` and `deleteOrphanPhotos`
- **Location:** `server/storage.ts:3062-3110,3282-3295` (`DatabaseStorage.getSocialGraph`), `server/storage.ts:5969-6139` (`DatabaseStorage.deleteOrphanPhotos`)
- **Problem:** `getSocialGraph` loads all columns of `social_accounts` (including `bio`, `aiSummary`, `aiBackendNotes`, `sentNotes`) and all `social_follows` rows into memory. `deleteOrphanPhotos` loads the entire `photos` table plus 9 other tables into JS `Set`s, then deletes S3 objects sequentially.
- **Solution:**
  - In `getSocialGraph`, project only needed columns (`id`, `username`, `nickname`, `typeId`, `ownerUuid`, `imageUrl`) and filter in SQL.
  - In `deleteOrphanPhotos`, compute orphan photo IDs/locations directly in SQL using `NOT EXISTS` / `LEFT JOIN ... IS NULL` (or `EXCEPT` across referenced photo IDs/URLs) with a `LIMIT` batch size, and delete S3 objects concurrently with a bounded pool.

### C9. [Area 1] Missing High-Volume Foreign Key, GIN, and Composite Indexes
- **Location:** `shared/schema.ts:553` (`socialAccountHistory.observedViaAccountId`), `shared/schema.ts:681-687` (`socialAccountPosts`), `shared/schema.ts:2584` (`conversations.metadata`), `shared/schema.ts` (`people.socialAccountUuids`)
- **Problem:** Missing indexes cause full sequential scans on `social_account_history`, `people`, `conversations`, and `social_account_posts`.
- **Solution:** Add indexes in `shared/schema.ts` (and `db-init.ts` / migration):
  - B-tree index on `social_account_history(observed_via_account_id)`.
  - GIN index on `people` using `gin (social_account_uuids)`.
  - GIN index on `conversations` using `gin ((metadata->'addresses'))` (or `gin (metadata jsonb_path_ops)`).
  - Composite index on `social_account_posts(social_account_id, is_deleted, post_type, posted_at DESC)`.

### C10. [Area 7] Unmemoized `people` Array Triggers Full Pixi.js WebGL Teardown & Rebuild on Any UI State Change
- **Location:** `client/src/pages/graph.tsx:145-155,860` (`Graph`)
- **Problem:** `people` is computed inline via `allPeople.filter(...)` without `useMemo` and included in the `initPixi()` `useEffect` dependency array. Any UI state change (panel toggle, physics slider drag) recreates `people`, tearing down the WebGL context and restarting the simulation.
- **Solution:**
  - Wrap `people` in `useMemo` with `[allPeople, hideOrphans, ...]` dependencies.
  - Separate physics parameter updates (`centerForce`, `repelForce`, `linkForce`, `linkDistance`) into refs read by `simulate` rather than triggering WebGL teardown.

### C11. [Area 7] $O(N^2 + N \cdot E)$ Force Simulation Loop and Per-Frame Pixi `Graphics` Buffer Rebuilds
- **Location:** `client/src/pages/graph.tsx:555-692` (`Graph` → `simulate`)
- **Problem:** Inside `requestAnimationFrame`: allocates `Array.from(nodesRef.current.values())` every frame, iterates all edges inside the outer node loop ($O(N \cdot E)$ instead of $O(E)$), and calls `g.clear(); g.moveTo(); g.lineTo(); g.stroke()` on every edge every frame.
- **Solution:**
  - Cache the `nodes` array in a ref updated only when nodes change.
  - Move edge spring/attraction forces out of the `nodes.forEach` loop into a single $O(E)$ `edgesRef.current.forEach` pass.
  - Batch all edges into a single shared `PIXI.Graphics` layer (or use `Sprite`/mesh transforms) rather than clearing and re-uploading geometry buffers per edge per frame, and stop/throttle the simulation loop once kinetic energy converges below a threshold.

### C12. [Area 8] Unpaginated & Unvirtualized Rendering of All Posts and Stories
- **Location:** `client/src/pages/social-account-profile.tsx:308-316`, `client/src/components/social-posts-grid.tsx:58-124`, `client/src/components/stories-tab.tsx:529-562`
- **Problem:** Fetches all posts and stories in single unpaginated queries and `.map()`s every item into the DOM without pagination or virtualization, running `JSON.parse` per item on every render.
- **Solution:**
  - Paginate `/api/social-accounts/:uuid/posts` (e.g., `useInfiniteQuery` with 30–50 items per page) and virtualize the grid with `@tanstack/react-virtual` (or windowing).
  - Pre-parse post `content` JSON once in `useMemo` (or on fetch `select`) instead of inside the JSX `.map()` loop.

---

## High Issues

### H1. [Area 2] Synchronous Full-Payload `JSON.stringify` in API Request Logger
- **Location:** `server/index.ts:93-142` (`getJsonPreview`)
- **Solution:** Avoid calling `JSON.stringify(obj)` on large objects just to check length; inspect key count/array lengths directly or format a bounded preview without full-tree serialization. Release `capturedJsonResponse` if logging is disabled or truncate before `finish`.

### H2. [Area 2] Global Recursive JSON Tree Traversal on Every API Request/Response (`prmS3DirectMiddleware`)
- **Location:** `server/middleware/prm-s3-direct.ts:34-131`, `server/index.ts:145`
- **Solution:** Skip `prmS3DirectMiddleware` on bulk/ingest routes (e.g., `/api/v1/tracking/jobs/:id/scan`, `/api/export`, `/api/import`), combine the two `mapStrings` passes into one, and rewrite proxy URLs at the storage/serializer level for known image fields instead of recursively walking every response object.

### H3. [Area 2] Full-Table Scan + Sequential `scrypt` CPU Work on Invalid Extension Tokens
- **Location:** `server/auth.ts:138-167` (`authenticateExtensionToken`)
- **Solution:** Add a `tokenFormat` or `isLegacyScrypt` boolean column (or only query `WHERE token_hash LIKE 'scrypt:%'`), and rate-limit / cache negative token lookups briefly so invalid tokens cannot trigger repeated full-table scans and `scrypt` loops.

### H4. [Area 2] Sequential Chunked SQL Loop in Crowd Calculation
- **Location:** `server/routes/people-groups.ts:1382-1434` (`GET /api/groups/:id/crowd`)
- **Solution:** Replace the nested `100 × 400` sequential `db.select` loop with a single SQL query joining `social_follows` against `ANY($1::uuid[])` and `ANY($2::uuid[])` (or run chunks with `Promise.all` capped at concurrency 4).

### H5. [Area 2] Full-Table Load for Duplicate Check on Person Creation & Unbounded Core List Endpoints
- **Location:** `server/routes/people-groups.ts:138-153,244-286,360-401,530-546,1063-1071,1144-1152`, `server/routes/events.ts:17-24`
- **Solution:**
  - In `POST /api/people`, replace `storage.getAllPeople()` with `SELECT id FROM people WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) LIMIT 1`.
  - Add `limit` / `offset` (or cursor) pagination with sensible defaults (e.g., `limit=100`, max `500`) to `/api/events`, `/api/people`, `/api/people/search`, `/api/notes`, `/api/groups`, and `/api/subgroups`.
  - In `/api/people/search?connected_to_me=true`, filter relationships in SQL (`WHERE person_from_id = $me OR person_to_id = $me`) instead of calling `getAllRelationships()`.

### H6. [Area 3] `GET /api/v1/pending-imports` Loads Up to 10,000 Full Import Rows Per Page
- **Location:** `server/routes/pending-imports.ts:298-351`
- **Solution:** Compute `totalPending`, `totalImported`, and `totalFollowersCaptured` using a lightweight SQL `COUNT(*) FILTER (...)` / `SUM(...)` query (or store follower/following counts in integer columns on insert) instead of fetching 10,000 rows with CSV blobs.

### H7. [Area 3] Sequential Row-by-Row DB Inserts, Media Uploads, and Cancellation Checks in Imports
- **Location:** `server/task-worker.ts:3481-3557,3802-3871,4149-4301,4592-4605`
- **Solution:**
  - Batch DM message inserts with `bulkCreateMessages` (like SMS import) and batch `getPhotoByFileHash` checks.
  - Check `isTaskCancelled(taskId)` every 50–100 rows instead of every single row.
  - Use `createImageTasksBatch` instead of calling `queueSocialProfileImage` sequentially per row.

### H8. [Area 3] CPU-Bound Graph Clustering & Pixel Processing Blocking the Event Loop + Serial Task Queue HOL Blocking
- **Location:** `server/task-worker.ts:5184-5938` (`runLouvainClustering`, `processFindPotentialGroups`), `server/task-worker.ts:6034-6052` (`runWorkerLoop`), `server/roster-import.ts:86-213`
- **Solution:**
  - Offload `runLouvainClustering`, bipartite graph construction, and `roster-import.ts` pixel loops to Node `worker_threads` (or yield periodically with `setImmediate` in clustering).
  - Partition `runWorkerLoop` into separate lanes (e.g., fast/interactive tasks vs. heavy batch tasks like `export_xml`/`import_xml`/`find_potential_groups`) so long jobs do not cause head-of-line blocking.

### H9. [Area 4] Sequential Single-Item Embeddings & Qdrant `wait: true` Upserts in Bulk Vectorization
- **Location:** `server/vector-universal.ts:380-411,595-607`, `server/vector-app-knowledge.ts:55-96`, `server/ai/ollama-adapter.ts:47-54`, `server/ai/openai-adapter.ts:126-134`
- **Solution:**
  - Add a `embedBatch(texts: string[])` method to the AI provider adapters (Ollama `/api/embed` and OpenAI `/v1/embeddings` both support array inputs).
  - Batch Qdrant upserts (e.g., 64–128 points per `upsert` call) with `wait: false` during bulk syncs, and batch Postgres `vectorized_at` updates with `inArray`.

### H10. [Area 4] Missing Default Timeout in `postJson` & Blocking Sequential LLM Loop in `GET /api/guess-sex/queue`
- **Location:** `server/ai/http.ts:23-42`, `server/ai-tools.ts:1092`, `server/routes/ai-vector.ts:3284-3301`
- **Solution:**
  - Add a default `AbortSignal.timeout(60_000)` (or configurable timeout) inside `postJson` when no `signal` is provided.
  - Move `generateSexGuesses()` into a background worker/queue triggered asynchronously rather than blocking `GET /api/guess-sex/queue` for up to 5 sequential LLM calls.

### H11. [Area 4] Full-Table Scans in AI Tools, N+1 Sender Lookups, Over-Fetching in `/api/ai-chats`, and Unbounded JSONB `OR` in `/api/image/query-person`
- **Location:** `server/ai-tools.ts:742-815,904-1227`, `server/routes/ai-vector.ts:1199-1227,1861-1881`
- **Solution:**
  - Push `WHERE` + `ILIKE`/`tsvector` + `LIMIT` filters into SQL for `daily_note_search`, `note_search`, and `interaction_search`.
  - Batch sender resolution in `read_messages` / `search_messages` / `get_message_by_id` using `inArray` on unique `senderPersonIds` and `senderAccountIds`.
  - In `GET /api/ai-chats`, compute `jsonb_array_length(messages)` in SQL instead of fetching full `messages` blobs.
  - In `GET /api/image/query-person`, chunk `faceIds` or use `jsonb_path_exists` / normalized `faces.person_id` joins instead of an uncapped `OR` chain of `@>` predicates.

### H12. [Area 5] Linear $O(F \times C)$ / $O(F \times H)$ Brute-Force Vector Scans in JS & Unbounded Cluster/Identity Aggregations
- **Location:** `server/face-lookalikes.ts:186-281`, `server/face-clusters.ts:262-355`, `server/faces.ts:106-203`
- **Solution:**
  - Move `topCentroids` and `honeypotScoresFor` lookups to pgvector/Qdrant ANN search.
  - In `clusterSuggestions`, push `LIMIT` / top-N face sampling into SQL (e.g., `ROW_NUMBER() OVER (PARTITION BY cluster ORDER BY ...)` <= 6) and mutate arrays in `facesOfClusters` (`list.push(...)`) instead of copying with `[...list, ...]`.
  - In `queryIdentities`, filter/paginate candidate groups before joining and aggregating `faces`/`photos` counts.

### H13. [Area 5] Unbounded S3 Buffer Reads & Full-Table Loads in `image-pass-in-utils.ts`
- **Location:** `server/prm-s3.ts:762-772`, `server/image-pass-in-utils.ts:17-92`
- **Solution:**
  - Enforce a byte cap (or stream directly) in `getPrmS3ObjectBuffer`, and pass hash/dimensions directly from ingestion rather than re-downloading from S3 in `ingestManualProfileImage`.
  - In `runAutomaticImagePassIn`, query only `WHERE image_url IS NULL` in SQL and batch updates.

### H14. [Area 6] Unbounded Social/Inbox Queries, In-Memory Matching, Unbounded `knownContent` in `claimTrackingJobs`, and 4x Subquery in `mergeSocialAccounts`
- **Location:** `server/routes/social-media.ts:113-123,217-343,1440-1516`, `server/routes/stories.ts:466-491`, `server/tracking.ts:410-457`, `server/account-merge.ts:113-184`
- **Solution:**
  - Add pagination to `GET /api/social-accounts` and `GET /api/inbox-notes` (use `jsonb_array_elements` + `ORDER BY` + `LIMIT/OFFSET` in SQL).
  - Push `/api/account-matching/next` scoring/filtering into SQL; in `export-xml`, filter `social_follows` and `social_account_history` by `inArray(..., accountIds)`.
  - In `knownContent`, query only recent/needed IDs or move outside the `FOR UPDATE` claim transaction; in `mergeSocialAccounts`, materialize the `(p_id, q_id)` post mapping once in a `WITH` CTE or temp table.

### H15. [Area 1] N+1, Full-Table Loads & Missing Transactions in Storage Bulk/Read Methods
- **Location:** `server/storage.ts:812-907,1020-1095,1471-1528,3547-3560,3736-3963,4089-4113,5139-5145,5784-5861,6792-6838`
- **Solution:**
  - Wrap `deletePeopleCreatedSince`, `linkPhoneToPerson`, and `removeDuplicateSocialAccounts` in `db.transaction(...)`.
  - Replace per-row loops with set-based SQL (`UPDATE groups SET members = array_remove(...)`, `inArray` batching).
  - Add pagination/limits and column projections to `getGraphData`, `getAllPeopleWithRelationships`, `getAllGroups`, `getAllPosts`, and `listDailyNotes`.
  - Derive counts in `getNetworkState` from `getFollowerIds`/`getFollowingIds` lengths instead of running 3 extra correlated subqueries.

### H16. [Area 7] Unmemoized `L.divIcon`, `position`, and `eventHandlers` Recreating Every Leaflet DOM Marker on Every Render
- **Location:** `client/src/pages/map-demo.tsx:51-53,459-478` (`MapDemo`, `personIcon`)
- **Solution:** Extract a `React.memo`-wrapped `<PersonMarker />` component that memoizes `L.divIcon(...)`, `[lat, lng]`, and `eventHandlers` with `useMemo`/`useCallback` so unrelated state updates (`search`, `panelOpen`) do not destroy/recreate DOM markers.

### H17. [Area 8] Missing `loading="lazy"`, Unconditional Full-Dataset Fetches, Unvirtualized Face Grids, and 15s Polling on `/api/face-review/counts`
- **Location:** `client/src/components/social-posts-grid.tsx:80`, `client/src/components/stories-tab.tsx:544`, `client/src/components/social-account-row.tsx:35-38`, `client/src/pages/image-detail.tsx:174-183`, `client/src/components/members-tab.tsx:66-71`, `client/src/components/account-faces-tab.tsx:132-249`, `client/src/components/face-verify-tab.tsx:19-116`, `client/src/pages/face-review.tsx:146-149`
- **Solution:**
  - Add `loading="lazy"` and `decoding="async"` to all grid thumbnail `<img>` tags.
  - Gate `/api/people` in `MembersTab` with `enabled: isAddMemberOpen`, and avoid fetching full `/api/people` + `/api/social-accounts` in `ImageDetailPage` when `photo.source` is already resolved (or use a lightweight search endpoint).
  - Virtualize/paginate `AccountHolderView` and `FaceVerifyTab` face lists and memoize `Set`/`.filter()`/`.sort()` computations.
  - Remove `refetchInterval: 15_000` from `FaceReviewPage` (relying on mutation invalidation + `staleTime: Infinity` like `app-sidebar.tsx`).

---

## Medium Issues

### M1. [Area 1] Additional Missing FK Indexes, N+1 Interaction Cleanups, Boot Schema Checks & Unindexed `ilike`
- **Location:** `shared/schema.ts:63,915,1289,1334-1335,1364`, `server/storage.ts:1637-1675,6892-6923`, `server/db-init.ts:372-806`
- **Solution:** Add indexes on `apiKeys.userId`, `imageTaskGroups.socialAccountId`, `storyScrapeRuns.importerId`, `trackingJobs.importerId`/`runId`, `socialAccountIssues.jobId`; replace N+1 loops in `removePersonFromInteractions`/`removeGroupFromInteractions` with set-based SQL; batch `validateAndSyncSchema` into one `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'` query; use `LOWER(account_username) = LOWER(...)` with a functional index in `findDuplicatePendingSocialAccountImport`.

### M2. [Area 2] SSE Client Leak / Backpressure, Over-Fetching in Person/Group Routes & Uncached `/api/stats/*`
- **Location:** `server/middleware/sse.ts:18-46`, `server/routes/people-groups.ts:440-444,521-527,714-899,1238-1277`, `server/routes/addresses.ts:30-33`, `server/routes/stats.ts:29-245`
- **Solution:**
  - Store SSE clients in a `Map`, remove clients immediately on `write` error, and handle `res.write()` returning `false` (drop/skip slow clients or wait for `'drain'`).
  - Use targeted queries (`getPersonNotes`, `getPersonRelationships`, `SELECT id ... LIMIT 1`) instead of `storage.getPersonById` (which fires 8+ queries).
  - Cache `/api/stats/*` responses for 60–300s (invalidated or TTL-based).

### M3. [Area 3] Unbounded Concurrency in Roster/Story Summary Fetching, Sequential Bulk Endpoints & Sequential `stories-scheduler`
- **Location:** `server/roster-import.ts:369-380`, `server/routes/roster-import.ts:15,40-51`, `server/summary-queue.ts:531-533,693-706,747-748`, `server/routes/pending-imports.ts:464-527`, `server/routes/messages.ts:44-144`, `server/routes/summaries.ts:145-177`, `server/stories-scheduler.ts:164-187`
- **Solution:** Cap `Promise.all` concurrency (e.g., 4–6) in `analyzeRoster`, `runStorySummary`, and `runPostSummaryJob`; replace sequential loops in `bulk-import`, `bulk-delete`, `POST /api/conversations`, and `extractBackendNotes` with batched `inArray` / multi-row inserts; use `inArray` for `GET /api/conversations/:id` participants; replace the correlated subquery in `/api/summary-queue` with a `LEFT JOIN` aggregate; run `startQueuedStoriesRuns` concurrently per importer.

### M4. [Area 4] Vector Config/Qdrant Round-Trips, Sequential Daily-Note Vectorization, AI/Recognition N+1s & Video Buffer Duplication
- **Location:** `server/vector.ts:37-240`, `server/vector-universal.ts:50-349`, `server/vector-app-knowledge.ts:154-229`, `server/routes/ai-vector.ts:2743-2771,3157-3328`, `server/ai/describe.ts:31-66`, `server/recognition.ts:140-200,905-1171,1287-1451`, `server/routes/osint.ts:292-310`, `server/routes/mcp.ts:97-118`
- **Solution:**
  - Cache vector/S3/provider settings in memory with TTL/invalidation and reuse a singleton `QdrantClient` + cached `ensureCollection` flag.
  - Use `runPool` in `/api/daily-notes/vectorize-all` and batch `people`/`socialAccounts` lookups in `describePhoto`, `generateSexGuesses`, and `/api/guess-sex/queue`.
  - Stream video files to STT instead of `new Blob([buffer])` duplication, resize large images proactively before `describeImage` base64 encoding, and filter `alreadyQueued` by `photoId` in SQL.
  - Paginate `/api/osint/scan-queue`, reuse the MCP `Server` instance, and truncate/cap `ai-tools` & MCP response payloads.

### M5. [Area 5] Leading-Wildcard Scans in Photo/Account-Face Queries, Redundant `sharp` Hashing & Sequential Face Mutation Loops
- **Location:** `server/photo-source.ts:558-575`, `server/account-faces.ts:24-327`, `server/profile-image.ts:257-392`, `server/face-verify.ts:71-101`, `server/routes/faces.ts:106-202`, `server/routes/face-review.ts:48-700`, `server/face-clusters.ts:115-125`, `server/prm-s3.ts:710-722`
- **Solution:**
  - Add `pg_trgm` indexes or normalize URLs/mentions for `resolvePhotoSources` and `accountFacePhotos`; compute `accountFaceScope` once per request.
  - Move `perceptualHash` (`sharp`) *after* fast `imageUrl` / `fileHash` / `cdnFilename` equality checks in `classifyProfileImage`.
  - Batch `confirmVerify`, `identityIsVisible`, `getReadablePhoto`, and `listPrmS3ObjectKeys` with `inArray` / `Promise.all` / single transactions.

### M6. [Area 6] Sequential TPS/Photo/Bulk Loops, Cold-Cache Thundering Herd in `getConnectionNetwork`, and Redundant Writes
- **Location:** `server/routes/tps.ts:115-144`, `server/routes/social-media.ts:345-554,1048-1053,1537-1550,2068-2104,2476-2640`, `server/connection-strength.ts:453-584`, `server/tracking.ts:174-825`, `server/social-account-history.ts:238-457`
- **Solution:**
  - Batch `/api/v1/tps/match` lookups and parallelize S3/HTTP deletes in `DELETE /api/photos/:id` and bulk endpoints with `Promise.all`.
  - Deduplicate in-flight `getConnectionNetwork` promises on cold cache.
  - Cache `levelCadences` / `trackingQuietHours` / `appSettings`, merge `applyInfo`'s second `UPDATE` into `applySnapshot`, and compute `socialFollows` diffs in SQL.

### M7. [Area 7] Unmemoized `PinMarker` & Per-Frame `THREE.Vector3` Allocations
- **Location:** `client/src/pages/google-map.tsx:52-66,125-127`, `client/src/pages/social-graph-3d.tsx:1181-1189`
- **Solution:** Wrap `PinMarker` in `React.memo` with stable `onSelect` callbacks; reuse scratch `THREE.Vector3` instances (like `TUBE_UP`) in `linkPositionUpdate` instead of allocating per frame.

### M8. [Area 8] Overlapping Polling, Unvirtualized Infinite Lists & Full-Res Thumbnails
- **Location:** `client/src/pages/social-account-profile.tsx:419-427,1514`, `client/src/components/social-account-history-tab.tsx:159-220`, `client/src/pages/people-list.tsx:564-920`, `client/src/pages/social-accounts-list.tsx:224-951`, `client/src/pages/face-review.tsx:84,750`, `client/src/components/family-tree-flow.tsx:212-216`, `client/src/pages/home.tsx:379-384`, `client/src/components/interactions-tab.tsx:234-239`, `client/src/components/person-flow-tab.tsx:213-217`
- **Solution:**
  - Consolidate `tracking-jobs` polling between `SocialAccountProfile` and `SocialAccountHistoryTab` and pause `history/summary` polling when no job is active.
  - Virtualize `PeopleList` and `SocialAccountsList` with `@tanstack/react-virtual` and memoize `Set` / `Map` lookups (replacing `socialAccountTypes.find()` inside `.map()`).
  - Pass `withImageSize(url, 64)` (or `128`/`256`) and `loading="lazy"` for small avatars, timeline thumbnails, and `FamilyTreeFlow` nodes.

---

## Low Issues

### L1. [Area 1] Multi-Statement Mutations Without Explicit `db.transaction`
- **Location:** `server/storage.ts:1454-1469` (`deletePerson`), `server/storage.ts:4115-4147` (`upsertNetworkState`)
- **Solution:** Wrap both methods in `await db.transaction(async (tx) => ...)` to ensure atomicity and reduce commit overhead.

### L2. [Area 2] Rate-Limiter Mounted Before Auth Middleware & Unbounded Store Within Window
- **Location:** `server/middleware/rate-limit.ts:8-31`, `server/index.ts:70,91`
- **Solution:** Move `rateLimitMiddleware` after `setupAuth(app)` so `req.user.id` is available for keying, and cap `rateLimitStore` size (e.g., LRU eviction) to bound memory under high unique-IP traffic.

### L3. [Area 3] 2-Second Polling Loop in `trackPrmS3BackupTask`
- **Location:** `server/task-worker.ts:6068,6082-6137`
- **Solution:** Increase `PRM_S3_BACKUP_POLL_MS` to 5–10s (or use exponential backoff) and check cancellation less frequently.

### L4. [Area 4] Sequential `app_settings` Reads in `provider.ts` and `recognition.ts`
- **Location:** `server/ai/provider.ts:73-123`, `server/recognition.ts:1237-1261`
- **Solution:** Batch `storage.getAppSetting` calls with `Promise.all` (or a single `inArray(appSettings.key, keys)` query) with a short-TTL cache.

### L5. [Area 5] Sequential Settings Reads, Bucket Probing & Cache Invalidation in `prm-s3.ts`
- **Location:** `server/prm-s3.ts:91-128,530-566,653-673`
- **Solution:** Fetch the 9 S3 settings in one `inArray` / `Promise.all` query; probe buckets concurrently with `Promise.all`; skip `setPrmS3Config` in `syncFaceCropStorage` when `cfg.bucket === cfg.baseBucket`.

### L6. [Area 6] Uncached Live Health Probes, Correlated Subquery in Account Issues, $O(S \times M)$ Highlight Grouping & Per-ID Bulk Delete
- **Location:** `server/routes/setup-services.ts:28-237`, `server/routes/account-issues.ts:66-102`, `server/routes/tracking.ts:1158-1180`, `server/routes/stories.ts:676`
- **Solution:** Cache `/api/status-dot` and `/api/setup/services/health` for 15–30s; replace the correlated `openJob` subquery in `account-issues.ts` with a `LEFT JOIN` and add offset pagination; group `stints` into a `Map` in `tracking.ts`; batch `failUnfinishedJobs` with `inArray` in `stories.ts`.

### L7. [Area 7] Per-Node `TextStyle` Allocations, `useToast` Re-Subscriptions, Uncached `addHandlers`, Eager Dialog Import & Uncancelled `setTimeout`s
- **Location:** `client/src/pages/graph.tsx:274-371`, `client/src/hooks/use-toast.ts:171-183`, `client/src/App.tsx:388-396`, `client/src/pages/home.tsx:33`, `client/src/pages/person-graph-view.tsx:609,667`
- **Solution:** Share two `PIXI.TextStyle` instances in `graph.tsx`; change `useToast` `useEffect` deps from `[state]` to `[]`; wrap `addHandlers` in `useMemo` in `AppLayout`; lazy-load `PostDetailDialog` in `home.tsx`; clear both `setTimeout`s in `useEffect` cleanup in `PersonGraphView`.

### L8. [Area 8] Unmemoized Highlight Grouping and Sorting on Every Render in `StoriesTab`
- **Location:** `client/src/components/stories-tab.tsx:391-434` (`StoriesTab`)
- **Solution:** Wrap `live`, `setsOf`, `unset`, `sorted`, and `cards` computations in `useMemo` keyed on `[stories, highlightSets]`.

---

## Well-Configured Baselines

The following areas were audited and found to be well-configured:
- **DB Pool (`server/db.ts`):** `max: 25`, `idleTimeoutMillis: 30000`, `statement_timeout: 30000`, `query_timeout: 35000`, `keepAlive: true`, and `pool.on('error')`.
- **Vite Bundling (`vite.config.ts`):** Configured with `manualChunks` separating heavy vendor libraries.
- **Route Code-Splitting (`client/src/App.tsx`):** Uses `React.lazy` for pages and global dialogs.
- **TanStack Query Defaults (`client/src/lib/queryClient.ts`):** Uses `staleTime: 2m`, `gcTime: 15m`, and `refetchOnWindowFocus: false`.
