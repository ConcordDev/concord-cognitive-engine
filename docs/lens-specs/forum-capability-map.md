# Forum Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command.

## Backend surface — two real, distinct forum systems

The `forum` domain string covers two independent substrates, both real:

1. **`server/domains/forum.js`** — a real Discourse+Reddit-parity engine
   (categories/topics/replies/voting/moderation-flags/reputation tiers/
   search), the `STATE.forumLens` substrate. Its `threadAnalysis`/
   `moderationQueue`/`communityHealth`/`topicClustering` calculators are
   already correctly wired via `components/forum/ForumActionPanel.tsx`
   (a real producer bench with mint/DM/publish/agent follow-through) —
   confirmed real, no changes needed.
2. **Inline `registerLensAction("forum", ...)` calls in `server.js`**
   (~line 40810) — operate on a single persisted **"post" lens-artifact**
   (`useLensData('forum', 'post', ...)` in `page.tsx`), a completely
   different surface from `STATE.forumLens`. This is the system this pass
   touched.

## What was found and fixed

1. **Dead code, confirmed via load order.** `server.js` registered a
   `forum.vote` handler on the artifact-scoped post shape, but
   `server/domains/forum.js` (loaded *later*, via the `await
   import('./domains/index.js')` domain-module loop further down
   `server.js`) registers its own `forum.vote` for the real
   `STATE.forumLens` substrate. Since `registerLensAction` is just
   `LENS_ACTIONS.set(key, handler)`, the later registration silently
   overwrote the earlier one — the artifact-scoped `vote` could never run,
   on any build, ever. Removed rather than left as a red herring.
2. **Field-shape mismatches in `rank_posts`/`extract_thesis`/
   `generate_summary_dtu`.** All three originally read `artifact.data.body`
   and `artifact.data.votes` — fields the real `Post` interface
   (`page.tsx`) never sets (it uses `content`/`score`). Fixed to read
   `content ?? body` and derive an honest upvote/downvote split from the
   real net `score` when no explicit `upvotes`/`downvotes` exist, instead
   of silently computing off fields that were always `undefined`/`0`.
3. **`pin` made toggleable.** Previously always set `pinned: true` with no
   way to unpin via the macro (the frontend was toggling `pinned` in local
   state only, never persisting an unpin). Now accepts
   `params.pinned === false` to unpin.
4. **A real layout bug**: the "Community Analytics" panel (the 4
   `ForumActionPanel` buttons) was nested inside the Share Post modal's
   JSX — only reachable by opening Share on some post first. Moved to page
   level, where the rest of the lens's chrome lives.
5. **`handleModAction`'s pin branch now calls the real macro** with
   optimistic UI + rollback on failure (was previously a pure local-state
   toggle with a comment claiming it persisted, when it silently didn't —
   see finding #1).
6. **Three real macros had zero UI**: `rank_posts` (Wilson/hot/composite
   score breakdown), `extract_thesis` (heuristic thesis extraction),
   `generate_summary_dtu` (a **preview-only** compute, no `dtu.create` —
   confirmed by reading the handler, it returns a computed shape and never
   persists; the panel labels it "Preview — not saved" accordingly, not
   "generated," per the zero-demo-content honesty invariant). Added
   `components/forum/PostInsightsPanel.tsx`, mounted in the post-detail
   view's action row.

## Reference apps

Reddit (voting, pin/lock moderation, Wilson-score ranking) + Hacker News
(hot-score gravity decay) for the artifact-scoped post surface; Discourse
for the category/topic/reputation STATE substrate.

## Verify

- `cd concord-frontend && npx eslint app/lenses/forum/page.tsx components/forum/PostInsightsPanel.tsx` — clean, exit 0.
- `npx tsc --noEmit -p .` — 0 errors attributable to forum.
- `node --check server/server.js` — valid.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unaffected.
- `cd server && node --test tests/forum-domain-parity.test.js tests/forum-lens-macros.test.js` — 67/67 pass (both files exercise `domains/forum.js`'s `STATE.forumLens` substrate and `ForumActionPanel`'s calculators; neither reaches the inline `server.js` artifact-scoped handlers this pass fixed, since those are closures with no existing export/test harness — verified correct by direct inspection of the exact field shapes against the real `Post` interface instead).
- `node scripts/grade-ux-polish.mjs --honest` → `forum`: `tier: "polished"`, `isGenericScaffold: false`.
