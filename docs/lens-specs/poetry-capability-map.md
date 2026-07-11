# Poetry lens — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. Backend: `server/domains/poetry.js` (35 macros, no
shadowing re-registration in `server.js` — confirmed by
`grep -n 'register.*"poetry"' server/server.js`, which only matches the
domain-key allowlist array and the tag list, not a re-`register(...)` call).
`live_poetrydb` is a 36th real macro registered from a different file,
`server/domains/curated-free-apis.js` — grep by domain, not by file.

## Backend surface

Reproduce: `grep -n 'registerLensAction("poetry"' server/domains/poetry.js | wc -l` → 35.
Plus `poetry.live_poetrydb` in `server/domains/curated-free-apis.js`.

| Macro | Kind | Notes |
|---|---|---|
| `meterAnalysis`, `rhymeScheme`, `formGuide`, `wordFrequency` | pure compute | operate on `{ text }` (or `{ form }` for formGuide) passed directly as the virtual artifact's `.data` |
| `poetrydb-search`, `poetrydb-authors`, `live_poetrydb` | external API (PoetryDB) | real classical-poetry lookup, no key |
| `poem-create`, `poem-list`, `poem-detail`, `poem-update`, `poem-delete`, `poem-analyze` | per-user notebook substrate | `STATE.poetryLens.poems` (Map keyed by userId); `poem-analyze` runs the same prosody engine as the four pure-compute macros above, server-side, against the saved poem's `body` |
| `poetry-dashboard` | aggregate stats | poem/finished/draft/line counts by form |
| `feed` | DTU ingest | random PoetryDB poems → `dtu.create` |
| `form-rules`, `form-check` | pure compute | per-form constraint spec + live per-line syllable/violation report |
| `word-suggest` | external API (Datamuse) | rhyme/near-rhyme/synonym/means-like |
| `discovery-themes`, `poem-of-the-day`, `themed-collection` | curated discovery, live-fetched | day-seeded, never hardcoded |
| `favorite-add`, `favorite-list`, `favorite-remove`, `reading-log`, `reading-history` | per-user bookmarks/history | keyed by `(author, title)` ref |
| `recording-save`, `recording-list`, `recording-get`, `recording-delete` | audio readings | MediaRecorder → data URL, capped ~6MB |
| `workshop-share`, `workshop-list`, `workshop-detail`, `workshop-critique`, `workshop-unshare` | shared peer-critique | line-level critique threads on shared poems |
| `chapbook-export` | manuscript assembly | print-ready HTML + structured JSON |

## What's real / already-wired (unchanged)

Five of the seven frontend components were already correctly wired against
the real macros with correct field shapes, verified by reading both sides:

- `components/poetry/PoemWorkspace.tsx` — `poem-*` CRUD + `poem-analyze`.
- `components/poetry/PoetryWorkshop.tsx` — `workshop-*` + `poem-list`.
- `components/poetry/PoetryStudio.tsx` — `form-rules`/`form-check`/`word-suggest` (Form Studio), `recording-*` (Audio Readings), `chapbook-export`.
- `components/poetry/PoetryDiscovery.tsx` — `discovery-themes`/`poem-of-the-day`/`themed-collection`/`favorite-*`/`reading-*`.
- `components/poetry/PoetryDbSearch.tsx` — `poetrydb-search`, correct nested-`.result` unwrap via its own `callMacro` helper.
- `components/poetry/PoetryActionPanel.tsx` — `meterAnalysis`/`rhymeScheme`/`formGuide`/`wordFrequency` with the correct `{ text }`/`{ form }` shapes, plus DTU mint/publish/DM/agent-reading actions.

These five/six components cover 30 of the 36 real macros correctly and were
left untouched.

## Defects found + fixed

**1. `app/lenses/poetry/page.tsx` ran a whole second, fake poem-notebook
system beside the real one (the single most common defect this program
keeps finding).** The "Collection" and "Compose" tabs — the *default,
primary* tabs a user lands on — were wired to `useLensData`/`useRunArtifact`
against the generic `/api/lens/poetry` artifact CRUD store (`type: 'poem'`),
a completely different backing store from `STATE.poetryLens.poems` that
`PoemWorkspace`/`PoetryWorkshop`/`PoetryStudio` actually read from. A poem
composed in the primary Compose tab would never appear in Workshop's share
dropdown, Studio's chapbook export, or Studio's audio-reading poem picker —
and vice versa. `PoemWorkspace.tsx` (a smaller, real, correctly-wired
poem-CRUD panel) sat mounted lower on the same page as a redundant second
editor for the same conceptual objects, split across two disconnected data
stores. Fixed by rewiring `page.tsx`'s Collection/Compose tabs directly onto
`poem-list`/`poem-detail`/`poem-create`/`poem-update`/`poem-delete` via
`lensRun`, and retiring the now-fully-redundant `<PoemWorkspace />` mount
(the component file is left in place, just unmounted — Compose now covers
the same job with a richer editor: live syllable/rhyme panel, form
templates, reading mode, AI-assist). One poem store, reachable from every
tab now.

**2. The header "Poetry Analysis" quick-actions were wired to the wrong
field name and the wrong target.** `handleAction` sent
`{ id: poemItems[0]?.id, action }` through `useRunArtifact`, which built a
virtual artifact whose `.data` was the *fake* CRUD poem shape
(`{ content, form, lineCount, wordCount, ... }`). But `meterAnalysis` /
`rhymeScheme` / `wordFrequency` read `artifact.data?.text` (or `.poem`) —
never `.content` — so every call silently returned
`"Add poem text to analyze meter."` regardless of what was actually typed.
Separately, the buttons operated on "the first poem in an arbitrary list,"
not on anything the user was looking at. Fixed by rewiring `handleAction`
to call `lensRun('poetry', action, { text: compContent })` (or
`{ form: compForm }` for `formGuide`) against whatever poem is currently
open in the Compose tab, and gating the buttons on `compContent` having
text instead of on a fake artifact existing.

**3. `components/poetry/PoetryDbPanel.tsx` called a real macro but threw
away its result via a field-shape bug.** `POST /api/lens/run` always wraps
a macro's own return value one level down: `{ ok: true, result: <macro
return> }` (confirmed at `server.js:39475-39552`, both the `LENS_ACTIONS`
and `MACROS` dispatch branches). `PoetryDbPanel`'s hand-rolled `runMacro`
helper returned `r?.data` directly instead of `r?.data?.result`, so
`r.ok` was always `true` (the outer dispatch envelope, not the macro's own
`live_poetrydb` `ok`) and `r.poems` was always `undefined` (the real
`poems` array lives at `r.data.result.poems`). The panel rendered zero
poems on every load, silently, with no visible error — because `r.ok` was
always true it never even hit the error branch. Fixed the unwrap in
`runMacro` to read `r?.data?.result`.

## Investigated and honestly deferred

- **Collection-tab body preview / full-text search.** The old fake CRUD
  store kept the full poem body in every list row (it had to — it was the
  only store), so the list card could show a text snippet and search could
  match body content. The real `poem-list` macro deliberately omits body
  text (list vs. detail separation, same shape `PoemWorkspace` always
  used) to keep the list endpoint cheap. Search is now title-only; a body
  preview would need either an N+1 `poem-detail` fetch per row (wasteful)
  or a new `poem-list` param to include a truncated body — a real,
  small backend change I did not make (out of scope for a frontend-audit
  pass; flagged here as a legitimate DATA-SOURCING follow-up, not a
  fabrication problem, since the current behavior is honest about what it
  shows).
- **`PullToSubstrate` on Collection-tab poem rows.** The old row used the
  generic `POST /api/lens/poetry/:id/pull` route, which resolves ids
  against `STATE.lensArtifacts` — a store that no longer holds poem rows
  once Collection/Compose points at the real `poem-*` substrate. Rather
  than leave a button that would 404 on every click, replaced it with a
  small `mintPoem(id)` helper that fetches `poem-detail` then calls
  `dtu.create` directly (the same mechanism `PoetryActionPanel`'s "Mint"
  button already uses) — a real, working DTU-mint action, not a stub.
- **Poem status control.** `PoemWorkspace` (now retired) had a status
  selector (draft/revising/finished) wired to `poem-update`; the old
  Collection/Compose tabs never had one. Added a status `<select>` to the
  Compose tab (visible once a poem is saved) wired to the same real
  `poem-update` macro, so this capability isn't lost in the consolidation.
- **`DTUExportButton domain="poetry" data={{}}`** at the page header passes
  a permanently-empty object — pre-existing, unrelated to the macro-wiring
  defects above, and out of scope for this pass (it's a generic
  cross-lens component, not poetry-specific plumbing).

## Verification

- `node --check server/domains/poetry.js` — clean (backend untouched, sanity check only).
- `cd concord-frontend && npx eslint app/lenses/poetry/page.tsx components/poetry/*.tsx` — 0 errors, 0 warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` — no new errors in `lenses/poetry` or `components/poetry` (see session report for the exact filtered output).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged from before the change; `poetry` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `poetry` entry: `tier: "polished"`, `antiPatterns: 0`, `fileCount: 8`, `pillarsPresent: 5`.
- No `server/tests/*poetry*` or `server/tests/depth/*poetry*` test files exist in this tree (grep came up empty) — nothing to run/pin against for the backend, which is unchanged anyway.

## Left alone, with reason

- `server/domains/poetry.js` — no backend defects found; every macro this
  audit exercised had a correct, honest implementation (real PoetryDB/
  Datamuse calls with explicit `{ ok:false, reason }` on upstream failure,
  no fabricated data, no `Math.random()` in a result path).
- `components/poetry/PoemWorkspace.tsx` — left on disk but unmounted from
  the page (superseded by the fixed Compose tab, which does the same job
  with a richer editor). Not deleted, since it's a correct, working,
  independently-reusable component and deleting working code isn't this
  audit's mandate.
- `components/linguistics/DatamusePanel.tsx` (mounted with `domain="poetry"`)
  — shared cross-lens component, not poetry-specific; out of scope.
