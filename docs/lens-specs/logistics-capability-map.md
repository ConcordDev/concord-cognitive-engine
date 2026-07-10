# Logistics Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("logistics"' server/domains/logistics.js
```
→ **59** macros in `server/domains/logistics.js` (1,908 lines) covering fleet
CRUD, shipment CRUD + real carrier tracking (ShipEngine/EasyPost), route
optimization (OSRM + Nominatim), carriers, rate quoting, pickups, dock
appointments, load board bidding, GPS/ELD tracking, delay-risk scoring,
VRP optimization, tender/damage records, carrier scorecards, geofencing,
freight-invoice audit/dispute, and exceptions management — plus 7 legacy
compute-on-supplied-data macros (`optimizeRoute`, `hosCheck`,
`maintenanceDue`, `complianceAudit`, `fleetReport`, `maintenanceAlert`,
`inventoryAudit`) registered at the top of the file.

`grep -c 'registerLensAction("logistics"' server/server.js` → 0 (no inline
registrations; all in the domain file).

## Frontend surface (18 files, 3,896 LOC per `grade-ux-polish.mjs`)

`concord-frontend/app/lenses/logistics/page.tsx` (483 LOC) +
`concord-frontend/components/logistics/{ShipmentTracker,RouteOptimizer,
WarehouseInventory,ShipmentsPanel,CarriersPanel,RateQuoter,PickupsPanel,
DockAppointmentsPanel,FleetVehiclesPanel,LoadBoardPanel,DeliveryProofPanel,
ShipmentEventsTimeline,VisibilityTower,LogisticsChatter,
ComplianceReportsPanel}.tsx`.

`VisibilityTower.tsx` (1,212 LOC) alone wires 20 of the 59 macros (GPS
tracking, delay-risk, VRP optimize, carrier scorecard, tender/damage
records, geofences, freight invoices/audit/dispute, exceptions dashboard).
The 9 smaller panels wire another 30 macros directly via `lensRun`. Before
this pass, **51 of 59 macros already had real, bespoke, wired UI** — this
lens's backend-to-frontend wiring was already unusually strong for this
codebase.

## The defect: a fabricated parallel generic-CRUD dashboard sitting on top
## of (and as the default landing tab for) the real macro-backed workbench

`app/lenses/logistics/page.tsx` had **two separate systems for the same
domain concepts, coexisting in one file**:

1. A real one: `TmsWorkbenchSection` (Carriers/Rates/Pickups/Docks/
   Fleet/Loads/POD/Events, all wired via `lensRun` to real macros) +
   `VisibilityTower` + dedicated `ShipmentTracker`/`RouteOptimizer`/
   `WarehouseInventory` tabs — all real, all already mounted.
2. A fabricated one: the top-level `MODE_TABS` nav (`fleet` / `drivers` /
   `shipments` / `warehouse` / `routes` / `compliance`, defaulting to
   `fleet` as the **first thing a user sees**) drove ~1,700 lines of
   `render*Tab()` functions reading from `useLensData('logistics',
   currentType, {...})` — a **generic artifact CRUD store**
   (`GET/POST/PUT/DELETE /api/lens/logistics`, `lens.list`/`create`/
   `update`/`delete` macros) that has **no relationship to any of the 59
   real `logistics.*` macros**. `SEED` was empty for every type, so on a
   fresh install this generic store starts empty and stays empty until a
   user manually creates fake "Vehicle"/"Driver"/"Shipment"/etc. records
   through its own editor modal — a parallel, disconnected data model from
   the real fleet/shipment/warehouse data the TMS workbench operates on.

This is exactly the "runs a fabricated parallel generic-CRUD system...
instead of the real macros" defect class from `CLAUDE.md`, in its most
literal form: **two Fleet tabs, two Shipment views, two Warehouse views** —
one real (already present in the same file), one fake — with the fake one
as the default landing tab.

### The dead-button consequence

The page also had a "Domain Actions" quick-action strip
(`optimizeRoute` / `hosCheck` / `maintenanceAlert` / `fleetReport` /
`complianceAudit`) wired through `useRunArtifact('logistics').mutateAsync
({ id: targetId, action })`, where `targetId = artifactId || editing ||
filtered[0]?.id` — `filtered` came from the same empty generic-CRUD store.
On a fresh install (or any install where a user never used the fake
editor), `filtered[0]?.id` is `undefined`, so `handleAction` hits
`if (!targetId) return;` and **all 5 buttons silently no-op** — the exact
"dead button gated on a permanently-empty artifact store" bug class named
in the task brief. Even when an artifact did exist, the field shapes
didn't match: e.g. `hosCheck` reads `artifact.data.drivers`, but a
generic-CRUD "Vehicle"/"Shipment" artifact has fields like `make`/`model`/
`origin`/`destination` — never `drivers` — so the macro would run against
`[]` and report nothing.

Also unsurfaced: `logistics.dashboard-summary` — a real macro that
computes exactly the KPI numbers (`totalShipments`, `inTransit`,
`onTimePct`, `vehicles`, `vehiclesInUse`, `loadsAvailable`, `dockCount`,
etc.) the page's top "Quick Stats" strip was instead computing from the
fake generic-CRUD arrays. `grep -rn "dashboard-summary" concord-frontend/`
returned zero hits before this pass.

## What changed

1. **Removed the entire fabricated generic-CRUD system.** Deleted
   `SEED`, `ArtifactType`, `useLensData`/`useRunArtifact` usage, the
   `KANBAN_COLUMNS`/`STATUS_COLORS`/`SHIPMENT_STATUSES` fake-data
   constants, the editor modal (create/edit form + `formField1..6` state),
   the detail modal, and all six `render*Tab()` functions
   (`renderFleetTab`, `renderDriversTab`, `renderShipmentsTab`,
   `renderWarehouseTab`, `renderRoutesTab`, `renderComplianceTab`) plus
   `renderDefaultGrid`/`renderTabContent` — roughly 1,900 lines of
   dead-end fabricated CRUD UI backed by nothing.
2. **Reduced `MODE_TABS` to 7 tabs that each mount a real, already-existing
   macro-backed component**: `fleet` → `FleetVehiclesPanel`, `shipments` →
   `ShipmentsPanel`, `tracker` → `ShipmentTracker`, `warehouse` →
   `WarehouseInventory`, `routes` → `RouteOptimizer`, `compliance` → new
   `ComplianceReportsPanel` (below), `map` → `MapView` now driven by real
   `fleet-vehicles-list` GPS coordinates (previously driven by the fake
   artifact store's `lat`/`lng` fields, which were never populated by
   anything real).
3. **Wired the KPI strip to `logistics.dashboard-summary`** via a
   `useQuery` + `lensRun` call — replacing the fake-array-derived
   `dashMetrics` with the real server-computed numbers.
4. **Built `components/logistics/ComplianceReportsPanel.tsx`** (new, ~340
   LOC) — a bespoke tool panel, not a generic form, that fixes the
   dead-button/field-shape bug for all 5 "Domain Actions" macros by
   pulling REAL live data and calling the macros directly via `lensRun`
   (no persisted artifact required, per the `/api/lens/run` virtual-
   artifact-from-input-body pattern):
   - **Fleet report** / **Maintenance alerts**: fetch real
     `fleet-vehicles-list`, map to the shape `fleetReport`/
     `maintenanceAlert` expect (`vehicleId`, `name`, `currentMileage`,
     `lastServiceMileage`), and run the macro on the real fleet.
   - **Compliance audit**: fetch real `shipments-list`, map to the shape
     `complianceAudit` expects, and run it on real shipments (correctly
     reports "missing documentation" for every shipment today, since
     Concord doesn't yet track shipment documents — an honest finding,
     not a fabricated one).
   - **HOS check**: `hosCheck` has no persisted driver-roster entity to
     read from anywhere in the codebase (confirmed: `grep -n "driver"
     server/domains/logistics.js` shows no CRUD macros for a driver
     entity, only the ad-hoc `logs` array `hosCheck` itself expects). It's
     designed as an ad-hoc ELD-log compliance check, not a roster lookup —
     so this tool takes a small real add/remove driver-row form (name +
     today's driving/on-duty hours) rather than fabricating drivers.
5. **Removed the `Optimize Route` quick-action button** (`optimizeRoute`,
   the legacy nearest-neighbour macro) — the `routes` tab's
   `RouteOptimizer` component already covers the same capability against
   the newer, better `route-optimize` macro (real OSRM driving distances +
   Nominatim geocoding, vs. `optimizeRoute`'s haversine-only heuristic).
   Keeping both as separate, differently-implemented UI entry points for
   the same feature would itself be a duplication.

## Macro → UI classification (post-fix)

- **DESIGNED (54 of 59):** all `shipments-*`, `carriers-*`, `pickups-*`,
  `docks-*`/`dock-appointments-*`, `fleet-vehicles-*`, `loads-*`,
  `rates-quote`, `shipment-track`, `route-optimize`, `inventory-list`,
  `gps-*`, `delay-risk-score`, `vrp-optimize`, `tender-record`,
  `damage-report`, `carrier-scorecard`, `geofence-*`, `milestones-list`,
  `freight-invoice*`, `exceptions-*`, `shipment-events`,
  `dashboard-summary` (newly wired), `hosCheck`/`fleetReport`/
  `maintenanceAlert`/`complianceAudit` (newly wired, bespoke form) — each
  reached through a dedicated, hand-built panel with its own real form,
  not a generic action array.
- **GENUINELY MISSING / DEFERRED (1):** `inventoryAudit` — depends on
  `inventoryRecords` with `systemQty`/`physicalQty`/`unitCost`, but
  `inventory-list` is intentionally empty by design
  ("`No inventory loaded. Wire a real warehouse feed...`" — see the
  macro's own `notes` field) until a real WMS/Shopify feed is connected.
  Wiring a UI for this now would mean either fabricating inventory records
  (dishonest) or building a full manual SKU-entry system before any real
  inventory source exists (out of scope for a frontend fix — this needs a
  warehouse feed integration, which is backend work). Left unwired,
  documented here rather than faked.
- **LEFT UNTOUCHED, with reason (2):** `optimizeRoute` and
  `maintenanceDue` remain registered but have no direct UI entry point.
  `optimizeRoute` is superseded by `route-optimize` (see above — kept for
  API back-compat, not worth a duplicate UI). `maintenanceDue` is a near-
  duplicate of `maintenanceAlert` (same vehicle-service-interval check,
  slightly different output shape) — `maintenanceAlert` already covers
  the capability in `ComplianceReportsPanel`; adding a second near-
  identical tool would be redundant, not a missing feature.

## Verification

- `node --check server/domains/logistics.js` → OK (backend untouched this
  pass; checked defensively since input shapes were audited).
- `cd server && node --test tests/depth/logistics-behavior.test.js
  tests/logistics-domain-parity.test.js` → **51/51 passing**, unmodified.
- `cd concord-frontend && npx eslint app/lenses/logistics/page.tsx
  components/logistics/*.tsx` → clean, 0 errors/warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors referencing
  `logistics`.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,
  "NO-BACKEND-CALL":2}` total 260 (unchanged; logistics was already WIRED
  and remains so).
- `node scripts/grade-ux-polish.mjs --honest` → logistics: `tier:
  "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.876`,
  `pillarsPresent: 5`.
