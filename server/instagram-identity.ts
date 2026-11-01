// Instagram's numeric user id (`pk`) is the one thing about an account a rename
// doesn't change. A scrape that carries it settles which row it is, so a renamed
// account keeps its row, history and owner under the new name instead of
// turning up as a stranger — and a row created meanwhile under the new name
// folds into it.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { sseManager } from "./middleware/sse";
import { deleteEntityVector, syncEntityInBackground } from "./vector-universal";
import { socialAccounts, type SocialAccount } from "@shared/schema";
import { INSTAGRAM_TYPE_ID } from "@shared/constants";
import { recordAccountProfileChanges } from "./social-account-history";
import { resolveIssues } from "./account-issues";
import { mergeSocialAccounts } from "./account-merge";

/** A scraped user's id, or null when the row has none worth trusting. */
export const instagramPkOf = (row: { pk?: unknown } | null | undefined): string | null => {
  const pk = row?.pk == null ? "" : String(row.pk).trim();
  return /^\d+$/.test(pk) ? pk : null;
};

/** Journal the old name on the row and close the not_found issue it caused. */
async function journalRename(account: SocialAccount, username: string) {
  await recordAccountProfileChanges(account.id, { username }, account, "prm-stories");
  await resolveIssues(account.id, ["not_found"], "renamed", account.username);
}

/** The same Instagram user under two rows: `survivor` takes in everything the other learned. */
async function fold(survivorId: string, duplicate: { id: string; vectorId: string | null }) {
  await mergeSocialAccounts(survivorId, duplicate.id);
  if (duplicate.vectorId) void deleteEntityVector("social_account", duplicate.vectorId);
}

/**
 * `account` (held under Instagram user id `pk`) is now called `username`, as a
 * follow list or story just showed. A pk-less row already under that name is
 * the same person seen before the id was known, so it folds in first.
 */
export async function followRename(account: SocialAccount, username: string): Promise<void> {
  const [named] = await db
    .select({ id: socialAccounts.id, vectorId: socialAccounts.vectorId })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.username, username), isNull(socialAccounts.instagramUserId)))
    .limit(1);
  if (named && named.id !== account.id) await fold(account.id, named);
  const changes = { username, accountUrl: `https://instagram.com/${username}` };
  await storage.updateSocialAccount(account.id, changes);
  await journalRename(account, username);
  sseManager.broadcast("social_account.updated", { id: account.id });
  syncEntityInBackground("social_account", account.id);
}

/**
 * The profile at `account`'s username is Instagram user `pk`. Another row
 * holding that id is this account under an earlier name: its history (old
 * name journaled) folds into `account`, which a job may be working right now
 * and so is the one kept.
 */
export async function claimInstagramUserId(account: SocialAccount, pk: string): Promise<void> {
  if (account.instagramUserId === pk) return;
  if (account.instagramUserId) {
    // The handle passed to someone else; relabelling the row would splice two people's histories.
    console.warn(`@${account.username}: profile is Instagram user ${pk}, but the row holds ${account.instagramUserId}; id left as is`);
    return;
  }
  const [holder] = await db.select().from(socialAccounts).where(eq(socialAccounts.instagramUserId, pk)).limit(1);
  if (holder && holder.id !== account.id) {
    await journalRename(holder, account.username);
    await fold(account.id, holder);
  }
  await db.update(socialAccounts).set({ instagramUserId: pk }).where(eq(socialAccounts.id, account.id));
}

/**
 * The row for one scraped user: by id when the scrape had one (renamed to
 * `username` if Instagram calls it that now), else by name — skipping a row
 * that holds a different id, and filling the id in on a row that has none.
 */
export async function findInstagramAccount(pk: string | null, username: string): Promise<SocialAccount | undefined> {
  const handle = username.trim().toLowerCase();
  if (pk) {
    const [holder] = await db.select().from(socialAccounts).where(eq(socialAccounts.instagramUserId, pk)).limit(1);
    if (holder && holder.username.toLowerCase() !== handle) await followRename(holder, handle);
    if (holder) return { ...holder, username: handle };
  }
  const rows = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(sql`LOWER(${socialAccounts.username})`, handle), eq(socialAccounts.typeId, INSTAGRAM_TYPE_ID)));
  const named = rows.find((r) => !pk || !r.instagramUserId || r.instagramUserId === pk);
  if (!named || !pk || named.instagramUserId) return named;
  await db.update(socialAccounts).set({ instagramUserId: pk }).where(eq(socialAccounts.id, named.id));
  return { ...named, instagramUserId: pk };
}
