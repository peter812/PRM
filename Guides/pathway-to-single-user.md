# Pathway back to Single-User PRM

Reverses `Guides/pathway-to-multi-user.md`. PRM keeps one login account; all
ownership, visibility, roles, and admin features go away.

**Decisions (2026-10-02)**

- Keep login (password/SSO, API keys, Chrome extension) — exactly one user.
- Other accounts in prod: **delete them and their data**.
- **Drop** the ownership columns from schema and database (no dormant cruft).

**Estimate:** ~1.5–2 working days with Claude (≈4–6 days by hand).

---

## 1. Inventory

### 1.1 Columns to drop

| Table | Columns | Notes |
|---|---|---|
| `people` | `created_by_user_id`, `visibility`, `user_id` | `user_id` marks "Me" → replace with `app_settings.me_person_id` |
| `interactions`, `groups`, `social_accounts`, `insights`, `conversations` | `created_by_user_id`, `visibility` | via `sharedOwnership()` |
| `relationships`, `photos` | `created_by_user_id` | attribution only |
| `osint_scans` | `requested_by_user_id` | |
| `notes`, `daily_notes`, `ai_chats`, `tasks`, `image_tasks`, `image_task_groups` | `user_id` (+ `*_user_id_idx`, `*_user_id_status_idx`) | |
| `face_pair_dismissals` | `user_id` | dismissals become global; dedupe on pair before dropping |
| `users` | `role` | |
| `user_settings` | whole table | not read anywhere at runtime today — just drop |

### 1.2 Columns to keep

`api_keys.user_id`, `sso_config.user_id`, `extension_sessions.user_id`,
`extension_auth_codes.user_id` — auth plumbing that points at the single
account. Removing them buys nothing and would mean reworking login.

### 1.3 Code to delete or simplify

- `server/access.ts` (`AccessContext`, `runAsUser`, `runAsSystem`,
  `visibleShared`, `ownedByCurrentUser`, `actingUserId`, `canRead*`,
  `accessMiddleware`) — ~180 call sites:
  `storage.ts` (79), `task-worker.ts` (14), `routes/pending-imports.ts` (11),
  `face-review.ts` (8), `routes/tracking.ts` (6), `routes/tps.ts`,
  `routes/stories.ts`, `recognition.ts`, `faces.ts` (5 each), and ~13 more
  files with 2–4 each.
- `shared/schema.ts`: `sharedOwnership()`, `Visibility`, `visibilitySchema`,
  `OwnershipInput`, `UserRole`, `ROLE_RANK`, `isAdminRole`, `canManageUser`,
  `canAssignRole`, the `userId`/`createdByUserId` omits in insert schemas.
- `server/auth.ts`: `adminView` on the session user.
- `server/routes/auth-setup.ts`: `/api/users` CRUD, `/api/admin/view`,
  `requireAdmin`; `/api/me` reads "Me" from `app_settings`.
- `server/db-init.ts`: matching `schemaDefinitions` entries and the
  `user_settings` CREATE.
- Client: `pages/admin-users.tsx`, admin-view toggle (`admin-settings.tsx`,
  `settings-layout.tsx`), role checks in `hooks/use-auth.tsx`, visibility
  toggles (`social-graph-3d.tsx`, `family-tree-explorer.tsx`,
  `person-flow-tab.tsx`, settings pages), sidebar/route entries for admin pages.

Keep: `DISABLE_AUTH` dev bypass in `server/index.ts` (mock user id 1).

---

## 2. Phases

### Phase 0 — Prep (~30 min)

1. Commit the current working tree on its own branch first (large uncommitted
   tree + concurrent sessions — never stash/revert).
2. `pg_dump` the production DB.
3. Identify the primary user id (`MAIN`) and report row counts per table owned
   by other users before anything is deleted.

### Phase 1 — Neutralize access layer (~1 hr, no schema change)

Make `visibleShared`/`ownedByCurrentUser` return `undefined`, `canRead*`
return `true`, `runAsUser`/`runAsSystem` just call `fn`. App is functionally
single-user immediately; deploy point to confirm nothing regresses.

### Phase 2 — Data migration (~1 hr, one SQL script in `migrations/`)

Run in a transaction:

1. Delete other users' private shared-table rows:
   `DELETE FROM <people|interactions|groups|social_accounts|insights|conversations>
    WHERE visibility = 'private' AND created_by_user_id <> MAIN;`
   (children of conversations/people go via existing FK cascades — verify.)
2. Public rows other users created are **kept** (they were already visible to
   you). Flip this if you'd rather purge them too.
3. Save "Me": `INSERT INTO app_settings (key, value)
   SELECT 'me_person_id', id FROM people WHERE user_id = MAIN;`
4. Dedupe `face_pair_dismissals` across users.
5. `DELETE FROM users WHERE id <> MAIN;` — cascades notes, daily_notes,
   ai_chats, tasks, image_tasks, image_task_groups, api_keys, sso_config,
   extension sessions of other users.
6. Drop indexes, then `ALTER TABLE … DROP COLUMN` for everything in §1.1;
   `DROP TABLE user_settings;`

`validateAndSyncSchema` only adds columns, so the drop must be this explicit
script; update `schemaDefinitions` in the same change or it will re-add them.

### Phase 3 — Server cleanup (~4–6 hrs)

1. Remove ownership fields from `shared/schema.ts` and `db-init.ts`.
2. Remove access helpers from `storage.ts` method by method; drop `userId`
   params from storage methods, workers (`task-worker`, `stories-scheduler`,
   `osint-scan-queue`, `tracking`, face pipeline), vector sync, AI tools.
3. Inserts stop setting `userId`/`createdByUserId`/`requestedByUserId`.
4. Delete `server/access.ts`, admin routes, role helpers, `adminView`.
5. `getMePerson()` reads `app_settings.me_person_id`.
6. `tsc` clean.

### Phase 4 — Client cleanup (~2–3 hrs)

Delete admin users page + routes/sidebar entries, admin-view toggle,
visibility toggles, owner badges, role checks. `useAuth` keeps login state
only.

### Phase 5 — Verify (~2 hrs)

- `npm run check` / typecheck.
- Fresh DB boot (db-init creates the trimmed schema) and migrated-DB boot.
- Click through: people, person profile + "Me", social accounts/tracking,
  faces/face review, tasks/image tasks, stories, messages, AI chat, daily
  notes, OSINT, imports, settings.
- Background workers run a cycle without errors; Chrome extension and API
  key auth still work.

---

## 3. Risks

- **Irreversible data deletion** in Phase 2 — the `pg_dump` is the rollback.
- **FK cascades** may reach further than expected (e.g. people → notes of the
  main user referencing a deleted private person). Dry-run the script against
  a restored copy and diff row counts first.
- **Concurrent sessions** editing `storage.ts`/routes — do Phase 3 in one
  focused pass to avoid merge pain.
