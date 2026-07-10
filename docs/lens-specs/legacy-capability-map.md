# Legacy lens — capability map (Wave 2 batch 7, Docs/B2B SaaS archetype)

## What "legacy" means here (checked against the domain file, not assumed)

Per instructions, the domain file was read before assuming what "legacy"
means in Concord's context. `server/domains/legacy.js`'s own header comment
is explicit: **"Domain actions for legacy system management: technical debt
computation, migration readiness assessment, and risk mapping."** This is a
SonarQube/CAST-Highlight-class legacy-*code*-modernization tool, not a
generic "legacy" concept.

The pre-existing frontend page had drifted from that: its primary surface was
a fabricated **"400-year vision planner"** — a founder-vision timeline with a
hardcoded `Vision Horizon: 400` stat, a `bioAge` figure that fell back to a
literal `340` when no data existed, and paragraph copy about "organism health"
and "homeostasis levels" that maps to nothing in the domain file at all. This
whole surface was driven by a generic per-user artifact type (`"milestone"`)
with zero connection to any of the 14 real macros below. Retired.

The page also carried a genealogy/ancestry Reddit feed (r/Genealogy,
r/AncestryDNA, r/FamilyHistory) as a bottom-of-page community panel. The feed
itself pulled real live data (not fabricated), but it has no connection to
legacy-system modernization — a leftover from a looser reading of the lens
name. Removed for domain-identity clarity (a lens for aging codebases should
not read as a genealogy tool).

## Backend macro surface

`server/domains/legacy.js` — 14 macros:

| Macro | Status before | Status after |
|---|---|---|
| `technicalDebt` | designed but reachable only via the fabricated milestone flow (would always report "No modules to analyze" since a milestone artifact never carries a `modules` array) | DESIGNED — new `PortfolioAssessment` component, real editable module rows |
| `migrationReadiness` | same dead-end | DESIGNED — same component, System/Modules tab |
| `riskMap` | same dead-end | DESIGNED — same component, Risk Map tab |
| `scanCodebase` / `listCodebases` / `deleteCodebase` | ALREADY REAL — `CodebaseScanner` | unchanged |
| `getCodebase` | BACKEND-CAPABLE-BUT-UNSURFACED — no direct UI caller (the scanner reads the codebase's fields off `scanCodebase`'s own return + the analysis macros' `codebaseId` lookups, so a raw `getCodebase` fetch was never needed) | Disposition: honest — the capability is redundant given the existing flow, not missing |
| `dependencyGraph` / `hotspotRanking` / `migrationRoadmap` / `modernizationROI` / `cloudReadiness` | ALREADY REAL — `CodebaseScanner` analysis tabs | unchanged |
| `recordDebtSnapshot` / `debtTrend` | ALREADY REAL — `CodebaseScanner` Debt Trend tab | unchanged |

## Reference-parity target

**SonarQube** / **CAST Highlight** — the two real tools this lens is built to
match. Both offer two complementary workflows:
1. Ingest real source, derive metrics (complexity, duplication, dependency
   graph, hotspots) automatically.
2. A rapid **portfolio-level assessment** for systems reviewed without full
   source access — an architect enters what's already known (criticality,
   bus factor / knowledge concentration, incident history, dependency age)
   and gets the same debt/readiness/risk scoring.

### Checklist

| Capability | Disposition |
|---|---|
| Ingest real source files, derive LOC/complexity/language mix | ALREADY REAL — `CodebaseScanner` |
| Dependency graph with cycle detection + fan-in/out hotspots | ALREADY REAL — `CodebaseScanner` Dependency Graph tab |
| Churn × complexity hotspot ranking | ALREADY REAL — `CodebaseScanner` Hotspots tab |
| Sequenced migration roadmap with effort estimates | ALREADY REAL — `CodebaseScanner` Migration Roadmap tab |
| Rewrite-vs-refactor-vs-retire ROI model | ALREADY REAL — `CodebaseScanner` Modernization ROI tab |
| 12-factor-style cloud-readiness scoring | ALREADY REAL — `CodebaseScanner` Cloud Readiness tab |
| Debt trend over time (snapshots + projection) | ALREADY REAL — `CodebaseScanner` Debt Trend tab |
| Rapid portfolio assessment without source access (technical debt formula from known metrics) | GENUINELY MISSING before this pass (macro real, no real UI); DESIGNED after this pass — `PortfolioAssessment`, Technical Debt tab |
| Migration-readiness scoring from a manually-described system map (dependencies/APIs/data stores) | Same — DESIGNED after this pass, Migration Readiness tab |
| Risk mapping — criticality × bus factor × incident history | Same — DESIGNED after this pass, Risk Map tab |
| 400-year founder-vision timeline / bioAge projection | GENUINELY MISSING as a real backend concept — this was fabricated frontend content with no backing macro. Honest disposition: removed, not relabeled (nothing here maps to a real legacy-system-modernization capability; there is no "founder vision" macro in `legacy.js` to relabel it as). |

## What was fixed

1. Retired the fabricated 400-year vision / bioAge / "Founder Intent"
   section — hardcoded `400` horizon, a `bioAge` fallback literal of `340`,
   and narrative copy about organism health with no backing computation.
2. Retired the generic-CRUD `"milestone"` artifact type it was built on
   (unrelated to any of the 14 real macros) and the "Legacy Analysis" button
   row that called `technicalDebt`/`migrationReadiness`/`riskMap` against
   that artifact — every click was structurally guaranteed to return "no
   modules/system/components to analyze" because a milestone entry never
   carries the shape those formulas need.
3. Built `components/legacy/PortfolioAssessment.tsx` — a real, hand-built
   multi-row form (add/remove module or component rows with named fields:
   LOC, complexity, test coverage, dependency age, duplicate ratio,
   criticality, knowledge holders, incident history) driving the three
   formula macros directly via `lensRun`. No JSON paste.
4. Removed the off-topic genealogy/ancestry Reddit panel (real external data,
   but zero connection to legacy-system modernization).
5. Removed the generic auto-discovered action bar and the generic capability
   list that were still mounted on the page (redundant given the bespoke
   scanner + assessment tool now present).
6. Rewrote the header copy to describe what the lens actually does
   (SonarQube/CAST-Highlight-class legacy code modernization), replacing the
   "400-year vision planner" framing.

## Verify gate

- `npx eslint` on the touched files: clean.
- `npx tsc --noEmit -p .`: 0 errors project-wide.
- No lens-specific vitest file exists for `legacy` — noted, not invented.
- `node scripts/verify-lens-backends.mjs`: `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 — unchanged; `legacy` stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest`: `legacy` → `tier: "polished"`,
  `isGenericScaffold: false`.
