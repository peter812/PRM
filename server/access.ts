/**
 * Per-request access control for the multi-user conversion
 * (Guides/pathway-to-multi-user.md §4, §8.6).
 *
 * The storage layer is ~4800 lines of query builders that were written when
 * every row belonged to the only user. Threading an explicit "who is asking"
 * parameter through all of it would touch every call site in the codebase, so
 * the acting user is carried in an AsyncLocalStorage context installed once per
 * request and read by the predicate helpers below.
 *
 * The two buckets, from §2.2:
 *
 *   - **Shared** entities (`people`, `groups`, `social_accounts`,
 *     `interactions`, `conversations`) carry `created_by_user_id` + `visibility`.
 *     A row is readable if it is public, or you created it. A NULL creator means
 *     the row is orphaned or was written by a system importer, and reads as
 *     public.
 *   - **User-private** entities (`notes`, `daily_notes`, `tasks`, `image_tasks`)
 *     carry a NOT NULL `user_id` and are readable only by that user.
 *
 * Fails closed: a predicate called with no context in scope throws rather than
 * returning an unfiltered query. Code that legitimately runs outside a request
 * — the task worker, db-init, CLI scripts — must say so explicitly with
 * `runAsSystem`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { isAdminRole, type UserRole } from "@shared/schema";

export interface AccessContext {
  /** The acting user, or null for system/background work. */
  userId: number | null;
  isAdmin: boolean;
  /**
   * Admin has explicitly switched on cross-user view for this session (§8.6).
   * Off by default even for admins — being an admin is not the same as reading
   * as one, and the UI labels rows that are only visible because of this.
   */
  adminView: boolean;
  /** Background/bootstrap work that is not acting for any particular user. */
  system: boolean;
}

export class AccessContextMissingError extends Error {
  constructor(what: string) {
    super(
      `No access context in scope while building a filter for ${what}. ` +
        `Request paths get one from accessMiddleware; background work must ` +
        `wrap itself in runAsSystem() or runAsUser().`,
    );
    this.name = "AccessContextMissingError";
  }
}

const storage = new AsyncLocalStorage<AccessContext>();

/** The context for the current request, if there is one. */
export function currentAccess(): AccessContext | undefined {
  return storage.getStore();
}

function requireAccess(what: string): AccessContext {
  const ctx = storage.getStore();
  if (!ctx) throw new AccessContextMissingError(what);
  return ctx;
}

/** True when the caller sees every row regardless of owner or visibility. */
export function bypassesAccessFilters(ctx: AccessContext): boolean {
  return ctx.system || (ctx.isAdmin && ctx.adminView);
}

export function runWithAccess<T>(ctx: AccessContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Run `fn` as a specific user (extension-token routes, per-task worker runs). */
export function runAsUser<T>(
  userId: number,
  role: UserRole,
  fn: () => T,
  opts: { adminView?: boolean } = {},
): T {
  return runWithAccess(
    {
      userId,
      isAdmin: isAdminRole(role),
      adminView: isAdminRole(role) && opts.adminView === true,
      system: false,
    },
    fn,
  );
}

/**
 * Run `fn` with all access filters disabled. For work that has no acting user:
 * schema migration, seeding, the task worker's queue polling, CLI scripts.
 * Never use this to service a request.
 */
export function runAsSystem<T>(fn: () => T): T {
  return runWithAccess({ userId: null, isAdmin: false, adminView: false, system: true }, fn);
}

/**
 * Set the context for the remainder of the current async execution, without
 * wrapping a callback. For handlers that only learn who is calling partway
 * through (the Chrome-extension routes authenticate on a header, mid-handler).
 */
export function enterAccessContext(ctx: AccessContext): void {
  storage.enterWith(ctx);
}

// ── Query predicates ─────────────────────────────────────────────────────────
//
// All of these return `undefined` when the caller bypasses filtering, so they
// can be dropped straight into `and(...)` / `where(...)` — drizzle ignores
// undefined operands.

/**
 * Readable rows of a shared entity: public, mine, or orphaned.
 *
 * Pass the table's own columns, e.g.
 * `visibleShared(people.visibility, people.createdByUserId)`.
 */
export function visibleShared(
  visibility: PgColumn,
  createdByUserId: PgColumn,
): SQL | undefined {
  const ctx = requireAccess("a shared entity");
  if (bypassesAccessFilters(ctx)) return undefined;
  if (ctx.userId === null) {
    // Non-system caller with no user: only genuinely public rows.
    return sql`(${visibility} = 'public' OR ${createdByUserId} IS NULL)`;
  }
  return sql`(${visibility} = 'public' OR ${createdByUserId} IS NULL OR ${createdByUserId} = ${ctx.userId})`;
}

/** Rows of a user-private entity belonging to the acting user. */
export function ownedByCurrentUser(userIdColumn: PgColumn): SQL | undefined {
  const ctx = requireAccess("a user-private entity");
  if (bypassesAccessFilters(ctx)) return undefined;
  if (ctx.userId === null) {
    // No user and no bypass — match nothing rather than everything.
    return sql`false`;
  }
  return sql`${userIdColumn} = ${ctx.userId}`;
}

/**
 * The acting user's id, for writes that must stamp ownership.
 * Throws rather than writing an unattributed row.
 */
export function actingUserId(): number {
  const ctx = requireAccess("an ownership stamp");
  if (ctx.userId === null) {
    throw new Error(
      "actingUserId() called with no acting user. System writes must pass an " +
        "explicit owner instead of relying on the ambient context.",
    );
  }
  return ctx.userId;
}

/** In-memory equivalent of `visibleShared`, for rows already fetched. */
export function canReadShared(row: {
  visibility?: string | null;
  createdByUserId?: number | null;
}): boolean {
  const ctx = requireAccess("a shared entity");
  if (bypassesAccessFilters(ctx)) return true;
  if (row.createdByUserId == null) return true;
  if (row.visibility !== "private") return true;
  return row.createdByUserId === ctx.userId;
}

/** In-memory equivalent of `ownedByCurrentUser`. */
export function canReadOwned(row: { userId?: number | null }): boolean {
  const ctx = requireAccess("a user-private entity");
  if (bypassesAccessFilters(ctx)) return true;
  return row.userId != null && row.userId === ctx.userId;
}

// ── Express wiring ───────────────────────────────────────────────────────────

declare module "express-session" {
  interface SessionData {
    /** Admin cross-user view, toggled through POST /api/admin/view (§8.6). */
    adminView?: boolean;
  }
}

/**
 * Installs the access context for the rest of the request. Must be registered
 * after passport (so `req.user` is populated) and before any route that reads
 * data. Requests with no session user get no context at all, which makes any
 * filtered query throw rather than quietly returning everything.
 */
export function accessMiddleware(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): void {
  const user = req.user;
  if (!user) return next();

  const isAdmin = isAdminRole(user.role);
  runWithAccess(
    {
      userId: user.id,
      isAdmin,
      adminView: isAdmin && req.session?.adminView === true,
      system: false,
    },
    () => next(),
  );
}
