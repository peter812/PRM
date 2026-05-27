# How to Integrate PRM-Face into Your Application

**PRM-Face** is a self-hosted facial recognition and identity tracking API. This guide covers everything you need to authenticate and call every available endpoint from your own application.

---

## Table of Contents

1. [Base URL & Headers](#1-base-url--headers)
2. [Authentication Flow](#2-authentication-flow)
   - [2.1 Check Setup Status](#21-check-setup-status)
   - [2.2 Exchange Setup Code for an API Key](#22-exchange-setup-code-for-an-api-key)
   - [2.3 Authenticating Requests](#23-authenticating-requests)
   - [2.4 Revoke an API Key](#24-revoke-an-api-key)
3. [Face Endpoints](#3-face-endpoints)
   - [3.1 Register Faces with a Known Person UUID](#31-register-faces-with-a-known-person-uuid)
   - [3.2 Register an Anonymous Face](#32-register-an-anonymous-face)
   - [3.3 Query — Find Matching Faces (image saved)](#33-query--find-matching-faces-image-saved)
   - [3.4 Query Temp — Find Matching Faces (image not saved)](#34-query-temp--find-matching-faces-image-not-saved)
   - [3.5 Pickout — Detect All Faces in an Image (image saved)](#35-pickout--detect-all-faces-in-an-image-image-saved)
   - [3.6 Pickout Temp — Detect All Faces in an Image (image not saved)](#36-pickout-temp--detect-all-faces-in-an-image-image-not-saved)
   - [3.7 Merge Two Identities](#37-merge-two-identities)
   - [3.8 Get Images for a Person](#38-get-images-for-a-person)
   - [3.9 Delete a Person](#39-delete-a-person)
4. [Admin Endpoints](#4-admin-endpoints)
   - [4.1 Dashboard Stats](#41-dashboard-stats)
   - [4.2 Pending Low-Confidence Matches](#42-pending-low-confidence-matches)
   - [4.3 List People (Paginated)](#43-list-people-paginated)
   - [4.4 Search People by UUID](#44-search-people-by-uuid)
5. [Static Assets](#5-static-assets)
6. [Response Reference: Common Objects](#6-response-reference-common-objects)
7. [Error Reference](#7-error-reference)
8. [End-to-End Example (Python)](#8-end-to-end-example-python)
9. [End-to-End Example (JavaScript / fetch)](#9-end-to-end-example-javascript--fetch)

---

## 1. Base URL & Headers

| Setting | Value |
|---|---|
| **Default local URL** | `http://localhost:8000` |
| **Docker default** | `http://localhost:8000` (configurable via `docker-compose.yml`) |
| **Content-Type for file uploads** | `multipart/form-data` (set automatically by most HTTP clients) |
| **Auth header (all protected endpoints)** | `X-API-Key: <your-api-key>` |

> **Tip:** The interactive API docs are available at `http://localhost:8000/docs` (Swagger UI) and `http://localhost:8000/redoc` once the server is running.

---

## 2. Authentication Flow

PRM-Face uses a two-step setup: first you exchange a **setup code** (printed to the server console on first startup) for an **API key**. All subsequent requests use that API key.

```
Server starts → prints SETUP_CODE to stdout
     ↓
POST /api/get-api-key  (with setup code)
     ↓
Receive raw API key  ← store this securely, shown only once
     ↓
All protected requests → X-API-Key: <raw-api-key>
```

---

### 2.1 Check Setup Status

Use this to determine whether initial setup has already been completed (e.g., to conditionally show a setup screen in your UI).

**`GET /api/setup-status`**

- **Auth required:** No
- **Body:** None

**Response:**
```json
{
  "setup_completed": false
}
```

| Field | Type | Description |
|---|---|---|
| `setup_completed` | bool | `true` if the first API key has already been issued |

---

### 2.2 Exchange Setup Code for an API Key

The setup code is printed to the server's **stdout** on first startup, e.g.:
```
[Config] Setup code: a3f8c2d1e9b07654...
```

You can also override it with the `SETUP_CODE` environment variable.

**`POST /api/get-api-key`**

- **Auth required:** No
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `setup_code` | string | ✅ | The 32-character hex code from the server console |
| `label` | string | ❌ | Human-readable label for this key (default: `"admin"`) |

**Example (curl):**
```bash
curl -X POST http://localhost:8000/api/get-api-key \
  -F "setup_code=a3f8c2d1e9b076541234567890abcdef" \
  -F "label=my-app"
```

**Example (Python):**
```python
import requests

resp = requests.post(
    "http://localhost:8000/api/get-api-key",
    data={
        "setup_code": "a3f8c2d1e9b076541234567890abcdef",
        "label": "my-app",
    },
)
data = resp.json()
api_key = data["api_key"]   # ← save this! shown only once
key_id  = data["key_id"]    # ← UUID of the key record (needed to revoke)
```

**Response:**
```json
{
  "api_key": "3f8a1b2c...<64 hex chars>",
  "key_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Store this key securely – it will NOT be shown again. Include it as the X-API-Key header on all subsequent requests."
}
```

> ⚠️ **The raw API key is returned exactly once.** Store it in a secret manager, `.env` file, or environment variable immediately. It cannot be recovered — only revoked and replaced.

---

### 2.3 Authenticating Requests

Include your API key as the `X-API-Key` HTTP header on every protected request:

```
X-API-Key: 3f8a1b2c...<your 64-char key>
```

**curl:**
```bash
curl -H "X-API-Key: 3f8a1b2c..." http://localhost:8000/api/admin/stats
```

**Python (requests):**
```python
HEADERS = {"X-API-Key": "3f8a1b2c..."}
resp = requests.get("http://localhost:8000/api/admin/stats", headers=HEADERS)
```

**JavaScript (fetch):**
```javascript
const HEADERS = { "X-API-Key": "3f8a1b2c..." };
const resp = await fetch("http://localhost:8000/api/admin/stats", { headers: HEADERS });
```

---

### 2.4 Revoke an API Key

Permanently deactivates a key. You will need another valid key to make this call.

**`DELETE /api/revoke-key/{key_id}`**

- **Auth required:** Yes (`X-API-Key`)
- **Path parameter:** `key_id` — the UUID returned when the key was created

**Example (curl):**
```bash
curl -X DELETE http://localhost:8000/api/revoke-key/550e8400-e29b-41d4-a716-446655440000 \
  -H "X-API-Key: 3f8a1b2c..."
```

**Response:**
```json
{
  "revoked": true,
  "key_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## 3. Face Endpoints

All face endpoints require the `X-API-Key` header.

---

### 3.1 Register Faces with a Known Person UUID

Link one or more face images to a specific person identity you already track in your system.

**`POST /faces/with-name`**

- **Auth required:** Yes
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `images` | file(s) | ✅ | One or more image files (JPEG, PNG, WebP, GIF, BMP, TIFF). Send multiple files under the same `images` field name. |
| `person_uuid` | string | ✅ | Your UUID for this person. Created automatically if it doesn't exist yet. |
| `name` | string | ❌ | Optional display name. Applied to the Person record if it has no name yet. |

**Example (curl — multiple images):**
```bash
curl -X POST http://localhost:8000/faces/with-name \
  -H "X-API-Key: 3f8a1b2c..." \
  -F "person_uuid=user-123e4567-e89b-12d3-a456-426614174000" \
  -F "name=Alice" \
  -F "images=@/path/to/alice1.jpg" \
  -F "images=@/path/to/alice2.jpg"
```

**Example (Python):**
```python
import requests

HEADERS = {"X-API-Key": "3f8a1b2c..."}

with open("alice1.jpg", "rb") as f1, open("alice2.jpg", "rb") as f2:
    resp = requests.post(
        "http://localhost:8000/faces/with-name",
        headers=HEADERS,
        data={
            "person_uuid": "user-123e4567-e89b-12d3-a456-426614174000",
            "name": "Alice",
        },
        files=[
            ("images", ("alice1.jpg", f1, "image/jpeg")),
            ("images", ("alice2.jpg", f2, "image/jpeg")),
        ],
    )

result = resp.json()
```

**Response:**
```json
{
  "person_uuid": "user-123e4567-e89b-12d3-a456-426614174000",
  "name": "Alice",
  "registered_count": 2,
  "error_count": 0,
  "faces": [
    {
      "face_uuid": "a1b2c3d4-...",
      "image_uuid": "f5e6d7c8-...",
      "image_url": "/img/f5e6d7c8-....jpg",
      "filename": "alice1.jpg",
      "face_box": { "x": 120, "y": 45, "w": 200, "h": 220 }
    },
    {
      "face_uuid": "e9f0a1b2-...",
      "image_uuid": "c3d4e5f6-...",
      "image_url": "/img/c3d4e5f6-....jpg",
      "filename": "alice2.jpg",
      "face_box": { "x": 88, "y": 30, "w": 185, "h": 195 }
    }
  ],
  "errors": []
}
```

> **Note:** If some images fail (no face detected, invalid file) the server returns partial success — check `error_count` and `errors[]`. If **all** images fail, a `400` is returned.

---

### 3.2 Register an Anonymous Face

Register a single face as a brand-new identity when you don't know who the person is yet.

**`POST /faces/without-name`**

- **Auth required:** Yes
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `image` | file | ✅ | Single image file containing one face |

**Example (curl):**
```bash
curl -X POST http://localhost:8000/faces/without-name \
  -H "X-API-Key: 3f8a1b2c..." \
  -F "image=@/path/to/unknown_person.jpg"
```

**Example (Python):**
```python
with open("unknown.jpg", "rb") as f:
    resp = requests.post(
        "http://localhost:8000/faces/without-name",
        headers=HEADERS,
        files={"image": ("unknown.jpg", f, "image/jpeg")},
    )
result = resp.json()
# result["person_uuid"] — auto-generated UUID for this new anonymous identity
```

**Response:**
```json
{
  "face_uuid": "a1b2c3d4-...",
  "person_uuid": "e5f6a7b8-...",
  "image_uuid": "c9d0e1f2-...",
  "image_url": "/img/c9d0e1f2-....jpg",
  "face_box": { "x": 100, "y": 60, "w": 180, "h": 190 }
}
```

---

### 3.3 Query — Find Matching Faces (image saved)

Search the database for faces matching the uploaded image. **The query image is permanently saved** to the CDN.

**`POST /faces/query`**

- **Auth required:** Yes
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `image` | file | ✅ | — | Query image |
| `limit` | integer | ❌ | `10` | Max number of matches to return (1–100) |

Matches are filtered to a cosine similarity score ≥ **0.65** (configurable on the server via `MATCH_THRESHOLD`).

**Example (curl):**
```bash
curl -X POST http://localhost:8000/faces/query \
  -H "X-API-Key: 3f8a1b2c..." \
  -F "image=@/path/to/query.jpg" \
  -F "limit=5"
```

**Example (Python):**
```python
with open("query.jpg", "rb") as f:
    resp = requests.post(
        "http://localhost:8000/faces/query",
        headers=HEADERS,
        data={"limit": 5},
        files={"image": ("query.jpg", f, "image/jpeg")},
    )

result = resp.json()
for match in result["matches"]:
    print(match["person_uuid"], match["confidence_score"])
```

**Response:**
```json
{
  "query_image_uuid": "d1e2f3a4-...",
  "query_image_url": "/img/d1e2f3a4-....jpg",
  "face_box": { "x": 95, "y": 40, "w": 210, "h": 225 },
  "matches": [
    {
      "face_uuid": "a1b2c3d4-...",
      "person_uuid": "user-123e4567-...",
      "image_uuid": "f5e6d7c8-...",
      "image_url": "/img/f5e6d7c8-....jpg",
      "confidence_score": 0.923145
    }
  ]
}
```

---

### 3.4 Query Temp — Find Matching Faces (image not saved)

Same as `/faces/query` but the uploaded image is **never written to disk** — processed in memory only.

**`POST /faces/query-temp`**

- **Auth required:** Yes
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `image` | file | ✅ | — | Query image (discarded after processing) |
| `limit` | integer | ❌ | `10` | Max matches to return (1–100) |

**Response:**
```json
{
  "face_box": { "x": 95, "y": 40, "w": 210, "h": 225 },
  "matches": [
    {
      "face_uuid": "a1b2c3d4-...",
      "person_uuid": "user-123e4567-...",
      "image_uuid": "f5e6d7c8-...",
      "image_url": "/img/f5e6d7c8-....jpg",
      "confidence_score": 0.923145
    }
  ]
}
```

> Use this variant for **privacy-sensitive queries** (e.g., live camera frames) where you don't want images stored.

---

### 3.5 Pickout — Detect All Faces in an Image (image saved)

Detect **every face** in a scene image, match each one against the database, and auto-register any unknown faces. The image is permanently saved.

**`POST /faces/pickout`**

- **Auth required:** Yes
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `image` | file | ✅ | — | Scene image (may contain multiple faces) |
| `limit` | integer | ❌ | `10` | Max DB matches to return per detected face (1–100) |
| `max_faces` | integer | ❌ | `10` | Max faces to extract from the image (1–100), sorted by detection confidence |

**Behavior:**
- Each detected face is compared against all stored embeddings.
- **Matched faces** → returns top `limit` DB hits, with the best match highlighted as `person_uuid`/`face_uuid`.
- **Unmatched faces** → automatically registered as new anonymous identities linked to the uploaded image (`registered: true`).

**Example (curl):**
```bash
curl -X POST http://localhost:8000/faces/pickout \
  -H "X-API-Key: 3f8a1b2c..." \
  -F "image=@/path/to/group_photo.jpg" \
  -F "limit=5" \
  -F "max_faces=20"
```

**Response:**
```json
{
  "query_image_uuid": "b2c3d4e5-...",
  "query_image_url": "/img/b2c3d4e5-....jpg",
  "faces_detected": 3,
  "results": [
    {
      "face_index": 0,
      "box": { "x": 50, "y": 30, "w": 120, "h": 130 },
      "detection_confidence": 0.998,
      "matched": true,
      "registered": false,
      "person_uuid": "user-123e4567-...",
      "face_uuid": "a1b2c3d4-...",
      "matches": [
        {
          "face_uuid": "a1b2c3d4-...",
          "person_uuid": "user-123e4567-...",
          "image_uuid": "f5e6d7c8-...",
          "image_url": "/img/f5e6d7c8-....jpg",
          "confidence_score": 0.931
        }
      ]
    },
    {
      "face_index": 1,
      "box": { "x": 300, "y": 45, "w": 100, "h": 115 },
      "detection_confidence": 0.987,
      "matched": false,
      "registered": true,
      "person_uuid": "new-auto-uuid-...",
      "face_uuid": "new-auto-face-...",
      "matches": []
    }
  ]
}
```

---

### 3.6 Pickout Temp — Detect All Faces in an Image (image not saved)

Same as `/faces/pickout` but the image is discarded after processing. Unknown faces receive temporary UUIDs but are **not** saved to the database.

**`POST /faces/pickout-temp`**

- **Auth required:** Yes
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `image` | file | ✅ | — | Scene image (discarded after processing) |
| `limit` | integer | ❌ | `10` | Max DB matches per face (1–100) |
| `max_faces` | integer | ❌ | `10` | Max faces to process from the image (1–100) |

**Response:** Same structure as `/faces/pickout` but without `query_image_uuid` / `query_image_url`, and unknown faces have `registered: false`.

```json
{
  "faces_detected": 2,
  "results": [
    {
      "face_index": 0,
      "box": { "x": 50, "y": 30, "w": 120, "h": 130 },
      "detection_confidence": 0.998,
      "matched": true,
      "registered": false,
      "person_uuid": "user-123e4567-...",
      "face_uuid": "a1b2c3d4-...",
      "matches": [ ... ]
    },
    {
      "face_index": 1,
      "box": { "x": 300, "y": 45, "w": 100, "h": 115 },
      "detection_confidence": 0.977,
      "matched": false,
      "registered": false,
      "person_uuid": "temp-uuid-...",
      "face_uuid": "temp-face-...",
      "matches": []
    }
  ]
}
```

> Use this for **real-time scene analysis** (e.g., video frames) where you want identification results without any storage side effects.

---

### 3.7 Merge Two Identities

Combine two separate identity records into one. All face records from the secondary identity are moved to the primary identity, and the secondary person record is deleted.

**`POST /faces/merge`**

- **Auth required:** Yes
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `face_uuid_1` | string | ✅ | **Primary** face UUID — the identity to keep |
| `face_uuid_2` | string | ✅ | **Secondary** face UUID — will be merged into primary |

**Example (curl):**
```bash
curl -X POST http://localhost:8000/faces/merge \
  -H "X-API-Key: 3f8a1b2c..." \
  -F "face_uuid_1=a1b2c3d4-..." \
  -F "face_uuid_2=e5f6a7b8-..."
```

**Response:**
```json
{
  "combined_uuid": "a1b2c3d4-...",
  "person_uuid": "user-123e4567-..."
}
```

If both faces already belong to the same person:
```json
{
  "combined_uuid": "a1b2c3d4-...",
  "person_uuid": "user-123e4567-...",
  "message": "Faces already belong to the same identity; no action taken."
}
```

---

### 3.8 Get Images for a Person

Retrieve all face images registered under a given person UUID.

**`GET /api/person/{person_uuid}/images`**

- **Auth required:** Yes
- **Path parameter:** `person_uuid`

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `10` | Max images to return (1–200) |
| `order` | string | `newest` | Sort order: `newest` or `oldest` |

**Example (curl):**
```bash
curl "http://localhost:8000/api/person/user-123e4567-.../images?limit=20&order=oldest" \
  -H "X-API-Key: 3f8a1b2c..."
```

**Example (Python):**
```python
resp = requests.get(
    "http://localhost:8000/api/person/user-123e4567-.../images",
    headers=HEADERS,
    params={"limit": 20, "order": "oldest"},
)
```

**Response:**
```json
{
  "person_uuid": "user-123e4567-...",
  "name": "Alice",
  "total_faces": 5,
  "returned": 5,
  "order": "oldest",
  "images": [
    {
      "face_uuid": "a1b2c3d4-...",
      "image_uuid": "f5e6d7c8-...",
      "image_url": "/img/f5e6d7c8-....jpg",
      "created_at": "2025-01-15T10:30:00"
    }
  ]
}
```

---

### 3.9 Delete a Person

Permanently delete a person and all associated face embeddings and image files. **Irreversible.**

**`DELETE /api/person/{person_uuid}`**

- **Auth required:** Yes
- **Path parameter:** `person_uuid`

**Example (curl):**
```bash
curl -X DELETE http://localhost:8000/api/person/user-123e4567-... \
  -H "X-API-Key: 3f8a1b2c..."
```

**Response:**
```json
{
  "deleted": true,
  "person_uuid": "user-123e4567-...",
  "faces_removed": 3,
  "images_deleted": ["f5e6d7c8-...", "c3d4e5f6-...", "a9b0c1d2-..."],
  "image_delete_errors": []
}
```

---

## 4. Admin Endpoints

All admin endpoints require the `X-API-Key` header.

---

### 4.1 Dashboard Stats

Returns high-level counts for a dashboard view.

**`GET /api/admin/stats`**

- **Auth required:** Yes

**Example (curl):**
```bash
curl http://localhost:8000/api/admin/stats \
  -H "X-API-Key: 3f8a1b2c..."
```

**Response:**
```json
{
  "total_faces": 1452,
  "total_images": 1100,
  "total_people": 305
}
```

---

### 4.2 Pending Low-Confidence Matches

Returns face pairs where the cosine similarity falls between **0.65** and **0.80** — possible duplicates that warrant human review. Useful for building a "review and merge" workflow in your application.

**`GET /api/admin/pending-matches`**

- **Auth required:** Yes

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `50` | Max pairs to return (1–200) |

**Example (curl):**
```bash
curl "http://localhost:8000/api/admin/pending-matches?limit=20" \
  -H "X-API-Key: 3f8a1b2c..."
```

**Response:**
```json
[
  {
    "face_a": {
      "face_uuid": "a1b2c3d4-...",
      "person_uuid": "user-111-...",
      "image_uuid": "img-aaa-...",
      "image_url": "/img/img-aaa-....jpg"
    },
    "face_b": {
      "face_uuid": "e5f6a7b8-...",
      "person_uuid": "user-222-...",
      "image_uuid": "img-bbb-...",
      "image_url": "/img/img-bbb-....jpg"
    },
    "confidence_score": 0.731452
  }
]
```

> Results are sorted by `confidence_score` descending (highest confidence first).

---

### 4.3 List People (Paginated)

Returns a paginated list of all Person records with face counts and thumbnail URLs.

**`GET /api/admin/people`**

- **Auth required:** Yes

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer | `1` | Page number (1-indexed) |
| `page_size` | integer | `25` | Results per page (1–100) |

**Example (curl):**
```bash
curl "http://localhost:8000/api/admin/people?page=2&page_size=10" \
  -H "X-API-Key: 3f8a1b2c..."
```

**Response:**
```json
{
  "total": 305,
  "page": 2,
  "page_size": 10,
  "total_pages": 31,
  "people": [
    {
      "person_uuid": "user-123e4567-...",
      "name": "Alice",
      "face_count": 5,
      "thumbnail_url": "/img/f5e6d7c8-....jpg",
      "created_at": "2025-01-15T10:30:00"
    }
  ]
}
```

---

### 4.4 Search People by UUID

Search for persons whose UUID contains the given query string.

**`GET /api/admin/people/search`**

- **Auth required:** Yes

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `q` | string | ✅ | — | UUID substring to search for |
| `limit` | integer | ❌ | `25` | Max results (1–100) |

**Example (curl):**
```bash
curl "http://localhost:8000/api/admin/people/search?q=123e4567&limit=5" \
  -H "X-API-Key: 3f8a1b2c..."
```

**Response:**
```json
{
  "results": [
    {
      "person_uuid": "user-123e4567-...",
      "name": "Alice",
      "face_count": 5,
      "thumbnail_url": "/img/f5e6d7c8-....jpg",
      "created_at": "2025-01-15T10:30:00"
    }
  ],
  "count": 1
}
```

---

## 5. Static Assets

Images uploaded to PRM-Face are served directly via the built-in CDN. No auth is required to fetch image files.

| Route | Description |
|---|---|
| `GET /img/{image_uuid}.jpg` | Retrieve a stored image by its UUID |
| `GET /ui/` | Admin web UI (login, setup, dashboard) |

**Example:**
```html
<img src="http://localhost:8000/img/f5e6d7c8-c3d4-e5f6-a7b8-c9d0e1f2a3b4.jpg" />
```

> Image URLs returned in API responses (e.g., `image_url: "/img/..."`) are **relative paths**. Prepend your server's base URL to construct a full URL.

---

## 6. Response Reference: Common Objects

### `face_box`
Bounding box of the detected face within the image (pixel coordinates):
```json
{
  "x": 120,
  "y": 45,
  "w": 200,
  "h": 220
}
```
- `x`, `y` — top-left corner of the bounding box
- `w`, `h` — width and height of the bounding box

### Match object (in `matches[]` arrays)
```json
{
  "face_uuid": "a1b2c3d4-...",
  "person_uuid": "user-123e4567-...",
  "image_uuid": "f5e6d7c8-...",
  "image_url": "/img/f5e6d7c8-....jpg",
  "confidence_score": 0.923145
}
```
- `confidence_score` — cosine similarity between 0.0 and 1.0
  - `≥ 0.80` — strong match
  - `0.65–0.80` — acceptable / uncertain (shown in pending-matches review)
  - `< 0.65` — filtered out (not returned)

### Person object (in admin list/search responses)
```json
{
  "person_uuid": "user-123e4567-...",
  "name": "Alice",
  "face_count": 5,
  "thumbnail_url": "/img/f5e6d7c8-....jpg",
  "created_at": "2025-01-15T10:30:00"
}
```

---

## 7. Error Reference

| HTTP Status | Meaning | Common Cause |
|---|---|---|
| `400` | Bad Request | No face detected in image, invalid image format, missing required field |
| `401` | Unauthorized | Missing or invalid `X-API-Key` header |
| `403` | Forbidden | API key has been revoked |
| `404` | Not Found | Person UUID or Face UUID does not exist |
| `422` | Unprocessable Entity | Missing required form field or wrong data type |

**Error response format:**
```json
{
  "detail": "No face detected in the provided image."
}
```

For partial failures (e.g., some images fail in `/faces/with-name`):
```json
{
  "detail": {
    "message": "No faces could be registered.",
    "errors": [
      { "filename": "bad_file.txt", "detail": "Uploaded file is not a recognised image." }
    ]
  }
}
```

---

## 8. End-to-End Example (Python)

```python
import requests

BASE_URL = "http://localhost:8000"
SETUP_CODE = "a3f8c2d1e9b076541234567890abcdef"  # from server stdout

# ── Step 1: Get an API key ────────────────────────────────────────────────────
resp = requests.post(f"{BASE_URL}/api/get-api-key", data={
    "setup_code": SETUP_CODE,
    "label": "my-app",
})
resp.raise_for_status()
data = resp.json()
API_KEY = data["api_key"]
KEY_ID  = data["key_id"]
print(f"API key obtained. key_id={KEY_ID}")

HEADERS = {"X-API-Key": API_KEY}

# ── Step 2: Register a known person with two images ───────────────────────────
PERSON_UUID = "550e8400-e29b-41d4-a716-446655440001"

with open("alice1.jpg", "rb") as f1, open("alice2.jpg", "rb") as f2:
    resp = requests.post(
        f"{BASE_URL}/faces/with-name",
        headers=HEADERS,
        data={"person_uuid": PERSON_UUID, "name": "Alice"},
        files=[
            ("images", ("alice1.jpg", f1, "image/jpeg")),
            ("images", ("alice2.jpg", f2, "image/jpeg")),
        ],
    )
resp.raise_for_status()
print(f"Registered {resp.json()['registered_count']} faces for Alice.")

# ── Step 3: Query with a new photo ────────────────────────────────────────────
with open("query_photo.jpg", "rb") as f:
    resp = requests.post(
        f"{BASE_URL}/faces/query-temp",
        headers=HEADERS,
        data={"limit": 3},
        files={"image": ("query_photo.jpg", f, "image/jpeg")},
    )
resp.raise_for_status()
result = resp.json()

if result["matches"]:
    top = result["matches"][0]
    print(f"Best match: person_uuid={top['person_uuid']}, score={top['confidence_score']:.3f}")
else:
    print("No match found.")

# ── Step 4: Scan a group photo for all faces ──────────────────────────────────
with open("group_photo.jpg", "rb") as f:
    resp = requests.post(
        f"{BASE_URL}/faces/pickout-temp",
        headers=HEADERS,
        data={"limit": 5, "max_faces": 20},
        files={"image": ("group_photo.jpg", f, "image/jpeg")},
    )
resp.raise_for_status()
pickout = resp.json()
print(f"Detected {pickout['faces_detected']} faces in the group photo.")
for face in pickout["results"]:
    status = "MATCHED" if face["matched"] else "UNKNOWN"
    print(f"  Face {face['face_index']}: {status} | box={face['box']}")

# ── Step 5: Merge two duplicate identities ────────────────────────────────────
resp = requests.post(
    f"{BASE_URL}/faces/merge",
    headers=HEADERS,
    data={"face_uuid_1": "primary-face-uuid", "face_uuid_2": "duplicate-face-uuid"},
)
resp.raise_for_status()
print(f"Merged → combined person_uuid={resp.json()['person_uuid']}")
```

---

## 9. End-to-End Example (JavaScript / fetch)

```javascript
const BASE_URL = "http://localhost:8000";
const SETUP_CODE = "a3f8c2d1e9b076541234567890abcdef"; // from server stdout

// ── Step 1: Get an API key ──────────────────────────────────────────────────
async function getApiKey() {
  const form = new FormData();
  form.append("setup_code", SETUP_CODE);
  form.append("label", "my-js-app");

  const resp = await fetch(`${BASE_URL}/api/get-api-key`, {
    method: "POST",
    body: form,
  });
  const data = await resp.json();
  console.log("API key:", data.api_key);
  return data.api_key;
}

// ── Step 2: Register a face ─────────────────────────────────────────────────
async function registerFace(apiKey, imageFile, personUuid, name) {
  const form = new FormData();
  form.append("images", imageFile);
  form.append("person_uuid", personUuid);
  form.append("name", name);

  const resp = await fetch(`${BASE_URL}/faces/with-name`, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: form,
  });
  return resp.json();
}

// ── Step 3: Query with a photo file (from <input type="file">) ──────────────
async function queryFace(apiKey, imageFile) {
  const form = new FormData();
  form.append("image", imageFile);
  form.append("limit", "5");

  const resp = await fetch(`${BASE_URL}/faces/query-temp`, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: form,
  });
  const result = await resp.json();

  if (result.matches.length > 0) {
    const top = result.matches[0];
    console.log(`Best match: ${top.person_uuid} (score: ${top.confidence_score.toFixed(3)})`);
  } else {
    console.log("No match found.");
  }
  return result;
}

// ── Step 4: Scan a group image for all faces ────────────────────────────────
async function pickoutFaces(apiKey, imageFile) {
  const form = new FormData();
  form.append("image", imageFile);
  form.append("limit", "5");
  form.append("max_faces", "20");

  const resp = await fetch(`${BASE_URL}/faces/pickout-temp`, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: form,
  });
  const result = await resp.json();
  console.log(`Detected ${result.faces_detected} faces`);
  return result;
}

// ── Example usage ──────────────────────────────────────────────────────────
(async () => {
  const apiKey = await getApiKey();

  // Use a file input element: const file = document.getElementById("fileInput").files[0];
  // For demonstration, assume `file` is a File object from a form input.
})();
```

---

*For questions or issues, check the interactive docs at `http://localhost:8000/docs` or review the server source in `main.py`.*
