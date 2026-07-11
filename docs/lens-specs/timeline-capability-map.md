# Timeline Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/timeline.js` (949 LOC) in full and confirmed with
> `grep -n 'registerLensAction("timeline"' server/domains/timeline.js` (21
> macros, no inline registrations elsewhere — re-verified with
> `grep -rn '"timeline"' server/domains/*.js server/server.js` to rule out
> a second registration site; the only other `"timeline"` hits repo-wide are
> unrelated action names inside *other* domains: `crisis.timeline`,
> `dreams.timeline`, `graph.timeline`, `projects.timeline`, `history.timeline`,
> `visual.timeline`, `chat.timeline` — none of those touch this domain).
> Frontend audited by reading `app/lenses/timeline/page.tsx` (299 LOC) and all
> 10 `components/timeline/*.tsx` files (1,878 LOC combined) in full.

## What this lens is

`timeline` is a Facebook-style personal social wall — post composer with
per-post privacy (public/friends/only-me), reactions with a "who reacted"
breakdown, nested threaded comments, share/repost, media albums, a cover
photo + About profile panel, "On this day" memories, and a
reaction/comment/tag/share notification inbox. Reference app: Facebook's own
timeline/profile surface (plus a Wikipedia-backed "On this day" panel bolted
on as a bonus real-data feature, not part of the social substrate).

## Backend surface — 21 macros, split across two unrelated feature sets

The domain file's own header comment ("Domain actions for temporal analysis:
critical path computation, Gantt scheduling, temporal clustering, and event
pattern detection") describes only **4 of the 21** macros. The other **17**
were added later under a separate, explicitly-labeled section ("Personal-feed
substrate — Facebook-style timeline features") and are the ones the `timeline`
*lens* actually is:

**Personal-feed substrate (17 macros, all wired to the lens UI):**
`post-create`, `feed-list`, `comment-add`, `comment-list`, `comment-delete`,
`react`, `reactions-breakdown`, `share-post`, `album-create`,
`album-add-media`, `album-list`, `profile-get`, `profile-update`, `memories`,
`notifications-list`, `notifications-mark-read`, `post-delete`.

**Legacy generic temporal-analysis toolkit (4 macros, NOT part of this lens):**
`criticalPath` (CPM), `ganttSchedule` (resource-leveled scheduling),
`temporalClustering` (gap-based event grouping), `trendAnalysis`
(least-squares trend + seasonality). Confirmed via
`grep -rn "lensRun<[^>]*>('timeline'\|lensRun('timeline'" concord-frontend`
that **no lens** — including `timeline` itself — calls these 4 through the
`timeline` domain. Other lenses that display "critical path" / "Gantt" /
"trend analysis" UI (`construction`, `cri`, `market`, `projects`) call their
**own** domain's identically-named macro (`construction.criticalPath`,
`market.trendAnalysis`, etc.), not `timeline`'s. These 4 are genuinely
orphaned — but forcing them into the Facebook-style social lens's UI would
itself violate the "zero generic tendencies" invariant (a CPM/Gantt panel has
no coherent place in a personal-wall product; Facebook doesn't have one).
Disposition: **documented, not force-wired** — this is a pre-existing
domain-name collision (the file predates the social-feed feature and was
repurposed under the same domain string), not a defect in the `timeline`
lens's own coverage. If this capability is ever worth surfacing, it belongs
on a project-management-shaped lens under its own domain, not bolted onto a
social feed. Not touched this session.

## Audit result: one real defect found and fixed — a privacy-bypass gap on id-addressed post access

The lens's own hard invariant, declared in its UI (privacy legend: Public /
Friends / "Only me") and enforced correctly at `feed-list` (verified — see
`server/tests/timeline-domain-parity.test.js`'s `"hides another user's
private post"` case, and the depth suite's `"a private post is hidden from
non-author viewers"` case) and at `share-post` (which explicitly checks
`found.post.privacy === "private" && found.ownerId !== tlAid(ctx)` before
allowing a share, `server/domains/timeline.js:734`), was **not**
enforced by four other macros that also operate on a specific post by id:

- `react` (`server/domains/timeline.js:670`, pre-fix)
- `comment-add` (`:601`, pre-fix)
- `comment-list` (`:632`, pre-fix)
- `reactions-breakdown` (`:710`, pre-fix)

Each of these took a bare `postId` and only checked that the post *existed*
(`findPost`), never that the *privacy* tier permitted the caller to touch it.
`feed-list`'s privacy filter only gates **listing** — it decides which posts
show up in a feed page — but it is not the only way a client can come to know
a post's id (a post id appears in `sharedFrom.postId` on a repost, in a
notification's `postId` field, or is simply guessable since ids are
`pst_<base36 timestamp>_<random>` with no server-side capability check).
Concretely, before the fix: any authenticated user who obtained a private
post's id by any of those paths could call `timeline.react`,
`timeline.comment-add`, `timeline.comment-list`, or
`timeline.reactions-breakdown` directly against it — reacting to, commenting
on, reading the comment thread of, or reading the full reactor list of a post
its owner explicitly marked "Only me". This is the same class of gap
CLAUDE.md flags for admin/ops surfaces (a real macro reachable by any
authenticated caller despite a declared access restriction) — here the
restriction is per-resource privacy rather than an admin/operator role, but
the shape of the bug (declared restriction that the mutation/read path
doesn't actually check) is the same.

`comment-delete` and `post-delete` were **already correct** — `comment-delete`
explicitly checks `target.authorId !== tlAid(ctx)` (`:650`) and `post-delete`
is structurally scoped to `s.posts.get(tlAid(ctx))` so it can only ever find
and remove the caller's own posts (`:954`). `album-add-media` is similarly
structurally scoped to the caller's own album map, so it cannot mutate
someone else's album. `profile-update` writes only to `tlAid(ctx)`'s own
profile row and never honors a caller-supplied target userId.

## What was fixed

Added a `checkPostAccess(s, postId, viewerId)` helper right after `findPost`
(`server/domains/timeline.js:487-501`) that returns `{ found, blocked }` —
`blocked` is true only when the post exists, is `privacy: "private"`, and the
viewer isn't its owner. Wired it into the four macros above, each now
returning the **same** `{ ok: false, error: "Post not found." }` for both
"doesn't exist" and "exists but is private and you're not the owner" — this
mirrors `feed-list`'s own behavior (a private post is invisible, not
visible-but-403) so the error itself can't be used as an oracle to confirm a
given private post id exists. `public` and `friends`-tier posts are
unaffected — the fix only closes the `private` gap, which is the one
tier that is enforceable without a real friend-graph (see below).

**Known, documented residual (not fixed, and correctly not fixed this
session):** the `friends`-tier privacy check has the same structural gap for
`react`/`comment-add`/`comment-list`/`reactions-breakdown` (a stranger who
already has a friends-only post's id can still interact with it), but closing
that would require the same client-supplied `friendIds` parameter
`feed-list` already leans on (`server/domains/timeline.js` — `feed-list`'s
`params.friendIds` is an unverified client assertion, since this substrate
has no server-side friend-graph table of its own; it's derived in the
frontend from `apiHelpers.personas.list()`, which is not itself a verified
friend-relationship API). Extending id-addressed access to also honor
`friendIds` would either (a) require every call site to also pass
`friendIds`, which none of `react`/`comment-add`/`comment-list`/
`reactions-breakdown`'s existing frontend callers do today, or (b) require
inventing a real friend-graph substrate — both are a materially bigger change
than this pass's scope, and the `private` tier (the one unambiguous,
graph-free case: "private" means the owner and only the owner, full stop) is
the one that was silently broken and is now fixed. This is a genuine
**ENGINEERING**-class gap per CLAUDE.md's "closing the hard 20%" triage (no
external data dependency, just missing plumbing) — worth a follow-up pass
that also touches `feed-list`'s friend-id sourcing, out of scope here since it
would mean redesigning how "friends" is defined for this lens, not fixing a
one-line oversight.

## Tests added

`server/tests/timeline-domain-parity.test.js` — new `describe("timeline
private-post access gate (id-addressed, not just feed-list)")` block, 5 cases:
react refused on a stranger's private post, owner can still react to their
own private post, comment-add refused, comment-list returns not-found for a
stranger (but the real thread for the owner), reactions-breakdown refused,
and a control case proving public/friends posts are unaffected (anyone can
still react/comment/list/breakdown on them).

**Fixing this surfaced a pre-existing test-suite gap, also fixed:** four
`timeline-domain-parity.test.js` cases created a post via
`post-create(ctxA, { content: "p" })` with no `privacy` field — which
defaults to `"private"` (`server/domains/timeline.js:527`) — and then had a
*different* actor (`ctxB`) react to or comment on it. Before this session's
fix, that "worked" only because the bug being fixed let it work; the tests'
real intent (exercising cross-user reaction/comment mechanics) had nothing to
do with privacy, they just never set `privacy: "public"` explicitly. Fixing
the domain correctly turned this into 4 real, reproduced test failures:
`"adds, changes, and toggles a reaction"`, `"reactions-breakdown reports who
reacted per kind"`, `"a reaction on your post generates a notification"`,
`"a comment generates a notification, and mark-read clears it"` (plus two
more, `"rejects a reply to a missing parent"` and `"comment-delete removes
the comment and its replies"`, whose assertions happened to still pass by
coincidence but no longer exercised what they claimed to). All six now
explicitly pass `privacy: "public"` on the `post-create` call, restoring
their original intent alongside the fix. This is the same "the old passing
test was itself masking the bug" pattern CLAUDE.md's method section warns
about — the tests are fixed for correctness, not softened to hide anything.

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Post composer with privacy controls (public/friends/only-me) | ALREADY REAL — `PostComposer.tsx` → `timeline.post-create` |
| 2 | Privacy-aware feed listing | ALREADY REAL — `feed-list`, verified own-post/public/friends visibility rules with tests |
| 3 | Reactions (5 kinds) with live counts + toggle/change semantics | ALREADY REAL — `PostCard.tsx` reaction picker → `timeline.react` |
| 4 | "Who reacted" breakdown, grouped by kind | ALREADY REAL — `ReactionBreakdown.tsx` → `reactions-breakdown` (now privacy-gated) |
| 5 | Nested threaded comments with replies | ALREADY REAL — `CommentThread.tsx` recursive tree → `comment-add`/`comment-list` (now privacy-gated) / `comment-delete` (author-only, already gated) |
| 6 | Share/repost with quoted original + own privacy | ALREADY REAL — `ShareModal.tsx` → `share-post`, correctly refuses to reshare a private post it doesn't own — this is the one macro that had it right from the start |
| 7 | Media albums (photo/video, captions, auto-cover) | ALREADY REAL — `AlbumsPanel.tsx` → `album-create`/`album-add-media`/`album-list`; `album-list(ownerId)` deliberately has no privacy gate (pinned by `"timeline.album-list by ownerId"` test — public-profile-style by design, not a defect) |
| 8 | Profile: cover photo, bio, About (work/education/location/relationship/website) | ALREADY REAL — `ProfilePanel.tsx` → `profile-get`/`profile-update`; `profile-update` correctly ignores any caller-supplied target userId |
| 9 | "On this day" memories | ALREADY REAL — `MemoriesPanel.tsx` → `timeline.memories`, plus a genuinely separate **Wikipedia** "On this day" panel (`TimelineWiki.tsx`, live `en.wikipedia.org/api/rest_v1/feed/onthisday` call, `SaveAsDtuButton` to cite it) — an honest bonus feature, not the same thing, clearly labeled |
| 10 | Notifications (reaction/comment/reply/tag/share) with unread badge | ALREADY REAL — `NotificationsPanel.tsx` → `notifications-list`/`notifications-mark-read`, badge shown in the tab strip and polled every 30s |
| 11 | Post delete (author-only) | ALREADY REAL — structurally owner-scoped, no id-guessing risk possible by construction |
| 12 | Per-resource privacy enforced everywhere a post is addressed by id, not just at listing time | **FOUND BROKEN, FIXED THIS SESSION** — see above |

**Coverage summary:** 11 of 12 checklist items were already real and correctly
built; item 12 was a genuine, non-obvious defect (declared invariant not
enforced on 4 of 6 id-addressed macros) that is now closed for the `private`
tier, with the `friends`-tier residual honestly documented as a deferred
ENGINEERING gap rather than silently left broken or papered over.

## Verification

- `cd server && node --test tests/timeline-domain-parity.test.js` — **35/35
  passing** (29 pre-existing + 6 new privacy-gate cases; 4 pre-existing cases
  needed a one-line `privacy: "public"` fix to keep testing what they always
  claimed to, per the note above).
- `cd server && node --test tests/depth/timeline-behavior.test.js` — **1/1
  passing** (unaffected — this file already set `privacy: "public"` on every
  cross-user post-create call, so the fix didn't change its behavior).
- `cd server && node --test tests/behavior/lens-behavior-smoke.behavior.js` —
  0 failures (the auto-derived shape-contract harness still passes for all 21
  `timeline.*` macros).
- `cd server && npx eslint domains/timeline.js tests/timeline-domain-parity.test.js`
  — clean, no output.
- `node --check server/domains/timeline.js` — `OK_SYNTAX`.
- `node scripts/verify-lens-backends.mjs` — `{"verdicts":{"WIRED":258,"NO-BACKEND-CALL":2},"total":260,...}`,
  `timeline` not present in the printed non-WIRED list (only `narrative-walk`
  and `ux-suite` print, both `NO-BACKEND-CALL` by design per CLAUDE.md) — the
  overall total is unchanged from the pre-session baseline.
- `node scripts/grade-ux-polish.mjs --honest` — `audit/ux-polish-honest.json`
  `timeline` entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"honestCapped": false` — unchanged tier, no regression. `audit/` outputs
  reverted with `git checkout -- audit/` after grading (never committed).

## Files touched

- `server/domains/timeline.js` — added `checkPostAccess` helper; wired it
  into `comment-add`, `comment-list`, `react`, `reactions-breakdown`.
- `server/tests/timeline-domain-parity.test.js` — added the 5-case privacy-gate
  test block; fixed 6 pre-existing cases to explicitly set
  `privacy: "public"` where their real intent requires cross-user
  interaction (previously relying on the very bug this session fixed).
- `docs/lens-specs/timeline-capability-map.md` — this file (new).

No frontend files were changed — every component was already calling real
macros with honest data, no fabricated content, no generic scaffold
(`ManifestActionBar`/`RecentMineCard`/`AutoActionStrip`/
`CrossLensRecentsPanel` are present in `page.tsx` as the standard
cross-lens footer strip, not as a substitute for the bespoke, hand-built
Facebook-shaped UI — the UX polish grader's `hasMacroButtonWall: true` flag
on this lens reflects that same footer strip, correctly not enough on its own
to cap the tier since `bespokeRatio` is 0.841 and `isGenericScaffold` is
`false`).
