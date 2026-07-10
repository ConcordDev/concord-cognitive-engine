# Feed Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.
>
> This lens is the in-app content feed (X/Threads-shape social timeline).
> Not to be confused with `federation` (cross-instance peering), audited
> separately in this wave. `feed` was previously flagged PARTIAL by
> `scripts/verify-lens-backends.mjs` and resolved via a POST alias on
> `/api/connective-tissue/search`; this pass verified before and after that
> it stays WIRED (see Verification).

## Backend surface — two registration sites

```
grep -c 'registerLensAction("feed"' server/domains/feed.js
```
→ **38** macros in `server/domains/feed.js` (785 lines): the real
X/Threads-parity engine — algorithmic "For You" ranking
(`record-interaction`, `rank-for-you`, `affinity-summary`), quote-post/reply
threads (`thread-*`), curated lists (`list-*`), composer polls
(`poll-*`), bookmark folders + saved-search alerts (`folder-*`,
`saved-search-*`), live audio Spaces (`space-*`), content controls
(`controls-*`), plus 4 analytics macros (`engagementScore`,
`contentCalendar`, `audienceInsights`, `hashtagAnalysis`).
`node scripts/lens-unsurfaced.mjs --lens feed` → before this pass, `6/38`
(`controls-apply`, `folder-add-item`, `list-feed`, `rank-for-you`,
`record-interaction`, `saved-search-run`); after, **`1/38`**
(`folder-add-item`, documented below).

**A second registration site the static scanner cannot see**:
```
grep -n 'registerLensAction("feed"' server/server.js
```
→ **6 more macros** at `server.js:40896-41002`: `like`, `repost`,
`bookmark`, `rank`, `personalize`, `cluster_topics` — confirmed genuinely
unsurfaced (not a false miss) via the loose token-match the unsurfaced
script itself uses; the one apparent hit (`like`) was a false positive (a
reaction-type string literal passed to the unrelated `/api/social/react`
endpoint, not this macro). These are declared in the lens manifest
(`concord-frontend/lib/lenses/manifest.ts`, `domain: 'feed'`, `actions:
['like', 'repost', 'bookmark', 'rank', 'personalize', 'cluster_topics']`) —
a real, intended feature set, same invisible-to-`lens-unsurfaced.mjs` class
as `federation`'s hidden ActivityPub/Commune clusters this same wave.

## Reference app

**X/Threads** (For You ranking, threaded quote-posts, Lists, Polls, bookmark
Folders + saved-search alerts, live audio Spaces, content controls) — the
`FeedToolsPanel` component's own header comment names this explicitly, and
the build matches it feature-for-feature.

## Classification (before this pass)

**Mixed, in the "candidates-pattern" and "hidden cluster" shapes** — not
fabrication. Read all of `app/lenses/feed/page.tsx` (2,244 lines) and
`components/feed/{FeedToolsPanel.tsx (1,201 lines), HnFrontPage.tsx}`.
`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|hardcoded"` → zero
hits (the file's own comments explicitly assert "No mock data — every value
is real user input or computed by the backend," verified true).

1. **The real social feed (posting, liking, reposting, bookmarking,
   following/trending/for-you tabs) is genuinely real** — `/api/social/
   post`, `/api/social/react`, `/api/social/share`, `/api/social/bookmark`,
   `/api/social/feed/{following,explore,foryou}`, with a DTU-corpus
   fallback when the social API returns nothing. Composing a post ALSO
   dual-writes a mirrored `feed`-domain `post`-type generic artifact
   (`createLensPost(...)` inside `postMutation`'s `onSuccess`), which is
   what makes the existing "Feed Analytics" button row's `postLensItems[0]`
   genuinely non-empty in practice (not a dead-end the way `experience`'s
   equivalent pattern was before that lens's own fix this wave).
2. **4 of the 6 originally-unsurfaced `domains/feed.js` macros
   (`controls-apply`, `list-feed`, `rank-for-you`, `saved-search-run`) share
   one root cause**: they're pure filter/rank functions that take a
   caller-supplied `candidates` array — the domain's own shadow state only
   holds per-user preference/interaction state (affinity, lists, saved
   searches, controls), not the post corpus itself. `FeedToolsPanel` is
   mounted with zero props (`<FeedToolsPanel />`), so it structurally had no
   real post data to pass — every one of these 4 macros was unreachable by
   construction, not by a broken button.
3. **`record-interaction` (the "For You" model's training macro) was never
   called anywhere** — `ForYouTool` in `FeedToolsPanel` already displayed
   the trained affinity summary (`affinity-summary`), but nothing in the
   app ever recorded a real like/reply/repost/bookmark as a training
   signal, so the model could never learn from actual use.
4. **The `like`/`repost`/`bookmark`/`rank`/`personalize`/`cluster_topics`
   cluster in `server.js`** — `rank`/`personalize`/`cluster_topics` are
   real, safe, read-only analytics matching the shape of the existing
   "Feed Analytics" button row (`engagementScore`/`contentCalendar`/
   `audienceInsights`/`hashtagAnalysis`) — a natural, low-risk extension.
   `like`/`repost`/`bookmark` mutate a SEPARATE shadow-artifact's
   `data.likes`/`reposts`/`bookmarked` fields, disconnected from the real
   per-post interaction state the main feed UI already shows via
   `/api/social/react`/`/api/social/share` — building UI for these would
   either read as a confusing second "like count" next to the real one, or
   require rewiring the primary interaction buttons to double-write into
   the shadow store. Deliberately left undone (see below).

## What changed

- **`concord-frontend/app/lenses/feed/page.tsx`**:
  - Added a `feedCandidates` derivation (`useMemo` over the already-loaded
    `feedPosts`) and passed it to `<FeedToolsPanel candidates={feedCandidates} />`
    — this alone makes `list-feed`, `saved-search-run`, and `controls-apply`
    genuinely reachable (see component changes below) and gives `rank-for-you`
    real data to rank.
  - `record-interaction` is now called (fire-and-forget, best-effort — a
    failure never blocks the real reaction) from `likeMutation`,
    `repostMutation`, and `bookmarkMutation`'s `onSuccess` handlers, so the
    "For You" affinity model now trains from real interactions instead of
    never receiving any signal. All 3 mutations were changed from
    `mutationFn: (postId: string) => …` to `mutationFn: ({postId, authorId}) => …`
    and their 4 call sites updated to pass the post's real `author.id`.
  - Extended the existing "Feed Analytics" action row (already wired to 4
    real `domains/feed.js` macros) with 3 more real macros from the
    `server.js` cluster: `rank` (per-post engagement/velocity/decay score),
    `personalize` (per-post relevance score against the caller's own
    interaction history), `cluster_topics` (tag co-occurrence clusters
    across the shadow post corpus) — 3 new buttons + 3 new result renderers
    matching the existing card-grid visual pattern exactly.
- **`concord-frontend/components/feed/FeedToolsPanel.tsx`**:
  - Added a `CandidatePost` interface (documented as the shared shape the 4
    candidate-consuming macros expect) and an optional `candidates` prop on
    `FeedToolsPanel`, threaded down to `ForYouTool`, `ListsTool`,
    `SavedTool`, `ControlsTool`.
  - `ForYouTool`: added a "Rank the N posts currently loaded" button calling
    `rank-for-you`, rendering the top-10 ranked posts with score + the
    handler's own human-readable reasons (e.g. "you engage with @author",
    "recent", "popular").
  - `ListsTool`: added a "View feed" toggle per list calling `list-feed`,
    showing which currently-loaded posts are from that list's members (or
    an honest "none of this list's members have a post in the currently-
    loaded feed" empty state).
  - `SavedTool`: added a "Run" button per saved search calling
    `saved-search-run`, showing real match count + "N new since last
    check."
  - `ControlsTool`: added a "Preview effect on the N currently-loaded
    posts" button calling `controls-apply`, showing real
    kept/blocked/muted/flagged counts. Also **corrected a false claim** in
    the section's own hint text — it previously asserted "These filters
    apply to the ranked For You feed," which was never true (nothing called
    `controls-apply` on the real feed); the copy now accurately describes
    what the preview does.
- **`server/tests/depth/feed-rank-personalize-cluster-behavior.test.js`
  (new)** — the `rank`/`personalize`/`cluster_topics` cluster had **zero**
  test coverage before this pass (it isn't in `server/domains/feed.js`, so
  none of that domain's parity tests exercise it). 5 behavioral tests via
  the `lensRun` harness: `rank` scores higher engagement higher and decays
  score with post age; `personalize` is an honest `0` relevance for a
  cold-start user (no fabricated relevance); `cluster_topics` returns real
  tag co-occurrence, including an empty-but-well-shaped result when there's
  nothing to cluster.

## Known, documented, unfixed gaps

- **`folder-add-item`** (add/remove a specific post to a bookmark folder) —
  real, reachable in principle, but wiring it properly needs a folder-picker
  UI on the main feed's bookmark action (which currently only calls the
  real `/api/social/bookmark`), a genuinely separate piece of UX design
  work from anything else in this pass. Left undone, documented here rather
  than rushed.
- **`like`/`repost`/`bookmark`** (the `server.js` shadow-artifact versions)
  — deliberately not wired. They operate on a disconnected shadow post
  (`postLensItems[0]`, one of the user's own composed posts, not necessarily
  the post being viewed), duplicating state the real, already-working
  `/api/social/react`/`/api/social/share` system owns. Surfacing them would
  either confuse users with a second, out-of-sync "like count" next to the
  real one, or require restructuring the primary interaction buttons — a
  materially bigger and riskier change than this pass's scope. Real
  macros, correctly left unsurfaced, same disposition class as
  `federation.inbox_receive` and `eco.sustainabilityScore` from this and
  earlier waves.

## Verification

- `cd concord-frontend && npx eslint app/lenses/feed/page.tsx components/feed/FeedToolsPanel.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` filtered to `lenses/feed/`+`components/feed/` — 0 errors.
- `node scripts/lens-unsurfaced.mjs --lens feed` → `1/38` (was `6/38`); the 3 `server.js`-cluster additions (`rank`/`personalize`/`cluster_topics`) confirmed surfaced by direct re-grep.
- `node scripts/verify-lens-backends.mjs` → **`feed` stays WIRED** (confirmed both before and after this pass's edits) — the PARTIAL→WIRED fix from the prior POST-alias work is untouched; overall `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 unaffected.
- `cd server && node --test tests/feed-domain-parity.test.js tests/lens-feeds-domain-parity.test.js tests/depth/feed-rank-personalize-cluster-behavior.test.js` → `86 pass / 0 fail`.
- `cd server && npx eslint tests/depth/feed-rank-personalize-cluster-behavior.test.js` — clean, exit 0.
- Did not touch `server/domains/feed.js`, `server/server.js`, or
  `components/feed/HnFrontPage.tsx` — no gap found in the latter after a
  full read (a real, live Hacker News front-page panel, same "reference-app
  content" pattern validated in `eco`/`experience`/`federation`).
