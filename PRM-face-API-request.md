# PRM-Face API Feature Request: Manual Face-to-Person Assignment

## Background

The PRM app has a "Save with Assignments" workflow where a user uploads a photo, identifies each detected face by selecting a person (or social account) from the CRM, and saves the image. The goal is that the face records in PRM-Face end up linked to the correct person UUIDs.

**Current gap:** After a user manually identifies a face in the UI and hits Save, the PRM app has no API endpoint to write that assignment back to PRM-Face. Face records remain as orphans even when the user has explicitly named them.

---

## Current Flow (broken)

```
1. POST /api/img/temp-lookup   → detect faces (not saved), get face boxes + face_index
2. User assigns person UUIDs to each face_index in the UI
3. POST /api/img/add           → upload + save image, faces auto-matched by similarity
4. *** No endpoint to override/set person_uuid for a specific face_uuid ***
```

Step 3 only links faces via similarity search. For a person's first appearance in PRM-Face (no prior embeddings), the face becomes an orphan — the manual assignment is lost.

---

## Requested New Endpoint

### `POST /api/face/assign`

Manually assign (or reassign) a face record to a specific person.

#### Headers

| Header | Required | Description |
|---|---|---|
| `X-API-Key` | Yes | Admin API key |

#### Request Body (`application/x-www-form-urlencoded`)

| Field | Type | Required | Description |
|---|---|---|---|
| `face_uuid` | string (UUID) | Yes | The UUID of the face record to assign |
| `person_uuid` | string (UUID) | Yes | The UUID of the Person to link the face to. PRM-Face should **create this person if they don't already exist** (upsert semantics). |
| `name` | string | No | Display name for the person. Used only when a new person record is being created. Ignored if the person already exists. |

#### Success Response `200`

```json
{
  "face_uuid": "d4e5f6a7-...",
  "person_uuid": "a1b2c3d4-...",
  "person_created": false
}
```

| Field | Description |
|---|---|
| `face_uuid` | Echo of the face UUID that was updated |
| `person_uuid` | Echo of the person UUID that is now linked |
| `person_created` | `true` if a new Person record was auto-created, `false` if one already existed |

#### Error Responses

| Status | Condition |
|---|---|
| `404` | `face_uuid` does not exist in the database |
| `422` | Missing required field or invalid UUID format |

---

## How PRM Will Call This

After successfully uploading an image via `POST /api/img/add` (which returns per-face results including `face_uuid` values), PRM will iterate through the user's assignments and call the new endpoint once per assigned face:

```
POST /api/img/add
  → { image_uuid, faces: [ { face_uuid, face_index, ... }, ... ] }

For each user assignment where person_uuid is set:
  POST /api/face/assign
    face_uuid  = faces[assignment.face_index].face_uuid
    person_uuid = assignment.person_uuid
    name        = assignment.person_name   (optional hint)
```

### Example (two faces, one assigned)

```
POST /api/img/add
→ {
    "image_uuid": "img-111",
    "faces": [
      { "face_uuid": "face-aaa", "face_index": 0 },
      { "face_uuid": "face-bbb", "face_index": 1 }
    ]
  }

POST /api/face/assign
  face_uuid   = "face-aaa"
  person_uuid = "person-xyz"   ← CRM person UUID
  name        = "Alice Smith"  ← for auto-creation only

# face-bbb is left as an orphan (user chose "None")
```

---

## Implementation Notes

1. **Upsert person**: If `person_uuid` is supplied but doesn't exist, create the person record (same behaviour as `POST /api/person/add` with a supplied UUID). This avoids requiring two calls from the client.

2. **Embedding update**: When a face is manually assigned it should be re-indexed into the similarity search under the new `person_uuid`, so future automatic matches for this person start working immediately.

3. **Idempotent**: Calling the endpoint twice with the same `face_uuid` + `person_uuid` should succeed silently (no error). Calling it with a different `person_uuid` should reassign (overwrite).

4. **Bulk variant (optional but helpful)**: A batch endpoint would reduce round-trips when saving many faces at once:

```
POST /api/face/assign-bulk

Body (JSON):
{
  "assignments": [
    { "face_uuid": "face-aaa", "person_uuid": "person-xyz", "name": "Alice Smith" },
    { "face_uuid": "face-ccc", "person_uuid": "person-abc", "name": "Bob Jones" }
  ]
}
```

---

## Summary

| | Before | After |
|---|---|---|
| Manual face identification | Collected in UI, silently discarded | Written to PRM-Face via `/api/face/assign` |
| First image of a new person | Face becomes orphan | Person auto-created, face linked, embeddings indexed |
| Subsequent images | Auto-matched by similarity | Auto-matched by similarity (now works for manually seeded people too) |
