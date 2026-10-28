# Frontier Lens — Capability Map (first written HANDOFF-3 batch L15b, 2026-10-28)

> Frontier has no single backend domain and had no capability map
> before this pass. This map records what the lens actually is, from
> the code, so future passes don't have to re-derive it.

## Architecture

Frontier is a **destination shell over ten "frontier engine"
surfaces**, not a domain of its own:

- The engine registry is `concord-frontend/lib/frontier-engines.ts`
  — **10 engines, all `built: true`** (the only `built: false` in
  the file is a doc comment). Each engine renders a real
  Compute/Verify panel from `concord-frontend/components/frontier/panels/`
  (MaterialsDegradation, Fsi, SafetyEnvelope, QecDecoder,
  ModelChecker, Consensus, MarketEquilibrium, ConstantTime,
  Paillier, SpikingNetwork). `UnbuiltEnginePanel` remains as the
  honest fallback for any future engine registered without a panel.
  (The page header comment that once said "seven render
  UnbuiltEnginePanel" was stale and is corrected in this batch.)
- The panels compute by calling **solver-domain macros directly**
  through `/api/lens/run` — domains seen in the panels include
  `markets`, `mesh`, `sim`, `detectors`, `audit`, `quantum`. There
  is no `frontier` domain and no `registerLensAction("frontier", …)`.
- Separately, `server/domains/research-frontier.js` registers five
  **capabilities** (not lens actions) at module load —
  `research.filter`, `research.invoke`, `research.findings`,
  `research.pending`, `research.get` — through the capability
  registry; its `registerResearchFrontierActions` export is a stub
  returning `{ registered: 0 }` by design.

## Verification performed (2026-10-28, main 02910bbb)

- Every distinct action name the frontier panels dispatch (12:
  including `mixedNash`, `replicatorDynamics`,
  `modelCheckRoyaltyCascade`, `modelCheckLedgerConservation`,
  `spikingNetworkSimulate`, `spikingSTDPLearn`, `qecLatticeInfo`,
  `consensusAppend`, `consensusEquivocation`, `consensusMergeRemote`,
  `equilibriumAnalysis`, `run`) resolves to a real server
  registration. Note `detectors.run` registers through a local
  `register(...)` alias in `server/domains/detectors.js`, not the
  literal `registerLensAction(` call — grep for both shapes before
  calling an action unregistered.
- The page's own routing tests (`app/lenses/frontier/page.test.tsx`)
  pin: default engine mounts, built-engine tabs swap panels, and an
  unbuilt registration would render the honest unbuilt state.
- Panel-level FE tests exist beside each panel
  (`components/frontier/panels/*.test.tsx`).

## Shipped in this batch

- The concept's serif headline — "The beam, {username}" — as the
  page h1 (`data-testid="frontier-greeting"`,
  `tests/frontier-greeting.test.tsx`). The active engine's name,
  previously the h1, moves to the eyebrow ("Frontier · {engine}"),
  so no context is lost.
- The stale page-header comment about unbuilt engines, corrected.

## Known residuals (not this batch)

- The page header's `DTUExportButton` receives a literal `{}`
  payload — one instance of the platform-wide export-button
  empty-data item already queued in the remaining-work audit.
