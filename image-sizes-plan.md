# Image sizes under one ID (`?s=`) — plan

Every stored image gets its sizes served under the same key: any consumer
(PRM, the extension, PRM-compute, a script) appends `?s=64|150|1080|max` to
an image URL — a stored proxy path or a presigned one — and PRM-S3 answers
with that size. Absent `s` (or `max`) is the original bytes, so nothing that
exists today changes behaviour until it opts in.

Decisions (2026-09-19):

- PRM-S3 (Go) bakes the variants eagerly on write, as webp, high quality.
- Sizes: 64, 150, 1080, max. Fit inside N×N, aspect kept, never upscale.
- Bake rule: for each size in {1080, 150, 64} with size ≤ the OG's longest
  side, bake it. A 1080+ source gets 1080/150/64; a 600px source gets 150/64
  (its OG serves `?s=1080` and `max`); a 150 source gets 150/64.
- Instagram profile pictures: one URL column plus `is_hq_image`; the 1080 of
  a picture first seen at 150 replaces the OG under the same key.
- Existing objects: PRM task-worker warm job behind a Settings button, with
  serve-the-OG fallback until an object is baked.
- Existing Instagram thumbs: clean end state — rewrite references, delete the
  generated 150 objects and rows, drop the `_hq` columns.

## Phase 1 — PRM-S3: bake on write, serve by size

**Signature.** `s` is excluded from the SigV4 canonical query in both
`verifyPresigned` and `verifyHeader` (`internal/auth/verify.go`;
`CanonicalQuery` already excludes `X-Amz-Signature`). A URL signed for
`images/abc.jpg` grants every size of that object. `s` must be one of the
allowlist or the request is `InvalidArgument`.

**Storage.** Variants live inside the object directory as `_v1080.webp`,
`_v150.webp`, `_v64.webp` next to `_data` / `_meta.json`
(`internal/storage/fsstore/keypath.go` reserves leading-underscore files for
the object itself, so they cannot collide with child keys). `DeleteObject`
removes the directory, so variants go with it; `ListObjects` is unaffected;
no separate cache tree.

**Baking.** Triggered by `PutObject`, `CompleteMultipartUpload` and
`CopyObject` (the last is how the warm job re-bakes without re-uploading).
Synchronous inside the write under a `GOMAXPROCS`-bounded semaphore, so there
is no "not baked yet" window on a fresh upload; a bake failure is logged and
never fails the write. Skipped when `Content-Type` is not `image/*`, the
decoder cannot read the bytes (HEIC), or `DecodeConfig` reports more than
`images.max_source_pixels` (default 50 MP). Config: `[images] enabled`,
`webp_quality` (default 90), `max_source_pixels`.

**Serving.** `serveObject` resolves `s` to the variant file when present,
else the OG. A variant answers with `Content-Type: image/webp`, its own ETag
and `Cache-Control: private, max-age=86400`; a fallback answers with the OG
and `Cache-Control: no-store`, so a browser never caches the 1080 under the
`?s=64` URL. HEAD, conditional and Range requests reuse the existing path.

**Deps.** `golang.org/x/image` (webp decode, `draw.CatmullRom`) and
`github.com/gen2brain/webp` (libwebp via wazero: pure Go, so `prm-s3.exe`
keeps building on Windows without cgo). Measure encode time first; if a
1080² webp costs more than ~1 s, encode the 1080 variant as JPEG and keep
webp for 150/64.

**Tests** (`internal/s3api/sdk_test.go`): PUT then HEAD/GET `?s=150` is webp
at 150 on the long side; a 600px source has no `_v1080` and `?s=1080` serves
the OG; a non-image PUT bakes nothing and `?s=64` serves the OG with
`no-store`; in-place Copy re-bakes; Delete removes the variants; an invalid
`s` is rejected; a presigned URL with `&s=64` appended verifies.

## Phase 2 — PRM plumbing and warm job

- `shared/image-size.ts`: `withImageSize(url, size)` appends `?s=` or `&s=`
  (presigned URLs already carry a query). Used by client and server.
- `server/middleware/prm-s3-direct.ts`: the inbound regex swallows a trailing
  `[?&]s=…` so a client echoing a sized URL never persists it. The DB stores
  bare keys only; sizes are added at render time; the outbound rewrite is
  untouched.
- `server/routes/auth-setup.ts` proxy route: validate `req.query.s`; direct
  mode → 302 to the presigned URL plus `&s=`; proxy mode → stream via a
  presigned *internal* URL with `fetch` (the SDK's `GetObjectCommand` cannot
  carry a custom query). Generalise `presignPrmS3PublicUrl` to take the
  endpoint.
- Warm job `bake_image_variants` (task-worker + button under Settings → Image
  Storage → Storage Maintenance): `listPrmS3ObjectKeys()` over `images/` and
  `faces/`; per key `HEAD ?s=64` — `image/webp` means done, skip; otherwise
  in-place `CopyObject` (key → same key) so PRM-S3 re-bakes. Concurrency 4,
  progress on the task row, resumable via the HEAD check.
- Client: `withImageSize(url, 64)` in list rows and avatars, 150 in cards and
  the history modal, 1080 on profile headers and post views, `max` only in
  image-detail / lightbox. Incremental; untouched sites keep serving MAX.
- `faces/` crops from PRM-compute get a 64 baked automatically; PRM-compute is
  unchanged (`fetchImageBuffer` sends no `s`, so it reads the OG).

## Phase 3 — Instagram profile pictures

**Schema.** `social_accounts.image_url` (one URL) + `is_hq_image boolean not
null default false`; drop `image_url_hq`. `social_account_history`: keep
`previous_image_url` and `image_change`, drop `previous_image_url_hq`.
`photos`: one row per picture describing the OG at that key; the generated
150 sub-image rows and `ogMetadata.derivedFromPhotoId` go away;
`storeProfileThumbnail` is deleted.

**Flow.** The decision table in `server/profile-image.ts`
(`classifyProfileImage`) is unchanged; what follows a verdict changes:

| case | today | new |
|---|---|---|
| A / B new picture, 150 or 1080 | new key (+ thumb row for B) | new key, `is_hq = tier == hq` |
| C' / D' / E' / F' different picture | new key (+ thumb) | new key, `is_hq` from tier |
| D improved (same picture, 1080 after the 150) | second key in `image_url_hq`, keep the IG 150 | re-PUT the 1080 to the same key; PRM-S3 replaces the OG and re-bakes; `photos` row updated in place (same id); `is_hq = true`; journal `improved` |
| C / E / F same picture, not better | skip | skip |

The key is stable across "improved", so `people.image_url` (auto-pass-in)
and anything else holding that URL upgrades with it. `previous_image_url` on
an `improved` entry equals the current URL; the history modal shows one
picture labelled 150 → 1080.

Recognition: `isHqPhoto (widthPx ≥ 320)` stays the gate;
`associateProfileFaces` joins on `photos.location = social_accounts.image_url`
instead of the COALESCE; `profilePhotos()` stops special-casing `imageUrlHq`.
Client: the `imageUrlHq ?? imageUrl` sites become `imageUrl` at the right
size; "LQ only / recognition needs 320px" affordances read `isHqImage`.

Cache caveat on D: the presigned URL is stable for the 12 h signing window
and the proxy route sets `max-age=86400`, so after an in-place upgrade a
browser can show the old bytes for up to a day. "Improved" is the same
picture, so the thumbnails are visually identical; only the header's
sharpness lags. Accepted; no cache-buster.

**Migration job** `migrate_profile_image_tiers` (task-worker + button,
replaces `backfillProfileImageTiers`):

1. Build `thumbUrl → hqUrl` from the sub-image rows'
   `ogMetadata.derivedFromPhotoId`.
2. Accounts with `image_url_hq`: `image_url := image_url_hq`,
   `is_hq := true`. Without: `is_hq := photos.widthPx ≥ 320`.
3. Rewrite every column that may hold a thumb URL through the map:
   `people.image_url`, `groups.image_url`, `social_profile_versions.image_url`,
   `social_account_history.previous_image_url :=
   coalesce(previous_image_url_hq, mapped(previous_image_url))`.
4. Delete the thumb objects (`deleteImageFromPrmS3`) and their `photos` rows.
5. Once the job reports zero remaining, `db-init` drops the two `_hq`
   columns — a later, separate step so a half-run migration cannot strand
   data.

## Order of work

1. Phase 1 in PRM-s3 with tests; measure wasm webp encode time first.
2. Phase 2; flip the highest-traffic lists to `?s=64`.
3. Phase 3 schema + `profile-image.ts`, then the migration job, then the
   column drops.
