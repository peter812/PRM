# Stats Section Plan

A separate **Stats** area at `/stats/*`, with its own sidebar (like Settings), a "Back to Site" button, and a **blue-tinted background** so it's clear you've left the main menus.

## Decisions (from Q&A)

| Question | Answer |
|---|---|
| Person stats | New **aggregate** page (`/stats/people`) with a new server endpoint |
| Existing stats | **Move them, leave links**: stats live only in `/stats`; old spots become links; old URLs redirect |
| Entry point | **Main sidebar footer**, same row as **Log out**, on the opposite side, chart icon |
| Extra pages | Overview dashboard, account creation timeline, faces/recognition stats |

## 1. Pages and routes

| Route | Page | Source |
|---|---|---|
| `/stats` | **Overview**: headline totals that link to each page | New. Combines `/api/home-counts`, `/api/stats/people`, `/api/image-storage/stats`, `/api/face-review/counts` |
| `/stats/people` | **People**: total, added over time, relationship-type breakdown, ELO distribution, how many have a photo / birthday / linked social account | New page + `GET /api/stats/people` |
| `/stats/social-accounts` | **Social accounts: general** | `GeneralStats` from `account-creation-timeline-dialog.tsx` |
| `/stats/social-accounts/creation-dates` | **Account creation timeline** | `CreationDates` from the same file |
| `/stats/images` | **Images**: images / videos / files / variants / bytes | Stats card from `image-storage-settings.tsx:525-566` |
| `/stats/faces` | **Faces**: identified vs. unknown, open queue, clusters | `/api/face-review/counts` + `/api/face-review/cluster-summary` (no new endpoint) |
| `/stats/word-clouds/text` | Word cloud (any text) | `pages/word-cloud-demo.tsx` |
| `/stats/word-clouds/bios` | Bio word cloud | `pages/bio-word-cloud-demo.tsx` |
| `/stats/word-clouds/image-summaries` | Image summary word cloud | `pages/image-summary-word-cloud-demo.tsx` |

The word cloud pages move as they are. Only their routes, titles and "back" links change. Their API stays at `/api/demos/word-cloud/*`, since renaming it gains nothing.

## 2. Layout and navigation (client)

- **`client/src/pages/stats-layout.tsx`**: copies `settings-layout.tsx`. It's a nested `<Switch>` of lazy routes for the table above, plus a NotFound fallback.
- **`client/src/components/stats-sidebar.tsx`**: the menu, top to bottom:
  - ← Back to Site
  - Overview
  - People
  - Social Accounts (sub-items: General, Creation Dates)
  - Images
  - Faces
  - Word Clouds (sub-items: Text, Bios, Image Summaries)

  `settings-sidebar.tsx` already renders this exact shape (`MenuItem` with `subItems`, collapsible groups). I'll make its renderer take the item list as a prop so both sidebars share it, rather than duplicating ~200 lines.
- **`App.tsx`**:
  - Register `<ProtectedRoute path="/stats" nest component={StatsLayout} />`.
  - Add `isStatsPage = location.startsWith("/stats")`. Pick the sidebar with `isSettingsPage ? <SettingsSidebar/> : isStatsPage ? <StatsSidebar/> : <AppSidebar/>`.
  - Extend the `lastNonSettingsPath` tracking to skip `/stats` paths too. That way "Back to Site" and the header Home button go back to the last main page, not to Settings or Stats.
  - In the header, show the Home (back) button on Stats pages too, as Settings already does.
- **Entry button** (`app-sidebar.tsx`, `SidebarFooter`): turn the Log out item into a row. Log out sits on the left, and a `BarChart3` icon button ("Stats", tooltip, `data-testid="sidebar-button-stats"`) sits on the right. When the sidebar is collapsed to icons, the row stacks vertically so both icons stay visible.

## 3. Blue-tinted theme

- In `client/src/index.css`, add a `.stats-mode` class (plus `.dark.stats-mode`). It overrides only the surface tokens: `--background`, `--card`, `--sidebar`, `--muted`, `--popover`, `--border`. They switch from the neutral 240° gray to a soft blue tint, for example light `--background: 214 60% 97%` and dark `--background: 218 35% 10%`. Text, primary and destructive colors stay as they are, so contrast is unaffected.
- `App.tsx` toggles the class on `document.documentElement` while `isStatsPage` is true. It goes on the root element, not a wrapper div, because the mobile sidebar Sheet, dialogs and popovers render through portals outside the layout, and they need the tint too.

## 4. Server

- **New `server/routes/stats.ts`**, registered in `server/routes.ts`, with `requireAuth`:
  - `GET /api/stats/people` → `{ total, withPhoto, withBirthday, withSocialAccount, addedByMonth: [{month, count}], byRelationshipType: [{type, count}], eloBuckets: [{min, max, count}] }`. Each part is one aggregate query, run together with `Promise.all`. Existing indexes on `people.created_at`, `people.elo_score` and `relationships.type_id` cover these queries.
- Nothing else is new. Overview, Social, Images and Faces all reuse their existing endpoints.

## 5. Moving the existing stats (move, leave links)

| Old location | Change |
|---|---|
| `social-accounts-list.tsx:402` "Stats" button + `SocialAccountStatsDialog` | The button becomes a `Link` to `/stats/social-accounts`. The dialog wrapper is removed. `GeneralStats` and `CreationDates` are exported as page bodies (range/granularity selects move into the pages). |
| `image-storage-settings.tsx:525-566` Stats card | The card body moves to `/stats/images`. In settings, a one-line "View image stats →" link replaces it. Mutations there still invalidate `/api/image-storage/stats`, which keeps the stats page fresh. |
| `demos.tsx` word cloud tiles (lines 78-115) | Removed from Demos. Add a single "Word clouds moved to Stats →" tile linking to `/stats/word-clouds/text`. |
| `/demos/word-cloud`, `/demos/bio-word-cloud`, `/demos/image-summary-word-cloud` | Become `<Redirect>`s to the new routes in `App.tsx`, the same pattern as the existing `/elo-ranking` redirect. |
| `setup-stages/stage-experimental.tsx:111` "Bio word clouds" text | Reword, since word clouds are no longer gated behind experimental demos. |

**Gating:** the word clouds currently show only when `experimental_demos_enabled` is on, because the Demos page is gated. In Stats they're always visible. If you want them gated, filtering that sidebar group by the same setting is a one-line change.

## 6. Mobile

- The Stats sidebar opens through the same `SidebarTrigger` / Sheet as Settings.
- The bottom mobile nav (the `pb-16` area) stays as it is. The footer Stats button is also reachable from the mobile sidebar.

## 7. Verification

1. `npm run check` (tsc) passes.
2. In the browser preview:
   - The sidebar footer shows Log out and Stats on one row, in both the expanded and collapsed sidebar.
   - The Stats button opens `/stats` with a blue background in light and dark mode, including the mobile sidebar Sheet and a dialog.
   - Every Stats sidebar link renders.
   - "Back to Site" returns to the page you came from.
   - The old URLs (`/demos/word-cloud`, etc.) redirect.
   - The Stats button in Social Accounts and the link in Image Storage go to the right pages.
   - No console errors, and `/api/stats/people` returns 200.

## Files touched

New:
- `client/src/pages/stats-layout.tsx`
- `client/src/components/stats-sidebar.tsx`
- `client/src/pages/stats-overview.tsx`
- `client/src/pages/stats-people.tsx`
- `client/src/pages/stats-social-accounts.tsx`
- `client/src/pages/stats-images.tsx`
- `client/src/pages/stats-faces.tsx`
- `server/routes/stats.ts`

Edited:
- `App.tsx`
- `index.css`
- `app-sidebar.tsx`
- `settings-sidebar.tsx` (shared renderer)
- `account-creation-timeline-dialog.tsx`
- `social-accounts-list.tsx`
- `image-storage-settings.tsx`
- `demos.tsx`
- `stage-experimental.tsx`
- `server/routes.ts`

Moved (route only): the three word cloud pages.
