# code-quality — capability map (Frontend Rebuild Program, Wave 3)

Reference apps: **SonarQube / SonarCloud** (static analysis, per-line issue
annotation, quality gates, technical-debt estimation, duplication hotspots)
and **CodeClimate / Codecov PR bots** (PR diff decoration, issue triage
workflow). Parity target: the only difference should be that this analyzes
submitted source in a per-user sandbox rather than a connected CI pipeline.

## Backend macro surface

`server/domains/code-quality.js` — **12 macros** via
`registerLensAction("code-quality", ...)`: `analyze`, `annotate`, `trend`,
`debt`, `hotspots`, `getGate`, `setGate`, `evaluateGate`, `decoratePR`,
`trackIssue`, `updateIssue`, `listIssues`. Plus a separate internal
`detectors` domain (Concord's own self-monitoring detector suite: `list`,
`summary`, `findings`) surfaced in a 7th tab.

`node scripts/lens-unsurfaced.mjs --lens code-quality` → **0/12
unsurfaced**, unchanged by this audit.

## Audit finding: already comprehensive, no gaps

Every one of the 7 tabs maps to a real, purpose-built component, verified
by cross-referencing every `registerLensAction("code-quality", ...)` name
against `lensRun('code-quality', ...)` call sites:

- **Analyze** → `AnalyzePanel.tsx` (`analyze`) — runs a real scan, produces
  the `CQScan` result every other tab consumes.
- **Annotations** → `AnnotatedSource.tsx` (`annotate` for per-line findings,
  `trackIssue` to promote a finding into a tracked issue).
- **Quality Gate** → `QualityGatePanel.tsx` (`getGate`/`setGate` to
  configure thresholds, `evaluateGate` to run a real pass/fail check
  against the current scan).
- **Debt & Trend** → `DebtTrendPanel.tsx` (`debt` for the current scan's
  technical-debt estimate, `trend` for a 30-point history, `hotspots` for
  duplication/complexity hotspots).
- **Issues** → `IssueWorkflow.tsx` (`listIssues`, `updateIssue`).
- **PR Decoration** → `PRDecorationPanel.tsx` (`decoratePR`).
- **Detector Suite** → the page's own inline panel, backed by the
  `detectors` domain (`list`/`summary`/`findings`), plus a mounted
  `ReleaseCadence` component.

No fabricated data anywhere in the 8 components (`AnalyzePanel`,
`AnnotatedSource`, `DebtTrendPanel`, `IssueWorkflow`, `PRDecorationPanel`,
`QualityGatePanel`, `ReleaseCadence`, `types.ts`) — no `Math.random`, no
hardcoded arrays standing in for live results, honest loading/error/empty
states throughout.

## What this rebuild changed

Nothing. The audit found a genuinely complete, well-designed lens with
100% macro coverage through real, distinct, purpose-built UI (not a
generic action-array or button wall anywhere) and no fabricated data. Per
the program's own honesty rule, an audit that finds nothing wrong says so
plainly rather than inventing a diff.

## Disposition ledger (step 1.5)

- **ALREADY REAL**: all 12 `code-quality` macros (analyze, annotate, trend,
  debt, hotspots, gate config/evaluation, PR decoration, issue workflow)
  plus the internal detector-suite tab (`list`/`summary`/`findings`).
- **BACKEND-CAPABLE-BUT-UNSURFACED**: none.
- **GENUINELY MISSING**: none against the SonarQube/CodeClimate parity
  checklist (per-line annotation ✓, quality gates ✓, debt/trend ✓,
  duplication hotspots ✓, PR decoration ✓, issue triage ✓).

## Verification

- Confirmed via read-only audit; no files touched, so no eslint/tsc diff to
  re-check beyond the project-wide baseline (0 errors, run as part of this
  session's shared verify pass).
- `node scripts/verify-lens-backends.mjs` — `code-quality` still `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `code-quality`:
  `tier: "polished"`, `isGenericScaffold: false`.
- `node scripts/lens-unsurfaced.mjs --lens code-quality` — 0/12 unsurfaced.
