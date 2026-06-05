# PRMface React Backend Integration Guide

This guide is designed for **AI developers, agentic systems, and React developers** to integrate the PRMface API into a **React Backend** (such as Next.js API Routes, Server Actions, or Express.js).

PRMface is a self-hosted facial recognition and identity tracking engine. Since it runs as an independent backend service (typically on port `8000`), your React backend will act as a secure proxy to forward client requests, manage API keys, and protect sensitive facial data.

---

## 1. Setup & Environment Variables

To keep your PRMface API key secure, never expose it to the React client (frontend). All calls to the PRMface API should go through your React server-side code (Next.js backend or Express.js).

Store these environment variables in your React backend (`.env.local` or host dashboard):

```bash
# The base URL where your PRMface server is running
PRMFACE_API_URL=http://localhost:8000

# The raw API key obtained during the onboarding process
PRMFACE_API_KEY=your_64_character_hex_api_key_here
```

---

## 2. TypeScript Types & Interface Reference

These TypeScript interfaces match the actual FastAPI schemas defined in `main.py` and are crucial for type safety in your React backend.

```typescript
export interface BoundingBox {
  x: number; // Top-left x-coordinate in pixels
  y: number; // Top-left y-coordinate in pixels
  w: number; // Bounding box width in pixels
  h: number; // Bounding box height in pixels
}

export interface MatchResult {
  face_uuid: string;
  person_uuid: string;
  image_uuid: string;
  face_url: string;  // Relative URL (e.g., "/face-img/...")
  image_url: string; // Relative URL (e.g., "/img/...")
  confidence_score: number; // Cosine similarity: 0.0 - 1.0 (>= 0.80 is a strong match)
}

export interface FaceResult {
  face_index: number;
  box: BoundingBox;
  detection_confidence: number;
  matched: boolean;
  persisted: boolean;
  face_uuid: string | null;
  person_uuid: string | null;
  face_url: string | null;
  matches: MatchResult[];
}

export interface AddImageResponse {
  image_uuid: string;
  image_url: string;
  original_filename: string;
  faces_detected: number;
  faces: FaceResult[];
}

export interface ImageListItem {
  image_uuid: string;
  image_url: string;
  original_filename: string;
  face_count: number;
  created_at: string | null;
}

export interface ListImagesResponse {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  images: ImageListItem[];
}

export interface PersonMetadata {
  person_uuid: string;
  name: string | null;
  created_at: string;
}

export interface MergeResponse {
  merged: boolean;
  person_uuid: string;
  faces_moved: number;
}
```

---

## 3. Onboarding & Authentication Flow

PRMface uses a security handshake to issue API keys. Your React backend can automate or handle this setup flow.

```
React App UI  →  React Backend  →  PRMface API (Port 8000)
                    (Checks status / exchanges setup code)
```

### 3.1 Get Setup Status
Check if the PRMface server has already been set up.

* **Endpoint**: `GET /api/setup-status`
* **Auth Required**: No

**React Server/Action Implementation:**
```typescript
export async function checkSetupStatus() {
  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/setup-status`);
  const data: { setup_completed: boolean } = await resp.json();
  return data.setup_completed;
}
```

### 3.2 Exchange Setup Code for API Key
Exchange the server's initial setup code (printed to the console at startup) for a revocable API key.

* **Endpoint**: `POST /api/get-api-key`
* **Auth Required**: No
* **Content-Type**: `multipart/form-data`

**React Server/Action Implementation:**
```typescript
export async function exchangeSetupCode(setupCode: string, label: string = 'nextjs-backend') {
  const form = new FormData();
  form.append('setup_code', setupCode);
  form.append('label', label);

  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/get-api-key`, {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Failed to obtain API key');
  }

  // Schema returned: { api_key: string, key_id: string, message: string }
  const data = await resp.json();
  
  // CRITICAL: Save data.api_key securely to your database or environment config.
  // It cannot be retrieved again from the server.
  return data;
}
```

### 3.3 Revoke API Key
Permanently revoke an API key using its `key_id` (UUID). Requires a valid API key to authenticate the revocation.

* **Endpoint**: `DELETE /api/revoke-key/{key_id}`
* **Auth Required**: Yes (`X-API-Key`)

**React Server/Action Implementation:**
```typescript
export async function revokeKey(keyId: string) {
  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/revoke-key/${keyId}`, {
    method: 'DELETE',
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
  });
  return resp.ok; // Returns { revoked: true, key_id: "..." }
}
```

---

## 4. Face Recognition & Search (Multipart File Uploads)

These endpoints deal with uploading images for facial detection, database query matching, and identity registration.

### 4.1 Add Image (Process & Save crops)
Uploads an image, extracts all faces, runs similarity matching, and stores all outputs. Unmatched faces become orphans.

* **Endpoint**: `POST /api/img/add`
* **Content-Type**: `multipart/form-data`
* **Form Fields**:
  - `image` (File/Blob)
  - `max_faces` (number, default: 10)

**Next.js Server Action / Route Helper:**
```typescript
export async function addImage(imageFile: File, maxFaces: number = 10): Promise<AddImageResponse> {
  const form = new FormData();
  form.append('image', imageFile);
  form.append('max_faces', maxFaces.toString());

  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/img/add`, {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Image processing failed');
  }

  return resp.json();
}
```

### 4.2 Temp Lookup (Privacy-Friendly Query)
Detects faces and searches the database, but **saves nothing to disk or DB**. Excellent for live cameras and privacy-sensitive operations.

* **Endpoint**: `POST /api/img/temp-lookup`
* **Content-Type**: `multipart/form-data`
* **Form Fields**:
  - `image` (File/Blob)
  - `max_faces` (number, default: 10)
  - `limit` (number, default: 10)

**Next.js Server Action / Route Helper:**
```typescript
export async function tempLookup(imageFile: File, maxFaces: number = 10, limit: number = 10) {
  const form = new FormData();
  form.append('image', imageFile);
  form.append('max_faces', maxFaces.toString());
  form.append('limit', limit.toString());

  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/img/temp-lookup`, {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Lookup query failed');
  }

  return resp.json(); // returns { faces_detected: number, faces: FaceResult[] }
}
```

### 4.3 Match Image (Match & Save full query)
Same as `temp-lookup`, but saves the image and all crops. Unmatched faces become orphans.

* **Endpoint**: `POST /api/img/match`
* **Content-Type**: `multipart/form-data`
* **Form Fields**:
  - `image` (File/Blob)
  - `max_faces` (number, default: 10)
  - `limit` (number, default: 10)

**React Server Implementation:**
```typescript
export async function matchAndSave(imageFile: File, maxFaces: number = 10, limit: number = 10) {
  const form = new FormData();
  form.append('image', imageFile);
  form.append('max_faces', maxFaces.toString());
  form.append('limit', limit.toString());

  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/img/match`, {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Match operations failed');
  }

  return resp.json();
}
```

### 4.4 Delete Image (Delete full image and face crops)
Removes an image record from the database (which cascade deletes all associated Face records) and deletes the physical files for the full image and its face crops from disk.
* **Endpoint**: `DELETE /api/img/delete`
* **Query Parameters**:
  - `image_uuid` (string, required)
**React Server/Action Implementation:**
```typescript
export async function deleteImage(imageUuid: string) {
  const url = new URL(`${process.env.PRMFACE_API_URL}/api/img/delete`);
  url.searchParams.append('image_uuid', imageUuid);
  const resp = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Failed to delete image');
  }
  return resp.json(); // returns { deleted: true, image_uuid: "...", faces_deleted: string[] }
}
```


---

## 5. Person & Identity Management

Once faces are registered or orphaned, you can manage the mapping of face embeddings to specific Person records.

### 5.1 Create Person Record
Creates a new Person identity card. You can supply a specific UUID (matching a user ID in your main app database) or let PRMface auto-generate it.

* **Endpoint**: `POST /api/person/add`
* **Content-Type**: `multipart/form-data`
* **Form Fields**:
  - `person_uuid` (string, optional)
  - `name` (string, optional)

**React Server/Action Implementation:**
```typescript
export async function createPerson(name: string, personUuid?: string): Promise<PersonMetadata> {
  const form = new FormData();
  form.append('name', name);
  if (personUuid) {
    form.append('person_uuid', personUuid);
  }

  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/person/add`, {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Failed to create person record');
  }

  return resp.json();
}
```

### 5.2 Merge Person Records
Merges a secondary duplicate identity into a primary identity. All faces linked to the secondary are re-assigned to the primary, and the secondary person record is deleted.

* **Endpoint**: `POST /api/person/merge`
* **Content-Type**: `multipart/form-data`
* **Form Fields**:
  - `primary_person_uuid` (string, required)
  - `secondary_person_uuid` (string, required)

**React Server/Action Implementation:**
```typescript
export async function mergePeople(primaryUuid: string, secondaryUuid: string): Promise<MergeResponse> {
  const form = new FormData();
  form.append('primary_person_uuid', primaryUuid);
  form.append('secondary_person_uuid', secondaryUuid);

  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/person/merge`, {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Failed to merge identities');
  }

  return resp.json();
}
```

### 5.3 Delete Person
Removes the person record. All associated face crops become orphans (`person_id` becomes `null`), but the face images on disk are preserved.

* **Endpoint**: `DELETE /api/person/remove`
* **Content-Type**: `multipart/form-data`
* **Form Fields**:
  - `person_uuid` (string, required)

**React Server/Action Implementation:**
```typescript
export async function removePerson(personUuid: string) {
  const form = new FormData();
  form.append('person_uuid', personUuid);

  const resp = await fetch(`${process.env.PRMFACE_API_URL}/api/person/remove`, {
    method: 'DELETE',
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Failed to remove person');
  }

  return resp.json(); // returns { deleted: true, person_uuid: "...", faces_orphaned: number }
}
```

---

## 6. Querying and Listing Records

All of these endpoints perform paginated read queries using standard `GET` requests.

| Task | Endpoint | Query Parameters |
|---|---|---|
| **List Images** | `GET /api/img/list` | `page` (int), `page_size` (int) |
| **Get Image Info** | `GET /api/img/get` | `uuid` (string) |
| **List Named Faces** | `GET /api/face/with-name` | `page` (int), `page_size` (int) |
| **List Orphan Faces** | `GET /api/face/without-name` | `page` (int), `page_size` (int) |
| **Get Face Details** | `GET /api/face/get` | `uuid` (string) |
| **List All Faces** | `GET /api/face/list` | `page` (int), `page_size` (int) |
| **Get Person Info** | `GET /api/person/get` | `uuid` (string) |
| **Get Person Faces** | `GET /api/person/{person_uuid}/faces` | `page` (int), `page_size` (int), `order` ("newest" \| "oldest") |

**Implementation Example: Get Person's Faces**
```typescript
export async function getPersonFaces(personUuid: string, page: number = 1, pageSize: number = 25) {
  const url = new URL(`${process.env.PRMFACE_API_URL}/api/person/${personUuid}/faces`);
  url.searchParams.append('page', page.toString());
  url.searchParams.append('page_size', pageSize.toString());

  const resp = await fetch(url.toString(), {
    headers: {
      'X-API-Key': process.env.PRMFACE_API_KEY || '',
    },
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || 'Could not fetch faces for person');
  }

  return resp.json();
}
```

---

## 7. Next.js App Router (React Backend) Implementation Example

Below is a complete, working example of a **Next.js App Router Route Handler** (`app/api/face/identify/route.ts`) showing how to accept an image upload from a React frontend, parse it securely, call PRMface, and return the identified face matching results.

```typescript
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image'); // This is a web standard File object

    if (!imageFile || !(imageFile instanceof File)) {
      return NextResponse.json(
        { error: 'Image file is required.' },
        { status: 400 }
      );
    }

    // Prepare a new form body to send to PRMface
    const prmFaceForm = new FormData();
    prmFaceForm.append('image', imageFile);

    // Optional config overrides
    const maxFaces = formData.get('max_faces') || '10';
    const limit = formData.get('limit') || '5';
    prmFaceForm.append('max_faces', maxFaces);
    prmFaceForm.append('limit', limit);

    // Call the PRMface server's temp-lookup endpoint (does not save image)
    const response = await fetch(`${process.env.PRMFACE_API_URL}/api/img/temp-lookup`, {
      method: 'POST',
      headers: {
        'X-API-Key': process.env.PRMFACE_API_KEY || '',
      },
      body: prmFaceForm,
    });

    if (!response.ok) {
      const errorResponse = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorResponse.detail || 'PRMface server responded with an error.' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('[PRMface Proxy Error]:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error.' },
      { status: 500 }
    );
  }
}
```

---

## 8. Displaying Images in the React Frontend

PRMface serves images via static CDN routes at `http://localhost:8000/img/{image_uuid}.jpg` and `http://localhost:8000/face-img/{face_uuid}.jpg`.

Because relative URLs (like `/img/c9d0...jpg`) are returned in response payloads, you must prepend the base URL in your React components to display them.

**React Frontend Component Snippet:**
```tsx
import React from 'react';

// Make sure your environment variables or config files store the PRMface base URL
const PRMFACE_CDN_URL = process.env.NEXT_PUBLIC_PRMFACE_URL || 'http://localhost:8000';

interface FaceCardProps {
  faceUrl: string; // e.g. "/face-img/f5e6d7c8-....jpg"
  bbox: { x: number; y: number; w: number; h: number };
  name: string;
}

export const FaceCard: React.FC<FaceCardProps> = ({ faceUrl, bbox, name }) => {
  const fullImageUrl = `${PRMFACE_CDN_URL}${faceUrl}`;

  return (
    <div className="border border-slate-700 rounded-lg p-4 bg-slate-900 text-white flex flex-col items-center">
      <img 
        src={fullImageUrl} 
        alt={name} 
        className="w-32 h-32 object-cover rounded-md border-2 border-indigo-500 mb-2" 
      />
      <div className="text-sm font-semibold">{name || 'Anonymous'}</div>
      <div className="text-xs text-slate-400 mt-1">
        Box: [{bbox.x}, {bbox.y}] {bbox.w}x{bbox.h}px
      </div>
    </div>
  );
};
```

---

## 9. Error Handling Guidelines for AIs

When writing software to invoke this API automatically, always observe the following HTTP status codes and structure error routines accordingly:

1. **`400 Bad Request`**: Indicates a validation failure, such as when no faces are detected in the uploaded image, or the image format is invalid (not jpeg, png, gif, webp, bmp, tiff). Adjust your input selection parameters or ask the client to re-capture.
2. **`401 Unauthorized`**: Indicates a missing or invalid `X-API-Key` header. Check your environment variables.
3. **`404 Not Found`**: Returned when querying a non-existent Person UUID, Face UUID, or Image UUID. Confirm identifiers before requesting.
4. **`409 Conflict`**: Returned by `/api/person/add` if you specify a `person_uuid` that already exists.
5. **`422 Unprocessable Entity`**: Returned by FastAPI if you pass wrong form names (e.g. `images` instead of `image`) or incorrect data types. Double-check types against the TypeScript schemas above.
