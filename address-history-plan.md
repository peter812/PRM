# Address History Plan

PRM moves from one free-text `people.address` to a **dated address history per person**:

- Every address has a **start** and an optional **end**. No end means the person still lives there.
- A person can have **several current addresses** at once, for example a family home and a dorm.
- **At most one address is primary.** If the primary gets an end date, it **stays primary** and shows a **yellow "Outdated" badge** until the user picks a new one.
- **PRM-chrome** brings in a person's whole TruePeopleSearch (TPS) address history, with dates, and asks the user to **confirm the primary address** while importing.

### Decisions (confirmed)

| # | Decision |
|---|---|
| 1 | Dates are stored as **partial ISO text**: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. TPS and users usually only know month precision |
| 2 | TPS **Extract writes addresses straight into the history**. The True DB tab no longer suggests addresses |
| 3 | Addresses from **existing TPS records are backfilled** into the history. PRM-chrome and its connection to PRM are updated (§5) |
| 4 | **`people.address` is dropped.** Everything that reads or writes it is updated (§1) |
| 5 | Ending the primary address **does not move primary elsewhere**. The address stays primary, shows in **yellow**, and is labelled **"Outdated"** |

---

## 1. Everything that uses `people.address` (all of it must change)

Found by searching PRM and every sibling repo (PRM-chrome, -compute, -face, -osint, -s3, -stories, -VR, -Docs). **Only PRM's own code uses this column.** PRM-chrome never reads it; it only sends raw TPS data.

| # | File | What it does now | Change |
|---|---|---|---|
| 1 | `shared/schema.ts:107` | `address: text("address")` on `people` | Remove it. Add the `personAddresses` table (§2) |
| 2 | `shared/schema.ts:1362` | `insertPersonSchema` → `address` | Remove it. A PATCH that still sends `address` has it ignored, because Zod strips unknown keys |
| 3 | `shared/schema.ts:30` | `TpsAddress { address, propertyUrl }` | Add `startDate?` and `endDate?` |
| 4 | `server/db-init.ts:1544` | `addColumnIfNotExists("people","address")` | **Delete this line.** Otherwise the column is recreated on the next boot, after the migration has dropped it. The migration (§2.4) goes in its place |
| 5 | `server/map-geocoder.ts:28-41` `pinAddresses` | Reads `people.address` and the TPS current and past addresses | Read `person_addresses` only (§7) |
| 6 | `server/routes/demos-map.ts:95-127` DELETE pin | Sets `people.address` to NULL and strips TPS JSON | Delete the row from `person_addresses` (§7) |
| 7 | `server/task-worker.ts:671` | Backup export `<address>` | Export a new `<person_addresses>` section (§8) |
| 8 | `server/task-worker.ts:1944` | Backup import `address:` | Turn an old `<address>` into a primary `legacy` row (§8) |
| 9 | `client/src/components/true-db-tab.tsx:124-125, 152-153` | Confirming or editing a suggestion PATCHes `address` | Remove the address branch (§6.2) |
| 10 | `client/src/components/true-db-tab.tsx:317-345` | Builds address suggestions by comparing against `person.address` | Remove them (§6.2) |
| 11 | `client/src/pages/person-profile.tsx:581-587` | Shows `person.address`, and uses it in the "No details set" check | Show the primary address plus a new Addresses section (§6.1) |
| 12 | `client/src/pages/social-account-profile.tsx:1342-1347` | Shows `owner.address` | Show `owner.primaryAddress`, with the Outdated badge when it applies |
| 13 | `client/src/pages/map-demo.tsx:3` | Header comment ("the Address field plus TruePeopleSearch…") | Update the comment |
| 14 | `PRM-chrome/truepeoplesearch-injection-plan.md` | Documents the extract payload and `person-status` | Document the new fields (§5.6) |

Already checked and **not affected**: `additional-info-dialog.tsx` (no address field), the `update_person` AI tool, vector/Qdrant sync, `prm-app-knowledge.csv`, PRM-VR, and the SMS/phone "address" code (`sms-import.ts`, `messages.ts`, `storage.ts:6313`, which use phone numbers, not postal addresses).

**Safety net:** once the column is removed from `schema.ts`, `npm run check` flags any TypeScript reader still left, because the `Person` type no longer has `address`. Raw SQL strings are not type-checked, which is why rows 5 and 6 are listed by hand. Run `grep -rn "people.*address\|SET address" server` before merging.

---

## 2. Data model

### 2.1 New table `person_addresses`

```ts
export const personAddresses = pgTable("person_addresses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: varchar("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  label: text("label"),                 // optional: "Home", "Dorm", "Work"…
  startDate: text("start_date"),        // partial ISO: "2017" | "2017-07" | "2017-07-14"; null = unknown
  endDate: text("end_date"),            // same format; NULL = current
  isPrimary: integer("is_primary").notNull().default(0), // matches the 0/1 style of is_starred
  source: text("source").notNull().default("manual"),    // 'manual' | 'tps' | 'legacy'
  propertyUrl: text("property_url"),    // TPS /find/address/... link
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("person_addresses_person_id_idx").on(t.personId)]);

export type PersonAddress = typeof personAddresses.$inferSelect;
export const insertPersonAddressSchema = createInsertSchema(personAddresses)
  .omit({ id: true, personId: true, createdAt: true, updatedAt: true, source: true })
  .extend({ startDate: partialDate.nullable().optional(), endDate: partialDate.nullable().optional() });
```

`partialDate = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/)`. A refinement rejects `endDate < startDate`. Comparing the strings works because partial ISO dates sort correctly as text.

### 2.2 Constraints the database enforces (raw SQL in `db-init.ts`)

```sql
-- one primary address per person (it may be current or outdated)
CREATE UNIQUE INDEX IF NOT EXISTS person_addresses_one_primary
  ON person_addresses (person_id) WHERE is_primary = 1;
-- the same address appears only once per person; same expression as normAddress() in map-geocoder.ts
CREATE UNIQUE INDEX IF NOT EXISTS person_addresses_person_query
  ON person_addresses (person_id, lower(regexp_replace(trim(address), '[[:space:]]+', ' ', 'g')));
```

There is **no** constraint saying "primary must be current", because decision 5 lets an outdated address stay primary.

### 2.3 Primary rules (`server/storage.ts`)

| Event | Result |
|---|---|
| A person with **no primary at all** gets a current address | It becomes primary automatically |
| **Make primary** on a current address | In one transaction: clear the old primary, set this one |
| **Make primary** on an ended address | **400**: "Only a current address can be made primary" |
| **The primary gets an end date** | **No change to primary.** It is now *outdated*. The UI shows it in yellow as "Outdated" and offers "Make primary" on the other current addresses |
| **The end date is removed** from an outdated primary | It is current again and the yellow badge goes away. Nothing else to do |
| **The primary is deleted** | The person has no primary until the user picks one. Nothing is promoted automatically, which matches decision 5 |
| A person whose only primary is outdated gets a new current address | It is **not** made primary automatically. The outdated badge already asks the user to pick |

"Outdated" is **derived, not stored**: `isPrimary = 1 AND endDate IS NOT NULL`. There is no extra column to keep in sync.

Storage methods:

- `getPersonAddresses(personId)`
- `createPersonAddress(personId, data)`
- `updatePersonAddress(id, patch)`
- `deletePersonAddress(id)`
- `setPrimaryAddress(id)`
- `getPrimaryAddress(personId)` → `{ address, outdated } | null`
- `upsertTpsAddresses(personId, entries, primary)` (§5.4)

### 2.4 Migration (`db-init.ts`, idempotent, one transaction)

This replaces the old `addColumnIfNotExists("people","address")` line. **It only runs while `people.address` still exists** (check `information_schema.columns`), so after the first successful boot it does nothing.

1. `CREATE TABLE IF NOT EXISTS person_addresses …` plus the two indexes from §2.2.
2. **Legacy copy**: every non-blank `people.address` becomes a row with `is_primary = 1`, `source = 'legacy'`, and no dates (unknown).
3. **TPS backfill** (decision 3): for each person's **latest** `true_person_search` row:
   - `current_address` becomes a **current** row with `source 'tps'` and its `property_url`. `start_date` is parsed from `current_address_property_details` with the same `parseTpsRange` logic as §5.2, ported to the server as `server/tps-dates.ts`.
   - Every `addresses[]` entry becomes a **past** row. Their dates were never scraped, so they are unknown. To still count as past, they get the sentinel `end_date = '0000'`, which the UI shows as "ended (date unknown)". → *See open question A.*
   - Everything uses `ON CONFLICT DO NOTHING`, so the legacy primary wins if both have the same address.
   - If a person still has **no primary** after step 2, the backfilled TPS current address becomes primary. This is the same "no primary at all" rule as §2.3.
4. `ALTER TABLE people DROP COLUMN address`.

Scale: the 10k person ceiling means a TypeScript loop with batched inserts is fine. No set-based SQL trickery is needed.

---

## 3. PRM server API

Routes go in `server/routes/people-groups.ts`, next to the existing person routes:

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/people/:id/addresses` | Sorted: primary first, then current ones by latest start, then past ones by latest end |
| POST | `/api/people/:id/addresses` | `{ address, label?, startDate?, endDate?, isPrimary? }` |
| PATCH | `/api/addresses/:id` | Any of the fields. `isPrimary: true` → `setPrimaryAddress` (400 if the address has ended) |
| DELETE | `/api/addresses/:id` | — |

- `GET /api/people/:id` adds **`primaryAddress: { address: string, outdated: boolean } | null`**. That covers the profile header and the social-account owner card (which already fetches `/api/people/:ownerUuid`) without another request.
- Errors follow the existing pattern: `ZodError` → 400 with `errors[0].message`, anything else → 500.
- Access checks follow the existing `/api/people/:id` routes: the address must belong to a person the caller can see.

---

## 4. Shared helpers

- `shared/partial-date.ts`
  - `partialDate` (the Zod schema above)
  - `formatPartialDate("2017-07") → "Jul 2017"`
  - `formatDateRange(start, end) → "Jul 2017 – present" | "Jan 2015 – Jun 2018" | "ended (date unknown)"`

  Used by the client UI and by the server's TPS parsing.
- `server/tps-dates.ts` → `parseTpsRange("(Jul 2017 - Jul 2026)") → { start: "2017-07", end: "2026-07" }`. It also handles a single year (`"2015"`), a single month-year, and an empty or missing range (→ nulls).

---

## 5. PRM-chrome and its connection back to PRM

### 5.1 How it connects today

```
TPS person page (content/truepeoplesearch.js)
  └─ apiFetch(path, {method, body})
       └─ chrome.runtime.sendMessage({type:"PRM_TPS_API", …})
            └─ background/service-worker.js:968  prmApiFetch()  →  PRM  (X-Extension-Token)
                 ├─ GET  /api/v1/tps/person-status?tpsId&name  → { found, personUuid, extracted, tpsRecordId }
                 ├─ POST /api/v1/tps/add                       → creates the contact
                 └─ POST /api/v1/tps/extract                   → inserts the raw true_person_search row
```

The service worker proxy is a **generic pass-through**, so it needs **no changes**. All the changes are in the content script, its CSS, and PRM's `tps.ts`.

### 5.2 Scraper changes (`content/truepeoplesearch.js`)

- Add `parseTpsRange(text)`, a client copy of §4's parser. It reads the `(Mon YYYY - Mon YYYY)` span inside each address's `.dt-ln`.
- `scrapeAddresses()`: each entry becomes `{ address, propertyUrl, startDate, endDate }`.
- Current address: add `currentAddressStartDate`. **TPS's end date for the current address is ignored**, because there it means "last reported", not "moved out".
- `currentAddressPropertyDetails` stays as it is, the raw text. It is still useful in the True DB tab.

### 5.3 New UI step: confirm the primary address

Today, **Extract** goes straight to a POST. The new flow:

1. **Extract** no longer POSTs right away. It expands the PRM box with a **"Confirm primary address"** panel:
   - A radio list. The **TPS current address** comes first and is **preselected**. Below it are the TPS previous addresses, each with its range ("Jan 2015 – Jun 2018").
   - If `person-status` returned a PRM primary, there is a **"Keep PRM's primary: _&lt;address&gt;_"** option.
     - If that primary is outdated, the option shows a **yellow "Outdated"** badge, matching the PRM UI, and is **not** preselected.
     - If it is current and is the same address as the TPS current address (compared after normalizing both), the two are merged into one option.
   - Picking a previous TPS address as primary marks it **current** in PRM (its TPS end date is dropped). This handles TPS being out of date.
   - Buttons: **Confirm & Extract** and **Cancel**.
2. **Confirm & Extract** → POST `/api/v1/tps/extract` with `primaryAddress` (below). The chip goes extracting → extracted as it does today. The message reads "Record extracted — N addresses added, primary: _X_".
3. **Cancel** collapses the panel and puts the Extract button back. Nothing is sent.
4. "Add to PRM" for a Not Found person does not change. After adding, the box re-renders as Found with Extract, so the confirm step happens there.

New CSS goes in `content/truepeoplesearch.css`:

- `.prm-addr-list` and `.prm-addr-option`, with radios and the range in muted text.
- `.prm-badge--outdated`: yellow, `#fef3c7` background and `#92400e` text, the same palette the PRM UI uses.
- `.prm-btn--secondary` for Cancel.

### 5.4 PRM server changes (`server/routes/tps.ts`)

**`GET /api/v1/tps/person-status`** adds:

```json
{ "primaryAddress": { "address": "5418 N Simpson Rd, Otis Orchards, WA 99027", "outdated": false } | null }
```

**`POST /api/v1/tps/extract`**:

- `tpsAddressSchema` adds `startDate` and `endDate` (`partialDate`, nullable, optional).
- `extractSchema` adds `currentAddressStartDate`, and:
  ```ts
  primaryAddress: z.union([
    z.object({ choice: z.literal("keep") }),                // keep PRM's primary as is
    z.object({ choice: z.literal("tps"), address: z.string().min(1) }), // make this TPS address primary
  ]).optional()   // absent = an old extension build (§5.5)
  ```
- After the raw snapshot is inserted, **when `personId` is set**, the same transaction calls `upsertTpsAddresses(personId, entries, primaryAddress)`:
  1. Build the entries: the TPS current address (no end date) and the previous ones (with their dates).
  2. Match each entry to existing rows by **normalized address**. A new address is inserted with `source 'tps'`. For an existing one, **only empty fields are filled** (`startDate`, `endDate`, `propertyUrl`), so anything the user edited by hand wins.
  3. **The confirmed primary never gets an end date filled in.** The user just confirmed it is current, so a TPS "ended" date for that address is skipped.
  4. For `choice: "tps"`: set that row's `endDate` to null and call `setPrimaryAddress`. For `choice: "keep"`: change nothing about the primary.
  5. Return `{ tpsRecordId, status: "extracted", addressesAdded, primaryAddress }`, which the extension uses for its success message.

### 5.5 Version compatibility

| Extension | PRM | Behaviour |
|---|---|---|
| New | New | The full flow |
| **Old** (no `primaryAddress`, no dates) | New | Addresses are added **without dates**. With `primaryAddress` absent, the TPS current address becomes primary **only if the person has no primary at all**. Nothing breaks |
| New | **Old** | Zod strips the unknown keys. The raw record is saved as it is today. The chooser still appears, but `person-status` has no `primaryAddress`, so there is no "Keep" option. Harmless |

Bump `manifest.json` `version` from `1.0.0` to `1.1.0`.

### 5.6 Docs

- `PRM-chrome/truepeoplesearch-injection-plan.md`: the new `person-status` field, the extract payload fields and response, and the confirm step in the flow list.
- `PRM-chrome/README.md`: one line in the TPS section about the primary-address confirmation.

### 5.7 Known limitation (not in scope)

Once a TPS page has been extracted, the Extract button is hidden (`renderPersonState`, `!state.extracted`). The extracted check is by `tpsId`. So a person's TPS history **can't be refreshed** from the extension later. If that matters, a "Re-extract" button is a small follow-up, because `upsertTpsAddresses` already merges safely.

---

## 6. PRM client UI

### 6.1 Person profile (`person-profile.tsx`)

- **Details card** (in place of the `person.address` block at `:581`):
  - The **primary** address with a home icon.
    - **Current**: plain text.
    - **Outdated**: yellow text with a yellow **"Outdated"** badge (`bg-yellow-100 text-yellow-800`, and `dark:bg-yellow-900/40 dark:text-yellow-200` in dark mode).
  - **Other current addresses** below it, smaller, with their labels ("Dorm").
  - The "No details set" check uses `primaryAddress` in place of `person.address`.
- A new **Addresses** section or tab (`client/src/components/person-addresses.tsx`):
  - **Current**: each row shows the address, its label, "since Jul 2017" and a ★ **Make primary** button (hidden on the primary itself), plus Edit, **End** and Delete.
  - **Primary row**: a filled ★. If outdated, it stays **at the top** in yellow with the "Outdated" badge, and its range reads "Jul 2017 – Jun 2026".
  - **Previous**: collapsed by default, showing the address and "Jan 2015 – Jun 2018".
  - **Add address** dialog: address, label, start (month picker plus an optional day), end (empty = current), and a "Make primary" checkbox. The checkbox is disabled when an end date is set.
  - **End** quick action: a month picker that sets `endDate`. If the address is the primary, the toast says *"Primary address is now outdated — pick a new primary."*
- Query key: `["/api/people", id, "addresses"]`. Mutations invalidate it and `["/api/people", id]`, so `primaryAddress` refreshes.

### 6.2 True DB tab (`true-db-tab.tsx`)

- Remove the address suggestions (`:317-345`) and the `address` branches of `handleConfirm` and `handleSaveEdit` (`:124`, `:152`). Narrow the `type` union at `:38` to `"birthday" | "email" | "phone"`.
- In the raw-record list (`:492-503`), show each address's TPS range (`formatDateRange`) when it has one.
- Old `deniedRecommendations` entries that are addresses become unused. They do no harm, so no cleanup is needed.

### 6.3 Social account profile (`social-account-profile.tsx:1342`)

Show `owner.primaryAddress.address`, with the same yellow Outdated treatment when `outdated` is true.

---

## 7. Map demo

- `pinAddresses` (`map-geocoder.ts`) reads only from `person_addresses`. One pin per row, and `source` becomes `'primary' | 'current' | 'past'`.
  - The `DISTINCT ON` and the rank are no longer needed, because the unique index already guarantees one row per (person, address).
  - The backfill (§2.4) means every address that has a pin today keeps it.
- The `map-demo.tsx` legend and colours use the new source names. Past addresses are muted, and an outdated primary shows as primary.
- **DELETE pin** (`demos-map.ts:95`) becomes a single `DELETE FROM person_addresses WHERE person_id = … AND normAddress(address) = …`. It no longer edits the raw `true_person_search` JSON. The raw TPS record is kept as it was imported, which is what you want for an audit snapshot.
- The `geocodes` cache key (`normAddress`) does not change, so no geocoding has to be redone.

---

## 8. Backup / restore (`task-worker.ts`)

- **Export**: a new top-level `<person_addresses>` section, written after `<people>`. It has one `<person_address>` per row with every column. Remove the per-person `<address>` tag (`:671`).
- **Import**:
  - Read `<person_addresses>` with `insertBatchWithFallback`.
  - **Old backups** have no section but do have a per-person `<address>` (`:1944`). For those, after people are imported, insert a primary `legacy` row for every person whose `<address>` is not blank.
  - Add `personAddresses` to `importedCounts` and to the progress message.
- Check that both directions round-trip: export, wipe, import, and get the same rows back, including `is_primary` on an outdated address.

---

## 9. Implementation order

| Step | Repo | Work | Done when |
|---|---|---|---|
| 1 | PRM | `shared/partial-date.ts`, `server/tps-dates.ts`, schema, and `insertPersonSchema` without `address` | `npm run check` lists every place still using `address`. That list is the to-do list for steps 3–6 |
| 2 | PRM | Migration (§2.4) and the storage rules (§2.3), **removing `db-init.ts:1544`** | Run against a **copy** of the DB: rows created, column gone, second boot does nothing |
| 3 | PRM | API routes (§3) and `primaryAddress` on `GET /api/people/:id` | Primary-rule checks pass (below) |
| 4 | PRM | Profile Addresses UI and details card (§6.1), plus the social owner card (§6.3) | The Outdated state is visible in light and dark mode |
| 5 | PRM | Map demo (§7) | Same pins as before the migration, and deleting a pin works |
| 6 | PRM | Backup export and import (§8) | Round trip works, and an old backup restores its primary |
| 7 | PRM | TPS server: `person-status`, `extract`, `upsertTpsAddresses` (§5.4) | `curl` with an old-style payload and a new one, both behave as in §5.5 |
| 8 | PRM-chrome | Date scraping, the confirm panel, CSS, version bump (§5.2–5.3) | Works on `html-examples/true-people-search-person-page.html` and on a live TPS page |
| 9 | PRM | True DB tab cleanup (§6.2) | No address suggestions, and ranges show in the raw list |
| 10 | both | Docs (§5.6) and the final grep from §1 | — |

### Checks

- **Primary rules:**
  - A second primary → rejected by the unique index.
  - Ending the primary → it **stays primary** and shows as outdated (yellow).
  - Making an ended address primary → 400.
  - Deleting the primary → no primary is left.
  - Removing the end date from an outdated primary → it is current again.
- **Migration:** run it twice → no duplicates. `people.address` is gone and **stays gone after a restart** (this checks that row 4 of §1 was removed).
- **TPS:**
  - Extract the same page twice (by deleting the raw row in between) → no duplicate addresses, and dates edited by hand are kept.
  - Confirming a *previous* TPS address as primary → that address is current and primary.
  - "Keep" while PRM's primary is outdated → the primary does not change.
  - An old extension payload → addresses without dates; primary is set only if the person had none.

---

## 10. Open question

**A. Past TPS addresses with unknown dates.** This covers backfilled rows and payloads from the old extension. TPS lists them as previous, but nobody knows when they ended. Options:

1. **Sentinel `end_date = '0000'`**, shown as "ended (date unknown)". No new column, and every rule stays based on `end_date`. *← recommended.*
2. Leave `end_date` NULL. That would wrongly count them as **current**, flooding the "current addresses" list with old TPS entries.
3. Add an `is_current` boolean. This duplicates what `end_date` already says, and the two can drift apart.

The new extension sends real dates, so this only affects data that already exists and old extension builds.
