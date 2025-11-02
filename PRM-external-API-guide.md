# People Relationship Management (PRM) - External API Guide

## Overview

This guide documents the external REST API endpoints available for integrating with the PRM (People Relationship Management) application. These APIs allow external applications to interact with people, relationships, interactions, groups, and other CRM data.

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
- `includeRelationships` (optional): Set to 'true' to include relationship data (default: false)

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
    "userId": null,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### List People (Paginated)

```http
GET /api/people/paginated?offset=0&limit=30
```

**Query Parameters:**
- `offset` (optional): Starting position (default: 0)
- `limit` (optional): Number of records to return (default: 30)

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
    ...
  }
]
```

**Note**: Returns people sorted by their relationship value with the authenticated user (highest first), then alphabetically.

#### Search People

```http
GET /api/people/search?q=john&creation_start_date=2024-01-01&creation_stop_date=2024-12-31&connected_to_me=true
```

**Query Parameters:**
- `q` (required): Search query string
- `creation_start_date` (optional): Filter people created on or after this date (ISO 8601 format)
- `creation_stop_date` (optional): Filter people created on or before this date (ISO 8601 format)
- `connected_to_me` (optional): Set to 'true' to only return people with relationships to the authenticated user

**Response:** Array of people matching search criteria

**Examples:**
```bash
# Search for people named "john"
GET /api/people/search?q=john

# Search for people created in 2024
GET /api/people/search?q=john&creation_start_date=2024-01-01&creation_stop_date=2024-12-31

# Search for people connected to the ME user
GET /api/people/search?q=john&connected_to_me=true
```

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
  "notes": [...],
  "interactions": [...],
  "groups": [...],
  "relationships": [...]
}
```

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

**Response:** `201 Created` with person object

**Note:** Duplicate names are prevented - you cannot create two people with the same first and last name.

#### Update Person

```http
PATCH /api/people/:id
Content-Type: application/json

{
  "email": "newemail@example.com",
  "title": "Lead Designer"
}
```

**Response:** `200 OK` with updated person object

#### Delete Person

```http
DELETE /api/people/:id
```

**Response:** `204 No Content`

**Note**: Cascade deletes associated notes, removes from groups, and cleans up relationships.

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
    "createdAt": "2024-01-15T10:00:00Z"
  }
]
```

**Examples:**
```bash
# Get all notes across all people
GET /api/notes

# Get notes for a specific person
GET /api/notes?personId=uuid
```

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
  "createdAt": "2024-01-15T10:00:00Z"
}
```

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

#### Delete Note

```http
DELETE /api/notes/:id
```

**Response:** `200 OK` with success status

---

### Interactions

Track meetings, calls, emails, and other interactions.

#### Get Interactions

```http
GET /api/interactions
```

**Query Parameters:**
- `personId` (optional): Filter interactions involving a specific person
- `groupId` (optional): Filter interactions involving a specific group
- `isgroup` (optional): Set to 'true' to get only group interactions, 'false' for non-group interactions
- `startDate` or `start_date` (optional): Filter interactions on or after this date (ISO 8601)
- `endDate` or `end_date` (optional): Filter interactions on or before this date (ISO 8601)
- `count_limit` (optional): Maximum number of results to return

**Response:**
```json
[
  {
    "id": "uuid",
    "peopleIds": ["uuid1", "uuid2"],
    "groupIds": ["uuid1"],
    "typeId": "uuid",
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
```

#### Create Interaction

```http
POST /api/interactions
Content-Type: application/json

{
  "peopleIds": ["uuid1", "uuid2"],
  "groupIds": ["uuid1"],
  "typeId": "uuid",
  "date": "2024-01-15T10:00:00Z",
  "description": "Team standup meeting",
  "imageUrl": null
}
```

**Validation:**
- `peopleIds`: Array with minimum 2 people
- `date`: ISO 8601 timestamp
- `typeId`: Valid interaction type UUID

**Response:** `201 Created` with interaction object

#### Update Interaction

```http
PATCH /api/interactions/:id
Content-Type: application/json

{
  "description": "Updated description",
  "date": "2024-01-15T14:00:00Z"
}
```

**Response:** `200 OK` with updated interaction object

#### Delete Interaction

```http
DELETE /api/interactions/:id
```

**Response:** `200 OK` with success status

**Note:** Automatically deletes associated images from S3.

---

### Relationships

Manage relationships between people.

#### Get Person's Relationships

```http
GET /api/relationships/:personId
```

**Query Parameters:**
- `count_limit` (optional): Maximum number of results to return
- `value_limit` (optional): Filter relationships with value greater than or equal to this threshold

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
      "lastName": "Doe",
      ...
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

**Note**: Returns bidirectional relationships (both where person is "from" or "to"), sorted by relationship value (highest first).

**Examples:**
```bash
# Get all relationships for a person
GET /api/relationships/uuid

# Get high-value relationships only (value >= 70)
GET /api/relationships/uuid?value_limit=70

# Get top 5 relationships
GET /api/relationships/uuid?count_limit=5
```

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

**Response:** `201 Created` with relationship object

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

#### Delete Relationship

```http
DELETE /api/relationships/:id
```

**Response:** `200 OK` with success status

---

### Groups

Organize people into groups or teams.

#### List All Groups

```http
GET /api/groups?search=team
```

**Query Parameters:**
- `search` (optional): Filter groups by name

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Work Team",
    "color": "#3b82f6",
    "type": ["team", "project"],
    "members": ["uuid1", "uuid2", "uuid3"],
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### Get Group by ID

```http
GET /api/groups/:id
```

**Response:** Group object with populated member details and notes

#### Create Group

```http
POST /api/groups
Content-Type: application/json

{
  "name": "Project Alpha Team",
  "color": "#8b5cf6",
  "type": ["project"],
  "members": ["uuid1", "uuid2"]
}
```

**Response:** `201 Created` with group object

#### Update Group

```http
PATCH /api/groups/:id
Content-Type: application/json

{
  "name": "Updated Team Name",
  "members": ["uuid1", "uuid2", "uuid3"]
}
```

**Response:** `200 OK` with updated group object

#### Delete Group

```http
DELETE /api/groups/:id
```

**Response:** `200 OK` with success status

**Note:** Cascade deletes group notes and removes group from interactions.

---

### Group Notes

Notes attached to groups.

#### Get Group Notes

```http
GET /api/group-notes/:groupId
```

**Query Parameters:**
- `count_limit` (optional): Maximum number of results to return
- `date_back` (optional): Filter notes created on or after this date (ISO 8601)

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

**Examples:**
```bash
# Get all notes for a group
GET /api/group-notes/uuid

# Get recent notes (last 10)
GET /api/group-notes/uuid?count_limit=10

# Get notes since specific date
GET /api/group-notes/uuid?date_back=2024-01-01
```

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

#### Delete Group Note

```http
DELETE /api/group-notes/:id
```

**Response:** `200 OK` with success status

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
    "notes": "Someone you work with"
  }
]
```

#### Get Relationship Type by ID

```http
GET /api/relationship-types/:id
```

**Response:** Relationship type object

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

**Response:** `201 Created` with relationship type object

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

#### Delete Relationship Type

```http
DELETE /api/relationship-types/:id
```

**Response:** `200 OK` with success status

**Note**: Cannot delete if relationships are using this type.

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
    "description": "In-person or virtual meeting"
  }
]
```

#### Get Interaction Type by ID

```http
GET /api/interaction-types/:id
```

**Response:** Interaction type object

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

**Response:** `201 Created` with interaction type object

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

#### Delete Interaction Type

```http
DELETE /api/interaction-types/:id
```

**Response:** `200 OK` with success status

**Note**: "Generic" interaction type cannot be deleted.

---

## Data Management

### Export Data (XML)

Export all CRM data in XML format for backup or migration.

```http
GET /api/export-xml
```

**Response:** XML file download

**Includes:**
- All people (except ME user for privacy)
- Notes
- Relationships
- Interactions
- Groups
- Group notes
- Relationship and interaction types

**Excludes:**
- Images (URLs included but files not exported)
- API keys
- Session data
- ME user data (privacy preserved)

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
  "message": "Import successful",
  "imported": {
    "people": 10,
    "relationships": 5,
    "interactions": 3,
    "groups": 2,
    "notes": 15,
    "groupNotes": 4,
    "relationshipTypes": 2,
    "interactionTypes": 1
  },
  "skipped": {
    "people": 2,
    "relationshipTypes": 0,
    "interactionTypes": 0
  }
}
```

**Note**: 
- Duplicate detection by name; existing people are skipped
- UUIDs are preserved during import
- ME user UUID (all zeros in export) is replaced with current user's person ID

---

## Graph Data

Retrieve relationship graph data for visualization.

### Get Graph Data

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

## Search

### Global Search

Search across people and groups.

```http
GET /api/search?q=john&limit=10
```

**Query Parameters:**
- `q` (required): Search query
- `limit` (optional): Max results (default: 10)

**Response:**
```json
{
  "people": [...],
  "groups": [...]
}
```

---

## Rate Limiting

Currently no rate limiting is enforced. For production use, implement appropriate rate limiting on your API keys.

## Error Responses

All endpoints return standard HTTP status codes:

- `200 OK`: Successful GET/PATCH request
- `201 Created`: Successful POST request
- `204 No Content`: Successful DELETE request
- `400 Bad Request`: Invalid request data
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

## Best Practices

1. **Use API Keys**: Prefer API key authentication over session-based for external applications
2. **Pagination**: Use paginated endpoints for large datasets
3. **Caching**: Cache relationship types and interaction types (they change infrequently)
4. **Bulk Operations**: When creating multiple relationships, make parallel requests
5. **Error Handling**: Always check response status codes and handle errors gracefully
6. **Date Formats**: Always use ISO 8601 format for dates (`YYYY-MM-DDTHH:mm:ssZ`)
7. **Filter Wisely**: Use query parameters to reduce data transfer and improve performance

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
    throw new Error(`API Error: ${response.statusText}`);
  }
  
  return response.json();
}

// Get all people
async function getPeople() {
  return apiCall('/people');
}

// Search people connected to ME user
async function getConnectedPeople(searchTerm) {
  return apiCall(`/people/search?q=${searchTerm}&connected_to_me=true`);
}

// Create a new person
async function createPerson(personData) {
  return apiCall('/people', {
    method: 'POST',
    body: JSON.stringify(personData),
  });
}

// Get interactions for a person within date range
async function getPersonInteractions(personId, startDate, endDate) {
  let url = `/interactions?personId=${personId}`;
  if (startDate) url += `&startDate=${startDate}`;
  if (endDate) url += `&endDate=${endDate}`;
  return apiCall(url);
}

// Create a relationship
async function createRelationship(fromPersonId, toPersonId, typeId, notes) {
  return apiCall('/relationships', {
    method: 'POST',
    body: JSON.stringify({ fromPersonId, toPersonId, typeId, notes }),
  });
}

// Get notes for a person
async function getPersonNotes(personId) {
  return apiCall(`/notes?personId=${personId}`);
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

# Get interactions for a person in a date range
person_id = created_person['id']
response = requests.get(
    f'{API_BASE}/interactions',
    params={
        'personId': person_id,
        'startDate': '2024-01-01',
        'endDate': '2024-12-31',
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
```

---

## Support

For questions or issues with the API:
1. Check this documentation
2. Review the interactive API playground at `/api-playground` in the web UI
3. Examine request/response examples in the API Documentation page

---

## Version

API Version: 1.0  
Last Updated: November 2025

**Note**: This API is currently in active development. Breaking changes may occur. Pin your integration to specific functionality and test thoroughly before production deployment.
