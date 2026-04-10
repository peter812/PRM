# PRM API Upgrades

Recommended changes to the PRM API to improve performance and functionality of the PRM Chrome Extension.

---

## 1. Add a Social Account Search Endpoint

**Endpoint:** `POST /api/v1/social-accounts/search`

**Why:** Currently the extension sends full URLs to the API. The extension should extract the username from the URL client-side and search by username instead. This decouples URL parsing from the backend and makes the search more flexible.

**Request body:**
```json
{
  "username": "johndoe",
  "platform": "Instagram"
}
```

**Expected response:**
```json
{
  "results": [
    {
      "id": "sa_123",
      "username": "johndoe",
      "name": "John Doe",
      "platform": "Instagram",
      "bio": "Photographer & traveler",
      "followers": 12500,
      "following": 890,
      "posts": 342,
      "avatar_url": "https://cdn.example.com/avatars/johndoe.jpg",
      "profile_url": "https://instagram.com/johndoe",
      "last_synced": "2026-04-08T14:30:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "per_page": 20
}
```

**Notes:**
- The `platform` field in the request should be optional to allow cross-platform search.
- Support fuzzy/partial username matching so users get results even with slight variations.
- Return paginated results with `total`, `page`, and `per_page` fields.

---

## 2. Add Pagination to All List/Search Endpoints

**Why:** Without pagination, large result sets can cause slow responses, high memory usage, and poor extension performance. All list and search endpoints should support pagination.

**Query parameters:**
- `page` (default: 1)
- `per_page` (default: 20, max: 100)

**Applies to:**
- `GET /api/v1/url-list`
- `POST /api/v1/social-accounts/search`
- Any future list endpoints

---

## 3. Add Rate Limiting Headers

**Why:** The extension uses retry with exponential back-off, but the API should communicate rate limit status via headers so the client can adjust proactively.

**Response headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1712668800
```

**Notes:**
- Return `429 Too Many Requests` when the limit is exceeded with a `Retry-After` header.
- The extension already handles 429 responses with retries; these headers let it optimize timing.

---

## 4. Support `ETag` / `If-None-Match` for Caching

**Why:** The extension polls the URL allow-list and fetches URL info frequently. HTTP conditional caching with ETags reduces bandwidth and speeds up responses for unchanged data.

**Applies to:**
- `GET /api/v1/url-list`
- `POST /api/v1/url-info`
- `POST /api/v1/social-accounts/search`

**Expected behavior:**
- Return `ETag` header in responses.
- When the client sends `If-None-Match` with the cached ETag, respond with `304 Not Modified` if unchanged.

---

## 5. Add a Bulk Social Account Lookup Endpoint

**Endpoint:** `POST /api/v1/social-accounts/bulk`

**Why:** When the extension detects multiple social profiles in a session, it should be able to batch-resolve them in one request instead of making N individual API calls.

**Request body:**
```json
{
  "usernames": [
    { "username": "johndoe", "platform": "Instagram" },
    { "username": "janedoe", "platform": "LinkedIn" }
  ]
}
```

**Expected response:**
```json
{
  "results": {
    "johndoe": { ... },
    "janedoe": { ... }
  },
  "not_found": []
}
```

---

## 6. Add a `PATCH` Endpoint for Partial Social Account Updates

**Endpoint:** `PATCH /api/v1/social-accounts/:id`

**Why:** The extension scrapes partial data (e.g., updated follower count, new bio). A PATCH endpoint lets it send only changed fields rather than a full replacement, reducing payload size and avoiding accidental data loss.

**Request body (example):**
```json
{
  "followers": 13200,
  "bio": "Updated bio text"
}
```

---

## 7. Add WebSocket or Server-Sent Events (SSE) for Real-Time Updates

**Why:** The extension currently has to poll for updates. A push-based channel would let the API notify the extension of changes (e.g., new social account linked, data enrichment completed) instantly.

**Suggested endpoint:** `GET /api/v1/events/stream` (SSE)

**Events:**
- `social_account.updated`
- `social_account.created`
- `scrape.completed`

---

## 8. Improve Error Response Format

**Why:** The current API returns generic HTTP status codes. A structured error response helps the extension display meaningful error messages to the user.

**Suggested format:**
```json
{
  "error": {
    "code": "SOCIAL_ACCOUNT_NOT_FOUND",
    "message": "No social account found with username 'johndoe' on Instagram.",
    "details": {},
    "request_id": "req_abc123"
  }
}
```

**Benefits:**
- Machine-readable `code` for programmatic handling.
- Human-readable `message` for display.
- `request_id` for debugging and support.

---

## 9. Add Health Check Response with Service Details

**Why:** The `GET /api/v1/ping` endpoint currently just returns a 200. Returning service metadata helps the extension verify compatibility and show useful diagnostics.

**Suggested response:**
```json
{
  "status": "ok",
  "version": "1.4.0",
  "features": ["social-account-search", "bulk-lookup", "sse-events"],
  "timestamp": "2026-04-09T10:00:00Z"
}
```

**Benefits:**
- The extension can check `features` to enable/disable UI features.
- Version info helps debug incompatibilities.

---

## 10. Add Response Compression (gzip / br)

**Why:** Social account search results with avatars URLs, bios, and metadata can be large. Enabling `gzip` or Brotli compression on API responses reduces payload size significantly, improving load times especially for the Chrome extension popup.

**Implementation:**
- Accept `Accept-Encoding: gzip, br` header from clients.
- Compress responses with 1KB+ body size.

---

## Summary of Priority

| Priority | Upgrade | Impact |
|----------|---------|--------|
| **P0** | Social Account Search endpoint | Core feature for username-based search |
| **P0** | Pagination | Required for scalable data retrieval |
| **P1** | Structured error responses | Better UX and debugging |
| **P1** | Rate limiting headers | Prevents abuse, improves client behavior |
| **P1** | Health check with service details | Feature detection and diagnostics |
| **P2** | ETag caching | Performance optimization |
| **P2** | Bulk lookup endpoint | Reduces API calls |
| **P2** | PATCH for partial updates | Data integrity |
| **P3** | Response compression | Bandwidth optimization |
| **P3** | SSE for real-time updates | Future enhancement |
