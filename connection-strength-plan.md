# Connection strength plan

_Status: built. `shared/connection-strength.ts`, `server/connection-strength.ts`,
`server/routes/connections.ts`, `client/src/components/connections-tab.tsx`,
`client/src/components/connection-weights-card.tsx`._

How strongly two Instagram accounts are connected, from what they actually do
with each other, weighted so recent activity counts more but old activity never
disappears. Shown as a new **Connections** tab on the social account page.

## 1. Signals

Every signal becomes a directed **event** `from → to, kind, at, postId?`.
For the account being viewed (X), each other account (Y) gets events in both
directions: *out* (X did it to Y) and *in* (Y did it to X).

| Kind | Event | Source |
|---|---|---|
| `comment` | commenter → post author (and each coauthor) | `social_post_comments.username` + `posted_at` → `social_account_posts.social_account_id`, `coauthor_account_ids`. At most one per (commenter, post). |
| `story_mention` | story author → mentioned account | `social_account_posts.mentioned_accounts` where `post_type = 'story'`, `posted_at` |
| `post_mention` | post author → tagged or captioned account | `mentioned_accounts` (photo tags) + `@handles` in `description`, where `post_type <> 'story'`. Stories do the same and count as `story_mention`. |
| `post_mention` (face) | post author → account whose face is in the photo | `photos.prm_location = 'post:<id>'` → `faces.photo_id` → `faces.personface_uuid` → `social_accounts.personface_uuid`, or `people.personface_uuid` → that person's Instagram accounts (`social_accounts.owner_uuid`). The author's own face is skipped. |
| `bio` | bio owner → each `@handle` in the bio | `social_accounts.bio` (current) + `social_account_history.previous_bio` (past) |

Deduping: a post that both tags Y and shows Y's face is **one** `post_mention`.
The same goes for a story (a mention plus a face = one `story_mention`).

Usernames are matched case-insensitively against `social_accounts.username`.
Commenters or handles that have no account row are left out (we don't create accounts).

### Bio details
- A bio mention is a standing state, not a repeated event. It adds its weight once,
  dated to when the handle first appeared in the bio. That date comes from the oldest
  history entry whose bio contained it, falling back to the account's first capture.
- **Heart:** any heart emoji (❤ ❤️ 🤍 🖤 💕 💖 💗 💘 💙 💚 💛 🧡 💜 🤎 🩷 🩵 🩶 💞 💓 💝 ♥)
  within a few characters of the `@handle` multiplies the bio weight (default ×2).
- **Removed from bio:** it keeps counting, but its age is measured from the
  **removal date** (the history entry where it disappeared), not the date it was added.
  While it's still present, its age is 0, so it counts at full value.

## 2. Time decay

```
factor(ageDays) = max(0.5, 1 - ageDays / 1460)
```

This is a straight line: 100% today, 87.5% at 6 months, 75% at 1 year, 50% at 2 years,
then flat at 50% forever. Old interactions always keep half their value.

## 3. Score

```
event value   = weight[kind] × (kind = bio && heart ? heartMultiplier : 1) × factor(age)
score(X, Y)   = Σ values of events X→Y and Y→X
```

We also return `out`, `in` and a per-kind breakdown, so the UI can show who puts in
the effort. There's no log damping and no reciprocity bonus. The one-comment-per-post
rule is what stops a single long thread from dominating the score.

## 4. Settings (editable weights)

- `app_settings` key `connection_strength`, stored as JSON:
  `{ comment: 5, storyMention: 5, postMention: 5, bio: 5, heartMultiplier: 2 }`
- The four weights are 0–10 sliders, default 5. The heart multiplier is a small number input.
- The UI goes in the existing [social-graph-settings.tsx](client/src/pages/social-graph-settings.tsx).
  `GET`/`PUT /api/settings/connection-strength`.
- Decay stays fixed in code (the 2-year / 50% rule above). No setting for it unless asked.

## 5. Code layout

- **`shared/connection-strength.ts`**: `DEFAULT_WEIGHTS`, `decayFactor()`,
  `eventValue()`, `scoreAt(events, date)`. This is the one place the math lives,
  and both server and client use it.
- **`server/connection-strength.ts`**: `getConnectionEvents(accountId)` runs one SQL
  query that `UNION ALL`s the five sources above for events touching X (both
  directions), using `jsonb_array_elements(mentioned_accounts::jsonb)` for mentions.
  Bio parsing and heart detection happen in TS. Rows are grouped by the other account.
- **Route** `GET /api/social-accounts/:uuid/connections`, which returns
  ```ts
  { since: string,            // X's joinedAt ?? internalAccountCreationDate
    weights: Weights,
    connections: Array<{
      account: { id, username, nickname, imageUrl },
      score, in, out, byKind: Record<Kind, number>,
      lastInteractionAt,
      events: Array<{ at, kind, dir: 'in' | 'out', heart?: boolean }>
    }> }                      // sorted by score desc
  ```
  It's computed per request. Only one account's events are loaded, which is small at
  the 10k ceiling, so there's no materialized table and no nightly job.

## 6. Connections tab (social account page)

- New `"connections"` entry in `VALID_TABS` and a trigger/content pair in
  [social-account-profile.tsx](client/src/pages/social-account-profile.tsx), in a new
  `client/src/components/connections-tab.tsx`.
- One row per connected account: avatar, @username, score, an in/out split,
  per-kind chips (💬 comments, 📖 stories, 🏷 posts, 🔗 bio ❤️), and last interaction.
- **Mini graph per row:** a small inline SVG (no chart library).
  - x-axis runs from **this account's creation** (`joinedAt`, falling back to first seen)
    to **today**. It's the same axis for every row, so rows can be compared.
  - y is the **running strength**: `scoreAt(events, t)` sampled monthly. It steps up at each
    interaction. Because of the decay floor, it only ever eases down slowly between
    interactions and never loses more than half of what was gained. Its right end is
    exactly the score shown in the row.
  - All rows share one y scale (the top score), so a taller graph means a stronger connection.
- Filter box and a sort (score / most recent). Clicking a row opens that account.

## 7. Build order

1. `shared/connection-strength.ts` + unit sanity check of `decayFactor`/heart detection.
2. Server event query + route; verify against an account with known comments/stories.
3. Settings key + sliders.
4. Connections tab + sparkline.
5. (Later, optional) Feed `score` into `connectionStrength` in people-groups and graph edge weights.

## Caveats

- Scores only reflect what was scraped. Accounts checked often will show more comments
  and stories than equally close ones that are checked rarely.
- X→Y comments are only visible if Y's posts were scraped.
- Face events depend on face grouping. Unconfirmed auto-matches (`faces.auto_match_score`
  not null) are **included**; dismissed faces are not.
