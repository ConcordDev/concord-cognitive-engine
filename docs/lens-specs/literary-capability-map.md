# Literary lens — capability map (Wave 3, 2026-07-11)

## What this lens actually is

The Literary Resonance Lattice (LRL) — hybrid search (BM25 + dense, RRF-fused
server-side) over an ingested public-domain corpus, presented as a living
semantic substrate: every passage is a first-class DTU, results are grounded
and traceable to source + license, a reader's annotation mints a derivative
DTU citing the source passage (self-growing lattice, royalty cascade tracked),
and the cross-domain resonance graph exports as GraphML/CSV/JSON. Already
excellent going in — honest "Grounded" vs "Keyword" badge reflecting the real
server-side `semantic` flag, a genuine "ingest the corpus" CTA on an empty
corpus rather than fabricated rows, and careful envelope-unwrap discipline.

Backend: `server/domains/literary.js`, 10 macros. 6 already had a real UI
caller (`search`, `semantic_graph`, `resonance`, `annotate`, `stats`,
`resonance_graph`).

## Finding: `literary.detail` had zero UI caller — no way to actually read a passage

`literary.detail` (full chunk content + up to 4 neighboring chunks for reading
context) was registered and tested but never called from the page. Search
results only ever rendered a 3-line `line-clamp-3` snippet — in a lens whose
entire premise is a "living semantic substrate" over literary text, there was
no way to actually read a passage past its snippet. This is the defining gap
for a literary-reading tool specifically (per the per-lens category-leadership
invariant): the search/discovery half was there, the reading half wasn't.

## Fix

Added a "Read full passage ↓" action on the selected hit's Provenance panel
that calls `literary.detail` and renders the full chunk text plus a "Nearby in
this work" neighbor list (from the same macro). Neighbor navigation uses a
separate `detailChunkId` pointer rather than reassigning the search-hit
`selected` state — clicking a neighbor (which isn't itself a search hit) reads
forward/backward through the source work without disturbing the
Annotate/Provenance/resonance panels, which stay anchored to the actual search
result the reader picked.

Considered but deferred (documented, not built, to keep this fix scoped):
`crystallize` (most-bridged passages ranked by resonance salience — a
consolidation-candidate signal, better suited as a browse/discovery feature
for the no-query state) and `resonance_stats`/`salience` (small supporting
stats). All three are real, cheap reads with no external dependency —
ENGINEERING-triaged follow-ups, not DATA-SOURCING or CURATION gaps.

## Verification (all run directly, 2026-07-11)

- `npx eslint app/lenses/literary/page.tsx tests/literary-lens-states.test.tsx` — clean, 0 issues.
- `npx vitest run tests/literary-lens-states.test.tsx` — **10/10 passing** (2 new tests: full-passage read + neighbor navigation, and the detail-load error+Retry path).
- `node --test server/tests/literary-{phase34,resonance,domain-macros,graph,domain,salience}.test.js` — **36/36 passing** (no backend changes — `literary.detail` was already correct and tested, just unsurfaced).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `literary`: `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward.
