# Potential Groups — "Why are these grouped?" explainer

Clicking the **% Cohesion** chip on a potential group card asks the LLM to explain why
those accounts clustered. The explanation is built from the signals the clustering
already computes. Nothing is generated until the chip is clicked.

## Scope (decided)

- Only for **Social Accounts + Smart Multi-Signal (`hybrid`)**. Other strategies and the
  People branch keep the plain badge.
- Explanations are **saved into the task's result JSON**, so reopening one is instant.
- The LLM returns three things: a **short explanation**, a **better group name**, and
  comments on **outlier members**.
- The prompt includes usernames and bios for the **top ~15 hubs** (wrapped with `asData`)
  plus the aggregate signal stats.

## 1. Record signal attribution — `server/task-worker.ts` `processFindPotentialGroups`

Today `edgeWeights` is one number per pair, so we can't tell which signal joined two
accounts. The changes:

- Give `addWeightedEdge(u, v, w, signal)` a signal tag:
  `"mutualFollow" | "oneWayFollow" | "coFollow" | "coMention" | "bio"`. Keep the summed
  weight in `edgeWeights` as it is (Louvain is unchanged). When `strategy === "hybrid"`,
  also add `w` to `edgeSignals: Map<key, Record<Signal, number>>`.
- Hybrid currently runs `select … from socialFollows` twice (once for Signal A, once for
  Signal B). Load it once and reuse it. Keep `followedToFollowers` in scope for step 2.
- Signal C: also count co-mention posts per pair (`edgeSignals[key].coMention` already
  holds weight / 2.5).

## 2. Per-group `signals` summary (hybrid only)

Add this to each result inside the existing per-community loop:

```ts
signals?: {
  internalWeightBySignal: Record<Signal, number>;   // summed over internal edges
  sharePct: Record<Signal, number>;                 // % of internalWeight
  pairCounts: { mutualFollow; oneWayFollow; coMentionPairs; coFollowPairs; bioPairs };
  topSharedFollows: { username: string; memberCount: number }[]; // top 5 accounts most members follow
  keywordCounts: { keyword: string; memberCount: number }[];     // topKeywords + counts
  topPairs: { a: string; b: string; weight: number; dominant: Signal }[]; // 5 strongest internal edges
  weakMembers: { id: string; username: string; fit: number }[];  // fit = internal / total weight, < 0.3, max 5
}
```

- `topSharedFollows`: for each member, walk the accounts it follows (a follower → followed
  map built once from the shared follows query) and count. Bounded by the 10k import
  ceiling, so no special handling.
- `weakMembers` is **computed in code, not guessed by the LLM**. The LLM only words why
  each one fits weakly. That keeps outlier picks grounded and checkable.
- This adds a few KB per group to `task.result`, which is fine.

## 3. Explain endpoint — `server/routes/people-groups.ts`

`POST /api/potential-groups/results/:taskId/explain/:groupId` (`?regenerate=1` to force a new one)

1. Load the task, parse `task.result`, and find the group. Return 404 if either is missing,
   and 400 if the group has no `signals` (not hybrid).
2. If `group.explanation` exists and this isn't a regenerate, return it.
3. `resolveModel("text")` → `chat(...)` with `think: false` and a JSON-schema `format`:
   `{ explanation: string, suggestedName: string, outliers: { username, reason }[] }`.
4. Prompt:
   - System: the role ("explain why a community-detection algorithm grouped these social
     accounts; cite the strongest signals; be concrete, 2–4 sentences") + `DATA_TAGS_NOTE`
     + a one-line glossary for each signal (mutual follow = 3.5, co-follow = audience
     overlap, co-mention = tagged together in posts, bio = shared rare keywords).
   - User: the signal stats as plain numbers, then
     `asData("members", <top 15 hubs: @username — bio>)`, `asData("shared_follows", …)`,
     and `asData("weak_members", …)`.
5. Check the reply: drop any outlier whose username isn't in `weakMembers`, and trim the name.
6. Write `group.explanation = { explanation, suggestedName, outliers, model, generatedAt }`
   back into the result array → `storage.updateTaskStatus(taskId, task.status, JSON.stringify(results))`.
   (This is a read-modify-write. Two explains finishing at the same moment could lose one;
   that's acceptable for a single user. Re-read just before writing to narrow the window.)
7. `AiConfigError` → 400 with its message (same as `describe-me.ts`).

## 4. Client — `client/src/pages/potential-groups.tsx`

- Add `signals?` and `explanation?` to `PotentialGroupResult`.
- Cohesion chip (line ~564): if `result.signals` exists, render a `Button`
  (`variant="ghost" size="sm"`, same primary/15 styling, plus an info/sparkle icon).
  Otherwise keep the `Badge`.
- On click, open an **Explain dialog** for that result:
  - **Instant section (no LLM):** a stacked bar of `sharePct` per signal, the top shared
    follows, and keyword counts. It shows right away from `signals`.
  - **LLM section:** a `useMutation` that POSTs to the explain endpoint. It fires on open
    only if `result.explanation` is missing, and shows a skeleton while loading. On
    success, patch the `["/api/potential-groups/results", taskId]` query cache so the card
    remembers the explanation.
  - **Suggested name** with a "Use this name" button → opens the existing promote dialog
    with `newGroupName` prefilled.
  - **Outliers** list with reasons, plus a "Promote without these" button → opens the
    promote dialog with those ids removed from `selectedMemberIds`.
  - A "Regenerate" link (`?regenerate=1`).

## 5. Verify

- Run hybrid on Social Accounts. Cards show the cohesion button. Running `co_following`
  shows the plain badge.
- Open a group: the bar shows immediately, then the LLM text arrives. Reopen it, or reload
  the page and reopen it: no new LLM call (check the network tab).
- With no text model configured: a clear 400 toast, and the instant section still shows.
- Outlier "Promote without these" unchecks exactly those members.

## Out of scope

People-branch explanations, explaining non-hybrid strategies, and batch-explaining all groups.
