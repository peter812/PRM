# Stories follow-ups

Two items from the 2026-10-12 stories review that were deferred. Neither is a bug today.

## 1. `postManifest` resends the whole run after every account (O(n²))

**Now:** PRM-stories `deliverAccount` (src/deliver.ts) calls `postManifest` after each account. That call POSTs the full `RunManifest` (every `items` entry so far, plus `seenBy` with full viewer lists). PRM's `POST /api/v1/stories/runs` (server/routes/stories.ts) parses it with `runSchema` and overwrites `story_scrape_runs.items` / `counts` wholesale.

A run of n accounts sends about n²/2 item entries and rewrites a growing JSONB row n times. This is fine at today's tray sizes (≤ ~150 accounts). It is the first thing to fix if runs grow or the row gets large.

**Plan:**
1. **Mid-run calls send progress only.** Add `progressOnly: true` and leave `items` and `seenBy` out of the body. PRM updates `status`, `counts` and `scrapedFrom` only (a `set` without `items`).
2. **The closing call sends everything.** `deliver()` at the end of the run, and `deliverPending` for older runs, keep sending the full manifest. PRM overwrites `items` as today. That keeps the row correct after a crash, since the disk manifest stays the source of truth.
3. **`runSchema`:** make `items` optional. When it is absent, don't touch the column.
4. **The PRM run page** reads `items` while a run is live. Check `client/src/pages/*stories*` for what it shows mid-run:
   - If it only needs counts, nothing more to do.
   - If it lists items live, send just the account's new entries mid-run, and have PRM append them (`items = items || $new::jsonb`) instead of the progress-only call. The final full upsert still replaces the column, so a double-append never survives the run.
5. **Rollout:** ship PRM first, since the optional `items` stays backward compatible. Then ship the service.

## 2. `INSTAGRAM_TYPE_ID` is defined in five places

**Canonical:** `shared/schema.ts:304` (`export const INSTAGRAM_TYPE_ID`). The client already imports it from `@shared/schema`.

**Copies to remove:**

| File | What it has |
|---|---|
| `server/tracking.ts:39` | `export const INSTAGRAM_TYPE_ID` (a second export; `server/routes/account-issues.ts` and `server/routes/tracking.ts` import this one) |
| `server/routes/social-media.ts:70` | module const |
| `server/routes/stories.ts:28` | module const |
| `server/routes/auth-setup.ts:706` | local const inside a handler |

Leave `server/db-init.ts:142` alone. It's the seed row that creates the id, and it stays a literal in SQL.

**Plan:**
1. In `server/tracking.ts`, replace the export with `export { INSTAGRAM_TYPE_ID } from "@shared/schema";`. Importers of `../tracking` keep working. Optionally repoint them to `@shared/schema` and drop the re-export.
2. In `social-media.ts`, `stories.ts` and `auth-setup.ts`, delete the local const and add `INSTAGRAM_TYPE_ID` to the existing `@shared/schema` import.
3. Run `npm run check`, then grep `00000000-0000-0000-0001-000000000001`. The only hits left should be `shared/schema.ts` and `db-init.ts`.
