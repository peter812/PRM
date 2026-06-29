# Crowds & Potential Groups Feature Buildout Guide

This document outlines the architecture, database changes, algorithms, API endpoints, and frontend designs required to implement **Crowds** and **Potential Group Finding** in PRM.

---

## 1. Feature Overview

### Crowds
In PRM, a **Crowd** is the extended network of people associated with a group or organization based on social media relationships. Because direct membership in a group is definitive, crowds represent a looser, inferential association:
- **Group Center Account**: Every group can be associated with a "center account" (e.g., the official organization's social account).
- **Crowd Membership Rule**: A person is part of a group's crowd if they follow **more than 5** people who follow that group's center account.
- **Intersection**: Since a person can follow multiple center accounts' followers, crowds can overlap and intersect.
- **Performance Constraint**: Crowd calculation requires scanning followers and following lists for all people in the system. Because this is extremely data-intensive, it must be performed **asynchronously** as a background task and triggered only on-demand by the user.

### Potential Group Finding
This sub-feature analyzes graph connections (either relationships between people or followers/following relationships between social accounts) to find highly interconnected communities that are more connected than average.
- **Group Specification**: The user can configure what defines a group (e.g., minimum density, minimum size, link types).
- **Clustering**: Automatically partition the network and suggest potential groups that the user can name, color, and promote to real groups.

---

## 2. Database Schema Extensions

We will modify the existing schema in [shared/schema.ts](file:///c:/Repos/PRM/shared/schema.ts) to support center accounts, cached crowd members, and background tasks.

### Schema Changes in `shared/schema.ts`

```typescript
// 1. Additions to the "groups" table definition:
export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").notNull(), 
  type: text("type").array().default(sql`ARRAY[]::text[]`),
  members: text("members").array().default(sql`ARRAY[]::text[]`), // List of Person UUIDs
  imageUrl: text("image_url"),
  
  // NEW: Center Account & Crowd Columns
  centerAccountId: varchar("center_account_id").references(() => socialAccounts.id, { onDelete: "set null" }),
  crowdMembers: text("crowd_members").array().default(sql`ARRAY[]::text[]`), // List of Person UUIDs in the crowd
  crowdLastCalculatedAt: timestamp("crowd_last_calculated_at"),
  
  vectorId: text("vector_id"),
  vectorSyncedAt: timestamp("vector_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### Database Migration Considerations
- Add columns using SQL statements in `server/db-init.ts` for backward compatibility, or create a Drizzle migration.
- `center_account_id` should have a foreign key pointing to `social_accounts(id)` with `ON DELETE SET NULL`.
- `crowd_members` is an array of text (`text[]`) defaulting to `ARRAY[]::text[]`.

---

## 3. Background Task Runner (`server/task-worker.ts`)

Two new task types will be registered in `server/task-worker.ts` and supported by the background worker:
1. `calculate_crowd` (computes crowd membership for a single group).
2. `find_potential_groups` (runs community detection to discover highly connected clusters).

### Task 1: Crowd Calculation (`calculate_crowd`)
**Payload format:**
```json
{
  "groupId": "string-uuid"
}
```

#### Step-by-Step Logic
1. **Fetch Group Info**: Retrieve the group by `groupId`. Verify it has a valid `centerAccountId`. If not, fail the task with an error message: `"No center account associated with this group."`
2. **Fetch Followers of Center Account**: Look up the record in `socialNetworkState` where `socialAccountId = group.centerAccountId`. Let $F_{center}$ be the set of account UUIDs stored in the `followers` array.
3. **Fetch All People**: Retrieve all people in the database, including their linked social account IDs (from `people.social_account_uuids` or by joining `social_accounts` where `owner_uuid = people.id`).
4. **Scan Follow Lists**:
   - Initialize an empty array `crowdPersonIds`.
   - For each person $P$:
     - Get all social account IDs $S_P$ owned by $P$.
     - Fetch the `following` arrays from `socialNetworkState` for all accounts in $S_P$.
     - Compute the union of these following lists, yielding $Following_P$, the set of all accounts followed by person $P$.
     - Calculate the intersection: $I = Following_P \cap F_{center}$.
     - If $|I| > 5$:
       - Add $P$'s ID to `crowdPersonIds`.
5. **Update Group Record**:
   - Update the group in the database: set `crowdMembers` to `crowdPersonIds` and `crowdLastCalculatedAt` to the current time.
   - Return a result JSON summarizing the calculation (e.g., number of people checked, number of crowd members found).

---

### Task 2: Potential Group Finder (`find_potential_groups`)
**Payload format:**
```json
{
  "entityType": "people" | "social_accounts",
  "minGroupSize": 3,
  "minDensityMultiplier": 1.5,
  "linkDefinition": "any" | "mutual" | "family" // Configuration for edge selection
}
```

#### Graph Clustering Algorithm (Label Propagation)
To analyze connections and find interconnected groups, we will implement the **Label Propagation Algorithm (LPA)**, which is simple, fast ($O(V + E)$), and scales well for large graphs.

```typescript
function runLabelPropagation(nodes: string[], edges: [string, string][], maxIterations = 20): Map<string, string[]> {
  const labels = new Map<string, string>();
  const adjacency = new Map<string, string[]>();

  // 1. Initialize each node with its own unique label
  for (const node of nodes) {
    labels.set(node, node);
    adjacency.set(node, []);
  }

  // 2. Build adjacency list (treating edges as undirected for community structure)
  for (const [u, v] of edges) {
    adjacency.get(u)?.push(v);
    adjacency.get(v)?.push(u);
  }

  // 3. Propagate labels
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    // Shuffle nodes to prevent propagation bias
    const shuffledNodes = [...nodes].sort(() => Math.random() - 0.5);

    for (const node of shuffledNodes) {
      const neighbors = adjacency.get(node) || [];
      if (neighbors.length === 0) continue;

      // Count label frequencies among neighbors
      const counts = new Map<string, number>();
      for (const neighbor of neighbors) {
        const lbl = labels.get(neighbor)!;
        counts.set(lbl, (counts.get(lbl) || 0) + 1);
      }

      // Find the label(s) with maximum frequency
      let maxFreq = 0;
      let bestLabels: string[] = [];
      for (const [lbl, freq] of counts.entries()) {
        if (freq > maxFreq) {
          maxFreq = freq;
          bestLabels = [lbl];
        } else if (freq === maxFreq) {
          bestLabels.push(lbl);
        }
      }

      // Pick a random best label to break ties
      const chosenLabel = bestLabels[Math.floor(Math.random() * bestLabels.length)];
      if (labels.get(node) !== chosenLabel) {
        labels.set(node, chosenLabel);
        changed = true;
      }
    }

    if (!changed) break; // Converted/Stabilized early
  }

  // 4. Group nodes by label
  const communities = new Map<string, string[]>();
  for (const [node, lbl] of labels.entries()) {
    if (!communities.has(lbl)) communities.set(lbl, []);
    communities.get(lbl)!.push(node);
  }

  return communities;
}
```

#### Modularity & Density Calculations
After communities are identified, the worker filters them to isolate clusters that are **more connected than average**:

1. **Calculate Global Density**:
   $$D_{global} = \frac{2 \times |E_{total}|}{|V_{total}| \times (|V_{total}| - 1)}$$
2. **Calculate Cluster Density** for each community $C$:
   $$D_C = \frac{2 \times |E_{in}(C)|}{|C| \times (|C| - 1)}$$
   Where $|C|$ is the number of nodes in the cluster, and $|E_{in}(C)|$ is the number of edges connecting nodes inside the cluster.
3. **Filter and Rank**:
   - Keep communities where $|C| \ge \text{minGroupSize}$ and $D_C \ge D_{global} \times \text{minDensityMultiplier}$.
   - Store these potential groups in the task's `result` column, including member IDs, connectivity details, and density ratios.

---

## 4. API Endpoint Specifications

The following API endpoints will be added to the server:

| Method | Endpoint | Payload | Response | Description |
|---|---|---|---|---|
| **POST** | `/api/groups/:id/calculate-crowd` | None | `{ "taskId": "uuid" }` | Queue a background task to recalculate the crowd for a group. |
| **POST** | `/api/potential-groups/analyze` | `{ "entityType": string, "minGroupSize": number, ... }` | `{ "taskId": "uuid" }` | Start an async analysis of connections to locate clusters. |
| **GET** | `/api/potential-groups/results/:taskId` | None | `{ "status": string, "results": PotentialGroup[] }` | Retrieve the discovered groups from a completed analysis task. |
| **POST** | `/api/potential-groups/create` | `{ "name": string, "color": string, "members": string[] }` | `{ "success": true, "groupId": "uuid" }` | Create a new group using members identified during potential group finding. |

---

## 5. Frontend User Interface Integration

### A. Group Profile Integration (`client/src/pages/group-profile.tsx`)

Inside [client/src/pages/group-profile.tsx](file:///c:/Repos/PRM/client/src/pages/group-profile.tsx), we will introduce a third tab: **"Crowd"**.

#### 1. Configuration & Center Account Setup
- If the group does not have a `centerAccountId` assigned, show an onboarding panel:
  > **No Center Account Assigned**
  > Assign a social account to act as the focal point for this group's crowd analysis.
- Provide a searchable select box populated with social accounts (especially those of type "Instagram" or "X.com") to assign as the center account.

#### 2. Crowd List View
Once a center account is set:
- Show a card with details of the center account (avatar, username, platform).
- Display a **"Recalculate Crowd"** button showing the last calculated timestamp.
  - Clicking this triggers `/api/groups/:id/calculate-crowd`.
  - While the task is processing, display a progress bar using the task status (e.g., "Scanning follower connections: 45%").
- Render a paginated grid or list of people in the crowd.
  - Display their profile photo, name, and connection strength (e.g., "Follows 8 followers of this group").
  - Show a small badge "Intersection" if they are also members of another group's crowd.

```
+-------------------------------------------------------------+
|  Members  |  Interactions  |  Crowd (24)                    |
+-------------------------------------------------------------+
| Center Account: @gemini_org (Instagram)                     |
| Last analyzed: 2 hours ago              [ Recalculate Crowd ]|
|                                                             |
| Crowd Members:                                              |
| +---------------------------------------------------------+ |
| | [Avatar] Alice Vance     Follows 12 followers    [View] | |
| | [Avatar] Bob Miller      Follows 8 followers     [View] | |
| +---------------------------------------------------------+ |
+-------------------------------------------------------------+
```

---

### B. Potential Groups Finding Panel (`client/src/pages/groups-list.tsx`)

On the main Groups page, we will add a tab or header button: **"Find Potential Groups"** linking to `/groups/potential`.

#### 1. Configuration Parameters
- **Scope**: Choose whether to cluster the network based on **People Relationships** or **Social Media Follows**.
- **Connectivity Threshold**: Minimum group size (slider, default 3) and Density Multiplier (slider, default 1.5x).
- **Run Button**: Triggers the async task.

#### 2. Discovered Clusters Display
- Show the detected potential groups in cards.
- Each card displays:
  - Suggested name (e.g., "Potential Group (Clustered around Alice & Bob)").
  - Member count and avatar pile.
  - Density indicator (e.g., "3.2x more connected than average").
  - An **"Accept as Group"** button. This opens a modal to name the group, assign a color, and save it to the DB.

---

### C. Network Graph Visualization (`client/src/pages/social-graph-3d.tsx`)

To visualize the crowds on the 3D network graph page, we will introduce a new visualization mode in [client/src/pages/social-graph-3d.tsx](file:///c:/Repos/PRM/client/src/pages/social-graph-3d.tsx).

#### 1. Visualizing Crowds & Overlaps
- **Crowd Clouds / Bounding Hulls**:
  - Draw semi-transparent bounding spheres or hulls enclosing members of a crowd.
  - We can construct a sphere for a crowd by taking the centroid of all crowd member node positions in 3D:
    $$\vec{C}_{centroid} = \frac{1}{N} \sum_{i=1}^N \vec{x}_i$$
    And set the sphere radius to enclose a given percentage (e.g., 90%) of the members.
- **Node Highlighting & Coloring**:
  - When a group is highlighted:
    - Display the core Group Members with solid, brightly colored nodes.
    - Display the Group Center Account with a larger node and a distinct ring.
    - Display the Crowd Members with semi-transparent nodes colored slightly lighter, linked to the center account's followers with dashed lines.
  - Intersecting nodes (nodes present in multiple crowds) can be rendered with multi-colored halos or pulsing effects.

#### 2. Graph Controls Options Panel
Add options to the settings sidebar of the 3D Graph:
- **Show Crowds (Toggle)**: Render bounding spheres around crowds.
- **Minimum Follow Intersection (Slider)**: Filter crowd nodes dynamically (e.g., only show nodes that follow $> N$ followers).

---

## 6. Verification & Implementation Plan

### Phase 1: Database & Task Infrastructure
1. Run migrations to add `center_account_id`, `crowd_members`, and `crowd_last_calculated_at` columns.
2. Register `'calculate_crowd'` and `'find_potential_groups'` tasks in `server/task-worker.ts`.
3. Add helper methods in `server/storage.ts` to update group crowd data.

### Phase 2: Task Workers & Algorithms
1. Implement the crowd calculation logic, validating intersections correctly.
2. Implement the Label Propagation and modularity density calculations.
3. Test task execution using unit/integration tests with seeded follow relationships.

### Phase 3: API & Frontend Integration
1. Implement endpoints for crowd calculation and potential group discovery.
2. Add the "Crowd" tab to `group-profile.tsx` with onboarding and progress displays.
3. Add the "Potential Groups" configuration page.
4. Enhance `social-graph-3d.tsx` to render crowd centroids, dashed connection lines, and bounding clouds.

### Automated Test Specifications
- **Test Crowd calculation**: Seed a center account with 10 followers. Seed Person A following 6 of them, and Person B following 4. Run `calculate_crowd` task. Verify Person A is in `crowd_members` and Person B is not.
- **Test community detection**: Seed a network containing two disjoint, fully connected cliques of size 5. Run potential group finder. Verify that two groups are discovered, and the density multipliers are high.
