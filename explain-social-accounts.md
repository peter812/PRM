# Social Accounts Data Model

This document explains how social accounts and their surrounding data are stored and managed in the application.

---

## Database Tables

### `social_account_types`

Defines the platform categories that social accounts can belong to.

| Column      | Type        | Description                          |
|-------------|-------------|--------------------------------------|
| `id`        | VARCHAR (PK)| UUID, auto-generated                 |
| `name`      | TEXT        | Platform name (e.g. "Instagram")     |
| `color`     | TEXT        | Hex color code for UI display        |
| `created_at`| TIMESTAMP   | Auto-set on creation                 |

**Default seeded types:**

| Name      | Color     |
|-----------|-----------|
| Instagram | `#E4405F` |
| Facebook  | `#1877F2` |
| Discord   | `#5865F2` |
| X.com     | `#000000` |
| Generic   | `#6b7280` |

These defaults are inserted on first database initialization and on database reset. Custom types can be created by the user.

---

### `social_accounts`

The main table storing individual social media accounts.

| Column                           | Type            | Description                                                                 |
|----------------------------------|-----------------|-----------------------------------------------------------------------------|
| `id`                             | VARCHAR (PK)    | UUID, auto-generated                                                        |
| `username`                       | TEXT            | The account's username on the platform                                      |
| `nickname`                       | TEXT (nullable) | Display name or full name associated with the account                       |
| `account_url`                    | TEXT            | URL to the account's profile page                                           |
| `owner_uuid`                     | VARCHAR (FK)    | References `people.id`. Links this account to a person. Cascade deletes.    |
| `type_id`                        | VARCHAR (FK)    | References `social_account_types.id`. Set to NULL if the type is deleted.   |
| `image_url`                      | TEXT (nullable) | URL to the account's profile image, stored on S3/CDN after processing       |
| `notes`                          | TEXT (nullable) | Free-text notes (e.g. "Instagram ID: 12345")                               |
| `following`                      | TEXT[]          | Array of social account UUIDs that this account follows                     |
| `followers`                      | TEXT[]          | Array of social account UUIDs that follow this account                      |
| `internal_account_creation_date` | TIMESTAMP       | When this record was created in the system                                  |
| `internal_account_creation_type` | TEXT            | How the record was created (e.g. "User", "johndoe import")                  |
| `latest_import_followers`        | TIMESTAMP       | When followers were last imported for this account                          |
| `latest_import_following`        | TIMESTAMP       | When following data was last imported for this account                      |
| `created_at`                     | TIMESTAMP       | Auto-set on creation                                                        |

---

### `tasks`

Background task queue used for long-running operations like downloading profile images.

| Column        | Type            | Description                                                        |
|---------------|-----------------|--------------------------------------------------------------------|
| `id`          | VARCHAR (PK)    | UUID, auto-generated                                               |
| `type`        | TEXT            | Task type identifier (currently `get_img`)                         |
| `status`      | TEXT            | One of: `pending`, `in_progress`, `completed`, `failed`            |
| `payload`     | TEXT            | JSON string with task-specific input data                          |
| `result`      | TEXT (nullable) | JSON string with task output or error message                      |
| `created_at`  | TIMESTAMP       | When the task was queued                                           |
| `started_at`  | TIMESTAMP       | When the task worker began processing                              |
| `completed_at`| TIMESTAMP       | When the task finished (success or failure)                        |

---

## Connections to People

Social accounts are linked to people through two mechanisms:

1. **`social_accounts.owner_uuid`** -- A foreign key on the social account pointing to a person's `id`. If the person is deleted, the social account is cascade-deleted.

2. **`people.social_account_uuids`** -- A text array on the person record storing the UUIDs of their linked social accounts. This is the primary lookup used in the application to find which accounts belong to a person.

3. **`people.no_social_media`** -- An integer flag (0 or 1). When set to 1, indicates the person has been explicitly marked as having no social media presence, which excludes them from the account matching workflow.

---

## Follower/Following Relationships

Social-to-social relationships are stored directly on the `social_accounts` table using two array columns:

- **`following`**: Array of social account UUIDs that this account follows.
- **`followers`**: Array of social account UUIDs that follow this account.

These arrays are updated during Instagram CSV imports based on the `followed_by_viewer` field in the CSV data and the chosen import type (followers vs. following).

---

## Messages

The `messages` table can reference social accounts. A message with `type = 'social'` uses social account UUIDs in its `sender` and `receivers` fields, linking conversations to specific social accounts.

---

## Image Processing Pipeline

When social accounts are imported (e.g. from an Instagram CSV), profile image URLs from the source platform are not stored directly. Instead, they go through a background processing pipeline:

1. **Task Creation** -- During import, a `get_img` task is created for each account that has a profile image URL. The task payload contains the `socialAccountId` and the source `imageUrl`. Tasks are only created for accounts without an existing `image_url`, unless the "Force Update Images" option is enabled.

2. **Task Worker** -- A background worker (`server/task-worker.ts`) picks up pending tasks and processes them sequentially:
   - Downloads the image from the source URL using a mobile Safari User-Agent header (required for Instagram compatibility).
   - Writes the image to a temporary file.
   - Uploads the image to S3-compatible storage via the S3 client.
   - Deletes the temporary local file.
   - Updates the social account's `image_url` column with the resulting CDN URL.

3. **Rate Limiting** -- The worker enforces a 1-second delay between processing consecutive image download tasks to avoid triggering rate limits on source platforms.

4. **Polling** -- When all pending tasks are processed, the worker polls every 60 seconds for new tasks. When a new batch of tasks is created (e.g. during an import), the worker is immediately triggered.

---

## Import Mechanisms

### Instagram CSV Import

Endpoint: `POST /api/import-instagram`

Accepts a CSV file with semicolon-delimited fields. For each row:
- If the username already exists, the account is updated (nickname, and optionally a new image download task).
- If the username is new, a new social account is created with the `instagram` type and a `get_img` task is queued.
- Follower/following arrays on the target account are updated based on the `followed_by_viewer` CSV field.

Options:
- **Import Type**: `followers` or `following`, determining how the relationship data is applied.
- **Force Update Images**: When enabled, creates image download tasks for all accounts in the import, even those that already have an `image_url`.

### XML Import/Export

Social accounts and their types can be exported to and imported from XML as part of the full data backup system. UUIDs are preserved across import/export. Images are not included in XML exports -- only the CDN URLs stored in `image_url`.

### Manual Creation

Social accounts can also be created manually through the UI, specifying username, URL, type, and optionally linking to a person.

---

## Account Matching

The account matching feature (`/account-matching`) helps link existing people records to unlinked social accounts:

1. The system finds people who have no linked social accounts and are not flagged as `noSocialMedia = 1`.
2. For each person, it scores unlinked social accounts by name similarity and presents 5-8 candidates.
3. The user can select accounts to connect (adds UUIDs to `people.social_account_uuids`), skip the person, or mark them as having no social media.

---

## API Endpoints

| Method   | Path                                          | Description                                      |
|----------|-----------------------------------------------|--------------------------------------------------|
| GET      | `/api/social-accounts`                        | List all accounts (optional search and type filter)|
| GET      | `/api/social-accounts/paginated`              | Paginated list with search, type, and offset/limit|
| GET      | `/api/social-accounts/:id`                    | Get a single account by ID                       |
| POST     | `/api/social-accounts`                        | Create a new account                             |
| PATCH    | `/api/social-accounts/:id`                    | Update an account                                |
| DELETE   | `/api/social-accounts/:id`                    | Delete an account                                |
| DELETE   | `/api/social-accounts/delete-all`             | Delete all accounts                              |
| GET      | `/api/social-accounts/:id/followers`          | Get follower accounts                            |
| POST     | `/api/social-accounts/:id/followers`          | Add a follower                                   |
| DELETE   | `/api/social-accounts/:id/followers/:fId`     | Remove a follower                                |
| POST     | `/api/social-accounts/:id/following`          | Add a following relationship                     |
| DELETE   | `/api/social-accounts/:id/following/:fId`     | Remove a following relationship                  |
| GET      | `/api/social-accounts/export-xml`             | Export all accounts and types as XML              |
| POST     | `/api/social-accounts/import-xml`             | Import accounts and types from XML                |
| POST     | `/api/import-instagram`                       | Import from Instagram CSV                         |
| GET      | `/api/account-matching/next`                  | Get next person for account matching              |
| POST     | `/api/account-matching/connect`               | Link social accounts to a person                  |
| POST     | `/api/account-matching/ignore`                | Mark a person as having no social media            |

---

## Deletion Behavior

- Deleting a **person** cascade-deletes any social accounts where `owner_uuid` matches that person.
- Deleting a **social account** removes its UUID from the `social_account_uuids` array of any linked person.
- Deleting a **social account type** sets `type_id` to NULL on all accounts of that type (via `ON DELETE SET NULL`).
- **Delete All** removes every social account and clears all `social_account_uuids` arrays across all people.
