# Connections in the account summary: plan

Give the account summary LLM the account's strongest connections, the same list the **Connections**
tab shows (`connection-strength-plan.md`), so the profile it writes can name who this account is
close to and how they interact. Today the prompt only sees the account header and the newest 100
post/story overviews (`runAccountSummaryJob`, `server/summary-queue.ts:570`).

## What exists today
- `getConnections(accountId)` (`server/connection-strength.ts:159`) returns every account this one
  interacts with, sorted by decayed score, each with `score`, `in`/`out` counts, `byKind`
  (comment / story_mention / post_mention / bio), `lastInteractionAt` and the raw `events`.
  It's computed per call with no table, and is cheap at the 10k ceiling.
- `Connection.account` carries `username` and `nickname` only. The PRM person behind an account is
  `social_accounts.owner_uuid → people`.
- The account prompt input is two `asData(...)` blocks: `account_info` and
  `chronological_posts_and_stories`.
- `DEFAULT_ACCOUNT_PROMPT` is never written to `app_settings` (`promptValue` in
  `server/routes/summaries.ts:124` stores `""` when the text equals the default). Changing the
  default therefore reaches everyone who hasn't customized the prompt.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Which connections | The top **20** by score (`ACCOUNT_SUMMARY_MAX_CONNECTIONS`, a constant next to `ACCOUNT_SUMMARY_MAX_POSTS`). No setting. |
| 2 | Per-connection detail | Handle, nickname, linked PRM person name, rounded score, in/out counts, non-zero per-kind counts, last interaction date, and "in bio now" / "♥ in bio" flags taken from the bio events. Raw events are left out. |
| 3 | Invalidation | **None.** A connection change doesn't mark the summary out of date. Scores decay daily, so invalidating on that would mean always stale. The connections block is a snapshot taken whenever the summary next runs. |
| 4 | Stored on the summary | Add `connectionCount` to `AccountAiSummary` next to `postCount`/`storyCount`, so the UI can say "from 100 posts, 12 stories, 20 connections". |
| 5 | Banned accounts | No special case. `getConnections` already returns whatever the Connections tab shows. |

## Status (2026-10-28): built
`connectionsForPrompt()` in `server/connection-strength.ts` builds the lines and a score guide. The
guide is generated from the live `connection_strength` weights and appended to the system prompt
after the account prompt, so it reaches custom prompts too. The counts on each line are interaction
counts taken from `events`. They aren't the tab's `in`/`out`/`byKind`, which are decayed values.
The settings-page note was skipped, since the guide already explains the block to custom prompts.

## Changes

### 1. `server/summary-queue.ts`, `runAccountSummaryJob`
1. Next to the posts query, call `getConnections(account.id)` and slice it to
   `ACCOUNT_SUMMARY_MAX_CONNECTIONS`. A failure here shouldn't fail the summary: catch it, log it,
   and go on with an empty list.
2. Look up the owner names for those account ids in one query
   (`socialAccounts.id, people.firstName, people.lastName` joined on `ownerUuid`).
3. Build one line per connection, for example:
   ```
   @jdoe (Jane Doe; PRM: Jane Doe) - strength 42, 9 in / 6 out; comments 7, story mentions 5, post mentions & faces 3; last 2026-10-12; ♥ in bio now
   ```
   "in" means they interacted with this account and "out" means this account interacted with them,
   matching `ConnectionEvent.dir`.
4. Add a third block to `promptInput`, after posts:
   `asData("connections_strongest_first", lines.join("\n") || "No recorded interactions with other accounts.")`.
5. Write `connectionCount: lines.length` into `newSummary`.

### 2. `shared/schema.ts`
- `AccountAiSummary` gets `connectionCount?: number`. It's optional, so archived summaries still
  type-check. The column is jsonb, so there's no migration.

### 3. `DEFAULT_ACCOUNT_PROMPT`
Add a fifth point and say what the new block means:
> …4) Notable events or timeline changes, and 5) Closest connections: who this account interacts
> with most, how (comments, mentions, bio), whether it's mutual, and any shift over time. Use the
> connections list for this, and the posts for context about those people.

Anyone with a customized prompt still gets the data block, but has to add the instruction
themselves. Mention this in the prompt help text on the Summaries settings page
(`client/src/pages/instagram-summaries.tsx`, near line 713) in one line.

### 4. UI (small)
- Where the summary card or tab shows the post/story counts, add `· N connections` when
  `connectionCount` is set. There's nothing else to build: the profile text is already rendered.

## Not doing
- No connections-changed trigger or auto re-summary (see decision 3).
- No per-connection post excerpts. The posts block already carries the context.
- No new setting for N. Change the constant if 20 turns out wrong.

## Build order
1. Schema type (`connectionCount`).
2. `runAccountSummaryJob`: fetch, format, add the prompt block, save the count.
3. Default prompt text and the settings-page note.
4. Count badge in the summary UI.
5. Check: regenerate the summary for an account with a busy Connections tab and confirm the
   profile names its top connections. Then run one for an account with no connections and confirm
   the empty-list line doesn't confuse it.
