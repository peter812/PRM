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
GET /api/people/search?q=john
```

**Query Parameters:**
- `q` (required): Search query string

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

### Relationships

Manage relationships between people.

#### Get Person's Relationships

```http
GET /api/relationships/:personId
```

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

**Note**: Returns bidirectional relationships (both where person is "from" or "to").

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

#### Delete Relationship

```http
DELETE /api/relationships/:id
```

---

### Interactions

Track meetings, calls, emails, and other interactions.

#### List All Interactions

```http
GET /api/interactions
```

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
    "createdAt": "2024-01-15T11:00:00Z"
  }
]
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

#### Update Interaction

```http
PATCH /api/interactions/:id
Content-Type: application/json

{
  "description": "Updated description",
  "date": "2024-01-15T14:00:00Z"
}
```

#### Delete Interaction

```http
DELETE /api/interactions/:id
```

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
    "members": ["uuid1", "uuid2", "uuid3"],
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

#### Get Group by ID

```http
GET /api/groups/:id
```

**Response:** Group object with populated member details

#### Create Group

```http
POST /api/groups
Content-Type: application/json

{
  "name": "Project Alpha Team",
  "color": "#8b5cf6",
  "members": ["uuid1", "uuid2"]
}
```

#### Update Group

```http
PATCH /api/groups/:id
Content-Type: application/json

{
  "name": "Updated Team Name",
  "members": ["uuid1", "uuid2", "uuid3"]
}
```

#### Delete Group

```http
DELETE /api/groups/:id
```

---

### Notes

Personal notes attached to people.

#### Create Note

```http
POST /api/notes
Content-Type: application/json

{
  "personId": "uuid",
  "content": "Important reminder about project deadline"
}
```

#### Delete Note

```http
DELETE /api/notes/:id
```

---

### Group Notes

Notes attached to groups.

#### Get Group Notes

```http
GET /api/group-notes/:groupId
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

#### Delete Group Note

```http
DELETE /api/group-notes/:id
```

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

#### Update Relationship Type

```http
PATCH /api/relationship-types/:id
```

#### Delete Relationship Type

```http
DELETE /api/relationship-types/:id
```

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

#### Create/Update/Delete

Similar patterns to relationship types.

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
- Relationship and interaction types

**Excludes:**
- Images (URLs included but files not exported)
- API keys
- Session data

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
  "stats": {
    "people": 10,
    "relationships": 5,
    "interactions": 3
  }
}
```

**Note**: Duplicate detection by name; existing people are skipped.

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

---

## Example Integration

### JavaScript/Node.js Example

```javascript
const API_BASE = 'https://your-app.replit.app/api';
const API_KEY = 'your-api-key';

async function getPeople() {
  const response = await fetch(`${API_BASE}/people`, {
    headers: {
      'X-API-Key': API_KEY
    }
  });
  return response.json();
}

async function createPerson(personData) {
  const response = await fetch(`${API_BASE}/people`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY
    },
    body: JSON.stringify(personData)
  });
  return response.json();
}

async function createInteraction(interactionData) {
  const response = await fetch(`${API_BASE}/interactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY
    },
    body: JSON.stringify(interactionData)
  });
  return response.json();
}
```

### Python Example

```python
import requests

API_BASE = 'https://your-app.replit.app/api'
API_KEY = 'your-api-key'

headers = {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
}

# Get all people
response = requests.get(f'{API_BASE}/people', headers=headers)
people = response.json()

# Create a new person
new_person = {
    'firstName': 'Jane',
    'lastName': 'Smith',
    'email': 'jane@example.com',
    'company': 'Tech Corp'
}
response = requests.post(
    f'{API_BASE}/people',
    json=new_person,
    headers=headers
)
created_person = response.json()
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
Last Updated: October 2025

**Note**: This API is currently in active development. Breaking changes may occur. Pin your integration to specific functionality and test thoroughly before production deployment.
