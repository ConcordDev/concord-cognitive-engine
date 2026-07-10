# Carpentry Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/carpentry.js` (787 LOC) in full — the entire backend
> surface for this lens (no inline registrations elsewhere; confirmed via
> grep).
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("carpentry"' server/domains/carpentry.js`

## Backend surface — 29 macros, all real

Two tiers, both real: (A) 4 stateless shop calculators
(`boardFootCalc`/`jointStrength`/`woodSelection`/`finishRecommendation`)
operating on caller-supplied input; (B) 25 `STATE.carpentryLens`-backed
trade-management macros (cut-list optimization, material takeoff →
estimate, job photo log, crew roster + dispatch calendar, per-job time
tracking, estimate→invoice + e-signature, client portal).

| Macro group | Real effect | Surfaced (before) | Surfaced (after) |
|---|---|---|---|
| `boardFootCalc`/`jointStrength`/`woodSelection`/`finishRecommendation` | shop calculator suite | DESIGNED (`CarpentryShop.tsx`) | DESIGNED — unchanged, already real |
| `cutListOptimize` | first-fit-decreasing bin packing → boards needed + waste % | DESIGNED (`JobOps.tsx`) | DESIGNED — unchanged |
| `materialTakeoff` | line items → priced estimate (material+waste+labor+overhead+margin) | DESIGNED (`JobOps.tsx`) | DESIGNED — unchanged |
| `photoLogAdd`/`List`/`Delete` | before/during/after job photo log | DESIGNED (`JobOps.tsx`) | DESIGNED — unchanged |
| `crewAdd`/`List`/`Remove`, `scheduleAdd`/`List`/`Update`/`Delete` | crew roster + dispatch calendar | DESIGNED (`JobOps.tsx`) | DESIGNED — unchanged |
| `timerStart`/`Stop`, `timeEntryAdd`/`List`/`Delete` | per-job time tracking + labor costing | DESIGNED (`JobOps.tsx`) | DESIGNED — unchanged |
| `estimateToInvoice`, `invoiceList`/`MarkPaid`, `signEstimate` | estimate → invoice conversion + e-signature | DESIGNED (`JobOps.tsx`) | DESIGNED — unchanged |
| `portalCreate`/`View`/`List`/`Respond`/`UpdateProgress` | shareable client portal (approve estimate, view progress) | DESIGNED (`JobOps.tsx`) | DESIGNED — unchanged |

**All 29 macros were already DESIGNED** with real, bespoke UI in
`CarpentryShop.tsx` and `JobOps.tsx` before this session — the backend
depth here was never the problem.

## 1.5 Reference-parity checklist

**(a) Reference apps:** [Houzz Pro](https://www.houzz.com/pro) /
[Buildertrend](https://buildertrend.com) (trade-management: estimates,
scheduling, time tracking, client portals) and
[Sawpipes](https://www.sawpipes.com)-style woodworking calculators (board
feet, joint strength, cut optimization). Both named directly in the
components' own header comments and independently plausible as the
category leaders for a trade-management + shop-calculator hybrid.

| # | Checklist item | Disposition |
|---|---|---|
| 1 | Board-foot / lumber calculator | ALREADY REAL | `boardFootCalc` |
| 2 | Joint-strength guide | ALREADY REAL | `jointStrength` |
| 3 | Wood species selection guide | ALREADY REAL | `woodSelection` |
| 4 | Finish recommender | ALREADY REAL | `finishRecommendation` |
| 5 | Cut-list / lumber-yield optimization | ALREADY REAL | `cutListOptimize` — genuine first-fit-decreasing bin packing, not a placeholder |
| 6 | Material takeoff → priced estimate | ALREADY REAL | `materialTakeoff` |
| 7 | Crew roster + dispatch calendar | ALREADY REAL | `crewAdd`/`scheduleAdd` etc., real `TimelineView` |
| 8 | Per-job time tracking with live running timers | ALREADY REAL | `timerStart`/`Stop`, polls every 30s |
| 9 | Before/during/after job photo log | ALREADY REAL | `photoLogAdd`/`List` |
| 10 | Estimate → invoice conversion + e-signature | ALREADY REAL | `estimateToInvoice`, `signEstimate` |
| 11 | Shareable client portal (approve estimate, track progress) | ALREADY REAL | `portalCreate`/`portalRespond`/`portalUpdateProgress` |
| 12 | The page composes this real depth without a disconnected generic layer sitting in front of it | **GENUINE DEFECT → FIXED THIS SESSION** | See below |

**Coverage summary:** all 11 substantive checklist items were already real
before this session. The one real defect was structural, not a missing
macro: item 12.

## 2. What this rebuild changed

**Removed a disconnected generic-CRUD shell wrapping already-real depth.**
`app/lenses/carpentry/page.tsx` (previously 813 LOC) wrapped `JobOps` +
`CarpentryShop` in a generic `MODE_TABS` artifact-CRUD store — 8 tabs
(Job/Estimate/CodeRef/Material/Client/Invoice/Inspection/Certification)
backed by `useLensData<TradeArtifact>('carpentry', activeArtifactType,
{seed:[]})` / `useRunArtifact('carpentry')`, the domain-agnostic
`/api/lens/carpentry` artifact store — **not the carpentry macro system**.
This generic layer:
- Had its own separate "Job"/"Invoice"/etc. records with **no relationship**
  to the real jobs/invoices `JobOps` already managed via the real macros
  (an arbitrary free-text `jobId` in the real time-tracker never lined up
  with a generic-store "Job" artifact's id).
- Exposed a Zap-icon "Activate" button calling `runAction.mutateAsync({id,
  action: 'analyze'})` — the generic three-verb (analyze/generate/suggest)
  action every lens domain gets for free, wired to nothing
  carpentry-specific, sitting via `<UniversalActions domain="carpentry"
  artifactId={items[0]?.id} compact />` right next to the real, designed
  `JobOps`/`CarpentryShop` panels.
- Also rendered `<ManifestActionBar />`, an auto-generated button wall
  derived from the lens manifest's `actions` array — redundant given every
  real macro already had a dedicated, hand-built control inside `JobOps`/
  `CarpentryShop`.

This is the exact "real macro reached only through an auto-generated
button wall standing in front of already-real depth" pattern CLAUDE.md's
zero-generic-tendencies invariant names as a process failure, not a lesser
issue than fabricated data — the generic CRUD tabs weren't fabricating
numbers (they were real, persisted artifact-store records), but they were
a parallel, disconnected data model duplicating what the real engine below
already did properly.

**Fix:** rewrote `page.tsx` down to a direct composition — header, then
`JobOps` (trade job management), `CarpentryShop` (calculator suite),
`WoodSpeciesReference` (live Wikipedia species lookups) — with no generic
artifact store, no `ManifestActionBar`, no `UniversalActions`. Kept the
standard discovery sentinels (`RecentMineCard`/`AutoActionStrip`/
`CrossLensRecentsPanel`, `hideWhenEmpty`) since they sit alongside real
bespoke depth rather than substituting for it.

`grade-ux-polish.mjs --honest` before this session already reported `tier:
polished` (the grader's bespoke-ratio heuristic didn't catch this case
because `JobOps`+`CarpentryShop` are large enough that the generic wrapper
around them didn't tip the ratio) — this is a real instance of the false-negative
risk CLAUDE.md warns about: "the grader can have false negatives; a genuine
violation is still a violation even if not caught." After the fix,
`importsGenericTrio: false` (was previously showing `true` due to the
`ManifestActionBar` import) and the generic artifact-store imports
(`use-lens-data`, `use-lens-artifacts`) are gone entirely.

## Files touched

- `concord-frontend/app/lenses/carpentry/page.tsx` — full rewrite, removed
  the generic artifact-CRUD shell + `ManifestActionBar` + `UniversalActions`
- `concord-frontend/tests/carpentry-lens-states.test.tsx` — rewritten from
  a generic-CRUD-state contract to a real-engine composition contract
  (pins that `JobOps`/`CarpentryShop`/`WoodSpeciesReference` mount, and
  that the generic scaffold does not come back)
- No backend changes — `server/domains/carpentry.js` was already complete
