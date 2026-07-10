# Creative Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command.

## Backend surface

```
grep -c 'registerLensAction("creative"' server/domains/creative.js
```
→ **62** macros, all `registerLensAction("creative", ...)` in
`server/domains/creative.js`. They split into clear families:

- **1 generic content generator** — `generate` (image/text/melody via
  `params.kind`, or `mode: 'structural_poetry'` for form-aware poetry
  skeletons). Not called from this lens's own frontend files — it's
  called from `app/lenses/poetry/page.tsx` and `app/lenses/maker/page.tsx`
  (`grep -rn "domain: 'creative', action: 'generate'\|runDomain('creative', 'generate'" concord-frontend/app`), which is why it stays registered
  and untouched: it's real, reachable, cross-lens infrastructure, just not
  this lens's own UI.
- **2 producer-bench macros used by `CreativeActionPanel`** —
  `shotListGenerate`, `assetOrganize`, plus **2 more** — `budgetTrack`,
  `distributionChecklist` (4 total). Each reads a pasted/piped JSON
  artifact's `.data` and returns computed shot counts / asset readiness /
  budget variance / delivery checklist percentages.
- **7 board/card/connection macros** — `board-create`, `board-list`,
  `board-get`, `board-rename`, `board-delete`, `board-duplicate`,
  `board-templates`, `board-from-template` (Milanote-shape visual boards)
  plus `card-add`, `card-update`, `card-move`, `card-raise`, `card-delete`,
  `connection-add`, `connection-delete`.
- **1 dashboard macro** — `creative-dashboard` (boards/cards/openTasks/
  doneTasks counts).
- **StudioBinder + Frame.io parity substrate (the bulk of the domain)** —
  review-asset and review-comment (frame-accurate review comments),
  callsheet (call sheet generator), breakdown (script breakdown with
  auto-detected cast/location suggestions), deliverable (version stacking
  + approval workflow), calendar (production calendar), and prooflink
  (shareable client-proof links + external comment inbox, plus 2
  unauthenticated public-token macros `prooflink-public-get` /
  `prooflink-public-comment`).
- **2 generic per-artifact summarizers** — `project_summary`,
  `revision_summary`. Both read `artifact.data` and return computed
  counts/status/summary text for *any* object shape (arrays → counts,
  `versions[]`/`revisions[]`/`deliverables[]` → revision-count + latest
  status). These were the two macros the removed fabricated system's
  "Project Summary" / "Revision Summary" quick-action buttons called
  against its own (permanently empty) fake artifact store.

`node scripts/verify-lens-backends.mjs` → `creative` is `WIRED` (part of
`{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 — unchanged by this pass).

## The defect this rebuild fixed

`app/lenses/creative/page.tsx` (previously ~1,755 lines) carried a fully
fabricated, disconnected CRUD system sitting alongside four already-real
production components:

1. **Real, already-wired** (confirmed by reading every file and matching
   every `lensRun('creative', <macro>, ...)` call against the 62-macro
   grep above):
   - `components/creative/CreativeBoardsSection.tsx` +
     `components/creative/CreativeBoard.tsx` — Milanote-shape boards,
     every action (`board-list`/`board-create`/`board-from-template`/
     `board-duplicate`/`board-delete`/`board-rename`/`card-add`/
     `card-update`/`card-move`/`card-raise`/`card-delete`/
     `connection-add`/`connection-delete`) calls a real macro.
   - `components/creative/ProductionSuite.tsx` (1,233 LOC) — the
     StudioBinder + Frame.io parity surface: 6 internal tabs (Review,
     Call Sheets, Script Breakdown, Deliverables, Production Calendar,
     Proof Links), every one of them CRUD-complete against the review-*/
     callsheet-*/breakdown-*/deliverable-*/calendar-*/prooflink-* macro
     families. No seed data — genuinely empty until the user acts.
   - `components/creative/CreativeActionPanel.tsx` — a producer bench
     that pastes/pipes scenes/assets/budget/delivery JSON directly into
     `shotListGenerate`/`assetOrganize`/`budgetTrack`/
     `distributionChecklist`, then can mint/DM/publish the results or ask
     an agent to flag the single biggest schedule/budget risk. Every
     button calls a real macro (`server/domains/creative.js:86-243`
     confirmed to compute the exact fields the panel renders).
   - `components/creative/RedditCreative.tsx` — a live r/Design-family
     reference feed (real `reddit.com/*.json` fetch, not a macro but a
     genuine external data source with a Save-as-DTU action).
2. **Fabricated, disconnected** — `app/lenses/creative/page.tsx`'s
   `dashboard`/`projects`/`assets`/`revisions`/`shotlist`/`proofs`/
   `budget`/`distribution` mode-tabbed system. Every tab loaded via
   `useLensData('creative', <ArtifactType>, ...)` against client-invented
   types (`Project`/`Asset`/`Revision`/`ShotItem`/`ClientProof`/
   `BudgetLine`/`DistItem`) with **zero corresponding macros** — confirmed
   by grepping the 62-macro list above for any hit on those type names
   (none). The full create/edit/delete/detail-modal CRUD, the phase
   pipeline, the budget-by-category breakdown, the deadline tracker — all
   computed off a client-side store that no macro in the domain ever
   populates or reads. The "Quick Actions" row (`shotListGenerate`,
   `assetOrganize`, `budgetTrack`, `distributionChecklist`,
   `project_summary`) called REAL macros, but always against
   `allProjects[0]?.id` from the same permanently-empty fake store — so
   even the real macro calls could never actually fire with real data in
   any live deployment. This is the exact "disconnected shadow CRUD"
   pattern already found and fixed in the `eco` and `creative-writing`
   lenses this same pass (see their capability maps) — real backend depth
   sitting behind fabricated client-only data.

Removed the entire fabricated system: `ModeTab`/`ArtifactType` types, the
`SEED` object, `formConfig`, all eight `render*` functions
(`renderDashboard`/`renderProjects`/`renderAssets`/`renderRevisions`/
`renderShotList`/`renderProofs`/`renderBudget`/`renderDistribution`), the
detail modal, the editor modal, and every `useLensData`/`useRunArtifact`
call against the fake types. Kept every real component unchanged.

## What changed

- **`concord-frontend/app/lenses/creative/page.tsx`** rewritten
  1,755 → 200 lines. New structure: header (live indicator, DTU export,
  realtime alert count) → `FeedBanner` → **`CreativeDashboardStrip`**
  (newly mounted — see below) → `CreativeBoardsSection` →
  `ProductionSuite` → `RedditCreative` → `CreativeActionPanel` →
  `UniversalActions` (no `artifactId`, its own designed secondary-strip
  role, matching the `eco`/`creative-writing` precedent) → a DTU
  context/artifacts section (`LensContextPanel` + `ArtifactUploader` +
  `FeedbackWidget` + `RealtimeDataPanel` — unchanged, real DTU substrate,
  not part of the removed system) → the Lens Features toggle → the
  designed-secondary generic trio (`RecentMineCard`/`AutoActionStrip`/
  `CrossLensRecentsPanel`).
- **`concord-frontend/components/creative/CreativeDashboardStrip.tsx`**
  — built by a previous agent, verified correct field-for-field against
  the live macro responses (`creative-dashboard` → `boards`/`cards`/
  `openTasks`/`doneTasks`; `review-asset-list` → `assets[].openCount` +
  `count`; `callsheet-list` → `count`; `deliverable-list` →
  `deliverables[].status` + `count`; `calendar-list` → `upcoming`/
  `overdue`; `prooflink-list` → `links[].active`/`externalCommentCount`),
  was built but never mounted anywhere — **now mounted** as the lens's
  real dashboard tile row, replacing the fabricated KPI dashboard.
- No changes to `server/domains/creative.js` or any other backend file —
  this was a frontend-only reachability fix; no backend gap needed
  closing.

## Deliberately left unsurfaced (honest disposition, not a gap)

- **`project_summary` / `revision_summary`** — generic `artifact.data`
  summarizers that only had a caller in the removed fabricated system.
  They don't fit `ProductionSuite`'s per-feature state shape (call
  sheets/breakdowns/deliverables are plain Maps keyed by id, not DTU
  artifacts with a `.data` field) or `CreativeActionPanel`'s
  paste-JSON-artifact convention in a way that would add a new, distinct
  capability beyond what `ProductionSuite`'s own per-deliverable /
  per-breakdown detail views and `creative-dashboard` already show.
  Disposition: genuinely no natural home in this lens as currently
  scoped, not hidden or fabricated-around — same class of honest
  non-fit as the `eco` lens's `sustainabilityScore` (see that capability
  map). Left registered and functional at the macro layer.
- **`generate`** — real and reachable, just not from this lens's own
  pages; it's called from `app/lenses/poetry/page.tsx` (structural-poetry
  mode) and `app/lenses/maker/page.tsx` (image/text/melody mode). Correct
  to leave it out of the creative lens's own UI.

## Reference apps

StudioBinder + Frame.io (production management: call sheets, script
breakdown, review + approval), Milanote (visual boards), a generic
producer's status-report bench (shot lists / asset readiness / budget
variance / delivery checklists piped into DM/publish/agent-risk-review
actions) — `ProductionSuite`, `CreativeBoardsSection`, and
`CreativeActionPanel` already matched this shape before this pass; this
pass closed the dashboard-mount gap and removed the disconnected shadow
system sitting next to them.

## Verification

- `cd concord-frontend && npx eslint app/lenses/creative/page.tsx components/creative/CreativeDashboardStrip.tsx components/creative/ProductionSuite.tsx components/creative/CreativeBoardsSection.tsx components/creative/RedditCreative.tsx components/creative/CreativeActionPanel.tsx` — clean, exit 0.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged; `creative` WIRED.
- `node --test server/tests/creative-domain-parity.test.js server/tests/creative-lens-macros.test.js` — 42/42 pass, 0 fail.
- `node scripts/grade-ux-polish.mjs --honest` → `creative`: `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.914`, `maxBespokeComponentLoc: 1233` (well above the grader's 1000-LOC flagship threshold — no false positive here, unlike the `eco`/`creative-writing` multi-file-split case). `audit/` regenerated files reverted via `git checkout -- audit/` after grading, per instructions — not committed.
