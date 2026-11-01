# Account faces tab: plan

**Date:** 2026-10-28
**Goal:** a **Faces** tab on the social account page with two sub-tabs:

1. **Account holder**: find, confirm and clean up the face group that is this account's own face.
2. **Other faces**: everyone else who shows up in this account's profile images, posts, stories and
   tagged posts. Named people are listed, and unnamed faces get a cluster view limited to this account.

## Decisions (2026-10-28)

| # | Question | Decision |
|---|---|---|
| 1 | Which group is the primary face | **Always the account's own** `social_accounts.personface_uuid`. When the owner person's `people.personface_uuid` differs, the tab shows both and offers ways to resolve it (§2.3). |
| 2 | Which photos count as the account's | Profile images (current and past), own posts (author **or** coauthor), own stories, and **posts by others that tag this account**. |
| 3 | Clusters | **Filter the global clusters**. This adds no new clustering path. A cluster is shown when some of its members are in this account's photos, and only those members count. |
| 4 | Named faces in Other faces | **Yes**, as a "People seen" list above the unnamed clusters. |

---

## 0. What already exists (reuse, don't rebuild)

| Piece | Where | Use here |
|---|---|---|
| Account's own face group | `social_accounts.personface_uuid`, set by `linkProfileFace` / `associateProfileFaces` | The primary face (§2). |
| `no_face` flag + `noFaceImpact` / `setAccountNoFace` | `server/recognition.ts` | "This account has no single face" lives on the Account holder tab. |
| Profile photo runs | `profilePhotos`, `recognizeProfilePhotos` | Empty state: pick the face from a profile image. |
| Linking | `connectFace`, `connectFaces`, `disassociateFace`, `mergeFaceGroups` | Every action in this tab calls these. No new linking logic. |
| Verify tier | `server/face-verify.ts` (`getVerifyGroup`, `confirmVerify`), `faces.verify_personface_uuid` | The "Probably them" grid on the Account holder tab. |
| Face → photo | `faces.photo_id`, plus `photos.facial_ids` / `photosContainingFaces` for sub-images | Builds the account's face scope (§1). |
| Cluster cards, dialog and actions | `client/src/components/face-clusters-tab.tsx`, `server/face-clusters.ts` (`listClusters`, `getCluster`, `nameCluster`, `dismissClusterFaces`, `rejectClusterSuggestion`) | Other faces → Clusters, with a scope added (§3.2). Actions already accept `faceIds`. |
| Identity labels + crops | `buildIdentityCache`, `buildCropCache` (`server/face-review.ts`) | Labels on the People seen list. |
| `IdentitySearch` | `client/src/components/identity-search.tsx` | The "who is this" picker everywhere in the tab. |

---

## 1. Scope: "this account's faces" (server)

There is one helper in a new `server/account-faces.ts`, and everything below filters through it:

```ts
/** SQL subquery: ids of faces in photos that belong to this account (decision 2). */
function accountFaceScope(accountId: string): SQL
```

A face is in scope when its photo (`faces.photo_id`, or the parent photo of a sub-image) has a
`prm_location` of:
- `profile_image:<accountId>` (also the older `social_profile_image:<accountId>` spelling, if it is still written anywhere. Check this.)
- `post:<postId>`, where the post is not deleted and **either**
  - `social_account_posts.social_account_id = accountId` (own posts and stories, because stories are `post_type = 'story'`), **or**
  - `coauthor_account_ids ? accountId`, **or**
  - the post tags this account (see below).

**Tagged posts.** `tagged-posts-plan.md` adds a link table that hasn't shipped yet. Until it ships, a
post by someone else counts as tagged when `mentioned_accounts` contains this account's username.
That is the same signal Face review's `mentionedHandlesFor` already uses. When the link table lands,
swap this branch over to it. That change stays inside this one helper.

Each in-scope face also carries a `source` (`profile` | `post` | `story` | `tagged`) and a date
(`posted_at`, or the photo's `uploaded_at` for profile images), so the UI can show where each face
came from.

Scale: the biggest accounts have a few thousand photos, and imports top out at 10k, so a plain
subquery is enough. No materialized scope table.

---

## 2. Sub-tab 1: Account holder

### 2.1 Endpoint

`GET /api/social-accounts/:id/faces/holder` returns:

```ts
{
  group: string | null,                 // social_accounts.personface_uuid
  noFace: boolean,
  faces: HolderFace[],                  // every face in the group, in scope or not, newest first
  probably: HolderFace[],               // verify tier: faces with verify_personface_uuid = group
  owner: { personId, name, group: string | null, crop: string | null } | null,
  conflict: "none" | "owner-has-none" | "differs",   // §2.3
  profileCandidates: { photoId, url, faces: { id, cropUrl, group, label }[] }[],  // only when group is null
}
type HolderFace = { id, cropUrl, photoId, source, date, inScope: boolean,
  how: "confirmed" | "auto" | "profile",  // auto = auto_match_score set; profile = from profile-image linking
  score?: number }
```

### 2.2 UI

- **Header**: the group's best crop, the face count, a "N in this account / M elsewhere" split, and the
  "No single face (brand/org)" switch, which reuses `noFaceImpact`'s confirm dialog.
- **Needs a look** strip: the auto-assigned faces (`how = "auto"`), lowest score first, each with
  ✓ Keep (`connectFace`, which clears `auto_match_score`) and ✕ Not them (`disassociateFace`).
- **Probably them** grid: the verify tier for this group, with a multi-select confirm/reject that
  posts to the existing `/api/face-review/verify/:group/confirm`.
- **All faces** grid: filters by source and by in this account / elsewhere. Clicking a face opens
  its photo. Multi-select → **Remove from this face** (`/api/faces/remove-from-group`).
- **Empty state** (no group): list `profileCandidates`, with one "This is @username" click per face,
  using `connectFace` with `socialAccountId`. If no profile image has faces, show
  "Run face detection on profile images" (`recognizeProfilePhotos`). Also show the top in-scope
  clusters whose suggestion is this account, from the §3.2 endpoint filtered to that suggestion.

### 2.3 Account face vs owner face (decision 1)

This only applies when the account has an owner. The two faces are shown side by side.

| State | Shown | Options |
|---|---|---|
| `owner-has-none`: the account has a group and the person doesn't | "Use @x's face for {name}?" | **Use it**: set `people.personface_uuid` to the account's group. |
| `differs`: both have groups and they differ | Both crops, with face counts | **Same person, merge** (`mergeFaceGroups(accountGroup, ownerGroup)`, then point both rows at the kept group). **The account's face is wrong** (unlink the account's group so it can be picked again, §2.2 empty state). **The person's face is wrong** (point the person at the account's group). **Leave them different** (writes `face_pair_dismissals` for the two groups, which hides this banner and stops Faces → likely-same from suggesting them). |
| The account has no group and the owner does | "Use {name}'s face for this account?" | **Use it**: set `social_accounts.personface_uuid` to the owner's group. |

Check before building: confirm what `mergeFaceGroups` does to `social_accounts` / `people` rows that
point at the merged-away group. If it doesn't repoint them, the merge option does it in the same
transaction.

---

## 3. Sub-tab 2: Other faces

Every in-scope face that is **not** in the account's own group, in three sections.

### 3.1 People seen

`GET /api/social-accounts/:id/faces/people` returns one row per named group in scope (excluding the
account's own group):
`{ group, label, personId?, socialAccountId?, crop, count, sources: Record<source, n>, lastSeen }`,
sorted by count, with labels from `buildIdentityCache`.

The UI is a list of rows. Expanding a row shows that group's faces **in this account**, each with
✕ Not them (`disassociateFace`). The label links to the person or account page. The group's
auto-assigned faces get the same ✓/✕ as §2.2, so wrong auto-matches can be fixed here.

### 3.2 Clusters (scoped global clusters)

Add an optional `scopeAccountId` to `listClusters`, `getCluster` and `getClusterSummary` in
`server/face-clusters.ts`. When it is set:
- `size` = the number of the cluster's open faces **in scope**, sort by that, and drop clusters with 0.
- The montage shows in-scope members first. The card adds a quiet "+N elsewhere" when the cluster
  also has members outside this account.
- `clusterSuggestions` is unchanged. It already counts over the cluster's photos, so the suggestions
  stay global, which is what you want for "who is this".

Routes: `GET /api/face-review/clusters?account=<id>` and `GET /api/face-review/clusters/:id?account=<id>`,
the same handlers with one more parameter.

Client: `FaceClustersTab` takes an optional `accountId` prop that adds `account=` to its queries.
Actions send `faceIds` = the in-scope members by default, and the dialog adds a
**"Apply to whole cluster (N)"** toggle that drops `faceIds`. The 409 reload already handles
clusters that change underneath.

### 3.3 Loose faces

In-scope open faces with no `cluster_id`: new since the last run, singletons, or noise (hidden unless
the "show noise" toggle is on). These are shown as a grid, each with `IdentitySearch` →
`/api/face-review/assign`, and Skip (dismiss). This is the Face review card flow without the photo
chrome. Clicking a face opens its photo.

`GET /api/social-accounts/:id/faces/loose?cursor=&noise=` is paged like the Face review queues.

---

## 4. Tab placement + counts

- Add a **Faces** `TabsTrigger` to `social-account-profile.tsx` between Stories and Messages, with
  `value="faces"` (URL `?tab=faces`). The content lives in a new `client/src/components/account-faces-tab.tsx`,
  which has inner Tabs "Account holder" / "Other faces".
- Sidebar badge: the open in-scope unnamed faces plus the holder's auto and verify faces, from
  `GET /api/social-accounts/:id/faces/counts`. Hide the badge at 0.
- Every mutation invalidates `/api/social-accounts/:id/faces/*` and the existing Face review keys
  (`invalidateFaceReview`), so the global pages stay in sync.

---

## 5. Rollout

1. `accountFaceScope` + `/faces/counts` + the empty tab shell with the badge. Check the counts against
   Face review on 2–3 accounts.
2. Account holder: the endpoint, header, all-faces grid, remove, and the empty-state picker.
3. Account holder: Needs a look, Probably them, the no-face switch.
4. Account vs owner resolution (§2.3), including the `mergeFaceGroups` repoint check.
5. Other faces: People seen.
6. Other faces: scoped clusters (server param + `accountId` prop).
7. Other faces: loose faces.
8. When `tagged-posts-plan.md` ships: switch the tagged branch of `accountFaceScope` to its link table.

Schema: one index, `photos_prm_location_idx` (added in step 1; without it every scope lookup
seq-scanned photos, ~750 ms → ~250 ms). The rest of the cost is the `mentioned_accounts` text scan,
which step 8 removes. Otherwise everything reads existing columns, and the only writes are the existing linking
functions plus `face_pair_dismissals`.

## 6. Open questions

1. **Whole-cluster naming default**: this plan names only the in-scope members unless you flip the
   toggle. Do you want it the other way round?
2. **Mentions before the tagged table ships**: counting caption and story `mentioned_accounts` as
   "tagged" is broader than Instagram's Tagged tab (a caption @mention isn't a photo tag). Is that OK
   as a stopgap, or should the tagged source wait for the link table?
3. **Person page**: should the person page get the same tab later, scoped to the union of all their
   accounts? `accountFaceScope` would generalize to a list of account ids.
