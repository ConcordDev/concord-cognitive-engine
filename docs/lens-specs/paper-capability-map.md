# paper — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("paper"' server/domains/paper.js` → 37
> plus 3 inline `register("paper", ...)` macros in `server.js` (a separate
> deterministic "build a paper from DTUs" compiler: `create`/`build`/`export`)
> and 4 inline `registerLensAction("paper", ...)` macros also in `server.js`
> (a claims-validation workflow: `validate`/`synthesize`/`detect-contradictions`/
> `trace-lineage`).

## Reference app + parity target

**Zotero / Semantic Scholar / arXiv Sanity** — this lens is genuinely two
products layered on one substrate: (1) a Zotero-shape reference manager
(save/tag/rate/annotate/PDF-attach/dedupe/group-libraries/citation-alerts,
all backed by real free APIs — arXiv export, CrossRef, Semantic Scholar,
Open Library) and (2) a Notion/Roam-flavoured research workbench (papers /
hypotheses / evidence / experiments / synthesis / bibliography, with a
slash-command + wikilink markdown composer). Both halves are real and
deep — this is one of the stronger-built lenses in the program.

## `node scripts/lens-unsurfaced.mjs --lens paper` (before fix)

```
paper: 3/37 macros never referenced in the frontend
  collection-* (1): collection-assign
  paper-* (1): paper-detail
  revisionDiff-* (1): revisionDiff
```

## Findings

### Dead domain-action buttons — REAL GAP (fixed)

The "Papers / Hypotheses / Evidence / Experiments / Synthesis / Bibliography"
workbench (`app/lenses/paper/page.tsx`) has a "Domain Actions Bar" with four
buttons — Validate Claims, Check Consistency, Generate Abstract, Export PDF —
wired through the generic `useRunArtifact` → `POST /api/lens/:domain/:id/run`
→ `register("lens","run")` path. That server macro *always* answers
`{ ok:true, result, pipelines }` even when the underlying domain handler's
own return was `{ ok:false, error }` — the failure lives nested inside
`result`, not at the top level (the same envelope-unwrap shape the
"fabricated success toasts" pattern in this program's method section warns
about, here on the sibling `/api/lens/:domain/:id/run` route rather than the
already-fixed `/api/lens/run`). `handleDomainAction`'s old code checked only
the outer `result.ok === false` (never true in practice) and then branched on
`action === 'generate_abstract' || action === 'synthesize'` — but the actual
button action names are `'validate'`, `'detect-contradictions'`,
`'abstractSummarize'`, and `'export_pdf'`. Only `export_pdf` matched anything.
**Net effect: clicking Validate Claims, Check Consistency, or Generate
Abstract fired a real macro, got a real correct result back, and then
silently discarded it — no toast, no render, nothing.** Three of four
buttons in a hand-built action bar were dead from the user's perspective.

**Fix** (`app/lenses/paper/page.tsx#handleDomainAction`):
1. Checks both the outer `response.ok` and the inner `response.result.ok`
   before declaring success — a genuine handler failure now surfaces as an
   error toast + message instead of being swallowed.
2. Branches on the real action names and renders each shape distinctly:
   `validate` populates the existing `validationResults` panel (pass rate /
   issue count) with a toast; `detect-contradictions` shows the contradiction
   count + list; `abstractSummarize` shows the generated abstract + keywords
   on the Synthesis tab with a toast pointing there; `export_pdf` is
   unchanged (it already worked).
3. `validate` (`server.js`'s inline `paper.validate`) only ever reads
   `artifact.data.claims` — a field none of the six create-forms in this
   lens populate, so every prior "Validate Claims" click (even once the
   dead-button bug above was fixed) would have reported "0 claims" forever.
   Added `claimsFromItem()`, which extracts the item's own real text
   (excerpt/content for papers, statement/rationale for hypotheses,
   summary/source for evidence, methodology/results/conclusions for
   experiments) into a synthetic `claims` array on first validate, so the
   empirical gate macro actually has real content to check. Nothing
   invented — every claim string is the user's own saved text.

### `collection-assign` — REAL GAP (fixed)

`PaperLibrary.tsx` (the Zotero-shape library panel) let a user create
collections and displayed their paper counts, but had no UI to actually put
a paper *into* a collection — `collection-assign` (backend, real) was never
called. Fixed: the paper detail expand panel now shows a toggleable chip per
collection; clicking adds/removes membership via `collection-assign`.

### `OpenLibraryPanel` / `CrossRefPanel` — REAL GAP, silent zero-results (fixed)

Both components (the Open Library book search and the CrossRef DOI search
panels mounted on this lens) had a local `runMacro<T>()` helper that
returned `r?.data` directly as the typed payload. The real response shape
from `POST /api/lens/run` is `{ ok: true, result: <macro's own return> }` —
the macro's actual `{ ok, books/works, total, fetchedAt }` payload lives one
level deeper at `r.data.result`. Both panels were reading `r.data.ok`
(coincidentally always `true`, since it's the outer transport envelope) and
`r.data.books`/`r.data.works`/`r.data.total` (always `undefined`, since
those fields live under `.result`) — **every real search silently returned
zero results**, indistinguishable from "no matches" in the UI. Fixed both
`runMacro` helpers to read `r?.data?.result`. `CrossRefPanel.tsx` lives
outside `components/paper/` (shared with the `research` lens via
`domain: 'paper' | 'research'`) but the bug and fix are identical, so both
consumers benefit.

### `CitationSearch` — field-shape mismatch, fabricated-looking render (fixed)

A near-duplicate of `ArxivSearch.tsx` on the same page, also calling
`paper.search` (arXiv), but its `Paper` interface declared `journal`, `doi`,
`citationCount`, and `openAccess` — none of which `paper.search`'s actual
arXiv-Atom response ever contains (see `parseArxivAtom` in
`server/domains/paper.js`). Every real result rendered `"undefined cites"`
next to a citation icon and a `journal || 'arXiv'` fallback that always fell
back. Fixed: the `Paper` interface + render now match the real fields
(`id`, `title`, `authors`, `abstract`, `published`, `primaryCategory`,
`pdfUrl`), plus a real error state for a failed search (previously silently
swallowed).

### `PaperSummarizer` — crash-shaped envelope bug (fixed)

`paper.summarize`'s failure paths (`text too short`, LLM parse failure, LLM
unavailable + throw) return `{ ok:false, error }` with no `problem`/
`approach`/etc fields. The component set that object straight into
`summary` state and rendered `summary.keyTerms.length` unconditionally —
an unguarded LLM parse failure or `summary.ok===false` on a longer-than-300
paste would have thrown (`Cannot read properties of undefined`). Fixed:
checks `result.ok !== false` before treating the response as a real summary,
with a visible error state on failure instead of a crash risk.

### `citationAnalyze` / `readabilityScore` — UNSURFACED, real capability (wired)

Two of the three unsurfaced macros from the initial scan were genuinely
unreachable, real, substantive engines with no frontend caller at all:
`citationAnalyze` (self-citation rate, recency index, year distribution,
median/avg age) and `readabilityScore` (Flesch-Kincaid grade, Flesch
reading ease, Gunning Fog, complex-word rate). Both compute real values from
real input — no fabrication risk, just missing surfaces.

**Fix:**
- `readabilityScore` — added a "Check Readability" button to the Papers-tab
  editor (next to Save/Cancel), calling the macro on-demand against the
  live `editorContent` via the generic `/api/lens/run` virtual-artifact
  path (no persisted artifact needed for this one). Shows reading level,
  grade, ease, fog index, and complex-word rate inline.
- `citationAnalyze` reads `artifact.data.citations` on a single artifact —
  a shape mismatch against this lens's per-citation-artifact bibliography
  model (each saved citation is its own `citation`-type artifact, not one
  artifact holding a list). Rather than force a backend/data-model change,
  wired a real "Analyze Bibliography" panel in `BibliographyManager` that
  builds the `citations` array client-side from the real saved bibliography
  entries and calls the macro through the same virtual-artifact
  `/api/lens/run` path — no persisted wrapper artifact required, no
  fabricated backend behavior.

### `revisionDiff` — ~~GENUINELY MISSING~~ **CLOSED (2026-07-16, `b8e03af1`)**

`revisionDiff` (line/word/char diff between `artifact.data.original` and
`.revised`) was real and correct, but this lens's "papers" data model had no
version-snapshot storage — only a `version` integer counter, no retained
prior content to diff against. Closed with a real version-history store:
`paper-version-save`/`paper-version-list`/`paper-version-diff`
(`server/domains/paper.js`), modeled on `paper-annotate`'s per-paper
nested-array pattern. `revisionDiff`'s diff computation was extracted into
a shared `computeTextDiff()` helper reused by both the original
caller-supplied-text path and `paper-version-diff`'s real-stored-snapshot
path — `revisionDiff`'s own behavior is unchanged (pinned by a byte-for-byte
regression test). `PaperVersionHistory.tsx` mounts below the notes editor
in `PaperLibrary.tsx`, saving a snapshot of the live notes content and
offering a real compare UI between any two saved versions.

### `paper-detail` — left alone (not a gap)

Fetches a single saved paper by id. Every frontend consumer (`PaperLibrary`,
`PaperWorkbench`) already gets full paper records — including `notes`,
`pdf`, `annotations`, `enrichment` — from `paper-list`, so there was never a
need for a separate single-record fetch. Genuinely just API-completeness,
not a UI gap.

## Left alone (already real, verified during the audit)

The `paper.create`/`build`/`export` deterministic DTU-driven paper compiler
(`register("paper", ...)` inline in `server.js`) is a *distinct* concept from
the reading-library "papers" artifacts and isn't exercised by this lens's
current frontend surface at all — it predates the Zotero/workbench build and
appears to be an older/parallel feature; left untouched as out of scope for
this pass (no frontend caller references it under any name, so it's neither
newly broken nor newly fixed by this audit). The claims-validation quad
(`validate`/`synthesize`/`detect-contradictions`/`trace-lineage`, inline in
`server.js`) — all four are real and are exactly what the Domain Actions Bar
+ Synthesis tab call; the bug was in how the frontend consumed their
responses (see above), not in the macros themselves. `PaperWorkbench.tsx`'s
21 macro wires (PDF reader/annotate, DOI capture, Semantic Scholar enrich,
dedupe, group libraries, cited-by alerts) were all already correctly wired
and unaffected by the envelope bug (its own call sites already check
`r.data?.ok` against the correctly-unwrapped `lensRun`/`api.post('/api/lens/run')`
shape). The arXiv/Open Library/CrossRef free-API integrations are real,
keyless, and functioning (aside from the two envelope bugs above).

## Verification

- `npx eslint app/lenses/paper/page.tsx components/paper/*.tsx components/research/CrossRefPanel.tsx` — clean, 0 errors/warnings.
- `npx tsc --noEmit -p .` — deferred to the orchestrator's centralized post-sweep run (per this session's memory-safety instruction); not run standalone.
- `node scripts/verify-lens-backends.mjs` — paper stays WIRED (258 WIRED / 2 NO-BACKEND-CALL / 260 total, unchanged).
- `node scripts/grade-ux-polish.mjs --honest` — paper: `tier: "polished"`, `isGenericScaffold: false` (unchanged; these were correctness + surfacing fixes, not polish-tier fixes).
- `node scripts/lens-unsurfaced.mjs --lens paper` (after fix): `2/37` — `paper-detail` (not a gap, see above) and `revisionDiff` (genuinely deferred, see above) are the only two remaining, both explained.
- Backend tests (no backend files touched, but re-ran clean): `node --test tests/depth/paper-export-behavior.test.js tests/depth/paper-behavior.test.js tests/paper-domain-parity.test.js tests/paper-library-domain-parity.test.js` — 27/27 passing, 0 fail.
