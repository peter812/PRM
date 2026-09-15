# Oculus Quest 3 VR Graph Visualizer — Technical Specification & Implementation Plan

## 1. Executive Summary & Vision

This document details the architectural blueprint and step-by-step implementation plan for building a native **Meta Quest 3 Virtual Reality / Mixed Reality application** in **Unity** that connects directly to **PRM (Personal Relationship Manager)**.

The application allows users to step inside their relationship network:
- **Spatial Immersion**: Visualize relationships, families, and social groups as an interactive, living 3D constellation in either a fully immersive virtual cosmos or blended into the real physical room using Quest 3 high-resolution color **Passthrough**.
- **Intuitive Dual-Grip Bimanual Zooming**: Grabbing with both controller grip buttons simultaneously and moving hands apart or together dynamically scales, pans, and rotates the entire 3D graph in real physical space.
- **Raycast Targeting & Interactive Info Bubbles**: Pointing at any person node with the controller ray and pulling the trigger spawns a floating, billboarded 3D glassmorphic card displaying person details, avatar, tags, company, and connection metadata fetched live from PRM.
- **In-VR Login**: Authenticate directly against the user's PRM account (username + password) via a spatial keyboard, establishing the same session-cookie auth every browser client uses — see §3.1 for why the pairing-code flow doesn't fit.

---

## 2. System Architecture & Tech Stack

```
+-------------------------------------------------------------------------+
|                          Oculus Quest 3 Device                          |
|                                                                         |
|  +---------------------+   +---------------------+   +---------------+  |
|  |   Meta XR Core /    |   | Universal Render    |   |  XR Hands /   |  |
|  |  OpenXR Passthrough |   | Pipeline (Single-   |   | Touch Plus    |  |
|  |   (MR & VR Modes)   |   |  Pass Instanced)    |   |  Controllers  |  |
|  +----------+----------+   +----------+----------+   +-------+-------+  |
|             |                         |                      |          |
|  +----------v-------------------------v----------------------v-------+  |
|  |                     Unity XR Interaction Layer                    |  |
|  |   - TwoHandedScaleManipulator (Dual-Grip Bimanual Zoom & Rotate)  |  |
|  |   - RaycastPointerInteractor (Trigger selection on Node colliders)|  |
|  |   - InfoBubbleController (Billboard World-Space Canvas)           |  |
|  +------------------------------------+------------------------------+  |
|                                       |                                 |
|  +------------------------------------v------------------------------+  |
|  |                     3D Graph Visualization Engine                 |  |
|  |   - ForceDirected3D (Barnes-Hut / Unity C# Job System)            |  |
|  |   - Node & Edge Pooling / GPU Instanced Cylinders & Billboards    |  |
|  +------------------------------------+------------------------------+  |
|                                       |                                 |
|  +------------------------------------v------------------------------+  |
|  |                 PRM API Client & Auth Manager                     |  |
|  |   - UnityWebRequest + Async/Await C#                              |  |
|  |   - Manual Cookie Jar (Set-Cookie -> Cookie replay per request)   |  |
|  +------------------------------------+------------------------------+  |
+---------------------------------------|---------------------------------+
                                        | HTTPS / REST JSON
                                        v
+-------------------------------------------------------------------------+
|                               PRM Server                                |
|                                                                         |
|  +--------------------+  +--------------------+  +-------------------+  |
|  |     /api/login      |  |     /api/graph     |  | /api/people/:id   |  |
|  | (Passport session)  |  | (Nodes, Edges, Cl.)|  | (Person Details)  |  |
|  +--------------------+  +--------------------+  +-------------------+  |
+-------------------------------------------------------------------------+
```

### 2.1 Technology Stack Matrix

| Layer | Component | Version / Specification | Rationale |
| :--- | :--- | :--- | :--- |
| **Engine** | Unity Engine | `2022.3 LTS` or `Unity 6 (6000.x LTS)` | Industry-standard stability, OpenXR 1.10+ support, optimized Android XR backend for Quest. |
| **Render Pipeline** | Universal Render Pipeline (URP) | URP 14+ / 17+ | Essential for Mobile XR performance; supports Single-Pass Instanced rendering and Passthrough blending. |
| **XR Runtime** | OpenXR + Meta XR Core SDK | Meta XR All-in-One SDK v65+ | First-party Quest 3 color passthrough, spatial anchors, Touch Plus controller bindings. |
| **Interaction** | Unity XR Interaction Toolkit (XRI) | XRI 3.0+ | Standardized ray interactor, direct grab, bimanual two-handed grab/scale primitives. |
| **UI Framework** | TextMeshPro + World Space Canvases | TMP 3.0+ | Crisp sub-pixel font rendering in VR; low-overhead world-space floating cards. |
| **Networking** | C# `UnityWebRequest` / `HttpClient` | .NET Standard 2.1 / C# 10 | Async/await REST consumption with `Newtonsoft.Json` (Json.NET) for high-performance deserialization. |
| **Backend Integration**| PRM Express API | Existing Node.js / PostgreSQL | Consumes existing `/api/login`, `/api/graph`, `/api/people/:id`, `/api/images/*` — all gated by the same Passport session-cookie middleware as the browser app ([auth.ts:127](../server/auth.ts:127)). |

---

## 3. Core Capabilities & Mechanics Breakdown

### 3.1 Authentication Flow (Direct Login — Why Not the Pairing Code)

**This section replaces an earlier draft that assumed the Chrome extension's 4-digit pairing flow (`POST /api/extension-auth/verify`) could produce a Bearer token accepted by `/api/graph`, `/api/people/:id`, and `/api/images/*`. It cannot**, and this is worth recording so nobody re-proposes it later:

- Those three endpoints (and everything else not explicitly listed as public) sit behind a global `app.use("/api", ...)` gate that calls `requireAuth`, which checks **only** `req.isAuthenticated()` — a Passport session cookie ([auth.ts:127-134](../server/auth.ts:127), wired in [auth-setup.ts:103-106](../server/routes/auth-setup.ts:103)).
- The pairing flow's `sessionToken` is a *different* credential (an "extension session," validated via `authenticateExtensionToken()` against an `x-extension-token` header). Today that header is understood only by `tps.ts`, `pending-imports.ts`, `social-media.ts`, and `/api/extension-auth/ping` — none of which are the graph/people/image routes the VR app needs.
- Net result: a VR client authenticated via the pairing flow gets `401 Not authenticated` on every read the app actually depends on.

Instead, the VR app authenticates the same way the web client does: **`POST /api/login`** with username + password, entered on a spatial keyboard, and Unity carries the resulting session cookie on every subsequent request. This also means the graph/people endpoints "just work" through the existing multi-user access-control layer ([access.ts](../server/access.ts)) with no server changes required — `req.user` gets populated the normal way and `accessMiddleware` (auth-setup.ts) applies the same visibility rules a browser session would get.

```
Oculus Quest 3 App
------------------
1. User launches VR App, enters Server URL (e.g. https://prm.example.com)
2. Spatial keyboard: username + password
3. App sends POST /api/login  {"username": "...", "password": "..."}
4. Server responds 200 + Set-Cookie: connect.sid=... (httpOnly, sameSite=lax,
   secure in production -> requires a real TLS cert, see §3.1.2)
5. App captures the Set-Cookie value itself (UnityWebRequest does NOT persist
   cookies across requests automatically) and replays it as a `Cookie` header
   on every following call.
6. App loads GET /api/graph, GET /api/people/:id, GET /api/images/:filename
   using the same cookie.
```

#### 3.1.1 Endpoints Used
1. **Login**: `POST /api/login` (passport-local) — *Body:* `{"username": "...", "password": "..."}` — *Response:* `200` with the public user object ([auth.ts:101-103](../server/auth.ts:101)), and a `Set-Cookie` header carrying the session id. A wrong password returns `401` from Passport with no body to speak of — surface a generic "invalid credentials" message.
2. **Logout**: `POST /api/logout` — call this from an in-app "Sign Out" action; there is no other way to invalidate the session from the headset.
3. **Whoami / session check on relaunch**: `GET /api/user` — `401` if the stored cookie is gone or expired (cookie `maxAge` is 30 days server-side, [auth.ts:66](../server/auth.ts:66)); use this to silently fall back to the login screen instead of surfacing a raw 401 from `/api/graph`.

#### 3.1.2 Open Constraints to Resolve Before Building
- **No automatic cookie jar in UnityWebRequest.** Each request needs the `Cookie` header set manually from whatever `Set-Cookie` came back from `/api/login`. Budget real implementation time for this — it's a common source of "works once, then every request 401s" bugs.
- **`secure: true` cookies in production** ([auth.ts:65](../server/auth.ts:65)) mean the server must be served over real HTTPS (not a self-signed cert) for the cookie to be sent back by Unity's HTTP stack in prod — see §3.4a below on TLS.
- **Credential storage on-device.** Whatever gets cached for auto-login on relaunch (session cookie, or worse, the raw password) needs the same "PlayerPrefs is not encryption" caveat as before — see §3.1.3.
- **No pairing-code UX at all now** — if a low-friction "approve this headset from your phone" flow is still wanted later, it would need a *new* server-side endpoint that mints a real Passport session (not an extension-session token) from a short-lived code. Flag as a possible Phase 7 rather than solving it now.

#### 3.1.3 Session Persistence
Unity stores `server_url` and the session cookie value so relaunches skip the login screen. **Do not treat `PlayerPrefs` as encrypted** — on Android it is a plaintext XML file readable by anyone with device/backup access. If that risk matters for this deployment (shared headsets, sensitive PII in the graph), store the cookie value in the Android Keystore-backed storage instead, or require re-login each session. This is a decision to make explicitly, not assume away.

---

### 3.2 Dual-Grip Bimanual Pinch-to-Scale & Spatial Navigation

The scale interaction is modeled after standard CAD/3D spatial manipulation:

```
      Left Controller                             Right Controller
       [ Grip Held ]                               [ Grip Held ]
             \                                           /
              \                                         /
               *---------------------------------------*
                          Initial Distance D0
              
              <------- Hands Pulled Apart (D > D0) ------->
                              SCALE INCREASES
                           (Graph Expands / Zooms In)

              -------> Hands Brought Together (D < D0) <-------
                              SCALE DECREASES
                          (Graph Shrinks / Zooms Out)
```

#### Mathematical Formulation:
1. Let $\vec{P}_L(t)$ and $\vec{P}_R(t)$ be the 3D world positions of the left and right controller tracking centers at frame $t$.
2. When **both** grip buttons are pressed (threshold $> 0.7$):
   - Record initial hand distance $D_0 = \|\vec{P}_R(t_0) - \vec{P}_L(t_0)\|$.
   - Record initial graph scale $S_0 = \text{GraphRoot.transform.localScale}$.
   - Record initial midpoint $\vec{M}_0 = \frac{\vec{P}_L(t_0) + \vec{P}_R(t_0)}{2}$.
   - Record initial hand direction vector $\vec{V}_0 = \frac{\vec{P}_R(t_0) - \vec{P}_L(t_0)}{D_0}$.
3. On subsequent frames while both grips remain held:
   - Current distance: $D(t) = \|\vec{P}_R(t) - \vec{P}_L(t)\|$.
   - Scale multiplier: $k = \frac{D(t)}{D_0}$.
   - New scale: $S(t) = \text{Clamp}(S_0 \times k, S_{\text{min}}, S_{\text{max}})$.
   - **Translation (Panning)**: $\Delta \vec{M} = \vec{M}(t) - \vec{M}_0 \implies \text{GraphRoot.position} += \Delta \vec{M}$.
   - **Rotation (Yaw/Pitch/Roll)**: Compute quaternion rotation $\Delta Q = \text{FromToRotation}(\vec{V}_0, \vec{V}(t))$ and apply around midpoint $\vec{M}(t)$.
4. Clamping and smoothing: Apply an exponential decay filter (Lerp) to avoid jitter when hands tremble.

---

### 3.3 Target Selection & Billboarded 3D Info Bubble

```
       Controller
      [ Laser Ray ]  ========================>  [ Person Node Sphere ]
                                                * Hover: Outline Glow Shader
                                                * Trigger Click:
                                                      |
                                                      v
                                        +-------------------------------+
                                        |  (Avatar)   ALICIA BROOKS     |
                                        |  VP of Engineering @ Acme     |
                                        |  ---------------------------- |
                                        |  * Group: Work / Core Team    |
                                        |  * Relationships: 14 edges    |
                                        |  * Last Contact: 3 days ago   |
                                        |  [ View Bio ] [ Focus Graph ] |
                                        +-------------------------------+
                                         (World Space Canvas - Faces HMD)
```

#### Info Bubble Specifications:
1. **Raycasting**: Standard XR Ray Interactor with sphere-cast or collider hit on layer `GraphNode`.
2. **Visual Feedback on Hover**: Subtle expansion ($1.15\times$) and glow emission rim-lighting.
2a. **Data gap — needs a new/extended endpoint.** Two fields in the mockup above, "Relationships: 14 edges" and "Last Contact: 3 days ago," are not returned by any current endpoint: `getGraphData()` ([storage.ts:681-684](../server/storage.ts:681)) has no per-person edge count, and `getPersonById()` doesn't surface a last-interaction timestamp on the base object. Scope one of:
   - Extend `GET /api/people/:id` to include `relationshipCount` and `lastContactAt` (cheap if computed alongside the existing relationship join), or
   - Have the client derive `relationshipCount` client-side from the already-fetched graph edges (free, no server change) and drop `lastContactAt` from the bubble until a server change is prioritized.
   Recommend the client-side count as the Phase 5 default, with the server field as a stretch goal — avoids blocking node interaction on a backend change.
3. **Trigger Action**:
   - Audio click haptic pulse on controller ($15\text{ms}$ vibration at $0.4$ amplitude).
   - Animates a curved 3D glassmorphic card popping up above the selected node using an elastic spring curve.
   - **Billboard Constraint**: The card rotates every frame to align with the camera forward vector:
     $$\vec{u}_{\text{target}} = \text{Normalize}(\text{Headset.Position} - \text{Card.Position})$$
     $$\text{Card.Rotation} = \text{Quaternion.LookRotation}(\vec{u}_{\text{target}}, \text{Vector3.up})$$
   - Card displays: Full Name, Avatar Image (downloaded asynchronously and cached), Company, Relationships count, Group badges (color-coded), and Quick Actions (e.g. "Focus Node / Hide Unconnected", "Open Notes", "Close").

---

### 3.4 Passthrough vs. Virtual Environment Switching

- **Mixed Reality Passthrough**:
  - Sets camera background color to `(0, 0, 0, 0)` with alpha clear.
  - Enables `OVRPassthroughLayer` (or OpenXR Passthrough feature).
  - Graph appears anchored directly in the user's living room / office space.
- **Immersive Virtual Void**:
  - Disables Passthrough layer.
  - Activates a deep cosmic skybox / dark gradient environment with subtle particle dust to give 3D depth cues.
- **Toggle Mechanism**: Single button on the wrist HUD or left controller Menu button.

---

### 3.4a TLS / Certificate Requirements (Open Item)

Quest runs Android, which since API 28 blocks cleartext (plain HTTP) traffic by default and does not trust self-signed certificates unless explicitly configured. The example server URLs used elsewhere in this doc (`http://192.168.1.x:5000`, `https://prm.local`) will likely fail out of the box:
- A LAN deployment needs either a real cert (e.g. via a local CA plus a `network_security_config.xml` shipped in the APK trusting that CA), or cleartext explicitly allowed for that one host in the same config file — both are manual Android build steps, not a Unity script.
- This also feeds back into §3.1.2: production session cookies are `secure`-only, so if TLS isn't solved, login will appear to succeed but the cookie will never be replayed and every subsequent call will 401.

Decide the deployment target (public HTTPS domain vs. LAN-only) before Phase 2, since it changes both the Android manifest and the auth debugging story.

---

## 4. 3D Graph Layout & Visual Representation

### 4.1 3D Spatial Layout Options

PRM's 2D `/api/graph` returns nodes (people) and edges (relationships, family lineage, partnerships). In VR, we elevate this to 3D:

1. **3D Force-Directed Simulation (Continuous / Relaxing)**:
   - **Attractive Spring Force**: For connected nodes $(i, j)$:
     $$\vec{F}_{\text{spring}} = -k_{\text{spring}} \cdot (\|\vec{r}_j - \vec{r}_i\| - d_{\text{rest}}) \cdot \hat{r}_{ij}$$
   - **Repulsive Electrostatic Force**: Between all pairs $(i, j)$:
     $$\vec{F}_{\text{repulse}} = \frac{k_{\text{repulse}}}{\|\vec{r}_j - \vec{r}_i\|^2} \cdot \hat{r}_{ji}$$
   - **Centering Gravity Force**: Pulls distant nodes toward the origin $(0, 1.2\text{m}, 1.5\text{m})$ in front of user:
     $$\vec{F}_{\text{center}} = -k_{\text{center}} \cdot \vec{r}_i$$
   - Executed using Unity C# Job System with Burst Compiler to simulate 1,000+ nodes at a solid 90 FPS without dropping frames on Quest 3.
2. **Community Clustering in 3D**:
   - Nodes in the same PRM `group` or `crowd` are assigned attractive intra-group forces, forming distinct 3D visual star clusters.
3. **Color Coding**:
   - Edges: Relationship type colors from PRM (e.g., Red `#ef4444` for family/lineage, Blue for professional, Purple for social).
   - Nodes: Rim color matches primary group affiliation.

---

## 5. Unity Project Structure & Architecture

```
Assets/
├── PRM_VR/
│   ├── Animations/
│   │   └── InfoBubble_Pop.anim
│   ├── Materials/
│   │   ├── Mat_NodeDefault.mat
│   │   ├── Mat_NodeHover.mat
│   │   ├── Mat_EdgeLine.mat
│   │   └── Mat_GlassmorphicCard.mat
│   ├── Prefabs/
│   │   ├── Prefab_PersonNode.prefab      (Sphere + Collider + TMP Label + Billboard)
│   │   ├── Prefab_EdgeLine.prefab        (LineRenderer or GPU Tube)
│   │   ├── Prefab_InfoBubble.prefab      (World Space Canvas + Detail Cards)
│   │   ├── Prefab_AuthHUD.prefab         (Virtual Keypad & Server URL Input)
│   │   └── Prefab_WristMenu.prefab       (Passthrough toggle, reset zoom, filter)
│   ├── Scenes/
│   │   ├── Scene_Login.unity             (Pairing code & server configuration)
│   │   └── Scene_GraphViewer.unity       (Main XR space)
│   ├── Scripts/
│   │   ├── API/
│   │   │   ├── PRMClient.cs              (Async REST API, GET /api/graph, GET /api/people)
│   │   │   ├── PRMModels.cs              (JSON data structures matching PRM)
│   │   │   └── ImageCache.cs             (Async texture downloader & local LRU cache)
│   │   ├── Auth/
│   │   │   └── AuthManager.cs            (Handles 4-digit verification & session storage)
│   │   ├── Graph/
│   │   │   ├── GraphDataManager.cs       (Deserializes and binds PRM graph data)
│   │   │   ├── ForceDirectedSimulation3D.cs (Burst-compiled 3D physics layout engine)
│   │   │   ├── NodeRenderer.cs           (Handles node visual state, avatar texture)
│   │   │   └── EdgeRenderer.cs           (Draws and colors relationship links)
│   │   ├── Interaction/
│   │   │   ├── TwoHandedScaleManipulator.cs (Dual-grip bimanual zoom/scale/rotate/pan)
│   │   │   ├── NodeRaycastTarget.cs      (Hover & click triggers for Ray Interactor)
│   │   │   ├── InfoBubbleController.cs   (Billboard rotation, UI population)
│   │   │   └── WristMenuController.cs    (Passthrough toggle, visual filters)
│   │   └── Environment/
│   │       └── EnvironmentManager.cs     (Toggles OpenXR Passthrough vs. Immersive Skybox)
│   └── Shaders/
│       ├── Shader_GlowOutline.shadergraph
│       └── Shader_Glassmorphism.shadergraph
```

---

## 6. Detailed Implementation Walkthrough

### 6.1 C# Core Script Implementations

#### Script 1: `PRMModels.cs` (Data Transfer Objects)
```csharp
using System;
using System.Collections.Generic;

namespace PRM.VR.Data
{
    [Serializable]
    public class GraphResponse
    {
        public List<PersonNodeDto> people;
        public List<RelationshipEdgeDto> relationships;
        public List<GroupDto> groups;
    }

    [Serializable]
    public class PersonNodeDto
    {
        public string id;
        public string firstName;
        public string lastName;
        public string company;
        public string imageUrl;
        public List<string> socialAccountUuids;
    }

    [Serializable]
    public class RelationshipEdgeDto
    {
        public string id;
        public string fromPersonId;
        public string toPersonId;
        public string typeColor;
    }

    [Serializable]
    public class GroupDto
    {
        public string id;
        public string name;
        public string color;
        public List<string> members;
    }

    [Serializable]
    public class PersonDetailDto
    {
        public string id;
        public string firstName;
        public string lastName;
        public string company;
        public string notes;
        public string bio;
        public string imageUrl;
    }

    [Serializable]
    public class LoginRequest
    {
        public string username;
        public string password;
    }

    // Response shape matches publicUser() in server/auth.ts — password stripped,
    // adminView included. There is no token in this response: the session lives
    // in the Set-Cookie header, which PRMClient must capture and replay manually
    // (UnityWebRequest does not keep a cookie jar across separate requests).
    [Serializable]
    public class LoginResponse
    {
        public int id;
        public string username;
        public string role;
        public bool adminView;
    }
}
```

#### Script 2: `TwoHandedScaleManipulator.cs` (Bimanual Pinch & Scale)
```csharp
using UnityEngine;
using UnityEngine.InputSystem;

namespace PRM.VR.Interaction
{
    public class TwoHandedScaleManipulator : MonoBehaviour
    {
        [Header("Transform Target")]
        [SerializeField] private Transform graphRoot;

        [Header("Input Actions")]
        [SerializeField] private InputActionProperty leftGripAction;
        [SerializeField] private InputActionProperty rightGripAction;
        [SerializeField] private Transform leftControllerAnchor;
        [SerializeField] private Transform rightControllerAnchor;

        [Header("Scale Boundaries")]
        [SerializeField] private float minScale = 0.1f;
        [SerializeField] private float maxScale = 15.0f;
        [SerializeField] private float smoothing = 10.0f;

        private bool isDualGripping = false;
        private float initialHandDistance;
        private Vector3 initialScale;
        private Vector3 initialMidpoint;
        private Vector3 initialDirection;
        private Vector3 targetScale;
        private Vector3 targetPosition;
        private Quaternion targetRotation;

        private void Start()
        {
            if (graphRoot == null) graphRoot = transform;
            targetScale = graphRoot.localScale;
            targetPosition = graphRoot.position;
            targetRotation = graphRoot.rotation;
        }

        private void Update()
        {
            float leftGrip = leftGripAction.action?.ReadValue<float>() ?? 0f;
            float rightGrip = rightGripAction.action?.ReadValue<float>() ?? 0f;

            bool dualGripPressed = (leftGrip > 0.6f && rightGrip > 0.6f);

            if (dualGripPressed)
            {
                Vector3 pL = leftControllerAnchor.position;
                Vector3 pR = rightControllerAnchor.position;
                float currentDistance = Vector3.Distance(pL, pR);
                Vector3 currentMidpoint = (pL + pR) * 0.5f;
                Vector3 currentDirection = (pR - pL).normalized;

                if (!isDualGripping)
                {
                    // Gesture Initiated
                    isDualGripping = true;
                    initialHandDistance = Mathf.Max(currentDistance, 0.05f);
                    initialScale = graphRoot.localScale;
                    initialMidpoint = currentMidpoint;
                    initialDirection = currentDirection;
                }
                else
                {
                    // Scaling: Hands moving apart zooms in / increases graph scale
                    float factor = currentDistance / initialHandDistance;
                    Vector3 computedScale = initialScale * factor;
                    computedScale.x = Mathf.Clamp(computedScale.x, minScale, maxScale);
                    computedScale.y = Mathf.Clamp(computedScale.y, minScale, maxScale);
                    computedScale.z = Mathf.Clamp(computedScale.z, minScale, maxScale);
                    targetScale = computedScale;

                    // Panning (Translating with hands midpoint)
                    Vector3 deltaMidpoint = currentMidpoint - initialMidpoint;
                    targetPosition = graphRoot.position + deltaMidpoint;
                    initialMidpoint = currentMidpoint; // Continuous delta

                    // Rotation
                    Quaternion deltaRot = Quaternion.FromToRotation(initialDirection, currentDirection);
                    targetRotation = deltaRot * graphRoot.rotation;
                    initialDirection = currentDirection;
                }
            }
            else
            {
                isDualGripping = false;
            }

            // Smooth Interpolation
            graphRoot.localScale = Vector3.Lerp(graphRoot.localScale, targetScale, Time.deltaTime * smoothing);
            graphRoot.position = Vector3.Lerp(graphRoot.position, targetPosition, Time.deltaTime * smoothing);
            graphRoot.rotation = Quaternion.Slerp(graphRoot.rotation, targetRotation, Time.deltaTime * smoothing);
        }
    }
}
```

#### Script 3: `InfoBubbleController.cs` (Billboard 3D Information Popup)
```csharp
using UnityEngine;
using TMPro;
using UnityEngine.UI;
using PRM.VR.Data;

namespace PRM.VR.Interaction
{
    public class InfoBubbleController : MonoBehaviour
    {
        [Header("UI References")]
        [SerializeField] private TextMeshProUGUI nameLabel;
        [SerializeField] private TextMeshProUGUI companyLabel;
        [SerializeField] private TextMeshProUGUI detailsLabel;
        [SerializeField] private RawImage avatarImage;
        [SerializeField] private CanvasGroup canvasGroup;

        [Header("Animation")]
        [SerializeField] private float appearSpeed = 8f;
        private Transform mainCameraTransform;
        private bool isVisible = false;
        private Vector3 targetLocalScale = Vector3.zero;

        private void Awake()
        {
            if (Camera.main != null)
                mainCameraTransform = Camera.main.transform;
            
            transform.localScale = Vector3.zero;
        }

        private void LateUpdate()
        {
            if (mainCameraTransform == null) return;

            // Strict Billboard: Look at camera, keep vertical orientation
            Vector3 lookDirection = transform.position - mainCameraTransform.position;
            if (lookDirection.sqrMagnitude > 0.001f)
            {
                transform.rotation = Quaternion.LookRotation(lookDirection, Vector3.up);
            }

            // Scale Animation
            transform.localScale = Vector3.Lerp(transform.localScale, targetLocalScale, Time.deltaTime * appearSpeed);
        }

        public void DisplayPerson(PersonNodeDto node, Texture2D avatarTexture)
        {
            nameLabel.text = $"{node.firstName} {node.lastName}".Trim();
            companyLabel.text = string.IsNullOrEmpty(node.company) ? "Independent" : node.company;
            detailsLabel.text = $"Connections: {node.socialAccountUuids?.Count ?? 0} social links";
            
            if (avatarTexture != null)
            {
                avatarImage.texture = avatarTexture;
                avatarImage.color = Color.white;
            }
            else
            {
                avatarImage.color = new Color(0.3f, 0.3f, 0.3f, 1f);
            }

            targetLocalScale = Vector3.one * 0.002f; // Scaled for VR World Canvas
            isVisible = true;
        }

        public void Dismiss()
        {
            targetLocalScale = Vector3.zero;
            isVisible = false;
        }
    }
}
```

#### Script 4: `EnvironmentManager.cs` (Passthrough / VR Void Switching)
```csharp
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace PRM.VR.Environment
{
    public class EnvironmentManager : MonoBehaviour
    {
        [SerializeField] private Camera xrCamera;
        [SerializeField] private GameObject virtualSkyboxRoot;
        [SerializeField] private Material virtualSkyboxMaterial;
        [SerializeField] private OVRPassthroughLayer passthroughLayer; // or OpenXR AR Background Feature

        private bool isPassthroughEnabled = true;

        private void Start()
        {
            SetPassthrough(true);
        }

        public void ToggleEnvironment()
        {
            SetPassthrough(!isPassthroughEnabled);
        }

        public void SetPassthrough(bool enable)
        {
            isPassthroughEnabled = enable;
            
            if (enable)
            {
                // Clear color to zero alpha for passthrough video feed
                xrCamera.clearFlags = CameraClearFlags.SolidColor;
                xrCamera.backgroundColor = new Color(0, 0, 0, 0);
                if (passthroughLayer != null) passthroughLayer.enabled = true;
                if (virtualSkyboxRoot != null) virtualSkyboxRoot.SetActive(false);
            }
            else
            {
                // Virtual Void / Skybox Mode
                xrCamera.clearFlags = CameraClearFlags.Skybox;
                RenderSettings.skybox = virtualSkyboxMaterial;
                if (passthroughLayer != null) passthroughLayer.enabled = false;
                if (virtualSkyboxRoot != null) virtualSkyboxRoot.SetActive(true);
            }
        }
    }
}
```

---

## 7. Step-by-Step Implementation Roadmap

```
+-------------------------------------------------------------------------+
|                        DEVELOPMENT ROADMAP PHASES                       |
+-------------------------------------------------------------------------+
  [ Phase 1: Setup & OpenXR ] ─────────► Meta Quest 3 Project, URP, Passthrough
               │
  [ Phase 2: Auth & API Client ] ──────► 4-Digit Pairing Flow, /api/graph Client
               │
  [ Phase 3: 3D Layout & Rendering ] ──► Force-Directed Physics, Node/Edge Pooling
               │
  [ Phase 4: Spatial Dual-Grip ] ──────► Bimanual Scale / Pan / Rotate Mechanics
               │
  [ Phase 5: Raycast & Info Cards ] ───► Trigger Selection & Billboarded Popups
               │
  [ Phase 6: Optimization & Polish ] ──► 90/120 FPS Profiling, Haptics, Release
```

### Phase 1: Project Setup, OpenXR & Passthrough Configuration (Week 1)
- [ ] Create Unity Project (`2022.3 LTS` or `Unity 6`) using 3D URP template.
- [ ] Configure Project Settings for Meta Quest:
  - Platform: Android (ASTC texture compression, ARM64 architecture, Target API Level 32+).
  - XR Plug-in Management: Enable **OpenXR**, add **Meta XR Feature Group**.
  - Enable **Meta XR Passthrough** in OpenXR feature settings.
  - Rendering: Universal Render Pipeline, **Single Pass Instanced** stereo rendering.
- [ ] Create core test scene: Setup `XR Origin (XR Rig)`, add Passthrough layer, and test deployment to Quest 3 via SideQuest / Meta Quest Developer Hub. Verify crisp color passthrough rendering.

### Phase 2: PRM API Client & In-VR Login (Week 2)
- [ ] Resolve TLS/deployment target for the server (§3.4a) before writing any networking code — it determines the Android network security config.
- [ ] Develop `PRMClient.cs` handling HTTPS calls with a manually-managed session cookie (capture `Set-Cookie` from `/api/login`, replay as `Cookie` on every request — see §3.1.2).
- [ ] Build in-VR Auth Screen (`Scene_Login`):
  - Spatial keyboard for username + password against `/api/login`.
  - Server URL text input.
  - Decide and implement credential/session persistence per §3.1.3 (plain PlayerPrefs vs. Android Keystore).
  - On relaunch, validate the stored session with `GET /api/user` before assuming it's still valid.
- [ ] Implement API calls for `GET /api/graph` and `GET /api/people/:id`.

### Phase 3: 3D Graph Generation & Physics Simulation Engine (Week 3)
- [ ] Create prefabs for `PersonNode` (Sphere mesh with unlit/lit hybrid shader, name TextMeshPro billboard, dynamic group color ring).
- [ ] Create edge drawing system using pooled `LineRenderer` or GPU-instanced cylinders connecting `fromPersonId` to `toPersonId`.
- [ ] Implement 3D Force-Directed Layout algorithm:
  - Compute spring forces, Coulomb repulsion, and center attraction.
  - Offload calculation to Unity Job System (or compute coroutine) to maintain 90+ FPS.
  - Implement cluster bounding forces based on PRM groups and crowds.
  - Naive all-pairs repulsion is O(n²); if the graph exceeds a few hundred nodes, budget time for a Barnes-Hut octree approximation rather than assuming Burst alone gets to 1,000+ nodes at 90 FPS.

### Phase 4: Bimanual Dual-Grip Zoom & Spatial Transformation (Week 4)
- [ ] Hook up Input System action bindings for `Left Hand / Grip` and `Right Hand / Grip`.
- [ ] Implement `TwoHandedScaleManipulator.cs`:
  - Calculate Euclidean hand distance ratio to smoothly scale graph up (hands moving apart) and down (hands moving together).
  - Apply simultaneous translation (midpoint delta) and rotational yaw/pitch/roll.
  - Add inertial dampening so releasing grips feels smooth rather than jarring.

### Phase 5: Raycast Targeting, Trigger Selection & 3D Info Bubbles (Week 5)
- [ ] Configure `XR Ray Interactor` on right and left controllers with a curved laser line and reticle dot.
- [ ] Add sphere colliders to all person nodes on the `GraphNode` physics layer.
- [ ] Build `InfoBubble.prefab`:
  - 3D World Space Canvas with custom glassmorphic background material.
  - Billboard script to keep the bubble facing the user's headset at all times.
  - Display person's avatar, full name, company, group tags, and connection statistics (client-derived edge count per §3.3.2a — no server change required for v1).
  - Asynchronous avatar image downloader with local disk caching, authenticated the same way as `/api/graph` (cookie, not a bare URL fetch).
- [ ] Implement trigger click interaction to pop up or dismiss bubbles, with haptic feedback pulses on controller triggers.

### Phase 6: Passthrough Polish, HUD Controls, Performance Optimization (Week 6)
- [ ] Build Wrist-Mounted HUD Menu:
  - Toggle between Color Passthrough and Virtual Nebula Skybox.
  - "Reset View / Recenter Graph" button.
  - Filter graph by group / crowd selection.
  - "Sign Out" action that calls `POST /api/logout` and clears the stored session.
- [ ] Performance profiling with Meta Quest OVR Metrics Tool:
  - Verify fixed foveated rendering level (FFR).
  - Ensure draw calls stay $< 150$ via GPU instancing on nodes and lines.
  - Achieve stable **90 FPS / 120 FPS** on Quest 3.
- [ ] Produce `.apk` release build and standalone SideQuest installation package.

### Status

Implemented in the `PRM-VR` Unity project (Unity 6.3 / URP 17 / XRI 3.5 / Meta OpenXR 2.5), under `Assets/PRM_VR/`:

- [x] Phase 1 — project already existed as an MR Template; `PRM VR > Build Scene` generates `Scene_GraphViewer` with an XR Origin, AR Session, and passthrough-ready camera, and registers it as build scene 0.
- [x] Phase 2 — `PRMClient` (cookie-session login, graph/person/image fetch), `SessionStore`, spatial keyboard + `LoginPanel`.
- [x] Phase 3 — `GraphModel`, Burst-compiled `ForceDirectedSimulation3D`, `GraphView` (single-draw-call edge mesh, instanced icosphere nodes).
- [x] Phase 4 — `TwoHandedGraphManipulator` (dual-grip scale/pan/rotate about the hand midpoint, with release inertia).
- [x] Phase 5 — `PRMPointer` sphere-cast laser, hover glow, haptics, billboarded `InfoBubbleController`, authenticated avatar cache.
- [x] Phase 6 (partial) — `WristMenu` (passthrough toggle, reset view, group filter, sign out), `PassthroughManager` on AR Foundation, `PRM VR > Build APK`.

**Not yet verified:** nothing in the list above has run on a Quest 3. All of it compiles cleanly and the scene generates, but frame rate, draw-call counts, passthrough clarity, text legibility at distance, and the feel of the bimanual gesture are all unmeasured — §8.1 and §8.2 remain entirely open, and UI font sizes in particular were chosen from arithmetic, not from looking at them in a headset.

Deviation from this document worth noting: the project uses Unity's Meta OpenXR / AR Foundation stack, so passthrough is the AR camera background rather than the `OVRPassthroughLayer` shown in §6.1's `EnvironmentManager` sample.

---

## 8. Hardware Testing, Performance & Verification Strategy

### 8.1 Performance Targets for Quest 3

| Metric | Target Limit | Optimization Technique |
| :--- | :--- | :--- |
| **Frame Rate** | Constant $90\text{ FPS}$ (11.1ms frame budget) | Single Pass Instanced rendering + Burst Force simulation. |
| **Draw Calls / Batches** | $\le 120$ draw calls | GPU Instancing for node spheres, merged static meshes or batch lines. |
| **Triangles / Vertices** | $\le 150,000$ vertices in view | Low-poly sphere meshes with normal map smoothing; LODs for distant nodes. |
| **Texture Memory** | $\le 512\text{ MB}$ VRAM | Avatar images downscaled to $256\times256\text{ px}$ on download. |
| **Thermal Throttle** | Level 0 - 1 (Normal) | Minimal CPU physics load, no heavy per-frame garbage collection allocations. |

### 8.2 User Experience Checklist
- [ ] **Passthrough Clarity**: Ensure no black borders, correct depth layering with virtual UI placed in front of real walls.
- [ ] **Scale Comfort**: Zooming in/out must not cause motion sickness; graph manipulation rotates around the physical midpoint between hands rather than the user's head.
- [ ] **Laser Precision**: Raycasting must hit small nodes easily via ray sphere-casting (radius $0.04\text{m}$).
- [ ] **Readable Typography**: TextMeshPro world canvas fonts must be clearly legible from $0.5\text{m}$ to $3.0\text{m}$ viewing distance.

---

## 9. Conclusion & Next Steps

This plan delivers a cutting-edge, high-performance Quest 3 spatial computing extension for PRM. By leveraging the existing `/api/extension-auth/verify` endpoint, the onboarding experience requires under 15 seconds to pair, and the dual-grip scaling interaction unlocks unprecedented spatial comprehension of personal and professional social networks.
