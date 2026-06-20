# Vectorize Everything — Implementation Plan

## Overview

Expand the existing Qdrant vector storage (currently daily-notes only) into a universal "vectorize everything" system. Every major entity in PRM will be embedded and stored in a new Qdrant collection, enabling a powerful semantic "Super Search" across the entire knowledge base.

---

## 1. New Qdrant Collection

### Collection: `prm_universal`

A single Qdrant collection holding vectors for **all** entity types. Each point's payload includes a `type` discriminator so results can be filtered or grouped.

| Payload Field | Purpose |
|---|---|
| `type` | Entity type discriminator: `person`, `group`, `image`, `note`, `interaction`, `social_account`, `daily_note`, `ai_chat` |
| `entity_id` | The SQL primary key (UUID) of the source record |
| `title` | Short display label (name, subject, date, etc.) |
| `snippet` | First ~200 chars of the embedded text (for result previews) |
| `created_at` | ISO timestamp from source record |
| `meta` | Optional JSON object with type-specific fields (e.g. `personId` for notes) |

### What Gets Vectorized

| Entity | Text Composed For Embedding |
|---|---|
| **Person** | `"{firstName} {lastName}" + company + title + tags joined + email + phone` |
| **Group** | `"{name}" + type tags joined + member names (resolved)` |
| **Image (Photo)** | `imageDescription` field (AI-generated description from LLM analysis) |
| **Note** | `content` (the note body) |
| **Interaction** | `"{title}" + description + involved people names + type name` |
| **Social Account** | `"{username}" + current profile bio + nickname + platform name` |
| **Daily Note** | Existing `composeDailyNoteText()` logic (title + body + events) |
| **AI Chat** | `"{title}" + system message + concatenated message contents (truncated to ~2000 chars)` |

---

## 2. SQL DB: Storing Vector IDs

### Schema Changes

Add two columns to every vectorized table:

```
vector_id       TEXT          -- Qdrant point UUID (set on first embed, reused on update)
vector_synced_at TIMESTAMP   -- Last successful sync time; NULL = needs sync
```

**Tables to alter:**
- `people`
- `groups`
- `photos`
- `notes`
- `interactions`
- `social_accounts`
- `daily_notes` *(already has these columns)*
- `ai_chats`

### Implementation

- Add columns to `shared/schema.ts` (Drizzle definitions)
- Add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements in `server/db-init.ts` → `validateAndSyncSchema()`
- The `vector_id` column is the link between SQL and Qdrant — it lets us update or delete the correct point

---

## 3. Vectorization Service (`server/vector-universal.ts`)

Create a new module that generalizes the existing `server/vector.ts` patterns:

### Core Functions

```
loadUniversalVectorConfig()       → reads settings for the universal collection
composeTextForEntity(type, data)  → builds the embedding text per entity type
upsertEntityVector(type, id, text, existingVectorId?) → embed + upsert + save vector_id
deleteEntityVector(type, vectorId) → remove point from Qdrant
searchUniversal(query, limit?, typeFilter?) → embed query + search collection
syncEntityInBackground(type, id)  → fire-and-forget wrapper
bulkSyncAll()                      → one-time full re-index of all entities
```

### Settings (app_settings keys)

| Key | Description |
|---|---|
| `vector_universal_enabled` | Master toggle for the universal vectorization |
| `vector_universal_collection` | Collection name (default: `prm_universal`) |

The Qdrant URL, API key, and embedding model are shared with the existing vector config.

---

## 4. Hooks: Auto-Sync on Create/Update/Delete

### On Create & Update

After any entity is saved, call `syncEntityInBackground(type, id)`. This is **async/fire-and-forget** so it never blocks the main request.

**Files to modify (add hooks):**
- `server/routes.ts` — person CRUD, group CRUD, note CRUD, interaction CRUD, social account CRUD, daily note CRUD, AI chat save
- Any route handler that creates or updates these entities

### On Delete

Before or after deleting an entity, call `deleteEntityVector(type, vectorId)` to remove the orphaned point from Qdrant.

**Delete sequences to hook into:**
- DELETE person → remove person vector
- DELETE group → remove group vector
- DELETE note → remove note vector
- DELETE interaction → remove interaction vector
- DELETE social account → remove social account vector
- DELETE daily note → remove daily note vector (already exists)
- DELETE AI chat → remove AI chat vector
- DELETE photo → remove photo vector

These delete calls should be **async tasks** (fire-and-forget or queued via the existing `tasks` table) so they don't slow down the user-facing delete response.

### Cascade Considerations

- When a person is deleted, their notes/interactions are cascade-deleted by FK. We need to also remove those child vectors. Options:
  - **Option A:** Query for child vector_ids before deleting the parent, batch-delete from Qdrant.
  - **Option B:** Run a periodic "orphan cleanup" job that removes Qdrant points whose `entity_id` no longer exists in SQL.
  - **Recommended:** Option A for correctness, with Option B as a safety net.

---

## 5. Bulk Initial Sync

### Admin Action: "Vectorize Everything Now"

A button on the Vector Storage settings page that:
1. Checks that the universal collection exists (creates if not)
2. Iterates all entities in batches (50–100 at a time)
3. Embeds and upserts each one
4. Reports progress via the existing `tasks` table (so the UI can show a progress bar)

This is a long-running background task — use the existing task worker infrastructure.

---

## 6. Search Feature: "Super Search"

### UI Changes (`client/src/components/global-search.tsx`)

1. **New "Super Search" toggle button** in the search bar (e.g. a sparkle/bolt icon)
2. When activated:
   - The search bar border/edges **glow blue** (CSS `box-shadow` animation with blue color, e.g. `0 0 8px 2px rgba(59, 130, 246, 0.6)`)
   - A small badge/indicator shows "Super Search" mode is active
3. When the user types a query and presses **Enter** in Super Search mode:
   - Navigate to a dedicated **Super Search results page** (e.g. `/super-search?q=...`)
   - Show a loading screen/skeleton while waiting

### Disable Condition

- Super Search button is **disabled/hidden** unless `vector_universal_enabled === "true"` AND the universal Qdrant collection has been created
- Fetch this status from a new endpoint: `GET /api/vector/universal/status` → `{ enabled: boolean, collectionReady: boolean }`

### Backend: Search Endpoint

`POST /api/vector/universal/search`

```json
Request:  { "query": "string", "limit": 20, "typeFilter": ["person", "note", ...] }
Response: { "results": [ { "type": "person", "entityId": "uuid", "title": "...", "snippet": "...", "score": 0.87 } ] }
```

Flow:
1. Receive query string
2. Call `embedText(query)` via Ollama to get the query vector
3. Search the `prm_universal` Qdrant collection with that vector
4. Return results with payload metadata

### Frontend: Super Search Results Page (`client/src/pages/super-search.tsx`)

- Shows a loading animation while the search is in progress
- Displays results grouped by entity type (or in a single ranked list with type badges)
- Each result is clickable and navigates to the relevant detail page:
  - Person → `/people/{id}`
  - Group → `/groups/{id}`
  - Note → `/people/{personId}` (notes tab)
  - Interaction → `/interactions/{id}`
  - Social Account → `/social-accounts/{id}`
  - Daily Note → `/daily-notes` (with date context)
  - AI Chat → `/ai-chat/{id}`
  - Image → `/images/{id}`

---

## 7. Settings UI Updates

### Vector Storage Settings Page (`client/src/pages/vector-settings.tsx`)

Add a new section: **"Universal Vectorization"**

- Toggle: Enable/disable universal vectorization
- Status indicator: Shows if the `prm_universal` collection exists and point count
- Button: "Vectorize Everything Now" (triggers bulk sync)
- Progress bar: Shows bulk sync progress when running

---

## 8. Implementation Order

1. **Schema changes** — Add `vector_id` / `vector_synced_at` columns to all tables
2. **`server/vector-universal.ts`** — Core service with compose/upsert/delete/search functions
3. **Settings & status endpoint** — `vector_universal_enabled` toggle + status API
4. **Hooks on create/update** — Wire up `syncEntityInBackground` in route handlers
5. **Hooks on delete** — Wire up `deleteEntityVector` in delete handlers
6. **Bulk sync** — Admin "Vectorize Everything Now" task
7. **Super Search backend** — `POST /api/vector/universal/search` endpoint
8. **Super Search UI** — Toggle button, glow effect, results page
9. **Settings UI** — Universal vectorization section on vector settings page
10. **Testing & polish** — End-to-end testing, error handling, edge cases

---

## 9. Technical Notes

- **Embedding dimension:** Determined at runtime by the chosen Ollama model (e.g. `nomic-embed-text` = 768 dims, `mxbai-embed-large` = 1024 dims). The collection is created with the dimension of the first embedding.
- **Re-indexing on model change:** If the embedding model changes, all existing vectors become incompatible. The bulk sync should detect this and offer to recreate the collection.
- **Rate limiting:** Ollama embedding calls should be throttled during bulk sync to avoid overwhelming the server (e.g. concurrency of 2–4).
- **Text truncation:** Embedding models have token limits. Truncate composed text to ~2000 characters before embedding.
- **Existing daily note vectors:** The current `prm_daily_notes` collection can remain for backward compatibility, or daily notes can be migrated into the universal collection (with a flag to disable the old one).
