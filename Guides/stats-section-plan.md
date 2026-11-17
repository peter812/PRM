# Stats Section Plan

A new top-level **Stats** area at `/stats`, with its own sidebar (like Settings), separate from both the main app sidebar and the settings sidebar. It's the one place for stats and word clouds. Existing stats views move here, and their old spots link to the new pages.

## Decisions (from Q&A)

- **Move, and link back.** The image stats card, the Social Accounts Stats dialog, the summary "Total Numbers" card and the 3 word cloud demos move into Stats. Their old spots get a small "View in Stats" link, and old `/demos/*word-cloud` routes redirect.
- **People stats** = aggregate counts + data completeness. No per-person page.
- **Entry point** = a stats icon button in the **lower right of the app sidebar footer**, on the same row as Log out.
- **Extra v1 pages**: Messages & Notes, Groups & Faces, Summaries & Stories.

## Shell / navigation (mirror the Settings pattern)

Settings works like this: `App.tsx` checks `location.startsWith("/settings")` to swap `AppSidebar` → `SettingsSidebar` and mounts `SettingsLayout` with `nest`. Stats copies that pattern.

1. **`client/src/components/stats-sidebar.tsx`** (new). Same `Sidebar` primitives as `settings-sidebar.tsx`, with a flat `statsMenuItems` list:
   - ← Back to Site (goes to `lastNonSettingsPath`, the same value the header back button uses)
   - Overview `/stats`
   - People `/stats/people`
   - Social Accounts `/stats/social-accounts`
   - Images `/stats/images`
   - Messages & Notes `/stats/messages`
   - Groups & Faces `/stats/groups-faces`
   - Summaries & Stories `/stats/summaries`
   - Word Clouds (sub-items): Text `/stats/word-clouds/text`, Bios `/stats/word-clouds/bios`, Image Summaries `/stats/word-clouds/image-summaries`
2. **`client/src/pages/stats-layout.tsx`** (new). A lazy-loaded `<Switch>` like `settings-layout.tsx`.
3. **`App.tsx`**
   - Add `isStatsPage = location.startsWith("/stats")`.
   - Sidebar choice becomes settings → `SettingsSidebar`, stats → `StatsSidebar`, else `AppSidebar`.
   - Generalize `lastNonSettingsPath` so it also skips `/stats`. Rename it to `lastSitePath`, but keep reading the old localStorage key once so users' saved value carries over.
   - The header back-button branch (`isSettingsPage ? …`) also covers stats pages.
   - Add `<ProtectedRoute path="/stats" nest component={StatsLayout} />`.
   - Redirect `/demos/word-cloud`, `/demos/bio-word-cloud` and `/demos/image-summary-word-cloud` to their `/stats/word-clouds/*` pages.
4. **`app-sidebar.tsx` footer**: put the Log out button and an icon-only `BarChart3` button (tooltip "Stats", `data-testid="sidebar-button-stats"`) on one row, with the stats button aligned right. It's active when the URL starts with `/stats`. In collapsed/icon mode the two buttons stack.

## Pages

Each page is a stack of cards built from a few shared pieces in **`client/src/components/stats/`**:
- `StatTile` (big number + label + optional link). This replaces the copy-pasted tile markup in image-storage-settings, home Totals, vector settings, etc. Only adopt it in the new pages plus the moved code; don't sweep other pages.
- The existing `TimelineChart` (from `account-creation-timeline-dialog.tsx`) is reused for every "over time" chart.
- `CompletenessBar` (label, have/total, percent bar), used by People and Groups & Faces.

| Page | Content | Data source |
|---|---|---|
| **Overview** | A row of tiles: people, groups, social accounts, images/videos, messages, faces. Each links to its page. | New `GET /api/stats/overview` (one query, many `count(*)`s). Folds in what `/api/home-counts` returns. |
| **People** | Totals; breakdowns by sex, age bucket, top locations, relationship types, group membership; people added over time; **completeness** (% with photo, birthday, location, linked social account, relationships, notes). | New `GET /api/stats/people` |
| **Social Accounts** | Moved: the full body of `SocialAccountStatsDialog` (daily-stats timeline + joined histogram), unwrapped from the dialog. Add breakdown by account type and tracked vs untracked. | Existing `/api/social-accounts/daily-stats`, `/api/social-accounts/joined-histogram`; type breakdown goes into `/api/stats/social-accounts` |
| **Images** | Moved: the Stats card from `image-storage-settings.tsx` (images, videos, files, variants, bytes). Add images over time and % with faces/summaries. | Existing `/api/image-storage/stats`, plus additions in `/api/stats/images` |
| **Messages & Notes** | Message volume over time, top 10 contacts by message count, counts by source/type, daily notes count + over time, social account notes count. | New `GET /api/stats/messages` |
| **Groups & Faces** | Group count, size distribution, largest groups, potential groups pending; faces total, assigned vs unknown, % of images with faces, pending face reviews. | New `GET /api/stats/groups-faces` |
| **Summaries & Stories** | Moved: the "Total Numbers" card from `instagram-summaries.tsx`. Add stories captured over time and by account. | Existing `/api/summary/totals`, plus `/api/stats/stories` |
| **Word Clouds ×3** | Move the three demo pages as they are (`word-cloud-demo`, `bio-word-cloud-demo`, `image-summary-word-cloud-demo`) to `pages/stats/`. Their API routes stay at `/api/demos/word-cloud/*` (no reason to churn). | Unchanged |

## Server

- **`server/routes/stats.ts`** (new), registered in `server/routes.ts`. It holds one read-only, `requireAuth` endpoint per page listed above. Plain aggregate SQL via the existing db layer, one round trip per endpoint where possible (`count(*) filter (where …)`).
- Time series return `{ date, count }[]` buckets in the same shape `TimelineChart` already takes.
- Scale is ≤10k imports (see memory), so plain aggregates are fine. No caching tables or materialized views.

## Removing the old copies

- `social-accounts-list.tsx`: the Stats button becomes a `Link` to `/stats/social-accounts`, and the dialog component goes away. Its contents now live in the page component, so `account-creation-timeline-dialog.tsx` is renamed/trimmed to export the charts only.
- `image-storage-settings.tsx`: remove the Stats card and replace it with a one-line "View image stats →" link.
- `instagram-summaries.tsx`: remove the Total Numbers card and replace it with a link.
- `demos.tsx`: remove the 3 word cloud cards (or point them at `/stats/word-clouds/*`). Redirects cover old bookmarks.
- Vector/knowledge stats stay in Settings (not selected for v1).

## Build order

1. Shell: stats-sidebar, stats-layout, App.tsx routing/back-button, sidebar footer icon, Overview with `/api/stats/overview`.
2. Move existing views: Social Accounts, Images, Summaries, Word Clouds, plus links/redirects at the old spots.
3. New pages: People, Messages & Notes, Groups & Faces (each endpoint + page).
4. Check every page in the browser preview (light/dark, mobile sidebar), then `npm run check` for types.

## Open items to confirm during build

- Exact column names for sex/birthday/location completeness. They'll be read from `shared/schema.ts`, and anything that doesn't exist gets dropped instead of invented.
- Whether the Stats icon should hide when the user isn't logged in. The footer already only renders for `user`, so it will.
