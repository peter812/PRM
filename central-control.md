# Central Control Server

A centralized webserver that holds the authoritative truth of social account data for PRM servers to access.

---

## Overview

The Central Control Server acts as a single source of truth for social profile data. PRM servers query this server to retrieve, submit, and manage social account profiles. It maintains current profile snapshots, tracks historical changes over time, logs all API activity, and stores profile images locally.

---

## Database

### Tables

#### `social_profiles` — Current Profile Snapshot

Stores the latest version of each social profile.

| Column            | Type         | Description                                      |
|-------------------|--------------|--------------------------------------------------|
| `id`              | UUID / PK    | Unique identifier for the profile                |
| `platform`        | TEXT         | Social platform name (e.g. Twitter, LinkedIn)    |
| `platform_id`     | TEXT         | The account's ID on the platform                 |
| `username`        | TEXT         | Current username / handle                        |
| `display_name`    | TEXT         | Current display name                             |
| `bio`             | TEXT         | Current bio / description                        |
| `profile_img_path`| TEXT         | Path to the locally stored profile image         |
| `followers`       | INTEGER      | Current follower count                           |
| `following`       | INTEGER      | Current following count                          |
| `metadata`        | JSONB        | Any additional platform-specific fields          |
| `last_updated`    | TIMESTAMP    | When this snapshot was last refreshed            |
| `created_at`      | TIMESTAMP    | When the profile was first added                 |

#### `social_profile_changes` — Profile Changes Over Time

Stores a historical record of every change detected on a profile.

| Column            | Type         | Description                                      |
|-------------------|--------------|--------------------------------------------------|
| `id`              | UUID / PK    | Unique identifier for this change record         |
| `profile_id`      | UUID / FK    | References `social_profiles.id`                  |
| `field_changed`   | TEXT         | Name of the field that changed                   |
| `old_value`       | TEXT         | Previous value                                   |
| `new_value`       | TEXT         | New value                                        |
| `changed_at`      | TIMESTAMP    | When the change was detected                     |

#### `audit_log` — Server Audit Log

Logs every API call made to the server and the server's response.

| Column            | Type         | Description                                      |
|-------------------|--------------|--------------------------------------------------|
| `id`              | UUID / PK    | Unique identifier for this log entry             |
| `timestamp`       | TIMESTAMP    | When the call was made                           |
| `endpoint`        | TEXT         | The API endpoint that was called                 |
| `method`          | TEXT         | HTTP method (GET, POST, DELETE, etc.)            |
| `caller_key_id`   | UUID / FK    | References `api_keys.id` — who made the call     |
| `request_body`    | JSONB        | The request payload (if any)                     |
| `response_status` | INTEGER      | HTTP status code returned                        |
| `response_body`   | JSONB        | The response payload returned                    |

#### `api_keys` — API Key Management

Stores all standard API keys and their status.

| Column            | Type         | Description                                      |
|-------------------|--------------|--------------------------------------------------|
| `id`              | UUID / PK    | Unique identifier for this key                   |
| `key`             | TEXT         | The API key string (unique)                      |
| `label`           | TEXT         | Optional human-readable label for the key        |
| `is_active`       | BOOLEAN      | Whether the key is currently active              |
| `created_at`      | TIMESTAMP    | When the key was generated                       |
| `disabled_at`     | TIMESTAMP    | When the key was disabled (null if still active)  |

---

## Authentication

There are two tiers of API access: **Standard** and **Privileged**.

### Admin Key

- Passed in via the `.ENV` file at server startup.
- Static — cannot be changed at runtime.
- Required for all privileged API calls.
- Used to generate and revoke standard keys.

### Standard Key

- Generated via a privileged API call (`KeyGen`) using the admin key.
- Stored in the `api_keys` table.
- Required for all standard API calls.
- Can be revoked: when a key is deleted, it is **not removed** from the database — it is set to `is_active = false` (disabled).

### How Keys Are Passed

All API calls must include the key in the `Authorization` header:

```
Authorization: Bearer <key>
```

The server checks:
1. If the key matches the admin key in `.ENV` — grant privileged access.
2. If the key exists in the `api_keys` table and `is_active = true` — grant standard access.
3. Otherwise — reject with `401 Unauthorized`.

---

## API Endpoints

### Standard Calls

These require a valid **standard key** (or admin key).

#### `POST /api/profile` — Send Profile

Submit or update a social profile. If the profile already exists (matched by `platform` + `platform_id`), the server updates the snapshot and records any field changes in `social_profile_changes`.

**Request Body:**
```json
{
  "platform": "twitter",
  "platform_id": "12345",
  "username": "johndoe",
  "display_name": "John Doe",
  "bio": "Software developer",
  "followers": 1500,
  "following": 300,
  "metadata": {},
  "profile_img_base64": "<base64 encoded image or null>"
}
```

**Response:**
```json
{
  "status": "created" | "updated",
  "profile_id": "uuid"
}
```

#### `GET /api/profile/state?platform=<platform>&platform_id=<platform_id>` — Get Profile State

Check whether a profile exists in the central database.

**Response:**
```json
{
  "exists": true | false,
  "profile_id": "uuid" | null,
  "last_updated": "timestamp" | null
}
```

#### `GET /api/profile/:id/complete` — Fetch Complete Profile

Returns the full profile snapshot **plus** all historical changes.

**Response:**
```json
{
  "profile": { ... },
  "changes": [
    {
      "field_changed": "bio",
      "old_value": "Old bio text",
      "new_value": "New bio text",
      "changed_at": "timestamp"
    }
  ]
}
```

#### `GET /api/profile/:id/snapshot` — Fetch Snap Profile

Returns only the latest profile snapshot (no history).

**Response:**
```json
{
  "profile": { ... }
}
```

#### `GET /api/profiles` — Fetch List

Returns a list of all profiles stored in the database.

**Response:**
```json
{
  "profiles": [
    {
      "id": "uuid",
      "platform": "twitter",
      "platform_id": "12345",
      "username": "johndoe",
      "display_name": "John Doe",
      "last_updated": "timestamp"
    }
  ]
}
```

---

### Privileged Calls

These require the **admin key**.

#### `DELETE /api/profile/:id` — Delete Profile

Deletes a profile and all of its associated history from the database.

**Response:**
```json
{
  "status": "deleted",
  "profile_id": "uuid"
}
```

#### `DELETE /api/profile/:id/history` — Delete Profile History

Deletes only the historical change records for a profile. The current snapshot remains.

**Response:**
```json
{
  "status": "history_deleted",
  "profile_id": "uuid"
}
```

#### `DELETE /api/profile/:id/image` — Delete Profile Image

Deletes the profile image from local storage and clears the `profile_img_path` field.

**Response:**
```json
{
  "status": "image_deleted",
  "profile_id": "uuid"
}
```

#### `GET /api/audit-log` — Query Audit Log

Returns a log of all API calls made to the server and how the server responded.

Supports optional query parameters for filtering:
- `?from=<timestamp>` — entries after this time
- `?to=<timestamp>` — entries before this time
- `?endpoint=<endpoint>` — filter by endpoint
- `?caller_key_id=<uuid>` — filter by caller

**Response:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "timestamp": "timestamp",
      "endpoint": "/api/profile",
      "method": "POST",
      "caller_key_id": "uuid",
      "request_body": { ... },
      "response_status": 200,
      "response_body": { ... }
    }
  ]
}
```

#### `POST /api/keys` — KeyGen *(optional)*

Generates a new standard API key.

**Request Body:**
```json
{
  "label": "PRM Server East"
}
```

**Response:**
```json
{
  "key_id": "uuid",
  "key": "generated-api-key-string"
}
```

#### `DELETE /api/keys/:id` — Key Delete

Disables a standard API key. The key is **not removed** from the database — it is set to `is_active = false`.

**Response:**
```json
{
  "status": "disabled",
  "key_id": "uuid"
}
```

#### `POST /api/connect` — Connect

Generates a temporary admin-level key for short-lived privileged access.

**Response:**
```json
{
  "temp_admin_key": "generated-temp-key",
  "expires_at": "timestamp"
}
```

---

## Local Image Storage

Profile images are stored on the server's local filesystem.

- **Storage directory:** `./storage/profile-images/`
- **File naming:** `<profile_id>.<extension>` (e.g. `a1b2c3d4.jpg`)
- **Access:** Images are served statically via `GET /storage/profile-images/<filename>`
- **Upload:** Images are submitted as base64-encoded strings in the `POST /api/profile` request body. The server decodes and saves them to disk.
- **Deletion:** The `DELETE /api/profile/:id/image` privileged endpoint removes the file from disk and clears the database reference.

---

## Environment Variables

| Variable         | Description                                  |
|------------------|----------------------------------------------|
| `ADMIN_KEY`      | The static admin API key for privileged access |
| `DATABASE_URL`   | Connection string for the SQL database        |
| `PORT`           | Port the server listens on (default: 3000)    |
| `STORAGE_PATH`   | Path for local image storage (default: `./storage/profile-images/`) |

---

## Error Responses

All error responses follow a consistent format:

```json
{
  "error": "Short error code",
  "message": "Human-readable description"
}
```

| Status Code | Error Code         | When                                          |
|-------------|--------------------|-----------------------------------------------|
| 401         | `UNAUTHORIZED`     | Missing or invalid API key                    |
| 403         | `FORBIDDEN`        | Standard key used on a privileged endpoint    |
| 404         | `NOT_FOUND`        | Profile or resource not found                 |
| 400         | `BAD_REQUEST`      | Invalid or missing request body fields        |
| 500         | `INTERNAL_ERROR`   | Server-side failure                           |
