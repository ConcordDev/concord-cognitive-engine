# Debate Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list: `grep -c 'registerLensAction("debate"' server/domains/debate.js` → 21

## Reference apps

- **Kialo** — collapsible impact-weighted pro/con claim tree, multi-thesis
  positions, sourcing/evidence per claim, public share links.
- **r/ChangeMyView** — a feed-style debate/persuasion surface (secondary
  reference for the CMV-shaped panel already present).

Parity target: "the only difference from Kialo should be catalog size and
polish, nothing else" for the structured-argument-tree half of this lens;
the legacy pro/con debate-with-timer half is a distinct, complementary
format (live/timed oratory debate, not Kialo's async claim tree) and is
graded against itself, not against Kialo.

## Audit finding: already substantively real on both halves

`app/lenses/debate/page.tsx` (1,060+ LOC) contains a live-debate format with
a real phase state machine (setup → opening → rebuttal → closing → voting →
finished), a round timer, a Pro/Con balance scale, a verdict scorer, and a
designed "AI Analysis Actions" panel that renders bespoke result shapes per
macro (`evaluateArgument`, `steelmanPosition`, `scoreDebate`, `fallacyCheck`
— each with its own scorecard/fallacy-badge/framework rendering, not a raw
JSON dump). `components/debate/KialoArgumentMap.tsx` (1,000+ LOC) is a
genuine Kialo-shape workbench: recursive impact-weighted claim tree with
collapse/expand, per-claim impact rating that propagates up the tree,
multi-thesis positions, claim sourcing, a perspective filter (view the tree
from one side), and public share links. `components/debate/DebateActionPanel.tsx`
adds fallacy/steelman/score/branch(→counter-argument DTU)/snapshot/publish
actions with a 30s-recall undo on publish. `CmvFeed.tsx` and
`SharedDebateView.tsx` round out the CMV-style feed and the public
read-only share view. No `Math.random()`, no hardcoded fabricated stats,
found in any of these files.

## `node scripts/lens-unsurfaced.mjs --lens debate` (before this pass)

```
debate: 2/21 macros never referenced in the frontend
  claim-* (1): claim-edit
  debate-* (1): debate-dashboard
```

## Checklist

| Item | Disposition |
|---|---|
| Claim tree add/vote/impact/delete/source-add/source-delete | ALREADY REAL — `KialoArgumentMap.tsx` |
| Multi-thesis positions + position-scores | ALREADY REAL — `PositionsPanel` in `KialoArgumentMap.tsx` |
| Public share link | ALREADY REAL — `debate-share`/`shared-view` → `SharedDebateView.tsx` |
| Fallacy/steelman/score AI analysis | ALREADY REAL — both the legacy-debate "AI Analysis Actions" panel and `DebateActionPanel.tsx` |
| Counter-argument branching into a DTU | ALREADY REAL — `DebateActionPanel.tsx#actBranch` |
| **Claim text editing** (`claim-edit`) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** No UI previously called it — a claim's text was create-once/delete-only. Added an inline edit affordance (pencil icon → inline input → Enter/✓ to save, Esc to cancel) to `ClaimCard` in `KialoArgumentMap.tsx`, backed by a new `editClaim(claimId, text)` handler calling `debate.claim-edit`. |
| **Portfolio dashboard** (`debate-dashboard`) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** Aggregate stats (debates/claims/positions/sources/shared/well-supported count) across every Kialo-tree debate existed on the backend with no UI. Added a 6-tile stats strip at the top of `KialoArgumentMap.tsx`, populated from `debate-dashboard`, shown whenever the caller has ≥1 debate. |

## What changed

- `concord-frontend/components/debate/KialoArgumentMap.tsx`:
  - `refresh()` now also calls `debate.debate-dashboard` and stores the
    result; a new stats strip renders it above the "New thesis" input.
  - `ClaimCard`/`ClaimBranch`/`KialoArgumentMap` thread a new `onEdit` /
    `editingClaim` / `onOpenEdit` prop chain; a claim's text becomes an
    inline `<input>` when its pencil icon is clicked, saved via
    `debate.claim-edit`.

## Verification

- `npx eslint components/debate/KialoArgumentMap.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors attributable to this lens (two
  pre-existing errors in `app/lenses/collab/page.tsx` and
  `app/lenses/dtus/page.tsx` are unrelated, concurrent sibling-agent work —
  confirmed via `git status` showing those files modified outside this
  session's edits).
- `node scripts/verify-lens-backends.mjs` — `debate` still `WIRED`; fleet
  total 258 WIRED / 2 NO-BACKEND-CALL / 0 broken, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `debate`: `tier: "polished"`,
  `isGenericScaffold: false`. (Transient `audit/ux-polish-honest*` files
  reverted after the run.)
