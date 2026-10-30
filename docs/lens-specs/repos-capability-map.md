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
| ~~`codeComplexity`'s per-file heuristic isn't a real AST parse (no per-function boundary detection — the whole file is treated as one function).~~ **CLOSED (2026-07-16, `ba5bee97`)** | New `server/lib/code-ast-complexity.js` walks the real TypeScript-compiler AST (same package + lazy-load pattern `ts-language-service.js` already uses server-side — zero new dependencies), detecting real function boundaries (declaration/expression/arrow/method/get/set/constructor) and McCabe cyclomatic complexity via the same decision-point set ESLint's `complexity` rule uses. Proven to be a real parse and not a regex by a test asserting a comment/string literally containing `"if ("` scores zero branches. `ConcordRepoWorkspace.tsx`'s old client-side regex counter (`estimateFileComplexity`) is deleted; the macro takes real `sourceFiles` now, failing honestly (`ast_engine_unavailable`) rather than silently fabricating a count if the TS package can't load. |
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

---

## B5 build update — 2026-10-29 (Product Review 2, lens-reviews/repos.md)

The Wave-3 text above is the historical record; several of its claims were overtaken by what the 2026-10-28 live review found (the "real per-file diff" rendered +0 across 0 files; the scan's source was undeterminable from the product). This addendum records the rebuild against Review 2's slices S1–S10.

**The substrate change everything stands on:** each commit now records a `changes` delta ({path: content | null}); folding the first-parent chain yields the full file tree at any commit. Branches therefore hold real, independent trees; diffs are computed merge-base → head; merges are real three-way line merges. Commits written before this change carry no `changes` — folds through them return "history predates recorded snapshots" and every surface says so rather than inventing a tree (the default branch of a legacy repo still reads from its stored tree, which is that tree). `repo.files` is now explicitly the default-branch mirror (security scan, workflow checks, insights read it); `workflow-run` checks the named branch's tree.

| Slice | Disposition |
|---|---|
| S1 branches hold work | file-save/file-tree/file-read are branch-scoped; branch commit counts are ancestry counts from the head, not label counts; Code view has a branch selector with a standing "You are editing X" banner |
| S2 real diffs | pull-detail diffs merge-base → head snapshot (LCS-aligned hunks with both line numbers, per-file status, true ± counts); new `commit-detail` macro; file-read accepts a commit sha |
| S3 conflicts | pull-merge runs a per-file three-way line merge; same-line divergence blocks with the files and lines named, PR stays open; disjoint edits merge for real (two-parent merge commit carrying the merged delta) |
| S4 file lifecycle | Add-file control in the Code view (backend file-save already created; now branch-scoped); new `file-delete` macro (a commit on the named branch) + UI confirm |
| S5 repo lifecycle | New Settings tab: `repo-update` (rename/description/visibility in-account; sharing rides the platform ACL, #1789), `repo-delete` (server requires the exact typed name), `branch-delete` (never the default, never an open PR's branch), `tag-delete` |
| S6 guards | Duplicate repo names rejected (create + rename); explicitly empty commit message rejected; empty file content rejected unless the user confirms (the commit then records the choice); no-change saves and no-change PRs refused, naming the reason |
| S7 Analysis wiring | codeComplexity / commitAnalysis / dependencyAudit accept the params + params.input shapes as well as the artifact (the tab's calls were landing in a shape the macros never read — F6's mechanism); the tab's package.json lookup now searches the unfiltered file list |
| S8 scan provenance | Dependency alerts render their OSV advisory ID (CVE/GHSA) and a source line naming OSV.dev, queried live at scan time; "Dependabot" branding retired from the surface; code scanning is labelled as Concord's own rules |
| S9 honest copy | The header states what a Concord repo is (lives in Concord, no git remote, nothing to clone); the seeded starter tree is disclosed at creation and in the empty state; the "SUBSTRATE" badge is gone; merge copy states what the merge checks |
| S10 ritual + receipts | `pull-comment` (general + line-anchored to diff lines), `pull-link-issue` both directions (issue-detail reports linkedPulls; linked issues close when their PR merges), success receipts for create/commit/merge/delete, a real Merged pill; author approvals are labelled "approved by the author". The approval-INDEPENDENCE policy itself is Ramaj's §8 taste call — labelled, not decided, in this build |

Also fixed: F9 (RepoBrowser language strip fed the macro's array-shaped languages into a map-shaped renderer → "0 NaN%"; now normalised + zero-guarded); F8 (workflow syntax step counts TypeScript files and names them not-parsed instead of reporting "0 script(s)"; the static-scan step states its scope; durations render in ms under a second); runX now surfaces the macro's human `message`, keeping the machine code separate.

Macro count: 31 review-verified → **39** (+file-delete, branch-delete, tag-delete, repo-update, repo-delete, commit-detail, pull-comment, pull-link-issue), plus the 4 feed-cache GitHub actions. §8's GitHub OAuth remains NEEDS-RAMAJ; no slice depends on it.

Tests: `server/tests/repos-domain.test.js` (new, 12 handler-level groups incl. the review's R3 and R5(b) constructions run exactly) — 12/12 green. Pre-existing suites: repos-domain-parity + atlas-repos-domain-parity run with my changes at the same pass counts as pristine HEAD in this sandbox (the 2 codeComplexity AST cases fail identically on HEAD — the `typescript` package is not loadable in the VM worktree; Mac-lane verification).

---

## B5 follow-up — 2026-10-29 (Review 2 §9 re-pass fix round on PR #1808)

The re-pass (2026-10-29, live, normal account) verified S5/S8/S9 live and failed S1 at the layer handler tests could not see. Four fixes, each diagnosed to mechanism in the follow-up PR:

1. **Legacy anchoring (S1).** #1808's fold refused any chain containing a pre-snapshot commit, so every branch of a pre-#1808 repo (the re-pass's carried 8 legacy commits) was unviewable and uncommittable while main survived on the `repo.files` fallback. Commits may now carry a `baseline` (the full tree at that commit); `rpAnchorLegacyHead` stamps it onto the default branch's head from `repo.files` — exact truth under the mirror invariant — at every fold-needing entry point. One stamp heals the repo: branches forked from that head before or after, PR diffs based on it, merges into it. History deeper than the head stays unrecorded and the surfaces still say so; the file-tree error no longer promises commits it would refuse.
2. **Counts (adjacent).** Branch counts are now ahead-counts: the default branch reports its total history; other branches report commits reachable from their head that the default does not have (their own work). Raw ancestry size (pass-1 branches reading 3 and 5 against empty histories) and pass 1's label count were the same error in opposite directions.
3. **Analysis honesty (S7).** The complexity card renders the macro's actual outcome — its error verbatim (e.g. the parser package not loading on the server), files-matched-but-unreadable, or no-JS/TS-files — never an empty-state claim over a failed call. `dependencyAudit` gained an opt-in `liveVulnCheck`: with it, and only when the caller supplied no vulnerability data of its own, the audit enriches from the same `osvScanDependencies` helper the Security scan uses (per-dep counts + advisory IDs, all dependencies named in a new `dependencyList`), so the two tabs agree by construction; on OSV-unreachable the counts return null (unknown), never 0. Unflagged callers keep the exact synchronous contract behaviour.
4. **The message guard, live form (S6).** The Code view prefilled its suggested commit message by substituting it at send time for an emptied box, silently defeating the server guard. The suggestion is now a prefill in the input (visible, deletable); the FE sends the box verbatim, so an emptied message reaches the server and its refusal surfaces.

Tests: `repos-domain.test.js` grows a legacy-fixture group running checkpoint 1's construction exactly (hand-built 2-commit legacy repo → branch → view → commit → PR diff, mid-history branch still honestly unrecorded, ahead counts) and an audit-source group (source labelling, caller-supplied counts honoured under the flag, flagged path with an unqueryable version touching no network). The live OSV leg of the flagged path reuses the security scan's helper verbatim and is verified by the follow-up re-pass, not in-sandbox.
