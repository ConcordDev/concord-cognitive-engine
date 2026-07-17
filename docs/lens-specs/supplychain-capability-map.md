# Supply Chain Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/supplychain.js` (603 LOC) in full — no inline
> `registerLensAction("supplychain", ...)` calls exist in `server.js` and no
> delegate libraries in `server/lib/` for this domain; the file above is the
> entire backend surface. Classification follows the Frontend Rebuild
> Program's distinction: **DESIGNED** / **GENERIC-STRIP-ONLY** /
> **UNSURFACED**.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("supplychain"' server/domains/supplychain.js`

## Backend surface — 20 macros, all real (no stubs)

Two tiers, both real: (A) 4 stateless analysis macros that operate on a
caller-supplied `artifact.data` payload (no persistence); (B) 16
`STATE.supplychainLens`-backed macros (per-user `Map`s: `shipments`,
`network`, `scenarios`, `workOrders`) that form a genuine "SAP-IBP-parity"
planning workbench (the code's own comment) — shipment tracking with ETA
drift + route-map geocoding, a supply network/BOM graph with critical-path
computation, multi-echelon inventory optimization (safety stock / reorder
point / rebalancing transfers), what-if disruption scenario simulation,
Holt-Winters seasonal forecasting, a live exception/alerts scan, a 6-stage
PO/work-order workflow, and Pareto spend analytics.

| Macro | Real result shape (key fields) | Classification (before this rebuild) |
|---|---|---|
| `leadTimeAnalysis` | avg/min/max lead time + reliability grade from order dates | **DESIGNED** — `SupplyChainActionPanel`, was raw-JSON-paste input |
| `inventoryOptimize` | EOQ + reorder point + safety stock per item | **DESIGNED** — `SupplyChainActionPanel`, was raw-JSON-paste input |
| `supplierScore` | weighted quality/delivery/price/responsiveness composite + tier | **DESIGNED** — `SupplyChainActionPanel`, was raw-JSON-paste input |
| `demandForecast` | simple linear-trend 3-period forecast | **DESIGNED** — `SupplyChainActionPanel`, was raw-JSON-paste input |
| `shipmentCreate`/`shipmentCheckpoint`/`shipmentList`/`shipmentDelete` | full shipment lifecycle with checkpoints, ETA drift, geocoded route | **DESIGNED** — `SupplyChainPlanner` "Shipment tracking" tab |
| `networkSet`/`networkGraph` | supplier→warehouse→customer node/edge graph, critical-path lead time | **DESIGNED** — `SupplyChainPlanner` "Supply network" tab |
| `multiEchelonOptimize` | per-echelon safety stock/ROP/target stock + rebalance transfer plan | **DESIGNED** — `SupplyChainPlanner` "Multi-echelon" tab |
| `scenarioSimulate`/`scenarioList`/`scenarioDelete` | disruption-modelled stockout/cost projection, primary vs. alternate source ranking | **DESIGNED** — `SupplyChainPlanner` "What-if scenarios" tab |
| `seasonalForecast` | Holt-Winters additive triple exponential smoothing, MAPE accuracy | **DESIGNED** — `SupplyChainPlanner` "Seasonal forecast" tab |
| `exceptionScan` | live critical/warning alerts across supplied inventory + real shipments + real POs | **DESIGNED** — `SupplyChainPlanner` "Exceptions" tab, now ALSO the Overview dashboard's live-exceptions panel |
| `workOrderCreate`/`workOrderAdvance`/`workOrderList`/`workOrderDelete` | 6-stage PO workflow (requisition→closed) with overdue tracking | **DESIGNED** — `SupplyChainPlanner` "PO workflow" tab |
| `spendAnalytics` | supplier/category spend breakdown + Pareto 80/20 concentration | **DESIGNED** — `SupplyChainPlanner` "Spend analytics" tab |

**No unsurfaced macros exist in this domain** — the entire 20-macro surface
was already reachable pre-rebuild. The finding this rebuild's capability
audit surfaced was different and more serious: the macros were reachable,
but **not the primary surface the user landed on**.

## 1.5 Reference-parity checklist

**Reference apps:** [SAP Integrated Business Planning (IBP)](https://www.sap.com/products/scm/integrated-business-planning.html)
control tower — the backend code's own comments explicitly target
"SAP-IBP parity" — cross-checked against general supply-chain
control-tower practice (Kinaxis/o9-class tools). Researched via web search,
2026-07-09.

**Parity statement:** the only difference should be that Concord's control
tower runs on a lens-local in-memory ledger instead of an enterprise ERP
integration — real-time visibility, KPI tracking, exception alerting, and
what-if scenario planning should all be designed, real-data features here,
exactly as SAP IBP's control tower module provides them.

| # | Checklist item (SAP IBP control tower) | Disposition | Justification |
|---|---|---|---|
| 1 | Real-time end-to-end shipment visibility | **ALREADY REAL** | `shipmentList` — live status, ETA drift, geocoded route map (`SupplyChainPlanner`) |
| 2 | KPI tracking dashboard | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS SESSION** | The 16 STATE macros existed but no view aggregated them into a single at-a-glance dashboard; new `SupplyChainOverview.tsx` (Overview destination) does this from 4 parallel real macro calls |
| 3 | Dynamic exception/alert system with severity | **ALREADY REAL** | `exceptionScan` — critical/warning severities across stockouts, late/exception shipments, at-risk suppliers, overdue POs; now surfaced on BOTH the Control Tower's Exceptions tab AND the new Overview's live-exceptions panel |
| 4 | Demand/supply/inventory balancing | **ALREADY REAL** | `multiEchelonOptimize` — safety stock, reorder point, and a real rebalance-transfer recommendation engine (surplus→deficit greedy match) |
| 5 | What-if scenario simulation for disruptions | **ALREADY REAL** | `scenarioSimulate` — 6 disruption types (port closure, supplier failure, demand spike, transport strike, material shortage) with primary-vs-alternate-source ranking |
| 6 | Supply network / BOM graph visualization | **ALREADY REAL** | `networkGraph` — tree diagram + geocoded map markers + critical-path lead time + orphan-node detection |
| 7 | Demand forecasting with seasonality | **ALREADY REAL** | `seasonalForecast` — genuine Holt-Winters additive triple exponential smoothing (not a toy linear fit), with MAPE-based accuracy grading |
| 8 | Supplier performance scorecards | **ALREADY REAL** | `supplierScore` — weighted quality/delivery/price/responsiveness composite with tiering |
| 9 | Procurement / PO workflow tracking | **ALREADY REAL** | `workOrderCreate`/`Advance`/`List` — 6-stage requisition→closed workflow with overdue flagging |
| 10 | Spend analytics (supplier/category breakdown, concentration risk) | **ALREADY REAL** | `spendAnalytics` — Pareto 80/20 concentration calculation |
| 11 | Single control-tower landing view, not a config screen | **GENUINELY MISSING (pre-rebuild) → FIXED THIS SESSION** | The page's PRIMARY surface was a generic multi-artifact-type CRUD library (`PurchaseOrder`/`Supplier`/`InventoryItem`/`Shipment`/`WarehouseRecord`/`SupplyAnalytic`/`ProcurementReq`, backed by `useLensData`'s generic DTU-artifact system) — these records were NOT the real shipments/network/work-orders above; they were a parallel, disconnected fake data model presenting invented "orders" as if they were live supply-chain state. This was the single biggest honesty gap found in this audit. Retired entirely; the real `SupplyChainPlanner`/`SupplyChainOverview`/`SupplyChainActionPanel` are now the only surfaces |
| 12 | Structured data entry, not free-text/JSON dumps | **GENUINELY MISSING (pre-rebuild) → FIXED THIS SESSION** | The 4 stateless analysis macros (`leadTimeAnalysis`/`inventoryOptimize`/`supplierScore`/`demandForecast`) were reachable only via a raw JSON-paste textarea in `SupplyChainActionPanel` — not a designed input surface. Converted to structured `field \| field \| field` line inputs consistent with the idiom `SupplyChainPlanner` already uses for its 16 macros |
| 13 | Multi-tier/enterprise ERP integration (SAP, Oracle, etc.) | **GENUINELY MISSING — HONEST, NO CHANGE NEEDED** | Concord's supply chain is a self-contained lens-local ledger, never claimed to integrate with a real ERP; no fabricated "connected to SAP" claim exists anywhere in the UI to walk back |
| 14 | Role-based collaboration (planner/buyer/analyst views) | ~~**GENUINELY MISSING — DEFERRED-SCOPED-BUILD**~~ **CLOSED (2026-07-17, `e3cc88d2`)** | The "would need a new sharing/permission layer" premise was stale — the org substrate already exists. `scScope` gates every state macro on real org membership + a derived SC role (leader/officer→planner full write, member→buyer shipments/purchasing write, apprentice→analyst read-only), stored under an `org:${id}` key namespace; omitting `orgId` is byte-identical to the per-user path. New org lifecycle macros; `orgJoin` caps self-selectable role to member/apprentice (closes a real priv-escalation gap in `joinOrganization`'s unchecked role param, without modifying that file). `world-organizations.js` reused unmodified. 25 backend + 9 frontend tests; 82/82 supplychain regression green. |

**Coverage summary:** 10 of 14 checklist items already real before this
session; 2 fixed this session (control-tower landing view promoted to
primary, JSON-paste replaced with structured inputs); 1 resolved as an
honest non-issue; 1 genuinely missing item explicitly deferred with a named
reason. **No silent gaps.**

## 2. What this rebuild changed

**Killed the fake generic CRUD library** that was the page's PRIMARY
surface: `app/lenses/supplychain/page.tsx` used to model "Orders / Suppliers
/ Inventory / Shipments / Warehouses / Analytics / Procurement" as 7
generic `useLensData`-backed DTU-artifact types (`PurchaseOrder`,
`Supplier`, `InventoryItem`, `Shipment`, `WarehouseRecord`,
`SupplyAnalytic`, `ProcurementReq`) — free-form user-entered records with
no connection whatsoever to the real `supplychain` macros above. This is
exactly the "fabricated success state presented as real data" pattern
CLAUDE.md's honest-by-construction rule prohibits: a user could type in
fake shipment records and see them rendered as if they were live supply
chain state, while the REAL shipment-tracking/network/PO substrate sat
disconnected in a footer section below. **This was the single most
important fix in this rebuild.**

**Retired the generic-scaffold dependency** (`isGenericScaffold: true` per
`audit/ux-polish-honest.json` — `importsGenericTrio` + `usesGenericBody`):
removed `ManifestActionBar`, `AutoActionStrip`, `RecentMineCard`,
`CrossLensRecentsPanel`, `LensVerticalHero`, `LensFeaturePanel`, and the
useless-when-dark `useRealtimeLens`/`LiveIndicator`/`RealtimeDataPanel`
trio (confirmed via `grep supplychain hooks/useRealtimeLens.ts` — this
domain has no `DOMAIN_EVENTS` entry, so `isLive` was always `false`; a
permanently-dark "live" indicator is its own honesty smell, removed rather
than kept as decoration).

**New `SupplyChainOverview.tsx`** — a real control-tower landing dashboard
(checklist item 2 above): 4 parallel macro calls (`shipmentList` /
`networkGraph` / `workOrderList` / `exceptionScan`) rolled into KPI tiles
(`StatTile`/`StatTileGrid` from `components/ui/`) + a live-exceptions panel
+ quick-jump cards into the Control Tower / Scorecards destinations. Honest
loading (`role="status"`), error (`role="alert"` with the real error
text), and empty (`EmptyState` with a real "open Control Tower" CTA, not a
seeded demo) states — pinned by the rewritten
`tests/supplychain-lens-states.test.tsx`.

**`SupplyChainActionPanel.tsx` input upgrade** (checklist item 12): the 4
stateless analysis macros moved from raw JSON-paste textareas to
structured `field | field | field` line inputs, matching the idiom
`SupplyChainPlanner` already established for its 16 macros. The
mint/DM/publish/agent-review bonus actions were kept unchanged (real DTU
mint, real DM send with 60s recall, real anonymized publish with 30s
recall, real agent risk-review call) — nothing about those was fake, they
were just gated behind an unusable JSON-paste primary input.

**New page shell** — 4 bespoke destinations (Overview / Control Tower /
Scorecards & Analysis / Industry Pulse) replacing the old 7-tab generic
CRUD library + buried real components. `g <letter>` keyboard shortcuts per
destination.

## Files touched

- `concord-frontend/app/lenses/supplychain/page.tsx` — rewritten
- `concord-frontend/components/supplychain/SupplyChainOverview.tsx` — new
- `concord-frontend/components/supplychain/SupplyChainActionPanel.tsx` — rewritten (structured inputs)
- `concord-frontend/tests/supplychain-lens-states.test.tsx` — rewritten to pin the new primary surface (was pinning the retired generic CRUD library's states)
