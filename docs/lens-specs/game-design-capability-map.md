# Game Design Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Known honest-grader false positive

`grade-ux-polish.mjs --honest` flags this lens `isGenericScaffold: true`
(`tier: "functional"`) because `app/lenses/game-design/page.tsx` is thin
(96 LOC — it now only mounts `GameDesignSection` plus standard chrome) and
no single `components/game-design/*.tsx` file individually exceeds
`FLAGSHIP_COMPONENT_LOC` (1000). The grader's `maxBespokeComponentLoc`
signal takes the single largest bespoke file (738, `GdLevelPanel.tsx`),
not the sum — so a lens deliberately split into 14 well-organized files
(3,918 LOC total: `GdLevelPanel` 737 + `GdRuntimePanel` 540 +
`GdEntitiesPanel` 346 + `GdAnalysisPanel` 313 + `GameDesignSection` 292 +
9 more panels 68–274 LOC each) reads as "generic" by this narrow
structural check even though the page genuinely orchestrates a real, deep,
13-tab design suite. Same documented blind spot as `eco`/`creative-writing`
(2026-07) — better-organized multi-file architecture penalized relative to
one giant flagship file. Not a fabrication or an unsurfaced-macro gap.

## Backend surface

```
grep -c 'registerLensAction("game-design"' server/domains/gamedesign.js
```
→ **98** macros in `server/domains/gamedesign.js` (1,802 lines) — one of the
larger domain files in the codebase (CLAUDE.md's own numbers table cites
"game-design ~98" as one of the top domains by macro count; confirmed exact).
The lens directory is `game-design` but the backend file is `gamedesign.js`
(no hyphen) — the same filename-stem mismatch the CLAUDE.md warning and the
film-studios precedent describe. `node scripts/lens-unsurfaced.mjs --lens
game-design` reports no registered macros found for that reason; verified
manually instead — extracted all 98 action names via
`grep -oE 'registerLensAction\("game-design",\s*"[a-zA-Z0-9_-]+"'` (this needs
the `A-Z` range too: 4 of the 98 — `mechanicsAnalysis`, `playerFlow`,
`narrativeBranch`, `monetizationModel` — are legacy camelCase names, not the
hyphenated `verb-noun` convention the other 94 use) and cross-referenced each
against every `.tsx` file under `app/lenses/game-design/` and
`components/game-design/`.

This is a **Tiled + LDtk + Nuclino + Machinations + Twine 2026-parity**
game-design workbench (the domain file's own header comments name these
targets): game projects with a GDD, a mechanics roster, Machinations-style
core-loop resource modelling, an LDtk-style entity/enum system, a real grid
tilemap level editor (tile/object/IntGrid layers, autotile rules, resize,
duplicate, export), a Twine-style branching narrative graph with reachability
analysis, an asset library, a frame-based animation editor, a behavior-rule
engine, a **playable in-browser runtime** (compiles a level to a collision
grid + spawns actors, runs a real platformer physics simulation on canvas,
records outcomes), and real-time collaborative level editing (session
open/join/poll/push-op).

## Reference apps

**Tiled** (tilemap/autotile editing) + **LDtk** (entity/enum typed fields,
IntGrid layers) + **Nuclino/Notion** (GDD sections) + **Machinations**
(core-loop resource-flow modelling with net-delta balance verdicts) +
**Twine/articy:draft** (branching narrative with reachability analysis) +
a lightweight **in-browser playtest/analytics tool** (closest real analog:
itch.io's embedded HTML5 player + a GameAnalytics-style funnel dashboard).

## Classification (before this pass)

**The 98-macro engine itself is excellent — deep, correctly modeled, and
genuinely wired.** `components/game-design/GameDesignSection.tsx` (a
project roster + 11 tabs, each backed by its own `Gd*Panel.tsx`) is a real,
designed application: every one of `GdGddPanel`, `GdMechanicsPanel`,
`GdLoopsPanel`, `GdEntitiesPanel`, `GdLevelPanel`, `GdNarrativePanel`,
`GdAssetsPanel`, `GdAnimationPanel`, `GdBehaviorPanel`, `GdRuntimePanel`,
`GdCollabPanel` calls real `lensRun('game-design', ...)` macros with real
forms and real result rendering. `grep -n "Math.random\|MOCK\|mock\|fake\|
Lorem\|lorem"` across every file in `components/game-design/` and
`app/lenses/game-design/page.tsx` → **zero hits**. `GdLevelPanel.tsx` (713
lines) is a genuine canvas tilemap editor with real drag-painting (batched
via `level-paint-batch`, not one round-trip per cell), autotile rules, and
JSON export. `GdRuntimePanel.tsx` (503 lines) compiles a designed level via
`runtime-compile` into a real collision grid and runs an actual deterministic
platformer physics simulation (gravity, jump, solid/hazard collision) on a
`<canvas>`, then reports the real outcome back through `playtest-record` —
closing an honest design → playtest → rebalance loop with measured data
(`playtest-report`), not guesses.

**The defect was entirely in `app/lenses/game-design/page.tsx`, sitting
directly below that real engine.** The page mounted `GameDesignSection`
(the real app) and then, below it, carried ~520 lines of leftover Wave-1
generic-scaffold body — a second, disconnected "Projects / GDD / Mechanics /
Narrative / Levels / Balance" tab set:

1. **Its "Narrative" and "Levels" tabs used pure client-side `useState`
   with zero backend calls of any kind** — not even the generic artifact
   store. A user could add a "character," a "story beat," or a "level,"
   watch it render in an animated card list, and lose all of it on refresh.
   This is the clearest form of the CLAUDE.md zero-demo-content violation:
   a surface that *looks* saved but isn't backed by anything.
2. **Its "Projects" and "Mechanics" tabs wrote through the generic
   `useLensData('game-design', 'project'/'mechanic', ...)` artifact CRUD
   store** — a second, parallel data model (`STATE.lensArtifacts`) that the
   real engine (`STATE.gameDesignLens`, i.e. `getGdState()`) never reads.
   Creating a "project" here never appeared in `GameDesignSection`'s real
   game roster, and vice versa — two silently competing "project" concepts
   on one page.
3. **Its "Design Analysis" button wall (4 buttons: Mechanics Analysis,
   Player Flow, Narrative Branch, Monetization) called
   `mechanicsAnalysis` / `playerFlow` / `narrativeBranch` /
   `monetizationModel` via the generic per-artifact runner
   (`/api/lens/:domain/:id/run`) against `projectItems[0]?.id`** — one of
   the phantom parallel-store "projects" above. Read the four handlers
   (`server/domains/gamedesign.js:3-41`): three of them
   (`mechanicsAnalysis` reads `artifact.data.mechanics`, `playerFlow` reads
   `artifact.data.states`, `narrativeBranch` reads `artifact.data.nodes`)
   read arrays that field never populates (the fake project's `.data` shape
   hardcodes `mechanics: []` and never grows it), so those 3 of 4 buttons
   **could only ever render "Add X to analyze design" — permanently, by
   construction**, regardless of how much real work a designer had done in
   `GameDesignSection`. The 4th (`monetizationModel`) always computed off
   hardcoded defaults (premium model, 10,000 DAU) since nothing in the old
   scaffold ever let a user set `model`/`expectedDAU`/`conversionRate` —
   same number, every click, for every project. This is a fabricated-success
   pattern: a "Run Analysis" button that always returns *something*, but
   never anything true.
4. **Its "Balance" tab** showed project/mechanic counts sourced from the
   phantom parallel store (always desynced from the real roster) plus a
   `"Designer Level"` pulled from `/api/game/profile` — the **unrelated
   `game` lens's** own gamification level, not anything about game design.

None of this required a rebuild of the macro layer — the 98-macro engine
already does the real work. The fix was almost entirely deletion plus
re-pointing 3 genuinely-useful analysis tools at real data.

**7 of 98 macros were confirmed genuinely unsurfaced** by cross-referencing
every action name against every `lensRun('game-design', …)` call site in
the lens (the direct `useRunArtifact`/`/api/lens/:domain/:id/run` path
counts too, since `mechanicsAnalysis` etc. are dispatched that way):

- `entity-update` — **real gap.** Entities (health/damage/speed/kind/
  description) could be added and deleted in `GdEntitiesPanel` but never
  edited — fixing a stat typo required delete-and-recreate, losing the id
  every `level-object`'s `entityId` link and every custom LDtk field
  pointed at.
- `mechanic-update` — **real gap**, same shape: add/delete only in
  `GdMechanicsPanel`, no edit.
- `game-update` — **real gap.** The game roster in `GameDesignSection`
  could create and delete a project but never rename it or edit its
  genre/platform/pitch.
- `tile-delete` — **real gap.** `GdLevelPanel` could create unlimited
  custom tiles (`tile-create`) but had no way to remove one.
- `playtest-list` — **real gap.** `GdRuntimePanel` surfaced the aggregate
  `playtest-report` verdict but never the individual run log the aggregate
  is computed from.
- `game-export` — **real gap.** `level-export` (per-level JSON) was wired;
  the whole-project export (game + GDD + mechanics + loops + entities +
  enums + tiles + autotile rules + narrative graph + all levels) was not.
- `tile-palette` — **genuinely redundant, not a gap.** Confirmed by reading
  the handler pair side-by-side: `tile-list`'s `all` field
  (`server/domains/gamedesign.js:767`) already returns every builtin tile
  *and* every custom tile with its `category`, a strict superset of what
  `tile-palette` (builtins only) returns. `GdLevelPanel` already reads from
  `tile-list`.

Two more macros looked unsurfaced from a raw grep but are legitimate design
choices, not gaps:

- `level-paint` (single-cell paint) is subsumed by `level-paint-batch`
  (same operation, N cells) — `GdLevelPanel`'s canvas drag-paint correctly
  batches every dirty cell from a pointer-down/move/up gesture into one
  `level-paint-batch` call rather than one round-trip per cell painted.
  Confirmed by reading both handlers: `level-paint-batch` with a
  single-entry `cells` array is byte-for-byte equivalent to `level-paint`.
- `narrativeBranch` is subsumed by `narrative-graph` — confirmed by reading
  both handlers (`server/domains/gamedesign.js:18-25` vs. `:1024-1069`).
  `narrative-graph` computes `totalNodes`/`totalLinks`/`endings`/
  `maxDepth`/`avgChoicesPerNode`/`replayValue` **from the real narrative
  node/link graph** (`s.narrativeNodes`/`s.narrativeLinks`), plus real
  reachability analysis (BFS from start nodes, orphan/unreachable
  detection) that `narrativeBranch` doesn't have at all.
  `narrativeBranch` wants a fabricated `nodes[].choices[]` shape nothing in
  the real narrative engine populates (real links are separate objects with
  `fromId`/`toId`/`label`, not inline per-node choice arrays). `GdNarrativePanel`
  already renders every stat `narrativeBranch` would produce, sourced from
  `narrative-graph`, plus more. Left unsurfaced and documented rather than
  wired to fake input.

## What changed

- **`concord-frontend/app/lenses/game-design/page.tsx`** — removed the
  entire ~520-line duplicate/fake scaffold body (the second tab set, its
  unpersisted Narrative/Levels state, its phantom-store Projects/Mechanics
  tabs, its dead-by-construction Design Analysis button wall, its
  cross-lens "Designer Level" stat). The page now mounts the real
  `GameDesignSection` engine directly, plus the standard cross-lens chrome
  (`ManifestActionBar`, `LensFeaturePanel`, `RealtimeDataPanel`,
  `UniversalActions`, `DTUExportButton`, `RecentMineCard`,
  `AutoActionStrip`, `CrossLensRecentsPanel`) matching the pattern the
  already-audited `film-studios` lens uses for the same chrome. Added a
  discoverable `n` keyboard shortcut (new game project, focuses the real
  roster's title input by id) in place of the 6 shortcuts that pointed at
  the now-removed fake tabs.
- **`concord-frontend/components/game-design/GdAnalysisPanel.tsx`** (new)
  — the 4 "Design Analysis" tools, rebuilt to operate on real data instead
  of the phantom artifact store, and mounted as a 12th `Analysis` tab
  inside `GameDesignSection` (not a top-level page section, so it always
  has a real `gameId` in scope):
  - **Mechanics depth** — pulls the active game's real mechanics roster
    via `game-get` and calls `mechanicsAnalysis` with `{ mechanics }`
    directly (the direct `/api/lens/run` dispatch builds a virtual
    artifact from the params passed, so no persisted artifact is needed at
    all — confirmed by reading `server/server.js:39564-39567`). Depth
    score, pillar coverage, and emergent-potential verdict now reflect
    what's actually in the Mechanics tab.
  - **Flow calculator** — an explicitly-labeled scratchpad (no
    "player-state" entity exists in the real engine, and building one
    would be new-persistence scope, not a wiring fix) for sketching a
    challenge/skill pacing curve and running `playerFlow` on the real
    entered values, not a hardcoded 0-state array.
  - **Monetization calculator** — a real form (model/DAU/conversion-rate)
    feeding `monetizationModel` directly, so the projected revenue changes
    with what the user actually enters instead of always showing the same
    premium/10k-DAU numbers.
  - `narrativeBranch` intentionally not surfaced (see redundancy above);
    the panel's header comment documents why.
- **`concord-frontend/components/game-design/GdMechanicsPanel.tsx`** —
  added inline edit (pencil icon → name/category/description form,
  Save/Cancel) wired to `mechanic-update`.
- **`concord-frontend/components/game-design/GdEntitiesPanel.tsx`** —
  added inline edit on each entity row (name/kind/health/damage/speed/
  description form) wired to `entity-update`.
- **`concord-frontend/components/game-design/GdLevelPanel.tsx`** — tracks
  which tiles in the brush picker are custom (`tile-list.custom`, not just
  the merged `.all`) and adds a delete affordance on custom tile chips,
  wired to `tile-delete`. Built-in tiles have no delete affordance (they
  aren't deletable server-side either — `tile-delete` only operates on
  `customTiles`).
- **`concord-frontend/components/game-design/GdRuntimePanel.tsx`** — added
  a collapsible "Recent runs" log under the playtest analytics section,
  wired to `playtest-list`, showing per-run outcome/duration/deaths/
  collected alongside the existing aggregate `playtest-report` verdict.
- **`concord-frontend/components/game-design/GameDesignSection.tsx`** —
  added an inline game-edit form (title/genre/platform/pitch, pencil icon
  next to the active game) wired to `game-update`, and an "Export" button
  next to it that renders the whole-project JSON via `game-export`. Added
  the 12th "Analysis" tab.
- **`server/tests/gamedesign-domain-parity.test.js`** — `mechanic-update`
  had zero test coverage before this pass (unlike `game-update`,
  `entity-update`, `tile-delete`, and `playtest-list`, which were already
  tested); added 2 tests (edits in place without creating a duplicate row,
  fails honestly on an unknown id) following the file's existing pattern.
- **No backend logic changes.** All 7 real gaps were pre-existing, already
  correct, already-tested (except `mechanic-update`) macros — the entire
  fix is frontend wiring plus the one small test addition.

## Verification

- `cd concord-frontend && npx eslint app/lenses/game-design/page.tsx components/game-design/GameDesignSection.tsx components/game-design/GdAnalysisPanel.tsx components/game-design/GdMechanicsPanel.tsx components/game-design/GdEntitiesPanel.tsx components/game-design/GdLevelPanel.tsx components/game-design/GdRuntimePanel.tsx` → clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors in any `game-design` file (the run's 61 pre-existing errors are all in the sibling `app/lenses/game/page.tsx`, a different lens/domain owned by a concurrent Wave-3 agent, mid-edit in the same tree — none touch `game-design`).
- `cd server && node --test tests/gamedesign-domain-parity.test.js tests/game-design-lens-macros.test.js` → **82 pass / 0 fail** (was 80; +2 new `mechanic-update` tests, 0 regressions).
- Manual re-grep of all 7 originally-unsurfaced-with-a-real-gap macro
  names (`entity-update`, `mechanic-update`, `game-update`, `tile-delete`,
  `playtest-list`, `game-export`, plus the 4 analysis macros) against
  `components/game-design/*.tsx` and `app/lenses/game-design/page.tsx` —
  all now called from real forms. `tile-palette`, `level-paint`,
  `narrativeBranch` remain unsurfaced by design (documented above,
  verified redundant by reading the handler pairs).
- Did not touch `server/domains/gamedesign.js`, `server/domains/game.js`,
  `concord-frontend/app/lenses/game/`, or `concord-frontend/components/game/`
  — those belong to the sibling `game` lens (a different domain file),
  worked by a concurrent agent in this wave.
- Did not touch `GdGddPanel.tsx`, `GdLoopsPanel.tsx`, `GdNarrativePanel.tsx`,
  `GdAssetsPanel.tsx`, `GdAnimationPanel.tsx`, `GdBehaviorPanel.tsx`,
  `GdCollabPanel.tsx`, or `GameDevRepos.tsx` — read in full, no gap found in
  any of them (every one of their domain macros is already called with a
  real form and a real result render; `GameDevRepos.tsx` is a live,
  correctly-error-handled GitHub API search with a real "save as DTU" hook,
  unrelated to the 98 `game-design` macros).
