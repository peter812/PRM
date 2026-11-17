# Mobile Usability Plan

Goal: make PRM usable on phones (< 768px, `useIsMobile()` / Tailwind `md:` breakpoint) without changing the desktop layout. Every change below is mobile-only unless noted.

## 0. Root cause on Social Account & Person pages (not on the bucket list, but the main blocker)

`social-account-profile.tsx:988-992` and `person-profile.tsx:285-287` render the tab rail as `w-full md:w-64` + `TabsList flex-col`. On mobile that stacks **12 / 11 full-width tab buttons** above the content, so the page opens to a wall of tabs and the actual content is several screens down.

- Mobile: turn the `TabsList` into a single horizontally scrolling row (`flex-row overflow-x-auto whitespace-nowrap`, `md:flex-col`), sticky under the header.
- Hide the rail's footer block (already `hidden md:block` on one copy; check the other).
- Mirror the change from `person-profile.tsx` to `me-profile.tsx` (same rail).

## 1. Post / story views: photo first, text below

Files: `components/post-detail-dialog.tsx:178-267`, `components/stories-tab.tsx:158-170`.

Both already switch to `flex-col` on mobile, but the post dialog keeps a fixed `h-[85vh]` with the details pane at `h-full overflow-hidden`, so the text gets squeezed to a sliver under the image.

- Mobile: dialog becomes full-screen (`inset-0`, no rounded corners), one vertical scroll container: media (max ~60vh, `object-contain`) → caption, comments, tags, faces below.
- Remove the fixed `h-[85vh]` / `min-h-[400px]` under `md:`; keep them for desktop.
- Story dialog: drop `md:w-[45%]` media column on mobile, same single-scroll layout.
- Arrow-key nav stays; add swipe left/right on the media for prev/next (small pointer handler, no library).

## 2. Less side padding on containers

77 files use `p-6` / `p-8` / `px-6` on their outer containers; only 2 are responsive.

- Replace outer page wrappers with `p-3 md:p-6` (and `p-4 md:p-8` where `p-8`). Inner card padding stays.
- Cheapest approach: one pass over `pages/*` outer wrappers (`container mx-auto p-6`, `max-w-* mx-auto p-6`). Don't touch component internals.
- Also shrink the `CardContent` default padding on mobile only if a page still feels cramped after the wrapper pass — not by default.

## 3. Search expands to full top bar on focus (mobile)

Files: `App.tsx:439-489` (header), `components/global-search.tsx:594+`.

- Lift a `searchExpanded` state (focus/blur of the input, or an `onExpandedChange` prop from `GlobalSearch`).
- When expanded on mobile: hide sidebar trigger, `#header-contextual-actions`, add button and status dot; search takes the whole row; show a back/close (`X`) button to collapse.
- Results dropdown: `fixed left-0 right-0` under the header on mobile so it's full viewport width, max-height to the bottom nav.

## 4. Remove type select when search isn't focused

`global-search.tsx:596-635` — the type `DropdownMenu` + label always sits inside the input.

- Render the type filter only while the search is focused/expanded (or a non-`all` filter is active, so the user can see it's filtering). Otherwise show just the search icon.
- The left-padding sync effect (`leadingRef`, ~line 71) already measures the leading element, so the input padding follows automatically.
- Applies to desktop too (the request doesn't say mobile-only) — confirm.

## 5. Status dot popover overflows

`components/status-dot.tsx:56` — `PopoverContent className="w-96"` (384px) is wider than most phones.

- `w-[calc(100vw-1rem)] max-w-96`, `collisionPadding={8}`. Long messages: `break-words`.

## 6. Daily Notes page (mobile)

`pages/daily-notes.tsx:135-172`.

- Hide the description text on mobile (`hidden md:block`).
- PIN button: icon only on mobile (`KeyRound`), label `hidden md:inline`, keep `aria-label` / `title`.
- Replace the Today + Yesterday buttons on mobile with one **"New Note"** button → opens a small menu / the existing create modal with a date picker defaulting to today, with a "Yesterday" quick option. If today's note exists, the menu shows "Open today's note". Desktop keeps both buttons.
- Outer wrapper `p-3 md:p-6` (covered by §2).

## 7. Graph view info panel → bottom sheet (mobile)

Files: `pages/social-graph-3d.tsx:1717+` (account panel), `pages/person-graph-view.tsx:732+` (person panel). Both are `absolute top-4 left-4 w-72` floating cards that cover most of a phone's graph.

- Mobile: dock to the bottom (`absolute inset-x-0 bottom-0`, rounded top, above the bottom nav), collapsed height ~96px.
- Collapsed row: **left** profile image; **right** username + display name, followers / following, and a **View** button (→ account / person page).
- Scroll/drag up inside the sheet to reveal the rest of the existing panel content (type, URL, bio, owner, connections…). Implement as a scrollable sheet with the collapsed row sticky at top — no gesture library.
- Extract the shared collapsed header into one small component used by both pages; desktop panel unchanged.

## 8. Rework the bottom nav

`components/mobile-bottom-nav.tsx` — currently Groups · People · **+ (add person only)** · 3D Graph · Social Accounts.

Proposed: **People · Social Accounts · + · Daily Notes · More**
- `+` opens the same `UniversalAddButton` menu as the header (person, account, note, photo, …) instead of add-person only; then drop the `+` from the mobile header to free space for search.
- **More** opens the app sidebar (`useSidebar().setOpenMobile(true)`) so Groups, Graph, Images, Settings etc. stay one tap away.
- Add `pb-[env(safe-area-inset-bottom)]` for iOS home bar; add small text labels under icons.
- Exact tab choice is your call — see open questions.

## 9. Groups page: "Find Potential Groups" overflows

`pages/groups-list.tsx:119-122` — rename the button to **"Find Groups"** (all widths). Leave the `potential-groups.tsx` page title as is unless you want it renamed too. Also let that header row `flex-wrap`.

## Suggested order

1. §0 profile tab rail (biggest win, small change)
2. §5, §9, §6 (quick, isolated)
3. §2 padding pass
4. §3 + §4 search (same files, do together)
5. §1 post/story dialogs
6. §8 bottom nav
7. §7 graph bottom sheet (largest)

## Verification

Run the dev server, `resize_window` to the mobile preset (375×812), and walk: social account page (each tab), person page, a post and a story, search focus/blur, status dot, daily notes, 3D graph + person graph selection, groups page. Re-check desktop width for regressions on each touched page.

## Open questions

- Bottom nav tabs: is People · Accounts · + · Daily Notes · More right, or do you want Groups / Graph kept as direct tabs?
- §4: hide the type select on desktop too, or mobile only?
- §6 "New Note": menu with Today/Yesterday, or straight to the create modal with a date field?
