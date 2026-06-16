# Family Tree Feature — Backend Implementation Guide

This document outlines every backend change required to support the new Family Tree feature. An AI agent should follow these steps in order before starting any frontend work.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Database Schema Changes](#2-database-schema-changes)
3. [Drizzle Schema Updates (`shared/schema.ts`)](#3-drizzle-schema-updates)
4. [Database Init Updates (`server/db-init.ts`)](#4-database-init-updates)
5. [Storage Layer Updates (`server/storage.ts`)](#5-storage-layer-updates)
6. [API Endpoints (`server/routes.ts`)](#6-api-endpoints)
7. [Relationship Propagation Engine](#7-relationship-propagation-engine)
8. [Last-Name Matching Utility](#8-last-name-matching-utility)
9. [Data Model Reference](#9-data-model-reference)
10. [Testing Checklist](#10-testing-checklist)

---

## 1. Overview

The family tree feature extends the existing `relationships` table with a **directional family relationship type** system. It adds API endpoints for:

- Querying a person's family tree to N degrees of separation
- Automatically propagating relationship updates (e.g., if A is B's father and B is C's father, then A is C's grandfather)
- Connecting people by last name for suggested family links
- Creating "placeholder" people for missing family links

### Existing Infrastructure to Build On

| Existing Asset | Location | How We Extend It |
|---|---|---|
| `relationships` table | `shared/schema.ts:104-121` | Add `familyRelationshipType` column |
| `relationshipTypes` table | `shared/schema.ts:96-103` | No changes — family types are separate |
| Relationship CRUD routes | `server/routes.ts:2886-3069` | Add family-specific endpoints alongside |
| Storage methods | `server/storage.ts:895-950` | Add family tree query methods |
| DB init & seeding | `server/db-init.ts` | Seed family relationship types, add column |

---

## 2. Database Schema Changes

### 2.1 New Column on `relationships` Table

Add a nullable `family_relationship_type` column to the existing `relationships` table. This column stores the **directional** family relationship from `fromPersonId` → `toPersonId`.

```
ALTER TABLE relationships
  ADD COLUMN family_relationship_type VARCHAR(50) DEFAULT NULL;
```

When this column is `NULL`, the relationship is a non-family relationship (friend, colleague, etc.) and behaves exactly as before. When it is set, it indicates a family link.

### 2.2 Family Relationship Type Values

These are the supported directional values for `family_relationship_type`. The value describes **what `fromPerson` is to `toPerson`**.

| Value | Meaning (fromPerson is toPerson's...) | Inverse Value |
|---|---|---|
| `father` | Father | `child` |
| `mother` | Mother | `child` |
| `child` | Child (son/daughter) | `father` or `mother` |
| `son` | Son | `father` or `mother` |
| `daughter` | Daughter | `father` or `mother` |
| `grandfather` | Grandfather | `grandchild` |
| `grandmother` | Grandmother | `grandchild` |
| `grandchild` | Grandchild | `grandfather` or `grandmother` |
| `grandson` | Grandson | `grandfather` or `grandmother` |
| `granddaughter` | Granddaughter | `grandfather` or `grandmother` |
| `great_grandfather` | Great-grandfather | `great_grandchild` |
| `great_grandmother` | Great-grandmother | `great_grandchild` |
| `great_grandchild` | Great-grandchild | `great_grandfather` or `great_grandmother` |
| `stepfather` | Stepfather | `stepchild` |
| `stepmother` | Stepmother | `stepchild` |
| `stepson` | Stepson | `stepfather` or `stepmother` |
| `stepdaughter` | Stepdaughter | `stepfather` or `stepmother` |
| `uncle` | Uncle | `nephew` or `niece` |
| `aunt` | Aunt | `nephew` or `niece` |
| `nephew` | Nephew | `uncle` or `aunt` |
| `niece` | Niece | `uncle` or `aunt` |
| `great_uncle` | Great-uncle | `great_nephew` or `great_niece` |
| `great_aunt` | Great-aunt | `great_nephew` or `great_niece` |
| `great_nephew` | Great-nephew | `great_uncle` or `great_aunt` |
| `great_niece` | Great-niece | `great_uncle` or `great_aunt` |
| `cousin` | Cousin | `cousin` |
| `sibling` | Sibling | `sibling` |
| `brother` | Brother | `sibling` |
| `sister` | Sister | `sibling` |
| `half_brother` | Half-brother | `half_sibling` |
| `half_sister` | Half-sister | `half_sibling` |
| `spouse` | Spouse (married) | `spouse` |
| `ex_spouse` | Ex-spouse (divorced) | `ex_spouse` |

### 2.3 Inverse Relationship Map

Create a constant map in `shared/schema.ts` (or a new `shared/family-relationships.ts`) that maps each family relationship type to its inverse. This is critical for the propagation engine.

```typescript
export const FAMILY_RELATIONSHIP_INVERSES: Record<string, string> = {
  father: "child",
  mother: "child",
  child: "parent",      // generic — resolved to father/mother by gender if known
  son: "parent",
  daughter: "parent",
  grandfather: "grandchild",
  grandmother: "grandchild",
  grandchild: "grandparent",
  grandson: "grandparent",
  granddaughter: "grandparent",
  stepfather: "stepchild",
  stepmother: "stepchild",
  stepson: "stepparent",
  stepdaughter: "stepparent",
  uncle: "nephew_or_niece",
  aunt: "nephew_or_niece",
  nephew: "uncle_or_aunt",
  niece: "uncle_or_aunt",
  great_uncle: "great_nephew_or_niece",
  great_aunt: "great_nephew_or_niece",
  great_nephew: "great_uncle_or_aunt",
  great_niece: "great_uncle_or_aunt",
  cousin: "cousin",
  sibling: "sibling",
  brother: "sibling",
  sister: "sibling",
  half_brother: "half_sibling",
  half_sister: "half_sibling",
  spouse: "spouse",
  ex_spouse: "ex_spouse",
};
```

### 2.4 Relationship Generation Rules

Create a constant that defines how relationships can be **inferred** through transitivity:

```typescript
export const FAMILY_RELATIONSHIP_RULES: Array<{
  if: [string, string];   // [A→B type, B→C type]
  then: string;           // inferred A→C type
}> = [
  // Parent chain
  { if: ["father", "father"], then: "grandfather" },
  { if: ["mother", "father"], then: "grandfather" },
  { if: ["father", "mother"], then: "grandmother" },
  { if: ["mother", "mother"], then: "grandmother" },

  // Grandparent chain
  { if: ["father", "grandfather"], then: "great_grandfather" },
  { if: ["mother", "grandfather"], then: "great_grandfather" },
  { if: ["father", "grandmother"], then: "great_grandmother" },
  { if: ["mother", "grandmother"], then: "great_grandmother" },

  // Sibling inference (same parents)
  // If A is parent of B and A is parent of C, then B and C are siblings
  // (handled in propagation engine logic, not as a simple rule)

  // Uncle/Aunt (parent's sibling)
  { if: ["sibling", "father"], then: "uncle" },
  { if: ["sibling", "mother"], then: "aunt" },

  // Nephew/Niece (sibling's child)
  { if: ["child", "sibling"], then: "nephew_or_niece" },

  // Cousin (parent's sibling's child)
  { if: ["child", "uncle"], then: "cousin" },
  { if: ["child", "aunt"], then: "cousin" },

  // Spouse propagation — if A is spouse of B, and B is parent of C, A is also parent of C (step or bio)
  // This is complex and should be handled as suggestions, not auto-applied
];
```

---

## 3. Drizzle Schema Updates

**File**: `shared/schema.ts`

### 3.1 Add Column to `relationships` Table

Add the `familyRelationshipType` column to the existing `relationships` table definition:

```typescript
export const relationships = pgTable("relationships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromPersonId: varchar("from_person_id").notNull().references(() => people.id),
  toPersonId: varchar("to_person_id").notNull().references(() => people.id),
  typeId: varchar("type_id").references(() => relationshipTypes.id, { onDelete: "set null" }),
  notes: text("notes"),
  familyRelationshipType: varchar("family_relationship_type", { length: 50 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### 3.2 Add Family Relationship Constants

Add the following exports at the bottom of `shared/schema.ts` (or in a new file `shared/family-relationships.ts` and re-export):

- `FAMILY_RELATIONSHIP_TYPES` — array of all valid type strings
- `FAMILY_RELATIONSHIP_INVERSES` — map of type → inverse type
- `FAMILY_RELATIONSHIP_LABELS` — map of type → human-readable display label
- `FAMILY_RELATIONSHIP_RULES` — transitivity rules for propagation

### 3.3 Add Zod Validation

Extend the insert schema for relationships to validate the new column:

```typescript
export const insertRelationshipSchema = createInsertSchema(relationships).extend({
  familyRelationshipType: z.enum(FAMILY_RELATIONSHIP_TYPES).nullable().optional(),
});
```

---

## 4. Database Init Updates

**File**: `server/db-init.ts`

### 4.1 Add Column via `validateAndSyncSchema()`

Inside `validateAndSyncSchema()`, add a migration step that adds the column if it doesn't exist (following the existing pattern of `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):

```sql
ALTER TABLE relationships
  ADD COLUMN IF NOT EXISTS family_relationship_type VARCHAR(50) DEFAULT NULL;
```

### 4.2 Seed a "Family" Relationship Type

The existing seeding already includes a "Family" relationship type (`color: #ef4444, value: 90`). This type should be used as the `typeId` for any relationship that also has a `familyRelationshipType` set. No new seeding is needed unless we want to add sub-types (e.g., "Immediate Family", "Extended Family").

---

## 5. Storage Layer Updates

**File**: `server/storage.ts`

Add the following new methods to the `DatabaseStorage` class:

### 5.1 `getFamilyTree(personId: string, maxDepth: number)`

Performs a **breadth-first traversal** of family relationships starting from a given person, up to `maxDepth` hops away.

**Algorithm**:
1. Start with the given person as depth 0.
2. Query all relationships where `family_relationship_type IS NOT NULL` and either `from_person_id` or `to_person_id` matches a person in the current frontier.
3. For each found relationship, add the other person to the next frontier (if not already visited).
4. Continue until `maxDepth` is reached or no new people are found.
5. Return the full set of people and family relationships found.

**Return type**:
```typescript
interface FamilyTreeResult {
  people: Array<{
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    birthday: string | null;
    depth: number;  // distance from the root person
  }>;
  relationships: Array<{
    id: string;
    fromPersonId: string;
    toPersonId: string;
    familyRelationshipType: string;
  }>;
  missingLinks: Array<{
    personId: string;
    missingRole: string;          // e.g., "mother", "father"
    context: string;              // e.g., "parent of [child name]"
    relatedPersonId: string;      // the person this missing link relates to
  }>;
}
```

### 5.2 `detectMissingFamilyLinks(people: string[], relationships: Relationship[])`

Analyzes the tree and detects "missing" people:

- **Father/mother missing**: If a person has a `mother` relationship but no `father` (or vice versa), flag the missing parent.
- **Generation gap**: If a grandparent relationship exists but no intermediate parent, flag the missing parent.
- **Spouse missing**: If a person has children but no spouse relationship, suggest a missing spouse.

Returns an array of `MissingLink` objects.

### 5.3 `propagateFamilyRelationship(relationshipId: string)`

When a family relationship is created or updated, this method:

1. Loads the new relationship and both people.
2. Applies the `FAMILY_RELATIONSHIP_RULES` to infer new relationships.
3. For each inferred relationship, checks if it already exists.
4. Creates any new inferred relationships.
5. Returns a list of all relationships that were created.

**Example**:
- User sets: Sam → Don (father)
- User sets: Don → Jon (father)
- Propagation infers: Sam → Jon (grandfather)

### 5.4 `createFamilyRelationshipWithInverse(data: InsertRelationship)`

When creating a family relationship A→B, automatically create the inverse B→A relationship:

1. Create A→B with `familyRelationshipType = "father"`.
2. Look up the inverse: `FAMILY_RELATIONSHIP_INVERSES["father"] = "child"`.
3. Create B→A with `familyRelationshipType = "child"`.
4. Run propagation on both new relationships.

### 5.5 `getPeopleByLastName(lastName: string)`

Query all people whose `lastName` matches the given value (case-insensitive). Used for the "connect by last name" feature.

```typescript
async getPeopleByLastName(lastName: string): Promise<Person[]> {
  return db
    .select()
    .from(people)
    .where(ilike(people.lastName, lastName));
}
```

### 5.6 `getSuggestedFamilyConnections(personId: string)`

Given a person, suggest potential family connections based on:
1. Same last name
2. Existing relationships with people who have family links
3. Age/birthday proximity for sibling suggestions

---

## 6. API Endpoints

**File**: `server/routes.ts`

All new endpoints follow the existing patterns: authentication check, input validation with Zod, try/catch error handling, and JSON responses.

### 6.1 `GET /api/family-tree/:personId`

**Purpose**: Retrieve a person's family tree for canvas rendering.

**Query Parameters**:
| Parameter | Type | Default | Description |
|---|---|---|---|
| `depth` | number | `6` | Maximum degrees of separation to traverse |

**Response**:
```json
{
  "rootPersonId": "abc-123",
  "people": [
    {
      "id": "abc-123",
      "firstName": "John",
      "lastName": "Smith",
      "avatarUrl": "/api/images/john.jpg",
      "birthday": "1985-03-15",
      "depth": 0
    }
  ],
  "relationships": [
    {
      "id": "rel-1",
      "fromPersonId": "abc-123",
      "toPersonId": "def-456",
      "familyRelationshipType": "father"
    }
  ],
  "missingLinks": [
    {
      "personId": "abc-123",
      "missingRole": "mother",
      "context": "Mother of John Smith",
      "relatedPersonId": "abc-123"
    }
  ]
}
```

**Implementation Notes**:
- Calls `storage.getFamilyTree(personId, depth)`.
- Calls `storage.detectMissingFamilyLinks(...)` on the result.
- Returns the combined result.

### 6.2 `POST /api/family-relationships`

**Purpose**: Create a new family relationship with automatic inverse and propagation.

**Request Body**:
```json
{
  "fromPersonId": "abc-123",
  "toPersonId": "def-456",
  "familyRelationshipType": "father",
  "notes": "Biological father"
}
```

**Response**:
```json
{
  "relationship": { "id": "rel-1", "...": "..." },
  "inverseRelationship": { "id": "rel-2", "...": "..." },
  "propagatedRelationships": [
    { "id": "rel-3", "fromPersonId": "...", "toPersonId": "...", "familyRelationshipType": "grandfather" }
  ]
}
```

**Implementation**:
1. Validate input with Zod schema.
2. Look up or create the "Family" relationship type (to set `typeId`).
3. Call `storage.createFamilyRelationshipWithInverse(data)`.
4. Call `storage.propagateFamilyRelationship(newRelationship.id)`.
5. Return the created + propagated relationships.

### 6.3 `PATCH /api/family-relationships/:id`

**Purpose**: Update a family relationship (e.g., change type from `spouse` to `ex_spouse` for divorce).

**Request Body**:
```json
{
  "familyRelationshipType": "ex_spouse"
}
```

**Implementation**:
1. Update the relationship.
2. Find and update the inverse relationship.
3. Re-run propagation to update any derived relationships (e.g., step-parent relationships may change on divorce).

### 6.4 `DELETE /api/family-relationships/:id`

**Purpose**: Delete a family relationship and its inverse.

**Implementation**:
1. Find the inverse relationship (same people, inverse type).
2. Delete both the original and inverse.
3. Optionally: flag any propagated relationships that depended on this link for review.

### 6.5 `GET /api/family-relationships/types`

**Purpose**: Return the list of all valid family relationship types with labels.

**Response**:
```json
{
  "types": [
    { "value": "father", "label": "Father", "category": "parent", "inverse": "child" },
    { "value": "mother", "label": "Mother", "category": "parent", "inverse": "child" },
    { "value": "spouse", "label": "Spouse (Married)", "category": "partner", "inverse": "spouse" },
    { "value": "ex_spouse", "label": "Ex-Spouse (Divorced)", "category": "partner", "inverse": "ex_spouse" }
  ]
}
```

### 6.6 `POST /api/family-relationships/propagate`

**Purpose**: Manually trigger propagation for a specific person's family tree. Useful after bulk imports.

**Request Body**:
```json
{
  "personId": "abc-123"
}
```

**Implementation**:
1. Load all family relationships for the person.
2. Run the propagation engine on each.
3. Return a summary of new relationships created.

### 6.7 `GET /api/people/by-last-name/:lastName`

**Purpose**: Find all people with a given last name for family connection suggestions.

**Response**:
```json
{
  "people": [
    { "id": "abc-123", "firstName": "John", "lastName": "Smith", "avatarUrl": "..." }
  ]
}
```

### 6.8 `GET /api/family-tree/:personId/suggestions`

**Purpose**: Get suggested family connections for a person (same last name, potential siblings by age, etc.).

**Response**:
```json
{
  "suggestions": [
    {
      "personId": "ghi-789",
      "firstName": "Jane",
      "lastName": "Smith",
      "suggestedRelationship": "sibling",
      "confidence": "medium",
      "reason": "Same last name, similar age"
    }
  ]
}
```

---

## 7. Relationship Propagation Engine

This is the most complex piece of backend logic. It should be implemented as a standalone module (e.g., `server/family-propagation.ts`) for testability.

### 7.1 Core Algorithm

```
function propagateRelationship(newRelationship):
  queue = [newRelationship]
  created = []

  while queue is not empty:
    rel = queue.dequeue()
    A = rel.fromPersonId
    B = rel.toPersonId
    typeAB = rel.familyRelationshipType

    // Find all family relationships where B is involved
    relationsOfB = getAllFamilyRelationships(B)

    for each relBC in relationsOfB:
      C = relBC.toPersonId (or fromPersonId if B is toPersonId)
      typeBC = relBC.familyRelationshipType (adjusted for direction)

      // Check rules: if A→B is typeAB and B→C is typeBC, what is A→C?
      inferredType = lookupRule(typeAB, typeBC)

      if inferredType is not null:
        // Check if A→C relationship already exists
        existing = findFamilyRelationship(A, C)
        if existing is null:
          newRel = createFamilyRelationship(A, C, inferredType)
          created.push(newRel)
          queue.enqueue(newRel)  // further propagation

  return created
```

### 7.2 Safety Guards

- **Cycle detection**: Track visited (personA, personB) pairs to avoid infinite loops.
- **Max depth**: Limit propagation to a configurable depth (default: 6 hops).
- **Conflict resolution**: If an inferred relationship contradicts an existing one, do NOT overwrite. Log the conflict for manual review.
- **Batch size**: Process propagation in batches of 50 to avoid overwhelming the database.

### 7.3 Marriage/Divorce Updates

When a `spouse` relationship is created:
1. If spouse A has children, create `stepfather`/`stepmother` relationships from B to A's children (as suggestions, not auto-applied).
2. If both A and B have the same child, that child's other parent relationships remain unchanged.

When a `spouse` relationship is changed to `ex_spouse`:
1. Do NOT automatically remove step-parent relationships (they may still be valid).
2. Flag them for review.

---

## 8. Last-Name Matching Utility

### 8.1 Implementation

Add to `server/storage.ts` or a new `server/family-utils.ts`:

```typescript
async function findPotentialFamilyByLastName(personId: string): Promise<SuggestedConnection[]> {
  const person = await storage.getPersonById(personId);
  if (!person?.lastName) return [];

  const sameName = await storage.getPeopleByLastName(person.lastName);

  // Filter out the person themselves and anyone already connected
  const existingRelationships = await storage.getRelationshipsForPerson(personId);
  const connectedIds = new Set(existingRelationships.map(r =>
    r.fromPersonId === personId ? r.toPersonId : r.fromPersonId
  ));

  return sameName
    .filter(p => p.id !== personId && !connectedIds.has(p.id))
    .map(p => ({
      personId: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      suggestedRelationship: "unknown",
      confidence: "low",
      reason: `Same last name: ${person.lastName}`,
    }));
}
```

---

## 9. Data Model Reference

### 9.1 Updated `relationships` Table

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | VARCHAR (UUID) | NO | Primary key |
| `from_person_id` | VARCHAR | NO | FK → people.id |
| `to_person_id` | VARCHAR | NO | FK → people.id |
| `type_id` | VARCHAR | YES | FK → relationship_types.id |
| `notes` | TEXT | YES | Free-text notes |
| `family_relationship_type` | VARCHAR(50) | YES | Directional family type (NEW) |
| `created_at` | TIMESTAMP | NO | Auto-set on creation |

### 9.2 Directionality Convention

The `family_relationship_type` describes **what `from_person` is to `to_person`**:

- Row: `fromPersonId=Sam, toPersonId=Don, familyRelationshipType=father`
  → "Sam is Don's father"
- Inverse row: `fromPersonId=Don, toPersonId=Sam, familyRelationshipType=child`
  → "Don is Sam's child"

Both rows should always exist for every family relationship (maintained by `createFamilyRelationshipWithInverse`).

---

## 10. Testing Checklist

### Unit Tests
- [ ] `FAMILY_RELATIONSHIP_INVERSES` map is complete (every type has an inverse)
- [ ] `FAMILY_RELATIONSHIP_RULES` produce correct inferences
- [ ] `propagateFamilyRelationship` correctly infers grandfather from two father links
- [ ] `propagateFamilyRelationship` handles cycles without infinite loops
- [ ] `detectMissingFamilyLinks` detects missing parents
- [ ] `detectMissingFamilyLinks` detects generation gaps
- [ ] `createFamilyRelationshipWithInverse` creates both directions

### Integration Tests
- [ ] `GET /api/family-tree/:personId` returns correct tree at depth 1, 3, 6
- [ ] `POST /api/family-relationships` creates relationship + inverse + propagated
- [ ] `PATCH /api/family-relationships/:id` updates both directions
- [ ] `DELETE /api/family-relationships/:id` removes both directions
- [ ] `GET /api/people/by-last-name/:lastName` returns case-insensitive matches
- [ ] Marriage → divorce flow correctly updates relationship type
- [ ] Propagation: father + father = grandfather
- [ ] Propagation: father + sibling = uncle
- [ ] Missing links detected for single-parent situations

### Edge Cases
- [ ] Person with no family relationships returns empty tree
- [ ] Circular family relationships (e.g., remarriage) don't cause infinite loops
- [ ] Very large family trees (100+ people) perform within acceptable time
- [ ] Concurrent propagation requests don't create duplicate relationships
