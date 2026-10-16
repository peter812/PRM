# Nicknames, maiden names & TPS "Link to person" — plan

Spans **PRM** (DB, API, GUI) and **PRM-chrome** (TruePeopleSearch content script).

## 0. What already exists

| Piece | Status |
|---|---|
| `people.maiden_name` column | ✅ `shared/schema.ts:106`, migration in `server/db-init.ts:635` |
| Maiden name edit | ✅ only in `additional-info-dialog.tsx` (not on the create/edit person dialog) |
| Maiden name display | ✅ `person-profile.tsx:273` "(née …)", `:441`, `me-profile.tsx:341` |
| Maiden name search / TPS match | ❌ |
| `people.nickname` | ❌ (the `nickname` columns in schema are `users` / `social_accounts`, unrelated) |
| Shared person-name formatter | ❌ — ~40 client files build `{firstName} {lastName}` by hand |

So maiden name only needs: create/edit dialog field, search, TPS matching. Nickname is new end to end.

## 1. DB

- `shared/schema.ts` `people`: add `nickname: text("nickname")` next to `maidenName`.
- `server/db-init.ts` `schemaDefinitions.people`: add `nickname: "TEXT"`.
- `insertPersonSchema` picks it up automatically (drizzle-zod); confirm `nickname` and `maidenName` aren't omitted.

## 2. Shared display helper

New `shared/person-name.ts`:

```ts
export function formatPersonName(p: { firstName?: string|null; lastName?: string|null; nickname?: string|null }): string
// no nickname (or nickname == firstName, case-insensitive) → "First Last"
// nickname                                                  → "Nick (First) Last"
```

Plus `personInitials(p)`, which uses the nickname's first letter when one is set, for the avatar fallbacks that currently do `firstName[0]`.

Replace the hand-built names in every client file found by
`rg -l "firstName\}\s*\{[a-zA-Z.?]*lastName|\.firstName\} \$\{"` (~41 files: people-list, global-search, person pickers, dialogs, family tree, graphs, games, messages, groups, etc.). Purely mechanical. Leave alone:
- the delete-confirm text in `person-dialog.tsx` (either form works there; switch it to the helper anyway for consistency);
- any place that sends first/last to the server as data (e.g. the TPS add payload).

Server-side strings shown to the user (AI tools context, `connection-strength`, vector text in `vector-universal.ts`) should also use the helper so nicknames are searchable by AI/vector. Re-syncing vectors for edited people happens through the existing `vectorSyncedAt` flow.

Profile header (`person-profile.tsx:~270`, mirrored to `me-profile.tsx`): `Nick (First) Last (née Maiden)`.

## 3. Create / edit person page

`client/src/components/person-dialog.tsx`:
- Add **Nickname** and **Maiden name** inputs under First/Last (a 2-col row, same style). Maiden name stays in `additional-info-dialog.tsx` too, because both write the same column.
- Add both to the form schema, defaults, and reset values (lines ~81/98/111).
- `person-profile.tsx` / `me-profile.tsx` details card: show `Nickname: …` beside the existing `Maiden Name: …` line.

## 4. Search & matching

- `server/storage.ts` `searchPeople` (~953): add `nickname ILIKE`, `maiden_name ILIKE`, `CONCAT(nickname,' ',last_name)`, and `CONCAT(first_name,' ',maiden_name)` to the WHERE. In the ORDER BY CASE, treat a `nickname ILIKE start%` match the same as a first-name match.
- `server/routes/tps.ts` `findMatchingPerson`: a candidate matches if the TPS key equals any of
  `first last`, `nickname last`, `first maiden`, `nickname maiden`.
  The candidate lookup term is `norm.last`, which can now hit `maiden_name` through the search change above.
- **TPS-id match first:** `/tps/match` and `/tps/person-status` first look up `people.tps_id = :tpsId`, then fall back to the name match. A linked person therefore stays Found even when the names still differ. For `/tps/match`, do one `inArray(people.tpsId, ids)` query per batch.

## 5. New TPS API (PRM)

Both routes live under `/api/v1/tps/`, the only prefix the PRM-chrome service-worker proxy allows (`service-worker.js:537`). Both use `requireExtensionSession`.

**`GET /api/v1/tps/people-search?q=`** — returns 400 if `q.trim().length < 3`. Calls `storage.getAllPeople(q)` and returns the top 20:
`{ id, firstName, lastName, nickname, maidenName, imageUrl, tpsId }`. `tpsId` is included so the UI can warn "already linked to another TPS record".

**`POST /api/v1/tps/link`**
```ts
{ tpsId, personId,
  first: "keep" | "replace" | "toNickname" | "swapToNickname",
  last:  "keep" | "replace" | "toMaiden",
  tpsFirstName, tpsLastName }
```
Builds one `people` update in a transaction:

| choice | effect |
|---|---|
| first `replace` | `firstName = tpsFirst` |
| first `toNickname` | `nickname = tpsFirst` (PRM first name kept) |
| first `swapToNickname` | `nickname = old firstName`, `firstName = tpsFirst` |
| last `replace` | `lastName = tpsLast` |
| last `toMaiden` | `maidenName = tpsLast` (PRM last name kept) |
| always | `tpsId = tpsId` |

"Replace first + last" in the UI is just `first: replace, last: replace`, so no extra case is needed. Returns `{ personUuid }` plus the same fields as `person-status`, so the extension can re-render without another call.

If the choice would overwrite an existing nickname or maiden name, the UI shows the current value beside the option (e.g. "replaces 'Bobby'"). The server just overwrites.

Update `Guides/PRM-external-API-guide.md` and `client/src/pages/api-docs.tsx` with both routes.

## 6. PRM-chrome — "Link to person"

All changes are in `content/truepeoplesearch.js` and `content/truepeoplesearch.css`. Nothing changes in the manifest or service worker.

**Button.** In `renderPersonState`'s Not Found branch, add a secondary **Link to person** button next to **Add to PRM**.

**Search panel** (reuses the `.prm-addr-panel` pattern from `confirmPrimary`):
- A text input with hint "Type 3+ characters". Debounced 250 ms; no request under 3 chars.
- Result rows show an avatar (`imageUrl`), the formatted name `Nick (First) Last`, and a "née Maiden" line when set. If the row already has a different `tpsId`, it gets a "Linked to another TPS record" badge.
- Cancel closes the panel.

**Name-choice panel** (opens when a result is clicked). TPS name = `#personDetails` `data-fn` / `data-ln`. Comparisons are case-insensitive and trimmed. It shows a header `TPS: John Smith → PRM: Bob Smyth` and two radio groups, each with a dot on the left:

*First name* (only when the first names differ):
- ◉ Keep "Bob" *(default)*
- ○ Replace first **and** last name with "John Smith" — *only when both names differ*. Picking it disables the last-name group.
- ○ Replace first name with "John"
- ○ Make "John" a nickname (keep "Bob")
- ○ Make "Bob" a nickname and use "John" as first name

*Last name* (only when the last names differ):
- ◉ Keep "Smyth" *(default)*
- ○ Replace last name with "Smith"
- ○ Make "Smith" the maiden name

If both names already match, skip this panel and link right away.

Buttons: **Confirm & Link** / **Back** (returns to search) / **Cancel**.

**After linking:** call `POST /api/v1/tps/link`, then `renderPersonState(..., { found: true, personUuid, extracted, primaryAddress })`. The box now shows **Found** plus **Extract**, and the message reads "Linked to Bob (John) Smith."

The content script keeps its own small copy of `formatPersonName` (it can't import from PRM), with a "keep in step with shared/person-name.ts" comment, the same way `parseTpsRange` is handled.

CSS: add `.prm-link-search`, `.prm-link-result` (hover, avatar 28px), `.prm-name-group` (heading + radio list), reusing the `.prm-addr-option` styles for the dot rows.

## 7. Testing

- `npm run check` (tsc) in PRM.
- Manual: create a person with a nickname and maiden name, then check the people list, global search, profile header, and the search hits for the nickname and the maiden name.
- TPS: on a Not Found person, link it with each first/last option combination, then verify the DB row, that the page flips to Found, that a reload stays Found (tpsId match), and that the results page shows Found for that card.
- Matching: TPS "Robert Smith" vs PRM first "Bob", nickname "Robert", last "Smith" → Found.

## 8. Order of work

1. DB column + schema → 2. `formatPersonName` + profile/dialog fields → 3. search & match changes → 4. TPS API routes → 5. PRM-chrome UI → 6. mechanical replacement across ~40 files → 7. docs.
