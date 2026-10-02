# OSINT on the Tracking page, and a Demo run in OSINT settings

## Decisions (Q&A, 2026-10-02)

- **Tool picker moves to the Tracking page.** The existing multi-select stays as it is (setting `osint_auto_scan_tools`, default `sherlock`), and it remains the only tool list:
  - auto-scans use it;
  - **Run scan** on the chip dialog and the account card uses it;
  - the new bulk queue uses it.
- **Bulk queue skips** any account already scanned by the same tool in the last **120 days**, and any account already queued or running for that tool.
- **Bulk queue covers every social account type**, not just Instagram, and any signed-in user can run it on the accounts they can see. "None and above" means every account.
- **Yearly sweep:** an admin toggle (`osint_yearly_scan_enabled`). Once an hour it queues every account that a picked scanner hasn't scanned, and hasn't failed on, in the last 365 days.
- **As built:** the OSINT card sits after "Account tracking". The Demo run lives in `client/src/components/osint-demo-run.tsx`. `enqueueOsintScans` now passes arrays as one `string_to_array` parameter and casts `sa.id::text`. Before this fix the query errored, so auto-scans never queued anything.
- **Demo run** reuses the old demo page's full result view: status, cancel, hit list and extra fields.

## 1. Tracking page: new "OSINT" card (`client/src/pages/social-tracking.tsx`)

Added as the last card on the page, `OsintTrackingCard`:

- **Scanners:** checkboxes for every tool that takes usernames (`USERNAME_TOOLS`). They save `osint_auto_scan_tools` through `POST /api/settings`, using the same code moved over from OSINT settings.
- **Bulk queue:** the row reads "Queue every account with tracking level [select] and above", followed by a **Queue** button.
  - The level select lists `INTEREST_LEVELS` except `none`, each with its color dot. It defaults to `high`.
  - The button calls `POST /api/osint/scan-queue/level { level }` and then shows a toast: "Queued N scans" or "Nothing to queue: all scanned in the last 120 days".
- A link to **OSINT Tasks** (`/settings/tasks/osint`) for watching the queue.
- If PRM-Compute isn't configured, the controls are disabled and a one-line note links to settings. This uses `/api/osint/status`, which is already queried elsewhere.

## 2. Server

- **`storage.getSocialAccountIdsAtLevels(levels: string[])`** (new) returns the ids of visible social accounts whose `interest_level` is in `levels`. There's already an index on `interest_level`, and imports cap out around 10k, so returning ids is fine.
- **`queueOsintScansForLevel(level, userId)`** (new, `osint-scan-queue.ts`):
  1. takes the levels from `level` upward in `INTEREST_LEVELS`;
  2. gets their account ids;
  3. calls the existing `storage.enqueueOsintScans(ids, scanTools(), userId, 120)`, which already skips by tool and recent insight and uses `ON CONFLICT DO NOTHING`;
  4. calls `wakeOsintRunner()` and returns the count.
- **`POST /api/osint/scan-queue/level`** (new, `requireAdmin` like `/backfill`):
  - checks that `level` is one of `INTEREST_LEVELS` and isn't `none`;
  - calls `requireConfigured`;
  - returns `{ queued }`.
- The 120-day window applies only to the bulk queue. Auto-scans keep their 30 days.

## 3. Remove OSINT from Demos

- Delete `client/src/pages/osint-demo.tsx`.
- `App.tsx`: drop the `OsintDemoPage` lazy import and the `/demos/osint/:tool` route.
- `app-sidebar.tsx`: drop the code that adds OSINT tools under Demos, plus its `/api/osint/status` query and `OSINT_TOOLS` import if nothing else uses them.
- `demos.tsx`: drop the "OSINT Tools" section, the status query and the import.

## 4. OSINT settings (`client/src/pages/osint-settings.tsx`)

- **Automatic OSINT Scans** card:
  - the Tools checkboxes come out (they move to Tracking);
  - in their place goes one line, "Scans use the tools picked on the **Tracking** page", linking to `/social-accounts/tracking`;
  - the toggle, counts, "Queue my network now" and View tasks stay.
- New **Demo run** card (`OsintDemoRunCard`), most of it moved from `osint-demo.tsx`:
  - **Scanner** select (all `OSINT_TOOLS`), defaulting to `sherlock`;
  - **Target type** select (Username / Email), shown only when the chosen scanner supports more than one type. It resets to the tool's first type when the scanner changes;
  - **Target** input, whose label and placeholder follow the type, then a **Go** button (Enter also submits);
  - **Results:**
    - the job status badge and a Cancel button;
    - `ResultView`, moved in as-is;
    - polled once a second while the job runs, as today.
  - It uses the existing `POST /api/osint/scans`, `GET /api/osint/scans/:id` and `DELETE /api/osint/scans/:id`, so no server changes are needed. Demo scans stay ownerless and still show up in OSINT Tasks.

## 5. Verify

- `npx tsc --noEmit`.
- **Tracking page:** toggle a tool and check it persists, and that OSINT settings no longer shows the checkboxes. Bulk queue at `extreme` (smallest set):
  - the toast count matches the rows in OSINT Tasks;
  - clicking again queues 0.
- **Demos page and sidebar:** no OSINT entries, and `/demos/osint/sherlock` falls through to the 404.
- **OSINT settings → Demo run:** the type selector shows for blackbird but not sherlock. A short username run reaches done and the results render.
- Running real scans calls PRM-Compute, so pick a small level and a single tool.
