# PRM-VR Devlog 01 — Implementation Plan

Scope: the six items from Devlog One, planned against the code as it exists today in
`C:\Repos\PRM-VR\PRM-VR\Assets\PRM_VR`. Companion to [VR-plan.md](VR-plan.md).

## Status (2026-09-13): implemented

All six devlog items are in `Assets/PRM_VR`. Where the build departed from the plan below
it was to remove code, not add it:

- No `GraphController` / `RenderSettingsApplier` classes — mode switching lives in
  `PRMVRApp`, rendering apply is `ClientSettings.Apply()`.
- UI scale is a `localScale` on each panel root, not a rebuild.
- Node budget is a constant (2000) in `GraphSettings`, not a stepper — nobody tunes it.
- No node-smoothness or "passthrough now" controls (the System Menu already toggles it).
- MSAA audit: Android's default quality tier ("Low") already uses the Performant URP asset
  with MSAA 4x, so the project assets were left alone; the runtime setting writes to
  whichever asset is active.
- Every menu/settings page is a `Panel` built from `RowLayout` rows; there are no
  hand-placed y constants left outside the login form and the info card.

Regenerate the scene (**PRM VR ▸ Build Scene**) once before the next device build so the
new `PRM/Avatar` and `PRM/Ribbon` shaders are pinned into Always Included Shaders.

### Follow-up round (same day)

- Info card keeps a constant angular size (scales with distance from the head, min 1×).
- Layout modes **Front / Surround** on the quick menu; Surround anchors at the head, seeds
  on a larger sphere, and runs springs ×0.4 / centering ×0.15.
- **Recenter Graph** (quick menu + system menu) re-homes on the user's current position.
- Right thumbstick moves the rig horizontally, relative to head yaw.
- Avatars: the GPU `Graphics.Blit` downscale (unreliable outside URP's render loop on XR,
  produced white cards) is replaced with a CPU box filter.
- Graph Settings has **Graph / Other** tabs; Other holds colours (palette steppers, social
  colour scheme by platform or by connections) and rendering. Colours re-apply to the
  existing model without a refetch or re-layout.
- Max nodes is a setting again (2k–30k). The simulation's repulsion moved from all-pairs to
  a spatial-hash cutoff (`NativeParallelMultiHashMap`) so 30k is reachable.

## 0. Decisions locked in

| Topic | Decision |
| :-- | :-- |
| Menus | **Quick Menu** = wrist-anchored on the left controller, toggled by **Y (left) or B (right)** — always appears on the left wrist. **System Menu** = floating panel in front of the user, toggled by the left **Menu (☰)** button. Everything currently on the wrist (Passthrough, Reset View, Group filter, Sign Out) moves to the System Menu. |
| Settings | Two independent floating panels: **Graph Settings** and **Client Settings**. Both can be open at once. |
| Persistence | Headset-local (`PlayerPrefs`, JSON). Graph defaults mirror the web app's `social-graph-defaults.ts`. *The web app stores its social-graph settings in browser localStorage, not on the server, so there is nothing server-side to pull from today — see §8.* |
| Social graph scope | Default mode only: nodes = social accounts colored by platform type, links = follows. Filters exposed: hide orphans, min connections, limit extras, max extras. No blob / single / multi modes, no alternate color schemes. |
| Social info card | Username + platform type + avatar. |
| Client Settings | MSAA (Off/2x/4x) + render scale; edge style (lines vs ribbons); passthrough-on-start; UI scale; haptics; server URL / stay-signed-in / sign out. |
| Login fade | All login text, changes with head movement → transparent draw-order flip (see §1). |

## 1. Root causes found in the current code

Several devlog items share one cause, so read this before touching anything.

**1a. Text fading white → gray (login *and* the info-card title).**
Every panel backdrop uses `PRM/Panel` (queue Transparent, alpha 0.88–0.93) and every label is
TextMeshPro (also queue Transparent). URP sorts transparent renderers back-to-front by
distance from the camera to each renderer's bounds center. The text sits 3–4 mm in front of
its backdrop (`LoginPanel.cs` — `backdrop.localPosition.z = 0.004`, label z = 0). At arm's
length that gap is inside the sorting noise, so as the head moves the order flips: when the
backdrop draws *after* the text, its 88 %-alpha navy fill is composited over the white glyphs
and the text reads as gray. This is also why the info-card **title looks gray even though it
is created white** (`InfoBubbleController.cs` `m_NameLabel` uses the default white).

Fix (one place, `UIFactory`): give renderers explicit `sortingOrder` tiers so distance never
decides — backdrop 0, field/button backgrounds 10, avatar 20, text 100. URP honours
`MeshRenderer.sortingOrder` before distance for transparents. Also widen the text z gap to
−0.003 as belt-and-braces.

**1b. Captions / status / subtitle are intentionally blue-gray.** `LoginPanel` captions are
`(0.6, 0.68, 0.82)`, status `(0.75, 0.8, 0.9)`; the info-card subtitle `(0.68, 0.76, 0.9)`
and detail `(0.78, 0.84, 0.94)`. Devlog asks for bright white everywhere → switch all to
`Color.white`; keep only the error-status tint (salmon) so failures stay distinguishable.

**1c. Avatar has square corners.** The avatar is a raw quad with `Universal Render
Pipeline/Unlit` and the texture set as `mainTexture` — nothing rounds it.

**1d. "Group / Relationships" text sits inside the avatar.** `m_DetailLabel` is centred at
x = 0 with width 0.30 and `TopLeft` alignment at y = −0.01 (top edge ≈ +0.025), while the
avatar occupies x −0.15…−0.08, y +0.02…+0.09. The detail block's first line starts under the
avatar's bottom edge with its left edge flush to the avatar's left edge. The card has no
layout — everything is hand-placed constants.

**1e. "No company on record"** is a literal fallback string in `InfoBubbleController.Show`.

**1f. Anti-aliasing.** Edges are one `MeshTopology.Lines` mesh — 1-px GL lines that MSAA
barely helps. The *Balanced* URP preset has `m_MSAA: 1` (off) and the *Performant* preset
`m_MSAA: 4`, i.e. backwards; which one the Android quality tier actually uses needs checking.
MSAA and render scale are runtime-settable on `UniversalRenderPipelineAsset`
(`msaaSampleCount`, `renderScale`).

## 2. Architecture additions

```
Scripts/
  App/PRMVRApp.cs                orchestration only; hands off to GraphController + menus
  App/GraphController.cs         NEW  owns GraphMode, caches both payloads, reloads on settings change
  Settings/ClientSettings.cs     NEW  POCO + defaults: msaa, renderScale, edgeStyle, passthroughOnStart, uiScale, haptics, rememberSession
  Settings/GraphSettings.cs      NEW  POCO + defaults: person {nodeScale, edgeAlpha, clusterStrength}; social {hideOrphans, minConnections, limitExtras, maxExtras, nodeBudget}
  Settings/SettingsStore.cs      NEW  PlayerPrefs <-> JSON (Newtonsoft), Changed events, Load()/Save()
  Settings/RenderSettingsApplier.cs  NEW  applies ClientSettings to the URP asset / XRSettings
  API/PRMClient.cs               + GetSocialGraphAsync, GetSocialAccountAsync, GetSocialAccountTypesAsync
  API/PRMModels.cs               + SocialGraphRequest/Response, SocialGraphNodeDto, SocialGraphLinkDto, SocialAccountDetailDto, SocialAccountTypeDto
  Graph/GraphModel.cs            GraphNode gains Kind {Person, SocialAccount} + SocialAccount payload; BuildPerson()/BuildSocial()
  Graph/GraphView.cs             + edge style switch (lines | ribbons), runtime SetNodeScale / SetEdgeAlpha
  Graph/EdgeRibbonMesh.cs        NEW  4 verts / 2 tris per edge, expanded toward the camera in the vertex shader
  Shaders/PRM_Ribbon.shader      NEW  camera-facing ribbon, width in world units, soft AA edges
  Shaders/PRM_Avatar.shader      NEW  textured rounded-rect (SDF clip, same math as PRM_Panel)
  Interaction/XRHandInput.cs     + SecondaryButton action  <XRController>{Hand}/secondaryButton  (Y / B)
  UI/UIFactory.cs                + sortingOrder tiers, CreateToggle, CreateStepper, CreateSegmented, CreateSection
  UI/FloatingPanel.cs            NEW  base: spawn 0.7 m ahead at eye height, face user once, Close button
  UI/QuickMenu.cs                RENAMED from WristMenu; new contents
  UI/SystemMenu.cs               NEW  FloatingPanel
  UI/GraphSettingsPanel.cs       NEW  FloatingPanel
  UI/ClientSettingsPanel.cs      NEW  FloatingPanel
  UI/InfoBubbleController.cs     layout rewrite + social variant
```

Principles kept from the existing code: no Canvas, no EventSystem, everything built at
runtime from quads + TMP, hit-testing only through `PRMPointer`'s physics raycast.

## 3. Phased work breakdown

Each phase is independently shippable and testable on the headset. Visual bugs (fast,
high-impact) land first; the settings infrastructure exists before the panels that need it.

### Phase 1 — Visual fixes (login text, info card)

1. **UIFactory sorting tiers** — `CreatePanel`, `CreateLabel`, `CreateButton`, `CreateField`
   set `renderer.sortingOrder` per tier; add a `SortTier` enum so callers can override.
   Text z-offset −0.003. *Fixes the login fade and the gray card title in one change.*
2. **LoginPanel colors** — captions, non-error status, title → white. Error status stays
   `(1, 0.55, 0.5)`.
3. **`PRM/Avatar` shader** — copy `PRM_Panel`'s rounded-box SDF, sample `_MainTex`, clip by the
   SDF, `_Radius` ≈ 0.18. Pin it in `PRMVRSceneBuilder.k_RuntimeShaders` (shader stripping —
   see the existing comment there). `InfoBubbleController.SetAvatar` switches to it.
4. **InfoBubble layout rewrite** — replace constants with a small vertical flow:
   - Row 1: avatar (left column, 0.07) | name (bold, white) + subtitle (white; hidden when empty).
   - Row 2 (below both columns, +0.012 margin): `Group: …` and `Relationships: n` as separate
     labels so no line can collide with the avatar.
   - Row 3: Focus / Close.
   - Card height computed from the rows; backdrop and button row follow it.
5. **Company fallback** — empty string; the subtitle object is `SetActive(false)` when empty so
   the name sits alone. `ApplyDetail` still fills `title @ company` when the detail call returns.

Acceptance: on device, sweep the head across the login panel and card — no text brightness
change; avatar corners rounded; no overlap at 0.5×–2× graph scale; blank subtitle when the
person has no company.

### Phase 2 — Settings infrastructure

1. `ClientSettings` / `GraphSettings` POCOs with defaults (graph defaults copied from
   `client/src/lib/social-graph-defaults.ts`: hideOrphans `true`, minConnections `0`,
   limitExtras `true`, maxExtras `20`; extras steps `[5, 10, 20, 50, 100]`).
2. `SettingsStore` — `Load()` at app start, `Save()` on every change, one `Changed` event per
   settings object. Keys `prm.vr.client`, `prm.vr.graph`. Corrupt JSON → defaults + warning.
3. `RenderSettingsApplier` — applies MSAA / render scale to
   `GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset` and mirrors render
   scale to `XRSettings.eyeTextureResolutionScale`. Applied at start and on change. Also audit
   which URP asset the Android quality level uses and fix the swapped MSAA values in the two
   presets.
4. `UIFactory` widgets — `CreateToggle` (label + `[x]` pill), `CreateStepper`
   (`−  value  +` over a discrete step list), `CreateSegmented` (2–3-way pill: Person|Social,
   Off|2x|4x, Lines|Ribbons), `CreateSection` (small-caps header + rule).
5. `FloatingPanel` base — spawn 0.7 m in front of the camera at eye height −0.1 m, face the
   user once (not head-locked), Close button top-right, `Open()/Close()/Toggle()`. Keeps a
   small registry so a second open panel is offset +0.42 m sideways instead of on top.

### Phase 3 — Input and menus

1. `XRHandInput` — add `m_Secondary` bound to `<XRController>{Hand}/secondaryButton`
   (Y on the left Touch controller, B on the right) → `SecondaryPressedThisFrame`. Keep `menu`
   on the left only (the right controller's Oculus button is reserved by the system).
2. `QuickMenu` (ex-`WristMenu`) — same anchor/tilt logic; contents sized for the 0.20 × 0.235
   wrist area:
   ```
   ┌────────────────────┐
   │  PRM                │  title, cap 0.010
   │ [ Person | Social ] │  segmented 0.175 × 0.036
   │ [ Graph Settings  ] │  0.175 × 0.036
   │ [Reset ] [ Focus× ] │  two half-width 0.084 × 0.036
   │  312 people · 940   │  status, cap 0.007
   └────────────────────┘
   ```
   Fit strategy: cap-height 0.008 for buttons, 0.036 row height, 0.008 gutters, max 4 rows.
   Anything beyond that goes to the System Menu rather than a second wrist page. If a 5th
   row is ever needed, `QuickMenu` gets `<` `>` paging built on the same `AddButton` grid.
3. `SystemMenu` (FloatingPanel, ~0.36 × 0.34) — Passthrough, Reset View, Group filter
   (disabled + dimmed in Social mode), Graph Settings, Client Settings, Sign Out, Close.
4. `PRMVRApp.Update` — Y/B → `QuickMenu.Toggle()`; Menu → `SystemMenu.Toggle()`. Both gated
   on `m_GraphLoaded` as today. Haptic tick on open when haptics are enabled.

### Phase 4 — Two graph modes

1. **API** — `PRMClient.GetSocialGraphAsync(SocialGraphRequest)` → `POST /api/social-graph`
   with `{ view: "social", hideOrphans, minConnections, limitExtras, maxExtras, mode: "default" }`.
   `GetSocialAccountAsync(id)` → `GET /api/social-accounts/:id` (username, typeId, imageUrl /
   currentProfile.imageUrl). `GetSocialAccountTypesAsync()` → `GET /api/social-account-types`
   (id, name, color), fetched once per session for the card's platform label.
2. **Models** — `SocialGraphResponse { nodes[], links[] }`, `SocialGraphNodeDto { id, name,
   typeColor, connectionCount, val, size, ownerPersonId, ownerName, ownerImageUrl }`,
   `SocialGraphLinkDto { source, target, mutual }`.
3. **GraphModel** — `GraphNode.Kind`, `GraphNode.SocialAccount`, `GraphModel.BuildSocial()`
   (node tint = typeColor, degree = connectionCount, edge color = mutual ? accent : default).
   `GraphView.CreateNode` already reads `node.GroupColor`, so Social nodes get platform colors
   for free.
4. **GraphController** — holds `Mode`, caches the last Person and Social payloads, exposes
   `SwitchTo(mode)` and `ReloadSocial()` (called when social filters change, debounced 300 ms
   after the last stepper tap). Quick Menu status shows `n accounts · m follows`.
   `ResetView` + `SetFocus(-1)` + `Bubble.Hide()` on every switch.
5. **Node budget** — Social payloads can reach thousands of nodes (imports cap at 10k).
   `GraphSettings.social.nodeBudget` (default 2000; steps 500/1000/2000/4000) truncates the
   payload by `connectionCount` descending before building and reports "showing 2000 of 6431"
   in the status line. One GameObject per node is fine at 2k on Quest 3; above that the
   simulation and pointer raycast need the batching work the web app's dense mode does —
   explicitly out of scope for this devlog.
6. **Social info card** — `InfoBubbleController.ShowSocial(node, followCount)`: avatar (rounded),
   `@username` (white bold), subtitle = platform type name in the type color, detail row
   `Connections: n`. On show, fetch the account detail for the avatar URL (same pattern as
   `OnNodeClicked` for people). Focus / Close behave as in Person mode.

### Phase 5 — Graph Settings and Client Settings panels

**GraphSettingsPanel** (FloatingPanel, ~0.36 × 0.40)
- Section *Graph*: `[ Person | Social ]` segmented (mirrors the Quick Menu).
- Section *Person graph*: Node size (stepper 0.04–0.10), Edge opacity (stepper 0.15–0.6),
  Group clustering (Off/Low/High → `ForceDirectedSimulation3D` cluster strength).
- Section *Social graph*: Hide orphans (toggle), Min connections (stepper 0–10), Limit extras
  (toggle), Max extras (stepper 5/10/20/50/100; disabled when Limit extras is off), Node budget.
- Section *Rendering*: Edge style `[ Lines | Ribbons ]`, Ribbon width (stepper; ribbons only),
  Node smoothness (`MeshFactory` sphere subdivision Low/Med/High).
- Footer: Reset to defaults.
Changes apply live; social filter changes trigger `ReloadSocial()`.

**ClientSettingsPanel** (FloatingPanel, ~0.36 × 0.40)
- Section *Rendering*: Anti-aliasing `[ Off | 2x | 4x ]` (MSAA), Render scale (stepper
  0.8/0.9/1.0/1.2/1.4). Small note label: "higher costs battery".
- Section *Environment*: Passthrough on start (toggle), Passthrough now (toggle; mirrors the
  System Menu button).
- Section *Interface*: UI scale (stepper 0.8–1.5, applied as a multiplier on every
  `CreateLabel` cap height and panel size at build time — panels rebuild on change),
  Haptics (toggle → guard in `XRHandInput.SendHaptics`).
- Section *Account*: Server URL (read-only label), Stay signed in (toggle →
  `SessionStore.RememberSession`), Sign Out.

**Anti-aliasing work (Rendering)**
1. MSAA / render scale via `RenderSettingsApplier` (Phase 2). Verify with the Quest overlay
   that MSAA 4x actually engages under OpenXR + URP (the URP asset's value is what the XR
   swapchain uses).
2. **Edge ribbons** — `EdgeRibbonMesh` writes 4 vertices per edge: position = endpoint A,
   `TEXCOORD1` = endpoint B, `TEXCOORD0.x` = ±1 side, `TEXCOORD0.y` = 0/1 along. `PRM/Ribbon`
   expands each vertex perpendicular to the edge in view space by `_Width × 0.5`, then applies
   a `smoothstep` alpha falloff over the outer 25 % of the width so edges are anti-aliased
   regardless of MSAA. Width is in world units divided by the graph root's lossy scale so
   ribbons keep a constant on-screen thickness while the user scales the graph. Colors reuse
   the existing `Color32` vertex-color array; `SetFocus` / `FilterByGroup` keep working
   because they only touch that array.
3. Line mode stays as the low-cost fallback and remains the first-launch default; the devlog
   decides after a side-by-side on device whether ribbons become the default.

### Phase 6 — Verification on device

- Login: head sweep left/right/up/down, text stays white; error status stays salmon.
- Card: rounded avatar, white title, no subtitle when no company, no overlap at 0.5×/1×/2×.
- Y (left) and B (right) both toggle the Quick Menu on the left wrist; Menu opens the System
  Menu in front of the user; both close with their own controls; the laser hits every widget
  at arm's length.
- Person ↔ Social switch from both the Quick Menu and Graph Settings; status counts update;
  group filter disabled in Social mode; selecting a social node shows username / platform /
  avatar.
- Change each social filter → graph reloads within ~1 s; node-budget message appears on a
  large account set.
- Client Settings: MSAA and render scale change visibly and survive a relaunch; passthrough
  default respected on next start; UI scale rebuilds panels; haptics toggle silences ticks.
- Frame time (OVR Metrics) at 2k social nodes with ribbons + MSAA 4x stays ≥ 72 fps; record
  the numbers in the devlog.

## 4. Files touched per phase

| Phase | Files |
| :-- | :-- |
| 1 | `UI/UIFactory.cs`, `UI/LoginPanel.cs`, `UI/InfoBubbleController.cs`, `Shaders/PRM_Avatar.shader` (new), `Editor/PRMVRSceneBuilder.cs` (pin shader) |
| 2 | `Settings/*` (new), `UI/UIFactory.cs`, `UI/FloatingPanel.cs` (new), `Assets/Settings/Project Configuration/*URP*.asset` (MSAA audit) |
| 3 | `Interaction/XRHandInput.cs`, `UI/QuickMenu.cs` (rename), `UI/SystemMenu.cs` (new), `App/PRMVRApp.cs` |
| 4 | `API/PRMClient.cs`, `API/PRMModels.cs`, `Graph/GraphModel.cs`, `Graph/GraphView.cs`, `App/GraphController.cs` (new), `UI/InfoBubbleController.cs`, `UI/QuickMenu.cs` |
| 5 | `UI/GraphSettingsPanel.cs`, `UI/ClientSettingsPanel.cs` (new), `Graph/EdgeRibbonMesh.cs` (new), `Shaders/PRM_Ribbon.shader` (new), `Graph/MeshFactory.cs`, `Graph/ForceDirectedSimulation3D.cs` (cluster-strength hook), `Settings/RenderSettingsApplier.cs` |

No PRM server changes are required: `/api/social-graph`, `/api/social-accounts/:id` and
`/api/social-account-types` already exist behind the same session-cookie gate the app uses.

## 5. Estimates

| Phase | Size |
| :-- | :-- |
| 1 Visual fixes | 0.5 day |
| 2 Settings infra + widgets | 1 day |
| 3 Input + menus | 1 day |
| 4 Graph modes + social card | 1.5 days |
| 5 Settings panels + AA / ribbons | 2 days |
| 6 Device verification + devlog numbers | 0.5 day |

## 6. Risks

- **Transparent sorting fix** relies on URP honouring `sortingOrder` for `MeshRenderer`s. It
  does, but verify on device before building the rest on it. Fallback: put text on a later
  render queue via a per-label material instance (costs batching).
- **Social payload size** — `getSocialGraph` with `hideOrphans: false` on a 10k import returns
  more than the headset can lay out as individual GameObjects. The node budget is the guard;
  the status line must make truncation obvious.
- **MSAA under OpenXR** — some URP/OpenXR combinations ignore a runtime change until the next
  swapchain creation. If so, apply on start and label the control "takes effect after restart".
- **UI scale rebuild** — panels are built once in code with baked constants; a global scale
  multiplier is simplest as a `UIFactory.Scale` read at build time plus a `Rebuild()` on each
  panel. Cheaper than retro-fitting layout to every widget.
- **Two settings panels open at once** — both float; the placement registry offsets the second
  sideways so they never overlap at spawn.

## 7. Out of scope for Devlog 01

Blob / single-highlight / multi-highlight social modes, alternate color schemes (distance,
connections), crowd spheres, an in-VR account search picker, dense-mode batching above the
node budget, right-wrist menu mirroring, drag-to-move for floating panels.

## 8. Optional follow-up (PRM server)

The web app keeps social-graph settings in localStorage
(`client/src/lib/social-graph-defaults.ts`), so "server defaults + local overrides" cannot be
implemented without a server change. If cross-device defaults matter later: add a per-user
`social_graph_defaults` record (reuse `appSettings` or a new user-settings table), have the web
settings page write to it, and have VR read it on sign-in as the base layer under its local
overrides. Not needed for this devlog.
