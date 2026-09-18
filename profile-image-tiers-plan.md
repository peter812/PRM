# Profile image tiers (150 / 1080) — plan

Instagram hands PRM two sizes of the same profile picture: a 150px thumbnail
from every follower/following scrape, and a 1080px original from a profile-info
fetch. Today `social_accounts.image_url` holds whichever arrived last and won
the resolution guard, and the history journal calls every replacement an
"image change" — so a 150→1080 upgrade of the *same* picture reads as if the
person changed their photo.

This plan keeps both sizes, picks the right one per surface, and teaches the
journal the difference between a new picture and a better copy of the old one.

**As built (2026-09-17)** — everything below is implemented; deviations from the
text:

- `sharp` added (Q1: yes). dHash is stored on `photos.perceptual_hash` at
  write time and lazily filled for older rows (`ensurePerceptualHash`), so
  the comparison is a column read unless the row predates the column.
- `classifyProfileImage` short-circuits on the Instagram CDN filename
  (Q2: yes), then dHash. Same pixel size but a different sha256 also goes
  through the similarity check (Q6); a re-encode of the same picture is
  skipped with no journal entry (`same_picture`).
- Labels (Q3): the no-image→HQ case is "profile image added (HQ)" (the
  "(LQ)" in the request was a typo) and LQ→different-HQ is
  "profile image updated (LQ → HQ)". All seven live in
  `PROFILE_IMAGE_CHANGE_LABELS` in `shared/schema.ts`.
- "improved" does not move the profile page's "image last changed" date
  (Q4: `getImageLastChangedAt` skips it). The modal shows it as an LQ → HQ
  pair rather than before/now; pixel sizes are not stored on the entry so
  the sides are labelled by tier.
- Backfill (Q5) is a task-worker job (`backfill_profile_image_tiers`) behind
  a button on Settings → Image Storage → Storage Maintenance, not a boot
  migration. It writes no journal entry.
- Manual uploads (PATCH with `imageUrl`) go through `ingestManualProfileImage`
  so a hand-uploaded 1080 gets both copies and the right label. The stories
  path (§5 "fourth path") turned out not to write profile images, so it was
  left alone.
- The person auto-pass-in receives `imageUrlHq ?? imageUrl` (Q7).
- Case E' (HQ → different LQ) clears `image_url_hq`; the transfer-to-local /
  transfer-to-S3 tasks were extended to move `image_url_hq` too.

## 1. Where things stand

- `server/profile-image.ts` is the single place that fetches, hashes, guards
  and stores a profile picture. Three callers: the image-task worker
  (`processDownloadImgInstagram`), the inline path in `processImportSocial`,
  and the tracking `/jobs/:id/info` route (extension uploads the 1080 bytes).
- `shouldReplaceProfileImage` compares by sha256 (`same_hash`) and refuses a
  narrower image (`lower_resolution`). Nothing decides "same picture, bigger".
- `recordProfileImageChange` / `applySnapshot` / `recordAccountProfileChanges`
  all write `profileFieldsChanged: ["image"]` + `previousImageUrl`. The client
  labels that "profile image changed" in
  `social-account-history-tab.tsx` and shows before→now in the modal.
- Every stored file is a `photos` row (`prmLocation = profile_image:<id>`,
  with `widthPx`/`heightPx`/`fileHash`) — so the current image's size is
  already known without re-downloading.
- No image-processing library is installed. `getImageDimensions` parses
  headers by hand. Generating a 150px webp and comparing pictures both need
  pixel access, so `sharp` becomes a dependency (§7 Q1).

## 2. Schema

`social_accounts`
- `image_url` **keeps its meaning as the list/thumbnail url** and is always
  the 150px copy. Renaming it would touch ~47 client files for nothing.
- `image_url_hq TEXT NULL` — the 1080px copy. Null until a profile-info
  fetch delivers one. Cleared again if a later scrape proves the picture
  changed and only a 150 is in hand (§4 case E).
- `currentProfile` projection (`buildSocialAccountWithProfile`) gains
  `imageUrlHq`. `SocialProfileVersion` type gets the optional field.

`social_account_history`
- `previous_image_url` stays (the LQ before the change).
- `previous_image_url_hq TEXT NULL` — the HQ before the change, when there
  was one, so the modal can show the best "before".
- `image_change TEXT NULL` — one of
  `added_lq | added_hq | updated_lq | improved | updated_hq_to_lq | updated_hq`.
  `profileFieldsChanged` still contains `"image"` so every existing reader
  (`includes("image")`, `getImageLastChangedAt`) keeps working; the new
  column only refines the label. Whether `improved` should count as a
  "change" for `getImageLastChangedAt` is Q4.

`photos`
- The generated 150 webp is its own row (`prmLocation = profile_image:<id>`,
  `isSubImage: true`, `ogMetadata.derivedFromPhotoId = <hq photo id>`) so the
  image page can still resolve it and dedupe still sees its hash.

`db-init.ts`: three `addColumnIfNotExists` calls. No data migration at boot
(§6).

## 3. Tier + similarity

In `profile-image.ts`:

```ts
type Tier = "lq" | "hq";
const HQ_MIN_WIDTH = 320;                       // 150 and 320 are Instagram's small sizes; 640+/1080 are "full"
export const tierOf = (dims) => dims && dims.width >= HQ_MIN_WIDTH ? "hq" : "lq";
```

Similarity — `samePicture(a: Buffer, b: Buffer): Promise<boolean>`:
dHash via sharp (`resize(9, 8, {fit: "fill"}).greyscale().raw()`, compare
adjacent pixels → 64-bit hash), Hamming distance ≤ 10 means same picture.
dHash is size-invariant by construction, which is exactly the 150-vs-1080
question, and needs no extra library once sharp is in. The current image's
bytes have to be re-read (S3/local) for the comparison — one small download
per candidate, only reached when the hash already differs.

Cheap short-circuit before touching pixels (Q2): Instagram's CDN filename
(`…/123_456_789_n.jpg`) is the same across sizes and changes with the
picture, and `photos.ogMetadata.sourceUrl` already records it. Same
filename ⇒ same picture; different filename ⇒ still run dHash (it also
changes on re-upload of the same photo).

To avoid the re-download entirely, store the dHash on the photos row
(`photos.perceptual_hash TEXT`) at store time; then comparison is a column
read. This is the recommended shape — one more column, no S3 round-trip.

## 4. Decision table

`classifyProfileImage(account, fetched)` replaces `shouldReplaceProfileImage`
and returns either `{skip, reason}` or `{imageChange, setLq, setHq, clearHq}`.
`cur.lq`/`cur.hq` = the account's current urls; `in` = the fetched tier;
`same` = `samePicture` against the best current copy (hq if present, else lq).

| # | current      | incoming | same? | result | history label |
|---|--------------|----------|-------|--------|---------------|
| A | none         | lq       | —     | lq := in | profile image added (LQ) |
| B | none         | hq       | —     | hq := in, lq := thumb(in) | profile image added (HQ) |
| C | lq only      | lq       | yes   | skip (`same_picture`) | — |
| C'| lq only      | lq       | no    | lq := in | profile image updated (LQ) |
| D | lq only      | hq       | yes   | hq := in (keep lq) | profile image improved |
| D'| lq only      | hq       | no    | hq := in, lq := thumb(in) | profile image updated (LQ → HQ)  ← not in your list, Q3 |
| E | hq (+lq)     | lq       | yes   | skip (`lower_resolution`, as today) | — |
| E'| hq (+lq)     | lq       | no    | lq := in, hq := null | profile image updated (HQ → LQ) |
| F | hq (+lq)     | hq       | yes   | skip (`same_picture`) | — |
| F'| hq (+lq)     | hq       | no    | hq := in, lq := thumb(in) | profile image updated (HQ) |

Same sha256 as any current copy short-circuits to skip before anything else,
as now. `thumb(in)` = sharp `resize(150, 150, {fit: "cover"}).webp()`,
uploaded through the same storage-mode-aware path.

In D the existing Instagram 150 is kept rather than regenerated — it's the
same picture and already the size we want.

## 5. Writers

One writer, as now: `recordProfileImageChange(accountId, outcome, previous)`
takes the classification result, updates `image_url` / `image_url_hq` in
the same transaction as the journal row, and fills `image_change`,
`previous_image_url`, `previous_image_url_hq`.

- `processDownloadImgInstagram` (image worker): classify → store → thumb if
  needed → `recordProfileImageChange`. `autoPassInImageForSocialAccount`
  gives the person `imageUrlHq ?? imageUrl` (best available, same as today's
  effective behaviour).
- `processImportSocial` inline path and the tracking `/info` route: these
  currently pass `imageUrl` into `applySnapshot` so the change rides on the
  scrape's own entry. They pass `{imageUrl, imageUrlHq, imageChange,
  clearHq}` instead; `applySnapshot`'s profile diff treats `image` as
  changed when the classifier said so and copies the two previous urls +
  kind onto the row. (Keeping it on the scrape's entry, not a second row —
  same as today.)
- `recordAccountProfileChanges` (manual edit / upload): a manual upload also
  goes through the classifier so a person uploading a 1080 gets both copies.
- Stories upload (`task-worker.ts:~280`, `uploadImageToS3` + record) is the
  fourth path; it funnels through the same classify/store helpers.

## 6. Existing rows

Accounts that already hold a 1080 in `image_url` (the resolution guard has
been preferring wider images) will keep serving that 1080 in list views until
touched. Options (Q5):

- (a) Lazy: the next scrape that sees the account classifies as usual
  (current tier read from the photos row's `widthPx`), and if it lands in
  case F/E the row gets normalised then. No one-off job.
- (b) One-off backfill task: for every account whose current photo row has
  `widthPx >= 320`, move the url to `image_url_hq`, generate the 150 webp,
  set `image_url`. Runs as a task-worker job so it's resumable; N downloads
  from our own storage.

Recommendation: (b), but as an explicit admin button on the import/export
page rather than at boot, so it runs when you want it to.

## 7. Client

- List views: no change (`imageUrl` is already the thumbnail).
- `social-account-profile.tsx` header avatar and `social-graph-3d.tsx` info
  sidebar (`selectedAccount.currentProfile.imageUrl` ~line 1618):
  `imageUrlHq ?? imageUrl`.
- `social-account-history-tab.tsx`: `describeEntry` maps `imageChange` to
  the six labels; falls back to the current "profile image changed" for old
  rows with `image_change = null`.
- `social-account-history-modal.tsx`: before = `previousImageUrlHq ??
  previousImageUrl`, now = `current.imageUrlHq ?? current.imageUrl`; for
  `improved` show the LQ→HQ pair side by side with their pixel sizes.
- `SocialAccountHistoryEntry` type: `imageChange`, `previousImageUrlHq`.

## 8. Order of work

1. `npm i sharp`; `photos.perceptual_hash`, `social_accounts.image_url_hq`,
   history columns; db-init.
2. `profile-image.ts`: `tierOf`, `dHash`, `samePicture`, `makeThumbnail`,
   `classifyProfileImage`, `storeProfileImage` gains `{tier, derivedFrom}`.
3. `recordProfileImageChange` + `applySnapshot` + `recordAccountProfileChanges`
   take the new outcome shape; all four callers switched.
4. Projection + types; client (profile page, graph sidebar, history tab,
   modal).
5. Backfill job + button (if Q5 = b).
6. `npm run check`; exercise all six cases against a local account by
   feeding the worker a 150 then a 1080 of the same picture, then a
   different 150.

## 9. Open questions

Answered — see the "As built" note at the top.
