# Family Tree Feature — Frontend Implementation Guide

This document outlines every frontend change required to build the Family Tree feature. This work should begin **after** the backend changes described in `family-tree-plan-backend.md` are complete.

---

## Table of Contents

1. [Overview](#1-overview)
2. [New Dependencies](#2-new-dependencies)
3. [Route & Navigation Changes](#3-route--navigation-changes)
4. [Family Tree Page](#4-family-tree-page)
5. [Canvas Rendering Engine](#5-canvas-rendering-engine)
6. [Person Selection Dialog](#6-person-selection-dialog)
7. [Add Family Member Dialog](#7-add-family-member-dialog)
8. [Person Profile — Tree Tab](#8-person-profile--tree-tab)
9. [Visual Design Specifications](#9-visual-design-specifications)
10. [API Integration](#10-api-integration)
11. [State Management](#11-state-management)
12. [Implementation Order](#12-implementation-order)

---

## 1. Overview

The frontend adds two major features:

1. **Family Tree Page** — A new top-level page with a pannable/zoomable canvas that visualizes a person's family tree as connected boxes and lines.
2. **Person Profile "Tree" Tab** — A new tab on each person's profile page that shows a focused family tree view for that person.

### Existing Patterns to Follow

| Pattern | Example File | What to Reuse |
|---|---|---|
| Page component | `client/src/pages/people-list.tsx` | Page layout, loading states, query patterns |
| Canvas rendering | `client/src/pages/graph.tsx` | Pixi.js setup, zoom/pan, node rendering |
| Tabs on person page | `client/src/pages/person-profile.tsx` | Tab structure, TabsTrigger styling |
| Dialog/modal | `client/src/components/add-relationship-dialog.tsx` | Dialog pattern, form handling |
| Person search/select | `client/src/components/add-relationship-dialog.tsx` | Person search input with typeahead |
| Data fetching | Throughout | `useQuery`, `useMutation`, `apiRequest` |

---

## 2. New Dependencies

Evaluate whether new dependencies are needed. The existing stack likely covers everything:

| Need | Existing Solution | Notes |
|---|---|---|
| Canvas rendering | `pixi.js` (already installed v8.14.0) | Use for the 2D family tree canvas |
| Zoom/pan | Built into existing `graph.tsx` | Reuse the zoom/pan logic |
| Force layout | Consider for auto-positioning | Or use a custom tree layout algorithm |

**Potential new dependency**: A tree layout algorithm library. Options:
- **`d3-hierarchy`** — Well-established, provides tree/cluster layouts. Lightweight (just the layout math, no DOM rendering).
- **Custom layout** — If the tree structure is simple enough, a custom top-down layout may be cleaner.

**Recommendation**: Use `d3-hierarchy` for layout calculations, Pixi.js for rendering. This separates concerns cleanly.

---

## 3. Route & Navigation Changes

### 3.1 Add Route

**File**: `client/src/App.tsx`

Add a new route in the `ProtectedRoute`-wrapped section, after the existing routes:

```
/family-tree → FamilyTreePage component
```

This should be placed near the other visualization routes (`/graph`, `/social-graph-3d`).

### 3.2 Add Navigation Menu Item

**File**: `client/src/components/app-sidebar.tsx`

Add a "Family Tree" menu item directly **below** the "People" item in the main navigation. Use an appropriate icon from `lucide-react` (e.g., `GitBranch`, `Network`, or `TreePine`).

```
Menu order:
- Home
- Me
- People
- Family Tree  ← NEW
- Groups
- ...
```

---

## 4. Family Tree Page

**New file**: `client/src/pages/family-tree.tsx`

### 4.1 Page Structure

```
┌──────────────────────────────────────────────────┐
│ Header: "Family Tree"                    [Controls]│
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │                                              │ │
│  │           CANVAS (full page)                 │ │
│  │                                              │ │
│  │     ┌─────┐         ┌─────┐                 │ │
│  │     │ Dad │─────────│ Mom │                 │ │
│  │     └─────┘         └─────┘                 │ │
│  │           │                                  │ │
│  │     ┌─────┼─────┐                           │ │
│  │     │     │     │                            │ │
│  │  ┌──┴──┐┌─┴──┐┌─┴──┐                       │ │
│  │  │Kid 1││Kid2││Kid3│                        │ │
│  │  └─────┘└────┘└────┘                        │ │
│  │                                              │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│ Footer: Zoom controls (+/-/reset)                  │
└──────────────────────────────────────────────────┘
```

### 4.2 Page Behavior

1. **On page load**: Show a `PersonSelectionDialog` (modal popup, required).
2. **After person selected**: Fetch family tree data via `GET /api/family-tree/:personId?depth=6`.
3. **Render tree** on the Pixi.js canvas.
4. **Controls bar** (top or bottom):
   - Zoom in / Zoom out / Reset zoom buttons
   - Depth slider (1–10, default 6)
   - "Change person" button to re-open the selection dialog
   - "Fit to screen" button
5. **Canvas interactions**:
   - **Pan**: Click and drag on empty canvas area
   - **Zoom**: Mouse wheel / pinch gesture / buttons
   - **Click person box**: Show person details tooltip or navigate to their profile
   - **Click "Add Person" placeholder**: Open `AddFamilyMemberDialog`

### 4.3 Component State

```typescript
interface FamilyTreePageState {
  selectedPersonId: string | null;     // Root person for the tree
  depth: number;                        // Current depth setting (default 6)
  showPersonSelector: boolean;          // Show/hide person selection dialog
  showAddMemberDialog: boolean;         // Show/hide add member dialog
  addMemberContext: {                   // Context for the add member dialog
    relatedPersonId: string;
    suggestedRole: string;              // e.g., "mother", "father"
  } | null;
  viewport: {                           // Canvas viewport state
    x: number;
    y: number;
    scale: number;
  };
}
```

---

## 5. Canvas Rendering Engine

**New file**: `client/src/components/family-tree-canvas.tsx`

This is the core rendering component. It should be extracted as a reusable component so it can be used both on the Family Tree page and in the Person Profile Tree tab.

### 5.1 Technology

Use **Pixi.js** (already installed) following the patterns in `client/src/pages/graph.tsx`. The existing graph page already implements:

- Canvas setup with `new PIXI.Application()`
- Zoom/pan with mouse wheel and drag
- Node rendering as circles/containers
- Edge rendering as lines
- Responsive resize handling

### 5.2 Layout Algorithm

The family tree needs a **hierarchical tree layout**, not a force-directed layout. Use the following approach:

1. **Parse the API response** into a tree data structure with the selected person as root.
2. **Calculate positions** using a top-down tree layout:
   - Parents appear above children.
   - Spouses appear side-by-side horizontally.
   - Children appear below their parents, spaced horizontally.
   - Each generation occupies a fixed vertical band.
3. **Render** the positioned nodes and edges with Pixi.js.

**Layout parameters**:
```typescript
const LAYOUT = {
  NODE_WIDTH: 160,          // Person box width
  NODE_HEIGHT: 80,          // Person box height
  HORIZONTAL_GAP: 40,       // Gap between sibling boxes
  VERTICAL_GAP: 100,        // Gap between generations
  SPOUSE_GAP: 20,           // Gap between married couple boxes
  COUPLE_LINE_DROP: 40,     // How far down the line drops before branching to children
};
```

### 5.3 Node Types

#### Person Node (Known Person)
```
┌──────────────────────┐
│  [Avatar]  John Smith │
│            Father     │
│            b. 1955    │
└──────────────────────┘
```

- Background: White with colored left border (based on relationship type)
- Avatar: Small circular avatar (32x32) on the left
- Name: Bold text, first + last name
- Role label: Relationship to the root person (e.g., "Father", "Grandmother")
- Birth year: If available
- On hover: Slight shadow/highlight
- On click: Navigate to person profile or show tooltip

#### Missing Person Placeholder
```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
  [?]  Unknown Mother   
│      + Add Person    │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
```

- Background: Dark/black with dashed border
- Icon: Question mark or silhouette
- Label: The missing role (e.g., "Unknown Mother")
- "Add Person" button/chip
- On click: Opens `AddFamilyMemberDialog` with pre-filled context

### 5.4 Edge Types (Lines)

#### Marriage/Spouse Line
```
  ┌─────┐         ┌─────┐
  │ Dad │────♥────│ Mom │
  └─────┘         └─────┘
```

- Horizontal line connecting two spouse boxes
- Optional small icon/symbol at midpoint (heart, ring, or just a dot)
- Color: Solid for married, dashed for divorced/ex

#### Parent-to-Child Line
```
       ┌─────────────┐
       │    couple    │
       └──────┬──────┘
              │
       ┌──────┴──────┐
       │             │
    ┌──┴──┐      ┌──┴──┐
    │Kid 1│      │Kid 2│
    └─────┘      └─────┘
```

- Vertical line drops from the center of the couple connection line
- If multiple children: horizontal line spans across all children, with vertical drops to each child box
- Single child: just a straight vertical line down

#### Multi-Child Branch Line
```
            │
     ┌──────┼──────┐
     │      │      │
  ┌──┴──┐┌──┴──┐┌──┴──┐
  │  A  ││  B  ││  C  │
  └─────┘└─────┘└─────┘
```

- Vertical line from couple
- Horizontal line at branching point
- Vertical lines down to each child
- All lines same color/weight

### 5.5 Zoom & Pan

Reuse the zoom/pan implementation from `graph.tsx`:

- **Mouse wheel**: Zoom in/out centered on cursor position
- **Click + drag on background**: Pan the canvas
- **Pinch gesture** (touch): Zoom in/out
- **Touch drag** (touch): Pan the canvas
- **Zoom limits**: Min 0.1x, Max 3.0x
- **Keyboard**: Arrow keys for pan, +/- for zoom

### 5.6 Responsive Behavior

- Canvas fills the available page area (below header, above footer controls)
- On window resize, recalculate canvas dimensions
- "Fit to screen" button: Adjust zoom and pan so the entire tree is visible

---

## 6. Person Selection Dialog

**New file**: `client/src/components/family-tree-person-selector.tsx`

This dialog appears when the user first enters the Family Tree page or clicks "Change person".

### 6.1 Design

```
┌─────────────────────────────────────┐
│  Select a Person                  ✕ │
│                                     │
│  Search for a person to view their  │
│  family tree.                       │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ 🔍 Type a name...           │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ [Avatar] John Smith         │    │
│  │ [Avatar] Jane Smith         │    │
│  │ [Avatar] Bob Johnson        │    │
│  └─────────────────────────────┘    │
│                                     │
│           [View Family Tree]        │
└─────────────────────────────────────┘
```

### 6.2 Behavior

1. Modal is **required** — cannot be dismissed without selecting a person (no close button on first open, or closing navigates back).
2. Search input filters people list in real-time (query the existing `GET /api/people` endpoint with a search term).
3. Shows matching people with avatar, name, and optional subtitle (e.g., title/company).
4. Clicking a person selects them (highlighted).
5. "View Family Tree" button confirms the selection and closes the dialog.
6. Follow the pattern in `add-relationship-dialog.tsx` for the person search/select UI.

---

## 7. Add Family Member Dialog

**New file**: `client/src/components/add-family-member-dialog.tsx`

This dialog appears when clicking an "Add Person" placeholder on the tree or via a manual action.

### 7.1 Design

```
┌─────────────────────────────────────────┐
│  Add Family Member                    ✕ │
│                                         │
│  Adding [role] for [Person Name]        │
│                                         │
│  ○ Link existing person                 │
│  ○ Create new person                    │
│                                         │
│  ─── If "Link existing person" ──────   │
│  ┌─────────────────────────────┐        │
│  │ 🔍 Search people...         │        │
│  └─────────────────────────────┘        │
│  [Search results list]                  │
│                                         │
│  ─── If "Create new person" ─────────   │
│  First Name: [_______________]          │
│  Last Name:  [_______________]          │
│  Birthday:   [_______________]          │
│  Gender:     [Male ▾]                   │
│                                         │
│  Relationship: [Father ▾]              │
│                                         │
│  [Cancel]              [Add to Tree]    │
└─────────────────────────────────────────┘
```

### 7.2 Behavior

1. **Pre-filled context**: When opened from a placeholder, the role dropdown is pre-selected (e.g., "Mother") and the related person is shown in the header.
2. **Two modes**: 
   - "Link existing person" — Search and select from existing people in the database.
   - "Create new person" — Quick form with minimal fields (first name, last name, birthday, gender).
3. **Relationship type dropdown**: Lists all family relationship types from `GET /api/family-relationships/types`.
4. **On submit**:
   - If linking existing: `POST /api/family-relationships` with both person IDs.
   - If creating new: First `POST /api/people` to create the person, then `POST /api/family-relationships`.
5. **After success**: Invalidate the family tree query to refresh the canvas. Show a toast notification.

### 7.3 Form Validation

- At least one of: existing person selected OR new person fields filled.
- Family relationship type is required.
- If creating new person: first name is required.
- Use `react-hook-form` with `zod` validation (existing pattern).

---

## 8. Person Profile — Tree Tab

### 8.1 Add Tab to Person Profile

**File**: `client/src/pages/person-profile.tsx`

Add a new "Tree" tab in the `TabsList`, positioned **after** the "Relationships" tab:

```
Tabs order:
- Flow
- Relationships
- Tree  ← NEW
- Groups
- Photos (if applicable)
```

### 8.2 Tree Tab Component

**New file**: `client/src/components/family-tree-tab.tsx`

This component renders a smaller version of the family tree canvas, focused on the current person.

```typescript
interface FamilyTreeTabProps {
  personId: string;
}
```

**Behavior**:
1. Fetches `GET /api/family-tree/:personId?depth=3` (smaller depth for the tab view).
2. Renders the same `FamilyTreeCanvas` component used on the full page.
3. Has a "View Full Tree" link/button that navigates to `/family-tree` with the person pre-selected.
4. Includes the same zoom/pan controls.
5. Canvas fills the tab content area.

### 8.3 Tab Content Layout

```
┌──────────────────────────────────────────┐
│ [Depth: 3 ▾]  [Fit to Screen] [Full →]  │
│ ┌──────────────────────────────────────┐ │
│ │                                      │ │
│ │        Family Tree Canvas            │ │
│ │        (embedded, depth=3)           │ │
│ │                                      │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

---

## 9. Visual Design Specifications

### 9.1 Color Palette

| Element | Color | Hex |
|---|---|---|
| Person box background | White | `#FFFFFF` |
| Person box border | Light gray | `#E5E7EB` |
| Person box left accent (family) | Red | `#EF4444` |
| Selected person highlight | Blue | `#3B82F6` |
| Root person highlight | Primary theme color | — |
| Missing person box background | Dark gray | `#1F2937` |
| Missing person text | White | `#F9FAFB` |
| Marriage line | Solid gray | `#6B7280` |
| Divorce line | Dashed gray | `#9CA3AF` |
| Parent-child line | Solid gray | `#6B7280` |
| Canvas background | Off-white | `#F9FAFB` |

### 9.2 Typography

| Element | Size | Weight |
|---|---|---|
| Person name | 14px | 600 (semibold) |
| Relationship label | 12px | 400 (normal) |
| Birth year | 11px | 400 (normal) |
| "Add Person" text | 12px | 500 (medium) |

### 9.3 Box Dimensions

| Variant | Width | Height |
|---|---|---|
| Person box (desktop) | 160px | 80px |
| Person box (mobile) | 120px | 60px |
| Missing person box | Same as person box | Same |
| Avatar circle | 32px diameter | — |

### 9.4 Line Styling

| Line Type | Width | Style | Color |
|---|---|---|---|
| Marriage/spouse | 2px | Solid | `#6B7280` |
| Divorced/ex-spouse | 2px | Dashed (5px gaps) | `#9CA3AF` |
| Parent-to-child | 2px | Solid | `#6B7280` |
| Child branch horizontal | 2px | Solid | `#6B7280` |

---

## 10. API Integration

### 10.1 Query Keys

Follow the existing `@tanstack/react-query` pattern with string-based query keys:

```typescript
// Family tree data
queryKey: ["/api/family-tree", personId, depth]

// Family relationship types
queryKey: ["/api/family-relationships/types"]

// Suggestions
queryKey: ["/api/family-tree", personId, "suggestions"]

// People search (for dialogs)
queryKey: ["/api/people", searchTerm]
```

### 10.2 API Calls

All API calls use the existing `apiRequest` utility from `client/src/lib/queryClient.ts`:

```typescript
// Fetch family tree
const { data: treeData, isLoading } = useQuery({
  queryKey: ["/api/family-tree", personId, depth],
  queryFn: () => apiRequest("GET", `/api/family-tree/${personId}?depth=${depth}`),
  enabled: !!personId,
});

// Create family relationship
const createMutation = useMutation({
  mutationFn: (data: CreateFamilyRelationshipInput) =>
    apiRequest("POST", "/api/family-relationships", data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/family-tree", personId] });
    toast({ title: "Family member added" });
  },
});

// Delete family relationship
const deleteMutation = useMutation({
  mutationFn: (id: string) =>
    apiRequest("DELETE", `/api/family-relationships/${id}`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/family-tree", personId] });
    toast({ title: "Family connection removed" });
  },
});
```

### 10.3 Data Transformation

The API returns a flat list of people and relationships. The frontend must transform this into a renderable tree structure:

```typescript
interface RenderNode {
  person: FamilyTreePerson;      // From API
  x: number;                      // Calculated by layout
  y: number;                      // Calculated by layout
  isMissing: boolean;             // True for placeholder nodes
  missingRole?: string;           // e.g., "mother"
}

interface RenderEdge {
  fromNode: RenderNode;
  toNode: RenderNode;
  type: "spouse" | "parent-child";
  style: "solid" | "dashed";      // Dashed for ex-spouse
}

function transformToRenderTree(
  apiData: FamilyTreeResponse,
  rootPersonId: string
): { nodes: RenderNode[]; edges: RenderEdge[] } {
  // 1. Build adjacency map from relationships
  // 2. Identify couples (spouse relationships)
  // 3. Identify parent-child groups
  // 4. Run layout algorithm to assign x,y positions
  // 5. Create missing person placeholders from missingLinks
  // 6. Generate render edges
}
```

---

## 11. State Management

### 11.1 URL State

Use URL query parameters to persist the selected person and depth so the page is bookmarkable/shareable:

```
/family-tree?person=abc-123&depth=6
```

Read on mount, update on change. Use `wouter` (the app's router) to read/update query params.

### 11.2 Canvas State

Managed locally in the `FamilyTreeCanvas` component via `useState`/`useRef`:

- `viewport`: `{ x, y, scale }` — pan/zoom state
- `hoveredNodeId`: string | null — for hover effects
- `selectedNodeId`: string | null — for click selection
- `isDragging`: boolean — for pan gesture

### 11.3 Dialog State

Managed in the parent page component:

```typescript
const [showPersonSelector, setShowPersonSelector] = useState(!personId);
const [addMemberContext, setAddMemberContext] = useState<AddMemberContext | null>(null);
```

---

## 12. Implementation Order

Follow this order to build incrementally with testable milestones:

### Step 1: Route & Navigation
1. Add `/family-tree` route to `App.tsx`.
2. Add "Family Tree" item to `app-sidebar.tsx`.
3. Create a placeholder `family-tree.tsx` page with just a title.
4. **Verify**: Navigate to the page from the sidebar.

### Step 2: Person Selection Dialog
1. Create `family-tree-person-selector.tsx`.
2. Implement person search using existing `GET /api/people` endpoint.
3. Wire it up on the family tree page — show on load, set state on selection.
4. **Verify**: Can search, select a person, dialog closes.

### Step 3: Canvas Setup
1. Create `family-tree-canvas.tsx` with Pixi.js initialization.
2. Implement basic zoom/pan (port from `graph.tsx`).
3. Render a single box for the selected person.
4. **Verify**: Canvas renders, zoom/pan works, person box appears.

### Step 4: API Integration
1. Wire up `GET /api/family-tree/:personId` query.
2. Parse the response into the internal tree structure.
3. Render all person boxes at placeholder positions (no layout yet).
4. **Verify**: Boxes appear for all people in the tree.

### Step 5: Tree Layout
1. Implement (or integrate `d3-hierarchy`) the tree layout algorithm.
2. Position couple pairs side-by-side.
3. Position children below parents.
4. Assign generation-based vertical positions.
5. **Verify**: Tree looks like a proper family tree hierarchy.

### Step 6: Edge Rendering
1. Draw spouse connection lines.
2. Draw parent-to-child lines with the branching pattern.
3. Style married vs. divorced lines differently.
4. **Verify**: All connections are visually clear and correct.

### Step 7: Missing Links & Placeholders
1. Render "missing person" placeholder boxes from the API's `missingLinks` data.
2. Make them visually distinct (dark background, dashed border).
3. Wire click handler to open add member dialog.
4. **Verify**: Placeholders appear where expected, are clickable.

### Step 8: Add Family Member Dialog
1. Create `add-family-member-dialog.tsx`.
2. Implement "Link existing person" mode with search.
3. Implement "Create new person" mode with quick form.
4. Wire up `POST /api/family-relationships` mutation.
5. **Verify**: Can add a family member, tree refreshes.

### Step 9: Person Profile Tree Tab
1. Add "Tree" tab to `person-profile.tsx`.
2. Create `family-tree-tab.tsx`.
3. Embed `FamilyTreeCanvas` with `depth=3`.
4. Add "View Full Tree" button linking to `/family-tree?person=:id`.
5. **Verify**: Tab shows tree, link navigates correctly.

### Step 10: Polish & Edge Cases
1. Add zoom controls UI (buttons for +/−/reset/fit).
2. Add depth slider.
3. Handle empty trees gracefully.
4. Handle loading and error states.
5. Add tooltips on hover for person boxes.
6. Test with large trees (performance).
7. Test on mobile/touch devices.
8. **Verify**: Full feature works end-to-end.

---

## Appendix A: File Summary

| File | Type | Description |
|---|---|---|
| `client/src/pages/family-tree.tsx` | New | Main family tree page |
| `client/src/components/family-tree-canvas.tsx` | New | Reusable Pixi.js canvas component |
| `client/src/components/family-tree-person-selector.tsx` | New | Person selection dialog |
| `client/src/components/add-family-member-dialog.tsx` | New | Add/link family member dialog |
| `client/src/components/family-tree-tab.tsx` | New | Person profile tree tab content |
| `client/src/App.tsx` | Modified | Add `/family-tree` route |
| `client/src/components/app-sidebar.tsx` | Modified | Add "Family Tree" nav item |
| `client/src/pages/person-profile.tsx` | Modified | Add "Tree" tab |

## Appendix B: Interaction Cheat Sheet

| User Action | Result |
|---|---|
| Click "Family Tree" in sidebar | Navigate to `/family-tree`, show person selector |
| Select person in dialog | Fetch tree, render on canvas |
| Mouse wheel on canvas | Zoom in/out |
| Click + drag on canvas background | Pan |
| Click person box | Show tooltip / navigate to profile |
| Click "Add Person" placeholder | Open add family member dialog |
| Submit add member dialog | Create relationship, refresh tree |
| Change depth slider | Re-fetch tree with new depth, re-render |
| Click "Fit to Screen" | Adjust zoom/pan to show entire tree |
| Click "Tree" tab on person profile | Show focused tree (depth 3) for that person |
| Click "View Full Tree" in tab | Navigate to `/family-tree?person=:id&depth=6` |
