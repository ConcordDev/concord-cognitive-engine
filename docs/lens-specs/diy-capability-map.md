# DIY Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list: `grep -c 'registerLensAction("diy"' server/domains/diy.js` → 24

## Reference apps

- **Instructables project builder** — illustrated step-by-step guides with
  photos, a bill of materials, and remixable/forkable published projects.
- **A cut-list optimizer + shop-safety checklist** (the class of tools
  woodworkers use alongside a project plan — stock-length bin-packing,
  PPE/hazard checklists, tool-availability gating before a build starts).

Parity target: "the only difference should be project catalog size, nothing
else."

## Audit finding: already a deep project workshop; four legacy analysis macros needed real homes

`components/diy/ProjectWorkshop.tsx` (1,300+ LOC) is a genuine per-user
project workshop: illustrated step builder (add/reorder/complete with
before/after photos), a bill-of-materials editor with real cost rollup and
generated (non-affiliate, plain search-URL) shopping links, a tool-gate that
blocks/clears a build against a live tool inventory, a cut-list optimizer
with a real first-fit-decreasing bin-packing algorithm and a proportional
board-layout diagram, and project publish/browse/fork (remix) with facet
filters. `DiyShowcase.tsx` supplies a published-project gallery. Every value
traces to a macro call via a named `run()` dispatcher — no fabricated data.

## `node scripts/lens-unsurfaced.mjs --lens diy` (before this pass)

```
diy: 5/24 macros never referenced in the frontend
  buildTimeEstimate-* (1): buildTimeEstimate
  estimateProject-* (1): estimateProject
  safetyCheck-* (1): safetyCheck
  step-* (1): step-update
  toolCheck-* (1): toolCheck
```

## Checklist

| Item | Disposition |
|---|---|
| Illustrated step builder (add/reorder/complete/photos) | ALREADY REAL |
| Bill of materials + cost rollup + shopping links | ALREADY REAL |
| Cut-list optimizer with board-layout diagram | ALREADY REAL |
| Tool-availability gate against a live inventory (`project-tool-gate`) | ALREADY REAL |
| Publish / browse gallery / fork (remix) | ALREADY REAL |
| **Full project cost estimate** (`estimateProject`) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** A richer estimate than the BOM rollup alone — labor cost, 10% waste allowance, and a difficulty-scaled contingency (3–15%) — had no caller. Added an "Insights" tab with a "Compute from N BOM lines" button that derives its input mechanically from the project's own `bom`/`estimatedHours`/`difficulty` fields (never hand-typed placeholder data). |
| **Safety/hazard check** (`safetyCheck`) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** PPE + hazard + risk-level assessment derived from a project's materials had no caller. Wired into the same Insights tab, deriving `materials` from the project's own BOM item names. Honest caveat rendered inline: tool-based hazards need a tools list the project object doesn't persist yet, so the panel notes "add tools in the Tool Gate tab first for tool-based hazards too" rather than fabricating a tools array. |
| **Build-time estimate** (`buildTimeEstimate`) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** Per-step time estimate scaled by experience level + 15% setup/cleanup overhead had no caller. Wired into the Insights tab, deriving `steps` from the project's own step list (`title`, `estimatedMinutes`). |
| **Step text editing** (`step-update`) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** A step's title/instructions/estimated-minutes were create-once — no edit path existed once a step was added (only reorder/delete/mark-complete). Added a pencil-icon inline edit (title input + instructions textarea + minutes field, Save/Cancel) to `StepBuilder` in `ProjectWorkshop.tsx`. |
| **Standalone tool-inventory check** (`toolCheck`) | **HONEST RELABEL (superseded, no build needed).** This is the older artifact-based macro (`artifact.data: {requiredTools, ownedTools}`) that predates the project-linked `project-tool-gate` macro, which already does the same required-vs-owned/needs-repair analysis *and* persists a `toolGateClear` flag on the actual project via a real designed `ToolGate` tab. Building a second, disconnected tool-check UI would duplicate `project-tool-gate` with strictly less integration (no project linkage), so it is left unwired by disposition rather than given a redundant panel. |

## What changed

- `concord-frontend/components/diy/ProjectWorkshop.tsx`:
  - New "Insights" tab (`WTab` extended) mounting a new `InsightsPanel`
    component that wires `estimateProject`, `safetyCheck`, and
    `buildTimeEstimate`, each deriving its input from the active project's
    real `bom`/`steps`/`difficulty`/`estimatedHours` fields.
  - `StepBuilder`: added inline step editing (pencil icon → title/text/
    minutes fields → Save/Cancel) backed by a new `step-update` call.

## Verification

- `npx eslint components/diy/ProjectWorkshop.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors attributable to this lens (two
  pre-existing errors in `app/lenses/collab/page.tsx` / `app/lenses/dtus/page.tsx`
  are unrelated concurrent sibling-agent work, confirmed via `git status`).
- `node scripts/verify-lens-backends.mjs` — `diy` still `WIRED`; fleet total
  258 WIRED / 2 NO-BACKEND-CALL / 0 broken, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `diy`: `tier: "polished"`,
  `isGenericScaffold: false`. (Transient `audit/ux-polish-honest*` files
  reverted after the run.)
