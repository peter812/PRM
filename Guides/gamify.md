# Engagement & Gamification Report for PRM

**Author:** Engagement Expert (consulting)
**Subject:** PRM — a Personal Relationship Manager with an Obsidian-style UI, social graph, face/image recognition, ELO ranking, AI chat, and import/export tooling.
**Goal:** Improve UX, increase session length and return frequency, surface new use cases, and gamify the GUI in ways that feel rewarding rather than manipulative.

---

## 1. Executive Summary

PRM already has the raw ingredients of a deeply engaging product: a personal social graph, ELO ranking, face/image recognition, AI chat, tasks, and rich relationship metadata. The current gap is not features — it is *feedback loops*. Users add data but rarely see it transformed into insight, progress, or delight.

This report recommends a three-layer engagement strategy:

1. **Foundation (UX polish):** reduce friction on the most-used flows (people list, person profile, graph) so users stick around long enough to encounter deeper features.
2. **Loops (habits):** add lightweight daily/weekly rituals that pull users back — a "Relationship Inbox," streaks, and re-engagement nudges driven by tasks and recognition.
3. **Play (gamification):** layer meaningful, non-cynical game mechanics on top of existing systems (ELO, graph, recognition) so the app feels alive and rewarding to maintain.

Properly sequenced, these changes should noticeably increase session time, weekly active usage, and the number of populated entities per user.

---

## 2. Current State Observations

Pages present today include: `people-list`, `person-profile`, `groups-list`, `group-profile`, `social-graph-3d`, `elo-ranking`, `ai-chat-demo`, `recognition-faces`, `recognition-images`, `import-contacts`, `import-social-media`, `tasks-settings`, `welcome-page`, plus settings.

**Strengths**
- A 3D force graph is inherently engaging and shareable.
- ELO ranking is a built-in gamification primitive.
- Face/image recognition makes data-entry feel magical.
- AI chat opens an open-ended interaction surface.
- Obsidian-style UI implies power-user affinity.

**Engagement risks**
- Onboarding likely ends at "empty database" — high cold-start cost.
- No visible progress indicators (profile completeness, graph density, streaks).
- Tasks exist but are not surfaced as a daily ritual.
- ELO is a leaderboard with no narrative — users don't know *why* the numbers move.
- AI chat is a "demo" page, not woven into core flows.
- No notifications, digests, or "the app missed you" hooks.

---

## 3. UX Improvements (Foundation)

These are low-risk, high-leverage changes. Without them, gamification feels like lipstick.

### 3.1 First-run experience
- Replace the empty welcome page with a 60-second onboarding: "Add your first 3 people," "Import from contacts," "Take a photo / upload one image."
- Use a visible **profile completeness ring** on every person card. Humans cannot resist closing a circle.
- Offer a guided demo dataset (toggleable) so the graph and ELO are non-empty on day one.

### 3.2 People list & person profile
- Sticky search + filter chips (tags, groups, last-contacted, relationship type).
- "Last interaction" badge on every card with color decay (green → amber → red) — the *single most powerful* CRM nudge.
- On the profile: a **timeline view** of interactions, photos, and AI-generated summaries — turns a static record into a story.
- Quick-action bar: "Log call," "Log meeting," "Add note," "Add photo," each one keystroke away.

### 3.3 Graph
- Persist the user's last camera position and filter state.
- Add **graph "lenses"**: "Family only," "Last 30 days," "Strongest ties," "Lost touch with."
- Click a node → side drawer (don't navigate away). Keeps the user *in* the graph.
- Mini-graph embedded on each person profile showing their 1- and 2-hop neighborhood.

### 3.4 Performance & polish
- Skeleton loaders, optimistic updates, and keyboard shortcuts (`/` search, `g p` go to people, `n` new person). Power users measure quality in milliseconds.
- Mobile-first review: most relationship logging happens *right after* an interaction, on a phone.

---

## 4. Increasing Stay Time & Return Frequency (Loops)

### 4.1 The "Relationship Inbox" (daily ritual)
A single page that, every day, shows 5–10 cards:
- People you haven't contacted in N days (decayed by relationship strength).
- Birthdays / anniversaries this week.
- Open tasks tied to people.
- New face matches that need confirming.
- AI-suggested "you mentioned X last time — follow up?"

Each card has two buttons: **Done** and **Snooze**. This is the single most important habit-forming surface to add.

### 4.2 Streaks & cadences
- "You've kept up with your inner circle 12 weeks in a row."
- Per-person cadence targets ("you wanted to talk to Alice monthly — 4 days left").
- Weekly digest email/notification: "Here's your relationship week."

### 4.3 Re-engagement hooks
- Browser/desktop notifications for time-sensitive tasks.
- A "We missed you" recap on return after >7 days idle: stats, new face matches queued, suggested catch-ups.
- Optional integration with calendar — automatic "log this meeting?" prompts.

### 4.4 AI as a companion, not a demo
- Move AI from a standalone page into a **persistent side panel** scoped to the current person/group/graph.
- Prompts like: "Draft a check-in message to Bob," "Summarize my last 5 interactions with Carol," "Who should I reconnect with this week?"
- This single change typically multiplies session time because every page becomes interactive.

---

## 5. New Use-Case Options

Existing primitives (people, groups, interactions, photos, ELO, graph, AI) can be recombined into several distinct use cases. Each one expands the addressable audience without new infra.

| Use case | Description | Existing primitives leveraged |
|---|---|---|
| **Networking / career CRM** | Track professional contacts, follow-ups, intros made/received. | people, tasks, interactions, AI drafts |
| **Dating / social journal** | Log dates, vibes, ELO of compatibility, photo memory. | ELO, recognition, profile, timeline |
| **Family historian** | Multi-generation tree, photo tagging, anniversaries. | graph, face recognition, groups |
| **Event/community organizer** | Who came, who knows whom, who to invite next. | groups, graph lenses, tasks |
| **Therapy / self-reflection journal** | Private mode, mood tags per interaction, AI patterns. | interactions, AI, private flag |
| **Sales-lite / freelance client tracker** | Pipeline-style stages on a person. | relationship types, tasks |
| **Memory aid (ADHD / aphantasia / aging)** | "Who is this?" face lookup, last-conversation summary before a call. | face recognition, AI, timeline |
| **Reunion / alumni tool** | Import yearbook, recognize faces, suggest reconnections. | import, recognition, graph |

Recommendation: ship **role-based onboarding** ("I'm using PRM for…") that pre-selects fields, default tags, and a tailored Inbox for each persona. Same product, multiple front doors.

---

## 6. Gamifying the GUI (Play)

Gamification works when it amplifies an intrinsic motivation the user already has. PRM's intrinsic motivation is **caring for relationships**. So the metrics must reward depth and consistency, not vanity.

### 6.1 Make ELO meaningful
Today ELO is a number. Make it a *story*:
- Show **why** a rating moved ("+12 after logging a deep conversation," "−3, you haven't talked in 60 days").
- Multiple ELO axes per person: **closeness**, **reciprocity**, **frequency**, **trust**. A radar chart per person is far more motivating than one number.
- Optional weekly head-to-head prompt: "Who do you actually feel closer to — A or B?" This trains the model and is genuinely fun.

### 6.2 Achievements (sparingly)
Tie achievements to *behaviors that reflect real-life value*, not gaming:
- **Connector** — you introduced two people who now have their own edge.
- **Historian** — 50 interactions logged with notes.
- **Reconnector** — revived a tie that decayed past red.
- **Cartographer** — graph reaches 100 / 250 / 500 nodes.
- **Photographer** — 25 faces auto-recognized.
- **Steady** — 4-week streak on the Inbox.

Show them quietly on the profile, not as toast spam. Achievements should feel discovered.

### 6.3 Visual progress everywhere
- Profile completeness rings (per person and aggregate).
- Graph "health" score: density, recency of interactions, breadth across groups.
- Heatmap calendar of interactions logged (à la GitHub contributions). This single component is famously sticky.
- Per-group "warmth" indicator that decays without activity.

### 6.4 Game-like recognition flow
- "Mystery face" mini-game: PRM picks an unlabeled face from your photos and asks "Who is this?" Three suggestions + "someone new." Five a day, optional. Turns data cleanup into a 60-second daily puzzle.
- Reward: small XP toward Cartographer/Photographer.

### 6.5 The graph as a playground
- Time-scrub slider on the 3D graph: replay how your network grew over months/years. Highly shareable.
- "Six degrees" mini-tool: shortest path between any two people, animated.
- "What if?" mode: hide a node and show the graph that remains — surfaces structural-hole insights.

### 6.6 Social proof, privately
PRM is personal data, so leaderboards must **not** be public. Instead:
- Personal-best stats: "Your longest streak," "Most connected month."
- Optional comparison to *yourself a year ago*. Nostalgia is a strong driver.

### 6.7 Anti-patterns to avoid
- ❌ Public leaderboards of friends/contacts (creepy, privacy-hostile).
- ❌ Forced daily streaks with shame loops (anxiety, churn).
- ❌ Loot-box randomness on relationship data (cheapens the domain).
- ❌ Confetti after logging a death/illness/breakup. Always allow the user to flag interaction sentiment so reward animations suppress appropriately.

---

## 7. Suggested Roadmap (priority order)

1. **Last-interaction decay badges** + **profile completeness rings** on people list. (Foundation, days.)
2. **Relationship Inbox** page wired to existing tasks + birthdays + face-match queue. (Habit driver.)
3. **AI side panel** scoped to current entity, replacing the standalone demo page. (Stay time.)
4. **Interaction heatmap** + per-person timeline. (Stickiness + nostalgia.)
5. **ELO storytelling**: reasons + multi-axis radar. (Gamification with substance.)
6. **Mystery-face daily mini-game**. (Daily ritual + data quality.)
7. **Role-based onboarding** for the eight personas in §5. (Top-of-funnel growth.)
8. **Graph time-scrub & lenses**. (Wow factor + retention.)
9. **Achievements layer** on top of behaviors already tracked. (Compounding effect, last.)

Ship items 1–3 before any gamification. Gamification on top of broken UX amplifies the wrong things.

---

## 8. Metrics to Watch

- D1 / D7 / D30 retention.
- Median session length, sessions per active week.
- Median interactions logged per active user per week.
- Inbox open rate and Done/Snooze ratio.
- Graph density (edges/nodes) over time per user.
- Time-to-first-value: minutes from signup to first logged interaction.
- AI panel engagement rate per session.

If the Inbox open rate exceeds ~40% of weekly actives and median interactions/week is climbing, the loop is working — gamification will then compound the gains rather than mask flat usage.

---

## 9. Closing Thought

PRM's competitive advantage is that it treats relationships as a graph worth tending. The job of UX and gamification here is not to make users *play more*, but to make the act of caring about people feel **visible, rewarding, and a little bit magical**. Every mechanic in this report is in service of that goal — surface the value the user is already creating, and they will return on their own.
