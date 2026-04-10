# 3D Graph – URL Parameters Guide

The 3D Connection Graph page (`/graph-3d`) supports URL query parameters so you can **bookmark**, **share**, and **deep-link** to a specific graph configuration. Any part of the application can link to the graph page with pre-set filters; the graph will initialise with those settings automatically.

All entity identifiers in URL params are **UUIDs** (the same `gen_random_uuid()` values stored in the database).

---

## Supported Parameters

| Parameter     | Type      | Default | Description |
|---------------|-----------|---------|-------------|
| `personUuid`  | `string` (UUID) | –  | Person UUID to highlight. When set, the graph shows **only** this person, their direct connections, and their groups. |
| `groupUuid`   | `string` (UUID) | –  | Group UUID to highlight. When set (and `personUuid` is absent), the graph shows the group node, its members, and inter-member relationships. |
| `showGroups`  | `boolean` | `true`  | Show or hide group nodes and group-membership links. Pass `false` to hide groups. |
| `hideOrphans` | `boolean` | `true`  | Hide people who have no relationships or group memberships. Pass `false` to show everyone. |
| `anonymize`   | `boolean` | `false` | Replace all names (except the logged-in user) with "Anonymous". Pass `true` to enable. |

> **Tip:** Parameters that match their default value are omitted from the URL to keep it short. For example, a clean `/graph-3d` is equivalent to `/graph-3d?showGroups=true&hideOrphans=true&anonymize=false`.

> **Note on priority:** If both `personUuid` and `groupUuid` are present, `personUuid` takes precedence.

---

## How It Works

### Reading params on load

When the `Graph3D` component mounts it reads `window.location.search` and uses each parameter to initialise the corresponding React state:

```ts
const initParams = new URLSearchParams(window.location.search);
const [showGroups, setShowGroups]         = useState(() => readBoolParam(initParams, "showGroups", true));
const [hideOrphans, setHideOrphans]       = useState(() => readBoolParam(initParams, "hideOrphans", true));
const [anonymizePeople, setAnonymizePeople] = useState(() => readBoolParam(initParams, "anonymize", false));
const [highlightedPersonId, setHighlightedPersonId] = useState<string | null>(() => initParams.get("personUuid"));
const [highlightedGroupId, setHighlightedGroupId]   = useState<string | null>(() => initParams.get("groupUuid"));
```

### Keeping the URL in sync

A `useEffect` watches all settings. Whenever one changes (via the options panel), the browser URL is updated in-place with `window.history.replaceState` — no extra history entries are created and no page reload occurs.

### Copy Link button

A **link icon button** (🔗) in the page header copies the full URL (with all current settings encoded as query params) to the clipboard so it can be pasted and shared.

---

## Example URLs

### Show the full graph (defaults)

```
/graph-3d
```

### Highlight a single person (by UUID) and their connections

```
/graph-3d?personUuid=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### Highlight a group and its members

```
/graph-3d?groupUuid=f0e1d2c3-b4a5-6789-0123-456789abcdef
```

### Highlight a person, hide groups, show orphans

```
/graph-3d?personUuid=a1b2c3d4-e5f6-7890-abcd-ef1234567890&showGroups=false&hideOrphans=false
```

### Anonymised view

```
/graph-3d?anonymize=true
```

---

## Linking from Other Pages

### Person Profile → 3D Graph

The **Person Profile** page (`/person/:id`) includes a **"View in Graph"** button that navigates to:

```
/graph-3d?personUuid={person.id}
```

This opens the 3D graph pre-filtered to show only the selected person and their direct connections — perfect for exploring someone's network at a glance.

### Group Profile → 3D Graph

The **Group Profile** page (`/group/:id`) includes a **"View in Graph"** button that navigates to:

```
/graph-3d?groupUuid={group.id}
```

This shows the group node, all its members, and relationships between members.

### Back navigation

When you click a node in the graph, you navigate to the person or group page with `?from=graph-3d`. The target page reads this parameter and wires the **Back** button to return you to `/graph-3d` (preserving your graph context through the browser's history stack).

### Linking from custom or external pages

Any anchor or programmatic navigation can target the graph with params:

```html
<a href="/graph-3d?personUuid=a1b2c3d4-e5f6-7890-abcd-ef1234567890">
  View connection map
</a>
```

```ts
navigate(`/graph-3d?personUuid=${person.id}&anonymize=true`);
```

---

## Adding a New URL Parameter

To extend the URL-param system with a new setting:

1. **Add state** in `graph-3d.tsx` initialised from `initParams`:
   ```ts
   const [myOption, setMyOption] = useState(() => readBoolParam(initParams, "myOption", false));
   ```

2. **Include it in the sync effect** — it's already covered because the effect depends on all settings and calls `syncUrl(...)`.

3. **Add it to `buildGraphUrl`** so it appears in the URL when its value is non-default:
   ```ts
   if (opts.myOption === true) p.set("myOption", "true");
   ```

4. **Update this guide** with the new parameter.

---

## Helper Functions Reference

| Function | Purpose |
|----------|---------|
| `readBoolParam(params, key, default)` | Safely reads a boolean query param; returns the default when the key is absent. |
| `buildGraphUrl(opts)` | Builds a `/graph-3d?...` path string, only including non-default values. Uses `personUuid` / `groupUuid` for entity references. |
