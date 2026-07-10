# lab — Capability Map (Wave 2 rebuild, Space/lab-science archetype)

Reference apps: **Benchling** (ELN + LIMS — notebook, inventory, protocol
library, plate designer, instrument-run import, construct registry, QC
charting) and **LabWare LIMS** (sample tracking, chain-of-custody,
instrument-result import, audit trail). This lens targets a LabWare/Benchling
-shaped surface, not a research-paper reader.

Backend: `server/domains/lab.js` — 24 registered `lab.*` macros.

## Pre-rebuild audit finding

Before this pass, `node scripts/grade-ux-polish.mjs --honest` classified `lab`
as `tier: "functional"` with `isGenericScaffold: true` (`honestCapped: true`).
The cause was **not** a thin/fake page — reading `app/lenses/lab/page.tsx`
(532 LOC) and `components/lab/ELNWorkbench.tsx` (901 LOC, pre-rebuild) in full
showed a genuinely deep, purpose-built LIMS workbench already wired to 23 of
the 24 macros. The scaffold flag was tripped by the page **also** mounting
`<UniversalActions domain="lab" .../>` (an auto-discovered macro-button wall)
and a collapsible `<LensFeaturePanel lensId="lab" />` (a generic capability
list) alongside the real, designed workbench — exactly the "generic body on
top of real depth" pattern `CLAUDE.md` §3 calls out as a process failure in
its own right, even when the underlying macro is real and reachable some
other way.

## Capability checklist

| Capability (LabWare/Benchling parity) | Macro(s) | Status | Disposition |
|---|---|---|---|
| Electronic lab notebook (rich entries, revisions, witness/sign workflow) | `notebook-create/-list/-update/-sign` | ALREADY REAL | `ELNWorkbench.tsx` NotebookTab — full CRUD + witness/sign UI, signed entries lock. |
| Reagent inventory (lot/vendor/freezer location, expiry + low-stock alerts) | `inventory-add/-list/-consume/-remove` | ALREADY REAL | InventoryTab — stat tiles (expired/expiring/low-stock) + consume ±. |
| Protocol / SOP library with step-by-step run mode | `protocol-create/-list/-run` | ALREADY REAL | ProtocolsTab — checklist run mode with per-step timing/critical flags. |
| **Protocol versioning** (revise an SOP, archive prior version) | `protocol-revise` | **WAS BACKEND-CAPABLE-BUT-UNSURFACED** | **Fixed this pass** — added a "Revise" action per protocol that edits steps and publishes v(n+1), archiving the prior version to history (`ELNWorkbench.tsx` ProtocolsTab). |
| Plate/well layout designer (96/384-well assay maps) | `plate-design/-list` | ALREADY REAL | PlatesTab — click-to-paint wells by role (sample/standard/blank/control). |
| Instrument-run import (CSV → parsed records + summary stats) | `run-import/-list` | ALREADY REAL | RunsTab — CSV paste, numeric-column summary, `ChartKit` line chart. |
| Sequence/construct registry (plasmid/gene/primer, GC%, ORFs, motif search) | `construct-register/-list/-analyze` | ALREADY REAL | ConstructsTab. |
| QC trend / Levey-Jennings control charts + audit trail | `qc-trend` | ALREADY REAL | QCTrendTab — ±1/2/3 SD bands, out-of-control detection, audit trail list. |
| Calibration curve fitting (linear/quadratic/4PL) | `calibrationCurve` | ALREADY REAL | "Lab Analysis" panel in `page.tsx` (`RealityExplorerSection`). |
| QC statistical analysis on assay runs | `qcAnalysis` | ALREADY REAL | Same panel. |
| Sample chain-of-custody tracker | `sampleTracker` | ALREADY REAL | Same panel. |
| Experiment (DOE) design helper | `experimentDesign` | ALREADY REAL | Same panel. |
| Growth-organ experiment sandbox (bespoke to this app, not a LIMS feature) | n/a (`lens/experiment` generic artifact) | ALREADY REAL | Top-of-page code sandbox with ⌘⏎ run / ⌘\ clear / experiment replay. |
| Barcode / 2D-barcode label printing for samples & reagents | none | GENUINELY MISSING | No backend macro generates label artifacts. Deferred — would need a new `lab.print-label` macro plus a physical-printer or PDF-label target; out of scope for a frontend-only rebuild pass. |
| Direct instrument integration (vs. CSV paste/upload) | none | GENUINELY MISSING | `run-import` is CSV-only by design (`server/domains/lab.js`); live instrument drivers are a hardware-integration project, not a UI gap. Deferred, undocumented as a near-term goal. |
| Multi-user lab roles/permissions (PI/tech/guest tiers) | none | GENUINELY MISSING | The lab domain scopes all state per-actor (`labActor(ctx)`); there's no shared-lab multi-role model. Deferred — would need a new permissions layer, not a lens-page fix. |

## What changed this pass

1. Removed `<UniversalActions domain="lab" ...>` and the collapsible
   `<LensFeaturePanel lensId="lab" />` from `app/lenses/lab/page.tsx` — both
   are the generic action-wall/capability-list scaffold the "zero generic
   tendencies" invariant flags, and were fully redundant here: every macro
   they could reach is already reachable through a real, purpose-built panel
   (`ELNWorkbench` or the Lab Analysis panel).
2. Closed the one real coverage gap found in the audit: `protocol-revise`
   (SOP versioning) had a full backend implementation (history array,
   version increment) but no UI path. Added a "Revise" control to each
   protocol card in `ELNWorkbench.tsx`'s ProtocolsTab.
3. Left everything else untouched — `ELNWorkbench.tsx`, the Adjacent Reality
   Explorer / Lab Analysis panel, and `ArxivLabFeed.tsx` were already real,
   designed, macro-backed surfaces with no fabricated data and no generic
   button walls.

## Verify gate results

- `npx eslint app/lenses/lab/page.tsx components/lab/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (see PR/commit notes for
  the exact run; shared with the materials verify pass).
- No lab-specific vitest file exists under `concord-frontend/tests` or
  `**/*.test.tsx` (`grep -rl lab concord-frontend/tests` finds only an
  unrelated in-world "crafting material" badge test) — noted honestly rather
  than skipped silently.
- `node scripts/verify-lens-backends.mjs` — `lab` still reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `lab` now
  `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false`.
