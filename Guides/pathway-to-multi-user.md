# Pathway to Multi-User PRM

This document is a planning guide for evolving PRM from its current
"effectively single-user" deployment into a true multi-user application
where:

- Every user has their **own private experience** (notes, interactions,
  daily notes, AI chats, tasks, dashboard, settings).
- Certain heavy / collaborative entities (**contacts / people** and
  **social accounts** plus everything attached to them: profile
  versions, network state, posts, photos) are **shared across all
  users by default**.
- Any shared entity can be flagged **private to a single user** so that
  it (and the data it transitively reveals) is only visible to its
  owner.

It is meant to be read top-to-bottom as both an architectural design
and a phased implementation plan. It does **not** prescribe code
snippets — it describes *what* needs to change and *why*.

---

## 1. Where the codebase is today

PRM already ships with most of the building blocks for multi-user, but
the data model and authorization layer assume that every authenticated
user can see every row.

### 1.1 Auth and sessions (already in place)

- `server/auth.ts` configures Passport with a local username/password
  strategy, scrypt password hashing, and `express-session` backed by
  `storage.sessionStore`.
- `setupAuth(app)` registers `/api/register`, `/api/login`,
  `/api/logout`, `/api/user`.
- A `requireAuth` middleware exists but is **not applied globally**;
  individual routes either call `req.isAuthenticated()` themselves or
  read `req.user` directly.
- `server/index.ts` contains a `DISABLE_AUTH=true` dev bypass that
  injects a mock user `{ id: 1, username: 'dev' }`. Anything we do must
  preserve this bypass (it is explicitly documented as "do not
  remove").
- SSO (OAuth2/OIDC) is configurable per-user via the `sso_config`
  table.

### 1.2 Tables that already carry a `user_id`

From `shared/schema.ts`:

- `users`
- `api_keys` (`user_id` not null)
- `sso_config` (`user_id` not null, unique)
- `people` (`user_id` **nullable** — currently used only to mark the
  "Me" person for a given user)
- `extension_sessions`, `extension_auth_codes`
- `ai_chats`

### 1.3 Tables with **no** ownership column today

These are the tables that must be touched to introduce sharing +
privacy:

- `notes`, `interactions`, `interaction_types`
- `relationships`, `relationship_types`
- `groups`, `group_notes`
- `social_accounts`, `social_account_types`,
  `social_profile_versions`, `social_network_state`,
  `social_network_changes`, `social_account_posts`
- `photos`
- `daily_notes`, `daily_note_events`, `daily_note_involved_parties`
- `tasks`, `image_tasks`
- `app_settings` (key/value store — currently global; e.g. Ollama
  settings are stored here under `ollama_*` keys)

### 1.4 Storage / repository layer

`server/storage.ts` (~3k lines) exposes a `storage` singleton with
methods like `getAllPeople()`, `getNotesForPerson(personId)`,
`getAllSocialAccounts()`, etc. **Almost none of these accept a
`userId`** — they return all rows. Routes call them directly and trust
whoever is logged in.

### 1.5 Background workers

- `server/task-worker.ts` polls the `tasks` and `image_tasks` tables
  and processes them with no user context.
- `server/vector.ts` syncs `daily_notes` to Qdrant globally.
- AI tools in `server/ai-tools.ts` operate on the whole dataset.

### 1.6 Client

- `client/` is a single-page React app. There is a login page and a
  `/api/user` query, but the rest of the UI assumes "all data is
  mine". There is no concept of "owner" or "shared with me" anywhere
  in the UI.

### 1.7 DB initialization

Per repository convention (see `server/db-init.ts`'s
`validateAndSyncSchema`), every new table or column must be added in
**two places**: the Drizzle schema in `shared/schema.ts` *and* a raw
`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` in `server/db-init.ts`. The migration plan below assumes this
pattern.

---

## 2. Target model

### 2.1 Three classes of data

We will partition every domain table into one of three buckets:

1. **User-private (always)** — only the owning user can ever see or
   modify the row.
   - `notes` (per-person notes), `daily_notes` and children,
     `interactions`, `ai_chats`, `tasks`, `image_tasks`, `app_settings`
     scoped to a user, `api_keys`, `extension_sessions`, `sso_config`,
     dashboard / UI preferences, follow-up reminders, etc.

2. **Shared by default, optionally private** — visible to every
   authenticated user unless the owner marks it private.
   - `people` (contacts), `social_accounts`, and everything that hangs
     off a social account: `social_profile_versions`,
     `social_network_state`, `social_network_changes`,
     `social_account_posts`.
   - Profile photos and post images stored in `photos` follow the
     visibility of their parent (`prm_location` already encodes the
     parent kind).
   - `relationships` (edges between people) — visible if **both**
     endpoints are visible to the viewer.
   - `groups` and `group_notes` — shared by default but privatable.

3. **Global / system** — readable by everyone, writable only by
   admins.
   - `interaction_types`, `social_account_types`, `relationship_types`
     (taxonomy / lookup tables).
   - Global `app_settings` for instance-wide config (e.g. S3 bucket,
     default model). User-scoped settings move to a new
     `user_settings` table — see §3.4.

### 2.2 Ownership and privacy fields

Every row in the **shared-by-default** bucket grows two columns:

- `created_by_user_id` — non-null FK to `users.id`. Records who
  contributed the row. Drives "show my contacts only" filters and
  attribution in the UI.
- `visibility` — enum: `'public'` (default) or `'private'`. When
  `'private'`, only `created_by_user_id` (and admins, if we add the
  role) may read/write.

Every row in the **user-private** bucket grows:

- `user_id` — non-null FK to `users.id`, on-delete cascade.

We deliberately use *two* columns on shared entities (creator + flag)
rather than reusing `user_id`, so that ownership is preserved when a
contact toggles between public and private.

### 2.3 Optional: per-row ACLs (stretch goal)

For the first iteration, "private" means "only the owner". A future
extension is a `shared_acl` table:

```
shared_acl(entity_type, entity_id, user_id, permission)
```

…allowing a user to share a private contact with a specific other
user. This is **out of scope for v1** but the schema shape above
leaves room for it.

### 2.4 Privacy boundaries (transitive visibility)

Decisions we need to make explicit and document for users:

- A **private person** hides: their `people` row, all their `notes`,
  any `social_accounts` whose `owner_uuid` is that person, and all
  `posts` / `profile_versions` under those accounts. Photos whose
  `prm_location` points at any of the above are hidden.
- A **private social account** hides itself and its descendants but
  does **not** hide the person it belongs to.
- An **interaction** is visible if every person referenced in
  `people_ids` is visible to the viewer; otherwise the whole
  interaction is hidden (we do not show "redacted" interactions in
  v1).
- **Relationships** are visible if both endpoints are.
- **Groups** are visible by their own `visibility` flag; group
  membership lists are filtered by per-person visibility.
- The **graph view** and search results must apply the same filters as
  the list views.

These rules need to be implemented as **central authorization
helpers** (see §4.2) so they cannot drift between endpoints.

---

## 3. Schema changes

For every change below, remember the dual-write convention: update
`shared/schema.ts` **and** add a corresponding `ALTER TABLE` /
`CREATE TABLE` in `server/db-init.ts validateAndSyncSchema()`.

### 3.1 New columns on shared-by-default tables

Add `created_by_user_id INTEGER NOT NULL REFERENCES users(id)` and
`visibility TEXT NOT NULL DEFAULT 'public'` to:

- `people`
- `social_accounts`
- `groups`
- `relationships`

Children inherit visibility from their parent and therefore **do not
need their own `visibility` column**: `notes` already references
`people`, `social_profile_versions`, `social_network_state`,
`social_network_changes`, `social_account_posts` already reference
`social_accounts`, and `group_notes` references `groups`. Only add a
`created_by_user_id` to children (for attribution and "my notes only"
filters).

### 3.2 New columns on user-private tables

Add `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
to:

- `notes` (the per-person notes a single user writes)
- `interactions`
- `daily_notes` (and cascade naturally to children via `daily_note_id`)
- `tasks`, `image_tasks`
- `ai_chats` (already has it)

Decide policy for `interactions`: in many CRMs, "interaction" is also
something you log on someone else's behalf. For v1 the simplest model
is *interactions are per-user logs about shared people*, i.e. each
user sees their own interaction history. If the team wants
collaborative interaction logs, treat `interactions` as
shared-by-default instead.

### 3.3 Photos

`photos` is a registry shared by many entities. Two options:

- **A (recommended):** add `created_by_user_id` only. Visibility is
  derived from the parent referenced by `prm_location` (e.g. a photo
  whose `prm_location = "post:<uuid>"` follows the post → social
  account → optional privacy).
- **B:** also add an explicit `visibility` flag. Necessary only if we
  want users to upload "private profile photos" that aren't tied to a
  privatable parent.

Pick (A) for v1 unless a clear use-case appears.

### 3.4 New `user_settings` table

Create:

```
user_settings(user_id INT, key TEXT, value TEXT, PRIMARY KEY (user_id, key))
```

…and migrate the per-user keys currently in `app_settings`. The Ollama
settings (`ollama_model`, `ollama_text_model`, `ollama_prompt`) are
the obvious first candidates — see the existing
`getOllamaSetting`/`setOllamaSetting` helpers in `server/routes.ts`
which currently treat them globally.

Keep `app_settings` for genuinely instance-wide configuration (and
have a clear naming convention, e.g. `system.*` vs
`user.<id>.*` if we want to keep one table; a separate table is
cleaner).

### 3.5 Admin role

Add `users.role TEXT NOT NULL DEFAULT 'user'` with values
`'user' | 'admin'`. Used to gate:

- writing to global lookup tables (`interaction_types`,
  `social_account_types`, `relationship_types`).
- editing instance-level `app_settings`.
- creating other users (if we close registration — see §5.1).
- impersonation / support tools.

### 3.6 Migration from existing data

A single deployment today is "user 1 owns everything". The migration
must:

1. Pick a "primary" user (the first user in `users`, or the user
   referenced by the existing `people.user_id` of the Me-person).
2. Backfill `created_by_user_id = primary` and `visibility = 'public'`
   on every shared-by-default row.
3. Backfill `user_id = primary` on every user-private row.
4. Migrate per-user keys out of `app_settings` into `user_settings`
   for the primary user.

This must run **inside `validateAndSyncSchema`** (or a one-shot
migration step it calls) so that an existing deployment upgrading in
place ends up with a self-consistent database.

---

## 4. Server changes

### 4.1 Auth enforcement

- Apply `requireAuth` (or a wrapper) to **every** `/api/*` route
  except `/api/login`, `/api/register`, `/api/user`, the SSO callback,
  health checks, and the public extension auth-code exchange.
- Audit every route that reads `req.user` defensively (`if (!req.user)
  return 401`) — once `requireAuth` is global these checks become
  redundant but should be left in place as a defense-in-depth.
- Keep the `DISABLE_AUTH=true` dev bypass intact; it must continue to
  produce a real `users.id = 1` row (seed it on init when the bypass
  is on).

### 4.2 A central authorization layer

Introduce a thin module (e.g. `server/access.ts`) that exposes
helpers like:

- `canRead(user, entityType, row): boolean`
- `assertCanWrite(user, entityType, row): void` (throws 403)
- `visiblePeopleFilter(user)` → a Drizzle SQL fragment to AND into
  queries (`visibility = 'public' OR created_by_user_id = :uid`).
- `visibleSocialAccountFilter(user)` likewise.
- `assertOwnsPrivate(user, row)` for user-private resources.

**Every** storage method that returns shared-by-default data must
accept the current user and apply the filter. Every method that
returns user-private data must take a `userId` and filter on it.
This is the single biggest mechanical change in the codebase —
`server/storage.ts` will need a method-by-method audit.

Suggested refactor pattern:

- Change signatures from `getAllPeople()` to `getAllPeople(viewer:
  User)`.
- Change `getNotesForPerson(personId)` to `getNotesForPerson(viewer:
  User, personId)` and return only the viewer's own notes (since notes
  are user-private).
- Add `listMyContacts(viewer)` and `listAllVisibleContacts(viewer)`
  if both views are needed.

### 4.3 Route changes

For each route, decide:

- Which entity does it touch?
- Is the entity shared-by-default or user-private?
- Does the action require ownership (write / delete / toggle privacy)
  or just visibility (read)?

Then thread `req.user.id` into the storage call and let the access
layer enforce the rule. Reject with 403 (not 404) when the user is
authenticated but not allowed; reject with 404 only when the row
genuinely does not exist for them (this is a deliberate
information-leak trade-off — pick one and be consistent).

### 4.4 Privacy toggle endpoints

New endpoints (or fields on existing PATCH endpoints):

- `PATCH /api/people/:id { visibility }` — only the creator may
  toggle.
- `PATCH /api/social-accounts/:id { visibility }` — only the creator.
- `PATCH /api/groups/:id { visibility }` — only the creator.

Toggling does **not** retroactively delete other users' caches /
references; it just hides on read.

### 4.5 Background workers

`server/task-worker.ts` and `server/vector.ts` need to:

- Persist the originating `user_id` on every queued task so that
  results land in the right user's view.
- For vector sync: namespace Qdrant collections per user (e.g.
  `daily_notes_<userId>`) **or** add a `user_id` payload field and
  filter on it at query time. The latter is simpler.
- For AI tools (`server/ai-tools.ts`): every tool that reads PRM data
  must do so as the calling user, so the model only sees rows that
  user is allowed to see. This is critical — leaking another user's
  private contact through an AI answer is the worst-case failure mode.

### 4.6 External API & extension

- `api_keys` already carry `user_id`. Make sure every API-key auth
  path sets `req.user` to that user before downstream code runs.
- Same for `extension_sessions`. The Chrome extension should never
  see another user's data.
- Document in `PRM-external-API-guide.md` that every API key acts as
  the issuing user and is subject to the same visibility rules.

### 4.7 Exports

`exports/` and any "export everything" endpoints must be filtered the
same way list endpoints are — never dump rows the caller cannot see.

---

## 5. Client changes

### 5.1 Account & registration

- Decide whether registration is open, invite-only, or admin-only. A
  simple v1 is "first user becomes admin; admin can create more from
  Settings → Users".
- Settings page gains a **Users** section (admin only): list, create,
  reset password, deactivate.
- Settings page gains a **My account** section: change name, change
  password, link SSO.

### 5.2 Owner & visibility UI

- Every shared-by-default entity (Person card, Social Account card,
  Group card) gains a small **owner badge** ("Added by @alice") and a
  **lock icon** when private.
- Edit dialogs gain a **Visibility** control (Public / Private to me).
  Disabled unless `viewer.id === created_by_user_id` (or admin).
- A global filter in list views: **All / Mine / Private**. Default to
  **All** for shared lists.

### 5.3 Per-user views

- Notes, interactions, daily notes, AI chats, tasks, dashboard
  widgets, follow-ups — all driven by `viewer.id` server-side, no
  client-side switching needed.
- The "Me" person resolution (currently the single
  `people.user_id IS NOT NULL` row) becomes per-user: each user has
  their own Me-person, and graph centering / "you" highlighting uses
  it.

### 5.4 Graph & search

- The force-graph view must request data scoped to the viewer; nodes
  and edges that fail the visibility check are simply omitted.
- Search results, autocomplete, and AI chat suggestions must apply
  the same filter — the easiest correctness guarantee is to do it in
  the server-side query, not in the React layer.

### 5.5 Avatars and attribution

- Show the creator's avatar/initials on shared entities.
- "Created by you" vs "Created by Alice" copy in tooltips.

---

## 6. Cross-cutting concerns

### 6.1 Sessions and concurrency

- `express-session` is already configured. Make sure the session
  store (currently `storage.sessionStore`) is a real DB-backed store
  in production (not memory) so multiple users on multiple browsers
  don't trample each other.
- `SESSION_SECRET` rotation: document that rotating it logs everyone
  out. Consider keyed list for graceful rotation.

### 6.2 Rate limiting

`server/middleware/rate-limit.ts` currently rate-limits per IP.
Switch to **per `req.user.id` when authenticated**, falling back to
IP for anonymous endpoints. Otherwise one heavy user starves the
others.

### 6.3 Storage / S3

- `imageStorageMode` is already per-user (`users.image_storage_mode`).
  Confirm that the `local-storage.ts` and `s3.ts` paths correctly
  segregate uploads — at minimum, prefix S3 keys with `u<userId>/`
  for user-private images and `shared/` for shared ones.
- Consider per-user S3 quotas if abuse is a concern.

### 6.4 Logging and audit

- Add a lightweight `audit_log(user_id, action, entity_type,
  entity_id, at)` table. Useful for debugging "who deleted my
  contact" once multiple humans share the data.
- Include `request_id` (already in `requestIdMiddleware`) and
  `user_id` in every log line emitted from `server/index.ts`'s
  request logger.

### 6.5 Tests and seed data

- Add a multi-user fixture: two users, a public contact, a private
  contact, a private social account on a public person, etc.
- Add integration tests that authenticate as user B and assert they
  cannot see user A's private rows via list, get-by-id, search, the
  graph endpoint, the export endpoint, **and** the AI chat tool
  endpoints.
- Negative tests for the privacy toggle: user B cannot flip user A's
  contact private→public.

### 6.6 Documentation

- Update `README.md` and `QUICKSTART.md` to describe the multi-user
  model and the admin bootstrap.
- Update `PRM-external-API-guide.md` to document per-key user
  scoping.
- Update `replit.md` / `DOCKER.md` env-var sections with any new
  knobs (`REGISTRATION_MODE`, `BOOTSTRAP_ADMIN_USERNAME`, etc.).
- Update `design_guidelines.md` with the owner-badge / visibility
  conventions.

### 6.7 GDPR-adjacent concerns

- "Delete my account" must cascade through user-private rows
  (already covered by `ON DELETE CASCADE`) but must also decide what
  to do with **shared rows the user created**:
  - Reassign to an `archived` system user, or
  - Mark them orphaned (`created_by_user_id = NULL`) and read-only.
- Export-my-data endpoint should return everything the user owns or
  created.

---

## 7. Phased rollout plan

The work above is large. Recommended order:

**Phase 0 — Prep**

1. Lock the spec in this document; get sign-off on the visibility
   rules in §2.4.
2. Add `users.role`, seed a single admin from the existing primary
   user.

**Phase 1 — Schema & migration (no behavior change)**

3. Add `created_by_user_id` + `visibility` to shared tables.
4. Add `user_id` to user-private tables that lack it.
5. Backfill from the primary user.
6. Add `user_settings`; migrate per-user keys.
7. Deploy. Everything still works because every row is owned by user
   1 and `visibility='public'`.

**Phase 2 — Server enforcement**

8. Build `server/access.ts` and the central filters.
9. Refactor `server/storage.ts` method by method to accept a viewer.
10. Apply `requireAuth` globally.
11. Update background workers, vector sync, AI tools, external API,
    extension to be user-scoped.
12. Add tests (§6.5).

**Phase 3 — Client UX**

13. Add owner badges, lock icons, visibility toggles, per-user "Me"
    handling.
14. Add admin Users page; add registration / SSO flows for new
    accounts.
15. Per-user dashboards, AI chat history, daily notes, etc.

**Phase 4 — Polish**

16. Per-user rate limiting, S3 prefixing, audit log.
17. Account deletion / data export.
18. (Stretch) `shared_acl` for selective sharing.

Each phase is independently shippable and reversible.

---

## 8. Open questions to resolve before coding

1. Are **interactions** per-user logs or collaborative?
2. Are **groups** owned by a user or jointly editable by all
   members?
3. Do we need **per-user "Me" graph centering** in v1, or is the
   current single-Me UX acceptable?
4. Closed registration vs open? (Affects landing page.)
5. When a contact is privatized, do **other users' interactions /
   notes** that referenced it become hidden, or do we forbid
   privatizing a contact that other users have written about?
6. Photos: option (A) inherited visibility, or (B) explicit
   `visibility` column?
7. Do API keys inherit the issuer's visibility rules verbatim, or do
   we want a "scoped" key that can only see public data?
8. Vector store: per-user collection vs payload-filter — pick now to
   avoid a re-index later.

Resolving these questions is the first concrete deliverable before
any schema change is merged.
