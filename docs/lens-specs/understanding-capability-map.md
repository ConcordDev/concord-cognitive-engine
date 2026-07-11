# Understanding Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every claim below was verified by a full read of the
> file it's about, a grep against the live tree, or a real `node --test` run —
> not assumed from a doc.

## Two genuinely separate backend systems share the `understanding` domain name

This is the load-bearing fact for this lens, and it is **already correctly
handled in the current code** — nothing here is a defect to fix.

1. **`server/domains/understanding.js`** (14 `registerLensAction` macros:
   `create`/`list`/`get`/`edit`/`remove`/`search`/`link`/`unlink`/
   `backlinks`/`graph`/`tags`/`diff`/`export`/`overview`) is a self-contained,
   in-memory Obsidian/RemNote-shape notes-and-wiki-links tool. State lives in
   `globalThis._concordSTATE.understandingLens` (`notes`/`links` Maps keyed by
   `userId`) — it never touches SQL and never references the `understandings`
   / `understanding_evolution` tables. The file's own header comment states
   this accurately.
2. **The real migration 120/121 substrate** (`understandings` table +
   evolution columns) is implemented by `server/lib/understanding-engine.js`
   (parse/save/compose/get) and `server/lib/understanding-evolve.js`
   (compounding evidence → promotion → consolidation → lineage), consumed by
   `server/lib/understanding-consumers.js` (wired into citation-evidence,
   chat-turn compose, forge/council constraint checks, cognition). Per the
   domain file's own comment, this engine's macros
   (`parse`/`compose`/`get`/`list`/`recompose`/`sweep`/`subject_kinds`/
   `record_evidence`/`evaluate_promotion`/`apply_promotion`/`consolidate`/
   `consolidation_candidates`/`lineage`/`evolution_tick`/
   `promoted_by_composer`/`evolution_stats`) are registered inline in
   `server.js`, not in a `domains/` file.

**Name collision, already correctly worked around, not a bug**: both systems
register a macro literally named `"list"` on domain `"understanding"`. Because
`registerLensAction` writes into a plain `Map` keyed by `"domain.action"`
(last write wins at boot), the notes-substrate's `list` is the one that's
live at `/api/lens/run`. `app/lenses/understanding/page.tsx`'s Browse tab
(~lines 261-263) documents this explicitly and calls a distinctly-named
`engine_list` alias to reach the real DB-backed `understandings` rows, while
`NotesWorkbench.tsx` calls the plain `list` for the notes system. Both
resolve correctly; this is deliberate, working wiring.

## Frontend surface

- `app/lenses/understanding/page.tsx` (1006 lines) — 6 tabs: **Notes**
  (`NotesWorkbench`), **Graph** (`KnowledgeGraph`), **Browse**, **Compose**,
  **Evolution**, **Lineage** (the last four wired directly to the real
  understanding-engine macros via the `engine_list` alias and siblings).
  Deliberately surfaces both backend systems side by side as two different,
  clearly-labelled product surfaces — a considered design choice, not
  confusion. `ManifestActionBar`/`RecentMineCard`/`AutoActionStrip` are
  present only as standard supplementary sentinels alongside substantial
  bespoke components, not as the primary way to reach any macro
  (`isGenericScaffold: false`, see Verification).
- `components/understanding/NotesWorkbench.tsx` (805 lines post-fix) — full
  CRUD + 250ms-debounced full-text search + tag filter + manual linking +
  backlinks (manual links + resolved `[[wiki-link]]` mentions) + revision
  history + LCS-based line diff between any two revisions + markdown/DTU-pack
  export. No seed/demo data anywhere in the component.
- `components/understanding/KnowledgeGraph.tsx` (226 lines) — renders the
  real link topology returned by the `understanding.graph` macro via a
  deterministic radial layout. An empty backend graph renders a real empty
  state, never a fabricated sample node.

## Fabricated-success / honesty audit

Traced by hand through `concord-frontend/lib/api/client.ts#lensRun()`, which
fully unwraps `{ok,result}` and correctly surfaces a terminal `{ok:false,
error}` as `r.data.ok === false` at every call site in both components. No
fabricated-success envelope bug found. No `Math.random()`/mock/lorem content
in either component (`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem"
components/understanding/*.tsx app/lenses/understanding/page.tsx` → clean).

## The defect found and fixed

### `NotesWorkbench.tsx#save()` was not optimistic

Pre-fix, clicking "Save changes" set `busy=true`, blocked the button behind a
spinner for the full `edit` macro round-trip, and only then cleared the dirty
flag and re-fetched the note. Per the fluidity invariant (sub-100ms
**perceived** response — CLAUDE.md §"Fluidity is the fifth hard invariant"),
a mutating action must show its end state immediately and reconcile quietly
in the background, or roll back visibly on failure — never freeze a control
waiting on the network.

## What changed

### `NotesWorkbench.tsx` — optimistic save with honest rollback

`save()` now:
1. Snapshots the current `title`/`body`/`tags` field values synchronously.
2. Immediately (before any `await`) flips `dirty` to `false`, stamps
   `savedAt`, and updates the visible word count + tag chips off the
   snapshot via a new `cleanTagsClient()` helper that mirrors
   `server/domains/understanding.js#cleanTags` exactly (lowercase, strip
   leading `#`, 24-char cap per tag, 32-tag cap, dedupe) — so the optimistic
   tag chips match what the server will actually persist, not a guess.
3. Fires the real `understanding.edit` macro call in the background.
4. **On success**: quietly reconciles via `loadNote()`, which now accepts a
   `{ syncEditorFields }` option. A new `editSeqRef` counter (bumped on every
   title/body/tag keystroke) lets the reconcile detect whether the user kept
   typing while the save was in flight; if so, it skips overwriting the live
   editor fields (so it can't clobber newer, unsaved keystrokes with a
   now-stale server snapshot) while still refreshing the read-only revision
   count / backlinks either way.
5. **On failure** (`ok:false` or a thrown/network error): a **visible,
   honest rollback** — `dirty` flips back to `true`, `savedAt` is retracted,
   and the existing error banner surfaces the real reason. Nothing is
   silently swallowed; the optimistic "saved" state is never left standing
   after a real failure.

The Save button's own `disabled={!dirty || !title.trim()}` guard doubles as
a natural debounce against double-submission, since `dirty` is already
`false` for the duration of a successful save. A `Cmd/Ctrl+S` keyboard
shortcut was added on the title/body fields (with a visible `⌘S` kbd chip
next to the button) so the mutating action is keyboard-discoverable per
`docs/UI_QUALITY_RUBRIC.md` §2, not just mouse-reachable.

No other files were touched. No backend changes — this was a frontend-only
finding, confirmed by re-reading the research: both understanding.js and
understanding-engine.js/understanding-evolve.js/understanding-consumers.js
were read and are unmodified.

## Macro → UI classification

**DESIGNED** (all macros used by this lens reach a real, bespoke surface —
no generic button wall for any of them):

| Macro group | Count | Where |
|---|---:|---|
| `create`/`list`/`get`/`edit`/`remove`/`search`/`tags` | 7 | `NotesWorkbench.tsx` CRUD + search + tag filter |
| `link`/`unlink`/`backlinks` | 3 | `NotesWorkbench.tsx` manual-link panel + Connections panel |
| `diff` | 1 | `NotesWorkbench.tsx` revision-history diff viewer |
| `export` | 1 | `NotesWorkbench.tsx` markdown/DTU-pack export buttons |
| `graph` | 1 | `KnowledgeGraph.tsx` radial link-topology view |
| `overview` | 1 | consumed by the lens overview surface |
| understanding-engine `parse`/`compose`/`get`/`list` (via `engine_list`)/`recompose`/`sweep`/`subject_kinds`/`record_evidence`/`evaluate_promotion`/`apply_promotion`/`consolidate`/`consolidation_candidates`/`lineage`/`evolution_tick`/`promoted_by_composer`/`evolution_stats` | 16 | `page.tsx` Compose/Evolution/Lineage tabs |

**GENERIC-STRIP-ONLY**: none — the standard sentinel components are present
as supplementary footer surfaces only, never the primary path to a macro.

**UNSURFACED**: none found this pass.

## Confirmed real and left alone, with reason

- **The two-backend-system design itself** — left alone by design; this is
  the correct architecture for "a personal notes tool" and "a compounding-
  evidence knowledge-promotion engine" being genuinely different products
  that happen to share a domain name, not a wiring defect to merge or hide.
- **`ManifestActionBar`/`RecentMineCard`/`AutoActionStrip` presence** — real,
  supplementary, not primary; matches the grader's DESIGNED-vs-generic-strip
  distinction (see Verification).

## Genuinely missing, deferred

None found this pass. Both backend systems are fully surfaced, honestly
wired, and the one fluidity gap found was fixed in this pass. A future
category-leadership pass judging this lens standalone against Obsidian
(graph view, backlinks, plugin ecosystem) or RemNote (spaced-repetition,
hierarchical outlining) would likely find real feature gaps — e.g. no
spaced-repetition surface, no nested/outline note structure — but none of
those were flagged as defects by this pass's research (which found the
existing 14+16 macros correctly and honestly surfaced); a dedicated
capability-parity pass against those specific reference apps is out of scope
here and would be a **CURATION/ENGINEERING** triage for a future session, not
a rebuild-loop defect.

## Verification

- `node --check server/domains/understanding.js` — clean (file untouched
  this pass; verified anyway per the assignment brief since no backend files
  were meant to change).
- `node --test tests/understanding-felt-weight.test.js
  tests/understanding-engine.test.js tests/understanding-evolve.test.js
  tests/understanding-consumers.test.js tests/understanding-lens-macros.test.js
  tests/understanding-domain-parity.test.js` (from `server/`) — **112/112
  pass**, unmodified.
- `node --test tests/depth/understanding-behavior.test.js` (from `server/`)
  — **1/1 pass** (single top-level test wrapping the behavioral suite).
- `npx vitest run tests/understanding-lens-states.test.tsx` (from
  `concord-frontend/`) — **4/4 pass**.
- `npx eslint components/understanding/NotesWorkbench.tsx` (from
  `concord-frontend/`) — clean, exit 0, 0 warnings.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (understanding was already
  WIRED and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) —
  understanding entry: `"tier":"polished"`, `"isGenericScaffold":false`,
  `"honestCapped":false`, `"bespokeRatio":0.506`, `"pillarsPresent":5`,
  `"antiPatterns":0`. `audit/` outputs reverted via `git checkout -- audit/`
  per the transient-artifact rule.
