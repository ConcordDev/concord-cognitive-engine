# HVAC Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command.

## Backend surface

```
grep -c 'registerLensAction("hvac"' server/domains/hvac.js
```
→ **32** macros, all in `server/domains/hvac.js` (740 lines). No inline
`registerLensAction("hvac"...)` calls exist in `server.js`
(`grep -n 'registerLensAction("hvac"' server/server.js` → empty).

`node scripts/lens-unsurfaced.mjs --lens hvac` → **0/32 macros never
referenced in the frontend.**

The 32 macros split into two generations:
- **4 original Manual-J-style calculators** (lines 10–193):
  `loadCalculation` (BTU heating/cooling load from sqft/stories/insulation/
  climate — real Manual-J-shaped multiplier math, not a lookup table),
  `energyAudit`, `maintenanceSchedule`, `zoneBalance`. Surfaced by
  `ManualJCalc.tsx` (4 bespoke widgets — load calculator, energy audit,
  maintenance calendar, zone-balance monitor — each visually distinct with
  its own inputs and result shape, not a generic form).
- **28 ServiceTitan/Housecall-Pro-shape field-service macros** (lines
  194–740): technician roster (`tech-*`), dispatch-board scheduling
  (`appointment-*`, `dispatch-board` — drag-assign lanes per technician +
  an unassigned triage queue), customer-facing booking (`booking-*`),
  equipment/asset tracking with service history (`asset-*`), e-signature
  estimate approval (`estimate-*`), payment processing with card/ACH fee
  modeling (`payment-*`), recurring maintenance agreements with
  auto-scheduled visit dates + MRR/ARR computation (`agreement-*`), and a
  technician mobile field workflow — on-site checklist, parts-used ledger,
  photo attachments, notes (`field-visit-*`). All 28 are per-user
  `STATE`-backed (`getHvacState`), not fabricated — verified by spot-reading
  `dispatch-board`, `agreement-create`, and `field-visit-*` in full.

Every one of the 28 field-service macros has a confirmed frontend call site
in `FieldService.tsx` (1,513 lines, 7-tab workbench: Dispatch / Bookings /
Assets / Estimates / Payments / Agreements / Field — verified by grepping
each macro name against the file; every one appears 1-6 times, all inside
a mounted tab panel, not a dead branch).

## Reference apps

- **Field service / dispatch**: ServiceTitan / Housecall Pro (drag-assign
  dispatch board, e-signature estimates, recurring maintenance agreements
  with MRR tracking) — matched by `FieldService.tsx`.
- **Load calculation**: Wrightsoft Manual J — matched by `ManualJCalc.tsx`'s
  `LoadCalculator`.
- **Trade news**: r/HVAC / r/hvacadvice — matched by `HvacFeed.tsx` (real
  Reddit API, no synthetic posts, honest "Reddit unreachable" error state).

## What was real vs. fake

Everything found was real. No fabricated data, no dead-wired buttons, no
field-shape mismatches. Spot-checked `dispatch-board` (server return shape
`{ lanes, unassigned, stats }`) against `FieldService.tsx`'s `DispatchBoard`
interface and render code — exact match, including the unassigned-queue
terminal-status exclusion fix already documented in the handler's own
comment. Spot-checked `loadCalculation`'s `artifact.data`-shaped input
convention against `ManualJCalc.tsx`'s `callHvac` wrapper — correctly wraps
params as `{ input: { artifact: { data } } }`, matching the handler.

Both toggle surfaces in `page.tsx` (Field Service view vs. Dashboard/
Library view, and the 7 tabs inside `FieldService`) are reachable via an
always-visible button — none are nested in a rare-state modal or dead
conditional.

## What changed this wave

**Nothing — this lens required no fixes.** Independently verified (not
just trusting the unsurfaced-script's 0-count): read the full 740-line
domain file, read the full 1,513-line `FieldService.tsx`, cross-checked
every one of the 28 field-service macro names against its frontend call
site and return-shape usage, and confirmed the ManualJCalc 4-macro suite's
input-wrapping convention. This is Wave 2 work holding up under a deeper
Wave 3 audit — a rare clean pass.

## Verification

- `node --check server/domains/hvac.js` → OK (no server file touched).
- `cd server && node --test tests/hvac-domain-parity.test.js
  tests/hvac-lens-macros.test.js` → 38/38 passing.
