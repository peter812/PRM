# Face review — plan

Face recognition already runs automatically on profile pictures, posts and
stories (`server/recognition.ts`). Each detected face ends up as a `faces` row
plus an entry in `photos.facial_ids` (`{ faceUuid, coordinates, personId,
socialAccountId }`). A face is identified once its face group
(`personface_uuid`) is shared with a social account or a person. Nothing
walks the user through the faces that *aren't* identified in context.
`/unknown-faces` shows bare face crops grouped by `personface_uuid`, without
the photo they came from, who posted it or who was tagged.

This plan replaces `/unknown-faces` with a **Face review** page. It shows the
whole image with a coloured box around each face, and one-click suggestions
that come from what we already know about the image:

| Tab | Source images | Suggestions per face |
|---|---|---|
| **Stories** | `photos` with `prm_location = post:<id>` where the post is a story | the story's account (owner), then its @mentions |
| **Profile images** | current profile pictures (`profile_image:<accountId>`) that auto-link left unresolved | the connected account |
| **Posts** | `photos` of non-story posts, one per carousel slide | the poster and coauthors, then accounts tagged **on that slide** |
| **Messages** | `photos` with `prm_location = message:<id>` | the sender, then the conversation's participants |

Every tab also shows **look-alikes** for each face: the known identities
whose faces are most similar to it (§3.6).

Decisions (2026-09-27):

| Question | Answer |
|---|---|
| Where | Replaces `/unknown-faces` (same route and sidebar entry). The old face-group grid is deleted |
| Profile images in scope | Only unresolved ones: `multiple_faces`, `face_too_small`, `group_conflict`, `face_missing`, or an account with no `personface_uuid` yet. Single-face auto-links are not re-shown |
| Mentions of a group/brand account | Out of scope for this build. The suggestion is just not picked |
| Story mentions | Yes. Stories suggest their @mentions exactly like posts (`stories.ts` already writes `mentionedAccounts` for imageIndex 0) |
| Known faces | A second page, **Faces** (`/faces`), with one card per named identity (a person, an account, or both). Clicking a card shows every photo that face is in, with a link to where each photo lives (§5) |
| Look-alike suggestions | Yes. Each face gets its top 3 most similar known identities, compared by face embedding (§3.6) |
| Duplicate identities | They should never happen: linking folds groups together (§3.3). If one does slip through, the Faces pop-up has a **Merge with…** button (§5.2) |
| Messages | A 4th tab. Message photos aren't face-recognised today, so this adds a `message` kind to auto-recognition and backfill (§3.7) |
| Undoing a dismiss | A **Dismissed** filter on Face review, with an Undismiss button (§4.1) |

---

## 1. What "needs review" means

A **photo** is in the queue when it has at least one face that is:

- **unidentified**: its `facial_ids` entry has `personId` and
  `socialAccountId` both null, *and* its face group isn't linked to an account
  or person (re-checked live, because `facial_ids` is only refreshed on
  recognition runs and `face/connect`), and
- **not dismissed**: see §2.

Profile images get one more rule: a photo is included only when it is the
account's **current** picture (`photos.location = social_accounts.image_url`,
same as `associateProfileFaces`) **and** it is `>= HQ_MIN_WIDTH`. It then
shows up when either the account has no face group yet, or a face in it is
unidentified.

Photos leave the queue on their own once every face is identified or
dismissed. There is no per-photo "done" flag.

## 2. Schema

One column. No new table.

```ts
// faces
dismissedAt: timestamp("dismissed_at", { withTimezone: true }), // "not someone I track": Face review stops asking about this face
```

- It lives on `faces`, not in `facial_ids`, because `runFaceRecognition`
  rewrites `facial_ids` wholesale on every re-run.
- It is per face, not per face group. Dismissing a stranger in one story
  shouldn't hide that same stranger elsewhere if they later become someone
  you care about. (Open question Q2 below.)
- Add it in `db-init.ts` the same way as the other additive columns
  (`ALTER TABLE faces ADD COLUMN IF NOT EXISTS dismissed_at timestamptz`).

`image_questions` is **not** reused. It is a separate, older per-face
question flow tied to the manual upload path, and its pending count currently
drives the sidebar badge (§4.3).

## 3. Server

New module `server/face-review.ts` for the queries, and route file
`server/routes/face-review.ts`, registered in `server/routes.ts`. This follows
the same layout as `account-issues.ts` and `routes/account-issues.ts`.

### 3.1 `GET /api/face-review?kind=story|profile|post|message&dismissed=0|1&cursor=…&limit=20`

With `dismissed=1`, the list shows photos that have dismissed faces instead
of unidentified ones. This drives the Dismissed filter (§4.1).

Returns items newest first:

```ts
type FaceReviewItem = {
  photoId: string;
  imageUrl: string;            // photos.location (served via existing S3/proxy path)
  width: number | null; height: number | null;
  kind: "story" | "profile" | "post" | "message";
  postId?: string; slide?: number;      // post/story only
  messageId?: string; conversationId?: string; // message only
  postedAt?: string; caption?: string;  // context line under the image
  account: { id; username; imageUrl; ownerId; ownerName } // poster, or the profile's account
  faces: {
    faceUuid: string;
    box: { x; y; w; h };       // from facial_ids.coordinates, else faces.coordinates
    cropUrl: string;           // faces.s3_url
    color: string;             // stable palette colour by face index; used for box + chip
    identified: { socialAccountId?; personId?; label } | null;
    dismissed: boolean;
    lookAlikes: {              // §3.6; top 3 above the threshold, best first
      personfaceUuid: string; score: number; // cosine similarity 0–1
      socialAccountId?: string; personId?: string; label: string; cropUrl: string;
    }[];
  }[];
  suggestions: {               // ordered; accounts already identified in this photo are removed
    socialAccountId: string; username: string; imageUrl: string | null;
    ownerName: string | null;
    reason: "owner" | "coauthor" | "mentioned" | "profile_account" | "sender" | "participant";
  }[];
  profileLinkReason?: ProfileLinkReason; // profile tab: why auto-link didn't do it
};
```

How it is built:

- **Stories and posts**: `photos` join `social_account_posts` on
  `substring(prm_location from 6)`, filtered on `post_type = 'story'` or
  `<> 'story'` as in `unprocessedPhotoIds`. Also require `face_id_at IS NOT
  NULL` and the §1 face condition. The slide comes from
  `photos.og_metadata->>'slide'`, falling back to the photo's index in
  `content`. Mentions come from `mentionedAccounts[imageIndex = slide]`,
  resolved to `social_accounts` by username. Handles that don't match an
  account row are dropped.
- **Profile**: the same join as `associateProfileFaces`. `profileLinkReason`
  is recomputed by calling a reason-only variant of `linkProfileFace`. That
  means splitting its checks out of its writes, so the page can say "2 faces,
  pick one" or "face too small".
- **Messages**: `photos` join `messages` on `substring(prm_location from 9)`.
  Suggestions are the message's sender (`sender_social_account_id` or
  `sender_person_id`) first, then the other `conversation_participants`,
  excluding the `owner` role (that's you).
  - These suggestions can be people as well as accounts, so the suggestion
    type carries `personId?` alongside `socialAccountId?`.
  - The context line shows the conversation name, the sender and `sent_at`.
- The face condition goes in SQL (`jsonb_array_elements(facial_ids)` join
  `faces` join group lookups), so paging is correct. The 10k ceiling
  ([[social-import-scale-ceiling]]) means cursor on `(uploaded_at, id)` is
  plenty. No materialised queue.

### 3.2 `GET /api/face-review/counts`

`{ story, profile, post, message, total, dismissed }` for the tab badges, the
sidebar badge (`total`) and the Dismissed filter label.
The same query runs as `count(*)`.

### 3.3 `POST /api/face-review/assign`

`{ faceUuid, socialAccountId? , personId? }`. This does exactly what
`/api/prm-face/face/connect` does. That handler's body moves into a function,
`connectFace()` in `recognition.ts`. The existing route then calls it
(existing callers are unchanged), and this route calls it too. Returns the
refreshed `FaceReviewItem` so the client can update in place.

A fix is folded in while moving it. `connect` currently rewrites only the
**one** face's `personface_uuid` when it had a different group, and leaves
the rest of the old group behind. For review that's wrong: that face's
siblings are the same person. `connectFace` should re-point the **whole old
group** to the target group. (Open question Q3.)

**This is also what prevents duplicate identities.** Linking always folds
into the target's existing group; it never mints a second one. The target is
the person's group if there is one, otherwise the account's group, otherwise
the face's group. If the person and the account *both* already have
different groups (for example, the owner was set before faces existed), the
account's group is folded into the person's. That goes through the same
merge function as §5.2.

### 3.4 `POST /api/face-review/dismiss` / `undismiss`

`{ faceUuid }` sets or clears `faces.dismissed_at`.

### 3.5 Profile "this is the account"

No extra endpoint is needed. Confirming a face on the profile tab is `assign`
with that profile's `socialAccountId`. After it succeeds, the other faces in
that profile picture are left unidentified but **drop out of the profile
queue**, because the account now has a face group. They are usually
friends/partners in the photo, so they aren't auto-dismissed. They are just
no longer asked about on this tab. (Open question Q4.)

### 3.6 Look-alikes

Checked 2026-09-27: `faces.embedding` holds 512-dim, already L2-normalised
vectors, so cosine similarity is a plain dot product. The DB has 1,813 faces;
222 are in a face group.

- **Identity centroids.** For each known identity (§5.1), average its faces'
  embeddings and re-normalise the result.
  - Hold the centroids in memory in `face-review.ts`, as a `Float32Array` per
    identity.
  - Rebuild them lazily after any `connectFace`, dismiss, merge or
    remove-from-group, using a dirty flag. Don't rebuild on a timer.
  - At the 10k ceiling that is at most ~10k × 512 floats, about 20 MB. No
    pgvector or compute call is needed.
- **Per face.** Score the face against every centroid and keep the top 3 at
  or above the threshold.
  - Only the page of items being returned is scored (20 photos × a few
    faces), so the request stays fast.
  - Compute already grouped faces it was confident about. Look-alikes are
    the below-its-threshold candidates, which is the useful part.
- **Threshold.** A new app setting, `face_lookalike_min_score`, default
  **0.45** (to be tuned on real data during verification). It goes on
  Recognition settings next to the profile-link minimum.
- **Order on the page.** Look-alikes are shown per face, beside the
  context suggestions (owner, mentions and so on). When the same identity
  appears as both a mention and a look-alike, it's shown once, as a mention
  chip with the score badge. That is the strongest signal: tagged *and*
  looks like them.

### 3.7 Recognition for message photos

Today nothing queues face recognition for `message:` photos, and the DB
currently has none. The Messages tab will be empty until DMs with images are
imported.

- Add `"message"` to `AutoRecognitionKind`, face job only. The new setting
  key is `auto_recog_message_face`, and it shows on Recognition settings with
  the others.
- In `unprocessedPhotoIds`, add the `LIKE 'message:%'` branch so backfill
  covers message photos.
- In the DM and SMS import paths (`task-worker.ts`, `instagram-dm-import.ts`,
  `sms-import.ts`, wherever they `insertPhoto` with `message:`), call
  `enqueueAutoRecognition({ kind: "message", photoIds })` after the import,
  the same way the post and story ingestion does.

## 4. Client

### 4.1 `client/src/pages/face-review.tsx` (replaces `unknown-faces.tsx`)

- Tabs **Stories / Profile images / Posts / Messages**, each with a count
  badge. The selected tab is remembered in the URL (`?tab=`).
- The **Dismissed** toggle (`?dismissed=1`), with a count, switches the
  current tab to photos that have dismissed faces.
  - Dismissed faces are drawn with a grey box.
  - Each dismissed face gets **Undismiss**, which puts it back in the queue,
    and can also be assigned directly from here.
  - Dismissing still shows a short undo toast as well.
- **One image at a time**, as a review queue. The image is on the left (or on
  top on mobile), with an absolutely-positioned overlay of face boxes scaled
  from natural size. Each box is drawn in its face's colour and numbered.
  Identified faces use a muted solid border with the name label. Unidentified
  faces use a bright dashed border.
- The right panel shows the context line (account avatar and @username, post
  date, caption snippet, "Story" or "Slide 2/5"), then **one row per
  unidentified face**: the coloured swatch and crop, then suggestion chips,
  then "Search…" (a combobox over people **and** social accounts, reusing the
  search used by `link-social-account-dialog.tsx`), then "Not someone I track"
  (dismiss).
- Suggestion chips per tab:
  - **Story**: "@owner (posted this)" first, then "@x (mentioned)".
  - **Post**: "@owner (posted this)", "@co (coauthor)", then "@x (tagged on
    this slide)". The copy reads "might be the person tagged in this post".
  - **Profile**: a single face shows "Yes, this is @account". Several faces
    show "@account is in this picture. Which face?", and clicking a face box
    or its row button assigns it.
  - **Message**: "@sender / Name (sent this)", then "(in this conversation)"
    for the other participants.
  - **Every tab, per face**: up to 3 look-alike chips, each showing the
    identity's small crop, its name and a score badge ("looks like @alice ·
    62%").
- When an account is assigned to one face, it disappears from the other
  faces' chips.
- Controls: **Next** or **Skip** (client-side only, moves on without saving),
  and **Back**. Keyboard shortcuts: `1-9` picks a face row, `←/→`
  moves prev/next, `D` dismisses the focused face.
- After the last unidentified face in an image is resolved, it auto-advances
  to the next image.
- The empty state per tab reads "Nothing to review". It links to
  Recognition settings when recognition for that kind is switched off.

### 4.2 Shared bits

- `FaceBoxOverlay` component (image, boxes, colours, click handler).
  `profile-photo-dialog.tsx`, `person-photos-tab.tsx` and
  `photo-upload-dialog.tsx` each draw boxes today. Check whether one of them
  already has a reusable overlay before writing a new one ([[simplicity-checklist]]).
- A face palette of 8 high-contrast colours, indexed by face order in the
  image, readable on photos in both themes.

### 4.3 Routing and sidebar

- `App.tsx`: `/unknown-faces` loads `face-review.tsx`. Add a `/face-review`
  alias only if other code links to it (nothing does today).
- `app-sidebar.tsx`: rename the entry to **Face review**. The badge switches
  from `/api/image-questions/pending` length to `/api/face-review/counts`
  `total`. This changes what the number means, which is intended.
- Delete `unknown-faces.tsx`. Its only client caller was
  `/api/prm-face/face/without-name`, so remove that proxy route
  (`ai-vector.ts`) along with it.

## 5. Faces page (known faces)

Face review is where faces get named. **Faces** (`/faces`) is where you browse
the named ones. It has one card per known identity. Clicking a card opens a
dialog with every photo that face appears in and where each photo lives, so
you can go find it.

### 5.1 What counts as one "known face"

An **identity** is one face group (`personface_uuid`) that is linked to a
person (`people.personface_uuid`), a social account
(`social_accounts.personface_uuid`), or both.

- A person who owns a linked account is **one card**, not two. The card shows
  the person's name as the title, with the @username(s) under it.
- An account with no owner shows `@username` as the title, and its display
  name (nickname) under it when there is one.
- Face groups with no person and no account are not on this page. They are
  Face review's job.

Each card shows:

- a crop of the face. It prefers the face from the account's current profile
  picture, and otherwise uses the newest face in the group.
- the name and/or @username.
- the photo count ("12 photos").
- the most recent date the face was seen.

### 5.2 Server (`server/faces.ts` and `server/routes/faces.ts`)

- `GET /api/faces?search=&sort=recent|count&cursor=&limit=60` returns the
  identity list:
  `{ personfaceUuid, cropUrl, person?: { id, name }, accounts: { id, username, imageUrl }[], photoCount, lastSeenAt }`.
  - It is one SQL query: `faces` grouped by `personface_uuid`, joined to
    `people` and `social_accounts` on that column.
  - Search matches the person's name, the username or the nickname.
  - It runs as the caller, filtered by the same visibility rules the
    people/accounts lists use, so hidden people don't leak through their face.
- `GET /api/faces/:personfaceUuid` returns the dialog data: the identity
  header, plus one entry per **photo**:
  `{ photoId, imageUrl, width, height, box, uploadedAt, source: ResolvedPhotoSource | null }`.
  - Several faces from the same photo are collapsed into one entry. That
    happens rarely, for example mirror shots.
  - `source` comes from `resolvePhotoSource()` in `photo-source.ts`, which
    already turns `post:`, `profile_image:`, `message:`, interaction and note
    locations into `{ label, href }` and respects access.
  - Check that `post:` resolves stories and posts to
    `/social-accounts/<poster>?postId=<id>`. That URL already opens the post
    detail dialog on `social-account-profile.tsx`. Add the `postId` form to
    `resolvePhotoSource` if it currently links only to the account.
- `POST /api/faces/remove-from-group` with `{ faceUuid }` is for when the face
  in a photo isn't actually them. It reuses the existing
  `/api/prm-face/face/disassociate` logic. That logic moves into a function
  next to `connectFace()`, and the new route and the existing route both call
  it. Once removed, the face becomes unidentified and shows up in Face review
  again.
- `POST /api/faces/merge` with `{ keep, merge }` (two `personface_uuid`s) is
  the escape hatch for a duplicate that slipped through. It is
  `mergeFaceGroups()` in `recognition.ts`, the same function
  `connectFace` uses in §3.3:
  - Re-point `faces`, `people` and `social_accounts` rows from `merge` to
    `keep`, in one transaction.
  - Refresh `facial_ids` on the affected photos.
  - Mark the look-alike centroids dirty.
  - Call compute's existing `/api/person/merge`, the same way `connect`
    syncs `/api/face/assign`. A failure there is logged and not fatal.

  If both groups have a person and the two people differ, the merge is
  refused with "these are two different people — merge the people first".
  Merging faces must not silently merge people.

### 5.3 Client (`client/src/pages/faces.tsx`)

- A search box and a sort toggle ("Most photos" / "Recently seen").
- A responsive grid of round face crops with the name and @username under
  each. It pages with infinite scroll, using the same pattern as the images
  list.
- **Clicking a card opens a dialog**:
  - The header has the crop, name and @username(s), plus "Open person" and
    "Open account" links.
  - Below that is a grid of the photos this face is in. Each thumbnail uses
    `FaceBoxOverlay` from §4.2 to highlight **this** face's box only, so it's
    obvious who in a group shot is meant.
  - Under each thumbnail is the **location**: an icon for its type (story,
    post, profile picture, message and so on), the source label (for example
    "Story · @alice · Sep 3"), and an **Open** link to `source.href`. There is
    also an "Image" link to `/image/:id`. When the source is null (hidden or
    deleted), only the image link shows.
  - A "Not them" button on each thumbnail removes that face from the group
    (see `remove-from-group` above).
  - A **Merge with…** button in the header opens a search over the other
    identities, showing their crop, name and photo count. Picking one shows a
    confirmation ("Fold @alice_2's 3 photos into Alice Smith?"). The card you
    opened is the one that's kept.
  - When there is only one photo, the dialog still shows it the same way. No
    special case.
- Routing and sidebar: add a `/faces` route in `App.tsx`, and a **Faces**
  sidebar entry directly above **Face review**, with no badge.

### 5.4 Overlap with Settings → Image storage → Faces

`recognition-faces.tsx` (`/settings/image-storage/faces`) is a raw, paged
list of **every** face row from the compute service, named or not. It is a
storage/debug view, so it stays as it is. The new page is the user-facing one.

## 6. Build order

1. `faces.dismissed_at` column and `db-init.ts` migration.
2. Extract `mergeFaceGroups()` and `connectFace()` from the `face/connect`
   route, including the whole-group re-point and fold-on-link. The existing
   route delegates to it.
3. Split `linkProfileFace` into a check and an apply step (reason-only
   variant).
4. `face-review.ts` queue query plus counts, stories first. Verify the counts
   against the DB by hand.
5. Routes: list, counts, assign, dismiss.
6. Page: Stories tab end-to-end (overlay, suggestions, assign, dismiss,
   advance).
7. Posts tab: per-slide tags and coauthors.
8. Profile tab: single-face confirm, multi-face pick, reason text.
9. Dismissed filter, Undismiss and the undo toast.
10. Look-alikes: centroids, scoring, the threshold setting and the chips.
    Tune the default threshold on real faces.
11. Messages: add the `message` recognition kind, backfill, the import hooks
    and the tab. It stays empty until DMs with images exist.
12. Sidebar and route swap, then delete `unknown-faces.tsx`.
13. Verify in the preview: assign one face per tab, check that `facial_ids`,
    `social_accounts.personface_uuid` and `people.personface_uuid` updated,
    and that the item left the queue and the badge dropped.
14. Faces page server: `faces.ts` identity list and detail, reusing
    `resolvePhotoSource`. Extract `disassociateFace()`. Add the merge route.
15. `faces.tsx`: the grid, and the dialog with the overlay, location links,
    "Not them" and "Merge with…".
16. Verify:
    - A face named on Face review appears on Faces.
    - Its dialog's Open links land on the right post, story or profile.
    - "Not them" sends it back to Face review.
    - Merging two test groups leaves one card.

## 7. Open questions (defaults accepted 2026-09-27)

- **Q1 — Assigning to a person with no account.** The search box offers
  people too. Picking a person links the face group to the person
  (`people.personface_uuid`), with no account. **Yes, allow it.**
- **Q2 — Dismiss scope.** Per face (**default**) or the whole face group
  ("never ask about this stranger again")?
- **Q3 — Group re-point on assign.** If the face was already grouped with
  other faces, move the **whole group** to the chosen identity (**default**),
  or split this face out?
- **Q4 — Other faces in a confirmed profile picture.** They leave the profile
  tab (**default**). They don't appear anywhere else, because profile photos
  aren't in the Stories/Posts tabs.
- **Q5 — Story video frames.** Only story *images* have faces today
  (recognition runs on `photos`). Video stories show their thumbnail if one
  exists, and are otherwise skipped. **No frame extraction in this build.**

---

## 8. Reducing the review burden (2026-09-28)

Three changes: auto-assign confident matches, keep **Skip all** at the top,
and a ✕ on named face boxes to undo a wrong link.

Decisions (2026-09-28):

| Question | Answer |
|---|---|
| Auto-assign threshold | Top look-alike score (cosine to identity centroid, §3.6) **≥ 0.55**. New setting `face_auto_assign_min_score`, default 0.55, on Recognition settings next to the look-alike minimum |
| Near ties | Take the top match unless the runner-up is within **0.01** (1 point) of it; then leave the face for review |
| Spot-checking | **Marker only.** Auto-matched faces leave the queue; boxes show an "Auto · 62%" marker wherever named faces are drawn. No dedicated filter |
| When it runs | On every `runFaceRecognition`, **periodically** (hourly scheduler, same pattern as `stories-scheduler.ts`), and on demand from a **button** on Recognition settings and on Face review |
| ✕ on a named face | Unlinks it; the face goes **back to the queue**. Auto-assign never re-picks that identity for that face |

### 8.1 Schema

```ts
// faces
autoMatchScore: real("auto_match_score"), // set = computer assigned this face at this score, unconfirmed; null = set by a person (or never auto-assigned)
```

- `db-init.ts`: `ALTER TABLE faces ADD COLUMN IF NOT EXISTS auto_match_score real`.
- `connectFace()` clears it (like `dismissedAt`), so any manual assign/confirm makes the link final.
- `disassociateFace()` clears it too.

### 8.2 Auto-assign (`autoAssignFaces()` in `face-lookalikes.ts`)

Candidates: faces that are not dismissed, not in a named group, and have an
embedding. Scope is either one photo's faces (called at the end of
`runFaceRecognition`) or all of them (periodic run and button).

For each candidate:

1. Score it against the centroids with `lookAlikesFor(…, { minScore })`.
2. Skip the face when:
   - the top score is below the threshold,
   - the runner-up is within 0.01 of the top score, or
   - `face_pair_dismissals` rejects the pair of this face's group and the top identity (§8.4).
3. Several faces in one photo may go to the same identity. Post images are
   often collages of one person, so there's no one-per-photo limit.
4. Move **only this face** into the identity's group, set
   `auto_match_score`, and refresh `facial_ids` for the affected photos.
   - This uses the same `moveGroup`/`refreshFacialIdsForGroups` pieces as
     `connectFace`, but doesn't fold the face's unnamed compute siblings,
     because a guess shouldn't pull in faces it didn't score.
5. Return `{ assigned, scanned }` for the button toast.

Centroids (`rebuildCentroids`) exclude faces with `auto_match_score IS NOT
NULL`, so a wrong guess can't pull an identity's average toward the wrong
face and snowball.

At the 10k ceiling ([[social-import-scale-ceiling]]) the full scan is
10k × (identities) dot products, which is fine hourly. Batch the face
embedding reads.

### 8.3 Skip all

- Move the button to the top of the right panel, above the context line.
- Show it whenever there is **≥ 1** actionable face. The label is
  "Skip all (N)".
- It is still hidden in the Skipped filter.

### 8.4 ✕ on named boxes

- `FaceBoxOverlay` gets an optional `onRemove(key)`. Solid (named) boxes get
  a small ✕ in the top-right corner.
- Auto-matched boxes also show an "Auto · 62%" tag. The overlay face gets an
  `autoScore?: number` field, and `FaceReviewFace` / the Faces detail API
  return `autoMatchScore`.
- Wire the ✕ on Face review and in the Faces page dialog (next to the
  existing "Not them", which it can replace).
- The ✕ calls `POST /api/faces/remove-from-group`, which runs
  `disassociateFace()`. The Undo toast re-runs `connectFace` with the old
  identity.
- `disassociateFace()` records a `face_pair_dismissals` row for
  (new group, old identity group). Auto-assign and the look-alike chips then
  skip that identity for this face.

### 8.5 Build order

1. The column, migration and setting (get/set, plus the Recognition
   settings field).
2. `autoAssignFaces()`, the centroid exclusion, and the hook at the end of
   `runFaceRecognition`.
3. The rejection record in `disassociateFace`, plus the filter in
   auto-assign and look-alikes.
4. The hourly scheduler, and `POST /api/face-review/auto-assign`, which runs
   it now and returns counts. Add buttons on Recognition settings and on the
   Face review header.
5. The overlay ✕ and the auto tag, on Face review and the Faces dialog.
6. Skip all at the top, always shown.
7. Verify in the preview:
   - Run auto-assign and check the counts against the DB.
   - A matched face leaves the queue and shows the Auto tag.
   - ✕ puts it back, and a re-run doesn't re-assign it.
   - Manually confirming the face clears the score.
