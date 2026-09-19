# Instagram Stories — extraction plan

Nightly, an agent-driven Chrome logged in as your main Instagram account
watches every story in the tray, keeps each story's image plus its metadata,
and hands them to PRM per account per day. Stories from accounts PRM doesn't
know are dropped but **logged**, so you can always answer "why isn't X's
story here?".

**As built (2026-09-15)** — code lives in `../PRM-stories` (scraper) and
`server/routes/stories.ts`, `server/stories-scheduler.ts`,
`client/src/pages/stories-settings.tsx` (PRM). Deviations from the text below:

- **Every tray entry is watched, seen or not** (the `seen < latest_reel_media`
  filter in §2.3 is gone): a story lives 24 h and the run happens once a day,
  so anything you looked at yourself during the day would otherwise be lost.
- **Videos are kept as their cover frame** (§2.3's video skip and the
  `skipped:video` outcome / `videosSkipped` count are gone): every story item
  carries `image_versions2`, for a video that is the frame the viewer shows
  before playback. The story row is stored like an image one with
  `metadata.mediaType = 2` and `metadata.videoDuration`; the UI marks it.
- **No Docker.** The scraper runs natively (`npm start`); there is no image,
  compose file, Xvfb or noVNC (§5 and step 7 of §6 are dropped).

- **PRM owns the schedule** (§2.4 is superseded). `stories-scheduler.ts` ticks
  every minute; each evening it picks a random minute in the admin-set window
  (`stories_run_window`), rolls the skip-day chance, and if not skipping mints
  a `story_scrape_runs` row plus a random token (sha256 stored, **6 h** expiry)
  and `POST`s `{ runId, token }` to `<stories_api_url>/run`. The scraper has no
  scheduler, no `state.json`, and stores nothing secret — only `PRM_URL`.
- **Auth** (§4.1 is superseded): the scraper confirms the token it was handed
  with `GET /api/v1/stories/auth`, then uses it as `x-stories-token` on the
  item and manifest posts. The extension-token pairing is gone. Runs are
  instance-wide (no `user_id`); ingest runs as system. Settings are admin-only
  `app_settings` keys (`stories_enabled`, `stories_api_url`,
  `stories_run_window`, `stories_run_every_days`,
  `stories_skip_day_probability`; `stories_image_storage` has since been folded
  into the app-wide `image_storage_mode`).
- **Login from the settings page**: `POST /api/stories/login` (admin) asks the
  scraper's `POST /login` to open Instagram in a visible Chrome window on its
  profile. The page lives under
  Settings → Import & Export → Instagram Stories with a how-to, the login
  section, the schedule (every N days + time-of-day window) and the run log.
- **The start call is the login check**: the scraper opens instagram.com and
  answers `{ ok: true }` or `{ ok: false, reason: needs_login | checkpoint |
  already_running | error }` before the run proceeds; PRM records the reason
  as the run status and keeps trying nightly (a human logs in from the same
  profile in the meantime). `rate_limited` makes PRM wait 48 h.
- **Timing** (§2.3): most stories get a 0.5–1 s flick; every 4–7 stories one
  is held 5–9 s; every 25–40 the mouse idles 8–20 s; 4 % back-step once.
  Videos get the same flick. No per-account sampling skips (the viewer
  auto-advances through the tray, so "not opening" an account isn't a thing).
- Dedupe uses the existing deterministic post id (`instagram:story:<pk>`)
  instead of a new `external_id` column, and `expiresAt` lives in `metadata` —
  the only new post column is `metadata jsonb`. The manifest is posted once
  after the items. The settings page links a `no_account` username to its
  Instagram profile rather than a pre-filled create dialog.
- **No analysis hooks are attached** (§4.2 step 4 and §7 are off): no vector
  sync, no face / LLM tasks. Phase 2 will switch them on.

**Multiple importers (2026-09-15)** — further deviations:

- **One card per Instagram account.** `story_importers` replaces the flat
  `stories_*` settings keys (a one-time boot migration turns them into card
  #1 and attaches existing runs). Each row is one prm-stories install (its
  own `STORIES_PORT`, profile and login) with its own `service_url`,
  `run_every_days`, `run_window`, `skip_day_probability`, `enabled`,
  `next_run_at` and `download_videos`. Media storage follows the app-wide
  `image_storage_mode`.
  The scheduler ticks every importer independently (`Promise.allSettled`);
  `story_scrape_runs.importer_id` says which card a run belongs to
  (`ON DELETE SET NULL`, so history survives a removed card). The settings
  page is a `+` button and a card per importer, each with its own session
  status, login and run-now; storage is a separate card. The runs table gained
  only an *Importer* column.
- **Provenance.** At the start of every run the scraper reads the logged-in
  @username from the nav's Profile link (fallback: the `viewer` object in the
  home page's inline JSON). It goes into the `/run` reply (`username`), onto
  `story_scrape_runs.scraped_from`, `story_importers.last_username` (shown on
  the card) and every story's `social_account_posts.scraped_from` (shown behind
  an info icon in the story dialog). `meta.scrapedFrom` is **required** by the
  items route. If the username can't be read the run ends `no_username` and
  nothing is delivered.
- **Videos** (per card, off by default). PRM sends `videos: true` in the `/run`
  body; the scraper fetches `video_versions[0].url` from inside the page (the
  viewer plays from `blob:` urls, so nothing is on the wire), caps it at
  `MAX_VIDEO_MB` (50) and sends it as a second multipart field `video`. PRM
  stores it with `uploadMediaLocally` / `uploadMediaToS3` and sets
  `metadata.videoUrl`; the cover jpg stays in `content`. The story dialog plays
  it with the cover as poster. Over the cap → cover only, `item.video =
  "too_large"`.
- **Per-account delivery.** §2.7's "no PRM traffic while Instagram is open" is
  dropped (PRM is on the LAN). When the viewer moves from one account to the
  next, the one it left is queued: `POST /api/v1/stories/check` first (known
  pks → `duplicate`, unknown posters → `no_account`, no bytes fetched for
  either; `outcome: "skipped:precheck"`), then image (+ video) download, one
  `/items` post per story, and a manifest upsert with `status: "running"` so
  PRM's page shows progress live. The queue is a serial promise chain that
  never blocks the viewer; the run waits for it before navigating or closing
  Chrome. The final manifest (`completed`) goes out from `deliverPending`
  after the browser is closed, together with any retries.

This document covers extraction and ingest only. Analysis (faces, description,
timeline note) is a follow-on; §7 sketches how it plugs in so the ingest shape
doesn't have to change later.

Decisions already made:

| Question | Answer |
|---|---|
| Host | Standalone Puppeteer service, separate repo/dir, run natively |
| Scope | Everyone in the stories tray of the logged-in account |
| Account | Your main account (posters will see you in "Seen by") |
| Unknown accounts | Drop the story, log that it was seen |
| Cadence | Once a day, evening |
| Videos | Keep the cover frame (`image_versions2`) as the story image, flagged `mediaType: 2` |
| Story → note | Fully automatic (phase 2) |

---

## 1. Why network interception, not DOM scraping

When the web story viewer opens, the Instagram web app itself requests the
story batch as JSON (historically `GET /api/v1/feed/reels_media/?reel_ids=…`;
newer builds route the same payload through
`POST /graphql/query` with `PolarisStoriesV3ReelsMediaQuery` / an
`xdt_api__v1__feed__reels_media` key). That payload contains, per story item,
everything the DOM shows and a lot it doesn't:

| Field | Meaning |
|---|---|
| `pk` / `id`, `code` | stable story id (dedupe key) |
| `media_type` | `1` image, `2` video — stored in `metadata.mediaType`; a video's `image_versions2` is its cover frame |
| `taken_at`, `expiring_at` | unix seconds |
| `image_versions2.candidates[]` | signed CDN urls, largest first |
| `user.username`, `user.pk`, `user.full_name`, `user.profile_pic_url` | the poster |
| `reel_mentions[]` | `@` stickers → `user.username` |
| `story_link_stickers[]` | link stickers → `story_link.url`, `story_link.display_url` |
| `story_hashtags[]`, `story_locations[]` | hashtag / location stickers |
| `story_feed_media[]` | reshared post → `media_id`, `media_code` |
| `story_music_stickers[]`, `story_polls[]`, `story_questions[]`, `story_countdowns[]`, `story_sliders[]` | other stickers |
| `story_cta[]`, `sponsor_tags`, `is_paid_partnership` | ads / partnership |
| `accessibility_caption` | Instagram's own alt text — free first-pass description |

The DOM shows only what's rendered: link stickers become a generic
"See link" chip, mentions are sometimes flattened into the image, and the
image element is a resized candidate. So:

- **Primary**: `page.on('response')` → match the reels_media request → parse
  JSON → walk `reels[*].items[*]` (or `reels_media[*].items[*]` for the
  GraphQL shape). Zero extra requests; we only read what the page already
  fetched. Same for the tray list (`/api/v1/feed/reels_tray/` or the
  `PolarisStoriesV3TrayQuery` GraphQL) — it lists every account with unseen
  stories plus `latest_reel_media` timestamps, so we know the run size before
  opening anything.
- **Image bytes**: also from interception. The viewer loads the image from
  `scontent-*.cdninstagram.com`; match the response url to
  `image_versions2.candidates[0].url` (compare path + `ig_cache_key`, the
  query signature differs between candidates) and take `response.buffer()`.
  If the viewer loaded a smaller candidate, fall back to
  `page.evaluate(() => fetch(url).then(r => r.blob()))` for the largest one —
  still in-page, same cookies/headers, same TLS fingerprint as the page.
  Never fetch CDN urls from Node.
- **Fallback when the JSON shape drifts**: always write the raw response body
  to `runs/<date>/raw/<n>.json` before parsing. If parsing yields zero items
  while the tray reported stories, mark the run `parse_failed` and keep the
  raw dump; fixing the walker is a data-only patch, not a re-scrape. A DOM
  fallback (screenshot of the `section[role=dialog]` viewer + `img[srcset]`)
  is deliberately *not* built up front — it would need the same maintenance
  and gives worse metadata.

## 2. The scraper service (`prm-stories/`)

Separate package (sibling of PRM, like PRM-face), Node 20 + TypeScript,
ESM. No shared code with PRM; the contract is the HTTP API in §4.

### 2.1 Stack

- **`rebrowser-puppeteer`** — drop-in `puppeteer` with the runtime patched so
  CDP-driven Chrome doesn't leak the well-known automation markers.
  `puppeteer-extra-plugin-stealth` is *not* used: last release 2023, and the
  things it patched (`navigator.webdriver`, plugins array) aren't what's
  detected any more (Sec-CH-UA consistency, CDP `Runtime.enable` leak,
  TLS/JA4). rebrowser handles the CDP leak; the rest is handled by using real
  Chrome, not Chromium.
- **`ghost-cursor`** — Bézier mouse paths with overshoot for every click.
- **Real Chrome** (`channel: 'chrome'`, i.e. the machine's Chrome install /
  the `google-chrome-stable` package in the image) — real TLS stack, real
  client hints, updates itself.
- **Persistent profile**: `userDataDir: ./profile` (a Docker volume when
  containerised). Cookies, localStorage, `ig_did`, device id, everything
  survives between runs. This *is* the login; there is no login code.
- **Headed under Xvfb** in Docker (`xvfb-run`), headed normal window on a
  desktop. Headless Chrome (even `--headless=new`) has measurable
  rendering/GPU-fingerprint differences; a real window with a fixed
  1440×900 viewport does not. On a desktop the window can be parked
  off-screen (`--window-position=-4000,0`) if it's in the way.
- Launch flags: **as few as possible.** Only `--window-size`,
  `--window-position`, `--lang`. No `--disable-blink-features`, no
  `--no-sandbox` outside Docker, no `--disable-gpu`. Every flag is a
  fingerprint deviation from stock Chrome.
- Timezone / locale / UA are *not* spoofed — they must match the machine and
  IP the profile was logged in on.
- Network: **your home connection.** Residential IP + one account is the
  single largest ban-risk reducer. If it ever moves to a VPS, it needs a
  residential proxy; a datacenter IP on a personal account is a checkpoint
  waiting to happen. Documented as an operational constraint, not code.

### 2.2 First run / login

1. `npm run login` launches the profile headed (on Docker: the container
   exposes noVNC on `:6080`, or you run the login step once natively and copy
   the `profile/` dir into the volume). You log in by hand, tick "Save
   login info", close the window.
2. Every subsequent run starts with `page.goto('https://www.instagram.com/')`
   and checks for the tray (`role=menu` with story rings) vs. the login form
   / a checkpoint page. **Logged out or checkpointed ⇒ the run ends
   immediately with status `needs_login` / `checkpoint`** and PRM is told
   (§4.3). The service never types credentials and never solves a
   challenge. Instagram's checkpoint flow is the account-level tripwire; the
   only correct response is a human logging in from the same profile.

### 2.3 A run, step by step

```
warmup        → home feed, 2–4 slow scrolls, random 20–60 s, hover a post or two
tray          → intercept tray JSON: [{ user, latest_reel_media, seen, ... }]
              → every entry, seen or not (as built; the plan had an unseen filter)
              → cap at MAX_ACCOUNTS (default 150), shuffle order slightly
              → decide per-account skip: 5–10% of accounts are randomly NOT opened
                tonight (humans don't watch every ring); they're still logged
                as `skipped:sampling` so the gap is explainable
open          → ghost-cursor click on the first chosen ring
per story     → wait for the reels_media response for this reel (already
                intercepted; usually batched 3–5 accounts ahead)
              → media_type 2 (video): advance after 0.6–1.8 s ("swipe past")
              → media_type 1 (image): dwell 1.8–6.5 s (log-normal), then advance
                • advance = click the right-hand third of the viewer (ghost-cursor,
                  jittered target) 70%, ArrowRight 20%, let auto-advance 10%
                • 3–5% of images: go back one (ArrowLeft) then forward
                • ~2% of accounts: pause on a story 8–15 s
              → the viewer auto-advances to the next account at the end of a reel;
                if it lands on an account not in our chosen list, keep watching
                anyway (leaving mid-tray is more unusual than watching) but respect
                the run budget
              → every 25–40 stories: 8–20 s idle (mouse wander, no clicks)
close         → Escape, 10–30 s on the feed, one more scroll, then browser.close()
budget        → hard stop at MAX_RUN_MINUTES (default 35) regardless of progress;
                remainder is logged `skipped:budget`
```

Timing constants live in `config.ts` and are all ranges; nothing in the run
happens on a fixed interval.

### 2.4 Scheduling

The service is a long-running process with an internal scheduler
(`node-cron` is overkill — a `setTimeout` loop). Each day at 00:05 it picks
tonight's start time uniformly from `RUN_WINDOW` (default `19:30–22:30`
local) and, with `SKIP_DAY_PROBABILITY` (default 0.08), decides to skip the
day entirely. A skipped day is logged as a run with status `skipped`. `npm run
now` triggers an immediate run for testing. Because this is a single account
watched once a day, a run is ~150 accounts × ~2.5 stories × ~4 s ≈ 25 min —
comfortably inside a human evening's Instagram habit.

### 2.5 Tripwires (abort the run, back off)

| Signal | Action |
|---|---|
| HTTP 429, or JSON `{"message":"Please wait a few minutes"}` / `feedback_required` | abort, status `rate_limited`, next run +48 h |
| Redirect to `/challenge/`, `/accounts/login/`, `/accounts/suspended/` | abort, status `checkpoint` / `needs_login`, **no further runs until a human runs `npm run login`** |
| Zero items parsed but tray said N > 0 | finish, status `parse_failed`, raw dumps kept |
| Any unhandled exception | abort, status `error`, screenshot to `runs/<date>/error.png` |

Back-off state is a small `state.json` next to the profile so a container
restart doesn't reset it.

### 2.6 Output on disk

```
runs/2026-09-15/
  run.json                       # manifest, see below
  raw/001.json …                 # every intercepted tray / reels_media body
  someuser/
    3456789012345678901.jpg      # story pk as filename
    3456789012345678901.json     # normalised metadata for this story
  otheruser/
    …
```

`run.json`:

```jsonc
{
  "runId": "uuid",
  "startedAt": "...", "finishedAt": "...", "status": "completed",
  "counts": { "accountsInTray": 163, "accountsOpened": 141, "storiesSeen": 402,
              "imagesSaved": 271, "videosSkipped": 118, "sampledOut": 9, "budgetOut": 4 },
  "items": [
    { "username": "someuser", "storyPk": "…", "takenAt": 1757961234,
      "mediaType": 1, "outcome": "saved" },
    { "username": "someuser", "storyPk": "…", "takenAt": …, "mediaType": 2,
      "outcome": "skipped:video" },
    { "username": "brandx",   "storyPk": null, "takenAt": null,
      "outcome": "skipped:sampling" }
  ]
}
```

Per-story `*.json` (normalised, PRM never sees raw Instagram JSON):

```jsonc
{
  "storyPk": "3456789012345678901", "code": "…",
  "username": "someuser", "userPk": "…", "fullName": "…",
  "takenAt": "2026-09-15T18:12:34Z", "expiresAt": "2026-09-16T18:12:34Z",
  "width": 1080, "height": 1920, "sha256": "…",
  "accessibilityCaption": "Photo by … on … May be an image of 2 people, outdoors",
  "mentions": ["friend1", "friend2"],
  "links": [{ "url": "https://…", "display": "example.com" }],
  "hashtags": ["…"], "locations": [{ "name": "…", "pk": "…" }],
  "resharedPost": { "code": "…", "ownerUsername": "…" } | null,
  "music": { "title": "…", "artist": "…" } | null,
  "stickers": { "polls": [...], "questions": [...], "countdowns": [...], "sliders": [...] },
  "isAd": false
}
```

Runs older than `RETAIN_DAYS` (default 14) are deleted from disk **only
after** PRM has acknowledged every item (§4.2), so the local copy is the
retry buffer.

### 2.7 Delivery

Delivery runs *after* the browser is closed (no PRM traffic while Instagram
is open — keeps the two failure domains apart). Sequence in §4. Items PRM
rejects with 5xx stay queued in `run.json` (`delivered: false`) and are
retried at the start of the next delivery pass; 4xx (`no_account`,
`duplicate`) are final and recorded.

### 2.8 Layout

```
prm-stories/
  package.json               rebrowser-puppeteer, ghost-cursor, zod, undici
  src/
    index.ts                 scheduler loop + CLI (login | now | deliver | status)
    config.ts                env → typed config, all timing ranges
    browser.ts               launch, profile, session check, tripwire detection
    human.ts                 ghost-cursor wrappers: click(el), idle(), wander(), dwell()
    intercept.ts             response listener → tray / reels_media / image bytes
    normalize.ts             raw item → per-story json (the only Instagram-shape-aware file)
    run.ts                   the §2.3 loop, writes runs/<date>/
    deliver.ts               §4 client, retry queue
    state.ts                 backoff / last-run state
  Dockerfile                 node:20 + google-chrome-stable + xvfb + x11vnc/noVNC
  docker-compose.yml         standalone; PRM's docker-compose.yml gets an
                             `extends` block like the whisper service
  .env.example
  README.md                  login procedure, IP warning, how to read run.json
```

`.env`:

```
PRM_URL=http://localhost:5000
PRM_TOKEN=            # extension token, see §4.1
RUN_WINDOW=19:30-22:30
SKIP_DAY_PROBABILITY=0.08
MAX_ACCOUNTS=150
MAX_RUN_MINUTES=35
RETAIN_DAYS=14
CHROME_PATH=          # optional; default = channel 'chrome'
TZ=America/Chicago    # must match the profile's login machine
```

## 3. PRM data model

Reuse, don't add a parallel table:

### `social_account_posts` — a story is a post with `postType = 'story'`

The column already anticipates it (`shared/schema.ts:540`). Add:

- `externalId text` — Instagram `pk`. Unique index
  `(social_account_id, external_id) where external_id is not null`. This is
  the dedupe key for both stories and (later) posts.
- `expiresAt timestamp` — from `expiring_at`.
- `metadata jsonb` — the per-story json from §2.6 minus the fields that have
  their own column. `mentionedAccounts` (existing text column) is filled from
  `mentions` so existing consumers keep working; the rest (links, hashtags,
  locations, reshared post, music, stickers, accessibilityCaption, isAd)
  lives in `metadata`.
- `postedAt` ← `takenAt`; `content` ← `["<stored image url>"]` (existing
  JSON-array-of-urls convention); `description` ← `accessibilityCaption`
  until phase 2 overwrites it with the LLM description.

The image itself goes through the existing photo path: store bytes per the
app-wide `image_storage_mode` (`uploadImage` in `server/image-storage.ts`), `storage.insertPhoto({ location, prmLocation:
"post:<postId>", fileHash, widthPx, heightPx, ogMetadata: { source:
"instagram-story", storyPk, takenAt } })`. `photos.fileHash` dedupes a story
that is a repost of an image already in PRM. The `post:<id>` `prmLocation`
means the face / description pipeline (§7) picks it up with no story-specific
code.

`db-init.ts` migration block + drizzle schema, same pattern as the other
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` blocks there.

### `story_scrape_runs` — the run log (new table)

One row per run, including skipped / failed ones:

```ts
export const storyScrapeRuns = pgTable("story_scrape_runs", {
  id: varchar("id").primaryKey(),                  // runId from the scraper
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull(),                // running|completed|skipped|rate_limited|checkpoint|needs_login|parse_failed|error
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  counts: jsonb("counts").notNull().default(sql`'{}'::jsonb`),
  items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
  error: text("error"),
}, (t) => [index("story_scrape_runs_user_started_idx").on(t.userId, t.startedAt)]);
```

`items[]` is the scraper's `run.json.items` **plus PRM's own outcome** per
item: `{ username, storyPk, takenAt, mediaType, outcome }` where PRM-side
outcomes are `stored`, `duplicate`, `no_account`, `store_failed`. This is the
"I saw the story but there's no account in PRM to put it on" record the user
asked for, and it's queryable: `jsonb_path_query(items, '$[*] ? (@.outcome ==
"no_account")')`. `username` is enough to act on later (create the account,
or match it to a person); the media isn't retained for `no_account` items.

Not a separate items table: a run is ~400 rows written once and read as a
unit; a jsonb column is the simplest thing that works and mirrors
`daily_note_events` style used elsewhere.

## 4. PRM ingest API

New file `server/routes/stories.ts`, registered from `server/routes.ts`.
All routes authenticate with the **existing extension token**
(`authenticateExtensionToken`, `server/routes/social-media.ts:2338`) — the
scraper is just another "extension session". Everything runs inside
`runAsUser(session.userId, …)` like the other extension routes.

### 4.1 Getting a token

Nothing new: Settings → Extension → generate code
(`GET /api/extension-auth/code`), then `npm run pair -- <code>` in the
scraper calls `POST /api/extension-auth/verify` and writes `PRM_TOKEN` to
`.env`. The session shows up in the extension-sessions list under the name
`"Stories scraper"`.

### 4.2 Routes

| Route | Body | Does |
|---|---|---|
| `POST /api/v1/stories/runs` | `{ runId, startedAt, status: "running" }` | upsert `story_scrape_runs` row |
| `POST /api/v1/stories/runs/:runId/items` | multipart: `meta` (per-story json), `image` (jpg) — one story per request | see below → `201 { outcome: "stored", postId }` / `200 { outcome: "duplicate" }` / `202 { outcome: "no_account" }` |
| `POST /api/v1/stories/runs/:runId/finish` | `{ finishedAt, status, counts, items, error? }` | merge scraper items with PRM outcomes recorded during the item posts; final row |
| `GET /api/v1/stories/status` | — | `{ lastRun, backoffUntil, needsLogin }` for the scraper's `status` CLI and the settings page |

Item handling:

1. Resolve account: `social_accounts` where `lower(username) = $1` and
   `type` is Instagram (`social_account_types.name ilike 'instagram'`),
   scoped by the caller's visibility like `GET /api/social-accounts`. None →
   record `no_account` and return `202`. Don't create accounts, don't queue a
   pending import (decision above).
2. Dedupe: `(social_account_id, external_id)` hit → `duplicate`, `200`.
3. Store image (`image_storage_mode`), `insertPhoto`, insert post, update
   `social_accounts.last_scraped_at`.
4. Enqueue `image_tasks` `analyze_img_face` + `analyze_img_llm` for the photo
   (they're stubs today, `server/task-worker.ts:141-156`; §7).

One story per request keeps the multipart small and makes retries per-item.
~300 requests over localhost is nothing.

### 4.3 Status page

`client/src/pages/stories-settings.tsx` under Settings (sidebar entry next
to "Social graph"): last 30 runs as a table (date, status, opened / seen /
saved / videos / no-account counts), expandable to the item list filtered by
outcome. `no_account` rows show the username with a link to the existing
social-account create dialog pre-filled. A red banner when the latest status
is `needs_login` / `checkpoint` — the only condition that needs a human.

## 5. Hosting

Dropped: the scraper runs natively on a desktop (`npm start`), no Docker. It
needs the machine's own Chrome, a window (parked off-screen between logins)
and the home connection's IP (§2.1).

## 6. Build order

1. `prm-stories` skeleton, `login` + `now` CLI, tray + reels_media
   interception writing `runs/<date>/` — **stop here and inspect raw JSON
   against the field table in §1 on a real account.** Everything downstream
   depends on the shape being what's expected.
2. Human-motion layer (§2.3 loop, ghost-cursor, dwell distributions,
   tripwires). Run manually 3–4 evenings, watch for checkpoints.
3. Scheduler + backoff state.
4. PRM: schema (§3), routes (§4), pairing.
5. `deliver.ts` + retry queue; end-to-end run.
6. Status page (§4.3).

## 7. Phase 2 (not in this plan) — what the ingest already enables

- Faces: PRM-face consumes `image_tasks.analyze_img_face` for any photo;
  story photos have `prmLocation = post:<id>` so `faces` / `image_questions`
  attach exactly like uploaded photos.
- Description: `analyze_img_llm` → Ollama vision (`ai-vector.ts:304`) →
  `photos.imageDescription`; copy onto `social_account_posts.description`.
- Memorability + note: a task that takes description + metadata (mentions,
  location, reshared post, accessibilityCaption) and, if the story is
  "memorable", writes a `notes` row on the account's `ownerUuid` person with
  `imageUuid` = the story photo — the link back to the story. Fully automatic
  per the decision above.
- Stories tab on `social-account-profile.tsx`: `GET
  /api/social-accounts/:id/posts?type=story` already returns them (existing
  route at `social-media.ts:891` filtered by `postType`), rendered as a
  date-grouped strip.

## 8. Open risks

- **Instagram changes the JSON.** Mitigated by raw dumps + `parse_failed`
  status; `normalize.ts` is the only file to touch.
- **Ban / checkpoint on the main account.** The decision to use the main
  account was explicit. The mitigations are: real Chrome, real profile,
  home IP, once a day, sampled skips, no automated login, hard stop on the
  first warning sign. A dedicated account remains the fallback and needs no
  code change — just a different profile dir.
- **"Seen by" exposure** — accepted.
- Story image urls are signed and expire in hours; we never store them,
  only the bytes. Nothing in PRM references a CDN url.

Sources consulted for the stealth stack and story JSON fields:
[instagrapi extractors](https://github.com/subzeroid/instagrapi) (private-API
story field names),
[rebrowser-puppeteer](https://github.com/rebrowser/rebrowser-puppeteer),
[ghost-cursor](https://www.npmjs.com/package/ghost-cursor),
[puppeteer-extra-plugin-stealth status](https://www.npmjs.com/package/puppeteer-extra-plugin-stealth),
[Puppeteer stealth alternatives 2026](https://www.scrapingbee.com/blog/puppeteer-stealth-tutorial-with-examples/).
