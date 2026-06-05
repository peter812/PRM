# People Relationship Management (PRM) - External API Guide

## Overview

This guide documents the external REST API endpoints available for integrating with the PRM (People Relationship Management) application. These APIs allow external applications to interact with people, relationships, interactions, groups, social accounts, and other CRM data.

## Base URL

All API requests should be made to:
```
https://your-app-domain.replit.app/api
```

## Authentication

### Session-Based Authentication (Web UI)

For web-based integrations, the application uses session-based authentication via cookies:

1. **Login**: `POST /api/login`
2. **Logout**: `POST /api/logout`
3. **Check Auth Status**: `GET /api/user`

### API Key Authentication (Recommended for External Applications)

For programmatic access and third-party integrations, use API key authentication.

#### Creating an API Key

1. Log into the PRM web interface
2. Navigate to Settings (user profile menu)
3. Click "API Keys" tab
4. Generate a new API key with a descriptive name
5. Copy the generated key immediately (it won't be shown again)

#### Using API Keys

Include the API key in the `X-API-Key` header with each request:

```bash
curl -H "X-API-Key: your-api-key-here" \
  https://your-app-domain.replit.app/api/people
```

**Note**: API keys are hashed in the database and never exposed in data exports for security.

---

## Core Resources

### People

Manage contacts and individuals in your CRM.

#### List All People

```http
GET /api/people
```

**Query Parameters:**
- `includeRelationships` (optional): Set to `'true'` to include full relationship data for each person (default: `false`)

**Response:**
```json
[
  {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "company": "Tech Corp",
    "title": "Senior Developer",
    "tags": ["client", "technical"],
    "imageUrl": "https://...",
    "socialAccountUuids": ["uuid1"],
    "noSocialMedia": 0,
    "userId": null,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

**Examples:**
```bash
# Get all people
GET /api/people

# Get all people with their relationship data included
GET /api/people?includeRelationships=true
```

---

#### List People (Paginated)

```http
GET /api/people/paginated
```

**Query Parameters:**
- `offset` (optional): Starting position (default: `0`)
- `limit` (optional): Number of records to return (default: `30`)
- `sortByElo` (optional): Set to `'true'` to sort by ELO ranking score instead of relationship value (default: `false`)

**Response:**
```json
[
  {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "maxRelationshipValue": 80,
    "relationshipTypeName": "Best Friend",
    "relationshipTypeColor": "#ec4899",
    "eloScore": 1200,
    ...
  }
]
```

**Note**: By default, returns people sorted by their highest relationship value with the authenticated user (highest first), then alphabetically. Use `sortByElo=true` to sort by ELO score instead.

**Examples:**
```bash
# Get first 30 people
GET /api/people/paginated

# Get next page
GET /api/people/paginated?offset=30&limit=30

# Get top 10 people by ELO score
GET /api/people/paginated?limit=10&sortByElo=true
```

---

#### Search People

```http
GET /api/people/search
```

**Query Parameters:**
- `q` (required): Search query string — searches first name, last name, email, company, tags, etc.
- `creation_start_date` (optional): Filter people created on or after this date (ISO 8601 format)
- `creation_stop_date` (optional): Filter people created on or before this date (ISO 8601 format)
- `connected_to_me` (optional): Set to `'true'` to only return people who have a relationship with the authenticated user (ME)

**Response:** Array of people matching search criteria

**Examples:**
```bash
# Search for people named "john"
GET /api/people/search?q=john

# Search for people created in 2024
GET /api/people/search?q=john&creation_start_date=2024-01-01&creation_stop_date=2024-12-31

# Find anyone connected to ME user with "smith" in name
GET /api/people/search?q=smith&connected_to_me=true

# List all people created after a date (use empty q for broad match)
GET /api/people/search?q=&creation_start_date=2024-06-01
```

---

#### Get Person by ID

```http
GET /api/people/:id
```

**Response:**
```json
{
  "id": "uuid",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company": "Tech Corp",
  "title": "Senior Developer",
  "tags": ["client", "technical"],
  "imageUrl": "https://...",
  "socialAccountUuids": ["uuid1"],
  "noSocialMedia": 0,
  "notes": [...],
  "interactions": [...],
  "groups": [...],
  "relationships": [...]
}
```

---

#### Get Person's Activity Flow (Timeline)

Returns a paginated, unified timeline of all notes and interactions for a person, sorted newest-first.

```http
GET /api/people/:id/flow
```

**Query Parameters:**
- `limit` (optional): Number of items to return per page (default: `20`)
- `cursor` (optional): Pagination cursor from a previous response to fetch the next page

**Response:**
```json
{
  "items": [
    {
      "type": "note",
      "id": "uuid",
      "content": "...",
      "createdAt": "2024-01-15T10:00:00Z"
    },
    {
      "type": "interaction",
      "id": "uuid",
      "description": "...",
      "date": "2024-01-14T09:00:00Z"
    }
  ],
  "nextCursor": "cursor-string-or-null"
}
```

**Examples:**
```bash
# Get first page of activity for a person
GET /api/people/uuid/flow

# Get next page using cursor
GET /api/people/uuid/flow?cursor=abc123&limit=20
```

---

#### Create Person

```http
POST /api/people
Content-Type: application/json

{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@example.com",
  "phone": "+1234567890",
  "company": "Design Studio",
  "title": "Creative Director",
  "tags": ["designer", "freelance"],
  "imageUrl": null
}
```

**Required fields:** `firstName`, `lastName`

**Optional fields:** `email`, `phone`, `company`, `title`, `tags` (array of strings), `imageUrl`, `socialAccountUuids` (array of social account UUIDs)

**Response:** `201 Created` with person object

**Note:** Duplicate names are prevented — you cannot create two people with the same first and last name.

---

#### Update Person

```http
PATCH /api/people/:id
Content-Type: application/json

{
  "email": "newemail@example.com",
  "title": "Lead Designer",
  "tags": ["designer", "lead"],
  "socialAccountUuids": ["uuid1", "uuid2"],
  "noSocialMedia": 0
}
```

All fields are optional — only the fields you include will be updated.

**Response:** `200 OK` with updated person object

---

#### Delete Person

```http
DELETE /api/people/:id
```

**Response:** `200 OK` — `{ "success": true }`

**Note**: Cascade deletes associated notes, removes the person from groups, and cleans up relationships.

---

### ELO Ranking

The PRM includes an ELO-based ranking system to help you prioritize relationships through pairwise voting.

#### Get a Random Pair for ELO Voting

Returns two random people to compare for ELO ranking.

```http
GET /api/people/elo/pair
```

**Response:**
```json
[
  { "id": "uuid1", "firstName": "Alice", "lastName": "Smith", "eloScore": 1200, ... },
  { "id": "uuid2", "firstName": "Bob", "lastName": "Jones", "eloScore": 1150, ... }
]
```

---

#### Submit an ELO Vote

Submit the result of a pairwise comparison.

```http
POST /api/people/elo/vote
Content-Type: application/json

{
  "winnerId": "uuid1",
  "loserId": "uuid2"
}
```

**Response:** `200 OK` — updated ELO scores for both people

---

### Notes

Personal notes attached to people.

#### Get All Notes

```http
GET /api/notes
```

**Query Parameters:**
- `personId` (optional): Filter notes for a specific person

**Response:**
```json
[
  {
    "id": "uuid",
    "personId": "uuid",
    "personName": "John Doe",
    "content": "Important reminder about project deadline",
    "imageUrl": null,
    "createdAt": "2024-01-15T10:00:00Z"
  }
]
```

**Note**: When `personId` is omitted, returns all notes across all people, sorted newest-first. Each note includes a `personName` field with the full name of the associated person.

**Examples:**
```bash
# Get all notes across all people
GET /api/notes

# Get notes for a specific person
GET /api/notes?personId=uuid
```

---

#### Get Note by ID

```http
GET /api/notes/:id
```

**Response:**
```json
{
  "id": "uuid",
  "personId": "uuid",
  "content": "Important reminder about project deadline",
  "imageUrl": null,
  "createdAt": "2024-01-15T10:00:00Z"
}
```

---

#### Create Note

```http
POST /api/notes
Content-Type: application/json

{
  "personId": "uuid",
  "content": "Important reminder about project deadline"
}
```

**Response:** `201 Created` with note object

---

#### Delete Note

```http
DELETE /api/notes/:id
```

**Response:** `200 OK` — `{ "success": true }`

---

### Interactions

Track meetings, calls, emails, and other interactions.

#### Get Interactions

```http
GET /api/interactions
```

**Query Parameters:**
- `personId` (optional): Filter interactions that include a specific person
- `groupId` (optional): Filter interactions that include a specific group
- `isgroup` (optional): Set to `'true'` to return only interactions involving at least one group; `'false'` for interactions with no groups. Only applies when `personId` and `groupId` are both absent.
- `startDate` or `start_date` or `date_back` (optional): Filter interactions on or after this date (ISO 8601). All three parameter names are interchangeable.
- `endDate` or `end_date` (optional): Filter interactions on or before this date (ISO 8601). Both parameter names are interchangeable.
- `count_limit` (optional): Maximum number of results to return (applied after sorting and date filtering)

**Response:**
```json
[
  {
    "id": "uuid",
    "peopleIds": ["uuid1", "uuid2"],
    "groupIds": ["uuid1"],
    "typeId": "uuid",
    "title": "Q1 Planning",
    "date": "2024-01-15T10:00:00Z",
    "description": "Discussed Q1 project goals",
    "imageUrl": "https://...",
    "createdAt": "2024-01-15T11:00:00Z",
    "type": {
      "id": "uuid",
      "name": "Meeting",
      "color": "#3b82f6",
      "value": 70
    }
  }
]
```

**Note**: Results are sorted by date, newest first.

**Examples:**
```bash
# Get all interactions for a person
GET /api/interactions?personId=uuid

# Get all interactions for a group
GET /api/interactions?groupId=uuid

# Get interactions within a date range
GET /api/interactions?personId=uuid&startDate=2024-01-01&endDate=2024-12-31

# Get only group interactions
GET /api/interactions?isgroup=true

# Get recent interactions (limit to 10)
GET /api/interactions?personId=uuid&count_limit=10

# Get interactions since a date (date_back is an alias for startDate)
GET /api/interactions?date_back=2024-06-01
```

---

#### Create Interaction

```http
POST /api/interactions
Content-Type: application/json

{
  "peopleIds": ["uuid1", "uuid2"],
  "groupIds": ["uuid1"],
  "typeId": "uuid",
  "title": "Team standup",
  "date": "2024-01-15T10:00:00Z",
  "description": "Team standup meeting",
  "imageUrl": null
}
```

**Required fields:** `peopleIds` (array with minimum 2 people UUIDs), `date` (ISO 8601 timestamp)

**Optional fields:** `groupIds`, `typeId`, `title`, `description`, `imageUrl`

**Response:** `201 Created` with interaction object

---

#### Update Interaction

```http
PATCH /api/interactions/:id
Content-Type: application/json

{
  "description": "Updated description",
  "date": "2024-01-15T14:00:00Z",
  "title": "Updated title"
}
```

**Response:** `200 OK` with updated interaction object

---

#### Delete Interaction

```http
DELETE /api/interactions/:id
```

**Response:** `200 OK` — `{ "success": true }`

**Note:** Automatically attempts to delete any associated image from S3 storage.

---

### Relationships

Manage relationships between people.

#### Get Person's Relationships

```http
GET /api/relationships/:personId
```

**Query Parameters:**
- `count_limit` (optional): Maximum number of results to return
- `value_limit` (optional): Only return relationships whose type value is greater than or equal to this threshold (0–100)

**Response:**
```json
[
  {
    "id": "uuid",
    "fromPersonId": "uuid",
    "toPersonId": "uuid",
    "typeId": "uuid",
    "notes": "Met at conference 2023",
    "createdAt": "2024-01-01T00:00:00Z",
    "toPerson": {
      "id": "uuid",
      "firstName": "John",
      "lastName": "Doe"
    },
    "type": {
      "id": "uuid",
      "name": "Colleague",
      "color": "#f59e0b",
      "value": 30
    }
  }
]
```

**Note**: Returns bidirectional relationships (both where the person is `fromPersonId` and `toPersonId`), sorted by relationship type value (highest first), then by creation date.

**Examples:**
```bash
# Get all relationships for a person
GET /api/relationships/uuid

# Get only high-value relationships (type value >= 70)
GET /api/relationships/uuid?value_limit=70

# Get top 5 relationships
GET /api/relationships/uuid?count_limit=5

# Combine: top 3 close relationships only
GET /api/relationships/uuid?value_limit=60&count_limit=3
```

---

#### Create Relationship

```http
POST /api/relationships
Content-Type: application/json

{
  "fromPersonId": "uuid",
  "toPersonId": "uuid",
  "typeId": "uuid",
  "notes": "Met at tech conference"
}
```

**Required fields:** `fromPersonId`, `toPersonId`, `typeId`

**Optional fields:** `notes`

**Response:** `201 Created` with relationship object

---

#### Update Relationship

```http
PATCH /api/relationships/:id
Content-Type: application/json

{
  "typeId": "new-type-uuid",
  "notes": "Updated notes"
}
```

**Response:** `200 OK` with updated relationship object

---

#### Delete Relationship

```http
DELETE /api/relationships/:id
```

**Response:** `200 OK` — `{ "success": true }`

---

### Groups

Organize people into groups or teams.

#### List All Groups

```http
GET /api/groups
```

No query parameters — returns all groups.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Work Team",
    "color": "#3b82f6",
    "type": ["team", "project"],
    "members": ["uuid1", "uuid2", "uuid3"],
    "imageUrl": null,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

**Tip**: To search/filter groups by name, use the global search endpoint: `GET /api/search?q=team`

---

#### Get Group by ID

```http
GET /api/groups/:id
```

**Response:** Group object with populated member details and notes

---

#### Create Group

```http
POST /api/groups
Content-Type: application/json

{
  "name": "Project Alpha Team",
  "color": "#8b5cf6",
  "type": ["project"],
  "members": ["uuid1", "uuid2"],
  "imageUrl": null
}
```

**Required fields:** `name`

**Optional fields:** `color`, `type` (array of strings), `members` (array of person UUIDs), `imageUrl`

**Response:** `201 Created` with group object

---

#### Update Group

```http
PATCH /api/groups/:id
Content-Type: application/json

{
  "name": "Updated Team Name",
  "members": ["uuid1", "uuid2", "uuid3"],
  "color": "#10b981"
}
```

**Response:** `200 OK` with updated group object

---

#### Delete Group

```http
DELETE /api/groups/:id
```

**Response:** `200 OK` — `{ "success": true }`

**Note:** Cascade deletes group notes and removes the group reference from interactions.

---

### Group Notes

Notes attached to groups.

#### Get Group Notes

```http
GET /api/group-notes/:groupId
```

**Query Parameters:**
- `count_limit` (optional): Maximum number of results to return
- `date_back` (optional): Only return notes created on or after this date (ISO 8601)

**Response:**
```json
[
  {
    "id": "uuid",
    "groupId": "uuid",
    "content": "Team meeting notes",
    "createdAt": "2024-01-15T10:00:00Z"
  }
]
```

**Note**: Results are sorted newest-first. `count_limit` is applied after date filtering.

**Examples:**
```bash
# Get all notes for a group
GET /api/group-notes/uuid

# Get recent notes (last 10)
GET /api/group-notes/uuid?count_limit=10

# Get notes since specific date
GET /api/group-notes/uuid?date_back=2024-01-01

# Get latest 5 notes since a date
GET /api/group-notes/uuid?date_back=2024-06-01&count_limit=5
```

---

#### Create Group Note

```http
POST /api/group-notes
Content-Type: application/json

{
  "groupId": "uuid",
  "content": "Team meeting notes"
}
```

**Response:** `201 Created` with group note object

---

#### Delete Group Note

```http
DELETE /api/group-notes/:id
```

**Response:** `200 OK` — `{ "success": true }`

---

## Metadata Resources

### Relationship Types

Manage custom relationship types (e.g., Friend, Colleague, Family).

#### List All Relationship Types

```http
GET /api/relationship-types
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Colleague",
    "color": "#f59e0b",
    "value": 30,
    "notes": "Someone you work with",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

---

#### Get Relationship Type by ID

```http
GET /api/relationship-types/:id
```

**Response:** Relationship type object

---

#### Create Relationship Type

```http
POST /api/relationship-types
Content-Type: application/json

{
  "name": "Mentor",
  "color": "#10b981",
  "value": 85,
  "notes": "Professional mentor"
}
```

**Required fields:** `name`, `color`, `value` (integer 0–100)

**Optional fields:** `notes`

**Response:** `201 Created` with relationship type object

---

#### Update Relationship Type

```http
PATCH /api/relationship-types/:id
Content-Type: application/json

{
  "value": 90,
  "notes": "Updated description"
}
```

**Response:** `200 OK` with updated relationship type object

---

#### Delete Relationship Type

```http
DELETE /api/relationship-types/:id
```

**Response:** `200 OK` — `{ "success": true }`

**Note**: Cannot delete a type if existing relationships are using it.

---

### Interaction Types

Manage custom interaction types (e.g., Meeting, Call, Email).

#### List All Interaction Types

```http
GET /api/interaction-types
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Meeting",
    "color": "#3b82f6",
    "value": 70,
    "description": "In-person or virtual meeting",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

---

#### Get Interaction Type by ID

```http
GET /api/interaction-types/:id
```

**Response:** Interaction type object

---

#### Create Interaction Type

```http
POST /api/interaction-types
Content-Type: application/json

{
  "name": "Video Call",
  "color": "#8b5cf6",
  "value": 60,
  "description": "Virtual meeting via video"
}
```

**Required fields:** `name`, `color`, `value` (integer 0–100)

**Optional fields:** `description`

**Response:** `201 Created` with interaction type object

---

#### Update Interaction Type

```http
PATCH /api/interaction-types/:id
Content-Type: application/json

{
  "value": 65,
  "description": "Updated description"
}
```

**Response:** `200 OK` with updated interaction type object

---

#### Delete Interaction Type

```http
DELETE /api/interaction-types/:id
```

**Response:** `200 OK` — `{ "success": true }`

**Note**: The built-in "Generic" interaction type cannot be deleted.

---

## Social Accounts

Track social media and other online accounts linked to people.

### List All Social Accounts

```http
GET /api/social-accounts
```

**Query Parameters:**
- `search` (optional): Filter accounts by username or nickname (case-insensitive substring match)
- `typeId` (optional): Filter by social account type UUID

**Response:**
```json
[
  {
    "id": "uuid",
    "username": "johndoe",
    "ownerUuid": "person-uuid-or-null",
    "typeId": "uuid",
    "currentProfile": {
      "id": "uuid",
      "nickname": "John Doe",
      "accountUrl": "https://instagram.com/johndoe",
      "imageUrl": "https://...",
      "bio": "...",
      "isCurrent": true
    },
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

**Examples:**
```bash
# Get all social accounts
GET /api/social-accounts

# Search accounts by username/nickname
GET /api/social-accounts?search=johndoe

# Filter by platform type
GET /api/social-accounts?typeId=instagram-type-uuid

# Combined search and type filter
GET /api/social-accounts?search=john&typeId=instagram-type-uuid
```

---

### Get Social Accounts by IDs (Bulk Lookup)

```http
POST /api/social-accounts/by-ids
Content-Type: application/json

{
  "ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Response:** Array of social account objects matching the provided IDs.

---

### List Social Accounts (Paginated)

```http
GET /api/social-accounts/paginated
```

**Query Parameters:**
- `offset` (optional): Starting position (default: `0`, min: `0`)
- `limit` (optional): Number of records to return (default: `30`, max: `100`, min: `1`)
- `search` (optional): Filter by username or nickname
- `typeId` (optional): Filter by social account type UUID
- `followsYou` (optional): Set to `'true'` to only return accounts that follow the authenticated user's linked social accounts

**Response:** Array of social account objects

**Examples:**
```bash
# Paginate through all accounts
GET /api/social-accounts/paginated?offset=0&limit=50

# Search with pagination
GET /api/social-accounts/paginated?search=john&offset=0&limit=30

# Only accounts that follow you
GET /api/social-accounts/paginated?followsYou=true
```

---

### Create Social Account

```http
POST /api/social-accounts
Content-Type: application/json

{
  "username": "johndoe",
  "ownerUuid": "person-uuid-or-null",
  "typeId": "social-account-type-uuid"
}
```

**Required fields:** `username`

**Optional fields:** `ownerUuid` (person UUID to link this account to), `typeId`

**Response:** `201 Created` with social account object

---

### Update Social Account

```http
PATCH /api/social-accounts/:id
Content-Type: application/json

{
  "username": "new_username",
  "ownerUuid": "person-uuid",
  "typeId": "new-type-uuid",
  "nickname": "John Doe",
  "accountUrl": "https://instagram.com/new_username",
  "imageUrl": "https://...",
  "bio": "Updated bio"
}
```

**Registry fields** (stored on the account record): `username`, `ownerUuid`, `typeId`

**Profile fields** (stored as a new profile version): `nickname`, `accountUrl`, `imageUrl`, `bio`

**Response:** `200 OK` with updated social account object

---

### Delete Social Account

```http
DELETE /api/social-accounts/:id
```

**Response:** `200 OK` — `{ "success": true }`

---

### Delete All Social Accounts

```http
DELETE /api/social-accounts/delete-all
```

**Response:** `200 OK` — `{ "success": true, "deleted": 42 }`

---

### Get Social Account Followers

Returns all accounts that follow the specified account, based on stored network state.

```http
GET /api/social-accounts/:id/followers
```

**Response:** Array of social account objects

---

### Get Profile Version History

Returns all historical profile versions for an account.

```http
GET /api/social-accounts/:id/profile-versions
```

**Response:**
```json
[
  {
    "id": "uuid",
    "socialAccountId": "uuid",
    "nickname": "John Doe",
    "bio": "...",
    "accountUrl": "https://...",
    "imageUrl": "https://...",
    "isCurrent": true,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

---

### Get Network State

Returns the current follower/following state for an account.

```http
GET /api/social-accounts/:id/network-state
```

**Response:**
```json
{
  "socialAccountId": "uuid",
  "followerCount": 150,
  "followingCount": 200,
  "followers": ["account-uuid-1", "account-uuid-2"],
  "following": ["account-uuid-3", "account-uuid-4"],
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

---

### Update Network State

Sets the current network state for an account. Automatically detects and records any follow/unfollow changes compared to the previous state.

```http
POST /api/social-accounts/:id/network-state
Content-Type: application/json

{
  "followers": ["account-uuid-1", "account-uuid-2"],
  "following": ["account-uuid-3", "account-uuid-4"]
}
```

**Response:** `201 Created` with updated network state object

---

### Get Network Change History

Returns the log of follow/unfollow events detected for an account.

```http
GET /api/social-accounts/:id/network-changes
```

**Query Parameters:**
- `limit` (optional): Maximum number of change records to return

**Response:**
```json
[
  {
    "id": "uuid",
    "socialAccountId": "uuid",
    "changeType": "follow",
    "direction": "follower",
    "targetAccountId": "uuid",
    "detectedAt": "2024-01-15T10:00:00Z",
    "batchId": "uuid"
  }
]
```

**Notes:**
- `changeType`: `"follow"` or `"unfollow"`
- `direction`: `"follower"` (someone followed/unfollowed YOU) or `"following"` (YOU followed/unfollowed someone)

---

### Export Social Accounts as XML

```http
GET /api/social-accounts/export-xml
```

**Query Parameters:**
- `ids` (optional): Comma-separated list of social account UUIDs to export. Omit to export all accounts.
- `includeHistory` (optional): Set to `'true'` to include full profile version history and network change log (default: `false`, exports current state only)

**Response:** XML file download

**Examples:**
```bash
# Export all social accounts (current state)
GET /api/social-accounts/export-xml

# Export specific accounts
GET /api/social-accounts/export-xml?ids=uuid1,uuid2,uuid3

# Export all with full history
GET /api/social-accounts/export-xml?includeHistory=true
```

---

## Social Account Types

Define platforms or categories for social accounts (e.g., Instagram, Twitter, LinkedIn).

### List All Social Account Types

```http
GET /api/social-account-types
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "instagram",
    "color": "#e1306c",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

---

### Get Social Account Type by ID

```http
GET /api/social-account-types/:id
```

---

### Create Social Account Type

```http
POST /api/social-account-types
Content-Type: application/json

{
  "name": "twitter",
  "color": "#1da1f2"
}
```

**Required fields:** `name`, `color`

**Response:** `201 Created`

---

### Update Social Account Type

```http
PATCH /api/social-account-types/:id
Content-Type: application/json

{
  "color": "#000000"
}
```

**Response:** `200 OK`

---

### Delete Social Account Type

```http
DELETE /api/social-account-types/:id
```

**Response:** `200 OK` — `{ "success": true }`

---

## User Profile

### Get Current User

```http
GET /api/user
```

**Response:** Current session user object, or `401` if not authenticated.

---

### Get ME Person Profile

Returns the Person record linked to the authenticated user (the "ME" person that appears in graph visualizations and relationship tracking).

```http
GET /api/me
```

**Response:** Full person object for the authenticated user

---

### Update User Profile

```http
PATCH /api/user
Content-Type: application/json

{
  "name": "John Smith",
  "nickname": "Johnny",
  "username": "johnsmith",
  "ssoEmail": "john@company.com",
  "currentPassword": "oldpassword",
  "newPassword": "newpassword"
}
```

All fields are optional:
- `name`: Display name (also syncs to the linked ME person record)
- `nickname`: Short display name
- `username`: Login username (must be unique)
- `ssoEmail`: Email address used for SSO login (must be unique across users)
- `currentPassword` + `newPassword`: Both required together to change the password

**Response:** `200 OK` with updated user object

---

## API Key Management

### List API Keys

```http
GET /api/api-keys
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "My Integration Key",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

**Note**: The key value is never returned after creation.

---

### Create API Key

```http
POST /api/api-keys
Content-Type: application/json

{
  "name": "My Integration Key"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "My Integration Key",
  "key": "raw-key-shown-only-once",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Important**: The raw key value is only returned once at creation time. Store it securely.

---

### Revoke API Key

```http
DELETE /api/api-keys/:id
```

**Response:** `200 OK` — `{ "success": true }`

---

## Data Management

### Export Data (XML)

Export all CRM data in XML format for backup or migration.

```http
GET /api/export-xml
```

**Query Parameters:**
- `includeHistory` (optional): Set to `'true'` to include social network change history in the export (default: `false`)

**Response:** XML file download (`Content-Type: application/xml`)

**Includes:**
- User profile (name, nickname)
- All people (excluding the ME user for privacy)
- Notes
- Relationships
- Interactions
- Groups and group notes
- Relationship types and interaction types
- Social accounts and social account types
- Social network states and profile versions
- Social network change history (if `includeHistory=true`)

**Excludes:**
- Image files (URLs are included but files are not)
- API keys
- Session data
- ME user person data (privacy preserved; UUID is replaced with `00000000-0000-0000-0000-000000000000` in exports)

---

### Import Data (XML)

Import previously exported XML data.

```http
POST /api/import-xml
Content-Type: multipart/form-data

xml: <file>
```

**Response:**
```json
{
  "success": true,
  "imported": {
    "people": 10,
    "relationships": 5,
    "interactions": 3,
    "groups": 2,
    "notes": 15,
    "groupNotes": 4,
    "relationshipTypes": 2,
    "interactionTypes": 1,
    "socialAccounts": 8,
    "socialAccountTypes": 2,
    "networkChanges": 50
  },
  "skipped": {
    "people": 2,
    "relationships": 0,
    "socialAccounts": 1
  }
}
```

**Notes:**
- People are deduplicated by name; existing people with the same name are skipped
- Relationships, interactions, and social accounts are deduplicated by UUID
- UUIDs are preserved during import
- The ME user UUID (all zeros in the export file) is automatically replaced with the current user's person ID
- Social network state and profile version history are restored if present in the file

---

### Import Contacts (CSV — Google Contacts Format)

```http
POST /api/import-csv
Content-Type: multipart/form-data

csv: <file>
```

**Supported columns** (Google Contacts export format):
- `First Name`, `Last Name`, `Middle Name`, `Nickname`
- `Organization Name`, `Organization Title`, `Organization Department`
- `E-mail 1 - Value`, `E-mail 2 - Value`, `E-mail 3 - Value` (with label columns)
- `Phone 1 - Value` through `Phone 4 - Value` (with label columns)
- `Address 1 - Formatted`, `Address 2 - Formatted` (with label columns)
- `Website 1 - Value`, `Relation 1 - Value`, `Event 1 - Value`
- `Labels`, `Birthday`, `Notes`

**Behavior:**
- Primary email → `email` field
- Primary phone → `phone` field
- Organization name → `company` field
- Organization title → `title` field
- Labels → `tags` array
- All additional fields (secondary emails, phones, addresses, etc.) → appended to a single note for the person
- First row after the header is treated as an example/formatting row and is skipped

**Response:**
```json
{
  "success": true,
  "imported": 25,
  "errors": 0,
  "errorDetails": []
}
```

---

### Import Contacts (VCF / vCard)

```http
POST /api/import-vcf
Content-Type: multipart/form-data

vcf: <file>
```

**Supported vCard fields:** `N`, `FN`, `TEL`, `EMAIL`, `ORG`, `TITLE`, `BDAY`, `ADR`, `URL`, `NOTE`, `NICKNAME`, `ROLE`, `CATEGORIES`, `X-SOCIALPROFILE`

**Behavior:**
- Primary email → `email` field
- Primary phone → `phone` field
- `ORG` → `company` field
- `TITLE` → `title` field
- Additional emails, phones, addresses, and other fields → appended to a note
- Supports both standard vCard and Apple Contacts (item1. prefix) formats

**Response:**
```json
{
  "success": true,
  "imported": 15,
  "errors": 0,
  "errorDetails": []
}
```

---

### Import Instagram Followers/Following (CSV)

Import followers or following lists exported from Instagram data download.

```http
POST /api/import-instagram
Content-Type: multipart/form-data

csv: <file>
accountId: <social-account-uuid>
importType: followers | following
forceUpdateImages: true | false
```

**Form fields:**
- `csv`: The Instagram export CSV file (semicolon-delimited, with `username`, `full_name`, `profile_pic_url`, `followed_by_viewer` columns)
- `accountId` (required): UUID of the social account to import into (your account)
- `importType` (required): `"followers"` or `"following"`
- `forceUpdateImages` (optional): Set to `'true'` to overwrite existing profile images (default: `false`)

**Behavior:**
- Creates new social accounts for usernames not yet in the system
- Updates the `full_name` (nickname) for existing accounts if changed
- Enqueues background tasks to download profile pictures
- Updates the network state (followers/following lists) for the target account
- Automatically detects mutual follows via the `followed_by_viewer` field

**Response:**
```json
{
  "success": true,
  "imported": 50,
  "updated": 10,
  "total": 60,
  "skippedRows": 0
}
```

---

## Search

### Global Search

Search across people and groups simultaneously.

```http
GET /api/search?q=john
```

**Query Parameters:**
- `q` (required): Search query — searches people names, emails, companies, tags; and group names

**Response:**
```json
{
  "people": [...],
  "groups": [...]
}
```

---

### Mega Search (Advanced)

Search across multiple resource types simultaneously with configurable result categories.

```http
GET /api/mega-search
```

**Query Parameters:**
- `q` (required): Search query string
- `includePeople` (optional): Set to `'false'` to exclude people results (default: `true`)
- `includeGroups` (optional): Set to `'false'` to exclude group results (default: `true`)
- `includeInteractions` (optional): Set to `'false'` to exclude interaction results (default: `true`)
- `includeNotes` (optional): Set to `'false'` to exclude note results (default: `true`)
- `includeSocialProfiles` (optional): Set to `'false'` to exclude social account results (default: `true`)

**Response:**
```json
{
  "people": [...],
  "groups": [...],
  "interactions": [...],
  "notes": [...],
  "socialProfiles": [...]
}
```

**Examples:**
```bash
# Search everything
GET /api/mega-search?q=project

# Search only people and groups
GET /api/mega-search?q=john&includeInteractions=false&includeNotes=false&includeSocialProfiles=false

# Search only notes
GET /api/mega-search?q=followup&includePeople=false&includeGroups=false&includeInteractions=false&includeSocialProfiles=false
```

---

## Graph Data

### Get Relationship Graph Data

Retrieve relationship graph data for visualization.

```http
GET /api/graph
```

**Response:**
```json
{
  "people": [...],
  "relationships": [...],
  "groups": [...]
}
```

**Use Cases:**
- Network visualization
- Relationship mapping
- Social graph analysis

---

### Get Social Graph Data

Retrieve a computed social network graph for visualization, with filtering and layout options.

```http
POST /api/social-graph
Content-Type: application/json

{
  "hideOrphans": true,
  "minConnections": 0,
  "limitExtras": true,
  "maxExtras": 20,
  "highlightedAccountId": null,
  "mode": "default",
  "blobMergeMultiplier": 0.5,
  "singleHighlightAccountId": null,
  "singleShowFriendLinks": true,
  "singleRemoveExtras": false,
  "multiHighlightAccountIds": []
}
```

**Body Parameters** (all optional, defaults shown above):
- `hideOrphans` (boolean): Exclude accounts with no connections
- `minConnections` (integer): Minimum number of connections an account must have to be included
- `limitExtras` (boolean): Limit the number of non-highlighted "extra" nodes shown
- `maxExtras` (integer): Maximum number of extra nodes when `limitExtras` is `true`
- `highlightedAccountId` (string|null): UUID of an account to highlight
- `mode` (string): Graph rendering mode — one of `"default"`, `"blob"`, `"single-highlight"`, `"multi-highlight"`
- `blobMergeMultiplier` (number): Controls cluster merging in `"blob"` mode (0–1)
- `singleHighlightAccountId` (string|null): Account to focus on in `"single-highlight"` mode
- `singleShowFriendLinks` (boolean): Show mutual-follow links in single highlight mode
- `singleRemoveExtras` (boolean): Remove non-highlighted nodes in single highlight mode
- `multiHighlightAccountIds` (array of strings): Accounts to highlight in `"multi-highlight"` mode

**Response:** Graph node and edge data for rendering

---

## Account Matching

Tools for linking people in your CRM to their social accounts.

### Get Next Unmatched Person

Returns the next person who has no linked social accounts, along with candidate social accounts ranked by name similarity.

```http
GET /api/account-matching/next
```

**Query Parameters:**
- `skip` (optional): Comma-separated list of person UUIDs to skip (useful for "skip this person" UI flows)

**Response:**
```json
{
  "person": {
    "id": "uuid",
    "firstName": "Alice",
    "lastName": "Smith",
    ...
  },
  "candidates": [
    {
      "id": "uuid",
      "username": "alicesmith",
      "matchScore": 140,
      "typeName": "instagram",
      "typeColor": "#e1306c",
      ...
    }
  ]
}
```

Returns `{ "person": null, "candidates": [] }` when all people are matched or marked as having no social media.

---

### Connect Person to Social Accounts

Links one or more social accounts to a person.

```http
POST /api/account-matching/connect
Content-Type: application/json

{
  "personId": "uuid",
  "socialAccountIds": ["uuid1", "uuid2"]
}
```

**Behavior:**
- Adds the social accounts to the person's `socialAccountUuids` list
- Sets `ownerUuid` on each social account to the person's UUID
- If the person has no profile image, automatically pulls one from the linked accounts

**Response:** `200 OK` — `{ "success": true }`

---

### Mark Person as Having No Social Media

Marks a person as having no social media presence, so they won't appear in future account-matching rounds.

```http
POST /api/account-matching/ignore
Content-Type: application/json

{
  "personId": "uuid"
}
```

**Response:** `200 OK` — `{ "success": true }`

---

## Image Management

### Upload Image

```http
POST /api/upload-image
Content-Type: multipart/form-data

image: <file>
```

Images are stored in S3 or local storage depending on the user's configured storage mode.

**Response:**
```json
{
  "imageUrl": "https://..."
}
```

---

### Delete Image

```http
DELETE /api/delete-image
Content-Type: application/json

{
  "imageUrl": "https://..."
}
```

**Response:** `200 OK` — `{ "success": true }`

---

### Serve Local Image

```http
GET /api/images/:filename
```

Serves an image stored in local storage. Requires authentication.

---

### Image Pass-In (Bulk)

Automatically populates profile images for all people who have no image but are linked to social accounts that do.

```http
POST /api/image-pass-in
```

No request body needed.

**Response:**
```json
{
  "totalPeopleWithoutImages": 30,
  "updated": 18,
  "skipped": 5,
  "noSocialAccount": 7,
  "updates": [
    {
      "personId": "uuid",
      "personName": "Alice Smith",
      "imageUrl": "https://..."
    }
  ]
}
```

---

## Error Responses

All endpoints return standard HTTP status codes:

- `200 OK`: Successful GET/PATCH/DELETE request
- `201 Created`: Successful POST request
- `400 Bad Request`: Invalid request data or validation failure
- `401 Unauthorized`: Authentication required
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

**Error Response Format:**
```json
{
  "error": "Error message description"
}
```

---

## Rate Limiting

No rate limiting is currently enforced. For production integrations, implement appropriate throttling on your side to avoid overloading the server.

---

## Best Practices

1. **Use API Keys**: Prefer API key authentication over session cookies for external applications
2. **Pagination**: Use paginated endpoints (`/api/people/paginated`, `/api/social-accounts/paginated`) for large datasets instead of fetching everything at once
3. **Caching**: Relationship types and interaction types change infrequently — cache them locally and refresh periodically
4. **Bulk Operations**: When creating multiple resources, make parallel requests rather than sequential ones
5. **Error Handling**: Always check response status codes and handle errors gracefully
6. **Date Formats**: Use ISO 8601 format for all dates (`YYYY-MM-DDTHH:mm:ssZ`)
7. **Filter Early**: Use query parameters to filter on the server side and reduce data transfer
8. **Flow Endpoint**: For person activity timelines, prefer `GET /api/people/:id/flow` over fetching notes and interactions separately — it paginates efficiently

---

## Example Integration

### JavaScript/Node.js Example

```javascript
const API_BASE = 'https://your-app.replit.app/api';
const API_KEY = 'your-api-key';

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`API Error ${response.status}: ${err.error || response.statusText}`);
  }

  return response.json();
}

// Get all people
async function getPeople() {
  return apiCall('/people');
}

// Get paginated people sorted by ELO
async function getPeopleByElo(offset = 0, limit = 30) {
  return apiCall(`/people/paginated?offset=${offset}&limit=${limit}&sortByElo=true`);
}

// Search people
async function searchPeople(query, { connectedToMe = false, startDate, endDate } = {}) {
  const params = new URLSearchParams({ q: query });
  if (connectedToMe) params.set('connected_to_me', 'true');
  if (startDate) params.set('creation_start_date', startDate);
  if (endDate) params.set('creation_stop_date', endDate);
  return apiCall(`/people/search?${params}`);
}

// Create a new person
async function createPerson(personData) {
  return apiCall('/people', {
    method: 'POST',
    body: JSON.stringify(personData),
  });
}

// Get person's activity timeline (paginated)
async function getPersonFlow(personId, { limit = 20, cursor } = {}) {
  const params = new URLSearchParams({ limit });
  if (cursor) params.set('cursor', cursor);
  return apiCall(`/people/${personId}/flow?${params}`);
}

// Get interactions for a person within a date range
async function getPersonInteractions(personId, { startDate, endDate, limit } = {}) {
  const params = new URLSearchParams({ personId });
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (limit) params.set('count_limit', limit);
  return apiCall(`/interactions?${params}`);
}

// Create a relationship
async function createRelationship(fromPersonId, toPersonId, typeId, notes) {
  return apiCall('/relationships', {
    method: 'POST',
    body: JSON.stringify({ fromPersonId, toPersonId, typeId, notes }),
  });
}

// Get only high-value relationships for a person
async function getCloseRelationships(personId) {
  return apiCall(`/relationships/${personId}?value_limit=70&count_limit=10`);
}

// Get notes for a person
async function getPersonNotes(personId) {
  return apiCall(`/notes?personId=${personId}`);
}

// Mega search across everything
async function megaSearch(query) {
  return apiCall(`/mega-search?q=${encodeURIComponent(query)}`);
}

// Get social accounts with pagination
async function getSocialAccounts({ search, typeId, offset = 0, limit = 30 } = {}) {
  const params = new URLSearchParams({ offset, limit });
  if (search) params.set('search', search);
  if (typeId) params.set('typeId', typeId);
  return apiCall(`/social-accounts/paginated?${params}`);
}
```

### Python Example

```python
import requests
from datetime import datetime, timedelta

API_BASE = 'https://your-app.replit.app/api'
API_KEY = 'your-api-key'

headers = {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
}

# Get all people
response = requests.get(f'{API_BASE}/people', headers=headers)
people = response.json()

# Search people created in the last 30 days
thirty_days_ago = (datetime.now() - timedelta(days=30)).isoformat()
response = requests.get(
    f'{API_BASE}/people/search',
    params={
        'q': '',
        'creation_start_date': thirty_days_ago,
    },
    headers=headers
)
recent_people = response.json()

# Create a new person
new_person = {
    'firstName': 'Jane',
    'lastName': 'Smith',
    'email': 'jane@example.com',
    'company': 'Tech Corp',
    'tags': ['developer', 'python']
}
response = requests.post(
    f'{API_BASE}/people',
    json=new_person,
    headers=headers
)
created_person = response.json()

# Get interactions for a person in a date range with a limit
person_id = created_person['id']
response = requests.get(
    f'{API_BASE}/interactions',
    params={
        'personId': person_id,
        'startDate': '2024-01-01',
        'endDate': '2024-12-31',
        'count_limit': 50,
    },
    headers=headers
)
interactions = response.json()

# Create a note
new_note = {
    'personId': person_id,
    'content': 'Follow up on project discussion'
}
response = requests.post(
    f'{API_BASE}/notes',
    json=new_note,
    headers=headers
)
note = response.json()

# Get all notes for a person
response = requests.get(
    f'{API_BASE}/notes',
    params={'personId': person_id},
    headers=headers
)
person_notes = response.json()

# Mega search across all resource types
response = requests.get(
    f'{API_BASE}/mega-search',
    params={'q': 'project alpha'},
    headers=headers
)
results = response.json()
print(f"Found {len(results['people'])} people, {len(results['notes'])} notes")
```

---

## Support

For questions or issues with the API:
1. Check this documentation
2. Review the interactive API playground at `/api-playground` in the web UI
3. Examine request/response examples in the API Documentation page

---

## Version

API Version: 2.0
Last Updated: March 2026

**Note**: This API is in active development. Breaking changes may occur. Test thoroughly before production deployment.
