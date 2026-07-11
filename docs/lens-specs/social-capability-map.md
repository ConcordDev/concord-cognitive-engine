# Social Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Naming-collision investigation (required by this batch's brief)

`social` and `society` (the two lenses in this batch) were flagged as a
likely directory-vs-domain collision risk. Verdict after reading both pages
and both component directories in full: **no collision, but a genuine
oddity worth recording** — `social` and `society` are two completely
distinct, non-overlapping backend domains and frontend concerns (a
Twitter/Instagram-style social hub vs. an NPC-society-simulation dashboard +
World Bank data explorer). The oddity is internal to `society`, not between
the two lenses — see `docs/lens-specs/society-capability-map.md` for that
finding. `social`'s own naming is clean: one domain string (`social`), one
domain file (`server/domains/social.js`), one frontend directory
(`components/social/` + `components/social/feed/`), zero shadowing.

Also checked (per the brief): CLAUDE.md's "feed + social lenses resolve
through a Z4 POST alias on `/api/connective-tissue/search`" claim. That
alias is real (`server/server.js:6349-6353`, `routes/connective-tissue.js`)
but is a **legacy discovery/search path**, not the primary substrate this
pass touches — `Discovery.tsx` (the "For You" tab) calls it; the
`social`-domain engagement macros below (feed, posts, DMs, streams, polls)
are a separate, newer, and much deeper substrate that doesn't route through
`connective-tissue` at all. Both are real; neither shadows the other.

## Backend surface

```
grep -c 'registerLensAction("social"' server/domains/social.js
```
→ **26** macros in `server/domains/social.js` (958 lines), registered via
`registerSocialActions(registerLensAction)`. No inline `server.js`
registrations for `"social"`, no shadowing (`register("social", ...)` never
appears — only `registerLensAction`).

State lives in `globalThis._concordSTATE.socialLens` (posts, replies,
reactions, reposts, dms, moderation buckets, reports, streams) — a real,
persisted-via-`saveStateDebounced` in-memory substrate, not a stub.

Macro groups: `createPost`/`feed`/`hashtagFeed`/`trendingHashtags` (post
substrate + discovery), `addReply`/`replyTree` (threaded comments),
`react`/`repost`/`reactionKinds` (engagement), `sendMessage`/`inbox`/
`conversation` (DMs), `postDetail`/`shareTargets`/`registerMedia` (permalink
+ share sheet + media attachments), `mute`/`block`/`report`/
`moderationStatus` (safety), `startStream`/`liveStreams`/`joinStream`/
`streamChat`/`endStream` (live audio/video streams), `votePoll`/
`pollResults` (polls).

## Frontend surface

`concord-frontend/app/lenses/social/page.tsx` (the pan-social hub, 8 tabs:
Feed/For You/Reels/Spaces/Following/Notifications/Saved/Analytics, now +
Moderation — see below) + `components/social/*.tsx` (18 files, the
pre-existing social-primitives library: StoriesBar, Discovery,
NotificationCenter, UserProfile, SuggestedFollows, TrendingTopics/Domains,
PresenceIndicator, DMIndicator, StreakIndicator, CreatorAnalytics,
BookmarksList, etc.) + `components/social/feed/*.tsx` (9 files — the
`social`-domain engagement substrate: FeedView, FeedComposer, PostCard,
PostDetail, ReplyTree, HashtagPage, DMInbox, LiveStreams, types.ts).

## `lensRun` unwrap is correct — no phantom-success risk here

This lens's `feed/*.tsx` components exclusively call `lensRun()` from
`lib/api/client.ts`, which does a proper recursive `{ok,result}`-envelope
unwrap (`while (node has ok+result) unwrap`, terminal `ok:false` surfaces
the real `error`) — confirmed by reading the implementation
(`client.ts:352-408`). The "outer transport `ok` always true, wrapped
macro's own `ok:false` never checked" phantom-success bug this program has
found elsewhere (kingdoms, poetry, photography, personas) does **not**
apply to this lens's call sites.

## Defects found and fixed

### 1. `reactionKinds` (1 of 3 macros the unsurfaced-macro scan flagged) — hardcoded picker, no fetch

`PostCard.tsx`'s reaction picker hardcoded
`REACTIONS = [{id:'like',label:'👍'}, ...]` inline instead of calling
`social.reactionKinds` (a real catalog macro —
`server/domains/social.js:238` returns `REACTION_KINDS`, the same array
`react` validates against at `:207`). The hardcoded ids happened to match
the backend's `REACTION_KINDS` exactly today, so nothing was visibly broken
— but the picker would silently drift from what the backend actually
accepts on the next backend-side reaction addition/removal, and the macro
itself sat completely unreachable. **Fixed**: `PostCard.tsx` now fetches
`social.reactionKinds` once (module-level cache, since it's a static
catalog) and renders the picker from the live id list, keeping a small
local `REACTION_EMOJI` map for presentation only (falls back to a generic
`➕` glyph for any id it doesn't have an emoji for, and to the known-good
id list if the fetch fails — never blocks the picker).

### 2. `pollResults` (2 of 3) — real bug: viewer's own vote never showed after a reload

`pollResults` (`server/domains/social.js:643`) is a purpose-built read that
returns a poll's live tally **plus the calling viewer's own `viewerChoice`**
— exactly the field a poll UI needs to render a checkmark on the option you
already voted for. It had zero frontend callers. `PostCard.tsx` only ever
set `pollChoice` from the *response* of casting a vote (`votePoll`); a post
loaded from `feed`/`hashtagFeed`/`postDetail` carries the raw
`post.poll.voters` map (all voters, keyed by user id) but the component
never read your own entry out of it — so a poll you'd already voted on in a
prior session, or on a different device, silently rendered as unvoted every
time the feed reloaded (no checkmark, all options clickable again). **Fixed**:
on mount, if a post has a poll, `PostCard.tsx` now calls
`social.pollResults` for that post's authoritative `viewerChoice` +
refreshed tally, so a re-voted poll (or one someone else changed since the
feed loaded) is always shown correctly. Real bug, real macro, real fix —
not a cosmetic wiring exercise.

### 3. `moderationStatus` (3 of 3) — genuinely missing self-service surface

`moderationStatus` (`server/domains/social.js:495`) returns the viewer's
own muted user ids, blocked user ids, and filed reports — a real,
already-built "your safety settings" read. There was **no UI anywhere** to
see or undo a mute/block, or review your own report history; `mute`/
`block`/`report` were only reachable one-way from `PostCard`'s post-menu
("mute this person," "block this person," "report this post"). Every real
social product (X's Blocked accounts, Instagram's Muted accounts, Discord's
Privacy & Safety) ships this as a first-class settings surface — its total
absence here was a genuine UNSURFACED-macro gap, not a stylistic choice.
**Fixed**: new `components/social/ModerationPanel.tsx` — a real two-way
management UI (not read-only): Muted and Blocked columns each list
`UserLink`-rendered accounts with an Unmute/Unblock button
(`social.mute`/`social.block` called with an explicit `{userId,
muted:false}`/`{blocked:false}` override — the macros already support this,
confirmed by reading the handler), plus a read-only "Reports you've filed"
list. Honest empty states throughout (no data invented — an unmuted user
just isn't in the list). Wired into `app/lenses/social/page.tsx` as a new
`Moderation` tab (Shield icon), the 9th tab.

## Macro → UI classification (all 26 macros)

**DESIGNED** — 26/26 after this pass (23 already designed, 3 newly wired
this pass: `reactionKinds`, `pollResults`, `moderationStatus`):

| Macro group | Count | Where |
|---|---:|---|
| `createPost`, `registerMedia` | 2 | `FeedComposer.tsx` |
| `feed`, `trendingHashtags` | 2 | `FeedView.tsx` |
| `hashtagFeed` | 1 | `HashtagPage.tsx` |
| `addReply`, `replyTree` | 2 | `ReplyTree.tsx` |
| `react`, `reactionKinds` | 2 | `PostCard.tsx` (reactionKinds newly wired) |
| `repost` | 1 | `PostCard.tsx` |
| `votePoll`, `pollResults` | 2 | `PostCard.tsx` (pollResults newly wired) |
| `mute`, `block`, `report` | 3 | `PostCard.tsx` post-menu (one-way) + `ModerationPanel.tsx` (two-way, new) |
| `moderationStatus` | 1 | `ModerationPanel.tsx` (new) |
| `postDetail`, `shareTargets` | 2 | `PostDetail.tsx` |
| `sendMessage`, `inbox`, `conversation` | 3 | `DMInbox.tsx` |
| `startStream`, `liveStreams`, `joinStream`, `streamChat`, `endStream` | 5 | `LiveStreams.tsx` |

Total: 2+2+1+2+2+1+2+3+1+2+3+5 = **26**. Matches
`grep -c 'registerLensAction("social"' server/domains/social.js`.

**GENERIC-STRIP-ONLY**: none. Every macro above is called from a bespoke,
domain-specific component with a real form/list/picker — no
`<UniversalActions>`/`<LensFeaturePanel>`/raw-JSON-paste wall anywhere in
`components/social/` or `components/social/feed/`.

**UNSURFACED**: none remaining (all 3 flagged by
`node scripts/lens-unsurfaced.mjs --lens social` are now wired — see
above).

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/social/*.tsx components/social/feed/*.tsx
app/lenses/social/page.tsx` → every hit is a comment *documenting the
absence* of fake data (e.g. "No fake data — empty state says…"), not a
fabrication signature. All 18 `components/social/` files plus all 9
`components/social/feed/` files were read or grepped for this pass; no
generic-CRUD-standing-in-for-real-macros pattern, no client-invented
percentages/badges, no `Math.random()` in a render path.

`apiHelpers.lens.runDomain` (used by other lenses in this program) and the
legacy `{domain, action, ...rest}` request shape were double-checked
against the `/api/lens/run` route (`server.js:39529`) — both the nested
`{domain, name, input}` shape (used here via `lensRun`) and the flattened
legacy shape are genuinely supported server-side (`server.js:39556-39566`),
so neither is a latent field-shape bug.

## Genuinely missing, deferred

None identified as a defined gap against a named reference app beyond what
this pass closed. The lens already covers post/reply/reaction/repost/poll/
quote-post, DMs, hashtag discovery, live audio/video streams, and (as of
this pass) full self-service moderation — the core X/Instagram/Twitter
feature set. Deeper live-streaming production values (screen share, guest
co-hosting) would be the natural next increment but no backend macro
implies them yet, so they're not a "genuinely missing" item under the
sixth hard invariant — there's no defined capability to triage.

## Verification

- `node --check server/domains/social.js` — clean (file untouched this
  pass; verified anyway per the assignment brief).
- `node --test tests/social-gatherings.test.js
  tests/emergent-social-layer.test.js tests/society-domain-parity.test.js
  tests/social-npc-bridge.test.js tests/society-domain-macros.test.js
  tests/depth/society-behavior.test.js tests/depth/social-behavior.test.js
  tests/social-pings.test.js
  tests/society-gallery-classroom-domain-parity.test.js
  tests/social-dm-recall.test.js tests/social-domain-parity.test.js` (from
  `server/`) — **175/175 pass**, unmodified (run together with the
  `society` batch's relevant files since several test files cover both
  domains' shared substrate).
- `npx eslint app/lenses/social/page.tsx components/social/*.tsx
  components/social/feed/*.tsx` (from `concord-frontend/`) — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (social was already WIRED
  and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) — social
  entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"bespokeRatio": 0.958`, `"pillarsPresent": 5`, `"antiPatterns": 0`.
  `audit/` outputs reverted via `git checkout -- audit/` per the
  transient-artifact rule.
- No `tsc` run per this batch's memory-safety directive — deferred to the
  orchestrator's centralized typecheck pass.
