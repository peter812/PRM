# Handoff: Social Account History — Phases 5 (API) and 6 (UI)

You are picking up a feature that is **already built and working on the server side**. Phases 0–4 are
merged, migrated against the live database, and covered by passing tests. Your job is to expose the data
that is already accruing, through an API and a History tab.

Read this whole document before writing code. It contains several details you cannot infer from the
codebase and at least three that will silently produce wrong results if you guess.

Background plan (design rationale, not instructions): [`docs/social-account-history-plan.md`](social-account-history-plan.md).
Where the two disagree, **this document wins** — it describes what was actually built.

---

## 1. What the feature is

Every ingest of a social account writes a **reverse-delta journal entry**. `social_accounts` holds the
current truth; `social_account_history` records only what changed to get there — followers gained and lost,
following gained and lost, and the *previous* values of bio, display name, location, and profile image.

The user wants a **History tab** on the social account profile, after Account / Follow / Posts / Messages,
listing imports with a note on what changed, where clicking one opens a modal detailing that change.

---

## 2. The data model as built

### 2.1 `social_accounts` — current state

Phase 0 flattened the profile onto the account. These columns are **new** and are the source of truth:

```
nickname, bio, account_url, image_url, external_image_url, location
followers_count, following_count               -- edges actually held, denormalized
reported_followers_count, reported_following_count  -- what Instagram's profile page claims
```

`image_url` is a stable PRM/S3 url, safe to render directly. `external_image_url` is a signed Instagram
url — a lead for the image worker, **never** a display source; it expires.

### 2.2 `social_account_history` — the journal

Defined in [`shared/schema.ts`](../shared/schema.ts) as `socialAccountHistory`. Every column:

| column | notes |
|---|---|
| `socialAccountId` | FK, cascade |
| `batchId` | one per ingest run; ties a direct entry to every neighbour entry it produced |
| `entryKind` | `'direct'` \| `'neighbour'` \| `'baseline'` — **British spelling, see §3.1** |
| `changeSource` | `'extension'` \| `'xml-import'` \| `'manual'` \| `'migration'` \| `'image-pipeline'` |
| `captureScope` | `'both'` \| `'followers'` \| `'following'` \| `'profile'` \| `'none'` |
| `isInitialCapture` | first real capture — render as "N captured", never "+N gained" |
| `pendingImportId` | soft link, **not** an FK (pending rows are user-deletable) |
| `observedViaAccountId` | on neighbour entries: whose scrape revealed this |
| `detectedAt` | |
| `followersAfter`, `followersAdded`, `followersLost` | there is **no** `before` column; it is `after - added + lost` |
| `followingAfter`, `followingAdded`, `followingLost` | |
| `reportedFollowersAfter`, `reportedFollowingAfter` | nullable |
| `profileFieldsChanged` | `text[]`, values from `'nickname' \| 'bio' \| 'location' \| 'image'` |
| `previousNickname`, `previousBio`, `previousLocation`, `previousImageUrl` | the reverse delta |
| `delta` | `jsonb`, `{ followersAdded, followersLost, followingAdded, followingLost }` as id arrays |

Indexes that exist: `(social_account_id, detected_at)` and `(social_account_id, entry_kind, detected_at)`.

---

## 3. Traps — read these

### 3.1 `entryKind` is spelled `"neighbour"`

British spelling, in the code and in the database. The background plan document says "neighbor" in several
places. A filter using the American spelling matches **zero rows and throws no error**. Verify with:

```sql
SELECT entry_kind, COUNT(*) FROM social_account_history GROUP BY entry_kind;
```

### 3.2 Never select `delta` in a list query

`delta` holds up to 10,000 account ids and is TOASTed. The count columns and `profileFieldsChanged` exist
precisely so the list never needs it. Select it **only** in the single-entry detail endpoint.

Neighbour entries have `delta = null` by design — `observedViaAccountId` plus the count columns already tell
their whole story.

### 3.3 `profileFieldsChanged` is the authority, not null-checks

`previousBio IS NULL` is ambiguous: it means either "bio did not change" or "bio changed to empty". Always
branch on `profileFieldsChanged.includes('bio')`. Same for every tracked field.

### 3.4 The legacy tables are still live

`social_profile_versions` and `social_network_changes` still exist and are still read by ~214 server
references and 21 client files. Phase 1 flattened and backfilled but deliberately did **not** drop them.

- Read new work from `social_accounts` (§2.1), never from `social_profile_versions`.
- Do **not** attempt the drop as part of this work. It is a follow-on task once all readers are repointed.
- `processDownloadImgInstagram` currently dual-writes both, marked `TRANSITIONAL` in the source. Leave it.

### 3.5 The client's default query function joins the query key with `/`

`getQueryFn` in [`client/src/lib/queryClient.ts`](../client/src/lib/queryClient.ts) does
`queryKey.join("/")`. A key containing a query string produces a mangled URL. For anything with params,
supply an explicit `queryFn`, following the existing pattern in
[`social-account-profile.tsx`](../client/src/pages/social-account-profile.tsx):

```ts
const { data } = useInfiniteQuery<PaginatedHistory>({
  queryKey: ["/api/social-accounts", uuid, "history", kind],
  queryFn: async ({ pageParam }) => {
    const res = await fetch(`/api/social-accounts/${uuid}/history?kind=${kind}&page=${pageParam}&limit=25`);
    if (!res.ok) throw new Error("Failed to fetch history");
    return res.json();
  },
  initialPageParam: 1,
  ...
});
```

### 3.6 There is no virtualization library in this project

The background plan says "virtualized" for the added/lost lists. Ignore that. Use the existing **"Load
more"** pagination pattern already used by the Follow tab — page the arrays server-side (§4.2).

---

## 4. Phase 5 — API

Routes go in [`server/routes/social-media.ts`](../server/routes/social-media.ts), beside the existing
`/api/social-accounts/:id/...` handlers. Storage methods go in
[`server/storage.ts`](../server/storage.ts) — add to both the `IStorage` interface and the
`DatabaseStorage` class, matching the file's existing style.

**Delete as you go:** `GET /api/social-accounts/:id/profile-versions` and
`GET /api/social-accounts/:id/network-changes` are superseded by these endpoints. Remove them once nothing
references them (check `client/src` before deleting).

### 4.1 `GET /api/social-accounts/:id/history`

Query params: `kind` = `direct` | `neighbour` | `all` (default `all`), `page` (default 1), `limit`
(default 25, max 100).

Returns `{ items, total, page, totalPages }`. Each item is the history row **without `delta`**, plus a
hydrated `observedVia` for neighbour entries:

```jsonc
{
  "id": "...", "detectedAt": "...", "entryKind": "direct",
  "changeSource": "extension", "captureScope": "both", "isInitialCapture": false,
  "followersAfter": 10, "followersAdded": 5, "followersLost": 0,
  "followingAfter": 6,  "followingAdded": 0, "followingLost": 2,
  "reportedFollowersAfter": 12400, "reportedFollowingAfter": null,
  "profileFieldsChanged": ["bio"],
  "observedVia": null    // or { id, username, nickname, imageUrl } on neighbour entries
}
```

Hydrate `observedVia` with a single `inArray` lookup over the page's distinct ids — not one query per row.

### 4.2 `GET /api/social-accounts/history/:entryId`

The one place `delta` is read. Resolve each id array into renderable accounts:

```jsonc
{
  "...": "all fields from 4.1, plus:",
  "previousNickname": null, "previousBio": "first bio",
  "previousLocation": null, "previousImageUrl": "https://...",
  "followersAdded": { "total": 5, "items": [{ "id", "username", "nickname", "imageUrl" }] },
  "followersLost":  { "total": 0, "items": [] },
  "followingAdded": { "total": 0, "items": [] },
  "followingLost":  { "total": 2, "items": [...] }
}
```

Params `listLimit` (default 100) and `listOffset` page **within** those arrays — an initial capture can hold
10,000 ids, which is the documented ceiling for a single account.

Note the shape change: the count columns are scalars on the list endpoint and `{ total, items }` objects
here. Pick one and keep it consistent; if that ambiguity bothers you, name these `followersAddedList` etc.
and leave the scalars alone. Either is fine — just do not silently return two different types under one name.

### 4.3 `GET /api/social-accounts/:id/history/summary`

`{ direct: n, neighbour: n, baseline: n, firstEntryAt, lastEntryAt }`. Drives the tab badge and the toggle
counts. One grouped query.

### 4.4 Access control

Every existing social-account route runs under the project's ownership/visibility helpers. Match whatever
the neighbouring `/api/social-accounts/:id/followers` handler does — do not invent a new pattern, and do not
skip it.

---

## 5. Phase 6 — UI

Two new components, plus a tab insertion:

- `client/src/components/social-account-history-tab.tsx`
- `client/src/components/social-account-history-modal.tsx`

### 5.1 Adding the tab

[`social-account-profile.tsx`](../client/src/pages/social-account-profile.tsx) uses a **left sidebar**
`TabsList`, not a horizontal one. Add a fifth trigger after `messages`, copying the sibling triggers
verbatim including the long className, then add a matching `<TabsContent value="history">` after the
messages content with `className="mt-0 flex-1 min-h-0 overflow-y-auto"`.

Every interactive element in this file carries a `data-testid`. Follow it: `tab-history`,
`card-history-entry-${id}`, `button-load-more-history`, `toggle-history-kind`.

### 5.2 The list

A segmented toggle — **All · This account · Observed elsewhere** — defaulting to All, mapping to
`kind=all|direct|neighbour`.

**Direct entries** are the primary content: full-width `Card`, date prominent, a before/after avatar pair
when `profileFieldsChanged` includes `'image'`, and a summary line built entirely from the count columns —
`+5 followers · −2 following · bio changed`. Gains in the theme's positive colour, losses in the
destructive colour. Clickable, opens the modal.

**Neighbour entries** must read as marginalia: roughly half the vertical space, muted foreground, smaller
type, a left border rather than a full card, prefixed with the `observedVia` avatar —
*via @alice — started following you*. Not clickable; there is no detail to show.

Both share a vertical timeline rail so chronology stays legible when the toggle is on All.

`isInitialCapture` entries render **"5,000 followers captured"**, never "+5,000". This distinction is the
whole reason the flag exists — getting it wrong puts a fake growth spike at the start of every account's
history.

Use the existing "Load more" button pattern from the Follow tab in the same file.

### 5.3 The modal

Built on `@/components/ui/dialog`. Each section renders **only** when that entry actually changed something
— drive every one off `profileFieldsChanged` or a non-zero count, never off a null check.

1. **Header** — date, `changeSource` badge, `captureScope`, and an `initial capture` badge where applicable.
2. **Profile image** — before/after, from `previousImageUrl` and the account's current `imageUrl`.
3. **Display name**, **Bio** — before/after; diff the bio inline if cheap, plain before/after is acceptable.
4. **Location** — before/after.
5. **Followers** — `10 → 15 (+5, −2)` with expandable *Added* and *Lost* lists of account chips (avatar +
   @username, linking to that account's profile).
6. **Following** — the same, other direction.

Where `reportedFollowersAfter` diverges meaningfully from `followersAfter`, show a quiet note —
*"Instagram reports 12,400; 9,830 captured"*. That gap is the honest signal about scrape completeness and
the user specifically wants it visible.

**Do not build a "posts deleted" section.** That is Phase 8 and does not exist yet; a permanently empty
section is worse than adding it later.

### 5.4 Reuse, do not rebuild

The UI kit at `client/src/components/ui/` already has `dialog`, `avatar`, `badge`, `card`, `collapsible`,
`scroll-area`, `separator`, `skeleton`, `tooltip`. The account-row markup you want for chips already exists
in the Follow tab of `social-account-profile.tsx` — lift its structure rather than inventing a new one, and
if you find yourself writing it a third time, extract it.

Note that the Follow tab currently reads `account.latestState?.followingCount`. Prefer the new
`account.followersCount` / `account.followingCount` columns for anything you write.

---

## 6. Scope discipline

This project has an explicit standard, applied throughout Phases 0–4, and several columns were cut under it:

> Can I delete this code entirely? Is there already a function, helper, or library that does this? Can I
> combine repeated logic into one reusable piece? Can I simplify this condition, loop, or data structure? Am
> I solving only the current need, or adding extra code for a future case that may never happen?

Concretely, for this work:

- **Do not** add Phase 8 (post deletion) scaffolding of any kind.
- **Do not** add a charting or virtualization dependency.
- **Do not** add caching or pagination cleverness beyond the existing "Load more" pattern.
- **Do** delete the two superseded endpoints named in §4.
- A single account's followers plus following **never exceeds 10,000**. Do not build or benchmark past it.

---

## 7. Verification

There is no test framework here. The convention is standalone `npx tsx` scripts under `scripts/`; see
[`scripts/test-history-diff.ts`](../scripts/test-history-diff.ts) and
[`scripts/test-import-social.ts`](../scripts/test-import-social.ts) for the established shape — they create
throwaway rows under a unique username prefix and delete them at the end.

Write `scripts/test-history-api.ts` covering:

1. The list endpoint never returns `delta` (assert the key is absent, not merely falsy).
2. `kind=neighbour` returns rows — this is the spelling trap in §3.1; a passing-because-empty test is a
   failing test. Assert a non-zero count.
3. `observedVia` is hydrated on neighbour rows and null on direct rows.
4. The detail endpoint resolves ids to usernames, and `listLimit` / `listOffset` page correctly.
5. Summary counts match a direct `GROUP BY` against the table.
6. An `isInitialCapture` entry is distinguishable in the response.

Then, before declaring done:

```bash
npx tsc --noEmit -p tsconfig.json && npm run build
```

and re-run the two existing suites — they must both still pass, at 32/32 and 44/44:

```bash
npx tsx scripts/test-history-diff.ts && npx tsx scripts/test-import-social.ts
```

### 7.1 What is actually in the database right now

Verified at handoff time:

```
entry_kind  count
baseline    30374
```

**There are currently no `direct` or `neighbour` rows at all.** Every account has exactly one synthetic
baseline from the Phase 1 migration; the real entries produced during development came from the test
scripts, which delete their own rows on the way out.

Two consequences:

- The History tab will render, but every account shows a single baseline entry until an import runs. That is
  correct behaviour, not a bug — do not go looking for missing data.
- Your API test **must create its own** `direct` and `neighbour` rows. Copy the approach in
  `scripts/test-import-social.ts`: build pending-import records under a unique username prefix, run them
  through `processImportSocial`, assert, then delete. A test asserting `kind=neighbour` against the database
  as-is passes vacuously and proves nothing — which is exactly how the §3.1 spelling trap gets through.

---

## 8. Out of scope

- Dropping `social_profile_versions` / `social_network_changes` (§3.4) — follow-on task.
- Phase 7, the XML export/import rework.
- Phase 8, post deletion.
- The PRM Chrome extension itself; it lives in a separate repository. Phase 4 in the background plan is the
  contract it must implement, and it is not yet sending `capture_scope`.
