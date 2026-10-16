# Migration ledger: plan

Today `server/db-init.ts` (2,273 lines) has no record of what has run. Every boot re-executes every
migration and each one re-discovers its own state:

- ~130 sequential `information_schema` round trips from the column map in `validateAndSyncSchema`
  plus the scattered `addColumnIfNotExists` / `tableExists` calls.
- Full-table statements that are only ever useful once: the `social_account_issues` backfill, the
  story `instagram_pk` backfill, the notes/interactions `image_uuid` backfill, the
  `photos.prm_location` person-image backfill, the `face_pair_dismissals` dedupe self-join,
  `migratePendingImportCreationType`'s UPDATE.
- No-op `ALTER TABLE … IF [NOT] EXISTS` on ~25 tables (`dropMultiUserColumns`, `events`,
  `osint_scans`, `summary_jobs`, `story_scrape_runs`, `social_account_posts`, `social_accounts`,
  `true_person_search`). Each takes an ACCESS EXCLUSIVE lock even when it changes nothing, so boot
  queues behind any long PRM-Compute or worker query on those tables.
- Errors are swallowed and logged, so a failed migration is retried forever and a half-broken
  schema boots anyway.
- Side effect worth noting: on a database with no lineage/partnership rows, `seedRelationshipTypes`
  inserts "Family" and `migrateFamilyToNormalizedSchema` deletes it again, every boot.

This plan adds a **`schema_migrations` ledger**, turns everything one-off into a named migration that
runs exactly once, then **squashes** all of today's history into a single baseline and deletes it.

> Open questions are at the end.

---

## 0. Target shape

```
boot
 ├─ hasUsers()?  no → fresh install: drizzle-kit push + baseline extras + mark every migration applied
 │               yes → runPendingMigrations()        ← 1 SELECT when nothing is pending
 ├─ seeds (relationship / interaction / social account types)   ← unchanged, cheap
 └─ listen()
      └─ startup jobs: applyMeRule, applyBigAccountRule, image_task_groups status repair
```

`db-init.ts` ends up holding only `hasUsers`, `dropAllTables`, `runMigrations` (drizzle push),
seeds, `resetDatabase` and `seedExampleData`: roughly 350 lines.

---

## 1. Ledger and runner — new `server/migrations.ts`

```ts
type Migration = {
  name: string;                                   // "0007_story_capture_type"; ledger key, never renamed
  run: (client: PoolClient) => Promise<void | "defer">;
  transaction?: false;                            // for CREATE INDEX CONCURRENTLY and friends
};

export const MIGRATIONS: Migration[] = [ /* append only */ ];
```

Ledger:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`runPendingMigrations()`:

1. `CREATE TABLE IF NOT EXISTS schema_migrations` (cheap, no lock on user tables).
2. `SELECT name FROM schema_migrations` → set. If every `MIGRATIONS` name is in it, return. This is
   the steady-state boot: one query.
3. `pg_advisory_lock(<constant>)` on a dedicated client so two processes (reusePort, a second
   container, a dev server left running) can't race. Re-read the ledger after acquiring it.
4. For each pending migration, in array order:
   - `BEGIN` → `run(client)` → `INSERT INTO schema_migrations` → `COMMIT`. Postgres DDL is
     transactional, so a failure leaves neither the change nor the ledger row.
   - `transaction: false` → run, then insert the ledger row.
   - `run` returns `"defer"` → no ledger row; it retries next boot (see §3).
   - `run` throws → `ROLLBACK`, log loudly, **stop running later migrations** (they may depend on it)
     and continue booting. Same resilience as today, but no silent half-states.
5. Release the lock, log `applied N migration(s) in Xms`.

Rules, kept as a header comment in `migrations.ts`:

- Append only. Never edit or reorder a migration that has shipped; write a new one.
- A schema change goes in **both** `shared/schema.ts` (for fresh installs) and a new migration
  (for existing databases).
- Migrations throw on failure; they do not catch-and-log.
- No need for `IF NOT EXISTS` guards — the ledger is the guard — but they're harmless.

---

## 2. Phase 1 — introduce the ledger with a transitional catch-up

Ships with the old code still present, so the live database converges first.

`MIGRATIONS` starts as:

| Name | Body | Notes |
|---|---|---|
| `0001_legacy_catchup` | today's `validateAndSyncSchema()` + `dropMultiUserColumns()` + `migratePartnerToSpouse()` + `migrateFamilyToNormalizedSchema()` + `migratePendingImportCreationType()` + `migrateOllamaToAiProviders()` + `migrateAddressHistory()` | Not wrapped in a transaction (the old code uses `pool`, not the client). Its one-off backfills run one last time. |
| `0002_drop_legacy_hq_columns` | `dropLegacyHqImageColumns()`, returning `"defer"` while `legacyProfileImagesPending()` is non-zero | Moved out of the catch-up: it waits on the `migrate_profile_image_tiers` task. |
| `0003_social_accounts_username_unique` | the unique-index block from `migrateSocialAccountsToJournal()`, returning `"defer"` while duplicate handles exist | Same reason: waits on the user merging duplicates. |

Changes to the old code so the catch-up records correctly:

- Strip the swallowed `try/catch` from the functions the catch-up calls, so a failure throws and
  `0001` is **not** recorded. (Today `validateAndSyncSchema` catches everything at the top level.)
- Remove the deferred blocks (`0002`, `0003`) from inside the catch-up.

Moved out of migrations entirely, into a `runStartupJobs()` called after `listen()` next to
`startTaskWorker()`:

- `applyMeRule()` / `applyBigAccountRule()`: they're rules, not migrations. Check first whether every
  write path that changes their inputs already calls them with `ids`; if so, delete the boot call.
- The `image_task_groups` "retroactively sync completed groups" UPDATE: crash recovery for the task
  worker, so it belongs in `startTaskWorker()`.

`initializeDatabase()` becomes:

```ts
if (!(await hasUsers())) {
  await dropAllTables();
  await runMigrations();                // drizzle-kit push
  await createBaselineExtras();         // §4: things schema.ts can't express
  await markAllMigrationsApplied();     // fresh schema is already current
} else {
  await runPendingMigrations();
}
await seedRelationshipTypes(); await seedInteractionTypes(); await seedSocialAccountTypes();
```

`resetDatabase()` gets the same `createBaselineExtras()` + `markAllMigrationsApplied()` after its push.

---

## 3. Phase 2 — squash

**Precondition:** every database that matters has `0001_legacy_catchup` in its ledger (check with
`SELECT * FROM schema_migrations`). For a single-user install that's one boot of the live database.

Then:

1. Replace `0001_legacy_catchup`'s body with a guard:
   ```ts
   run: () => { throw new Error("Database predates the migration ledger. Boot PRM at <commit> once to bring it current, then upgrade."); }
   ```
   A fresh install never hits it (marked applied); an up-to-date one never hits it (already in the
   ledger); only a database that skipped Phase 1 does, and it gets a clear message instead of a
   broken schema.
2. Delete from `db-init.ts`: `validateAndSyncSchema`, `migrateToSocialFollows`,
   `migrateSocialAccountsToJournal`, `migrateStorySettingsToImporter`, `dropLegacyImageStorageMode`,
   `migrateToScans`, `dropMultiUserColumns`, `migratePartnerToSpouse`,
   `migrateFamilyToNormalizedSchema`, `migratePendingImportCreationType`,
   `migrateOllamaToAiProviders`, `migrateAddressHistory`, `ensureSsoEmailColumn` (already dead —
   nothing calls it), `tableExists`, `columnExists`, `addColumnIfNotExists`, and the now-unused imports.
3. **Not yet deleted:** `legacyHqImageUrls` / `legacyProfileImagesPending` are still read by
   `server/storage.ts` and `server/task-worker.ts`. They go together with `0002`'s body and the
   `migrate_profile_image_tiers` task once `0002` is in the ledger. Same for `0003` once applied.
4. `0002`/`0003` bodies can then also become guards like step 1, in a later squash.

---

## 4. Phase 0 (do first, read-only) — schema.ts drift audit

Squashing makes `shared/schema.ts` + `drizzle-kit push` the **only** definition of a fresh schema,
and the comments in `db-init.ts` say the live database was built with raw `CREATE TABLE` and has
never had `db:push` run against it. So before Phase 2, confirm they match:

1. `pg_dump --schema-only` the live database.
2. Create a scratch database, run `drizzle-kit push` against it, apply the extras below, and
   `pg_dump --schema-only` that.
3. Diff. For each difference, fix `schema.ts` (preferred) or add it to `createBaselineExtras()`.

Already known to be missing from `schema.ts`, so they go in `createBaselineExtras()`:

- PRM-Compute's tables: `prm_face_api_keys`, `setup_state`, `osint_jobs` (+ `ix_osint_jobs_status`).
  Today a fresh install only gets these on its *second* boot, when the users-exist branch runs.
- `session` (connect-pg-simple), already created by hand in `resetDatabase`.
- Probably some partial/expression indexes, e.g. `osint_scans_live_owner_uniq` on
  `coalesce(social_account_id, person_id)`, `person_addresses_person_query`,
  `social_accounts_username_lower_idx`. The diff will say which `schema.ts` already declares.

---

## 5. Verification

- `npm run check`.
- **Upgrade path:** restore a `pg_dump` of the live database into a scratch DB, point
  `DATABASE_URL` at it, boot. Expect `0001`–`0003` applied (or `0002` deferred). Boot again: one
  ledger `SELECT`, no `ALTER`s. Time `initializeDatabase()` before and after.
- **Fresh path:** empty scratch DB, boot, sign up. Expect every migration name in the ledger,
  PRM-Compute's tables present, and PRM-Compute starting against it without schema errors.
- **Failure path:** temporarily add a migration that throws; confirm it isn't recorded, later ones
  don't run, and the app still serves.
- **Phase 2:** repeat both paths after the deletions; diff `pg_dump --schema-only` of the fresh DB
  against the upgraded one.

---

## Open questions

1. **How many databases need to cross Phase 1?** Live Docker install only, or also dev copies?
   Phase 2 can't land until each has booted once on Phase 1.
2. **Failed migration: boot or not?** The plan keeps today's behaviour (log, stop migrating, serve).
   Refusing to boot is safer for schema migrations but means a bad deploy takes the app down.
3. **`applyMeRule` / `applyBigAccountRule` on boot** — keep as a post-listen startup job, or delete
   if the write paths already cover every case?
