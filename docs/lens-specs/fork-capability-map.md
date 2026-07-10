# Fork Lens — Capability Map (Frontend Rebuild Program, Wave 2)

Reproduce the macro list:
`grep -c 'registerLensAction("fork"' server/domains/fork.js` → 17

## Scope clarification (read this before assuming "fork" means the lattice-fork substrate)

`docs/NEXT_ARC_PLAN.md` names a "lattice-fork object" (`server/lib/lattice-fork.js`,
migration 351 `fork_objects`) as this arc's zero-trust-fork primitive — but
that library is a standalone, not-yet-wired-to-any-lens primitive (confirmed:
no `registerLensAction`/route references it anywhere outside its own test
file). The `fork` **lens** is backed by `server/domains/fork.js`, whose own
file header is explicit that it is unrelated: a GitHub-repo divergence/
Levenshtein-distance + live-GitHub-API analysis domain, not a persona/DTU
forking system. `docs/SCIFI_FEASIBILITY_MAP.md` independently confirms this
scope split. This capability map is scoped to what `domains/fork.js` and the
`fork` lens actually are: a **GitHub fork/network analysis tool**.

## Reference apps

- **GitHub's own Network Graph / Insights / Pulse** — fork tree, ahead/behind,
  contributor activity.
- **A fork-tracking + PR-overlay dashboard** (the shape of tools like
  Renovate/Dependabot's watch-and-alert model, applied to forks instead of
  dependencies) — commit compare, PR status, stale-fork detection, release/tag
  tracking, cross-repo file diff.

## Audit finding: the GitHub-parity surface was already comprehensively real; one action bar was wired to the wrong data source

Before this pass, three real bespoke components already covered 14 of the 17
macros with genuine live GitHub API data (zero fabrication, explicit empty
states):

- `ForkNetworkExplorer` — `github-repo` + `github-forks` (parent lookup +
  fork list, sortable, with freshness banding).
- `RepoWatchlist` — the full `watch-add/list/delete/refresh/dashboard` +
  `feed` substrate (persistent per-user watched-repo tracking + a live
  GitHub-events-to-DTU ingestion pipeline).
- `ForkInsights` — six tabs, each one macro: `commitCompare`, `pullRequests`,
  `networkGraph`, `staleForkScan`, `releases`, `fileDiff`.

The remaining three macros (`divergenceAnalysis`, `mergeComplexity`,
`forkHealth`) are also real, substantive engines (bounded Levenshtein
diffing + line-conflict-region detection; conflict/dependency-overlap merge-
effort scoring; a five-factor weighted health score) — but the page's
"Fork Analysis Actions" bar ran them against `forkItems[0]`, an item from an
entirely separate generic workspace-lineage tree (create/merge records with
`{parentId, workspace, status, depth, children}` — a lightweight, honestly-
generic personal bookkeeping feature, unrelated to GitHub, that predates the
real GitHub-parity build-out). Feeding that shape into these three macros
never supplied the `base/forkA/forkB` file trees, `changes` regions, or
`fork`/`upstream` metadata they expect. Concretely, this wasn't just an
empty-state dead end — `forkHealth` degrades every missing field to a
defined default (`contributorCount→1`, `commitCount→0`, `createdAt→now`),
so running it against the empty workspace-tree artifact produced a
confident, fully-rendered "unnamed · 87 · healthy" result computed from
nothing but placeholder defaults. That is exactly the "confident fake
success" pattern the honesty invariant exists to catch, even though the
underlying macro and its rendering were both otherwise real.

## What this rebuild changed

- Removed the "Fork Analysis Actions" bar and its dependency on the
  disconnected workspace-tree artifact, plus the generic auto-discovered
  action bar and the generic capability-list section (both templated,
  redundant given the bespoke surfaces already present).
- Added `components/fork/ForkAnalysisLab.tsx` — a real three-textarea
  (base / fork A / fork B) diff lab that calls `divergenceAnalysis` directly
  via `lensRun` (the posted input becomes the macro's `artifact.data`, no
  artifact needs to exist first), then offers a one-click "estimate merge
  complexity" action that *mechanically derives* the `changes`/`regions`
  input for `mergeComplexity` from the divergence result's own
  `conflictRegions` — real derived data, not hand-authored JSON.
- Wired `forkHealth` into `ForkNetworkExplorer` instead: a "Compute health"
  button per fetched fork row builds the `fork` object from the same live
  GitHub data already on screen (`pushedAt`, `openIssues`, `createdAt`) —
  real inputs, with an explicit caption noting that commit/contributor
  counts default inside the scorer because GitHub's forks endpoint doesn't
  expose them (an honest degrade, not a guess).
- Kept the workspace-lineage tree/list/details panel as-is: it's honestly
  generic (real CRUD persistence, no fabricated data, not dressed up as
  GitHub analysis) rather than fake, so it didn't meet the bar for a rebuild
  — flagged here as a disposition, not silently left. A future pass could
  add a "track this fork" bridge from the GitHub explorer into it.

## Verification

- `npx eslint app/lenses/fork/page.tsx components/fork/ForkAnalysisLab.tsx components/fork/ForkNetworkExplorer.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `fork` still `WIRED`; total unchanged at 258 WIRED / 2 NO-BACKEND-CALL.
- `node scripts/grade-ux-polish.mjs --honest` — `fork`: `tier: "polished"`, `isGenericScaffold: false`.
- No existing fork-lens test file (confirmed by search) — nothing to update.
