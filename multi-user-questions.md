# Multi-User Conversion — Open Questions

Questions raised while implementing **Phase 1** (schema + migration) of
[Guides/pathway-to-multi-user.md](Guides/pathway-to-multi-user.md).

Phase 1 is done and both `tsc` and `npm run build` pass. Nothing below blocks
Phase 1 shipping — but several answers change what Phase 2 looks like, and a few
are decisions I made unilaterally that you should confirm or overrule.

---

## A. Decisions I made without asking — confirm or overrule

### A1. `created_by_user_id` is **nullable**, not `NOT NULL`

The plan doc said `NOT NULL`. I made it nullable, where **NULL means "orphaned
or system-created", and such rows are treated as public**.

Two reasons: `ALTER TABLE ... ADD COLUMN ... NOT NULL` fails on tables that
already have rows, and §6.7 wants the option of orphaning a departing user's
shared rows rather than reassigning them. Nullable serves both.

**Question:** keep nullable-means-orphaned, or do you want it promoted to
`NOT NULL` after backfill (which forces the "reassign to an archived system
user" answer to §6.7 now rather than later)?

The user-private columns (`notes.user_id`, `daily_notes.user_id`,
`tasks.user_id`, `image_tasks.user_id`) **are** `NOT NULL` — the migration adds
them nullable, backfills, then promotes.

### A2. `relationships` has no `visibility` column

I flagged this contradiction before building and went with the endpoint rule
only: `relationships` gets `created_by_user_id` for attribution, and visibility
is derived from whether both endpoint people are visible.

Rationale: a `visibility` column would be a second, independent rule with no UI
to set it, and the two could disagree. `lineage` and `partnerships` get nothing
at all, for the same reason.

**Question:** confirm. If you actually want individually-hideable relationship
edges, say so — it's a column plus a toggle endpoint.

### A3. Multi-user columns live in a dedicated migration, not `schemaDefinitions`

Repo convention is to declare columns in both `shared/schema.ts` and
`schemaDefinitions` in `server/db-init.ts`. I could not follow it here: the
user-private columns need **add nullable → backfill → SET NOT NULL** in that
order, and `schemaDefinitions` only does a bare `ADD COLUMN`.

So there is a new `migrateToMultiUser()` in `server/db-init.ts`, following the
same pattern as the existing `migrateToSocialFollows()` /
`migrateSocialAccountsToHistorical()` functions. It is idempotent and runs on
every boot.

**Question:** happy with that, or do you want the additive columns duplicated
into `schemaDefinitions` as well for consistency?

### A4. Ownership fields are stripped from request schemas

`insertPersonSchema` and friends now `.omit()` `created_by_user_id` (and
`users.role`, and `user_id` on the private tables), so a client cannot POST a
body that spoofs attribution. The server sets them. The `Insert*` **types**
intersect the fields back in via two new helpers in `shared/schema.ts`
(`OwnershipInput`, `UserOwnedInput`) so the storage layer can still be handed a
value.

`visibility` is deliberately **not** stripped — creating something
already-private seemed like a legitimate thing for a client to ask for.

**Question:** confirm `visibility` should be settable at create time, or should
it also be server-only and changeable exclusively through the §8.6 toggle
endpoint?

---

## B. Bugs and gaps this surfaced

### B1. `people.user_id` was being used as "owner" in at least one place

`server/routes/tps.ts` set `people.user_id = session.userId` on every contact
imported from the Chrome extension. With per-user "Me" (§8.4) that column means
"this is user N's own Me person", and it now has a unique partial index — so
the **second** TPS import for a user would have thrown a constraint violation.

Changed to `created_by_user_id`. Worth knowing this was latent before my change.

**Question:** is there any existing production data where `people.user_id` is
set on more than one row per user? If so the unique index creation will fail on
boot and needs a cleanup step first. I did not write that cleanup because I
don't know the answer.

### B2. Three places assumed a single global "Me" person

`db.select().from(people).where(isNotNull(people.userId)).limit(1)` appeared in
the XML export (both the route and the worker copy) and the XML import. All
three now resolve the *acting* user's Me person. Behaviour is identical on a
single-user instance and correct on a multi-user one.

### B3. Rows created outside a request are still unattributed

These create shared entities with `created_by_user_id = NULL` because there is
no user in scope:

- `server/ai-tools.ts:989` (`createPerson`), `:1104` (`createInteraction`)
- `server/family-tree-ai.ts:555`, `:612` (`createPerson`)
- `server/task-worker.ts:1784`, `:1981` (`createSocialAccount`)

Harmless in Phase 1 (NULL reads as public, and everything is public anyway), but
it needs a real answer in Phase 2.

**Question:** should AI-tool and worker writes be attributed to (a) the user
whose session invoked the AI / queued the task, or (b) a dedicated `system`
user row? (a) is more useful for "who added this contact"; (b) is more honest
about the fact that a machine wrote it. I lean (a), threading the caller
through — the task rows already carry `user_id` now, which makes it easy.

---

## C. Questions that shape Phase 2

### C1. Do admins bypass visibility entirely?

`users.role` now exists and the bootstrap user is `admin`. The plan says admins
gate writes to lookup tables and instance settings, but never says whether an
admin can **read** another user's private contact or DM thread.

Given "small trusted group", I'd say admins bypass the visibility filter for
reads but that the UI says so plainly. But it's your data model — tell me.

### C2. Does the `interactions` bucket change break the "my history" view?

Interactions are now shared-by-default per your answer. On a single-user
instance nothing changes. But once there are two users, the person detail page
will show *both* users' logged interactions interleaved with no visual
distinction.

**Question:** for Phase 3, do you want an attribution badge on each interaction,
a Mine/All filter, or both?

### C3. `conversations` — what actually flips one to public?

The columns and the private default are in place. There is no UI or endpoint to
share a thread yet, because I don't know what the gesture should be.

**Question:** is sharing a DM thread a per-thread toggle in the messages UI, or
is it something you'd only ever do through an admin/debug path? If the latter,
I'd skip building it.

### C4. Qdrant backfill timing

Decision §8.9 is a payload filter, so existing points need `user_id` and
`visibility` added to their payloads. I have **not** written that backfill —
it's a Phase 2 task and I'd want to know whether to do it as a one-shot script,
a background task type, or a lazy "fix on next sync".

**Question:** which? Lazy-on-next-sync is least code but leaves stale points
unfiltered for an unbounded time, which matters more once there's a second user.

### C5. Face embedding eviction

Decision §8.2 requires that privatizing a person **evicts** their photos'
embeddings from the shared index, and re-publishing re-enqueues them. That's a
new background task type that doesn't exist yet.

**Question:** confirm this is Phase 2 scope and not something you want stubbed
now. Until it exists, the §8.6 privatize toggle will hide rows in the UI but
leave face matches working — which is exactly the inference leak §8.2 was
written to prevent.

---

## D. Not blocking, but I noticed

- `app_settings` still holds per-user keys (`ollama_*`, intelligence settings).
  The `user_settings` table is created by the migration but **nothing reads or
  writes it yet**, and no keys have been migrated across. §3.4 lists the
  candidates; I didn't move them because I'd be guessing at which of the OSINT
  settings are genuinely per-user vs instance-wide. Want to go through that list?
- `requireAuth` is still not applied globally (§4.1). Deliberately left for
  Phase 2 — flipping it on is a one-line change with a large blast radius and
  wants to land with the integration tests, not before them.
- `server/access.ts` does not exist yet. I chose not to write it as an unused
  module; it should land in Phase 2 together with its first caller.
