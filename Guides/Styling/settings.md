# Settings Pages — Styling Guide

This document defines the styling conventions for all settings pages, documents the current state of each page, and identifies inconsistencies that need correction.

---

## Table of Contents

1. [Layout Paradigms](#layout-paradigms)
2. [Standard Container Pattern](#standard-container-pattern)
3. [Full-Height List Pattern](#full-height-list-pattern)
4. [Page Title & Subtitle](#page-title--subtitle)
5. [Card Patterns](#card-patterns)
6. [Buttons](#buttons)
7. [Responsive Behavior](#responsive-behavior)
8. [Current Page Inventory & Issues](#current-page-inventory--issues)
9. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)

---

## Layout Paradigms

Settings pages use **two** distinct layout patterns depending on their purpose:

| Pattern | Used By | Purpose |
|---------|---------|---------|
| **Standard Container** | Most settings & import pages | Scrollable padded content area |
| **Full-Height List** | Data-type lists, API docs | Fill parent with border-separated header + scrollable list |

All pages render inside the settings layout shell (`settings-layout.tsx`) within a `<main className="flex-1 overflow-auto">` wrapper.

---

## Standard Container Pattern

The **majority** of settings pages use this container wrapper:

```tsx
<div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
```

### Breakdown

| Class | Purpose |
|-------|---------|
| `container` | Tailwind container base |
| `max-w-full` | Full width on mobile |
| `md:max-w-2xl` | Default max-width on desktop (672px) |
| `py-3 md:py-8` | Vertical padding: compact on mobile, spacious on desktop |
| `px-4 md:pl-12` | Horizontal padding: 16px mobile, 48px left on desktop |
| `mx-auto md:mx-0` | Centered on mobile, left-aligned on desktop |

### Width Tiers

Some pages need wider content and use a larger max-width. The valid tiers are:

| Tier | Class | When to Use |
|------|-------|-------------|
| **Standard** | `md:max-w-2xl` | Most form-based settings, import/export pages |
| **Medium** | `md:max-w-3xl` | Pages with wider cards or status displays (e.g., tasks, image storage) |
| **Wide** | `md:max-w-4xl` | Pages with tables or multi-column content (e.g., API settings) |

Always include the full responsive pattern — never use bare `max-w-2xl` without the mobile-first classes.

---

## Full-Height List Pattern

Used for data-type list pages (relationship types, interaction types, social account types) and API docs:

```tsx
<div className="flex flex-col h-full">
  {/* Header */}
  <div className="border-b px-3 md:px-6 py-2 md:py-4">
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold">Page Title</h1>
      {/* Optional action button */}
    </div>
  </div>

  {/* Content */}
  <div className="flex-1 overflow-auto px-6 py-6">
    {/* List items */}
  </div>
</div>
```

### Rules

- Header has `border-b` separator
- Header padding is responsive: `px-3 md:px-6 py-2 md:py-4`
- Content area uses `flex-1 overflow-auto` for independent scrolling
- Title in header should be `text-2xl font-semibold` (matching standard pages)

---

## Page Title & Subtitle

### Standard (with page-level title)

```tsx
<div className="space-y-2 mb-6">
  <h1 className="text-2xl font-semibold">Page Title</h1>
  <p className="text-muted-foreground">
    Description of what this settings page does.
  </p>
</div>
```

| Element | Classes | Notes |
|---------|---------|-------|
| Wrapper | `space-y-2 mb-6` | 8px gap between title/subtitle, 24px below |
| h1 | `text-2xl font-semibold` | **Not** `font-bold`, **not** `text-3xl` |
| Subtitle | `text-muted-foreground` | No additional size class needed |

### With inline action button

```tsx
<div className="flex items-center justify-between gap-4 flex-wrap mb-6">
  <div className="space-y-2">
    <h1 className="text-2xl font-semibold">Page Title</h1>
    <p className="text-muted-foreground">Description text.</p>
  </div>
  <Button>Action</Button>
</div>
```

### Card-only pages (no standalone title)

Some sub-pages (e.g., import-contacts, user-options) skip the page-level h1 and use `CardTitle` + `CardDescription` inside the first card as the page header. This is acceptable for leaf/detail pages where the sidebar already indicates the context.

---

## Card Patterns

### Standard settings card

```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-lg">Section Title</CardTitle>
    <CardDescription>Explanation of this section.</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Form fields, controls */}
  </CardContent>
</Card>
```

### Navigational card (links to sub-page)

```tsx
<Link href="/target">
  <Card className="hover-elevate cursor-pointer">
    <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <CardTitle className="text-lg">Destination</CardTitle>
          <CardDescription className="mt-1">Description</CardDescription>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </CardHeader>
  </Card>
</Link>
```

### Multiple cards on a page

Wrap in a `div` with `space-y-6`:

```tsx
<div className="space-y-6">
  <Card>...</Card>
  <Card>...</Card>
</div>
```

**Do not** use manual `mt-6` or `className="mt-6"` on individual cards. Use `space-y-6` on the parent wrapper for consistent spacing.

### Destructive cards

```tsx
<Card className="border-destructive/50">
  ...
</Card>
```

### CardContent internal spacing

- Form sections: `space-y-4` or `space-y-6` depending on density
- Keep consistent within a page — prefer `space-y-4` for compact forms, `space-y-6` for larger grouped sections

---

## Buttons

### Primary actions

```tsx
<Button>Save Changes</Button>
<Button><Plus className="h-4 w-4 mr-2" />Create New</Button>
```

### Destructive actions

```tsx
<Button variant="destructive">
  <Trash2 className="h-4 w-4 mr-2" />Delete All
</Button>
```

### Icon-only actions

```tsx
<Button variant="ghost" size="icon">
  <Trash2 className="h-4 w-4" />
</Button>
```

### Icon spacing in buttons

Use `mr-2` on icons inside buttons with text labels. Use `className="h-4 w-4"` for standard icon size.

---

## Responsive Behavior

All container-pattern pages **must** include the full responsive class set:

```
container max-w-full md:max-w-{size} py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0
```

Full-height list pages must use responsive header padding:

```
border-b px-3 md:px-6 py-2 md:py-4
```

**Never** omit the mobile-first classes.

---

## Current Page Inventory & Issues

### Container-Pattern Pages

| Page | File | Container | Title | Issues |
|------|------|-----------|-------|--------|
| User Options | `user-options.tsx` | `md:max-w-2xl` ✓ | Card-only | None |
| App Options | `app-options.tsx` | `md:max-w-2xl` ✓ | `text-2xl font-semibold` ✓ | None |
| API Settings | `api-settings.tsx` | `md:max-w-4xl` | `text-3xl font-bold mb-2` | **Title should be `text-2xl font-semibold`**; title wrapper should be `space-y-2 mb-6` not bare div; container has baked-in `space-y-4 md:space-y-8` (unusual) |
| Instagram Settings | `instagram-settings.tsx` | `md:max-w-2xl` ✓ | `text-2xl font-semibold` ✓ | None |
| Tasks | `tasks-settings.tsx` | `md:max-w-3xl` ✓ | `text-2xl font-semibold` ✓ | None |
| Image Storage | `image-storage-settings.tsx` | `md:max-w-3xl` ✓ | `text-2xl font-semibold` ✓ | None |
| Delete Options | `delete-options.tsx` | `max-w-2xl py-8` | `text-2xl font-bold` | **Missing all mobile-responsive classes** (`max-w-full`, `py-3 md:py-8`, `px-4 md:pl-12`, `mx-auto md:mx-0`); **Title uses `font-bold`** instead of `font-semibold`; title wrapper uses `mb-8` instead of `mb-6`; cards use manual `mt-6` instead of `space-y-6` wrapper |
| Import & Export Home | `import-export-home.tsx` | `md:max-w-2xl` ✓ | `text-2xl font-semibold` ✓ | Card list uses `space-y-4` instead of `space-y-6` (minor) |
| Import Contacts | `import-contacts.tsx` | `md:max-w-2xl` ✓ | Card-only | Container has extra `space-y-6` (acceptable for card-only pages) |
| Import Social Media | `import-social-media.tsx` | `md:max-w-2xl` ✓ | Card-only | None |
| Import/Export Application | `import-export-application.tsx` | `md:max-w-2xl` ✓ | Card-only | None |
| Image Pass In | `image-pass-in.tsx` | `md:max-w-2xl` ✓ | `text-2xl font-semibold` ✓ | Card wrapper uses `space-y-4` instead of `space-y-6` (minor) |

### Full-Height List Pages

| Page | File | Header Padding | Title | Issues |
|------|------|---------------|-------|--------|
| Relationship Types | `relationship-types-list.tsx` | `px-3 md:px-6 py-2 md:py-4` ✓ | `text-3xl font-semibold` | **Title should be `text-2xl`** for consistency |
| Interaction Types | `interaction-types-list.tsx` | `px-3 md:px-6 py-2 md:py-4` ✓ | `text-3xl font-semibold` | **Title should be `text-2xl`** for consistency |
| Social Account Types | `social-account-types-list.tsx` | `px-3 md:px-6 py-2 md:py-4` ✓ | `text-3xl font-semibold` | **Title should be `text-2xl`** for consistency |
| API Docs | `api-docs.tsx` | `px-6 py-6` | `text-3xl font-semibold mb-2` | **Header padding should be `px-3 md:px-6 py-2 md:py-4`** for responsive consistency; **title should be `text-2xl`** |

### Summary of Issues to Fix

1. **`delete-options.tsx`** — Most inconsistent. Needs full responsive container, `font-semibold`, `mb-6`, and `space-y-6` card wrapper.
2. **`api-settings.tsx`** — Title should be `text-2xl font-semibold` with proper `space-y-2 mb-6` wrapper.
3. **`relationship-types-list.tsx`** — Title `text-3xl` → `text-2xl`.
4. **`interaction-types-list.tsx`** — Title `text-3xl` → `text-2xl`.
5. **`social-account-types-list.tsx`** — Title `text-3xl` → `text-2xl`.
6. **`api-docs.tsx`** — Title `text-3xl` → `text-2xl`; header padding needs responsive classes.

---

## Quick-Reference Cheat Sheet

```
┌─────────────────────────────────────────────────────────┐
│ CONTAINER PATTERN                                       │
│                                                         │
│ className="container max-w-full md:max-w-2xl            │
│   py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0"         │
│                                                         │
│ ┌─ Title Block ──────────────────────────────────────┐  │
│ │ div.space-y-2.mb-6                                 │  │
│ │   h1.text-2xl.font-semibold                        │  │
│ │   p.text-muted-foreground                          │  │
│ └────────────────────────────────────────────────────┘  │
│                                                         │
│ ┌─ Cards ────────────────────────────────────────────┐  │
│ │ div.space-y-6                                      │  │
│ │   Card > CardHeader > CardTitle.text-lg            │  │
│ │                       CardDescription              │  │
│ │         CardContent.space-y-4                       │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ FULL-HEIGHT LIST PATTERN                                │
│                                                         │
│ div.flex.flex-col.h-full                                │
│ ┌─ Header ───────────────────────────────────────────┐  │
│ │ div.border-b.px-3.md:px-6.py-2.md:py-4            │  │
│ │   h1.text-2xl.font-semibold                        │  │
│ └────────────────────────────────────────────────────┘  │
│ ┌─ Content ──────────────────────────────────────────┐  │
│ │ div.flex-1.overflow-auto.px-6.py-6                 │  │
│ │   div.space-y-3 (list items)                       │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```
