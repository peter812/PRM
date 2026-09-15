# Technical Code Audit: Server Core, Storage Layer, Authentication & Middleware

**Audit Target:** Personal Relationship Management (PRM) Platform  
**Target Scope:** `server/index.ts`, `server/auth.ts`, `server/access.ts`, `server/storage.ts`, `server/s3.ts`, `server/local-storage.ts`, `server/profile-image.ts`, `server/middleware/*`  
**Exclusions:** Social Media Scraper Infrastructure  
**Author:** Senior Backend & Security Auditor  
**Date:** August 29, 2026  

---

## Executive Summary

The PRM platform backend is built on Express, Drizzle ORM, PostgreSQL (`node-pg`), and Passport.js. The system has undergone a partial architectural migration from a single-user system toward a multi-tenant / multi-user platform via `AsyncLocalStorage` ambient access contexts ([`server/access.ts`](file:///c:/Repos/PRM/server/access.ts)).

However, this audit revealed **critical architectural liabilities, severe multi-tenant data isolation leaks (BOLA/IDOR), catastrophic disaster recovery risks, and denial-of-service vulnerabilities**. Most prominently:
1. **Catastrophic Database Auto-Wipe Risk:** A transient network glitch or connection timeout during startup queries in [`server/db-init.ts`](file:///c:/Repos/PRM/server/db-init.ts#L160-L173) triggers `dropAllTables()` executing `DROP TABLE ... CASCADE`, instantly obliterating all production data.
2. **Massive God Object Storage Engine:** [`server/storage.ts`](file:///c:/Repos/PRM/server/storage.ts) is a 207 KB, 5,638-line monolithic monster implementing ~150 domain methods spanning 40+ database tables.
3. **Absence of Transactions:** In 5,638 lines of storage logic, **only one single transaction** exists ([`createMessage` at line 5316](file:///c:/Repos/PRM/server/storage.ts#L5316)). Every other complex multi-table mutation (e.g., cascade deletions, daily note event replacements, social account merges) runs un-transactioned, risking severe data corruption on partial failures.
4. **Cross-Tenant Data Leaks (BOLA/IDOR):** Core search and graph features ([`megaSearch`](file:///c:/Repos/PRM/server/storage.ts#L4201-L4330), [`getGraphData`](file:///c:/Repos/PRM/server/storage.ts#L690-L722), [`getPersonGraph`](file:///c:/Repos/PRM/server/storage.ts#L778-L825)) completely lack access control predicates, allowing any logged-in user to query and read all private notes, daily notes, contacts, and AI chats across every user in the database.
5. **Denial-of-Service / Memory Exhaustion (OOM):** A global `100mb` body-parser limit with raw buffer caching ([`server/index.ts`](file:///c:/Repos/PRM/server/index.ts#L38-L44)), combined with an unbounded `scrypt` fallback loop on public endpoints ([`server/auth.ts`](file:///c:/Repos/PRM/server/auth.ts#L162-L180)), allows trivial memory and CPU exhaustion.
6. **Inverted Middleware Order:** Rate limiting is executed *before* authentication session hydration, permanently disabling user-based rate limiting and subjecting all shared-IP users to an aggressive 100 req/min lockout.

---

## 1. The Good: Architectural Highlights & Sound Practices

Despite severe systemic issues, several modern security paradigms and robust engineering patterns are present in the codebase:

### 1.1 Robust SSRF Defense in Profile Image Ingestion
[`server/profile-image.ts`](file:///c:/Repos/PRM/server/profile-image.ts#L75-L156) demonstrates exemplary defense-in-depth against Server-Side Request Forgery (SSRF):
- **Host Regex Allowlist:** Strictly restricts outbound HTTP targets to known CDN endpoints ([`ALLOW_IMAGE_HOSTS`](file:///c:/Repos/PRM/server/profile-image.ts#L87)): `/\.cdninstagram\.com$/i` and `/\.fbcdn\.net$/i`.
- **Protocol Enforcement:** Rejects non-HTTPS schemes ([`profile-image.ts:L114`](file:///c:/Repos/PRM/server/profile-image.ts#L114)).
- **Pre-Flight DNS Resolution & RFC 1918 / Cloud Metadata Blocking:** Resolves DNS via `dns.lookup(url.hostname, { all: true })` and inspects resolved addresses with [`isPrivateAddress`](file:///c:/Repos/PRM/server/profile-image.ts#L97-L109), blocking private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, loopback 127.0.0.0/8, link-local 169.254.169.254 AWS metadata, Carrier-Grade NAT 100.64.0.0/10) and IPv6 equivalents.
- **Manual Redirect Traversal:** Redirects are manually inspected up to 3 hops ([`MAX_REDIRECTS`](file:///c:/Repos/PRM/server/profile-image.ts#L95)), ensuring attackers cannot bypass domain validation by redirecting to internal IP addresses.
- **Stream Throttling:** Body reads are capped at 8 MB ([`readCapped`](file:///c:/Repos/PRM/server/profile-image.ts#L134-L155)) via a chunked reader that aborts mid-stream if size exceeds the threshold, preventing decompression bombs and infinite stream memory exhaustion.
- **In-Memory Magic Byte Parsing:** Binary headers for PNG, JPEG, and WebP ([`getImageDimensions`](file:///c:/Repos/PRM/server/profile-image.ts#L25-L63)) are parsed via lightweight byte-offset arithmetic without shelling out or loading heavy native C++ image binaries.

### 1.2 Fail-Closed Multi-Tenant Ambient Context Design
[`server/access.ts`](file:///c:/Repos/PRM/server/access.ts#L27-L68) leverages Node.js `AsyncLocalStorage` to thread user context across the call stack without altering hundreds of legacy function signatures:
- **Fails Closed:** `requireAccess()` throws `AccessContextMissingError` ([`access.ts:L64-L68`](file:///c:/Repos/PRM/server/access.ts#L64-L68)) if a predicate is invoked outside an active context, rather than silently returning unfiltered records.
- **Explicit System Elevation:** Background processes (task queues, migrations) must explicitly declare themselves via [`runAsSystem()`](file:///c:/Repos/PRM/server/access.ts#L116-L118).
- **In-Memory and SQL Parity:** Provides complementary SQL expressions (`visibleShared`, `ownedByCurrentUser`) and in-memory predicates (`canReadShared`, `canReadOwned`).

### 1.3 Secure Password & Session Architecture
- **Cryptographic Hashing:** Uses `scrypt` with a 16-byte cryptographically secure random salt ([`hashPassword`](file:///c:/Repos/PRM/server/auth.ts#L35-L39)).
- **Constant-Time Verification:** [`comparePasswords`](file:///c:/Repos/PRM/server/auth.ts#L41-L53) splits salt and hash, generating the test buffer and using `crypto.timingSafeEqual` to prevent timing attacks.
- **PostgreSQL-Backed Session Store:** Uses `connect-pg-simple` with connection pooling ([`storage.ts:L677`](file:///c:/Repos/PRM/server/storage.ts#L677)), ensuring sessions survive server restarts and scale beyond single-process memory.
- **Hardened Session Cookies:** Configured with `httpOnly: true`, `sameSite: "lax"`, and `secure: process.env.NODE_ENV === "production"` ([`auth.ts:L62-L67`](file:///c:/Repos/PRM/server/auth.ts#L62-L67)).
- **Safe Serialization:** Strips password hashes before serializing users to JSON via [`publicUser()`](file:///c:/Repos/PRM/server/auth.ts#L19-L31).

### 1.4 Production Guard on Development Auth Bypass
[`server/index.ts:L61-L69`](file:///c:/Repos/PRM/server/index.ts#L61-L69) guards the `DISABLE_AUTH` flag behind an explicit production environment check:
```typescript
if (process.env.DISABLE_AUTH === 'true' && process.env.NODE_ENV !== 'production') { ... }
```
This ensures that a leaked or accidental `DISABLE_AUTH=true` flag in a production deployment will not bypass authentication.

### 1.5 Smart ETag Allowlisting
Rather than applying blanket HTTP 304 caching on all GET routes (which frequently breaks client-side `fetch` wrappers that treat non-2xx responses as exceptions), [`server/middleware/etag-cache.ts`](file:///c:/Repos/PRM/server/middleware/etag-cache.ts#L18-L21) uses an explicit allowlist (`ETAG_GET_PATHS`) with SHA-256 body hashing, `Vary: Cookie, Authorization`, and `Cache-Control: private, no-cache`.

---

## 2. The Bad: Anti-Patterns, Code Smells & Performance Bottlenecks

### 2.1 Catastrophic N+1 Query Explosions in Conversation & Message Feeds
The conversation storage methods demonstrate severe query multiplication:
- **`getConversationsPaginated`** ([`server/storage.ts:L5204-L5249`](file:///c:/Repos/PRM/server/storage.ts#L5204-L5249)): For each conversation in a paginated page (e.g., 20 conversations):
  1. Fetches participants (`conversationParticipants`) (1 query).
  2. For every participant, issues individual `SELECT` queries against `people` and `socialAccounts` (2 queries per participant).
  3. Issues a separate query for the last message (`messages ... LIMIT 1`) (1 query).
  4. Issues a separate query for the message count (`count(*) FROM messages`) (1 query).
  *Formula:* $1 + N \times (1 + P \times 2 + 1 + 1)$. For 20 conversations with 3 participants each, a single page request triggers **181 separate database queries**!
- **`getMessagesByConversation`** ([`server/storage.ts:L5361-L5400`](file:///c:/Repos/PRM/server/storage.ts#L5361-L5400)): For every message returned:
  1. `SELECT * FROM people WHERE id = msg.senderPersonId`
  2. `SELECT * FROM socialAccounts WHERE id = msg.senderSocialAccountId`
  3. `SELECT * FROM messageRecipients WHERE messageId = msg.id`
  4. For each recipient: separate queries against `people` and `socialAccounts`.
  *Impact:* Requesting 50 messages executes **over 250 sequential SQL round-trips**, crushing database connection pools and inflating latency.

### 2.2 Unbounded In-Memory Table Scans & Deletion Cascades
Instead of executing targeted SQL operations or relying on database foreign key cascades:
- **Full Group Table Scans on Person Deletion** ([`server/storage.ts:L1233-L1241`](file:///c:/Repos/PRM/server/storage.ts#L1233-L1241)):
  ```typescript
  const allGroups = await db.select().from(groups);
  for (const group of allGroups) {
    if (group.members && group.members.includes(id)) {
      const updatedMembers = group.members.filter((memberId) => memberId !== id);
      await db.update(groups).set({ members: updatedMembers }).where(eq(groups.id, group.id));
    }
  }
  ```
  Every time a contact is deleted, the server pulls *every group in the database* into memory and issues sequential `UPDATE` queries.
- **Full People Table Scans on Social Account Deletion** ([`server/storage.ts:L3383-L3391`](file:///c:/Repos/PRM/server/storage.ts#L3383-L3391)):
  Pulls *every person row in the database* into memory (`SELECT * FROM people`) to filter `socialAccountUuids` in JavaScript and issue row-by-row updates.

### 2.3 Blocking Synchronous File I/O in Storage Handlers
In [`server/local-storage.ts`](file:///c:/Repos/PRM/server/local-storage.ts#L32):
```typescript
fs.writeFileSync(filePath, buffer); // Line 32
fs.unlinkSync(filePath);           // Line 46
fs.writeFileSync(filePath, buffer); // Line 97 (Media upload)
```
Node.js is single-threaded. Using `fs.writeFileSync` and `fs.unlinkSync` for files up to 50 MB - 100 MB freezes the entire event loop during disk I/O, stalling all concurrent HTTP requests and websocket/SSE connections. It should use `fs.promises.writeFile` and `fs.promises.unlink`.

### 2.4 Duplicate Logic Across Storage Modules
Validation arrays are duplicated verbatim between cloud and local drivers:
- `SAFE_EXTENSIONS` & `SAFE_MIMETYPES` defined in [`server/s3.ts:L21-L22`](file:///c:/Repos/PRM/server/s3.ts#L21-L22) and duplicated in [`server/local-storage.ts:L11-L12`](file:///c:/Repos/PRM/server/local-storage.ts#L11-L12).
- `SAFE_MEDIA_EXTENSIONS` & `SAFE_MEDIA_MIMETYPES` defined in [`server/s3.ts:L65-L75`](file:///c:/Repos/PRM/server/s3.ts#L65-L75) and duplicated in [`server/local-storage.ts:L67-L77`](file:///c:/Repos/PRM/server/local-storage.ts#L67-L77).
- These MIME and extension sets are not shared or synchronized, creating drift risks when new media formats are supported.

### 2.5 Inverted Middleware Order Disables User-Based Rate Limiting
In [`server/index.ts`](file:///c:/Repos/PRM/server/index.ts#L50-L56):
```typescript
// Line 50: Rate limiting middleware mounted
app.use(rateLimitMiddleware);

// Line 53: ETag middleware mounted
app.use(etagMiddleware);

// Line 56: Auth setup mounted (session & passport initialized)
setupAuth(app);
```
Look at [`server/middleware/rate-limit.ts:L15-L19`](file:///c:/Repos/PRM/server/middleware/rate-limit.ts#L15-L19):
```typescript
function getClientKey(req: Request): string {
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated() && req.user) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}
```
Because `rateLimitMiddleware` executes **before** `setupAuth`, `req.isAuthenticated` is *always undefined* when rate limiting runs.
**Result:**
1. Rate limiting **never keys off user ID**. Every authenticated request is keyed off IP.
2. The limit is hardcoded to 100 requests per minute across the entire `/api` path. In an office, corporate network, or mobile carrier NAT where multiple users share a public IP, 2-3 users opening the PRM web app (which loads 20-30 resources on initial render) will instantly exhaust the 100 req/min quota, locking out everyone on that IP with HTTP 429.

### 2.6 In-Memory Rate Limiting Architecture Flaws
- **State Loss & Cluster Incompatibility:** `rateLimitStore` is an in-memory JavaScript `Map`. If the application is restarted or deployed in cluster mode (e.g. PM2, Kubernetes, or multi-core containers), rate limits are reset or inconsistently enforced per node.
- **Unbounded Memory Spikes:** While a periodic cleanup runs every 60 seconds ([`rate-limit.ts:L22-L31`](file:///c:/Repos/PRM/server/middleware/rate-limit.ts#L22-L31)), an IP-spoofed volumetric flood can inject millions of unique keys within a 60-second window, causing memory exhaustion before the interval fires.

### 2.7 Sensitive Error Details Leaked to Clients
In [`server/index.ts:L132-L153`](file:///c:/Repos/PRM/server/index.ts#L132-L153):
```typescript
const message = err.message || "Internal Server Error";
...
res.status(status).json({
  error: {
    code: status === 404 ? "NOT_FOUND" : status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
    message, // <--- RAW ERROR MESSAGE SENT TO CLIENT
    details: {},
    request_id: requestId,
  },
});
```
If an unhandled exception or SQL query syntax/constraint failure occurs (e.g., PostgreSQL foreign key errors, column names, connection string hints), `err.message` is returned directly to the browser, exposing internal database schemas and server internals to unauthenticated or unauthorized users.

### 2.8 Unvalidated X-Request-ID Header Reflection
In [`server/middleware/request-id.ts:L14-L21`](file:///c:/Repos/PRM/server/middleware/request-id.ts#L14-L21):
```typescript
const requestId = (req.headers["x-request-id"] as string) ||
  `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

(req as any).requestId = requestId;
res.setHeader("X-Request-ID", requestId);
```
Arbitrary client-supplied `X-Request-ID` headers are accepted without regex validation, length truncation, or character sanitization. While modern Node.js prevents CRLF injection in `res.setHeader`, an attacker can pass megabyte-long strings or control characters that pollute server log files and log aggregators.

---

## 3. The Ugly: Architectural Disasters, Vulnerabilities & Race Conditions

### 3.1 Catastrophic Startup Flaw: Automatic Database Drop on Error
In [`server/db-init.ts`](file:///c:/Repos/PRM/server/db-init.ts#L160-L173) and [`L1311-L1332`](file:///c:/Repos/PRM/server/db-init.ts#L1311-L1332):
```typescript
async function hasUsers(): Promise<boolean> {
  try {
    const result = await pool.query(`
      SELECT EXISTS(SELECT 1 FROM users LIMIT 1) as has_users
    `);
    return result.rows[0]?.has_users || false;
  } catch (error) {
    // If the query fails, it likely means the users table doesn't exist
    return false;
  }
}

export async function initializeDatabase(): Promise<void> {
  const usersExist = await hasUsers();
  if (!usersExist) {
    log("No users found in database. Resetting database...");
    await dropAllTables(); // <--- EXECUTES DROP TABLE CASCADE ON ALL TABLES!
    await runMigrations();
    ...
```
```typescript
// Line 27 in dropAllTables():
const dropQuery = `DROP TABLE IF EXISTS ${tables.map(t => `"${t}"`).join(', ')} CASCADE`;
await pool.query(dropQuery);
```
> [!CAUTION]
> **CRITICAL DATA LOSS HAZARD:**  
> If the PostgreSQL database has high load, a brief network hiccup, a lock contention timeout, or an SSL negotiation glitch during startup, `hasUsers()` catches the error and **silently returns `false`**.  
> The server assumes the database is brand new and **DROPS EVERY TABLE IN PRODUCTION WITH CASCADE**, irreversibly purging all users, notes, contacts, messages, and history!

### 3.2 The 207 KB God Object Storage Engine & Total Absence of Transactions
[`server/storage.ts`](file:///c:/Repos/PRM/server/storage.ts) is 5,638 lines and 207,065 bytes.
- **God Object Anti-Pattern:** The single `DatabaseStorage` class manages CRM core (people, notes, groups, interactions), social graph, lineage/partnerships, schooling, daily notes, image tasks, facial recognition, vector synchronization, and message threads.
- **Missing Transactions:** Despite executing hundreds of complex multi-table mutations, **only a single method in the entire 5,638-line file uses `db.transaction()`** ([`createMessage` at line 5316](file:///c:/Repos/PRM/server/storage.ts#L5316)).
- **Partial Failure & Corrupted State Examples:**
  - `deletePerson` ([`storage.ts:L1228-L1246`](file:///c:/Repos/PRM/server/storage.ts#L1228-L1246)): Modifies interactions, iterates over groups updating arrays, and finally deletes the person. If an error occurs halfway, group memberships are updated, interactions are partially purged, and the person remains intact.
  - `replaceDailyNoteEvents` ([`storage.ts:L4839-L4844`](file:///c:/Repos/PRM/server/storage.ts#L4839-L4844)):
    ```typescript
    await db.delete(dailyNoteEvents).where(eq(dailyNoteEvents.dailyNoteId, dailyNoteId));
    const inserted = await db.insert(dailyNoteEvents).values(...).returning();
    ```
    If the `insert` fails (e.g. validation error or constraint violation), the `delete` has already committed. The user's note events are **permanently wiped without recovery**.

### 3.3 Critical Multi-Tenant Authorization Leaks (BOLA / IDOR)
The multi-user migration in `server/access.ts` was not comprehensively applied across `server/storage.ts`. As a result, critical APIs expose private data across users:

#### A. Global Data Exposure in `megaSearch`
In [`server/storage.ts:L4201-L4330`](file:///c:/Repos/PRM/server/storage.ts#L4201-L4330):
```typescript
// Searching people: NO visibleShared!
db.select().from(people).where(or(ilike(people.firstName, searchPattern), ...))

// Searching notes: NO ownedByCurrentUser!
db.select().from(notes).where(ilike(notes.content, searchPattern))

// Searching daily notes: NO ownedByCurrentUser!
db.select().from(dailyNotes).where(or(ilike(dailyNotes.userTitle, searchPattern), ...))

// Searching chats: NO ownedByCurrentUser!
db.select().from(aiChats).where(ilike(aiChats.title, searchPattern))
```
Every query inside `megaSearch` executes **without access control filters**.  
When any user queries `GET /api/mega-search?q=test`, the response includes confidential notes, personal daily notes, private contacts, and AI chat transcripts belonging to **every other user in the database**.

#### B. Full Graph Exposure in `getGraphData` & `getPersonGraph`
In [`server/storage.ts:L690-L722`](file:///c:/Repos/PRM/server/storage.ts#L690-L722) and [`L778-L825`](file:///c:/Repos/PRM/server/storage.ts#L778-L825):
```typescript
const [peopleData, relationshipsData, groupsData, lineageData, partnershipData] = await Promise.all([
  db.select({ ... }).from(people), // Unfiltered!
  db.select({ ... }).from(relationships)..., // Unfiltered!
  db.select({ ... }).from(groups), // Unfiltered!
  db.select().from(lineage), // Unfiltered!
  db.select().from(partnerships), // Unfiltered!
]);
```
`GET /api/graph` and `GET /api/person-graph` dump the entire graph of all users, private relationships, hidden groups, and family lineages to any authenticated user.

#### C. Unprotected Mutations on Daily Notes
In [`server/storage.ts:L4829-L4851`](file:///c:/Repos/PRM/server/storage.ts#L4829-L4851):
```typescript
async updateDailyNote(id: string, data: Partial<InsertDailyNote>) {
  const [updated] = await db.update(dailyNotes).set({ ...data, updatedAt: new Date() }).where(eq(dailyNotes.id, id)).returning();
  ...
}
async deleteDailyNote(id: string) {
  await db.delete(dailyNotes).where(eq(dailyNotes.id, id));
}
```
Neither `updateDailyNote`, `deleteDailyNote`, `replaceDailyNoteEvents`, nor `replaceDailyNoteParties` verifies `ownedByCurrentUser(dailyNotes.userId)`. Any user who supplies a daily note UUID can overwrite or delete another user's daily journal.

#### D. Global Task Destruction
In [`server/storage.ts:L4499-L4501`](file:///c:/Repos/PRM/server/storage.ts#L4499-L4501):
```typescript
async deleteAllTasks(): Promise<void> {
  await db.delete(tasks);
}
```
Invoking task deletion wipes tasks for all users across the system.

### 3.4 Denial-of-Service via 100MB Body Parser & Memory Duplication
In [`server/index.ts:L38-L44`](file:///c:/Repos/PRM/server/index.ts#L38-L44):
```typescript
app.use(express.json({
  limit: '100mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ limit: '100mb', extended: false }));
```
1. A blanket `100mb` limit is configured for all JSON and URL-encoded requests.
2. The `verify` hook captures the unparsed raw `Buffer` into `req.rawBody`.
3. When a client transmits a 50–100 MB JSON string, Node.js allocates:
   - 100 MB for the raw body Buffer.
   - 100 MB for the stream parsing buffer.
   - 200–400 MB for the parsed V8 JavaScript object tree in `req.body`.
4. Just 2 or 3 concurrent POST requests with large JSON payloads consume >1.5 GB of RAM, triggering an instant Node.js heap `Out of Memory (OOM)` crash.

### 3.5 Computational DoS via Unbounded Scrypt Fallback
In [`server/auth.ts:L152-L185`](file:///c:/Repos/PRM/server/auth.ts#L152-L185):
```typescript
export async function authenticateExtensionToken(token: string): Promise<ExtensionSession | null> {
  ...
  // Fallback and migration for legacy scrypt tokens
  const allSessions = await storage.getAllExtensionSessionsAllUsers();
  for (const s of allSessions) {
    if (s.sessionToken.includes(".")) {
      const [hashed, salt] = s.sessionToken.split(".");
      ...
      const suppliedBuf = (await scryptAsync(token, salt, 64)) as Buffer;
      if (timingSafeEqual(hashedBuf, suppliedBuf)) { ... }
    }
  }
}
```
- Several extension routes (e.g. `/api/v1/pending-imports`, `/api/v1/tps/match`) are explicitly listed in `PUBLIC_API_PATHS` in [`routes/auth-setup.ts:L85-L92`](file:///c:/Repos/PRM/server/routes/auth-setup.ts#L85-L92), meaning they accept requests without browser sessions.
- If an unauthenticated attacker sends random invalid tokens to these endpoints, the server retrieves *all extension sessions in the database* and executes `scryptAsync` once per legacy session.
- Because `scrypt` is intentionally CPU-intensive, a few requests per second will saturate 100% of CPU cores on the host, blocking event loop processing and starving the server of compute.

### 3.6 Unhandled DB Pool Errors & Missing Global Process Guards
1. In [`server/db.ts:L19-L25`](file:///c:/Repos/PRM/server/db.ts#L19-L25), `pool = new Pool({ ... })` is instantiated without registering a `pool.on('error', ...)` listener. Under the `pg` driver, when an idle pooled client experiences a connection drop or TCP timeout, the pool emits an unhandled `error` event.
2. In [`server/index.ts`](file:///c:/Repos/PRM/server/index.ts), there are no process-level event listeners for `uncaughtException` or `unhandledRejection`.
3. An unhandled pool error will immediately crash the Node.js process.
4. Furthermore, [`server/db.ts:L21`](file:///c:/Repos/PRM/server/db.ts#L21) sets `ssl: false` when connecting to a remote external database host, transmitting credentials and sensitive CRM records in plain text over the network.

### 3.7 Concurrency Hazards in Queue Polling & Elo Rating
- **Non-Atomic Task Queue Polling:** [`getNextPendingTask`](file:///c:/Repos/PRM/server/storage.ts#L4378-L4386) and [`getNextPendingImageTask`](file:///c:/Repos/PRM/server/storage.ts#L4652-L4660) execute:
  ```typescript
  const [task] = await db.select().from(tasks).where(eq(tasks.status, "pending")).orderBy(tasks.createdAt).limit(1);
  ```
  This is a classic database queue anti-pattern. If two worker loops or two clustered processes poll concurrently, both select the exact same pending task and process it simultaneously. The PostgreSQL atomic dequeue standard (`FOR UPDATE SKIP LOCKED`) is completely absent.
- **Race Condition in Elo Updates:** [`updateEloScores`](file:///c:/Repos/PRM/server/storage.ts#L1330-L1352) reads both people via simple `SELECT`, computes their new Elo scores in JavaScript, and executes two independent `UPDATE` queries without transactions or locking. If two rating events occur concurrently for the same person, one calculation overwrites the other, corrupting score progression.

### 3.8 Memory Leak & Tenant Bleed in SSE Manager
In [`server/middleware/sse.ts:L10-L38`](file:///c:/Repos/PRM/server/middleware/sse.ts#L10-L38):
```typescript
class SSEManager {
  private clients: SSEClient[] = [];
  ...
  broadcast(event: SSEEventType, data: Record<string, any>): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch {
        // Client may have disconnected; remove on next cleanup
      }
    }
  }
}
```
1. **Memory Leak:** The comment states `"remove on next cleanup"`, but **no cleanup function or timer exists anywhere in the class**. Once a client connection drops without triggering route-level close handlers, the `res` object remains referenced in `this.clients` indefinitely, leaking memory and socket descriptors.
2. **Cross-Tenant Event Leak:** `broadcast()` broadcasts updates unconditionally to every connected SSE client, regardless of user ID or tenant ownership.

### 3.9 Single-User Hardcoding in Profile Image Ingestion
In [`server/profile-image.ts:L250-L255`](file:///c:/Repos/PRM/server/profile-image.ts#L250-L255):
```typescript
const user = (await storage.getAllUsers())[0];
const mode = user ? await storage.getImageStorageMode(user.id) : "s3";
```
When storing profile images, the system queries *all users* in the database and picks index `0` to determine the image storage mode (`local` vs `s3`). In a multi-user environment, user #2's image storage destination is dictated entirely by user #1's configuration!

### 3.10 Insecure Fallback Session Secret
In [`server/auth.ts:L56`](file:///c:/Repos/PRM/server/auth.ts#L56):
```typescript
const sessionSecret = process.env.SESSION_SECRET || "prm-default-session-secret-change-in-prod";
```
If `SESSION_SECRET` is omitted from production environment variables, the server starts silently using a publicly committed default secret, allowing attackers to forge arbitrary session cookies.

---

## 4. Summary Matrix: Severity & Impact

| Category | Finding | Impact | File Location |
| :--- | :--- | :--- | :--- |
| **Ugly** | Automatic DB wipe on startup error | **Total Data Destruction** | [`server/db-init.ts:L163-L173`](file:///c:/Repos/PRM/server/db-init.ts#L163-L173) |
| **Ugly** | Cross-tenant data leak in `megaSearch` | **Confidentiality Breach (BOLA)** | [`server/storage.ts:L4201-L4330`](file:///c:/Repos/PRM/server/storage.ts#L4201-L4330) |
| **Ugly** | Cross-tenant data leak in graph queries | **Confidentiality Breach (BOLA)** | [`server/storage.ts:L690-L722`](file:///c:/Repos/PRM/server/storage.ts#L690-L722) |
| **Ugly** | Daily note IDOR write/delete | **Integrity Violation (IDOR)** | [`server/storage.ts:L4829-L4851`](file:///c:/Repos/PRM/server/storage.ts#L4829-L4851) |
| **Ugly** | Global 100MB JSON body limit + raw buffer | **Denial of Service (OOM)** | [`server/index.ts:L38-L44`](file:///c:/Repos/PRM/server/index.ts#L38-L44) |
| **Ugly** | Legacy scrypt fallback on public routes | **Denial of Service (CPU Exhaustion)** | [`server/auth.ts:L162-L180`](file:///c:/Repos/PRM/server/auth.ts#L162-L180) |
| **Ugly** | Non-atomic task queue polling | **Concurrency Bug / Duplicate Work** | [`server/storage.ts:L4378-L4386`](file:///c:/Repos/PRM/server/storage.ts#L4378-L4386) |
| **Ugly** | Missing `pool.on('error')` | **Process Crash on Socket Timeout** | [`server/db.ts:L19-L25`](file:///c:/Repos/PRM/server/db.ts#L19-L25) |
| **Ugly** | Insecure fallback session secret | **Session Forgery** | [`server/auth.ts:L56`](file:///c:/Repos/PRM/server/auth.ts#L56) |
| **Bad** | N+1 query explosion in messages | **Severe Database Latency** | [`server/storage.ts:L5204-L5249`](file:///c:/Repos/PRM/server/storage.ts#L5204-L5249) |
| **Bad** | Inverted rate-limit / auth middleware order | **Rate Limiter Always Keys Off IP** | [`server/index.ts:L50-L56`](file:///c:/Repos/PRM/server/index.ts#L50-L56) |
| **Bad** | Synchronous file I/O (`writeFileSync`) | **Event Loop Stalling** | [`server/local-storage.ts:L32`](file:///c:/Repos/PRM/server/local-storage.ts#L32) |
| **Bad** | Leaking raw error messages in 500 responses | **Information Disclosure** | [`server/index.ts:L134-L148`](file:///c:/Repos/PRM/server/index.ts#L134-L148) |
| **Bad** | Unbounded SSE clients list | **Memory Leak** | [`server/middleware/sse.ts:L26-L32`](file:///c:/Repos/PRM/server/middleware/sse.ts#L26-L32) |

---

## 5. Prioritized Remediation Plan

### Phase 1: Critical Emergency Fixes (Immediate)
1. **Avert Startup Data Wipe:** In [`server/db-init.ts`](file:///c:/Repos/PRM/server/db-init.ts#L163-L173), remove automatic `dropAllTables()` execution. If `hasUsers()` encounters an error, **throw immediately and abort server startup** rather than assuming the database is blank. Database drops must require explicit CLI flags or manual administrator confirmation.
2. **Mandate Session Secret:** In [`server/auth.ts`](file:///c:/Repos/PRM/server/auth.ts#L56), throw a fatal error on server startup if `process.env.NODE_ENV === "production"` and `process.env.SESSION_SECRET` is not set.
3. **Register DB Pool Error Listener:** Add `pool.on('error', (err) => console.error('Unexpected pg client error', err))` in [`server/db.ts`](file:///c:/Repos/PRM/server/db.ts#L25) to prevent uncaught exceptions from crashing the server.
4. **Scope `megaSearch`, Graphs, and Daily Notes:** Apply `visibleShared` and `ownedByCurrentUser` across all entities in [`megaSearch`](file:///c:/Repos/PRM/server/storage.ts#L4201-L4330), [`getGraphData`](file:///c:/Repos/PRM/server/storage.ts#L690-L722), and daily note mutation handlers.

### Phase 2: DoS & Concurrency Hardening (High Priority)
1. **Reduce Body Parser Limits:** In [`server/index.ts`](file:///c:/Repos/PRM/server/index.ts#L38-L44), reduce the global JSON body limit to `2mb`. Move large upload limits strictly to dedicated multipart / multer routes. Remove global `req.rawBody` buffering unless explicitly required for webhook signature verification.
2. **Fix Middleware Ordering:** Move `rateLimitMiddleware` in [`server/index.ts`](file:///c:/Repos/PRM/server/index.ts#L50) to run **after** `setupAuth` and `accessMiddleware`.
3. **Atomic Queue Dequeuing:** Update `getNextPendingTask` and `getNextPendingImageTask` to use `SELECT ... FOR UPDATE SKIP LOCKED` wrapped in an atomic update query:
   ```sql
   UPDATE tasks
   SET status = 'in_progress', started_at = NOW()
   WHERE id = (
     SELECT id FROM tasks WHERE status = 'pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
   )
   RETURNING *;
   ```
4. **Eliminate Scrypt Iteration Loop:** In [`server/auth.ts`](file:///c:/Repos/PRM/server/auth.ts#L162-L180), deprecate legacy scrypt token fallback or restrict migration to an explicit one-off migration script rather than computing it on every unauthenticated request.

### Phase 3: Architectural Refactoring & Decomposition (Medium Priority)
1. **Deconstruct `server/storage.ts`:** Split the 207 KB monolithic engine into domain repositories:
   - `server/storage/crm-repository.ts` (people, notes, groups, interactions)
   - `server/storage/social-repository.ts` (accounts, posts, follows, network changes)
   - `server/storage/conversation-repository.ts` (conversations, messages, participants)
   - `server/storage/media-repository.ts` (photos, faces, image tasks)
   - `server/storage/system-repository.ts` (users, sessions, settings, api keys)
2. **Eliminate N+1 Queries:** Rewrite `getConversationsPaginated` and `getMessagesByConversation` using SQL `JOIN`s, `LEFT JOIN LATERAL`, or Drizzle relational queries (`db.query.conversations.findMany({ with: { participants: true, lastMessage: true } })`).
3. **Asynchronous File I/O:** Replace all `fs.*Sync` calls in [`server/local-storage.ts`](file:///c:/Repos/PRM/server/local-storage.ts) with `fs.promises.*`.
4. **SSE Channel Isolation:** Refactor [`server/middleware/sse.ts`](file:///c:/Repos/PRM/server/middleware/sse.ts) to manage per-user connection channels, prune disconnected sockets, and enforce tenant isolation on broadcast events.
