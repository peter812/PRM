# Pathway to Multi-User PRM

This document is a planning guide for evolving PRM from its current
"effectively single-user" deployment into a true multi-user application
where:

- Every user has their **own private experience** (notes, interactions,
  daily notes, AI chats, tasks, dashboard, settings, conversations, messages).
- Certain heavy / collaborative entities (**contacts / people** and
  **social accounts** plus everything attached to them: profile
  versions, network state, posts, photos, lineage/family trees, face recognition matches) are **shared across all
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
- `setupAuth(app)` registers `/api/login`, `/api/logout`, `/api/user`.
  (There is intentionally no open `/api/register`; account creation goes
  through the guarded `/api/setup/initialize`.)
- A `requireAuth` middleware exists but is **not applied globally**;
  individual routes either call `req.isAuthenticated()` themselves or
  read `req.user` directly.
- There is no auth bypass. A `DISABLE_AUTH=true` dev flag used to inject a
  mock user `{ id: 1, username: 'dev' }`; it was removed during the
  multi-user conversion because a mock `req.user` is not a real row, and
  the per-user visibility filters assume it is.
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
- `conversations` (`user_id` **nullable** — handles ownership for unified message channels, but authorization is not globally enforced)

### 1.3 Tables with **no** ownership column today

These are the tables that must be touched to introduce sharing +
privacy:

- `notes`, `interactions`, `interaction_types`
- `relationships`, `relationship_types`
- `lineage`, `partnerships`, `schooling` (representing React Flow family tree visualization data)
- `groups`, `group_notes` (crowds features)
- `social_accounts`, `social_account_types`,
  `social_profile_versions`, `social_follows`,
  `social_network_changes`, `social_account_posts`
- `photos`
- `faces`, `image_questions` (facial recognition bounding boxes, embeddings, and unrecognized face assignment queues)
- `daily_notes`, `daily_note_events`, `daily_note_involved_parties`, `daily_note_audit_logs`
- `tasks`, `image_tasks` (task tracking queue)
- `app_settings` (key/value store — currently global; e.g. Ollama settings are stored here under `ollama_*` keys)
- `app_knowledge` (application documentation chunks for internal AI tool usage)
- `true_person_search` (TPS records scraped from Chrome extension)
- `sex_guess_queue` (queue for LLM-generated gender guesses)
- `messages`, `message_recipients`, `conversation_participants` (these thread under `conversations`, which has a nullable `userId`, but the child tables themselves have no ownership checks)

### 1.4 Storage / repository layer

`server/storage.ts` exposes a `storage` singleton with methods like `getAllPeople()`, `getNotesForPerson(personId)`, `getAllSocialAccounts()`, etc. **Almost none of these accept a `userId`** — they return all rows. Routes call them directly and trust whoever is logged in.

### 1.5 Background workers

- `server/task-worker.ts` polls the `tasks` and `image_tasks` tables and processes them with no user context. It also runs background sync utilities, Instagram DM scrapers, and TruePeopleSearch imports.
- `server/vector.ts` and `server/vector-universal.ts` sync `daily_notes`, `ai_chats`, `conversations`, `messages`, and `groups` to Qdrant.
- Facial recognition worker (`prm-face` pipeline) handles face extraction, embeddings matching, and automatic linkage with no user separation.
- AI tools in `server/ai-tools.ts` operate on the whole dataset.

### 1.6 Client

- `client/` is a single-page React app. There is a login page and a `/api/user` query, but the rest of the UI assumes "all data is mine".
- Significant new UI features include:
  - **OSINT Dashboard** (`/osint`): dashboard widgets, task tracking, intelligence settings, and unknown face resolution views.
  - **Family Tree page**: React Flow-based interactive visualization using lineage/partnership edges.
  - **Unified Messaging interface** (`/messages`): displays multi-channel message histories, attachments, and participant sheets, with embeds directly inside Person and Social Account tabs.
  - **Global search**: autocomplete and vector-based AI search.
- There is currently no concept of "owner" or "shared with me" in these new features.

### 1.7 DB initialization

Per repository convention (see `server/db-init.ts`'s `validateAndSyncSchema`), every table or column must be defined in **two places**: the Drizzle schema in `shared/schema.ts` *and* the `schemaDefinitions` record mapping in `server/db-init.ts`. During server startup, `validateAndSyncSchema` checks this dictionary and dynamically runs `ALTER TABLE ... ADD COLUMN` statements to sync schemas. The migration plan below assumes this pattern.

---

## 2. Target model

### 2.1 Three classes of data

We will partition every domain table into one of three buckets:

1. **User-private (always)** — only the owning user can ever see or modify the row.
   - `notes` (per-person notes), `daily_notes` and children (daily note events, involved parties, audit logs), `ai_chats`, `tasks`, `image_tasks`, `app_settings` scoped to a user, `api_keys`, `extension_sessions`, `sso_config`, dashboard / UI preferences, follow-up reminders.

2. **Shared by default, optionally private** — visible to every authenticated user unless the creator marks it private.
   - `people` (contacts), `social_accounts`, and everything that hangs off a social account: `social_profile_versions`, `social_follows`, `social_network_changes`, `social_account_posts`.
   - `interactions` — logged activity is a collaborative history on a shared contact (see §8, decision on §3.2).
   - `lineage`, `partnerships`, `schooling` (family tree structure and contact educational history).
   - Profile photos and post images stored in `photos` follow the visibility of their parent (`prm_location` already encodes the parent kind).
   - `faces` and `image_questions` (facial recognition bounding boxes, crops, and face resolution queues) inherit visibility from their parent photo.
   - `true_person_search` and `sex_guess_queue` records inherit visibility from the `people` contact record they reference.
   - `relationships` (edges between people) — visible if **both** endpoints are visible to the viewer.
   - `groups` and `group_notes` (crowds features) — shared by default but privatable.
   - `conversations` and their threaded content (`messages`, `message_recipients`, `conversation_participants`) — same column shape as the rest of this bucket, but `visibility` defaults to `'private'`. See §8.1.

3. **Global / system** — readable by everyone, writable only by admins.
   - `interaction_types`, `social_account_types`, `relationship_types` (taxonomy / lookup tables).
   - `app_knowledge` (global documentation vectors for the AI system).
   - Global `app_settings` for instance-wide config (e.g. S3 bucket, default LLM model). User-scoped settings move to a new `user_settings` table — see §3.4.

### 2.2 Ownership and privacy fields

Every row in the **shared-by-default** bucket grows two columns:

- `created_by_user_id` — non-null FK to `users.id`. Records who contributed the row. Drives "show my contacts only" filters and attribution in the UI.
- `visibility` — enum: `'public'` (default) or `'private'`. When `'private'`, only `created_by_user_id` (and admins) may read/write.

Every row in the **user-private** bucket grows:

- `user_id` — non-null FK to `users.id`, on-delete cascade.

We deliberately use *two* columns on shared entities (creator + flag) rather than reusing `user_id`, so that ownership is preserved when a contact toggles between public and private.

### 2.3 Optional: per-row ACLs (stretch goal)

For the first iteration, "private" means "only the owner". A future extension is a `shared_acl` table:

```
shared_acl(entity_type, entity_id, user_id, permission)
```

…allowing a user to share a private contact or conversation with a specific other user. This is **out of scope for v1** but the schema shape above leaves room for it.

### 2.4 Privacy boundaries (transitive visibility)

Decisions we need to make explicit and document for users:

- A **private person** hides: their `people` row, all their `notes`, any `social_accounts` whose `owner_uuid` is that person, their `schooling` details, their family tree edges (`lineage`, `partnerships`), their background search records (`true_person_search`, `sex_guess_queue`), and all `posts` / `profile_versions` under those accounts. Photos whose `prm_location` points at any of the above are hidden.
- A **private photo** hides: itself, its detected faces (`faces`), and unrecognized face assignment queues (`image_questions`).
- A **private social account** hides itself and its descendants but does **not** hide the person it belongs to.
- An **interaction** is visible if its own `visibility` allows it **and** every person referenced in `people_ids` is visible to the viewer; otherwise the whole interaction is hidden (we do not show "redacted" interactions in v1).
- **Relationships**, **lineage**, and **partnerships** are visible if both endpoints are visible.
- **Groups** are visible by their own `visibility` flag; group membership lists are filtered by per-person visibility.
- **Conversations** default to private, so in practice they are visible only to `created_by_user_id` unless deliberately shared. Messages, recipients, and participants always follow the parent conversation.
- The **graph view**, React Flow family tree, and search results must apply the same filters as the list views.

These rules need to be implemented as **central authorization helpers** (see §4.2) so they cannot drift between endpoints.

---

## 3. Schema changes

For every change below, remember the dual-write convention: update the Drizzle schema in `shared/schema.ts` **and** add a corresponding column mapping to `schemaDefinitions` in `server/db-init.ts validateAndSyncSchema()`.

### 3.1 New columns on shared-by-default tables

Add `created_by_user_id INTEGER NOT NULL REFERENCES users(id)` and `visibility TEXT NOT NULL DEFAULT 'public'` to:

- `people`
- `social_accounts`
- `groups`
- `relationships`
- `interactions`
- `conversations` — same columns, but `visibility` defaults to `'private'` (§8.1). The existing nullable `userId` is backfilled into `created_by_user_id` and dropped.

Also add a unique partial index on `people(user_id) WHERE user_id IS NOT NULL` for the per-user Me row (§8.4).

Children/leaves inherit visibility from their parent and therefore **do not need their own `visibility` column**:
- `notes` references `people`.
- `social_profile_versions`, `social_follows`, `social_network_changes`, and `social_account_posts` reference `social_accounts`.
- `group_notes` references `groups`.
- `lineage` and `partnerships` reference `people` endpoints.
- `schooling`, `true_person_search`, and `sex_guess_queue` reference `people`.
- `faces` and `image_questions` reference `photos` (which inherit from posts/people).

Only add `created_by_user_id` to children if explicit creator attribution is required; otherwise, they derive visibility and authorship checks transitively.

### 3.2 New columns on user-private tables

Add `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` to:

- `notes` (the per-person notes a single user writes)
- `daily_notes` (and cascade naturally to children via `daily_note_id`)
- `tasks`, `image_tasks`
- `ai_chats` (already has it)

`interactions` and `conversations` are **not** in this list — both were moved to the shared-by-default bucket (§3.1, §8.1). Interactions are a collaborative log on a shared contact; conversations use the shared column shape with a private default so a thread can be opted into sharing later.

### 3.3 Photos, Faces, and Image Questions

`photos` is a registry shared by many entities. Face matches (`faces`) and unknown face assignment tasks (`image_questions`) map directly to these photos:

- **A (recommended):** Add `created_by_user_id` only to `photos`. Visibility is derived from the parent referenced by `prm_location` (e.g. a photo whose `prm_location = "post:<uuid>"` follows the post → social account → optional privacy). `faces` and `image_questions` transitively inherit visibility from the photo.
- **B:** Also add an explicit `visibility` flag to photos and faces. This is necessary only if we want users to upload "private profile photos" or maintain private facial recognition models that aren't tied to a privatable parent.

Pick (A) for v1 unless a clear use-case appears.

### 3.4 New `user_settings` table

Create:

```
user_settings(user_id INT, key TEXT, value TEXT, PRIMARY KEY (user_id, key))
```

…and migrate the per-user keys currently in `app_settings`. The Ollama settings (`ollama_model`, `ollama_text_model`, `ollama_prompt`) and OSINT intelligence configuration options are the obvious first candidates.

Keep `app_settings` for genuinely instance-wide configuration (such as system-wide microservice connections for face/Ollama endpoints).

### 3.5 Admin role

Add `users.role TEXT NOT NULL DEFAULT 'user'` with values `'user' | 'admin'`. Used to gate:

- writing to global lookup tables (`interaction_types`, `social_account_types`, `relationship_types`).
- editing instance-level `app_settings` (like S3 configs or face API ports).
- creating other users (if we close registration — see §5.1).
- impersonation / support tools.

### 3.6 Migration from existing data

A single deployment today is "user 1 owns everything". The migration must:

1. Pick a "primary" user (the first user in `users`, or the user referenced by the existing `people.user_id` of the Me-person).
2. Backfill `created_by_user_id = primary` and `visibility = 'public'` on every shared-by-default row.
3. Backfill `user_id = primary` on every user-private row (including backfilling conversations, daily notes, tasks, etc.).
4. Migrate per-user keys out of `app_settings` into `user_settings` for the primary user.

This must run **inside `validateAndSyncSchema`** (or a one-shot migration step it calls) so that an existing deployment upgrading in place ends up with a self-consistent database.

---

## 4. Server changes

### 4.1 Auth enforcement

- Apply `requireAuth` (or a wrapper) to **every** `/api/*` route except `/api/login`, `/api/user`, the SSO callback, health checks, and the public extension auth-code exchange.
- Audit every route that reads `req.user` defensively (`if (!req.user) return 401`).
- ~~Keep the `DISABLE_AUTH=true` dev bypass intact.~~ The bypass has been removed; every request authenticates for real.

### 4.2 A central authorization layer

Introduce a thin module (e.g. `server/access.ts`) that exposes helpers like:

- `canRead(user, entityType, row): boolean`
- `assertCanWrite(user, entityType, row): void` (throws 403)
- `visiblePeopleFilter(user)` → a Drizzle SQL fragment to AND into queries (`visibility = 'public' OR created_by_user_id = :uid`).
- `visibleSocialAccountFilter(user)` likewise.
- `visibleConversationFilter(user)` → same shape as the people filter (`visibility = 'public' OR created_by_user_id = :uid`); in practice almost everything is private.
- `assertOwnsPrivate(user, row)` for user-private resources.

**Every** storage method that returns shared-by-default data must accept the current user and apply the filter. Every method that returns user-private data must take a `userId` and filter on it.
This is the single biggest mechanical change in the codebase — `server/storage.ts` will need a method-by-method audit.

Suggested refactor pattern:

- Change signatures from `getAllPeople()` to `getAllPeople(viewer: User)`.
- Change `getNotesForPerson(personId)` to `getNotesForPerson(viewer: User, personId)` and return only the viewer's own notes (since notes are user-private).
- Add `listMyContacts(viewer)` and `listAllVisibleContacts(viewer)` if both views are needed.
- Change message routes: `getConversation(id)` becomes `getConversation(viewer: User, id)` and ensures `conversation.userId === viewer.id`.

### 4.3 Route changes

For each route, decide:

- Which entity does it touch?
- Is the entity shared-by-default or user-private?
- Does the action require ownership (write / delete / toggle privacy) or just visibility (read)?

Then thread `req.user.id` into the storage call and let the access layer enforce the rule. Reject with 403 (not 404) when the user is authenticated but not allowed.

Update new route controllers:
- `server/routes/messages.ts`: thread `req.user.id` to restrict conversation access, message creations, and recipient sheets.
- `server/routes/family.ts`: filter lineage/partnership arrays returned for the React Flow family tree based on endpoint person visibility.
- `server/routes/osint.ts`: restrict task list, widget retrieval, and target processing to the current user's session.
- `server/routes/tps.ts`: filter TruePeopleSearch import requests and results based on the target contact's visibility.

### 4.4 Privacy toggle endpoints

New endpoints (or fields on existing PATCH endpoints):

- `PATCH /api/people/:id { visibility }` — only the creator may toggle.
- `PATCH /api/social-accounts/:id { visibility }` — only the creator.
- `PATCH /api/groups/:id { visibility }` — only the creator.

Toggling does **not** retroactively delete other users' caches / references; it just hides on read.

### 4.5 Background workers & Vector store

- `server/task-worker.ts` and `server/vector.ts` must persist the originating `user_id` on every queued task (like OSINT background fetches or facial recognition photo indexing) so that results land in the right user's view.
- For vector sync (`server/vector-universal.ts`): keep one collection per entity type and add `user_id` + `visibility` payload fields, filtered at query time (§8.9). No per-user collections.
- Face pipeline: resolve a photo's derived visibility *before* enqueuing an embedding job, and skip private ones entirely. Privatizing a person must enqueue an eviction task for their photos' embeddings; re-publishing re-enqueues them (§8.2).
- For AI tools (`server/ai-tools.ts`): Every tool that reads PRM data (including searching `app_knowledge` or checking messages/social posts) must do so as the calling user, so the model only sees rows that user is allowed to see. Leaking another user's private contact through an AI answer is the worst-case failure mode.

### 4.6 External API & extension

- `api_keys` already carry `user_id`. Make sure every API-key auth path sets `req.user` to that user before downstream code runs.
- Same for `extension_sessions` and `true_person_search` imports. The Chrome extension should never write scraped details to a contact unless the user is authorized to edit that contact.
- Document in `PRM-external-API-guide.md` that every API key acts as the issuing user and is subject to the same visibility rules.

### 4.7 Exports

`exports/` and any "export everything" endpoints must be filtered the same way list endpoints are — never dump rows the caller cannot see.

---

## 5. Client changes

### 5.1 Account & registration

- Registration is **admin-only** (§8.5): the first user becomes admin; further accounts are created from Settings → Users with a temporary password. No public signup page, no invites table in v1.
- Settings page gains a **Users** section (admin only): list, create, reset password, deactivate.
- Settings page gains a **My account** section: change name, change password, link SSO.

### 5.2 Owner & visibility UI

- Every shared-by-default entity (Person card, Social Account card, Group card) gains a small **owner badge** ("Added by @alice") and a **lock icon** when private.
- Edit dialogs gain a **Visibility** control (Public / Private to me). Disabled unless `viewer.id === created_by_user_id` (or admin).
- A global filter in list views: **All / Mine / Private**. Default to **All** for shared lists.

### 5.3 Per-user views

- Notes, daily notes, AI chats, tasks, messages, dashboard widgets, follow-ups — all driven by `viewer.id` server-side, no client-side switching needed. Interactions are shared, so they show every user's entries with an attribution badge.
- The "Me" person resolution becomes per-user in v1 (§8.4): each user has their own Me-person, and graph centering / family-tree rooting / "you" highlighting resolve against the viewer's.
- **Messages page**: Thread index list is scoped to the current user's conversations.
- **OSINT Dashboard**: Unknown face resolution queue displays unrecognized faces from photos visible to the user.

### 5.4 Graph & search

- The force-graph view and React Flow family tree must request data scoped to the viewer; nodes and edges that fail the visibility check are simply omitted.
- Search results, autocomplete, and AI chat suggestions must apply the same filter — the easiest correctness guarantee is to do it in the server-side query, not in the React layer.

### 5.5 Avatars and attribution

- Show the creator's avatar/initials on shared entities.
- "Created by you" vs "Created by Alice" copy in tooltips.

---

## 6. Cross-cutting concerns

### 6.1 Sessions and concurrency

- `express-session` is already configured. Make sure the session store (currently `storage.sessionStore`) is a real DB-backed store in production (not memory) so multiple users on multiple browsers don't trample each other.
- `SESSION_SECRET` rotation: document that rotating it logs everyone out. Consider keyed list for graceful rotation.

### 6.2 Rate limiting

`server/middleware/rate-limit.ts` currently rate-limits per IP. Switch to **per `req.user.id` when authenticated**, falling back to IP for anonymous endpoints. Otherwise one heavy user starves the others.

### 6.3 Storage / S3 / Face crops

- `imageStorageMode` is already per-user (`users.image_storage_mode`). Confirm that the `local-storage.ts` and `s3.ts` paths correctly segregate uploads — prefix S3 keys with `u<userId>/` for user-private images/crops and `shared/` for shared ones.
- Ensure cropped face images (used in unknown face queues) inherit user prefix structures if the parent photo is private.

### 6.4 Logging and audit

- Add an `audit_log(user_id, action, entity_type, entity_id, at)` table. Useful for debugging "who deleted my contact" or "who modified this relationship" once multiple humans share the data.
- Include `request_id` (already in `requestIdMiddleware`) and `user_id` in every log line emitted from `server/index.ts`'s request logger.

### 6.5 Tests and seed data

- Add a multi-user fixture: two users, a public contact, a private contact, a private social account on a public person, private messages, private family tree nodes, etc.
- Add integration tests that authenticate as user B and assert they cannot see user A's private rows via list, get-by-id, search, the graph endpoint, the messaging endpoints, the family tree endpoint, the export endpoint, **and** the AI chat tool endpoints.
- Negative tests for the privacy toggle: user B cannot flip user A's contact private→public.

### 6.6 Documentation

- Update `README.md` and `QUICKSTART.md` to describe the multi-user model and the admin bootstrap.
- Update `PRM-external-API-guide.md` to document per-key user scoping.
- Update `replit.md` / `DOCKER.md` env-var sections with any new knobs (`REGISTRATION_MODE`, `BOOTSTRAP_ADMIN_USERNAME`, etc.).
- Update `design_guidelines.md` with the owner-badge / visibility conventions.

### 6.7 GDPR-adjacent concerns

- "Delete my account" must cascade through user-private rows (already covered by `ON DELETE CASCADE`) but must also decide what to do with **shared rows the user created**:
  - Reassign to an `archived` system user, or
  - Mark them orphaned (`created_by_user_id = NULL`) and read-only.
- Export-my-data endpoint should return everything the user owns or created.

---

## 7. Phased rollout plan

The work above is large. Recommended order:

**Phase 0 — Prep**

1. Lock the spec in this document; get sign-off on the visibility rules in §2.4.
2. Add `users.role`, seed a single admin from the existing primary user.

**Phase 1 — Schema & migration (no behavior change)**

3. Add `created_by_user_id` + `visibility` to shared tables (`people`, `social_accounts`, `groups`, `relationships`, `interactions`, `conversations`).
4. Add `user_id` to user-private tables that lack it (`notes`, `daily_notes`, `tasks`, `image_tasks`).
5. Backfill from the primary user; migrate `conversations.user_id` → `created_by_user_id`; add the per-user Me unique partial index (§8.4).
6. Add `user_settings`; migrate per-user keys.
7. Deploy. Everything still works because every row is owned by user 1 and `visibility='public'`.

**Phase 2 — Server enforcement**

8. Build `server/access.ts` and the central filters.
9. Refactor `server/storage.ts` method by method to accept a viewer (including messaging and OSINT query parameters).
10. Apply `requireAuth` globally.
11. Update background workers, face pipelines, vector sync, AI tools, external API, and browser extension to be user-scoped.
12. Add integration tests (§6.5).

**Phase 3 — Client UX**

13. Add owner badges, lock icons, visibility toggles, per-user "Me" handling.
14. Add admin Users page; add registration / SSO flows for new accounts.
15. Scope per-user views: dashboards, AI chat history, messages page, family tree nodes, daily notes, face queues, etc.

**Phase 4 — Polish**

16. Per-user rate limiting, S3 prefixing, audit log.
17. Account deletion / data export.
18. (Stretch) `shared_acl` for selective sharing.

Each phase is independently shippable and reversible.

---

## 8. Decisions (resolved)

The open questions from the original draft are now settled. These are binding for v1.

### 8.0 Trust model — **small trusted group**

The instance is shared by family / close collaborators who mostly want a *shared*
contact database. Privacy flags are a convenience boundary ("don't clutter their
view", "this one's sensitive"), not a defence against a hostile tenant.

Consequences:

- Enforcement still lives **server-side** in `server/access.ts` — we do not filter
  in React. But we do not need constant-time / oracle-proof behaviour, and returning
  a 403 that reveals a row exists is acceptable.
- Transitive-hiding edge cases get the *simple* treatment; if a private row leaks its
  existence (e.g. an orphaned relationship edge count), that is a bug to fix later,
  not a release blocker.
- The negative integration tests in §6.5 are still required, but the exhaustive
  cross-surface matrix (search + graph + AI tools + export + extension) can land
  incrementally through Phase 2 rather than gating it.

| # | Question | Decision |
|---|---|---|
| 1 | Conversations / messages | **Shared-bucket columns, but `visibility` defaults to `'private'`** — see §8.1 |
| 2 | Face recognition model | **System-wide, built from public data only** — see §8.2 |
| 3 | Groups / crowds | **Creator owns; any authenticated user may edit** — see §8.3 |
| 4 | Per-user "Me" | **Yes, in v1** — see §8.4 |
| 5 | Registration | **Admin-only**; first user is admin — see §8.5 |
| 6 | Privatizing a contact others wrote about | **Warn, then allow** — see §8.6 |
| 7 | Photos | **Option (A), inherited visibility** — no `visibility` column on `photos` |
| 8 | API keys | **Inherit the issuing user's rules verbatim.** No public-only scoped keys in v1 |
| 9 | Vector store | **Single collection per entity type + `user_id` payload filter** — see §8.9 |

### 8.1 Conversations are shared-shaped but private-by-default

`conversations` gets the *shared-by-default* column pair (`created_by_user_id`,
`visibility`) rather than a bare `user_id` — but the default is `'private'`, not
`'public'`. `messages`, `message_recipients`, and `conversation_participants`
inherit visibility from their parent conversation and get no columns of their own.

Rationale: an imported Instagram DM thread hangs off a social account that everybody
can see, yet the thread itself is a personal inbox. Using the shared column shape
means a user can later opt *in* to sharing a specific thread (e.g. "here's the whole
exchange with this contact") without a schema migration.

This supersedes §2.1's placement of conversations in the user-private bucket and
§3.2's "make `conversations.user_id` NOT NULL" instruction. The existing nullable
`userId` column is **renamed/backfilled into `created_by_user_id`** during migration.

### 8.2 Face recognition is system-wide over public data

One shared embedding index. Photos whose derived visibility is private are **excluded
from the index entirely** rather than indexed-then-filtered — this prevents a private
contact from being inferred through a match.

Consequences:

- The face pipeline must resolve a photo's derived visibility (via `prm_location` →
  parent → person/account) *before* enqueuing an embedding job.
- Privatizing a person must **evict** their photos' embeddings from the index; making
  them public again must re-enqueue. This is a new background task type.
- When user A labels a crop as Person X, user B's recognizer does learn it. That is
  intended.

### 8.3 Groups: creator owns, everyone edits

`groups` carries `created_by_user_id` + `visibility`. Only the creator (or an admin)
may toggle visibility or delete the group. Any authenticated user who can *see* the
group may add/remove members and write `group_notes`.

### 8.4 Per-user "Me" ships in v1

`people.user_id` (already nullable today) becomes the per-user Me marker: at most one
row per user. Graph centering, family-tree rooting, and "you" highlighting resolve
against the *viewer's* Me row. Do this in Phase 1 while the table is already being
altered — retrofitting later means re-touching the force graph, React Flow tree, and
dashboard.

Add a unique partial index on `people(user_id) WHERE user_id IS NOT NULL`.

### 8.5 Admin-only account creation

No public signup page. The first user (created by the existing guarded
`/api/setup/initialize`) becomes `role = 'admin'`. Admins create further accounts from
Settings → Users with a temporary password. No invites table in v1.

### 8.6 Privatizing warns, then allows

`PATCH /api/people/:id { visibility: 'private' }` supports a dry-run: without a
`confirm: true` flag it returns a 409 with an impact summary —

```
{ blocked: false, impact: { otherUsers: 2, notes: 12, interactions: 4, conversations: 1 } }
```

— which the client renders as "This will hide 12 notes and 4 interactions from 2 other
users." Re-submitting with `confirm: true` performs the toggle. The same dry-run shape
applies to social accounts and groups.

### 8.9 Vector store: payload filter

One Qdrant collection per entity type (as today). Every point's payload grows
`user_id` (the creator) and `visibility`. Queries AND in a filter of
`visibility = 'public' OR user_id = <viewer>`; user-private entity types filter on
`user_id` alone.

This avoids collection sprawl, keeps shared entities in a single index, and means the
Phase 1 backfill is a payload update rather than a full re-index.

---

## 9. Still to decide (not blocking Phase 1)

1. Account deletion: reassign a departing user's shared rows to an `archived` system
   user, or orphan them with `created_by_user_id = NULL`? (§6.7)
2. Do `app_knowledge` chunks stay global, or does each user get private documentation
   vectors? (Assume global for now.)
3. Whether the `shared_acl` stretch goal (§2.3) ever ships, or "private" stays
   strictly owner-only.
