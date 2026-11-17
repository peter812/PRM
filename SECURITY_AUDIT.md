# PRM Application Security Audit

**Date:** 2026-11-17  
**Scope:** Application source code across Server Auth/Middleware, Core Data & Storage, Uploads & Face Recognition, AI/MCP/Vector, Social/OSINT/Tracking, Messages/Parsers, Frontend Client, and Production Dependencies. *(Deployment/Docker/infrastructure configuration issues excluded per request.)*

---

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 8 |
| Medium | 18 |
| Low | 17 |

---

## High Severity

### 1. `trust proxy: 1` Enables IP Spoofing to Bypass Rate Limits & 4-Digit Extension Auth Code
- **Locations:** `server/auth.ts:70`, `server/middleware/rate-limit.ts:18` (`getClientKey`), `server/routes/auth-setup.ts:1220, 1240-1259` (`/api/extension-auth/code`, `/api/extension-auth/verify`)
- **Issue:** Express unconditionally trusts 1 proxy hop (`app.set("trust proxy", 1)`). Both `rateLimitMiddleware` and `/api/extension-auth/verify` (`verifyAttempts`) key clients by `req.ip`. An attacker can spoof `X-Forwarded-For` on each request to rotate `req.ip`, bypassing the 5-attempts/minute limit on `/api/extension-auth/verify` and brute-forcing the 4-digit extension code (`1000`–`9999`, 60s TTL) to obtain a valid Chrome extension `sessionToken`.
- **Solution:**
  1. Only set `trust proxy` when explicitly configured via an environment variable (e.g., `TRUST_PROXY`) matching the actual reverse-proxy hop count or CIDR.
  2. Increase extension auth code entropy (e.g., `crypto.randomBytes(6).toString("base64url")` or 8+ alphanumeric characters).
  3. Enforce a global per-code failure counter (e.g., invalidate/delete the code after 5 failed attempts regardless of IP).

### 2. Stored AI Provider Secret Exfiltration via `PATCH /api/ai/providers/:id`
- **Locations:** `server/routes/ai-providers.ts:115-131` (`PATCH /api/ai/providers/:id`), `server/routes/ai-providers.ts:172-196` (`/models`, `/show`), `server/ai/http.ts:12-20` (`providerHeaders`)
- **Issue:** Updating `baseUrl` via `PATCH /api/ai/providers/:id` while omitting `secret` preserves the stored `secret` (`if (secret) patch.secret = secret;`). An authenticated user can point `baseUrl` to an attacker-controlled host and trigger `/models` or `/show` to exfiltrate `Authorization: Bearer <secret>` or `Authorization: Basic ...`.
- **Solution:** In `PATCH /api/ai/providers/:id`, check if `baseUrl` changed compared to the existing provider record; if it changed and a new `secret` was not provided, reject the request with `400` or clear `secret` and `username` on the record.

### 3. SSRF & Stored API Key Exfiltration in OSINT Test/Settings (`POST /api/osint/test`)
- **Locations:** `server/routes/osint.ts:47-79, 96-128`, `server/osint-client.ts:17-31` (`normalizeOsintUrl`), `server/osint-client.ts:91-114` (`osintFetch`)
- **Issue:** `normalizeOsintUrl` only checks that the URL is `http:` or `https:` with a hostname—it does not block loopback, RFC1918, or cloud metadata IPs (`169.254.169.254`). In `POST /api/osint/test`, supplying an arbitrary `apiUrl` while omitting `apiKey` falls back to `stored.apiKey` and sends `GET ${apiUrl}/api/osint/tools` with `x-api-key`, returning the upstream status and body.
- **Solution:**
  1. Never fall back to `stored.apiKey` when `body.apiUrl` differs from the saved URL; require the caller to provide `apiKey` explicitly.
  2. Validate `apiUrl` against private/loopback/metadata IP ranges (unless explicitly allowlisted) and set `redirect: "error"` on `fetch`.
  3. Do not return raw upstream response bodies in `/api/osint/test`.

### 4. SSRF & Stored Credential Exfiltration in PRM-S3 Test (`POST /api/image-storage/prm-s3/test`)
- **Locations:** `server/routes/social-media.ts:2245-2311`
- **Issue:** If `body.endpoint` is supplied while `body.accessKeyId` or `body.secretAccessKey` are omitted, lines 2264–2269 fall back to `savedConfig` credentials, instantiate `new S3Client({ endpoint: endpointUrl, ... })`, and call `probePrmS3Buckets` against the caller-supplied endpoint.
- **Solution:** Require explicit `accessKeyId` and `secretAccessKey` whenever `body.endpoint` differs from `savedConfig.endpoint`, and validate the endpoint URL against disallowed internal/metadata IPs.

### 5. SSRF & Shared Secret Exfiltration in Stories Importer `serviceUrl`
- **Locations:** `server/routes/stories.ts:96, 708-784`, `server/stories-scheduler.ts:69-78` (`storiesServiceUrl`, `storiesServiceHeaders`), `server/stories-scheduler.ts:247-253` (`startRun`)
- **Issue:** `importerPatchSchema.serviceUrl` only checks `z.string().trim().max(500)` with no URL scheme or IP validation. `/login`, `/whoami`, and `startRun` issue `fetch` requests to `serviceUrl` carrying `x-stories-secret` (and live `runId` + `token` in `startRun`).
- **Solution:**
  1. Validate `serviceUrl` as a valid `http:`/`https:` URL and block cloud metadata/disallowed internal IPs.
  2. Clear `serviceSecret` whenever `serviceUrl` is modified unless a new `serviceSecret` is provided.

### 6. SSRF & Redirect-Based Credential Leakage in `isMetadataUrl`, `whisperApiUrl`, `prm_compute_api_url`, and Multi-Image Download
- **Locations:**
  - `server/ai/http.ts:82-90` (`isMetadataUrl`)
  - `server/routes/ai-providers.ts:227, 235` (`whisperApiUrl`)
  - `server/routes/ai-vector.ts:211-224, 2407-2441` (`prm_compute_api_url`, `/api/daily-notes/transcribe`)
  - `server/routes/social-media.ts:1843-1896`, `server/task-worker.ts:4883-4979` (`processMultiImageDownload`)
- **Issue:**
  - `isMetadataUrl` only checks literal hostnames, which can be bypassed via IPv4-mapped IPv6 (`[::ffff:169.254.169.254]`) or DNS resolution.
  - `whisperApiUrl` and `prm_compute_api_url` lack `https?://` validation, metadata checks, and `redirect: "error"`.
  - `POST /api/tasks/multi-image-download` accepts up to 999 arbitrary `url`s and `processMultiImageDownload` fetches them with no private-IP filter, no `AbortSignal` timeout, and no response size limit.
- **Solution:**
  1. Centralize a shared `assertSafeExternalUrl` helper that enforces `http:`/`https:`, resolves DNS, blocks loopback/private/link-local/metadata IPv4 and IPv6 ranges, and pins the resolved IP or sets `redirect: "error"`.
  2. Apply `redirect: "error"` on all outbound `fetch` calls carrying credentials (`whisperApiUrl`, `prm_compute_api_url`).
  3. Add `AbortSignal.timeout(...)` and a max byte limit to `processMultiImageDownload`.

### 7. Stored XSS via Unvalidated `javascript:` / `data:` URLs (Server & Client)
- **Locations:**
  - **Server:** `server/routes/messages.ts:89-157` (`externalUrl`), `server/routes/social-media.ts:414, 441, 479, 622, 2771`, `server/routes/pending-imports.ts:149, 207`, `server/routes/tracking.ts:91` (`accountUrl` / `accountWebsite`)
  - **Client:** `client/src/pages/ai-chat-demo.tsx:262-280` (`MessageLinks`), `client/src/pages/social-account-profile.tsx:914, 1476`, `client/src/pages/social-accounts-list.tsx:762, 899`, `client/src/pages/social-graph-3d.tsx:1780`, `client/src/components/stories-tab.tsx:290, 314`, `client/src/components/message-bubble.tsx:27, 75, 107`, `client/src/components/conversation-media-dialog.tsx:136, 142`, `client/src/pages/image-detail.tsx:302, 562, 577`
- **Issue:** External/imported URLs are stored and bound directly to `<a href=...>` and `window.open(...)` without checking the URL scheme, allowing `javascript:` or `data:` URI execution when clicked.
- **Solution:**
  1. Validate URL fields on the server with a Zod `.refine()` allowing only `http:` and `https:` protocols.
  2. Create a shared client `safeUrl(url, { allowRelative?: boolean })` helper that parses via `new URL(url, window.location.origin)` and rejects any protocol other than `http:`/`https:` (or leading `/` when `allowRelative` is true), applying it to all dynamic `href`s, `MessageLinks`, and `window.open` calls.

### 8. Known High-Severity Vulnerabilities in Production Dependencies
- **Locations:** `package.json:49-88`, `package-lock.json`
- **Issue:** `npm audit --omit=dev` reports **14 High** and 6 Moderate advisories across direct and transitive production dependencies (`adm-zip` symlink traversal/zip bomb, `axios` prototype pollution/SSRF `maxRedirects: 0` bypass/ReDoS, `compression` memory leak DoS, `express`/`body-parser` DoS, `zod <4.6.6` memory exhaustion DoS, `@xmldom/xmldom`, `follow-redirects`, `undici`).
- **Solution:**
  1. Run `npm audit fix` for non-breaking patches.
  2. Plan an upgrade for `zod` (`>=4.6.6`) or enforce strict payload size limits before Zod validation.
  3. Ensure `adm-zip` is never used on untrusted archives without strict entry path, symlink, and uncompressed-size validation (or replace it with a safer streaming archive library).

---

## Medium Severity

### 9. Missing CSRF Protection on State-Changing Endpoints
- **Locations:** `server/auth.ts:62-66`, `server/routes/auth-setup.ts:779, 991, 1107, 1406, 1701`
- **Issue:** Cookie-authenticated endpoints (`POST /api/reset-database`, `PATCH /api/user`, `POST /api/api-keys`, `POST /api/sso-config`, `POST /api/settings`) rely solely on `sameSite: "lax"` with no CSRF token or `Origin`/`Sec-Fetch-Site` check.
- **Solution:** Enforce `Origin`/`Referer` or `Sec-Fetch-Site` validation on state-changing cookie-authenticated requests and/or implement CSRF tokens (double-submit cookie or synchronizer token).

### 10. IDOR on Chrome Extension Sessions & Storage Delete Methods
- **Locations:** `server/routes/auth-setup.ts:1296-1335` (`GET /api/extension-sessions`, `DELETE /api/extension-sessions/:id`), `server/storage.ts:2728-2730, 2794-2796` (`deleteApiKey`, `deleteExtensionSession`)
- **Issue:** `GET /api/extension-sessions` and `DELETE /api/extension-sessions/:id` do not scope queries by `req.user.id`, and `DatabaseStorage.deleteApiKey` / `deleteExtensionSession` delete solely by `id` without a `userId` `WHERE` clause.
- **Solution:** Filter `GET /api/extension-sessions` by `req.user.id` and update `deleteApiKey(id, userId)` and `deleteExtensionSession(id, userId)` to require `and(eq(..., id), eq(..., userId))`.

### 11. Indirect Prompt Injection Leading to Write Tool Execution in `open` Mode
- **Locations:** `server/routes/ai-vector.ts:1391-1443, 1625-1858` (`runStreamingChatWithTools`, `renderMessageWithAttachments`), `server/ai-tools.ts:1337-1836`
- **Issue:** Read tools (`read_messages`, `search_messages`, `get_social_account_posts`, `get_social_account_stories`, `super_search`) and attachments return untrusted external content into `role: "tool"` messages without `asData(...)` wrapping or `DATA_TAGS_NOTE`. In `"open"` execution mode, injected instructions can invoke write tools (`create_person`, `update_person`, `create_note`, `set_relationship`, etc.) without user approval.
- **Solution:** Wrap all untrusted tool outputs and file attachments with `asData(...)` paired with `DATA_TAGS_NOTE`, and require explicit user approval (`auth` mode) for write tools whenever untrusted external data is in context.

### 12. Plaintext API Key Exposure (`/api/prm-compute/reveal-key`) & Missing Ownership/Role Checks
- **Locations:** `server/routes/ai-vector.ts:200-209` (`/api/prm-compute/reveal-key`), `1485-1508` (`/api/mcp/settings`), `1553-1608` (`takePendingReply`, `/approvals/:id`, `/questions/:id`), `1861-2276` (`/api/ai-chats*`), `server/routes/ai-providers.ts:91-153`, `server/routes/prompts.ts:7-28`
- **Issue:** `/api/prm-compute/reveal-key` returns `prm_compute_api_key` in plaintext. Additionally, AI chat, `takePendingReply` (approvals/questions), AI provider, prompt, and MCP settings endpoints do not enforce per-user ownership or admin role checks.
- **Solution:** Remove `/reveal-key` (or restrict to initial setup), enforce `userId` ownership on chats and `pendingClientReplies`, and restrict global AI/MCP/prompt configuration routes to admin users in multi-user deployments.

### 13. Upstream Query/Path Injection in PRM-Compute Proxy Endpoints
- **Locations:** `server/routes/ai-vector.ts:980-984, 3687-3796` (`/api/prm-face/face/list`, `/img/get`, `/face/get`, `/person/get`, `/face/with-name`, `/person/:personUuid/faces`)
- **Issue:** `uuid`, `page`, `page_size`, `order`, and `personUuid` are interpolated directly into upstream PRM-Compute URLs without `encodeURIComponent` or format validation.
- **Solution:** Validate IDs/pagination with Zod (UUID/integer schemas) and construct upstream URLs using `new URL()` and `URLSearchParams`.

### 14. SSRF via DNS Rebinding & Incomplete IPv6 Filtering in `fetchImageBuffer`
- **Locations:** `server/prm-s3.ts:800-866, 896-936` (`isPrivateAddress`, `assertSafeExternalUrl`, `fetchImageBuffer`)
- **Issue:** `assertSafeExternalUrl` calls `dns.lookup()`, then `fetchImageBuffer` calls `fetch(targetUrl)` which performs a second DNS lookup (vulnerable to DNS rebinding). `isPrivateAddress` also omits NAT64 (`64:ff9b::/96`), discard-only (`100::/64`), and IPv4-compatible IPv6 (`::/96`).
- **Solution:** Pin the validated IP from `dns.lookup` in the outbound HTTP request (preserving `Host` and TLS `servername`) and expand `isPrivateAddress` to block `64:ff9b::/96`, `100::/64`, and `::/96`.

### 15. Unauthenticated Trigger for Outbound Tracking Runs (`POST /api/v1/stories/ready`)
- **Locations:** `server/routes/stories.ts:326-329`, `server/routes/auth-setup.ts:109` (`isPublicApiPath`)
- **Issue:** `POST /api/v1/stories/ready` sits under `/v1/stories` (exempt from session auth) and calls `kickManualTrackingJobs()` without verifying `x-stories-secret` or a run token.
- **Solution:** Require `x-stories-secret`, a valid run token, or `requireAuth` on `POST /api/v1/stories/ready`.

### 16. Pre-Auth 50 MB Multipart Buffering (Memory DoS) on Stories/Tracking Uploads
- **Locations:** `server/routes/stories.ts:394`, `server/routes/tracking.ts:942, 1008, 1041, 1047`
- **Issue:** Unauthenticated requests to `/api/v1/stories/*` and `/api/v1/tracking/*` execute `multer` 50 MB memory-storage middleware before `authedRunFor` / `jobFor` verifies `x-stories-token`.
- **Solution:** Move token authentication middleware before `multer` on all `/api/v1/stories/*` and `/api/v1/tracking/*` upload routes.

### 17. Potential Argument Injection in OSINT Scan Targets
- **Locations:** `server/routes/osint.ts:170-175, 252-289`, `server/osint-scan-queue.ts:61-73, 219-224`
- **Issue:** `createScanSchema.target` permits leading `-` and spaces, `options` is an unvalidated `z.record(z.unknown())`, and `POST /api/osint/results` queues targets via `queueOsintScansForTarget` without applying `createScanSchema`'s regex check.
- **Solution:** Disallow leading `-` on all OSINT targets, disallow spaces on `username`/`email` types, enforce validation inside `queueOsintScansForTarget`, and validate `options` with a strict Zod schema.

### 18. Unchecked Image `Content-Type` in `processMultiImageDownload`
- **Locations:** `server/task-worker.ts:4925, 4942`
- **Issue:** Trusts remote `response.headers.get("content-type")` verbatim when uploading to PRM-S3 without inspecting magic bytes or rejecting `image/svg+xml` / `text/html`.
- **Solution:** Inspect magic bytes (e.g., `file-type` or `sharp`) and restrict stored uploads to an allowlist of raster image/video MIME types (`image/jpeg`, `image/png`, `image/webp`, `image/gif`).

### 19. Unauthenticated Information Disclosure in `GET /api/setup/services/health`
- **Locations:** `server/routes/setup-services.ts:88-144`, `server/routes/auth-setup.ts:76`
- **Issue:** Although `details` is stripped when `!req.isAuthenticated()`, `results[key].message` is returned verbatim, exposing AI provider names, model counts, story importer labels, and raw `err.message` strings.
- **Solution:** Return only coarse booleans/generic status strings (`"online"` / `"offline"`) when `!req.isAuthenticated()`, or require auth once initial setup (`userCount === 0`) is complete.

### 20. Database Connections Disable SSL/TLS (`ssl: false`)
- **Locations:** `server/db.ts:19-28` (`pool`)
- **Issue:** `pg.Pool` hardcodes `ssl: false` even for external PostgreSQL connections.
- **Solution:** Enable TLS by default (`ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: true }`) or configure `sslmode=require` / `verify-full` via `DATABASE_URL`.

### 21. Unbounded In-Memory Rate-Limit Maps (Heap Exhaustion DoS)
- **Locations:** `server/middleware/rate-limit.ts:8, 22-31, 43-51`, `server/routes/auth-setup.ts:1186, 1191-1198, 1253`
- **Issue:** `rateLimitStore` and `verifyAttempts` grow unboundedly between cleanup intervals; combined with `X-Forwarded-For` spoofing, attackers can exhaust Node.js heap.
- **Solution:** Cap map sizes with oldest-entry/LRU eviction and fix `trust proxy` so `req.ip` cannot be spoofed.

### 22. No Dedicated Brute-Force Rate Limiting on `/api/login`
- **Locations:** `server/auth.ts:101-103`, `server/middleware/rate-limit.ts:11`
- **Issue:** `/api/login` is only subject to the global 600 req/min limiter.
- **Solution:** Add a strict per-IP and per-username rate limiter on `/api/login` (e.g., 5–10 failed attempts per 15 minutes).

### 23. Verbose Internal Error Messages in Global Error Handler
- **Locations:** `server/index.ts:153-174`
- **Issue:** Returns `err.message` directly in JSON responses even for `status >= 500` in production.
- **Solution:** Return a generic `"Internal Server Error"` message for `status >= 500` when `NODE_ENV === "production"` and log full error details server-side with `requestId`.

### 24. Polynomial ReDoS, Unbounded Import Size, Sibling-Dir Media Traversal, and `RangeError` in SMS/IG DM Parsers
- **Locations:**
  - `server/sms-import.ts:46, 58-91` (`parseSmsBackup`)
  - `server/xml-utils.ts:145-155` (`unescapeXml`)
  - `server/instagram-dm-import.ts:136-149, 228-234, 266-278` (`normalizeMedia`, `loadThreadFolder`)
  - `server/task-worker.ts:3942` (`resolveMediaPath`)
  - `server/routes/messages.ts:22-23, 196-197, 384-398` (unbounded `limit`/`offset`)
- **Issue:**
  - `parseSmsBackup` loads the full XML string and runs `O(N²)` regexes (`/<addr [^>]*type="151"[^>]*\/>/`, `/<mms [^>]*>[\s\S]*?<\/mms>/g`).
  - `unescapeXml` calls `String.fromCodePoint` without checking `<= 0x10FFFF` (throws unhandled `RangeError`).
  - `loadThreadFolder` reads all JSON files synchronously with no size/count cap.
  - `resolveMediaPath` checks `resolved.startsWith(path.resolve(threadFolder))` without a trailing `path.sep` (sibling-directory prefix bypass).
  - Messages pagination routes have no upper bound on `limit` or lower bound on `offset`.
- **Solution:**
  1. Enforce import file/message size caps and use a cursor/streaming scanner instead of `[\s\S]*?` regexes.
  2. Validate `cp >= 0 && cp <= 0x10FFFF` (excluding `0xD800–0xDFFF`) in `unescapeXml`.
  3. Reject `..` and backslashes in `normalizeMedia` and require `+ path.sep` in `resolveMediaPath`.
  4. Clamp `offset >= 0` and `1 <= limit <= 200` on all pagination endpoints.

### 25. PostgreSQL Regex DoS (`~*`) in `search_messages`
- **Locations:** `server/ai-tools.ts:997-1000`
- **Issue:** Arbitrary LLM/MCP-supplied `textQuery` is passed directly to PostgreSQL `~*` when `useRegex` is `true`, risking CPU exhaustion via catastrophic backtracking.
- **Solution:** Cap `textQuery` length, reject nested quantifiers, or wrap the query in a short PostgreSQL `SET LOCAL statement_timeout`.

### 26. Scheduler Crash / DoS via Non-String `time` in `PUT /api/backups/schedule`
- **Locations:** `server/routes/backups.ts:119-146`, `server/backup-scheduler.ts:53-58` (`atTime`)
- **Issue:** `RegExp.test(time)` coerces non-strings (e.g., `["03:00"]`) to `"03:00"`, persisting an array that causes `time.split(":")` in `backup-scheduler.ts` to throw `TypeError` on every tick.
- **Solution:** Validate `PUT /api/backups/schedule` with a strict Zod schema (`time: z.string().regex(...)`, `enabled: z.boolean()`).

---

## Low Severity

### 27. Logout Does Not Destroy Server-Side Session or Clear Cookie
- **Locations:** `server/auth.ts:105-110`
- **Solution:** Call `req.session.destroy(...)` inside `req.logout` and `res.clearCookie("connect.sid")`.

### 28. Hardcoded Fallback `SESSION_SECRET` When `NODE_ENV !== "production"`
- **Locations:** `server/auth.ts:47-56`
- **Solution:** Generate an ephemeral random secret with `crypto.randomBytes(32).toString("hex")` when `SESSION_SECRET` is unset in non-production.

### 29. Unvalidated `X-Request-ID` Header Reflected in Response & Logs
- **Locations:** `server/middleware/request-id.ts:14-21`, `server/index.ts:156-158`
- **Solution:** Validate `x-request-id` against `/^[A-Za-z0-9_-]{1,64}$/` and fall back to a server-generated ID otherwise.

### 30. SSE Manager Lacks Per-User Scoping, Connection Caps, and Dead-Client Cleanup
- **Locations:** `server/middleware/sse.ts:18-46` (`SSEManager`)
- **Solution:** Associate SSE clients with `userId`, cap concurrent connections per user, and remove clients that fail on `res.write()`.

### 31. No Rate Limiting on Daily Notes PIN Verification
- **Locations:** `server/routes/ai-vector.ts:2517-2533, 2622-2638`
- **Solution:** Add per-user/session rate limiting or exponential backoff on failed 4–8 char PIN attempts.

### 32. Missing Request Body Schema Validation on Multiple Endpoints
- **Locations:** `server/routes/people-groups.ts:1302-1790`, `server/routes/social-media.ts:997-1061, 1211-1229, 1867`, `server/routes/pending-imports.ts:170, 225`, `server/routes/backups.ts:156`
- **Solution:** Replace TypeScript `as` casts and unvalidated `req.body` reads with strict Zod `.safeParse()` schemas (including UUID checks for IDs and `z.string()` checks for `filename`).

### 33. Untrusted `Host` Header Used to Construct Image URLs in TPS Search
- **Locations:** `server/routes/tps.ts:239, 247`
- **Solution:** Use a configured canonical base URL from app settings/env instead of `req.get("host")`, and wrap `new URL()` in error handling.

### 34. Raw SQL String Interpolation in `mergeSocialAccounts` (`sql.raw`)
- **Locations:** `server/account-merge.ts:100-285`
- **Solution:** Replace manual quote-escaping + `sql.raw(...)` with Drizzle's parameterized `sql\`...\`` tagged templates.

### 35. Unescaped SQL `LIKE` Wildcards in `resolvePhotoSources`
- **Locations:** `server/photo-source.ts:564`
- **Solution:** Escape `%`, `_`, and `\` in `url` before building the `LIKE` pattern, or use `strpos(content, ${url}) > 0`.

### 36. Quadratic / Cubic `JSON.parse` Loops in `extractJsonObject` & `extractJsonArray`
- **Locations:** `server/json-extract.ts:12-23`, `server/summary-queue.ts:637-649`
- **Solution:** Replace nested slice/parse loops with a single-pass brace/bracket-depth scanner or cap the number of parse attempts.

### 37. Unvalidated Link Schemes in `resolveLinksInText` / `cleanRawLinks`
- **Locations:** `server/vector-app-knowledge.ts:154-241`
- **Solution:** Allow only relative `/` paths or `http:`/`https:` URLs in `resolveLinksInText`.

### 38. 1 GB Backup Upload Limit & Weak XML Prefix Check
- **Locations:** `server/routes/backups.ts:62-69, 191-204`
- **Solution:** Lower the `multer` `fileSize` limit to match realistic export sizes and enforce strict XML validation with XXE/entity-expansion disabled during restore.

### 39. Missing Magic-Byte Validation on Media Uploads & Incomplete IPv4-Mapped IPv6 Check in `profile-image.ts`
- **Locations:** `server/upload-names.ts:49-59`, `server/prm-s3.ts:608-614`, `server/routes/references.ts:42-51`, `server/profile-image.ts:151-163`
- **Solution:** Validate magic bytes (`file-type` / `sharp`) on upload before storing in PRM-S3 or forwarding to reference search, and reuse the full `isPrivateAddress` helper (with hex IPv4-mapped IPv6 parsing) in `profile-image.ts`.

### 40. `demos-map.ts` Missing Route-Level `requireAuth`, Leaks `errorMessage` on 502, and Returns Map Keys
- **Locations:** `server/routes/demos-map.ts:80-122`
- **Solution:** Add route-level `requireAuth`, return generic error messages on `502` (logging details server-side), and ensure Google Maps keys are HTTP-referrer-restricted or proxied.

### 41. Fragile Regex XML Matching, Unvalidated `z.any()` Metadata/Attachments, and `Invalid Date` Handling in Messages/SMS
- **Locations:** `server/sms-import.ts:60-125`, `server/routes/messages.ts:90, 153, 214-216, 298`
- **Solution:** Use a quote-aware/streaming XML parser, replace `z.any()` with bounded Zod schemas, validate `Number.isFinite(ts)` for timestamps, and return generic 500 error messages.

### 42. Missing `"noopener,noreferrer"` on `window.open(..., "_blank")`
- **Locations:** `client/src/pages/social-account-profile.tsx:914`, `client/src/pages/social-accounts-list.tsx:762, 899`, `client/src/components/conversation-media-dialog.tsx:136, 142`
- **Solution:** Pass `"noopener,noreferrer"` as the third argument to `window.open`.

### 43. Unencoded `queryKey` Segments & Unvalidated Chrome Extension ID Format
- **Locations:** `client/src/lib/queryClient.ts:47-55` (`getQueryFn`), `client/src/pages/chrome-extension-settings.tsx:242-250`, `client/src/lib/extension-bridge.ts:68-95`
- **Solution:** Pass query parameters via object entries in `queryKey` and `encodeURIComponent` path segments in `getQueryFn`; validate Chrome extension IDs against `/^[a-p]{32}$/`.
