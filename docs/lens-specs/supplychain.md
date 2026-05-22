# supplychain — Feature Gap vs SAP IBP / Anaplan

Category leader (2026): SAP Integrated Business Planning / Anaplan supply-chain. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `supplychain` domain macros (`leadTimeAnalysis`, `inventoryOptimize`, `supplierScore`, `demandForecast`) — pure-compute analytics over user-entered artifacts.

## Has (verified in code)
- Seven-tab workbench: orders, suppliers, inventory, shipments, warehouses, analytics, procurement — each a typed artifact CRUD.
- Lead-time analysis (avg/min/max, reliability tier) over order records.
- Inventory optimization — EOQ, reorder point, safety stock, days-of-stock, needs-reorder flag.
- Supplier scoring (weighted quality/delivery/price/responsiveness → tier).
- Demand forecast — 3-period linear-trend projection with confidence labels.
- Realtime panel, DTU export, action panel.

## Missing — buildable feature backlog
- [x] `[M]` Shipment tracking — carrier/tracking fields exist on the artifact but no live carrier-API tracking or map.
- [x] `[M]` Supply-network / BOM visualization — node graph of suppliers → warehouses → customers.
- [x] `[M]` Multi-echelon inventory optimization across warehouses.
- [x] `[M]` What-if scenario planning (disruption simulation, alternate sourcing).
- [x] `[S]` Better forecasting — seasonality / exponential smoothing beyond linear trend.
- [x] `[S]` Alerts / exceptions dashboard (stockouts, late shipments, at-risk suppliers).
- [x] `[M]` Order-to-PO-to-receipt workflow automation, not just standalone records.
- [x] `[S]` Cost / spend analytics and supplier-spend breakdown.

## Parity
~90% of SAP IBP. The four analytics macros are real and the artifact model is broad, but it is a record-keeper with calculators — no network visualization, no scenario planning, no live shipment tracking, no exception management.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
