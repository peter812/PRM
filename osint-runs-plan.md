# OSINT runs on person and social account pages

> **As built (2026-10-02):** the implementation is simpler than this plan in a few places.
> - **One endpoint pair** replaces the three GET routes and the change to the scans POST:
>   - `GET /api/osint/results?socialAccountIds=a,b` or `?personId=` returns merged `{hits, runs}` keyed by account id or target;
>   - `POST /api/osint/results` queues **Run scan**.
> - **Dedupe is by site name**, not URL, because blackbird returns API URLs.
> - **Components** live in `client/src/components/osint-results.tsx` and `person-osint.tsx`.
> - **Target normalization** is trim and dedupe only, with emails lowercased.

## Decisions (from Q&A, 2026-10-02)

- **Collapsed and lazy-loaded.** Scans keep running as they do today: auto-scans for the Me network, plus manual scans. OSINT sections start collapsed and load nothing until opened. What this saves is PRM API and DB calls, not PRM-compute calls.
- **The chip has exactly 2 states.** Yellow `unchecked` means there is no finished scan; pending, running, failed and cancelled all count as unchecked. Green `N result(s)` means at least one scan finished, and `0 results` is still green.
- **Multiple tools are merged.** The count and the modal use the latest finished scan from each tool, with sites deduped by URL. The info icon lists every tool alongside its run date.
- **Person scan targets live in one field, `osintRuns`.** It has three sections: emails, phones and other usernames. It is separate from the contact details: the contact emails and phones are only *suggestions* to add to it. Phones can be listed but can't be scanned until PRM-compute has a phone tool (out of scope).

## 1. Schema — `shared/schema.ts`, `server/db-init.ts`

- `people.osintRuns` (column `osint_runs`): `jsonb`, default `'{"emails":[],"phones":[],"usernames":[]}'`.
  ```ts
  export type OsintRuns = { emails: string[]; phones: string[]; usernames: string[] };
  ```
  Add `osintRuns: z.object({ emails, phones, usernames: z.array(z.string()) }).optional()` to the insert/update zod schemas next to `additionalEmails`. These are the targets the user has chosen to scan. Results stay in `osint_scans` and `insights`, never in this field.
- `osint_scans`:
  - Add `personId varchar → people.id ON DELETE CASCADE` (nullable). It is set for person-level scans; `socialAccountId` stays as it is for account scans.
  - Replace the `osint_scans_live_uniq` index with one on `(coalesce(social_account_id, person_id), tool, target) WHERE status IN ('pending','running')`. A person can have several emails, so `target` has to be part of the key. Update the `ON CONFLICT` target in `enqueueOsintScans` to match.
  - `targetType` already exists. The values become `username | email | phone`.
- `OsintTargetType` in `client/src/lib/osint-tools.ts` gains `"phone"`. No tool lists `phone` in `supportedTargetTypes` yet, and that is what disables phone scans in the UI.

## 2. Shared hit extraction — new `shared/osint-hits.ts`

Two copies of `osintHits()` exist now, in `server/osint-scan-queue.ts` and in `osint-demo.tsx`'s `ResultView`. Move it to one shared module and add:

```ts
type OsintHit = { site: string; url: string | null };
osintHits(result): OsintHit[]               // normalizes sites/platforms/modules
mergeOsintScans(scans): { hits: OsintHit[]; runs: { tool: string; completedAt: Date }[] }
// latest done scan per tool → union of hits deduped by url (fallback: site name)
```

Use it in the queue (insight `rawText`), in the demo page and in the new endpoints.

## 3. Server

### Storage (`server/storage.ts`)
- `getLatestOsintScans({ socialAccountIds?, personId? })` returns the latest `done` row per (owner, tool, target), with `result` included. It's one `DISTINCT ON` query.
- `createOsintScan` accepts `socialAccountId` / `personId` (today it can't link a manual scan to an account).
- `recordResult` in `osint-scan-queue.ts`: when `row.personId` is set, write the insight with `applicablePeopleIds: [personId]` and no social account ids.

### Routes (`server/routes/osint.ts`)
| Route | Purpose |
|---|---|
| `GET /api/people/:id/osint-summary` | Called once per person page. For each of the person's social accounts it returns `{ socialAccountId, count, runs }`, where `count === null` means unchecked. The server computes it with `mergeOsintScans` and leaves out the hit lists. |
| `GET /api/social-accounts/:id/osint` | Merged `{ hits, runs }` for a single account. Used by the chip modal and the account page section, and fetched only when one of them opens. |
| `GET /api/people/:id/osint` | Returns `{ emails, phones, usernames }`, mirroring `osintRuns`, where each entry is `{ target, count, hits, runs }`. Fetched only when the person OSINT Runs section is expanded. |
| `PATCH /api/people/:id` (existing) | Saves `osintRuns`. Targets are trimmed, deduped and lowercased (emails, usernames) or digits-normalized (phones). |
| `POST /api/osint/scans` (existing) | Accepts optional `social_account_id` / `person_id`, which it checks the user can access, and passes them through. With no tool given, it queues one row per auto-scan tool that supports the target type. |

All of these go through the existing access layer: insights and scans follow the account's or person's visibility.

## 4. Client

### Shared components (`client/src/components/osint/`)
- **`OsintChip`**: takes `{ count: number | null, onClick }`. Yellow `unchecked` when `count` is null, green `N result(s)` otherwise.
- **`OsintResultsModal`**: title is the target (for example `@jdoe`), with an `Info` icon to its right. Hover or click opens a Tooltip/Popover listing `tool — run date` for each tool. The body lists hits as `site → url` links. An unchecked target gets an empty state with a **Run scan** button that posts to `/api/osint/scans`; that keeps accounts outside the Me network scannable.
- **`OsintResultsList`**: the hit list itself, shared by the modal and the account page section.

### Person page: Social Accounts section (`person-profile.tsx`, Overview tab)
- A new `<Card>` placed directly above the **Education & Career** summary card (~line 493).
- One row per `person.socialAccounts`: `type icon/name · @username · tracking dot · OsintChip`.
  - The tracking dot is a small circle using `INTEREST_LEVEL_COLOR[account.interestLevel]`, with the level label as a tooltip. It reuses the color map from `interest-level-badge.tsx` but drops the text.
  - Chip counts come from one `/api/people/:id/osint-summary` call for the whole section, not one call per account.
  - Clicking the chip opens `OsintResultsModal`, which fetches `/api/social-accounts/:id/osint`.
- The editable chips in the right column stay as they are; the new card is read-only.

### Person page: OSINT Runs section
- A collapsible **OSINT Runs** card, closed by default, placed below the new Social Accounts card. Only expanding it fetches `/api/people/:id/osint`.
- It has three sub-sections, **Emails**, **Phones** and **Other usernames**, each a list of `target · OsintChip · remove (×)` rows.
- Each sub-section has an inline **+ Add** input that PATCHes `osintRuns`, so no trip to the Edit Person dialog is needed.
- Under Emails and Phones, contact details not yet in `osintRuns` show as one-click "+ jdoe@x.com" suggestion chips (from `email`/`additionalEmails` and `phone`/`additionalPhones`).
- Clicking a chip opens the same `OsintResultsModal`, with its Run scan button.
- Phone rows render a disabled chip with a "No phone OSINT tool configured yet" tooltip.

### Social account page (`social-account-profile.tsx`)
- A new collapsible **OSINT** card placed directly above **Activity & Import History** (~line 1132), closed by default.
- The header shows `OsintChip` plus the info icon. It needs only the count, which can come from `/osint` once opened, so a closed card makes no API call at all.
- Expanding fetches `/api/social-accounts/:id/osint` and renders `OsintResultsList`, plus a **Run scan** button.

## 5. Out of scope / later
- Phone OSINT tool on PRM-compute (for example PhoneInfoga). Once it exists, add `phone` to that tool's `supportedTargetTypes` and the UI enables itself.
- Auto-queuing person-level targets. These scans are manual-only for now.
- Turning hits into linked social accounts ("add this as a social account").

## 6. Verification
- `npm run check` (types).
- Manual checks in the preview:
  - Person with 0, 1 and several accounts: dots, chips and the modal tooltip.
  - Account scanned by 2 tools: the merged count is deduped.
  - Collapsed sections send no `/osint` requests (check in the network log).
  - Run scan queues a row visible on the OSINT Tasks page.
  - OSINT Runs: add and remove in each section persists across reloads. Contact-detail suggestions disappear once added. A duplicate target is rejected.
