# Family Tree AI — Implementation Plan

A new feature that lets the user describe family-tree changes in natural language and have an LLM
propose a structured set of additions / edits / deletions to that person's relationships, using
tool calls to look up other people's relationships as needed.

---

## 1. Goals & User Flow

### Family Tree page (`client/src/pages/family-tree.tsx`)
1. Add a new toolbar **"AI"** button (Lucide `Sparkles` star icon) alongside the existing tree
   action buttons.
2. Clicking the button opens a **"Generate connections"** modal with:
   - A multi-line textbox for the user's prompt (e.g. "Add Jane as my mother, and link her to
     my known siblings").
   - Toggle: **"Willing to delete connections?"** (default: off).
   - Toggle: **"Ask about changes?"** (default: on) — when on, the proposed changes are shown
     for review before any DB write; when off, changes are applied immediately after generation.
   - Primary button: **"Generate changes"**.
3. After generation, a **review pane** appears in the same modal listing the proposed
   Additions / Edits / Deletions grouped by section, each row with a checkbox (default checked)
   and per-row reject. Footer has **Apply selected** and **Cancel**.
4. Loading state shows tool-call progress ("Looking up Jane Doe's relationships…").

### Intelligence settings — new page
- New page at `/intelligence/family-tree` titled **"Family Tree AI"** with a single model selector
  populated from `/api/ollama/models`, persisted to a new `ollama_family_tree_model` setting.
- Registered in `client/src/components/app-sidebar.tsx` under the Intelligence section and routed
  in `client/src/App.tsx`.

---

## 2. Backend

### 2.1 New settings key
- Add `ollama_family_tree_model` to the GET/POST handlers of `/api/ollama/settings`
  (`server/routes.ts` ~lines 6013–6050) using the existing `getOllamaSetting` / `setOllamaSetting`
  helpers — no schema change needed (app_settings KV table).

### 2.2 New endpoint: `POST /api/family-tree/:personId/ai-generate`
Located in `server/routes.ts` near the existing family-tree routes (~line 3305).

**Request body**
- `prompt: string` — user's free-text instructions
- `allowDeletions: boolean`
- `askAboutChanges: boolean` (forwarded to client; backend always returns the proposal — the flag
  is for the client's UX path)

**Server-side input gathering**
- Load the target person (full record).
- Load the person's current relationships via existing helpers powering
  `/api/relationships/:personId` and `/api/family-relationships/...` so the LLM gets both
  generic relationships and family-relationship rows (UUIDs, types, related-person UUID + name,
  metadata).
- Load relationship type catalog (`/api/relationship-types`,
  `/api/family-relationships/types`) so the LLM picks valid type IDs.

**LLM call**
- Use the model from `ollama_family_tree_model` (fallback to `ollama_text_model`) and the existing
  Ollama client wiring already used in `server/routes.ts`.
- Build a strict **system prompt** that:
  - Describes the JSON-only output schema (see §2.3).
  - States the user's UUID, current relationships, and allowed relationship type IDs verbatim.
  - Forbids inventing person UUIDs — new people must be expressed as `{ "newPerson": { "name": ... } }`.
  - Honors `allowDeletions` (must produce empty `deletions` array if false).
  - Instructs the model to call provided tools before finalizing whenever it needs another
    person's relationships.

**Tool calls exposed to the LLM**
Reuse / extend `server/ai-tools.ts` (existing pattern: JSON schema + dispatcher). Whitelist
only the relationship-relevant tools for this endpoint:
- `person_search(query)` — find person UUIDs by name.
- `get_person(uuid)` — full record.
- `get_relationships(personUuid)` — generic relationships for any person.
- `get_family_relationships(personUuid)` — family relationships for any person.
- `list_relationship_types()` / `list_family_relationship_types()`.

The handler runs the standard tool-use loop (model → tool_calls → execute → feed back) up to a
small max iteration limit, then expects a final JSON message.

### 2.3 Structured result schema
```jsonc
{
  "summary": "string, 1–2 sentences",
  "additions": [
    {
      "kind": "relationship" | "family_relationship",
      "fromPersonUuid": "uuid-or-newPersonRef",
      "toPersonUuid":   "uuid-or-newPersonRef",
      "typeId": "string",
      "metadata": { /* type-specific */ },
      "rationale": "string"
    }
  ],
  "edits": [
    { "id": "relationshipUuid", "kind": "...", "changes": { ... }, "rationale": "..." }
  ],
  "deletions": [
    { "id": "relationshipUuid", "kind": "...", "rationale": "..." }
  ],
  "newPeople": [
    { "ref": "newPersonRef", "name": "string", "notes": "string?" }
  ],
  "warnings": ["string"]
}
```
The endpoint parses, validates with Zod, and returns it to the client without writing to the DB.

### 2.4 New endpoint: `POST /api/family-tree/:personId/ai-apply`
- Accepts the (possibly user-filtered) proposal returned above.
- In a transaction: create any `newPeople`, then perform additions / edits / deletions using
  the existing relationship + family-relationship storage helpers (and run
  `family-propagation.ts` where appropriate, matching the current manual flow).
- Returns the updated family tree payload.

---

## 3. Frontend

### 3.1 Family Tree page changes
- Add `AiGenerateConnectionsDialog` button + state to `family-tree.tsx`.

### 3.2 New component `client/src/components/ai-generate-connections-dialog.tsx`
- Built from existing `Dialog`, `Textarea`, `Switch`, `Button` primitives.
- Two phases in one modal:
  1. **Input phase** — prompt + toggles + "Generate changes" (calls `ai-generate`).
  2. **Review phase** — renders `additions / edits / deletions / newPeople / warnings`
     with checkboxes; "Apply selected" calls `ai-apply`. If `askAboutChanges` is false,
     skip phase 2 and call `ai-apply` immediately with the full proposal.
- On success, invalidate the family-tree queries so the canvas refreshes.
- Toasts for errors; disables button + shows spinner with status text while waiting.

### 3.3 New settings page `client/src/pages/intelligence-family-tree-settings.tsx`
- Mirrors the layout of `intelligence-settings.tsx`'s model selector card.
- Loads `/api/ollama/settings` + `/api/ollama/models`, edits only
  `ollama_family_tree_model`, saves via `POST /api/ollama/settings`.
- Add route in `client/src/App.tsx` and nav entry in `client/src/components/app-sidebar.tsx`
  under the Intelligence group (icon: `Sparkles`).

---

## 4. Validation & Safety
- Zod-validate the LLM's final JSON; on parse failure, return a 422 with the raw text so the UI
  can surface "AI returned malformed output, please retry".
- Server enforces `allowDeletions=false` by stripping any deletions before responding.
- Server verifies every referenced existing UUID belongs to a real person / relationship before
  apply (defense in depth — the model is untrusted).
- Cap tool-call loop iterations (e.g. 6) and total tokens to avoid runaway costs.

---

## 5. Testing
- Manual end-to-end on the family tree page with a small fixture person.
- Verify settings persistence by reloading the new settings page.
- Confirm `allowDeletions=false` actually blocks deletes even if the model proposes them.
- Confirm `askAboutChanges=false` applies immediately and refreshes the tree.

---

## 6. Files touched (summary)
- `server/routes.ts` — new settings key, `ai-generate` and `ai-apply` endpoints.
- `server/ai-tools.ts` — ensure relationship lookup tools are available + exported for the
  family-tree tool whitelist.
- `client/src/pages/family-tree.tsx` — AI button + dialog wiring.
- `client/src/components/ai-generate-connections-dialog.tsx` — new component.
- `client/src/pages/intelligence-family-tree-settings.tsx` — new settings page.
- `client/src/App.tsx`, `client/src/components/app-sidebar.tsx` — route + nav entry.
- No schema migration required (settings reuse `app_settings` KV table).
