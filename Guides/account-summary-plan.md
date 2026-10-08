# Account & Post Summary Plan

Per-post and per-story VLM summaries combined into an account-level summary, backed by a dedicated historical account summaries table, invalidation tracking, configurable auto-summarization flows, and new settings & profile UI.

## What exists today
- Posts and stories share `social_account_posts`, split by `postType`. Images are a JSON array in `content`, and `videoTranscript` and `metadata` are already there.
- A persistent queue pattern exists in the `osint_scans` table, the runner in `server/osint-scan-queue.ts`, and the Tasks pages (`client/src/pages/osint-tasks.tsx`, `client/src/pages/social-tasks.tsx`).
- Ollama settings are `ollama_*` keys in `app_settings`, and `describeImageWithOllama` in `server/routes/ai-vector.ts` is the pattern for the VLM call, including how it injects recognized people.
- `AccountOsintCard` (`client/src/components/osint-results.tsx`) on `social-account-profile.tsx` provides an expandable card pattern on the account overview tab.
- Account tracking interest levels (`account-tracking.tsx` / `social_accounts`) already exist for filtering high-interest accounts.

---

## 1. Automated Workflow & Trigger Logic

When a post or story is added (`Post added`):
1. **Check `Are post summaries enabled?`** (and auto post summaries enabled):
   - **No:** Do nothing.
   - **Yes:** Run post summary:
     1. **For each image:** Apply each image to the selected scene description model (`ollama_social_vision_model`) with a predefined image prompt.
     2. **Combine the results:** Merge the per-image descriptions with the post context (caption, mentions, hashtags, location, comments, video transcript, recognized people, post date) using the post summary prompt (`ollama_social_summary_model`).
2. **After post summary completes, check `Is social account summary on?`**:
   - **No:** Do nothing.
   - **Yes:** Set the current account summary as **out of date** (`ai_summary_invalidated = true`, `ai_summary_invalidated_at = now()`).
3. **Check `Is auto social account summary on?`**:
   - **No:** Do nothing (summary remains flagged as out of date until manually updated).
   - **Yes:** Queue and run the social account summary job.

---

## 2. Data & Schema (`shared/schema.ts`, `server/db-init.ts`)

> **Note:** Creating a new account summary is **not** an event that creates a whole account snapshot in `social_account_history`. Instead, current summary state lives directly on `social_accounts` and prior versions are archived in a dedicated `historical_account_summaries` table.

### `social_account_posts`
- `ai_summary jsonb`: `{ overview, images: [{ description, text, people, setting }], tags }`
- `ai_summary_at timestamp`
- `ai_summary_model text`

### `social_accounts`
Holds the active summary state and invalidation metadata, plus references to archived summaries:
- `ai_summary jsonb`: Current active summary content (`{ profile, coveredPostIds, ... }`).
- `ai_summary_generated_at timestamp`: When the current summary was generated.
- `ai_summary_invalidated boolean` (default `false`): Whether a new post/story or change has made the current summary out of date.
- `ai_summary_invalidated_at timestamp`: When the current summary was marked out of date.
- `ai_summary_model text`: The LLM model used to generate the current summary.
- `historical_summary_ids text[]` (or JSONB array of UUIDs): UUIDs referencing previous summaries in `historical_account_summaries`.

### `historical_account_summaries` (New Table)
Stores prior versions of an account's summary when a new summary replaces an existing one:
- `id varchar` (UUID primary key)
- `social_account_id varchar` (foreign key to `social_accounts.id`, indexed)
- `content jsonb` (or `text`): The archived summary content.
- `model text`: Model used to generate that summary.
- `created_at timestamp`: When this summary was originally generated.
- `invalidated_at timestamp`: When this summary was first marked out of date.
- `replaced_at timestamp`: When a newer summary replaced this one and moved it to history.

### `summary_jobs` (Queue Table)
Modeled on `osint_scans`:
- Columns: `id`, `kind` (`image`, `post`, or `account`), `target_id`, `status`, `attempts`, `error`, `options`, timestamps.
- Partial unique index allowing one live job per `(kind, target_id)`.

---

## 3. Queue and Workers (`server/summary-queue.ts`)

The runner ticks like the OSINT queue runner. Concurrency defaults to 1 and is configurable. Failed jobs retry up to 3 times, and jobs left running at restart are reset.

- **Image job (VLM):**
  1. Load one image through `fetchImageBuffer`.
  2. Send the predefined scene description prompt along with image context (caption, mentions, hashtags, location, recognized people).
  3. Call Ollama `/api/chat` with a JSON-schema `format` and the selected vision model (`ollama_social_vision_model`).
  4. Save the result under that image's slot in the post's `ai_summary.images`.
- **Post job (LLM combine):**
  1. Runs once every image job for the post has completed.
  2. Combines all per-image results with the full post context (caption, mentions, hashtags, location, capped comments, video transcript, recognized people across images, post date) using the **Post Summary Prompt** and `ollama_social_summary_model`.
  3. Writes `ai_summary`, `ai_summary_at`, and `ai_summary_model` on `social_account_posts`.
  4. Evaluates the post-completion trigger flow:
     - If **Account Summaries** are enabled (`summary_account_enabled`), marks the parent `social_accounts` row as invalidated (`ai_summary_invalidated = true`, `ai_summary_invalidated_at = COALESCE(ai_summary_invalidated_at, now())`).
     - If **Auto Account Summaries** are enabled (`summary_account_auto_enabled`), enqueues an `account` summary job for that social account.
- **Account job:**
  1. Runs once the account has no pending `image` or `post` summary jobs.
  2. Loads post and story summaries in chronological order (including deleted posts and expired stories) and synthesizes the account profile using the **Account Summary Prompt** (with windowing/map-reduce if needed for large accounts, and SQL-computed co-appearance counts).
  3. If the account already has an existing `ai_summary`:
     - Inserts a row into `historical_account_summaries` with a new UUID, the old `ai_summary` content, `created_at = ai_summary_generated_at`, `invalidated_at = ai_summary_invalidated_at`, `replaced_at = now()`, and `model = ai_summary_model`.
     - Appends the new historical UUID to `social_accounts.historical_summary_ids`.
  4. Updates `social_accounts` with the new `ai_summary`, sets `ai_summary_generated_at = now()`, clears `ai_summary_invalidated = false` and `ai_summary_invalidated_at = null`, and records `ai_summary_model`.

---

## 4. Settings & Prompts (`app_settings`)

Settings keys stored in `app_settings`:
- **Post Summary Toggles & Actions:**
  - `summary_post_enabled` (`boolean`): Enable post summaries.
  - `summary_post_auto_enabled` (`boolean`): Enable auto post summaries when new posts/stories are added.
  - Action endpoint: **Run all historical posts through summaries** (enqueues unsummarized historical posts/stories).
- **Account Summary Toggles & Actions:**
  - `summary_account_enabled` (`boolean`): Enable account summaries (and invalidation tracking when posts are summarized).
  - `summary_account_auto_enabled` (`boolean`): Enable auto account summaries when an account summary is invalidated.
  - Action endpoint: **Run account summaries for all accounts with selected interest level and above** (enqueues account summary chains for accounts matching the minimum tracking/interest level threshold).
- **Models & Prompts:**
  - `ollama_social_vision_model`: Scene description VLM model for per-image analysis.
  - `ollama_social_summary_model`: LLM model for post combination and account summary generation.
  - `summary_image_prompt`: Scene description prompt applied per image (with default in code).
  - `summary_post_prompt`: Post summary prompt to combine image results and post metadata (with default in code).
  - `summary_account_prompt`: Account summary prompt to synthesize post summaries into an account profile (with default in code).

---

## 5. Endpoints

- `POST /api/social-posts/:id/summary` — Queues the image jobs and post summary job for a single post or story.
- `GET /api/social-posts/:id/summary` — Returns the post summary and active job status.
- `POST /api/summary-queue/posts/historical` — Queues post summaries for all unsummarized historical posts/stories.
- `POST /api/social-accounts/:id/summary` — Queues any unsummarized posts/stories for the account plus the account summary job.
- `GET /api/social-accounts/:id/summary` — Returns the current summary from `social_accounts` (including `generatedAt`, `invalidated`, `invalidatedAt`, `model`), active job progress, and the list of archived summaries from `historical_account_summaries`.
- `POST /api/summary-queue/accounts/by-interest` — Takes `{ minInterestLevel }` and queues account summaries for all qualifying social accounts.
- `GET`, `DELETE`, and retry endpoints on `/api/summary-queue` — Mirror the OSINT queue endpoints.
- `GET` and `POST /api/summary/settings` — Read and update all summary toggles, model selections, and prompts.

---

## 6. Frontend UI

### 1. Options Page: Social Accounts -> Summaries (`/settings/instagram/summaries`)
Add a new subpage under the **Instagram / Social Accounts** section in `client/src/pages/settings-layout.tsx` called **Summaries** (`client/src/pages/instagram-summaries.tsx`):
- **Post Summaries Section:**
  - Toggle: **Enable post summaries**
  - Toggle: **Enable auto post summaries**
  - Action button: **Run all historical posts through summaries** (with confirmation / count of queued posts)
- **Account Summaries Section:**
  - Toggle: **Enable account summaries**
  - Toggle: **Enable auto account summaries**
  - Action control: **Run account summaries for all accounts with selected interest level and above** (interest level selector + run button)
- **Models & Prompts Section:**
  - Model pickers for the scene description VLM and summary LLM
  - **Post summary prompt** textarea (plus scene description prompt if separated, with "Reset to default")
  - **Account summary prompt** textarea (with "Reset to default")
- **Queue / Tasks View:**
  - Queue status monitor (or link/tab in Tasks) to inspect running/pending/failed summary jobs.

### 2. Social Account Page: Expandable Summary Card (Next to OSINT)
On the Account overview tab in `client/src/pages/social-account-profile.tsx`:
- Place an expandable **Summary** card (`AccountSummaryCard`) alongside the existing `AccountOsintCard` (to the right of the OSINT card in a 2-column grid, or paired directly beside it).
- Displays status badges in the header:
  - Up-to-date badge (green) with generation timestamp, **or**
  - **Out of date / Invalidated** badge (yellow/amber) showing when it was invalidated due to new posts/stories, **or**
  - Unsummarized badge.
- When expanded:
  - Shows a preview/overview of the current account summary, model used, generated timestamp, and invalidation notice if out of date.
  - Buttons to **Generate Summary** / **Update Summary**, plus a link to open the full **Summary** subpage/tab.

### 3. Social Account Subpage / Tab (`?tab=summary`)
Add a new **Summary** tab (`summary` in `VALID_TABS`) in `client/src/pages/social-account-profile.tsx`:
- **Current Summary Panel:**
  - Full rendered account summary, model badge, `generatedAt` timestamp.
  - Prominent **Out of Date** banner if `ai_summary_invalidated` is true (showing `ai_summary_invalidated_at` and an **Update Summary** button).
  - Button to manually regenerate/update the summary.
- **Historical Summaries Panel:**
  - Lists all previous versions fetched from `historical_account_summaries` (ordered newest to oldest).
  - Each historical entry shows its UUID, model used, **Created**, **Invalidated**, and **Replaced** timestamps, and allows viewing/comparing the historical summary content.

### 4. Post & Story Detail Views
- **`PostDetailDialog` (`client/src/components/post-detail-dialog.tsx`):** Summary section displaying the combined post overview, per-image scene descriptions, and a **Summarize / Regenerate** button (when post summaries are enabled).
- **`StoryDialog` (`client/src/components/stories-tab.tsx`):** Summary strip with a **Summarize** button if none exists.

---

## 7. Build Order
1. **Schema & Migrations:** Add summary columns to `social_account_posts` and `social_accounts`, create `historical_account_summaries`, and create `summary_jobs` in `shared/schema.ts` and `server/db-init.ts`.
2. **Settings & Prompts:** Add settings keys, default prompts, and `/api/summary/settings` endpoints.
3. **Queue Runner & Post Pipeline:** Implement `server/summary-queue.ts` with per-image VLM scene descriptions, post combination, and post-import trigger hooks (`Post added` -> check enabled -> run post summary -> mark account summary invalidated -> optionally auto-run account summary).
4. **Account Summary & History Archiving:** Implement the account summary worker that archives existing summaries into `historical_account_summaries` (recording creation, invalidation, and replaced timestamps) and updates `social_accounts`, plus bulk endpoints (historical posts & accounts by interest level).
5. **Options Page (`/settings/instagram/summaries`):** Build the new Summaries settings subpage under Instagram/Social Accounts.
6. **Social Account UI:** Add the expandable Summary card next to the OSINT card on the account overview, the new `Summary` subpage/tab (`?tab=summary`) with current & historical summaries, and post/story modal summary views.
