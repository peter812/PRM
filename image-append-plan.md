# Image append + AI backend notes: plan

Two linked features:

1. **Append to an image summary.** The person adds a correction or extra fact to one image's
   description in the post dialog ("the kid is her nephew Sam, not her son"). PRM keeps that text on
   the image, re-runs the vision model on that image with the text added to its prompt, rebuilds
   the post summary, and the post save marks the account summary out of date (and queues it when
   auto account summaries are on). That last part already happens in `savePostSummary`.
2. **`ai_backend_notes`** on `people` and `social_accounts`. These are durable facts the LLM pulls out
   of an append ("the house in the beach photos is a friend's, not his") and every later scene,
   post and account summary for those entities reads them, so the same mistake isn't made again.

## Decisions to confirm

| # | Question | Proposal |
|---|---|---|
| 1 | What does an append do to the image description? | **Decided: re-run vision on that image** with the user's text added to the scene prompt. The new output replaces `images[i].description`. The text itself is kept as `images[i].appended: string[]` so every later run (including a full Regen) passes it to the vision model again. |
| 2 | Which images re-run? | **Only the fixed image.** The other images in the carousel reuse their existing descriptions, then the combine step runs again. |
| 3 | Who writes `ai_backend_notes`? | The LLM, during the append job (step 4 below). People can view and delete notes. Manual add is **out for now**; say if you want it. |
| 4 | Column shape | `jsonb` array of `{ text, source, createdAt }` rather than free text, so each note can be shown with its source post and deleted on its own. |
| 5 | Append while a post job is pending or running | **409.** `summary_jobs_live_uniq` would drop the second job and lose the notes step. The UI already disables the summary controls while a job runs. |

---

## 1. Schema (`shared/schema.ts`, `server/db-init.ts`)

```ts
export interface AiBackendNote {
  text: string;
  source: { kind: "post_append"; postId: string; imageIndex: number } | { kind: "manual" };
  createdAt: string; // ISO
}

export interface PostImageSummary {
  imageIndex: number;
  description: string;
  appended?: string[];   // new: the person's corrections, oldest first
}
```

- `people.aiBackendNotes` and `socialAccounts.aiBackendNotes`:
  `jsonb("ai_backend_notes").$type<AiBackendNote[]>().notNull().default(sql\`'[]'::jsonb\`)`.
- db-init: add `ai_backend_notes: "JSONB NOT NULL DEFAULT '[]'::jsonb"` to the `people` block
  (~line 381) and the `social_accounts` block (~line 466).

## 2. Endpoint (`server/routes/summaries.ts`)

`POST /api/social-posts/:id/images/:imageIndex/append` with body `{ text: string }`, which must be
non-empty and at most 1,000 characters.

1. Load the post. Return 404 if it doesn't exist, and 409 if `summaryDisabled("post")` or there is a
   live post job for it (see decision 5).
2. Return 409 if `aiSummary.images` has no entry for `imageIndex`. You can only append to a
   described image.
3. In one `UPDATE`, push `text` onto `images[imageIndex].appended` inside `ai_summary`, using
   `jsonb_set` so no concurrent write is clobbered.
4. `enqueueSummaryJob("post", post.id, post.socialAccountId, { append: { imageIndex, text } })`.
   Manual action, so `bannedActions` is not checked. That matches the existing POST summary route.
5. Return `{ queued: true }`.

Optional: `DELETE /api/social-posts/:id/images/:imageIndex/append/:n` to remove an append, which
queues the same rebuild without `append`. Include it only if you want undo.

## 3. Job changes (`server/summary-queue.ts` → `runPostSummaryJob`)

- **Re-run only the fixed image when `job.options.append` is set.** Seed `prior` from
  `post.aiSummary.images`, matched to `mediaUrls` by `imageIndex`, instead of only from
  `job.progress`. Every image except `append.imageIndex` is then already `done`, so only that one
  goes back through `describeOne` (vision).
- **User context in the scene prompt, on every run.** In `describeOne`, when the image has
  `appended` entries, add `\n\nCorrections from the user about this image (treat as true): …` after
  the recognized-people line. This applies to the Fix job and to any later full Regen, so the
  corrections are never lost.
- **Carry appends forward.** Build `imageSummaries` with `appended` copied from the current
  `post.aiSummary.images[i].appended`.
- **Combine step.** Render each image as
  `Image N: <description>\n  User correction: <appended…>`. The "1 image, no transcript →
  overview = description" shortcut can stay: the re-run description already includes the
  correction.
- **`savePostSummary` merge guard.** Just before writing, re-read `ai_summary->'images'` and keep any
  `appended` entries this run didn't see (one added mid-run). This is one small merge by
  `imageIndex`.
- Stories (`runStorySummary`) are out of scope: they have no per-image descriptions to append to.

## 4. Note extraction (new step, append jobs only)

A new function `extractBackendNotes(post, imageIndex, appendText, settings)` runs in the post job
after the combine step and before `savePostSummary`, so it gets the job's retries and host pool. Its
progress shows as a new step `notes` in `SummaryJobProgress`.

- **Candidates.** Gather the entities the note could be about and label each:
  - the post's account (`A1 @username`);
  - its owner (`socialAccounts.ownerUuid` → `P1 First Last`);
  - the people and accounts recognized in that image (reuse `resolveRecognizedPeopleForPost`,
    extended to return ids as well as names).
- **Prompt.** Use the text model with `DATA_TAGS_NOTE`. The input is the image description, the
  append text and the candidate list, plus each candidate's existing notes so it doesn't repeat
  them. Ask for JSON only: `[{ "target": "P1", "note": "…" }]`, which may be `[]`. One sentence per
  note, durable facts only (relationships, ownership, places, identity), nothing about this one
  photo.
- **Write.** Drop any target not in the candidate list. Append to that row's `ai_backend_notes` with
  `source: { kind: "post_append", postId, imageIndex }` (one `jsonb ||` update per target), then
  `syncEntityInBackground` for that entity.
- A failed parse logs and continues. The summary rebuild matters more than the note.
- Add a setting `summary_notes_prompt` with a default prompt, alongside the other prompts in
  `SummarySettings` and `/api/summary/settings`, so it can be tuned like the rest.

## 5. Feed notes into future summaries

A helper `backendNotesBlock(personIds, accountIds)` returns
`asData("known_facts", "- @user: …\n- First Last: …")`. It caps output at the newest 20 notes per
entity, or an empty string when there are none.

| Step | Notes included |
|---|---|
| Scene (per image) | post account, its owner, people/accounts recognized in that image |
| Post combine / story | post account, its owner, everyone recognized in the post |
| Account summary | the account and its owner |

Add one line to each default prompt: "Treat known_facts as corrections from the user; they override
what the images seem to show." Then mention it in the plan's changelog, because existing users who
customized their prompts won't get the line. The block is appended in code either way, so a
custom prompt still receives the facts.

## 6. UI

- **`client/src/components/account-summary.tsx` → `PostSummarySection`**
  - Relabel the **Regenerate** button to **Regen** (`button-summarize-post`; "Summarize" stays for
    a post with no summary yet).
  - Add a **Fix** button directly to the left of Regen (same `ghost`/`h-6` styling,
    `data-testid="button-fix-image"`). It acts on the image currently shown (`currentImageIndex`)
    and opens an inline `Textarea` with Save/Cancel. Save calls the endpoint, then invalidates
    `/api/social-posts/${postId}/summary`; the existing 3s poll shows progress. Hide it when the
    current image has no description yet (and for stories); disable it while `isRunning`.
  - Under `imageDesc`, list the current image's `appended` entries (muted, with a "You:" prefix).
  - Add `notes` to the status shown by `postJobProgress`.
- **Notes panel (new `client/src/components/ai-backend-notes.tsx`).** Shows a read-only list of notes
  with their source (linking to the post) and a delete ✕, and is used in:
  - `client/src/pages/social-account-profile.tsx`, Summary tab;
  - `client/src/pages/person-profile.tsx`, mirrored to `me-profile.tsx`.
- **Endpoints for the panel.** `GET` / `DELETE` at
  `/api/people/:id/ai-backend-notes[/:idx]` and `/api/social-accounts/:id/ai-backend-notes[/:idx]`.
  Deleting a note on an account also marks that account's summary invalidated, so it reflects the
  change.

## 7. Order of work

1. Schema + db-init columns + types.
2. Carry appends forward in `runPostSummaryJob` / `savePostSummary`, and seed `prior` from the
   existing summary.
3. Append endpoint, then the Fix button and the Regen relabel. At this point the chain works end to end without
   notes: append → post rebuild → account invalidated / auto-queued.
4. `extractBackendNotes` + notes prompt setting.
5. Feed `known_facts` into the scene, post, story and account prompts.
6. Notes panel + GET/DELETE endpoints on person, me and social account pages.

## Verification

- Fix image 2 of a carousel. Check that the log shows exactly one vision call (image 2), that its
  description now reflects the correction, that the `overview` changes, that `images[1].appended` holds the text, that the account shows
  `aiSummaryInvalidated = true`, and that an account job is queued if auto is on.
- Append "the boy is her nephew Sam" on a post where the owner is linked to a person. Check that a
  note lands on that person and shows on the person page.
- Click Regen on that post. Check that every image re-runs vision, the append survives, and the
  new description doesn't contradict it.
- Run the account summary. Check that the prompt input contains the `known_facts` block.
- Delete the note. Check that the account summary is marked invalidated.
