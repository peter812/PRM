# Build Plan: PRM Chrome Extension

This document provides step-by-step instructions for an AI agent to build the Chrome Extension that pairs with the PRM host.

---

## Overview

The PRM Chrome Extension connects to a self-hosted PRM instance using a 4-digit pairing code. Once paired, the extension can search and read contact data from the PRM API.

### Auth Flow Summary

1. User installs the Chrome extension
2. User opens the extension popup and enters their PRM server URL
3. The extension pings the server (`GET /api/v1/ping`) to verify it's online
4. Once confirmed online, the extension shows a 4-digit code input
5. User reads the 4-digit code from PRM Settings → Chrome Extension page
6. User enters the code in the extension
7. The extension calls `POST /api/extension-auth/verify` with the code
8. On success, the extension receives a session token and stores it
9. All subsequent API calls include the token in `X-Extension-Token` header

---

## Step 1: Create Extension Project Structure

```
prm-chrome-extension/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── background/
│   └── service-worker.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── lib/
    └── api.js
```

### manifest.json

Create a Manifest V3 Chrome extension:

```json
{
  "manifest_version": 3,
  "name": "PRM - People Relationship Manager",
  "version": "1.0.0",
  "description": "Connect to your PRM instance to search and manage contacts",
  "permissions": ["storage", "alarms"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## Step 2: Build the API Communication Layer (`lib/api.js`)

Create a shared module for all PRM API calls.

### Stored Data

Use `chrome.storage.local` for persistence:
- `prmServerUrl` — The PRM host URL (e.g., `https://prm.example.com`)
- `extensionSessionToken` — The session token received after pairing
- `extensionSessionId` — The session ID for reference

### Functions to Implement

1. **`getStoredConfig()`** — Read `prmServerUrl` and `extensionSessionToken` from storage
2. **`saveConfig(serverUrl, sessionToken, sessionId)`** — Save to storage
3. **`clearConfig()`** — Remove all stored auth data
4. **`pingServer(serverUrl)`** — `GET {serverUrl}/api/v1/ping`
   - Returns `true` if server responds with `{ status: "ok" }`
   - Returns `false` on any error or timeout (use 5s timeout)
5. **`verifyCode(serverUrl, code)`** — `POST {serverUrl}/api/extension-auth/verify`
   - Body: `{ "code": "<4-digit-code>" }`
   - Content-Type: `application/json`
   - On success (201): returns `{ sessionToken, sessionId, createdAt }`
   - On error (401): returns `{ error: "Invalid or expired code" }`
6. **`pingSession(serverUrl, token)`** — `POST {serverUrl}/api/extension-auth/ping`
   - Header: `X-Extension-Token: {token}`
   - Returns `true` if session is still valid
   - Returns `false` if 401 (session revoked)
7. **`searchPeople(serverUrl, token, query)`** — `GET {serverUrl}/api/search?q={query}`
   - Header: `X-Extension-Token: {token}`
   - Returns search results

**Important:** All fetch calls should:
- Use `AbortController` with a 10-second timeout
- Handle network errors gracefully
- Return structured error objects, not throw exceptions

---

## Step 3: Build the Background Service Worker (`background/service-worker.js`)

### Responsibilities

1. **Periodic ping** — Every 5 minutes, call `pingSession()` to keep the session alive and update `lastAccessedAt` on the server
2. **Session validation** — If ping returns 401, clear stored credentials and update badge

### Implementation

```
chrome.alarms.create("ping-prm", { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "ping-prm") {
    const config = await getStoredConfig();
    if (config.serverUrl && config.sessionToken) {
      const isValid = await pingSession(config.serverUrl, config.sessionToken);
      if (!isValid) {
        await clearConfig();
        // Update extension badge to show disconnected state
        chrome.action.setBadgeText({ text: "!" });
        chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
      } else {
        chrome.action.setBadgeText({ text: "" });
      }
    }
  }
});
```

---

## Step 4: Build the Popup UI (`popup/popup.html` + `popup.js`)

The popup has 3 states/views:

### View 1: Server URL Input (not connected)

Show when: No `prmServerUrl` is stored or server is not reachable

**UI Elements:**
- Header: PRM icon + "PRM Extension"
- Text input: "Enter your PRM server URL"
  - Placeholder: `https://prm.example.com`
- Button: "Connect" (triggers ping check)
- Status indicator: Shows connection result

**Behavior:**
1. User enters URL and presses Enter or clicks Connect
2. Strip trailing slashes from URL
3. Call `pingServer(url)`
4. If online → save URL, transition to View 2
5. If offline → show error "Could not connect to PRM server"

### View 2: Code Entry (server connected, not paired)

Show when: `prmServerUrl` exists but no `extensionSessionToken`

**UI Elements:**
- Header: "Enter Pairing Code"
- Instruction text: "Open PRM Settings → Chrome Extension to see your code"
- 4 individual digit input boxes (auto-advance on input)
- Button: "Verify" (only enabled when all 4 digits entered)
- Link: "Change server URL" (goes back to View 1)

**Behavior:**
1. User enters 4 digits (auto-advance focus between inputs)
2. On clicking Verify or when all 4 digits entered, call `verifyCode(serverUrl, code)`
3. If success → save session token, transition to View 3
4. If error → show "Invalid or expired code. Please try again." and clear inputs
5. The code input should only accept digits (0-9)

### View 3: Connected / Search (paired)

Show when: Both `prmServerUrl` and `extensionSessionToken` exist

**UI Elements:**
- Header: "Connected to PRM" with green status dot
- Search input: "Search contacts..."
- Search results list (scrollable, max-height)
- Each result shows: Name, company, email (if available)
- Footer: "Disconnect" button

**Behavior:**
1. Search input has 300ms debounce
2. On typing, call `searchPeople(serverUrl, token, query)`
3. Display results in a scrollable list
4. Clicking a result could open the PRM person page in a new tab: `{serverUrl}/person/{id}`
5. "Disconnect" button clears all stored data and returns to View 1

---

## Step 5: Popup Styling (`popup/popup.css`)

Style the popup to match the PRM design language:

- **Width:** 360px
- **Max height:** 500px
- **Font:** System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
- **Colors:**
  - Background: `#ffffff` (light), `#1a1a2e` (dark — respect system preference)
  - Primary: `#6366f1` (indigo-500)
  - Text: `#1f2937` (gray-800)
  - Muted text: `#6b7280` (gray-500)
  - Border: `#e5e7eb` (gray-200)
  - Error: `#ef4444` (red-500)
  - Success: `#22c55e` (green-500)
- **Border radius:** 8px for cards, 6px for inputs
- **Spacing:** 16px padding, 12px gaps

### Code Input Styling

The 4-digit code input should look like individual boxes:
- 4 square input boxes, 48px × 48px each
- Large centered font (24px, monospace)
- 8px gap between boxes
- Focused box gets primary border color
- Auto-advance: when a digit is typed, focus moves to next box
- Backspace: when empty box, focus moves to previous box

---

## Step 6: Extension-Side Error Handling

Handle these scenarios gracefully:

1. **Server unreachable** — Show "Cannot connect to server. Check the URL and try again."
2. **Invalid code** — Show "Invalid or expired code. Get a new code from PRM settings."
3. **Session revoked** — Auto-detect via ping failure, show reconnect flow
4. **Network timeout** — Show "Request timed out. Check your connection."
5. **Server error (500)** — Show "Server error. Please try again later."

---

## Step 7: Build & Package

1. Create placeholder icons (16x16, 48x48, 128x128 PNG)
2. Test locally: `chrome://extensions` → Developer mode → Load unpacked
3. Test the complete flow:
   - Enter server URL → verify ping works
   - Enter 4-digit code from PRM settings page
   - Verify session is created
   - Test search functionality
   - Test disconnect flow
   - Test session revocation from PRM settings
   - Test that ping keeps session alive

---

## API Reference (PRM Host Endpoints)

### `GET /api/v1/ping`
Health check. No auth required.
```json
Response: { "status": "ok", "version": "1.4.0", ... }
```

### `POST /api/extension-auth/verify`
Verify 4-digit pairing code. No auth required.
```json
Request:  { "code": "1234" }
Response (201): { "sessionToken": "abc123...", "sessionId": "uuid", "createdAt": "..." }
Response (401): { "error": "Invalid or expired code" }
```

### `POST /api/extension-auth/ping`
Keep session alive. Requires `X-Extension-Token` header.
```json
Header: X-Extension-Token: <session-token>
Response (200): { "success": true, "lastAccessedAt": "..." }
Response (401): { "error": "Invalid extension token" }
```

### `GET /api/search?q={query}`
Search contacts. Requires `X-Extension-Token` header.
```json
Header: X-Extension-Token: <session-token>
Response: [{ "id": "...", "firstName": "...", "lastName": "...", ... }]
```

**Note:** The search endpoint (`/api/search`) will need to be updated on the PRM host to also accept `X-Extension-Token` header as an alternative authentication method. Currently it only supports session-based auth. This is a host-side change that should be made to support extension-based search.
