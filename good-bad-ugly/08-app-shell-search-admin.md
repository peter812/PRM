# Technical Audit Report: App Shell, Global Search, Admin Backups & Background Task Engine

**Target System:** PRM (Personal Relationship Manager)  
**Scope:** App Shell & Navigation, Global Search & Semantic Search, Backups & Migration, Task Worker Core Engine  
**Audit Date:** August 2026  
**Auditor:** Full-Stack Architecture, Performance & System Operations Auditor  

---

## Executive Summary

This audit evaluated the core administrative and application scaffolding of the PRM system, focusing on five tightly coupled subsystems:
1. **App Shell & Navigation Framework:** [App.tsx](file:///c:/Repos/PRM/client/src/App.tsx), [app-sidebar.tsx](file:///c:/Repos/PRM/client/src/components/app-sidebar.tsx), [mobile-bottom-nav.tsx](file:///c:/Repos/PRM/client/src/components/mobile-bottom-nav.tsx), and [index.css](file:///c:/Repos/PRM/client/src/index.css).
2. **Global & Semantic Search Engines:** [global-search.tsx](file:///c:/Repos/PRM/client/src/components/global-search.tsx), [search-settings.tsx](file:///c:/Repos/PRM/client/src/pages/search-settings.tsx), [super-search.tsx](file:///c:/Repos/PRM/client/src/pages/super-search.tsx), and backend endpoints in [auth-setup.ts](file:///c:/Repos/PRM/server/routes/auth-setup.ts) and [storage.ts](file:///c:/Repos/PRM/server/storage.ts).
3. **Data Management, Backups & Migration:** [backups-page.tsx](file:///c:/Repos/PRM/client/src/pages/backups-page.tsx), [backups.ts](file:///c:/Repos/PRM/server/routes/backups.ts), [xml-utils.ts](file:///c:/Repos/PRM/server/xml-utils.ts), [import-export-home.tsx](file:///c:/Repos/PRM/client/src/pages/import-export-home.tsx), and [delete-options.tsx](file:///c:/Repos/PRM/client/src/pages/delete-options.tsx).
4. **Asynchronous Background Task Engine:** [task-worker.ts](file:///c:/Repos/PRM/server/task-worker.ts), [tasks-settings.tsx](file:///c:/Repos/PRM/client/src/pages/tasks-settings.tsx), [task-detail.tsx](file:///c:/Repos/PRM/client/src/pages/task-detail.tsx), and [task-tracker-modal.tsx](file:///c:/Repos/PRM/client/src/components/task-tracker-modal.tsx).

```
+---------------------------------------------------------------------------------------------+
|                                    SYSTEM SCORECARD                                         |
+------------------------------------+---------+----------------------------------------------+
| Subsystem                          | Grade   | Key Driver                                   |
+------------------------------------+---------+----------------------------------------------+
| App Shell & Layout Structure       | B-      | Rich UX & theming, but leaky code-splitting  |
| Global & Super Search              | C+      | Instant UUID lookup vs. un-debounced ILIKE   |
| Backups & Migration Engine         | D+      | Non-transactional restore; fragile XML regex |
| Task Worker Polling & Concurrency  | D       | Single-threaded; massive client polling storm|
| System Operations & Fault Recovery | C-      | No retry, unhandled crash risks in main loop |
+------------------------------------+---------+----------------------------------------------+
```

### High-Risk Architecture Vulnerabilities Identified
- **Non-Transactional XML Restore ([task-worker.ts:840-1667](file:///c:/Repos/PRM/server/task-worker.ts#L840-L1667)):** XML database restores execute thousands of separate, un-isolated Drizzle database inserts across 23 different tables without wrapping them inside a SQL transaction (`db.transaction()`). An error halfway through permanently corrupts the database with orphaned records.
- **In-Process Single-Threaded Worker Execution ([task-worker.ts:3697-3715](file:///c:/Repos/PRM/server/task-worker.ts#L3697-L3715)):** Long-running tasks (e.g., XML serialization, community detection algorithms, image conversions) run on the main Node.js event loop. A single heavy task locks API request handling, while unhandled exceptions or OOM errors crash the entire web server.
- **Client-Side Polling Thunderstorm ([App.tsx:83](file:///c:/Repos/PRM/client/src/App.tsx#L83), [task-tracker-modal.tsx:90-112](file:///c:/Repos/PRM/client/src/components/task-tracker-modal.tsx#L90-L112)):** Despite possessing an existing Server-Sent Events infrastructure (`sseManager`), four independent UI components poll `/api/tasks/current`, `/api/image-tasks/current`, and `/api/tasks/:id` every 1.5 to 4 seconds, causing relentless network chatter and unnecessary database load.
- **Un-debounced 7-Way Wildcard Full-Table Scans ([global-search.tsx:46-49](file:///c:/Repos/PRM/client/src/components/global-search.tsx#L46-L49), [storage.ts:4201-4300](file:///c:/Repos/PRM/server/storage.ts#L4201-L4300)):** Keystrokes immediately trigger 7 parallel queries containing leading wildcards (`ILIKE '%...%'`) and array unnesting without debounce or request cancellation.

---

## 1. App Shell, Navigation & Routing Architecture

### 1.1 Router Structure and Code Splitting Deficiencies
In [App.tsx](file:///c:/Repos/PRM/client/src/App.tsx), routing is built with `wouter`. While most page routes are defined using `React.lazy()` (e.g., [App.tsx:29-64](file:///c:/Repos/PRM/client/src/App.tsx#L29-L64)), several architectural oversights undermine the benefits of code splitting:

1. **Static Import of Lazy Components:** At [App.tsx:27](file:///c:/Repos/PRM/client/src/App.tsx#L27), the application statically imports `SettingsSidebar` directly from `@/pages/settings-layout`:
   ```typescript
   import { SettingsSidebar } from "@/pages/settings-layout";
   ```
   At line 44, `SettingsLayout` is declared as lazy: `const SettingsLayout = lazy(() => import("@/pages/settings-layout"));`. Because `SettingsSidebar` is statically referenced in the root layout ([App.tsx:245](file:///c:/Repos/PRM/client/src/App.tsx#L245)), bundlers (Vite/Rollup) pull the entire `settings-layout` module and its dependencies directly into the critical initial bundle.
2. **Root Mounting of Heavy Dialogs:** In [App.tsx:14-25](file:///c:/Repos/PRM/client/src/App.tsx#L14-L25) and [App.tsx:321-330](file:///c:/Repos/PRM/client/src/App.tsx#L321-L330), eight complex dialogs are statically imported and mounted permanently in the DOM:
   - `PersonDialog`, `SocialAccountDialog`, `RelationshipDialog`
   - `DailyNoteModal`, `InteractionDialog`, `AddNoteDialog`
   - `PhotoUploadDialog`, `TaskTrackerModal`
   These dialogs pull in form libraries, image croppers, date pickers, and animation libraries (`framer-motion`) on initial page load, even if the user never opens them.
3. **Inline Functional Redirect Components:** At [App.tsx:179-187](file:///c:/Repos/PRM/client/src/App.tsx#L179-L187), routes use inline anonymous functions for redirection:
   ```typescript
   <ProtectedRoute path="/backups" component={() => <Redirect to="/settings/import-export/backups" />} />
   ```
   Passing an anonymous arrow function to Wouter's `component` prop causes Wouter to recreate and unmount/remount the component on every render cycle instead of performing a direct virtual routing transition.

### 1.2 Layout Composition & Polling Leak
In `AppLayout` ([App.tsx:195-334](file:///c:/Repos/PRM/client/src/App.tsx#L195-L334)), the layout maintains global state for dialog toggles, theme management, and sidebar collapsible menus.

> [!WARNING]
> **Leaky Global Polling in App Root ([App.tsx:68-118](file:///c:/Repos/PRM/client/src/App.tsx#L68-L118)):**
> The custom hook `useExportNotifier()` is invoked unconditionally inside `AppLayout`:
> ```typescript
> const { data: tasks } = useQuery<{ id: string; type: string; status: string; result?: string }[]>({
>   queryKey: ["/api/tasks/current"],
>   enabled: !!user,
>   refetchInterval: 4000,
>   select: (data) => data.map(t => ({ id: t.id, type: t.type, status: t.status, result: (t as any).result })),
> });
> ```
> Every authenticated user with an active browser tab polls `/api/tasks/current` every 4000ms solely to display a single toast notification when an XML export finishes. This occurs concurrently with other polling hooks in `TaskTrackerModal` and settings pages.

### 1.3 Sidebar & Mobile Navigation
- **Responsive Behavior ([app-sidebar.tsx](file:///c:/Repos/PRM/client/src/components/app-sidebar.tsx), [mobile-bottom-nav.tsx](file:///c:/Repos/PRM/client/src/components/mobile-bottom-nav.tsx)):**
  - Desktop: Collapsible navigation with clean hierarchy, sub-items, and live badge count indicators (`questions.length` for unknown faces at [app-sidebar.tsx:337-340](file:///c:/Repos/PRM/client/src/components/app-sidebar.tsx#L337-L340)).
  - Mobile: Clean sticky bottom navigation (`MobileBottomNav`) with clear 44px tap targets and dedicated quick-add action.
  - Multi-query overhead: The sidebar independently mounts 4 separate queries (`/api/settings`, `/api/osint/status`, `/api/image-questions/pending`, and `/api/git/branch`).
- **Styling and CSS System ([index.css](file:///c:/Repos/PRM/client/src/index.css)):**
  - Includes full support for Light, Dark, and an extensive custom **Frutiger Aero** retro theme ([index.css:403-747](file:///c:/Repos/PRM/client/src/index.css#L403-L747)).
  - Performance implication: Frutiger Aero uses heavy CSS glassmorphism (`backdrop-filter: blur(24px) saturate(145%)` on dialogs and headers) combined with dynamic floating bubble animations (`.aero-bubble` with infinite keyframes). On low-power mobile GPUs or integrated graphics, this introduces compositing layer thrashing and frame drops during scrolling.

---

## 2. Global Search & Semantic Super Search Architecture

### 2.1 Global Search UI & Preferences System
[global-search.tsx](file:///c:/Repos/PRM/client/src/components/global-search.tsx) implements an interactive dropdown search bar with real-time category filtering.

```
+-----------------------------------------------------------------------+
|  Search... [Sparkles (AI)]                                           |
+-----------------------------------------------------------------------+
|  UUID Match: Person -> /person/550e8400-e29b-41d4-a716-446655440000   |
|  PEOPLE (Max 4): John Doe (Acme Corp • VP Engineering)                |
|  GROUPS (Max 4): Core Engineering [Work]                             |
|  INTERACTIONS: Q3 Planning Call                                       |
|  NOTES: Discussed infrastructure migration                            |
|  SOCIAL PROFILES: @johndoe (instagram.com/johndoe)                   |
|  DAILY NOTES: August 29 2026 - Sprint Planning                        |
|  AI CHATS: Architecture Analysis Chat                                 |
+-----------------------------------------------------------------------+
```

- **UUID Auto-Routing ([global-search.tsx:29-31, 51-55](file:///c:/Repos/PRM/client/src/components/global-search.tsx#L29-L31)):** Accurately recognizes 36-character UUID strings via `UUID_REGEX` and queries `/api/uuid-lookup/:uuid`. Clicking immediately redirects to the target entity route (`/person/:id`, `/social-accounts/:id`, `/image/:id`).
- **Configurable Categories ([search-settings.tsx](file:///c:/Repos/PRM/client/src/pages/search-settings.tsx)):** Users can customize category ordering via drag-and-drop or up/down buttons and toggle inclusion via checkboxes.
- **Cross-Component Communication ([search-settings.tsx:24, 38](file:///c:/Repos/PRM/client/src/pages/search-settings.tsx#L24)):** State is synced across components via `window.dispatchEvent(new Event('searchPreferencesChanged'))` and persisted in `localStorage`.

### 2.2 Performance Flaws & Backend Strain
Despite its responsive presentation, the implementation contains critical performance bottlenecks:

1. **Zero Keystroke Debouncing ([global-search.tsx:46-49](file:///c:/Repos/PRM/client/src/components/global-search.tsx#L46-L49)):**
   ```typescript
   onChange={(e) => setSearchQuery(e.target.value)}
   ...
   const { data: results } = useQuery<MegaSearchResult>({
     queryKey: searchQuery.length > 0 && !isUuidQuery ? [`/api/mega-search?${queryParams.toString()}`] : ["/api/mega-search"],
     enabled: searchQuery.length > 0 && !isUuidQuery,
   });
   ```
   Every single character typed or deleted immediately updates the state and dispatches a GET request to `/api/mega-search`. Typing a 10-character query generates 10 simultaneous HTTP requests.
2. **Brute-Force 7-Table Parallel Database Queries ([storage.ts:4223-4300](file:///c:/Repos/PRM/server/storage.ts#L4223-L4300)):**
   Inside `storage.megaSearch`, each request initiates up to 7 parallel SQL queries using `Promise.all`:
   ```typescript
   // storage.ts:4227-4238
   db.select().from(people).where(or(
     ilike(people.firstName, searchPattern),
     ilike(people.lastName, searchPattern),
     sql`CONCAT(${people.firstName}, ' ', ${people.lastName}) ILIKE ${searchPattern}`,
     sql`CONCAT(${people.lastName}, ' ', ${people.firstName}) ILIKE ${searchPattern}`,
     ilike(people.company, searchPattern),
     ilike(people.title, searchPattern),
     ilike(people.email, searchPattern),
     ilike(people.phone, searchPattern),
     sql`EXISTS (SELECT 1 FROM unnest(${people.tags}) AS t WHERE t ILIKE ${searchPattern})`
   ))
   ```
   - **Index Invalidation:** Leading wildcard patterns (`%query%`) completely invalidate standard PostgreSQL B-Tree indexes. Unless Trigram (`pg_trgm`) GIN/GiST indexes are explicitly configured on all 15+ searched columns, PostgreSQL performs sequential table scans on every keystroke.
   - **Dynamic String Concatenations:** `CONCAT(...) ILIKE ...` requires on-the-fly row string evaluation for every row in the table.
   - **Array Unnesting:** Subquery `EXISTS (SELECT 1 FROM unnest(people.tags) ...)` forces array expansion per row.

### 2.3 Semantic Super Search ([super-search.tsx](file:///c:/Repos/PRM/client/src/pages/super-search.tsx))
- Activates when the user clicks the AI Sparkles toggle ([global-search.tsx:412-439](file:///c:/Repos/PRM/client/src/components/global-search.tsx#L412-L439)) or hits Enter.
- Queries `/api/vector/universal/search` using vector embeddings, returning unified ranked results across people, groups, notes, interactions, and images with confidence percentages and snippets.
- **Architectural Advantage:** Offloads similarity scoring to vector indexes rather than executing unindexed SQL full-text regexes.

---

## 3. Backups, Migration & System Administration

### 3.1 Backup Management UI & API
The backup system ([backups-page.tsx](file:///c:/Repos/PRM/client/src/pages/backups-page.tsx), [backups.ts](file:///c:/Repos/PRM/server/routes/backups.ts)) provides an administrative management panel:
- **Capabilities:** Create timestamped or custom XML backups, upload existing XML backups, download directly via streamed HTTP attachment ([backups.ts:232](file:///c:/Repos/PRM/server/routes/backups.ts#L232)), rename backups, and delete old backups.
- **Security Sanitization ([backups.ts:17-26](file:///c:/Repos/PRM/server/routes/backups.ts#L17-L26)):** Filenames are strictly sanitized via regex (`/[^a-zA-Z0-9._-]/g, "_"`) and checked for path traversal tokens (`..`, `/`, `\`), preventing directory traversal attacks into the filesystem.
- **Admin Guarding ([backups.ts:42](file:///c:/Repos/PRM/server/routes/backups.ts#L42)):** All backup endpoints enforce the `requireAdmin` middleware.

### 3.2 The XML Serialization & Parsing Engine ([xml-utils.ts](file:///c:/Repos/PRM/server/xml-utils.ts))

> [!CAUTION]
> **Manual Regex-Based XML Parsing Engine:**
> Instead of using an industry-standard, streaming, SAX, or DOM XML parser (such as `fast-xml-parser` or `libxmljs`), [xml-utils.ts](file:///c:/Repos/PRM/server/xml-utils.ts) parses XML via regular expressions:
> ```typescript
> export function parseXmlTag(tagName: string, text: string): string {
>   const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "s");
>   const match = text.match(regex);
>   return match ? match[1].trim() : "";
> }
> export function parseAllTags(tagName: string, text: string): string[] {
>   const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, "gs");
>   const matches = text.matchAll(regex);
>   return Array.from(matches).map(m => m[1].trim());
> }
> ```

**Failure Modes of this Regex Parser:**
1. **OOM Heap Exhaustion:** `parseAllTags("person", xmlText)` calls `text.matchAll()` across multi-megabyte string payloads, loading entire tag structures and capture arrays into memory simultaneously. On a large dataset, V8 string allocations cause memory spikes leading to heap exhaustion (`ERR_STRING_TOO_LONG` or process crashes).
2. **Regex Catastrophic Backtracking & Nesting Inability:** If an XML element contains internal markup, attributes, CDATA blocks, or identical child tag names, non-greedy capture `(.*?)` matches prematurely or hangs the event loop.
3. **Exclusion of Binary Assets:** The XML format only stores database scalar fields. Uploaded images in `uploads/` or S3 photo stores are omitted. Restoring a backup on a new server results in broken image links.

### 3.3 Database Restoration Disaster Risks ([task-worker.ts:840-1667](file:///c:/Repos/PRM/server/task-worker.ts#L840-L1667))

```
+-------------------------------------------------------------------------------------------------+
|                                 RESTORE WORKFLOW EXECUTION                                       |
+-------------------------------------------------------------------------------------------------+
| 1. Read entire XML file synchronously into memory string (fs.readFileSync)                      |
| 2. Import Relationship Types (db.insert().onConflictDoNothing())       [NO TRANSACTION]         |
| 3. Import Interaction Types (db.insert().onConflictDoNothing())        [NO TRANSACTION]         |
| 4. Import Photos metadata (db.insert().onConflictDoNothing())           [NO TRANSACTION]         |
| 5. Import People records (storage.createPersonWithId())                 [NO TRANSACTION]         |
| 6. Import Groups & Relationships                                        [NO TRANSACTION]         |
|    ... [CRASH / UNHANDLED ERROR OCCURS AT STEP 7] ...                                           |
| -> DATABASE CORRUPTED: Steps 1-6 committed permanently; Steps 7-23 missing; Zero Rollback!      |
+-------------------------------------------------------------------------------------------------+
```

1. **Absence of Atomic Transactions:**
   Every single table insertion in `processImportXmlTask` runs as an isolated SQL statement. There is no `await db.transaction(async (tx) => { ... })` wrapper. If an error occurs midway (e.g., malformed foreign key reference, server crash, out of disk space), the database remains in an incomplete, partially migrated state.
2. **Cancellation Ignored During Execution:**
   In [task-worker.ts:840-1667](file:///c:/Repos/PRM/server/task-worker.ts#L840-L1667), despite `isTaskCancelled()` existing in the file, `processImportXmlTask` **never calls `isTaskCancelled()`** anywhere inside its execution loop! If a user cancels the task in the UI, the worker continues parsing XML tags and writing rows to the database. Only when the entire import has finished ([task-worker.ts:3681](file:///c:/Repos/PRM/server/task-worker.ts#L3681)) does the outer loop check if the task was cancelled!
3. **Synchronous File Operations Blocking Event Loop:**
   In [backups.ts:48-61, 120, 153, 196](file:///c:/Repos/PRM/server/routes/backups.ts#L48-L61), file management calls use synchronous APIs (`fs.readdirSync`, `fs.statSync`, `fs.writeFileSync`, `fs.unlinkSync`, `fs.renameSync`). On shared disks or large backup directories, these operations block the Node.js event loop, delaying all incoming HTTP requests.

---

## 4. Background Task Worker Engine Core

### 4.1 Architecture & Scheduling Model
The background task system is split into two internal workers:
- **General Worker (`runWorkerLoop` at [task-worker.ts:3697](file:///c:/Repos/PRM/server/task-worker.ts#L3697)):** Handles crowds, group discovery, image transfers, social imports, and XML backup export/import.
- **Image Worker (`runImageTaskWorkerLoop` at [task-worker.ts:218](file:///c:/Repos/PRM/server/task-worker.ts#L218)):** Handles downloading Instagram profile images, face recognition, and conversions.

```
+-----------------------------------------------------------------------------+
|                     TASK WORKER CONCURRENCY BOTTLENECK                      |
+-----------------------------------------------------------------------------+
|                                                                             |
|   +---------------------------------------------------------------------+   |
|   | Global Flag: isProcessing = true                                    |   |
|   +---------------------------------------------------------------------+   |
|                                      |                                      |
|                                      v                                      |
|   [Task 1: export_xml (5 mins)] ------------> [Task 2: refresh_follower]    |
|   (Single-threaded execution)                 (BLOCKED IN QUEUE)            |
|                                                                             |
|   +---------------------------------------------------------------------+   |
|   | Image Worker Loop: Sequential Processing                            |   |
|   +---------------------------------------------------------------------+   |
|   Img 1 -> [Sleep 1000ms] -> Img 2 -> [Sleep 1000ms] -> Img 3 ...          |
|   (Zero concurrency; 500 images = 500+ seconds minimum processing time)     |
+-----------------------------------------------------------------------------+
```

### 4.2 Critical Architectural Flaws

#### 1. In-Process Single-Threaded Worker Execution
Both workers run in the same process as the Express web server.
- The `isProcessing` flag is a single process-wide boolean ([task-worker.ts:82](file:///c:/Repos/PRM/server/task-worker.ts#L82)).
- **Sequential Blockade:** Only **one** general task can execute at any time across the entire system. If an admin initiates an XML backup export or import that takes 3 minutes, every other task (social sync, group clustering, image migration) is completely blocked behind it.
- **Artificial Image Delay:** Image processing enforces an artificial `1000ms` sleep between tasks (`IMAGE_DOWNLOAD_DELAY_MS = 1_000` at [task-worker.ts:79, 226](file:///c:/Repos/PRM/server/task-worker.ts#L79)). Downloading 1,000 images requires over 16 minutes of serialized execution with zero concurrent worker pooling.

#### 2. Polling Storm Overhead vs. Underutilized SSE
The frontend has no WebSocket or Server-Sent Event integration for background tasks. Instead, multiple independent components poll task endpoints simultaneously:

| Component | Polling Endpoint | Polling Interval | Active Condition |
| :--- | :--- | :--- | :--- |
| **`App.tsx`** (`useExportNotifier`) | `/api/tasks/current` | **4,000 ms** | Always active when logged in |
| **`TaskTrackerModal.tsx`** | `/api/tasks/current` | **2,500 ms / 10,000 ms** | Active tasks vs. idle |
| **`TaskTrackerModal.tsx`** | `/api/image-tasks/current` | **2,500 ms / 10,000 ms** | Active tasks vs. idle |
| **`backups-page.tsx`** | `/api/tasks/:id` | **1,500 ms** | During active export/restore |
| **`tasks-settings.tsx`** | `/api/tasks/current` | **2,500 ms** | Active tasks |
| **`tasks-settings.tsx`** | `/api/tasks/worker-status`| **5,000 ms** | Always active on page |
| **`task-detail.tsx`** | `/api/tasks/:id` | **3,000 ms** | While task is active |
| **`task-detail.tsx`** | `/api/image-tasks?parentTaskId` | **3,000 ms** | While sub-tasks are active |

> [!IMPORTANT]
> A user visiting the Tasks Settings page while a backup is running generates **up to 6 separate HTTP polling requests every 3 seconds** across a single browser tab.
> In [task-worker.ts:32](file:///c:/Repos/PRM/server/task-worker.ts#L32), the application imports `sseManager` from `./middleware/sse`, yet task progress updates (`updateTaskProgress`) never broadcast task events over SSE.

#### 3. Fault Recovery and Server Restarts ([task-worker.ts:3724-3735](file:///c:/Repos/PRM/server/task-worker.ts#L3724-L3735))
```typescript
async function recoverStaleTasksOnStartup(): Promise<void> {
  try {
    await db.update(tasks)
      .set({ status: "failed", result: "Interrupted by server restart" })
      .where(eq(tasks.status, "in_progress"));
    ...
```
- On server restart, all `in_progress` tasks are marked `failed`.
- There is no idempotency key, checkpointing, or automatic retry mechanism.
- If a database restore task is marked failed after writing 50% of the XML records, the database remains in that partial state with no automated rollback or recovery.

---

## 5. The Good, The Bad, and The Ugly

### The Good
*Things that are well-designed, functional, and performant.*

- **Interactive Search Categories & Custom Ordering ([search-settings.tsx:79-179](file:///c:/Repos/PRM/client/src/pages/search-settings.tsx#L79-L179)):** The draggable list UI allows users to easily toggle categories on/off and reorder search precedence. Preferences sync instantly across tabs and windows using custom DOM events (`searchPreferencesChanged`).
- **UUID Fast-Path Lookup ([global-search.tsx:29-31](file:///c:/Repos/PRM/client/src/components/global-search.tsx#L29-L31)):** Instant pattern matching against standard UUIDs bypasses multi-category text search and resolves entity routing in `O(1)` time.
- **Comprehensive XML Backup Schema ([task-worker.ts:423-815](file:///c:/Repos/PRM/server/task-worker.ts#L423-L815)):** The export format serializes the entire relational database graph—including family lineages, partnerships, interactions, daily notes with audit logs, AI chats, and app settings.
- **Security-Minded File Sanitization ([backups.ts:17-26](file:///c:/Repos/PRM/server/routes/backups.ts#L17-L26)):** Filename cleaning removes invalid characters and rejects directory traversal payloads (`../`).
- **Comprehensive Task UI & Visibility ([task-tracker-modal.tsx](file:///c:/Repos/PRM/client/src/components/task-tracker-modal.tsx), [task-detail.tsx](file:///c:/Repos/PRM/client/src/pages/task-detail.tsx)):** Floating real-time task tracker with minimize/expand modes, sub-task breakdowns, and individual cancellation buttons.
- **Worker Recovery on Startup ([task-worker.ts:3724-3735](file:///c:/Repos/PRM/server/task-worker.ts#L3724-L3735)):** Prevents orphaned zombie tasks by marking interrupted jobs as failed upon server boot.

---

### The Bad
*Architectural compromises, code smell, and performance degradation.*

- **Un-debounced Typing Dispatches ([global-search.tsx:46-49](file:///c:/Repos/PRM/client/src/components/global-search.tsx#L46-L49)):** Keystrokes immediately trigger network requests. Rapid typing spawns redundant queries that compete for backend database connections.
- **Severe Client-Side Polling Thunderstorm ([App.tsx:83](file:///c:/Repos/PRM/client/src/App.tsx#L83), [backups-page.tsx:181](file:///c:/Repos/PRM/client/src/pages/backups-page.tsx#L181)):** Up to 6 concurrent polling timers fire every 1.5–4.0 seconds, bombarding the API with status requests while an existing SSE manager sits unused.
- **Broken Code Splitting in App Shell ([App.tsx:27](file:///c:/Repos/PRM/client/src/App.tsx#L27)):** Static import of `SettingsSidebar` pulls `@/pages/settings-layout` into the primary bundle, neutralizing route-level lazy loading.
- **Pre-Mounted Root Dialog Overhead ([App.tsx:321-330](file:///c:/Repos/PRM/client/src/App.tsx#L321-L330)):** 8 modal dialogs are mounted at the root on initial render, bloating memory and initial DOM size.
- **Exclusion of Binary Assets in Backups:** XML backups only store scalar metadata and image URLs. They do not package local photos from the `uploads/` directory, preventing true offline recovery.
- **Sequential Image Downloads ([task-worker.ts:226](file:///c:/Repos/PRM/server/task-worker.ts#L226)):** Artificial 1,000ms delay between image tasks prevents parallel batching and slows queue draining.

---

### The Ugly
*Critical architectural risks, security hazards, and fatal flaws.*

- **Non-Transactional Database Restore Corrupts State ([task-worker.ts:840-1667](file:///c:/Repos/PRM/server/task-worker.ts#L840-L1667)):** Restores execute thousands of separate, un-isolated Drizzle database inserts across 23 different tables without wrapping them inside a SQL transaction (`db.transaction()`). An unhandled error, database constraint violation, or server restart leaves the database permanently corrupted with orphaned records and broken relationships.
- **Cancellation Completely Ignored in Longest Tasks ([task-worker.ts:840-1667, 321-836](file:///c:/Repos/PRM/server/task-worker.ts#L840-L1667)):** Neither `processExportXmlTask` nor `processImportXmlTask` checks `isTaskCancelled()` during execution. A user clicking "Cancel" in the UI does nothing until the entire multi-minute process finishes.
- **Manual Regex XML Parser Risks Heap OOM ([xml-utils.ts:31-43](file:///c:/Repos/PRM/server/xml-utils.ts#L31-L43)):** Parsing XML via `new RegExp(..., "gs")` and `text.matchAll()` across large backups leads to catastrophic backtracking or V8 heap crashes, taking down the entire web server.
- **In-Process Single-Threaded Task Worker Bottleneck ([task-worker.ts:3697-3715](file:///c:/Repos/PRM/server/task-worker.ts#L3697-L3715)):** Background tasks execute within the main Node.js event loop. A single CPU-heavy or I/O-heavy task locks HTTP request processing for all active users.
- **Wildcard Full Table Scans on Keystrokes ([storage.ts:4223-4300](file:///c:/Repos/PRM/server/storage.ts#L4223-L4300)):** Leading wildcards (`ILIKE '%...%'`) across 7 tables without B-Tree index support force sequential scans across the database on every character typed in global search.

---

## 6. Comprehensive Findings & Citations

```
+---------------------------------------------------------------------------------------------------------------------------------+
| FILE & LINES                                 | CATEGORY   | SEVERITY | DESCRIPTION                                              |
+----------------------------------------------+------------+----------+----------------------------------------------------------+
| server/task-worker.ts:840-1667               | Reliability| CRITICAL | Restore operations run without db.transaction() rollback |
| server/task-worker.ts:840-1667, 321-836     | Logic      | HIGH     | Export and Restore loops never check isTaskCancelled()   |
| server/task-worker.ts:3697-3715              | Architecture| HIGH    | Single-threaded in-process worker blocks API execution   |
| server/xml-utils.ts:31-43                    | Stability  | HIGH     | Regex-based XML parsing causes OOM heap exhaustion       |
| server/storage.ts:4223-4300                  | Performance| HIGH     | 7 parallel ILIKE wildcard table scans on keystrokes      |
| client/src/components/global-search.tsx:46   | Performance| MEDIUM   | Zero debounce on global search input                     |
| client/src/App.tsx:83                        | Performance| MEDIUM   | useExportNotifier polls /api/tasks/current every 4000ms  |
| client/src/App.tsx:27                        | Performance| MEDIUM   | Static SettingsSidebar import breaks lazy loading chunk  |
| client/src/App.tsx:321-330                   | Performance| MEDIUM   | 8 heavy dialog modals pre-mounted at application root    |
| server/routes/backups.ts:48-61, 120, 153     | Performance| MEDIUM   | Synchronous fs.* operations block Express event loop     |
| client/src/components/task-tracker-modal.tsx | Performance| MEDIUM   | Polling /api/tasks and /api/image-tasks every 2500ms     |
+---------------------------------------------------------------------------------------------------------------------------------+
```

---

## 7. Actionable Recommendations & Remediation Plan

### Phase 1: Immediate Critical Fixes (Within 48 Hours)

1. **Wrap XML Database Restores in Atomic Transactions:**
   In [server/task-worker.ts:840](file:///c:/Repos/PRM/server/task-worker.ts#L840), wrap all restoration logic within `db.transaction()`:
   ```typescript
   await db.transaction(async (tx) => {
     // Perform all table insertions using tx instead of db
     // If any step throws an error, the transaction rolls back cleanly
   });
   ```
2. **Add Cancellation Checks to Export and Restore Loops:**
   In [server/task-worker.ts:840-1667](file:///c:/Repos/PRM/server/task-worker.ts#L840-L1667) and [task-worker.ts:321-836](file:///c:/Repos/PRM/server/task-worker.ts#L321-L836), check `await isTaskCancelled(taskId)` periodically:
   ```typescript
   if (await isTaskCancelled(taskId)) {
     throw new Error("Task cancelled by user");
   }
   ```
3. **Debounce Global Search Input:**
   In [client/src/components/global-search.tsx:398](file:///c:/Repos/PRM/client/src/components/global-search.tsx#L398), introduce a 300ms debounce hook (e.g., `useDebounce(searchQuery, 300)`) before querying `/api/mega-search`.
4. **Fix Static Import Leak in `App.tsx`:**
   In [client/src/App.tsx:27](file:///c:/Repos/PRM/client/src/App.tsx#L27), remove `import { SettingsSidebar } from "@/pages/settings-layout";`. Move `SettingsSidebar` into its own isolated component file (`client/src/components/settings-sidebar.tsx`) so importing it does not pull in the entire lazy-loaded `SettingsLayout`.

### Phase 2: Architectural Performance Upgrades (Next Sprint)

1. **Replace Polling Storm with Server-Sent Events (SSE):**
   Connect `useExportNotifier`, `TaskTrackerModal`, and `BackupsPage` to `sseManager` ([server/middleware/sse.ts](file:///c:/Repos/PRM/server/middleware/sse.ts)). Broadcast `task.progress` and `task.completed` events from `updateTaskProgress()` and `updateTaskStatus()`, completely eliminating interval-based HTTP polling.
2. **Adopt a Robust Streaming XML Parser:**
   Replace the regex parser in [server/xml-utils.ts](file:///c:/Repos/PRM/server/xml-utils.ts) with `fast-xml-parser` or `sax`. Stream large XML files directly from disk instead of reading them into a single string via `fs.readFileSync()`.
3. **Lazy-Load Root Dialogs:**
   Convert the 8 modal dialogs in [client/src/App.tsx:321-330](file:///c:/Repos/PRM/client/src/App.tsx#L321-L330) to conditionally mounted, lazy-loaded components that only render when their respective state flags are true.
4. **Add PostgreSQL Trigram Indexes for Search:**
   Add `pg_trgm` GIN indexes to searchable text columns:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX idx_people_names_trgm ON people USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
   CREATE INDEX idx_people_company_trgm ON people USING gin (company gin_trgm_ops);
   ```

### Phase 3: Long-term Reliability & Scaling (Roadmap)

1. **Decouple Task Worker into Worker Threads / Dedicated Service:**
   Migrate background task execution from the main Express process into Node.js `worker_threads` or an independent process using Redis/BullMQ. This isolates heavy workloads from the web server and prevents event loop starvation.
2. **True Full System Backups (ZIP Archives with Media):**
   Update the backup system to package both the database XML file and the physical `uploads/` directory into a `.zip` archive using streaming compression (`archiver`), ensuring complete portability across environments.
