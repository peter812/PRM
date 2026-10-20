# References — implementation plan

A **reference** is one face crop plus whatever was printed next to it (name, bio) and where it came
from (location). References are a separate store from the standard face DB: importing a yearbook or
playbill page creates references only — no people, groups, schooling, notes, or `faces` rows.

## Decisions (from Q&A)

| Topic | Decision |
|---|---|
| Import output | References only. Today's people / group / sub-group / schooling / bio-note creation is removed. |
| Vectors | PRM-compute only (`reference_vectors`). PRM keeps the record, joined by the reference UUID. |
| Location | One `jsonb` object. `type` required (`"Yearbook"`, `"Playbill"`, or other); other keys optional. |
| Face search | In scope: by uploaded photo, or by an existing face crop. |
| Search entry points | References page (upload, or "find similar" on a reference), image-detail faces, person page (person-profile + me-profile). |
| Wipes | New "Delete all references" in Delete Options. Reset Database also clears them. "Delete Face Data" / "Reset Images & Faces" leave them alone. |

## Data model

Both tables live in the shared Postgres; **PRM owns the schema** (`shared/schema.ts` +
`server/db-init.ts`), compute only maps its table (its `_validate_schema` fails startup otherwise).
`references` is an SQL reserved word, so the tables are named:

**PRM — `reference_records`**
| column | type | notes |
|---|---|---|
| `id` | varchar PK | the reference UUID (same id as the compute row) |
| `crop_url` | text not null | `references/{id}.jpg` in the PRM-s3 bucket |
| `name` | text null | associated name |
| `bio` | text null | associated bio |
| `location` | jsonb not null | `{ type, year?, month?, quarter?, schoolName?, schoolLocation?, grade?, organization?, production? }` |
| `collected_at` | timestamptz not null default now() | date collected |

Indexes: `collected_at`, and `lower(name)` for the name search. Keyword search is `ILIKE` over
`name`, `bio` and `location::text` — fine at the ≤10k scale.

**Compute — `reference_vectors`**
| column | type | notes |
|---|---|---|
| `id` | varchar(36) PK | reference UUID |
| `embedding` | json not null | same encoding as `faces.embedding` |
| `created_at` | timestamptz | used by the orphan sweep |

Crops go under a **`references/`** S3 prefix, so the existing `faces/` wipes don't touch them.

## PRM-compute (new `routers/reference.py`, mounted in `main.py`)

- `POST /api/reference/detect` — multipart image. Detect faces (same min-size filter as
  `detect-sync`), upload each crop to `references/{uuid}.jpg`, insert a `reference_vectors` row.
  Returns `[{ reference_uuid, box, crop_url, detection_confidence }]`. Rows that never get a PRM
  record (skipped faces, abandoned imports) are removed by the commit `discard` list and by a sweep
  run at the start of each detect: rows older than 24h with no `reference_records` row.
- `POST /api/reference/search` — one of: image upload (every detected face is a probe),
  `face_uuids` (embeddings read from `faces`), or `reference_uuid`. Returns
  `[{ reference_uuid, similarity }]` above the threshold (default `runtime_config.sureness`),
  best score per reference, top N. Backed by a small cached normalized matrix (reloaded on a
  row-count change, like `face_index`'s check), not the main `face_index`.
- `POST /api/reference/delete` — `{ ids }`, or `{ all: true }` to wipe the table and the
  `references/` prefix.

Tests in `tests/` alongside `test_face_cluster.py`: detect → search finds it, delete removes it,
sweep drops orphans only.

## PRM server

- `server/references.ts` — compute calls via `computeFetch`, list/search queries, commit, delete-all.
- `server/routes/references.ts`, registered in `server/routes.ts`:
  - `GET  /api/references?name=&q=&type=&sort=newest|oldest&page=` — list + filter.
  - `POST /api/references/search` — multipart image, or JSON `{ faceUuid | personId | referenceId }`
    (`personId` resolves to the person's linked face UUIDs). Returns records + similarity.
  - `DELETE /api/references/all` — compute delete-all, then truncate `reference_records`.
- **Roster import rewrite** (`server/roster-import.ts`, `server/routes/roster-import.ts`):
  - *analyze* now takes the page image directly (multipart; no `/api/upload-image`, no `photos`
    row, so the page never enters the standard image/face pipeline). Calls `/api/reference/detect`,
    keeps `readingOrder` + `labelFaces` + the vision prompt, returns entries keyed by `referenceUuid`.
  - *commit* takes `{ location, entries: [{ referenceUuid, cropUrl, name, bio }], discard: [uuid] }`,
    inserts `reference_records`, and sends `discard` to compute.
  - Deleted: `matchPerson`/`matchPersonInGroup`, the `/match` route, `findOrCreateGroup`,
    `findOrCreateSubGroup`, `addMembers`, `addSchooling`, `profileCrop`, and the `isLowValue` use.
    The per-layout context fields become the location form.
- **Reset Database**: `dropAllTables` already removes `reference_records`; add a best-effort
  compute delete-all so the `references/` crops go too.

## PRM client

- `client/src/pages/roster-import-demo.tsx` — keep layout picker, page upload, box overlay and
  review list. Context fields become the location form (type follows the layout family:
  Yearbook → year, month, school name, school location, grade; Playbill → year, quarter,
  organization/branch, production). Review rows: crop, one name field, bio (leads layout), skip.
  Remove the match/suggestion UI; result card links to the references page.
- New `client/src/pages/references.tsx` at `/demos/references` (route in `App.tsx`, card in
  `demos.tsx`): name search, keyword search, type filter, sort by date collected, paginated
  grid of crop + name + location summary + date. A "Search by face" panel (upload a photo), and
  "Find similar" on each card.
- Shared `client/src/components/reference-matches-dialog.tsx` — shows matches (crop, name, bio,
  location, similarity %). Used by:
  - image-detail: "Find in references" on each detected face (`faceUuid`).
  - person-profile **and** me-profile: "Find in references" (`personId`).
- `client/src/pages/delete-options.tsx` — "Delete all references" card with confirm dialog, same
  pattern as the other delete-all actions.

## Order of work

1. Schema: `reference_records` in `shared/schema.ts` + `db-init.ts`; `reference_vectors` in
   `db-init.ts` and compute's `database.py`.
2. Compute router + tests.
3. PRM server: references module/routes, roster-import rewrite, reset hook.
4. Client: roster page rewrite, references page + demos card, matches dialog + entry points,
   delete option.
5. Verify: `npm run check`, compute pytest, then in the app: import a yearbook page → references
   appear, search by upload / face / person returns them, delete-all empties both stores and S3
   prefix, and "Delete Face Data" leaves references intact.

## Not included

- Turning a reference into a person (or linking one to an existing person).
- Deleting or editing a single reference.
- Migrating people already created by past yearbook/playbill imports.
