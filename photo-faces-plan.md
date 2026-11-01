# Identify faces in the post and story modals: plan

**Date:** 2026-10-28
**Goal:** let the user name, re-name, un-name, skip, and confirm the faces on the photo they are looking at in
the **post modal** (`PostDetailDialog`) and the **story modal** (`StoryDialog`), and draw a box around a face
the scanner missed. The user works on one photo at a time: the current carousel slide, or the current story.
This plan does not add a bulk or queue flow; that stays on the Face review page.

## Decisions (2026-10-28)

| # | Question | Decision |
|---|---|---|
| 1 | Where identifying happens | **Click a face box and a popover opens next to it.** It holds suggestion chips, look-alikes, "Someone else…" search, and Skip. Clicking a row in the existing faces panel opens the same popover. |
| 2 | Actions | **Name / rename**, **remove a name (✕)**, **skip / unskip**, and **confirm or reject auto-assigned** faces. |
| 3 | Missed faces | **The user can draw a box.** This needs a new PRM Compute endpoint that embeds a given region (§5). |
| 4 | Video stories | **Cover frame while paused.** When the faces toggle is on, the poster image with boxes replaces the video. Turning the toggle off brings the player back. |
| 5 | What re-scan does to drawn faces *(my default, tell me if you want otherwise)* | Re-scan drops **all** faces on the photo, including drawn ones, because `img/delete` works per photo. The re-scan confirmation says so. |
| 6 | A drawn box on top of an existing face *(my default)* | Refused when IoU > 0.5 with an existing box, with the message "That face is already marked. Click it instead." The client checks first and the server checks again. |

---

## 0. What already exists (reuse, don't rebuild)

| Piece | Where | Use here |
|---|---|---|
| Per-slide faces for a post/story | `GET /api/social-account-posts/:id/slides` → `getPostSlideAnalysis` (`server/face-review.ts`) | The data for both modals. It already handles `post` vs `story` kind. |
| Face boxes on an image | `FaceBoxOverlay` (`client/src/components/face-box-overlay.tsx`): `onFaceClick`, `onRemove` (✕), `autoScore` tag | The overlay is already interactive. The post modal just doesn't pass those props yet. |
| Faces panel + toggle | `PostDetailDialog` (the ScanFace button, `panel-faces`) | This moves into the shared component (§2). |
| Name / unname / skip / unskip | `POST /api/face-review/{assign,unassign,dismiss,undismiss}` (`server/routes/face-review.ts`), all keyed by `{ faceUuid, photoId, kind }` | Every popover action calls these, so no new linking endpoints are needed. `assign` also creates an account for a mention with no account yet. |
| Confirm auto-assigned | `connectFace` clears `auto_match_score`, `disassociateFace` remembers a rejection | **Confirm** = `assign` to the face's current identity. **Not them** = `unassign`. |
| Suggestion chips, look-alikes, Someone else…, Skip | Inline in `client/src/pages/face-review.tsx` (per-face row, ~L822–940) | Extract into a shared component (§3) that both Face review and the popover use. |
| People/account search with create | `IdentitySearch` (`client/src/components/identity-search.tsx`) | The "Someone else…" part of the popover. |
| Re-scan | `POST /api/face-review/rescan` + `RescanStatus` | The "Re-scan faces" item in the overlay menu. |
| Compute embedding/storage | PRM-compute `process_detected_faces` (`face_pipeline.py`), `_align`/`_embed` (`face_engine.py`) | The new region endpoint reuses these, so matching, the S3 crop, and the Face row all work the same as `img/add`. |

---

## 1. Server: give the slides endpoint what the popover needs

`getPostSlideAnalysis` builds full `FaceReviewItem`s and then throws away `lookAlikes` and `suggestions`.
It should keep them:

- `PostSlideFace` becomes the full `FaceReviewFace` (drop the `Omit<…, "lookAlikes">`).
- `PostSlideAnalysis` gains `suggestions: FaceReviewSuggestion[]` (owner, coauthors, slide mentions) and `kind`.
- The client `PostSlide` type in `post-detail-dialog.tsx` is replaced by importing the server type from a shared spot.
  Either move the types to `shared/`, or re-declare them once in the new client component (§2), not in both dialogs.

No new routes are needed for steps 1–4.

## 2. Client: one `PhotoFaces` component used by both modals

New file `client/src/components/photo-faces.tsx`. It owns everything face-related for one displayed image.

```
<PhotoFaces postId kind="post|story" slide={i} src={…} imgClassName={…} onNavigate={close}>
  {/* rendered when faces are hidden: the dialog's own <img>/<video> */}
</PhotoFaces>
```

- It fetches `/api/social-account-posts/:id/slides`, using the same query key the post modal uses today.
- It shows the **ScanFace toggle**, the **faces panel** (face rows plus "Also mentioned"), and the **overlay**.
  All of this moves out of `PostDetailDialog`.
- Overlay props:
  - `onFaceClick` opens the popover.
  - `onRemove` (✕ on named boxes) calls `unassign`.
  - `autoScore` draws the "Auto · 62%" tag.
- A small menu in the corner of the overlay offers **Add a face** (§4) and **Re-scan faces in this photo**.
- Mutations go to `/api/face-review/*` with `{ photoId: slide.photoId, kind }`. Each mutation:
  - patches the slides cache optimistically (the face's `identified` / `dismissed` / `autoMatchScore`),
  - then invalidates the slides key, `/api/face-review` + `/api/face-review/counts`, `/api/faces`, and the
    account's `/faces/counts` (the Faces tab badge).
  - On an error it rolls back and shows a toast, using `serverError` from face-review.tsx (export it).
- Its `children` render when faces are hidden, so each dialog keeps its own `<img>`/`<video>`.

**`PostDetailDialog`** becomes `<PhotoFaces kind={post.postType === "story" ? "story" : "post"} slide={currentImageIndex} …>`
wrapping its current media. This deletes about 120 lines of faces markup. It is also used on Home and the person
Photos tab, so both get identify for free.

**`StoryDialog`** (`stories-tab.tsx`) wraps its media with `<PhotoFaces kind="story" slide={0} src={image}>`.
For a video story (decision 4), turning faces on renders the poster `image` with the overlay instead of the
`<video>`, and pauses the video first. The story's Mentions row stays. The faces panel also shows mentions
that aren't a named face, as the post modal does today.

## 3. The popover and the shared chip list

**Extract** `FaceIdentifyChips` (`client/src/components/face-identify-chips.tsx`) from face-review.tsx. It covers:

- merging suggestions with look-alike scores,
- the extra look-alike chips,
- "Someone else…" opening `IdentitySearch`,
- Skip / Unskip,
- the "also in this photo" marking.

Props: `face`, `suggestions`, `kind`, `placedIds`, and the callbacks `onAssign(target, label)`, `onDismiss`, `onUndismiss`.
Face review's row renders it in place of its inline JSX, so its behaviour does not change. This is the only edit
to face-review.tsx besides exporting `serverError` / `suggestionLabel`.

**Popover** (shadcn `Popover`, anchored by an absolutely positioned `PopoverAnchor` placed over the clicked box):

| Face state | Popover shows |
|---|---|
| Unknown | Crop + "Face N", then `FaceIdentifyChips` |
| Named | "This is **@name**" (a link that closes the modal) · **Change…** (chips) · **Remove name** |
| Auto-assigned (`autoMatchScore`) | "PRM thinks this is **@name** (62%)" · **Yes** (assign to the same identity) · **Not them** (unassign, then show the chips) |
| Skipped | "Skipped" · **Unskip** |

- `face-box-overlay.tsx` exports a `boxStyle(box, natural)` helper (the percentage math it already does
  inline), so `PhotoFaces` can place the anchor.
- When a face is named, the popover closes and moves to the next unknown face on the slide, if there is one.
- Keyboard: Esc closes the popover only, not the dialog. ←/→ in the dialog are ignored while the popover or
  the search input has focus.

## 4. Client: drawing a box

- **Add a face** switches the overlay into draw mode: crosshair cursor, a hint banner, and Esc to cancel.
  Dragging draws a rectangle.
  - It is converted to natural pixels with the inverse of `boxStyle`.
  - The minimum size is 24 px natural, and the box is clamped to the image bounds.
- On release:
  - The client checks IoU against existing boxes (decision 6).
  - Then it sends `POST /api/photos/:photoId/faces { box }`.
  - The new box shows as a pending dashed box with a spinner.
  - The reply is the refreshed slide, and the popover opens on the new face right away.
- Draw mode is hidden when compute isn't configured. The server answers 400 in that case, the same way
  `/rescan` does.

## 5. Drawn faces: server and compute

### 5.1 PRM-compute (separate repo, `C:\Repos\PRM-compute`): `POST /api/img/add-region`

Form fields: `image`, `photo_id`, `x`, `y`, `w`, `h`. It goes in `routers/image.py` next to `/add`.

1. Decode the image. Crop the box expanded by about 30%, then run the detector on the crop at a lower threshold
   (for example `det_threshold * 0.5`).
2. If it finds a face, use the best one whose centre is inside the user's box. Map its landmarks back to
   full-image coordinates, then `_align` + `_embed`.
   If it finds none, resize the user's box crop to 112×112 and embed it as-is (`embed_aligned` path), and flag
   it `aligned: false`.
3. Build one detection dict with the **user's box** as `box` (what the user drew is what we store), the crop JPEG,
   the embedding, and `detection_confidence` (the detector score, or 0).
4. `process_detected_faces([det], photo_id, db, persist=True)`. Matching, the personface inheritance, the S3 crop,
   and the Face row all work exactly as `/add` does.
5. Return the same result shape as `/add`'s `results[0]`, plus `manual: true` and `aligned`.

Update `main.py`'s endpoint list and `react-api-guide.md`.

### 5.2 PRM server: `addManualFace(photoId, box)` in `server/recognition.ts`

- Fetch the image buffer, the same way `runFaceRecognition` does, and call `computeFetch("/api/img/add-region", form, 45000)`.
- Run `resolveFaceIdentities([detected])`, then **append** the result to `photos.facial_ids`. Also append it to every
  photo that already shares this photo's faces (`photosContainingFaces` of the existing ids), so identical images
  stay in sync.
- Mark the face as drawn:
  - If `faces.noise_reason` / `auto_match_score` are left null it is a normal face, so set `faces.source = 'manual'`.
    That is a new nullable text column, added via the migration ledger.
  - If `aligned: false`, also set `noise_reason = 'manual_unaligned'` so clustering and look-alike matching skip
    its weak embedding.
  - `faceQualifies` already lets the user name it (noise only hides faces from the queue, and the modal shows
    every face).
- Call `autoAssignFaces([id])`, as `runFaceRecognition` does.

Route `POST /api/photos/:photoId/faces` goes in `server/routes/face-review.ts` beside `/rescan`. It:

- runs `getReadablePhoto`,
- checks that compute is configured,
- validates that `box` is in bounds and meets the minimum size,
- runs the IoU check against `facial_ids` (409 on overlap),
- then calls `addManualFace` and answers with the refreshed `PostSlideAnalysis` for that photo.

The modal's existing re-scan confirm text gains: "Faces you drew will be removed too." (decision 5)

## 6. Order of work

1. §1 slides payload, plus extracting `FaceIdentifyChips` from Face review (no visible change there).
2. §2 `PhotoFaces` and the switch of `PostDetailDialog` to it (the existing view behaviour, now living in the
   new component).
3. §3 popover with name / rename / remove / skip / confirm, in the post modal.
4. `StoryDialog` adoption, including the video cover frame.
5. §5.1 compute endpoint (PRM-compute repo).
6. §5.2 server route + column, then §4 draw mode.

Steps 1–4 ship identify without drawing. Steps 5–6 depend on the compute deploy.

## 7. Verification

- `npm run check` (tsc) after each step.
- In the browser preview:
  - Open a multi-slide post from a social account, from Home, and from a person's Photos tab.
  - Name a face from a suggestion, a look-alike, and a search. Rename it, remove the name, skip and unskip it.
  - Confirm and reject an auto-assigned face.
  - Check that the account Faces badge and the Face review counts update.
  - Repeat on an image story and a video story (cover frame).
  - Draw a box on an unfound face, on a back-of-head (unaligned fallback), and over an existing box (409).
- PRM-compute: add a pytest for `/api/img/add-region` covering the detected-in-region and fallback paths.

## 8. Out of scope

- Any queue or "next photo" flow in the modals (Face review keeps that).
- Faces in video frames other than the cover.
- Editing or moving an existing detected box.
