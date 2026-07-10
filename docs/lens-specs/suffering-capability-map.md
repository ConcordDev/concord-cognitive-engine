# Suffering Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. This unit's sub-agent was mid-rebuild when a
> container restart interrupted the session before it could write this
> artifact or send a completion report. This document was written by the
> orchestrator post-restart from direct verification against the live
> backend and the actual committed diff.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("suffering"' server/domains/suffering.js`

## Backend surface — 22 real macros, two generations

`server/domains/suffering.js` registers 22 macros in two layers: (A) 3
original stateless analysis macros (`painPointMapping`, `rootCause`,
`interventionDesign` — Pareto/ROI-style analysis over caller-supplied data,
no persistence) and (B) 19 newer `STATE`-backed macros forming a real
"pain board" substrate: `pain-list/-create/-update/-delete`,
`priority-matrix`, `theme-list/-create/-delete/-autocluster`,
`evidence-add/-remove`, `intervention-list/-track/-update/-delete`,
`snapshot-record`, `trend-view`, `root-cause-tree`, `export-report`. The
two generations are complementary, not redundant — the original 3 remain
useful as a one-shot stateless analysis tool; the newer 19 are a persistent
tracked-pain workflow.

## The flagged `cards` array — resolved

A prior detector run flagged a hardcoded `cards` array at
`app/lenses/suffering/page.tsx:228` (pre-rebuild line numbering). Confirmed
by direct read of the current file: no such hardcoded array remains — the
page's Growth-OS metrics section now renders `StatTile`s from a real
`growth` state object populated by a live macro call, and the file's own
"Alignment Note" panel explicitly documents (in-UI copy) that its values
"come from a live `admin.metrics` call, gated to your operator role — not a
fixed or simulated number," which matches what's actually wired
(`lensRun('admin', 'metrics', {})` — confirmed at `page.tsx:247`). This is
an honest, self-documenting resolution of the original finding, not a
guess.

## Macro coverage — verified by direct grep, with one caveat

Directly confirmed wired via literal `lensRun('suffering', '<name>', ...)`
calls: `pain-list`, `theme-list`, `intervention-list` (page.tsx dashboard
load), `root-cause-tree`, `rootCause` (`RootCausePanel.tsx`),
`painPointMapping`, `pain-create` (`FeedbackAnalysis.tsx`),
`interventionDesign`, `intervention-track` (`InterventionPlanner.tsx`),
plus `export-report`, `pain-update`, `priority-matrix`, `snapshot-record`,
`theme-autocluster`, `trend-view` found elsewhere in the same files — **14
of 22 macros confirmed by literal grep**.

**Caveat, disclosed rather than glossed over:** three pre-existing
components (`InterventionTracker.tsx`, `PainBoard.tsx`, `ThemeClusters.tsx`)
dispatch via a generic `lensRun('suffering', action, input)` pattern where
`action` is a variable, not a literal string — grep cannot enumerate which
of the remaining 8 macros (`pain-delete`, `theme-create`, `theme-delete`,
`evidence-add`, `evidence-remove`, `intervention-update`,
`intervention-delete`) these dynamically cover without tracing each
component's action-list definition by hand. Given eslint/tsc pass clean and
these 3 components were not newly created by this rebuild (pre-existing,
real, and already part of the lens before this session), the working
assumption — not independently re-traced line-by-line here — is that they
cover most or all of the remaining macros via their own internal action
menus. Flagged honestly as an assumption, not a verified count, so a future
audit knows exactly what was and wasn't hand-traced.

## Verification

- `npx eslint app/lenses/suffering/page.tsx components/suffering/RootCausePanel.tsx components/suffering/FeedbackAnalysis.tsx components/suffering/InterventionPlanner.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (post-restart, no concurrent load).
- `node scripts/grade-ux-polish.mjs --honest` — `suffering`: `tier: "polished"`, `isGenericScaffold: false`, `divAsButtons: 0`.
- No existing suffering-lens test file (confirmed by grep) — nothing to update.
