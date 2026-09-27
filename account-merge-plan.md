# Account merge — plan

When a followed account renames itself, PRM usually ends up with it twice:
the old row (now 404s and sits on the Issues page) and a new row that a
follows scrape created under the new name — often already carrying a full
follower/following list and posts of its own. The Issues page's rename
refuses with a link when it sees this (`account-issues-plan.md` §5.1).
This plan turns that refusal into a **Merge**: the old row survives with its
UUID, history, owner and tracking settings; everything the new row learned
is folded in as if it were one more import; the new row goes away.

Companion: `account-issues-plan.md` (the Issues page, `closeIssue`, the
rename route this extends).

Decisions (2026-09-21):

| Question | Answer |
|---|---|
| Where | Issues page only. When Rename hits "already another account", the page asks **Merge with @new?** |
| Survivor | The **old** row keeps its UUID. The new row is treated as an import into it, then deleted. Links to `/social-accounts/<new id>` stop working |
| Follows | Union, never a snapshot: nothing the old row knew is dropped, and a full list on the new row is kept in full |
| Owner clash | Old row's person wins; the new row's link is dropped |
| Profile fields | Untouched at merge time. The profile check queued right after refreshes nickname/bio/picture through the normal history path, so old→new transitions land in history |

---

## 1. What "treat the new row as an import" means

The follows scrape that created the new row went through
`applySnapshot()` (`server/social-account-history.ts`), which is the only
writer of `social_follows`, the two denormalized count columns and the
history journal. A merge should go through the same door rather than
rewriting `social_follows` by hand:

```
applySnapshot({
  socialAccountId: old.id,
  scope: "both",
  followerIds:  union(followers(old),  followers(new))  minus {old, new},
  followingIds: union(following(old), following(new))  minus {old, new},
  source: "manual",
})
```

That gives, for free: one `direct` history entry on the old row with
`followersAdded` / `followingAdded` counts (and zero lost — a union can only
grow), `neighbour` entries on every account that gained the old row as an
edge, correct `followers_count` / `following_count`, the "me" interest-level
grading, and the per-transaction row locks and timeouts the scrapes rely on.

Everything else the new row owns is moved by id in one transaction (§3).

## 2. Route — `POST /api/account-issues/:id/merge` (`server/routes/account-issues.ts`)

Body: `{ intoUsername }` — the same normalized username the rename was
refused on. Steps:

1. `issueFor(id)` → old row + issue; 404 / 409 as the rename does.
2. Look up the new row by `(username, INSTAGRAM_TYPE_ID)`; 404 if gone,
   400 if it is the old row itself.
3. `mergeSocialAccounts(old, new)` (§3).
4. Rename old → new username exactly as the rename route does today:
   `storage.updateSocialAccount` + `recordAccountProfileChanges` (history
   gets the `username` change with the previous value) + `closeIssue(…,
   "renamed", …)` + `queueManualJob(old.id, "info")` +
   `kickManualTrackingJobs()`.
5. `deleteEntityVector` for the new row's `vectorId` (as the delete route
   does), `syncEntityInBackground("social_account", old.id)`, SSE
   `social_account.updated` for old (there is no `deleted` event type;
   the list refetches on the page's invalidation).
6. Respond `{ username, job, merged: { followers, following, posts } }` so
   the card can say what it took in.

Steps 4–5 are the rename route's tail; pull them into a local
`renameAndRecheck(issue, account, username, userId)` and call it from both
routes so the two can't drift.

## 3. `mergeSocialAccounts(old, new)` — `server/account-merge.ts` (new)

Two steps, in an order where a failure between them loses nothing:

1. `applySnapshot` with the union (§1), while the new row still exists.
   If this is all that lands, the old row simply knows more; a retry works.
2. One `db.transaction` (`SET LOCAL lock_timeout = '10s'`, both rows locked
   `FOR UPDATE`) repoints everything below and deletes the new row.

`applySnapshot` keeps its own transaction and its post-commit `applyMeRule`
call, so it is not given a `tx` — running it inside the merge transaction
would have `applyMeRule` wait on rows that transaction holds.

| Table / column | What happens |
|---|---|
| `social_follows` | Step 1 above. The new row's own edges cascade away on delete; before that, each neighbour's denormalized count comes down by one for the edge it is about to lose (step 1 counted the edge on the old row's side), the same delta an unfollow would move |
| `social_account_history.social_account_id` | `UPDATE … SET social_account_id = old WHERE = new` — the new row's own journal (its scrapes, neighbour mentions) becomes part of the old row's |
| `social_account_history.observed_via_account_id` | repoint new → old |
| `social_network_changes.social_account_id`, `.target_account_id` (text) | repoint |
| `social_account_posts.social_account_id` | repoint, **except** rows whose `instagram_pk` the old row already has — those are the same post scraped twice; delete the new row's copy (comments cascade) |
| `social_account_posts.coauthor_account_ids` (jsonb array) | replace new id with old id where present |
| `social_accounts.current_posts` / `deleted_posts` (JSON id arrays) | union onto old |
| `tracking_jobs` | repoint — a queued/running job on the new row simply completes against the old row; the result handler looks the account up by `job.social_account_id` |
| `social_account_issues` | not moved: the new row's open issues (`private`) cascade away; the profile check queued in §2 raises them again on the old row if still true |
| `osint_scan_queue` | repoint with `ON CONFLICT DO NOTHING` on the live unique index (`account, tool` while pending/running) |
| `conversations`, `messages.sender_social_account_id`, `message_recipients`, `conversation_participants` | repoint — these are `SET NULL` on delete and would otherwise lose the link |
| `people.social_account_uuids` | `array_replace(new, old)` then dedupe; only for people that list the new id |
| `people.id = new.owner_uuid` | if the old row has no owner, adopt the new row's (`COALESCE(old.owner_uuid, new.owner_uuid)`); otherwise the old wins and the new link is dropped |
| `groups.center_account_id` | repoint |
| `insights.applicable_social_account_ids` | `array_replace` |
| `daily_note_involved_parties.ref_id` where `party_type = 'social_account'` | repoint |
| `social_accounts.personface_uuid` | `COALESCE(old, new)` |
| `social_accounts.group_id`, `type_id`, tracking columns, interest level, profile fields | old row keeps its own (the re-check refreshes the profile) |
| `social_profile_versions` | retired table; cascade |

Then `DELETE FROM social_accounts WHERE id = new`. The function returns the
counts the response reports (followers and following added by step 1,
posts moved by step 2).

## 4. UI — `client/src/pages/social-accounts-issues.tsx`

When the rename comes back 409 the page asks straight away: an
`AlertDialog` titled **Merge with @new?** with a link to the duplicate and
a plain sentence —

> Merging keeps @old (this row, its history and settings), folds in
> everything PRM knows about @new, renames it, and deletes the other row.
> Links to that row's page will stop working. This cannot be undone.

Cancel leaves the rename form open; Merge posts to `/merge`. On success
the card disappears (`invalidateAll()`) and a toast says "Merged into @new
— +N followers, +M following, +P posts. A profile check is queued."

Nothing else on the page changes; there is no merge entry point anywhere
else (decision above).

## 5. Files

| File | Change |
|---|---|
| `server/account-merge.ts` | new — `mergeSocialAccounts(old, new)` |
| `server/routes/account-issues.ts` | `POST /:id/merge`; extract `renameAndRecheck` shared with `/rename` |
| `client/src/pages/social-accounts-issues.tsx` | the rename's 409 opens the merge confirm dialog |
| `account-issues-plan.md` §8 | replace the "merging is out of scope" bullet with a pointer here |

No schema or `db-init.ts` change: every move is an `UPDATE` on existing
columns and the delete uses the cascades that are already there.

## 6. Out of scope

- **Merging from anywhere but the Issues page.** A general "merge these two
  accounts" tool needs an account picker and a survivor choice; the rename
  409 already knows both rows and which one is old.
- **Undo.** The new row is gone after the merge; history keeps what it
  contributed but not that it was ever a separate row. The confirm dialog
  says so.
- **The other order** (old absorbed into new). Same work, different
  survivor; nothing here prevents adding it later.
- **`instagram_pk` on `social_accounts`** — still the fix that would make
  most of these merges unnecessary (`account-issues-plan.md` §8).

## 7. Assumptions (say so if any is wrong)

- The two rows are both Instagram (`INSTAGRAM_TYPE_ID`); the rename's
  duplicate lookup is already type-scoped, so the merge inherits that.
- A post is "the same post" when `instagram_pk` matches. Story rows and
  older posts have no pk and are never deduped — a doubled story is a
  smaller harm than a silently dropped one.
- The new row's `interest_level` and cadence overrides are dropped in
  favour of the old row's. If the new row was graded higher by the "me"
  rule, the merge's own `applySnapshot` re-runs that rule on the old row.
- History entries moved from the new row keep their timestamps, so the old
  row's timeline will show the new row's scrapes interleaved with its own
  404s. That reads correctly: it is what happened to that account.
