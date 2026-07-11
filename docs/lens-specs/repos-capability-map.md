# Repos — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. **Reference app / category leader: GitHub** (repo
hosting + code review + CI + security scanning), with the "explore" half
benchmarked against GitHub's own trending/search surface. The bar: would
this hold up shipped standalone against github.com — browse a repo's
file tree, edit + commit, branch/tag, open a PR with a real diff, review
+ merge, run CI and read logs, run a security scan, see contributor/
language insights — not "good enough next to 259 siblings."

## Backend surface — `server/domains/repos.js` (29 macros, all real)

Two halves:

- **Concord repo substrate** (in-memory per-user store on
  `globalThis._concordSTATE.reposLens`, persisted via the standard state
  debounce) — a genuine GitHub-shape code host: `repo-create`/`repo-list`,
  `file-tree`/`file-read`/`file-save` (real nested-tree builder + a real
  line-diff on every save, which mints a real commit), `branch-list`/
  `branch-create`/`tag-create`/`commit-graph`, full issue lifecycle
  (`issue-list`/`create`/`detail`/`comment`/`set-state`), full PR lifecycle
  (`pull-list`/`create`/`detail` with a real per-file diff computed from
  the commits actually on the head branch/`pull-review`/`pull-merge` which
  rejects on outstanding `request-changes` reviews and mints a real merge
  commit), CI (`workflow-run`/`workflow-runs`/`workflow-logs` — a
  deterministic 6-step pipeline that fails a step when the triggering
  commit deleted >40 lines, not a coin flip), security (`security-scan` —
  parses the repo's own `package.json` against a small real CVE table,
  plus 5 regex code-scanning rules run over every file), and
  `repo-insights` (real contributor/commit-activity/language aggregation
  from the repo's own commits and files).
- **Free GitHub API lookups** (`github-commits-recent`, `github-issues`,
  `github-languages`) — real `api.github.com` calls (60/hr unauth,
  5000/hr with `GITHUB_TOKEN`), field-mapped into a stable shape.
- **Pure-compute analysis engines** (`codeComplexity`, `commitAnalysis`,
  `dependencyAudit`) — real CS-textbook static analysis (cyclomatic +
  cognitive complexity, Halstead-derived maintainability index, bus
  factor, commit-size/day-of-week/hour distributions, dependency depth +
  duplicate + freshness + license-risk scoring) over an arbitrary
  `{modules|commits|dependencies}` input shape. These three were real and
  tested but had **no real caller anywhere in the frontend** before this
  pass — see the defect below.

Tests: `cd server && node --test tests/depth/repos-behavior.test.js
tests/repos-domain-parity.test.js tests/atlas-repos-domain-parity.test.js`
→ **53/53 pass, 0 fail** (re-verified after the one backend change this
pass — see "What changed" below).

## What was already real/wired (DESIGNED)

- **`components/repos/ConcordRepoWorkspace.tsx`** — DESIGNED, and the
  strongest component in the lens. A genuine multi-tab GitHub clone (Code /
  Branches / Issues / Pull requests / Actions / Security / Insights) wired
  to all the substrate macros above: a real file tree (`TreeDiagram`) +
  syntax-agnostic line-numbered viewer + inline editor with commit-message
  input, real branch/tag creation, a real commit-graph `TimelineView`, full
  issue create/comment/close, full PR create → real diff view → approve/
  request-changes/comment → merge (blocked while changes are requested), a
  real "Run CI" → step-by-step log viewer, a real "Run scan" → Dependabot +
  code-scanning alert list, and a real contributor/activity/language
  `ChartKit` dashboard. None of this was fabricated — every field it
  renders came from a real macro call.
- **`components/repos-explorer/RepoBrowser.tsx`** — DESIGNED. A real
  owner/repo GitHub browser (`github-commits-recent` + `github-issues` +
  `github-languages`), correct envelope-unwrap already in place (`callMacro`
  checks the wrapped `result.ok`, not just the transport layer — this file
  was already doing it right).
- **`components/repos/TrendingRepos.tsx`** — DESIGNED. Real
  `api.github.com/search/repositories` client call (language + date-range
  filters), real star totals, Save-as-DTU on the result set.

## The defects found + what changed

**1. A fabricated parallel repo/issue/commit browser sat next to the real
one, duplicating its purpose with invented data.** `page.tsx`'s top-level
"Repositories" list + detail view was NOT the Concord repo substrate at
all — it queried `apiHelpers.dtus.paginated({tags:'repo'})` (arbitrary DTUs
tagged "repo") and fabricated every GitHub-shaped field client-side:
`language: [...][i % 5]` (round-robin, not read from anywhere), `stars`/
`forks`/`watchers`/`issues`/`pullRequests` defaulting to 0 with no writer
that ever sets them, and — worst — the "Code" tab inside a selected
"repo" rendered a **hardcoded 6-entry file list** (`src`, `tests`,
`.gitignore`, `package.json`, `README.md`, `tsconfig.json`) completely
disconnected from any repo's real files. The "Issues" tab queried DTUs
tagged "issue" (unrelated to the substrate's real issues). The "Commits"
sidebar queried the **generic system events log** (`apiHelpers.eventsLog`)
and relabelled arbitrary event rows as commits (`sha: event.id.slice(0,7)`,
`message: event.type`). Every button in this surface — "New repository",
"Star", "Clone URL copied", "Branch: main", "Showing open/closed issues",
"Create new issue" — did nothing but fire a toast; none called a macro.
Meanwhile the real, fully-wired `ConcordRepoWorkspace` was mounted twice
lower on the same page — once inside a `pulls`-tab conditional with a
"real workspace lives below" disclaimer, once unconditionally — so the
honest surface was present but buried under, and duplicated beneath, a
fake one. **Fixed**: the entire fabricated repo/issue/commit system was
removed. `page.tsx` now has two views — **Your repos** (mounts
`ConcordRepoWorkspace` once) and **Explore GitHub** (`RepoBrowser` +
`TrendingRepos`) — both fully real, no duplication, no invented fields.

**2. The envelope-unwrap bug — the single most common defect this
program watches for — was present in `ConcordRepoWorkspace`'s shared
`run()` helper, affecting every one of its 7 tabs.** The helper checked
only the **outer transport `ok`** (`r.data?.ok`) and returned
`r.data.result` whenever that was true — but `/api/lens/run` sets the
outer `ok:true` even when the wrapped macro itself failed (a macro
`{ok:false, error}` return has no `result` key, so the server's
single-layer unwrap passes it through unchanged under `{ok:true, result:
{ok:false, error}}`). This produced two distinct failure modes across
the tabs, both now fixed by a corrected `runX()` that checks
`inner.ok !== false` before treating a response as success:
- **Silent-failure-as-success** on every mutation that discarded the
  return value: `branch-create`/`tag-create` on a duplicate name,
  `issue-create`/`issue-comment`/`issue-set-state`, `file-save`,
  `workflow-run` — each cleared its input and reloaded as if the action
  succeeded, with the real rejection reason never surfaced. `PullsTab`'s
  `createPull`/`merge` had `if (!r.data?.ok) setErr(...)`-shaped code that
  *looked* like error handling but was structurally checking the wrong
  layer, so a real `"head branch not found"` or `"changes requested —
  cannot merge"` rejection was silently swallowed even though the code
  visibly tried to catch it.
- **Render crashes** on read paths that did `if (res) { ...treat res as
  the success shape... }` — since a failure object `{ok:false, error}` is
  truthy, `CodeTab.openFile` would set `file` to the error object and then
  call `.split('\n')` on the (absent) `.content`; `ActionsTab.openLogs`
  would set `logs` to the error object and then `.map` over the (absent)
  `.steps`; `InsightsTab.load` set `data` to the error object unconditionally,
  and its `!data` empty-state guard never caught it before rendering
  `Object.entries(data.totals)` on `undefined`.
Fixed by replacing the single ambiguous `run()` with `runX()` (returns
`{ok, data, error}`, correctly reading both envelope layers) used
everywhere, plus a shared `<ErrorBanner>` wired into every tab so a real
rejection is now visibly surfaced instead of silently no-op'd or crashing.

**3. Three real, tested static-analysis macros (`codeComplexity`,
`commitAnalysis`, `dependencyAudit`) had no real caller anywhere in the
frontend — UNSURFACED.** `page.tsx`'s "Repository Analysis" panel called
them through the **generic lens-artifact system**
(`useLensData('repos','repo',{seed:[]})` / `useRunArtifact('repos')`) —
an unrelated CRUD-artifact REST layer (`/api/lens/repos?type=repo`) that
nothing ever writes a `type:'repo'` artifact into, so
`repoArtifacts[0]?.id` was always `undefined` and all three buttons were
**permanently disabled** for every real user. Even if unblocked, the
panel had no way to supply the macros' required input shapes
(`modules[].functions[]`, `commits[]`, `dependencies[]`) — there was no
form, just three inert buttons. **Fixed**: added a new **Analysis** tab to
`ConcordRepoWorkspace` (the 8th tab) that computes real input from the
*active* real repo, on demand (a "Run analysis" button, matching the
existing Security tab's on-demand-scan idiom — not an automatic fetch on
every tab visit):
  - `commitAnalysis` — built from `commit-graph`'s real commit nodes,
    field-mapped (`sha`→`hash`) to the macro's expected shape. This
    exposed a second, smaller field-shape gap: `commit-graph` didn't
    return each commit's `files[]` (needed for the macro's file-hotspot
    detection), even though the underlying commit objects already carry
    it for `file-save`/merge commits — a one-line additive fix to
    `server/domains/repos.js`'s `commit-graph` handler (`files: c.files
    || []`), the only backend change this pass.
  - `dependencyAudit` — built from the repo's own real `package.json`
    (fetched via `file-read`, `dependencies` + `devDependencies` parsed
    into `{name, version}` pairs). Honestly empty-stated when a repo has
    no `package.json` or no dependencies — never fabricated.
  - `codeComplexity` — built from the repo's own real file tree + real
    file contents (via `file-tree` + `file-read` per file, capped at the
    first 40 files with a visible "capped" note). Complexity is a
    lightweight **regex decision-point count** (if/else/case/catch/for/
    while/`.forEach`/`.map`/`.filter`/`.reduce`/`&&`/`||`/ternary, plus a
    max-indentation nesting estimate) over each file's real text — an
    approximate static analysis, honestly labelled as such in the tab's
    own subtitle, never a fabricated number.

## Investigated and honestly deferred

| Item | Disposition |
|---|---|
| `codeComplexity`'s per-file heuristic isn't a real AST parse (no per-function boundary detection — the whole file is treated as one function). | Honest by construction (labelled "lightweight static analysis" in the UI), correctly small relative to building a real JS/TS/Python/Rust/Go parser in-browser for a rival-shape secondary tab. **ENGINEERING**, deferred: a real per-language AST walk (e.g. via an existing parser already in the `code` lens's toolchain, if one exists) would sharpen per-function hotspots; not attempted this pass — out of scope for a frontend-rebuild pass on a non-primary tab. |
| `security-scan`'s vulnerability table (`RP_VULN_DB`) is a small hardcoded 5-entry CVE list rather than a live OSV/npm-audit feed. | **DATA-SOURCING**, correctly deferred — this is backend engine behavior (`server/domains/repos.js`), not a frontend gap, and out of scope for this pass; a future pass could wire a real free vulnerability feed (OSV.dev has a no-auth API) the same way the CPSC/CoinGecko/USGS feeds were wired elsewhere in Concord. |
| `TrendingRepos` calls `api.github.com` directly from the browser rather than through the SSRF-guarded `connectorFetch` chokepoint. | Left alone — it's an unauthenticated, read-only, public GitHub search endpoint with no secret in the request; the SSRF-guard pattern exists for server-side fetches with credentials, not client-side calls to a public search API. Not a defect. |

No capability was faked to fill a gap. Nothing in the lens is
GENERIC-STRIP-ONLY after this pass — every real macro is reached through a
DESIGNED, bespoke surface (a real file browser, a real diff viewer, a real
CI log viewer, a real complexity/commit/dependency dashboard), not a
generic action array or a JSON-paste form.

## Category-leadership caliber judgment (fourth invariant)

Against GitHub specifically: the Concord Code Host covers GitHub's core
loop (browse → edit → commit → branch → PR → review → merge → CI → security
→ insights) end-to-end on a real, if smaller, substrate, and now adds a
static-analysis dashboard GitHub itself doesn't ship natively (GitHub
relies on third-party Code Climate/Codacy-style apps for this). The
honest caliber gap vs. the leader: this is a **single-user, in-memory**
code host (no real Git object model, no multi-collaborator concurrent
editing, no real CI runners — the "CI" is a deterministic simulation keyed
off commit size) — it reads as a faithful GitHub-shaped *experience* over
Concord's own DTU-adjacent substrate, not a Git server. That framing is
correct and stated up front in the component's own header comment; the
"Explore GitHub" half genuinely proxies real GitHub data for the parts
(trending discovery, arbitrary-repo browsing) where a real Git backend
would add no value over the real API. Triaged as **already at the
appropriate caliber for what this lens is** — not a gap to close.

## Verification

- `node --check server/domains/repos.js` — the one backend change
  (`commit-graph` now includes `files` per commit node) is syntactically
  clean.
- `cd server && node --test tests/depth/repos-behavior.test.js
  tests/repos-domain-parity.test.js tests/atlas-repos-domain-parity.test.js`
  → **53/53 pass, 0 fail** (1 + 37 + 15; unmodified test files, all still
  green after the additive backend change).
- `cd concord-frontend && npx eslint app/lenses/repos/page.tsx
  components/repos/ConcordRepoWorkspace.tsx components/repos/TrendingRepos.tsx
  components/repos-explorer/RepoBrowser.tsx` → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 — repos WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → repos entry: `tier:
  "polished"`, not among the 3 capped generic-scaffolds, `bespokeRatio:
  0.906` (`totalLoc: 1357`, `bespokeComponentLoc: 1229`). `audit/`
  reverted after the run.

## Left alone, with reason

- `server/domains/repos.js` — one additive line changed (`files` on
  `commit-graph` nodes); every other macro untouched, all pre-existing
  behavior preserved, all 53 backend tests green unmodified.
- `components/repos-explorer/RepoBrowser.tsx`, `components/repos/TrendingRepos.tsx`
  — no changes. Both were already correct, real, and DESIGNED.
