# research — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `node scripts/lens-unsurfaced.mjs --lens research` → `0/54 macros never referenced in the frontend`
> (54 counts only the `registerLensAction("research", …)` family in
> `server/domains/research.js`; three additional macros live inline in
> `server.js` outside that registry — see Finding 1 below.)

## Reference app + parity target

Two real reference apps, because this lens is genuinely two products sharing
one domain namespace: **Zotero** (reference manager — library, collections,
tags, reading status, annotations, citation/bibliography formatting, related
items) and **Obsidian/Roam** (networked notes — wikilinks, backlinks, graph
view, daily notes, templates, version history, a spatial canvas). Both are
real, fully-built surfaces here, not stubs standing in for the category
leader — see Findings for what was already present versus what this pass
fixed.

## What was already real (verified, not assumed)

Before touching anything, every one of the 51 `registerLensAction`
macros callable from the frontend had a caller:

- **Zotero-shape reference manager** (`ResearchLibrarySection.tsx` →
  `ResearchLibraryPanel.tsx` / `ResearchCollectionsPanel.tsx` /
  `ResearchBibliographyPanel.tsx`): add/edit/delete/search/filter
  references, reading-status kanban (to_read/reading/read), tag facets,
  collections, related-reference linking, PDF attachments, real APA/MLA/
  Chicago/BibTeX citation formatting (`cite-format`, `bibliography-build`),
  and per-reference annotations.
- **Obsidian-shape notes** (`ResearchWorkbench.tsx`, opened via a floating
  action button): notes CRUD with `[[wikilink]]` autocomplete
  (`WikiLinkTextarea` → `note-titles`), daily journal, full-text search,
  6 authored templates, a real backlink graph (`NoteGraphView.tsx` →
  `note-graph`), and per-note version history with restore
  (`note-snapshot`/`note-snapshots`/`note-restore`).
- **Elicit-shape literature review** (`LiteratureReviewPanel.tsx` →
  `literature-review`): builds a finding-extraction matrix across up to 30
  papers, LLM-enhanced when a brain is present with a genuinely deterministic
  heuristic-extraction fallback (cue-word sentence matching per dimension) —
  never fabricates a cell value it can't derive from the abstract text.
  `AcademicSearchPanel.tsx` hits real free/keyless academic APIs
  (OpenAlex + arXiv, `academic-search`) with one-click import into the
  library (`academic-import`).
- **A spatial canvas** (`NoteCanvasBoard.tsx` → `canvas-save`/`canvas-list`/
  `canvas-get`/`canvas-delete`) for arranging notes/text/link cards with
  edges, Obsidian-Canvas-style.
- **`research.generate`** (the page's "Analyze" button) and
  `research.citationNetwork`/`methodologyScore`/`reproducibilityCheck`
  (the "Research Analysis" button row) — all real, all wired, all with
  deterministic fallbacks when no LLM is available.

This is a lens that had already been through a real build pass. The gaps
found here were narrow and specific, not a "mostly fake" pattern.

## Findings

### Finding 1 (real gap, ENGINEERING, fixed) — the "Deep Research" button silently discarded 3 of its 4 phases

`app/lenses/research/page.tsx`'s **Deep Research** button POSTs
`/api/research/conduct`, which runs `conductResearch()`
(`server/server.js`) — a 4-phase pipeline: substrate scan → hypothesis
generation → cross-domain scan → synthesis. That function calls
`runMacro("hypothesis","generate", …)`, `runMacro("research",
"cross-domain-scan", …)`, and `runMacro("research","synthesize", …)`
directly.

**The bug:** none of those three macros were registered anywhere.
`runMacro()` only dispatches against the `MACROS` map (populated by
`register(domain, name, fn)`); `registerLensAction`'s `LENS_ACTIONS` map
(what `domains/research.js` and `/api/lens/run` use) is a **separate
registry that `runMacro()` cannot see** — this split is a documented,
load-bearing distinction in this codebase (see `server.js`'s comment at
`registerLensAction`'s definition). Every real "Deep Research" request
therefore hit `Error("macro not found: research.synthesize")` on each of
phases 2–4, caught by `conductResearch`'s per-phase `try/catch`, and
silently downgraded to `{ phase, error: "skipped" }`. Only phase 1 (a real
`scopedEmbeddingSearch` substrate scan) ever produced content. The frontend
then had nothing usable to render — its fallback was `JSON.stringify(data,
null, 2)`, so a working click produced a raw JSON dump instead of a
research report — a field-shape mismatch stacked on top of the missing
macros.

**Fix (`server/server.js`, near the existing `research.math.exec` /
`research.physics.constants` inline block, same `register()` idiom):**

- **`hypothesis.generate`** — deterministic construct extraction from the
  real topic + the real substrate titles already found in phase 1 (stop-word
  filtered term frequency → up to 5 templated falsifiable statements), then
  persisted through the real, already-tested `emergent/hypothesis-engine.js`
  (`proposeHypothesis`) so each item is an actual queryable hypothesis
  object, not throwaway text.
- **`research.cross-domain-scan`** — a real `scopedEmbeddingSearch` over the
  topic, grouped by domain and ranked by average relevance, excluding
  domains phase 1 already covered. Empty results are an honest empty array,
  never invented.
- **`research.synthesize`** — composes a markdown report **grounded only in
  the `substrateKnowledge` array the caller supplied** (the real DTUs phase 1
  found) — when that array is empty it says so explicitly ("no existing
  substrate knowledge … novel area") rather than inventing findings — then
  mints the report as a real, citable DTU via `dtu.create`.

**A second, adjacent bug surfaced while wiring the mint path and was fixed
in the same pass:** `dtu.create`'s inner `pipelineCommitDTU` → `pipeCouncil`
re-runs `councilGate()` **without forwarding `userInitiated`**, so it always
applies the stricter `minScore=2` bar regardless of who's calling — a bare
`creti` markdown string with no structured `core` fields (0 structured
fields) fails that gate silently (`council_reject`/`low_value`) even though
the *first* `councilGate()` call inside `dtu.create` itself (which *does*
compute `isUserInitiated` correctly) would have passed it. This is a
pre-existing inconsistency between the two gate call sites, not something
introduced here — worked around the honest way, the same way
`reproducibilityCheck`'s existing mint path in `domains/research.js` already
does it: supply real, substantive `core.claims` (one per real substrate DTU,
plus an honest "nothing found" claim when the array is empty) instead of
relying on `creti` prose alone. Did not touch the gate itself — a grader/gate
fix needs the "bidirectional correctness fix + pinning test + explicit
authorization" process CLAUDE.md requires for touching protected
checkers, which is out of scope for a research-lens pass. Left a comment at
the call site.

Also fixed: `conductResearch()`'s synthesis phase was discarding the
`content` field synthesize now returns (`execution.phases.push({ phase:
"synthesis", dtuId: synthesis?.dtuId })` — no `content`); added it so the
frontend has something to render.

**Frontend fix (`app/lenses/research/page.tsx`):** replaced the
`JSON.stringify` fallback with `formatDeepResearchPhases()`, a small
formatter that renders each of the 4 phases as readable markdown — substrate
scan counts, the real generated hypotheses, real cross-domain connections,
and the real synthesis report — with an honest "_No … produced._" line for
any phase that genuinely came back empty (e.g. a fresh account with zero
substrate knowledge), never a blank silent gap.

**Verification:** `server/tests/research-deep-research-macros.test.js` (new,
4/4 passing) pins all three macros against a real booted server instance —
including a live assertion that `research.synthesize` mints a real DTU
(`dtuId` is a real string, not null) and that both the populated and
empty-substrate cases produce grounded, non-fabricated content.

### Finding 2 (real gap, ENGINEERING, fixed) — `annotation-list` had zero caller

`server/domains/research.js`'s `annotation-list` macro supports listing
**all** annotations across a user's whole library (no `referenceId` filter)
— but the only caller in the frontend was the per-reference path
(`reference-detail`, which already inlines that one reference's
annotations). There was no way to browse everything you'd highlighted
across the whole library without opening each reference one at a time —
a real, designed-but-unsurfaced capability, not a generic afterthought.

**Fix:** added a `HighlightsSection` component to
`ResearchLibraryPanel.tsx` — a collapsible "My highlights" browser at the
top of the library list, lazy-loaded on first open, that calls
`annotation-list` with no filter and renders each highlight (quote/note/
page) as a clickable row that jumps straight to its source reference via
the existing `reference-detail` → `openRef` path. Small, scoped, and uses
only fields the macro actually returns.

**Verification:** `node scripts/lens-unsurfaced.mjs --lens research` now
reports `0/54 macros never referenced in the frontend` (was `1/54`).

## What's genuinely deferred (none, this pass)

Both findings above were closed in this pass — no GENUINELY MISSING bucket
this time. The lens's actual category-leadership gaps (if any exist against
Zotero/Obsidian at their full maturity — e.g. Zotero's browser-extension
one-click web capture, or Obsidian's plugin ecosystem) are structurally
out of scope for a self-contained web lens and are not the kind of gap this
program's "closing the hard 20%" invariant targets (those target a missing
*defining* capability the backend could realistically serve, not a
different distribution model like a browser extension).

## Verification run (2026-07-11)

```
node scripts/verify-lens-backends.mjs
  → {"WIRED":258,"NO-BACKEND-CALL":2} total 260   (unchanged baseline)

node scripts/lens-unsurfaced.mjs --lens research
  → 0/54 macros never referenced in the frontend   (was 1/54)

node scripts/grade-ux-polish.mjs --honest
  → research: tier "polished", isGenericScaffold false, antiPatterns 0

cd server && node --test \
  tests/research-live-arxiv.test.js \
  tests/depth/research-generate-behavior.test.js \
  tests/depth/research-behavior.test.js \
  tests/research-zotero-domain-parity.test.js \
  tests/research-domain-parity.test.js \
  tests/research-deep-research-macros.test.js
  → 66 tests, 66 pass, 0 fail

npx eslint server.js concord-frontend/app/lenses/research/page.tsx \
  concord-frontend/components/research/ResearchLibraryPanel.tsx
  → clean, 0 errors
```
