# Mission: Implement lens north stars (pick up after Claude)

You are Grok on Ramaj’s Mac. Owner (2026-10-02 ~16:41 ET): Claude ground through lens chrome on branch `lens-chrome-consolidation` in **concord-web**, then stalled. **You pick up implementation** from the next unfinished Core family. Spec pack is complete (238/238). Do not wait for approvals.

## Repo / branch
- Worktree: `/Users/dutch/concord vs code/concord-web`
- Branch: `lens-chrome-consolidation` (already checked out; stay on it)
- Spec: `~/.zuko/lens-northstar/` (concepts + NORTHSTAR.md + MISSION_REPORT product notes)
- Mirror docs already at `docs/lens-northstar/` (untracked OK)

## What Claude already shipped (DO NOT redo)
Commits on this branch (newest first among north-star work):
- Graph north star + graph search/privacy fixes (`27479ce2a` …)
- Whiteboard, Study/SRS, Timeline, Calendar, Goals
- Rail shell + Board + Chat (`f54b1bc19`)

Also leave alone: any live Claude RC / Concord / Unity processes. **Do not kill `claude` PIDs.** If Claude has uncommitted edits in a file you’re about to touch, `git status` first and skip conflicting dirty files — prefer committing your own clean slices.

## Next work order (implement FE to match concepts)
Match Claude’s style: real wiring (no fake data), serif greeting, thin rail already in shell, strip cockpit chrome, one primary CTA. Read the concept JPG + NORTHSTAR stub + prior commit diffs for Goals/Graph/Whiteboard as templates.

### Batch A — Code family (FIRST)
1. `/lenses/code` — concept `28-code-northstar-concept.jpg` — buffer + Run (not four analysis cards)
2. `/lenses/debug` — `30` — one issue list
3. `/lenses/database` — `32` — one query surface
4. `/lenses/repos` — `34` — honest empty / real repos only

### Batch B — Studio family
5. `/lenses/studio` — arrangement (not DAW brochure)
6. music, art, fractal, game, sim, ar, podcast — each own concept in pack (`37`–`50` range)

### Batch C — World
7. `/lenses/world` — Unity client full-bleed; no greeting over the view; concept is chrome direction

### Batch D — if still going
Graph absorbed that lack north-star commits (schema, entity, temporal, eco, meta) if still cockpit-y vs concepts `17`–`26`.
Then Destinations / Chat absorbed / remaining pack order — keep going in batches.

## Engineering rules
- Prefer editing existing `concord-frontend/app/lenses/<id>/page.tsx` + components; reuse LensToolbar / shell patterns from Chat/Board.
- Tests: add/adjust focused tests like Calendar/Goals where Claude did.
- Commit after each lens or small batch with a clear message: `Code lens north star: …` (Co-Authored-By Grok optional).
- Do **not** cut over production pod / rebuild live failover unless a local `localhost:3000` proof needs a FE rebuild you already use.
- Disk is tight — no huge binaries in git.
- Write `~/.zuko/lens-northstar/IMPLEMENT_STATUS.md` after each batch: done / next / commit SHAs.
- End-of-session: `~/.zuko/lens-northstar/IMPLEMENT_REPORT.md` with PASS/CONTINUE + next lens id.

## Done when (this session)
At least **Code family** implemented and committed. Prefer also Studio + World if tokens allow. CONTINUE with exact next path if stopping mid-family.

When finished, exit cleanly.

## Note (pickup time)
Claude RC may still be live with parallel agents on other fat lenses (see ~/.grok/last-copy.txt style notes). Prefer **Code → Studio → World** north-star commits first; if a file has uncommitted Claude edits, skip it and pick the next clean lens. Do not kill Claude.
