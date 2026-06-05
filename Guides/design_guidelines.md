# Design Guidelines: People Management CRM Application

## Design Approach

**Selected Approach:** Design System - Modern Productivity Tools
**Primary References:** Linear, Notion, Asana
**Design Philosophy:** Clean, efficient, data-focused interface prioritizing quick access to information and streamlined workflows. Professional aesthetic with emphasis on readability and scanability.

---

## Typography System

**Font Families:**
- Primary: Inter (via Google Fonts CDN)
- Monospace: JetBrains Mono (for API keys, technical data)

**Type Scale:**
- Page Titles: text-3xl font-semibold (30px)
- Section Headers: text-xl font-semibold (20px)
- Card Titles/Person Names: text-lg font-medium (18px)
- Body Text: text-base (16px)
- Meta Information: text-sm (14px)
- Timestamps/Labels: text-xs font-medium uppercase tracking-wide (12px)

---

## Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, 8, 12, 16
- Micro spacing (within components): p-2, gap-2, m-2
- Component padding: p-4, p-6
- Section spacing: py-8, py-12, gap-8
- Page margins: px-6, px-8
- Large section breaks: mb-12, mb-16

**Grid Structure:**
- Main container: max-w-7xl mx-auto px-6
- Two-column dashboard: 320px sidebar + flex-1 main content
- Search results: Single column list with full-width cards
- Profile view: Single column max-w-4xl for optimal reading

---

## Component Library

### Navigation & Header
**Top Navigation Bar:**
- Fixed header with height h-16
- App logo/name on left
- Global search bar (central, max-w-md)
- User profile dropdown on right
- Subtle bottom border for separation

**Sidebar Navigation (if multi-section):**
- Width w-64
- Vertical menu with icon + label pattern
- Active state with subtle background treatment
- Grouped sections with dividers

### Search Interface
**Search Bar Component:**
- Full-width input with h-12
- Heroicons magnifying glass icon (left)
- Placeholder: "Search people by name, company, or tags..."
- Focus ring treatment
- Below search: filter chips for tags/categories with x-dismiss buttons

**Search Results List:**
- Stacked cards with gap-3
- Each card: p-4, rounded-lg, border
- Left: Avatar circle (w-12 h-12)
- Middle: Name (text-lg font-medium), company/title (text-sm), tags (text-xs chips)
- Right: Last interaction timestamp (text-sm)
- Hover state with subtle elevation

### People Profile Page
**Profile Header:**
- py-8 px-6 section
- Large avatar (w-24 h-24) on left
- Name (text-3xl font-semibold)
- Company/title (text-lg)
- Contact info grid below: email, phone with icons (grid-cols-2 gap-4)
- Action buttons: Edit Profile, Add Interaction (right-aligned)

**Tab Navigation:**
- Sticky below header
- Border-b for separation
- Horizontal tabs: Notes, Interactions, API
- Active tab with border-b-2 indicator

**Notes Tab:**
- Add Note button (top-right, prominent)
- Note cards in vertical stack (gap-4)
- Each note: p-6, rounded-lg border
- Timestamp header (text-xs uppercase)
- Note content (text-base)
- Edit/Delete actions (text-sm links, right-aligned)

**Interactions Timeline:**
- Vertical timeline with left border line
- Each interaction card offset with ml-8
- Timeline dot marker (w-3 h-3 rounded-full, absolute positioning)
- Card structure: p-4, rounded-lg, border
- Header row: Interaction type badge + date/time (text-sm)
- Description/details (text-base mt-2)
- Chronological order (newest first)

### Forms & Inputs
**Add Interaction Modal:**
- Overlay with backdrop blur
- Centered modal (max-w-lg)
- Modal padding: p-6
- Form fields with gap-4
- Label style: text-sm font-medium mb-1
- Input fields: h-10, rounded, border, px-3
- Textarea: min-h-32
- Dropdown for interaction type with Heroicons chevron
- Date picker input
- Button group at bottom: Cancel (ghost) + Save (primary)

**Standard Input Pattern:**
- Label above input
- Input height h-10
- Border with focus ring
- Helper text below (text-xs) when needed

### API Access Section
**API Key Display:**
- Monospace font container
- Copy button with clipboard icon
- Regenerate key button with warning state
- Documentation links as text-sm underlined links

### Cards & Containers
**Base Card:**
- rounded-lg border
- p-4 or p-6 depending on content density
- Shadow on hover for interactive cards

**Empty States:**
- Centered content with py-16
- Icon (w-16 h-16, Heroicons outline)
- Heading (text-lg font-medium mt-4)
- Description (text-sm mt-2)
- Primary CTA button (mt-6)

### Buttons
**Primary Button:**
- h-10 px-4 rounded-md
- font-medium text-sm
- Focus ring

**Secondary/Ghost Button:**
- h-10 px-4 rounded-md
- Border variant
- text-sm font-medium

**Icon Button:**
- w-10 h-10 rounded-md
- Centered icon
- For actions like edit, delete, copy

### Data Display
**Tags/Badges:**
- Inline-flex px-2 py-1 rounded text-xs font-medium
- For categories, interaction types, status indicators

**Avatar:**
- Circular with initials fallback
- Sizes: w-8 h-8 (small), w-12 h-12 (medium), w-24 h-24 (large)

**Stats/Metrics (if dashboard):**
- Grid layout (grid-cols-3 gap-4)
- Each stat card: p-6, rounded-lg, border
- Number (text-3xl font-semibold)
- Label (text-sm)

---

## Icons
**Library:** Heroicons (via CDN)
**Usage:**
- Navigation: home, user-group, document-text, cog
- Actions: plus, pencil, trash, clipboard, x-mark
- Search: magnifying-glass
- Interaction types: phone, envelope, video-camera, calendar

---

## Responsive Behavior
- **Desktop (lg:):** Full sidebar + main content layout
- **Tablet (md:):** Collapsible sidebar or hamburger menu
- **Mobile (base):** Single column, stack all cards, bottom nav bar alternative

**Breakpoint adjustments:**
- Container padding: px-4 (mobile) → px-6 (tablet) → px-8 (desktop)
- Card padding: p-4 (mobile) → p-6 (desktop)
- Grid columns: grid-cols-1 (mobile) → grid-cols-2 (desktop) for contact info

---

## Animations
Minimal, performance-focused:
- Hover state transitions: transition-all duration-200
- Modal entry: fade-in with duration-300
- No scroll-triggered animations
- Focus rings with transition

---

## Accessibility
- Semantic HTML throughout
- ARIA labels for icon-only buttons
- Focus visible states on all interactive elements
- Keyboard navigation support for modals and dropdowns
- Sufficient contrast ratios for all text
- Form labels properly associated with inputs