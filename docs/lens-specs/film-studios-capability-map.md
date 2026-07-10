# Film Studios Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("film-studios"' server/domains/filmstudios.js
```
→ **97** macros in `server/domains/filmstudios.js` (1,700 lines, one of the
larger domain files in the codebase) — the file name (`filmstudios.js`, no
hyphen) doesn't match the registered domain string (`film-studios`,
hyphenated) or the lens directory name, which is why
`node scripts/lens-unsurfaced.mjs --lens film-studios` reports "No
registered macros found" (its `--lens` filter matches by filename stem:
`files.filter(f => f === 'film-studios.js')`, which never matches
`filmstudios.js`). Verified manually instead — extracted all 97 action names
via grep, then checked each against the frontend with the same loose
token-match the script itself uses. This is a **StudioBinder + DaVinci
Resolve + Frame.io 2026-parity** production suite: projects, screenplay
scenes + industry breakdown tagging, shot lists, stripboard scheduling +
call sheets + Day-Out-of-Days, budget, cast & crew, an edit timeline with
real timecode (multi-track, ripple-delete, trim, multicam), timecoded
review (versions + notes), festival submissions, and a watch-party sync
layer.

## Reference apps

**StudioBinder** (breakdown, scheduling, call sheets, DOOD) + **DaVinci
Resolve** (multi-track timeline, timecode, multicam grouping, proxy/full
quality) + **Frame.io** (versioned review with timecoded notes).

## Classification (before this pass)

**Overwhelmingly strong — the best-covered lens in this wave by macro
count.** Read all of `app/lenses/film-studios/page.tsx` (888 lines) and all
12 `components/film-studios/Fs*.tsx` panels (3,630 lines total).
`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem"` → zero hits.
**90 of 97 macros (93%) were already genuinely wired** to real forms with
real results before this pass — no generic artifact-store detour anywhere
in the lens, no dead button walls. Of the 7 originally unsurfaced:

1. **3 were genuinely, correctly redundant** (not defects — the panel
   already fetches a strict superset from a different macro):
   - `clip-list` (flat, un-timecoded clip list) is subsumed by `cut-list`
     (per-track grouped, running-timecode-computed clip list) —
     `FsEditPanel` already renders from `cut-list`.
   - `breakdown-summary` (category → count) is subsumed by
     `element-list-report` (category → named elements → scene list) —
     `FsScreenplayPanel` already renders from `element-list-report`.
   - `shoot-day-list` (flat day list) is subsumed by `stripboard` (day list
     with assigned scenes + page count, spread from the same day record) —
     `FsSchedulePanel` already renders from `stripboard`.
   Confirmed by reading each pair of handlers side-by-side in
   `server/domains/filmstudios.js` — the "redundant" macro's fields are a
   strict subset of the one actually used.
2. **4 were genuine, real gaps** — real backend capability with no UI path:
   - `location-update` — locations could be created and deleted in
     `FsProductionPanel`, but never edited (a typo meant delete-and-recreate).
   - `scene-update` — scenes could be created and deleted in
     `FsScriptPanel`, but never edited (int/ext, location, time-of-day,
     page count, description all permanently fixed at creation).
   - `clip-set-media` — `FsMediaPanel` (register source media + build
     multicam angle groups) and `FsEditPanel` (build a timecoded timeline
     of freeform-named clips) were two disconnected islands; nothing linked
     a timeline clip to its actual registered source media, so the "which
     file is this cut actually pointing at" question — the whole point of
     an NLE media-link — was unanswerable from the UI.
   - `vision` (LLaVA still-image analysis, domain-scoped prompt: "describe
     scene composition, lighting, cinematographic technique, mood, and
     narrative elements") — real, registered, tested at the backend
     (`server/tests/film-studios-lens-macros.test.js`), never called
     anywhere in the frontend.

## What changed

- **`concord-frontend/components/film-studios/FsProductionPanel.tsx`** —
  added inline edit mode per location row (pencil icon → name/address/
  contact fields + save/cancel), wired to `location-update`.
- **`concord-frontend/components/film-studios/FsScriptPanel.tsx`** — added
  an edit form inside a scene's expanded detail view (int/ext, location,
  time-of-day, page-eighths, description + save), wired to `scene-update`.
- **`concord-frontend/components/film-studios/FsEditPanel.tsx`** — now
  fetches the project's registered media (`media-list`) and adds a "Source
  media" dropdown to each clip's expanded edit controls, wired to
  `clip-set-media` (which also carries an optional `mcamAngle`). To make the
  current link visible without a second round-trip, `cut-list`'s per-clip
  output was extended (in `server/domains/filmstudios.js`) to include the
  `mediaId`/`mcamAngle` fields the clip record already stored internally —
  an additive, backward-compatible change (existing tests assert specific
  fields present, not the absence of others; re-run clean).
- **`concord-frontend/components/film-studios/FsMediaPanel.tsx`** — added
  an "Analyze" action on image-kind media with a source URL, calling
  `vision` and rendering the real LLaVA description inline, with an honest
  degrade message ("Analysis unavailable: …") when the vision brain isn't
  reachable rather than a silent failure or fabricated description.
- **`server/tests/filmstudios-domain-parity.test.js`** — `location-update`
  had zero test coverage before this pass; added 2 tests (edits in place
  without creating a duplicate row, preserves untouched fields; fails
  honestly on an unknown id). Added a 3rd test pinning the new `cut-list`
  `mediaId`/`mcamAngle` exposure end-to-end (link → visible in cut-list →
  unlink → cleared in cut-list) — the contract the new `FsEditPanel` UI
  now depends on.

## Verification

- `cd concord-frontend && npx eslint components/film-studios/FsProductionPanel.tsx components/film-studios/FsScriptPanel.tsx components/film-studios/FsEditPanel.tsx components/film-studios/FsMediaPanel.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` filtered to `film-studios/` — 0 errors (one pre-fix type mismatch on the vision-result error shape found and fixed during this pass).
- Manual re-grep of all 7 originally-unsurfaced macro names: `location-update`, `scene-update`, `clip-set-media`, `vision` now surfaced; `breakdown-summary`, `clip-list`, `shoot-day-list` remain unsurfaced by design (documented above, verified redundant by reading the handler pairs).
- `node scripts/verify-lens-backends.mjs` → unaffected, `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260.
- `cd server && node --test tests/filmstudios-domain-parity.test.js tests/film-studios-lens-macros.test.js` → `65 pass / 0 fail` (was 62; +3 new tests, 0 regressions from the additive `cut-list` field change).
- Did not touch any of the other 8 frontend panel files
  (`FilmStackFeed.tsx`, `FilmStudioSection.tsx`, `FsBudgetTeamPanel.tsx`,
  `FsDistributionPanel.tsx`, `FsReviewPanel.tsx`, `FsShotsPanel.tsx`,
  `FsScreenplayPanel.tsx`, `FsWatchPartyPanel.tsx`) or `page.tsx` — no gap
  found in any of them after checking their macro coverage.
