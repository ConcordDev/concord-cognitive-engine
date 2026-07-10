# energy — capability map (Frontend Rebuild Program, Wave 2 batch 5)

Reference apps: **Sense** / **Emporia Vue** (circuit-level home energy
monitoring, device disaggregation, solar/EV, utility-rate-aware scheduling)
plus the **US EIA** open-data API (real regional electricity rates + generation
mix) that the lens already integrates. This supersedes `docs/lens-specs/energy.md`
(older backend-parity doc) as the rebuild-program capability-map artifact.

## Backend macro surface (verified via grep, 2026-07-09)

`server/domains/energy.js` (`registerLensAction`, 35 macros):

consumptionAnalysis, solarEstimate, carbonFootprint, eia-electricity-rates,
eia-generation-mix, gridStatus, device-{add,list,update,delete},
reading-{log,history}, solar-{log,summary}, rate-{set,get}, bill-estimate,
goal-{set,list,delete}, usage-breakdown, top-consumers, energy-dashboard,
live-{sample,stream}, disaggregate, cost-projection, tou-{set,get,breakdown},
solar-self-consumption, usage-alerts, month-comparison, feed.

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/energy/` already had 12 files / ~2,600 LOC of
real, macro-wired UI — the lens was NOT a thin scaffold:

- `EnergyMonitorSection.tsx` — Sense-shape tab shell (`energy-dashboard` KPI
  strip + 8 tabs) that already mounted 8 fully-wired sub-panels:
  `EnergyLivePanel` (`live-sample`/`live-stream`), `EnergyUsagePanel`
  (`reading-log`/`reading-history`/`usage-breakdown`), `EnergyDevicesPanel`
  (`device-*`/`top-consumers`), `EnergyDisaggregationPanel` (`disaggregate`),
  `EnergySolarPanel` (`solar-log`/`solar-summary`/`solar-self-consumption`),
  `EnergyTouPanel` (`tou-*`), `EnergyBillingPanel` (`rate-*`/`bill-estimate`/
  `cost-projection`/`goal-*`), `EnergyInsightsPanel` (`usage-alerts`/
  `month-comparison`).
- `EiaPanel.tsx` — real US EIA electricity-rate + generation-mix lookup by
  state/sector, with Save-as-DTU.
- `EnergyActionStack.tsx` — Sense/PG&E/Tesla-shape action surface on top of a
  live EIA rate snapshot: mint a usage snapshot DTU, DM a household member the
  estimated bill, publish efficiency tips (federation pickup), run a
  chat-agent optimizer, copy CSV. Every action is a real macro/route call.
- `SolarCarbonPanel.tsx` — residential solar sizing + carbon-footprint
  calculators (`solarEstimate` + `carbonFootprint`) via the shared `CalcPanel`
  primitive.

**Correction to what a first grep suggests**: `EnergyMonitorSection` (which
already wires all 8 of the above panels) WAS mounted in `page.tsx`
(`<EnergyMonitorSection />` at the top of the body) — so none of that depth
was actually orphaned. The defect was elsewhere (see below).

## What was actually wrong (genuinely broken/generic/fake)

1. **A second, disconnected, generic-CRUD surface sat right below the real
   one.** `page.tsx` also called `useLensData('energy', 'asset', …)` and
   `useLensData('energy', 'consumption', …)` — the generic per-lens artifact
   store (`GET/POST /api/lens/energy?type=…`), completely bypassing the real
   `device-*`/`reading-*` macros that `EnergyMonitorSection` one component up
   already exercises. This rendered a fake "Assets / Consumption / Energy Mix"
   tab set with client-invented fields (`co2Avoided`, `efficiency`, a
   freehand `status` string) that no energy macro produces — a textbook
   instance of the "disconnected generic CRUD store standing in for real
   domain macros" pattern this program has retired in nearly every lens so
   far. **Removed** (~330 lines).
2. **Generic scaffold signature.** The page imported the `ManifestActionBar` +
   `AutoActionStrip` + `RecentMineCard` trio and rendered `<UniversalActions>`
   + a `LensFeedButton`/`CrossLensRecentsPanel` block that its own comment
   mislabeled "accessibility-only, never visually displayed" (only one of the
   four elements in that block was actually `sr-only`). `node
   scripts/grade-ux-polish.mjs --honest` confirmed the cap pre-change:
   `tier: "functional"`, `isGenericScaffold: true`, despite 77% bespoke LOC.
   **Removed.**
3. **Two pure-compute macros had zero UI**: `consumptionAnalysis` (meter-
   reading total/average/peak + savings-opportunity heuristic) and
   `gridStatus` (regional demand/capacity/utilization/frequency-stability
   snapshot) — no frontend reference to either prior to this rebuild.

## Reference-parity checklist (Sense / Emporia + EIA shape)

The only difference from Sense/Emporia should be device catalog depth and
metering-hardware access, nothing else in the software surface.

| Capability | Disposition | Where |
|---|---|---|
| Real-time/live power draw sampling | ALREADY REAL | `EnergyLivePanel` (`live-sample`, `live-stream`) |
| Per-device tracking + wattage/category | ALREADY REAL | `EnergyDevicesPanel` (`device-*`) |
| Top-consumers ranking / disaggregation | ALREADY REAL | `EnergyDevicesPanel`, `EnergyDisaggregationPanel` (`top-consumers`, `disaggregate`) |
| Usage history + breakdown | ALREADY REAL | `EnergyUsagePanel` (`reading-history`, `usage-breakdown`) |
| Solar production tracking + self-consumption | ALREADY REAL | `EnergySolarPanel` (`solar-log`, `solar-summary`, `solar-self-consumption`) |
| Time-of-use rate scheduling + breakdown | ALREADY REAL | `EnergyTouPanel` (`tou-*`) |
| Utility rate + bill estimate + cost projection | ALREADY REAL | `EnergyBillingPanel` (`rate-*`, `bill-estimate`, `cost-projection`) |
| Savings goals | ALREADY REAL | `EnergyBillingPanel` (`goal-*`) |
| Usage alerts + month-over-month comparison | ALREADY REAL | `EnergyInsightsPanel` (`usage-alerts`, `month-comparison`) |
| Real regional electricity rates (EIA) | ALREADY REAL | `EiaPanel` (`eia-electricity-rates`) |
| Real generation mix (EIA) | ALREADY REAL | `EiaPanel` (`eia-generation-mix`) |
| Bill snapshot mint / household DM / publish tips / agent optimizer | ALREADY REAL | `EnergyActionStack` |
| Solar-installation sizing calculator | ALREADY REAL | `SolarCarbonPanel` (`solarEstimate`) |
| Household carbon-footprint calculator | ALREADY REAL | `SolarCarbonPanel` (`carbonFootprint`) |
| Live grid carbon-intensity feed | ALREADY REAL | `LensFeedPanel` (`feed`, UK National Grid ESO) |
| Meter-reading consumption analysis (total/avg/peak/savings) | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `EnergyGridCalcPanel.tsx` (`consumptionAnalysis`) |
| Regional grid load/utilization snapshot | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `EnergyGridCalcPanel.tsx` (`gridStatus`) |
| Direct hardware CT-clamp / smart-plug pairing | GENUINELY MISSING | Deferred — Concord has no metering-hardware integration layer; the lens is software-only by design (manual/API-fed readings), matching how every other rebuilt lens is a software workbench, not a device driver |
| Automated device scheduling against live rates | GENUINELY MISSING | Deferred — would need an actuation/automation substrate Concord doesn't have for home devices; out of scope for a UI-polish batch |

Overall: this lens was already close to Sense/Emporia + EIA feature parity in
its **components/** directory (12 files, all real). The defect was entirely
in `page.tsx` — a redundant fake CRUD surface duplicating real functionality,
the generic scaffold trio, and two unsurfaced calculators. All four fixed.

## Verify gate

- `npx eslint app/lenses/energy/page.tsx components/energy/EnergyGridCalcPanel.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `tests/energy-lens-states.test.tsx` (8/8 passing, pre-existing, targets
  `EnergyDevicesPanel` directly — untouched by this rebuild and unaffected).
  No `mining`/`desert`-specific vitest files exist.
- `node scripts/verify-lens-backends.mjs` — energy stays WIRED; total
  `{"WIRED":258,"NO-BACKEND-CALL":2}` unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — energy: `tier: "polished"`,
  `isGenericScaffold: false` (was `functional` / `true`).
