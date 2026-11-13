# Logistics scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/logistics.js` (+ LiveIndicator, page.tsx). No files/DB/services modified. Code-only; not live-proven.

## Model
- `logActor(ctx)` → `ctx.actor.userId || ctx.userId || "anon"` (L771)
- `ensureLogBucket(state, key, userId)` → `Map<userId, Array>` under `STATE.logisticsLens` (L772–781)
- Domain wrapped with `guardAnonWrites` (L13) — signed-in required for writes
- `logistics` NOT in `LENS_SOCIAL_DOMAINS` (server.js:49775)
- No `_shared` bucket anywhere in logistics.js
- Existing INC66 / hz… / zuko / shp_mv4f4mhb_iuqf13: almost certainly **same QA test account** shared by testers, not cross-user. Code buckets by userId.

## LIVE badge
Socket health only (`LiveIndicator` + `useRealtimeLens('logistics')` in page.tsx:57,81). Same pattern as Nonprofit. Not a data-sharing signal.

## Verdict table

| Area | Verdict | Evidence | Side effects |
|------|---------|----------|--------------|
| Fleet (vehicles) | SAFE_PRIVATE | fleet-vehicles-{list,add,update-status,delete} L1315–1373; bucket `fleetVehicles` | Local persist only |
| Shipments CRUD | SAFE_PRIVATE | shipments-{create,get,delete,set-status,list} L785–852,544–547; bucket `shipments` | Local persist; status events → `shipmentEvents` |
| Warehouse | SAFE_PRIVATE (empty) | inventory-list L752–765 returns `items:[]`; UI has no create | No writes possible today |
| Routes | SAFE_PRIVATE (stateless) | route-optimize L646+; optimizeRoute L20; vrp-optimize L1699 | **Outbound:** Nominatim + OSRM `router.project-osrm.org` (addresses/coords leave Concord). No persist of route records |
| Compliance / HOS | SAFE_PRIVATE (compute) | hosCheck/complianceAudit/fleetReport/maintenance* analyse supplied input; ComplianceReportsPanel feeds from per-user fleet/shipments lists | No HOS roster table; form data not persisted as own entities |
| TMS carriers | SAFE_PRIVATE | carriers-{list,add,delete} L858–896 | Local; apiKey stored as `[redacted]` only |
| TMS quotes | SAFE_PRIVATE store / OUTBOUND rates | rates-quote L1096+ | **Outbound** ShipEngine/EasyPost when env keys set; else labeled estimate / not_configured. No payment |
| TMS pickups | SAFE_PRIVATE | pickups-{list,schedule,cancel} L1148–1189; `carrierNotified: false` L1173 | Does **not** contact carrier |
| TMS docks / appts | SAFE_PRIVATE | docks-*, dock-appointments-* L1230–1309 | Local |
| TMS load board | SAFE_PRIVATE (misnamed) | loads-{list,post,bid,accept-bid} L1379–1442; all in caller's `loads` bucket | Not a public marketplace; bids only against own loads |
| TMS POD | SAFE_PRIVATE | delivery-confirm, pods-list L1194–1223 | Local signature/photo/GPS record |
| TMS EDI | SAFE_PRIVATE (shape only) | shipment-events L1447–1453; UI "EDI event timeline" | **No** AS2/X12 transmission, no partner notify |
| Visibility GPS/geofences | SAFE_PRIVATE | gps-track-*, geofence-*, milestones-*, exceptions-* L1518–2140 | Local |
| Freight audit | SAFE_PRIVATE | freight-invoice-{audit,dispute}, summary L1984–2069 | Local status only; **no** payment/settlement/email to carrier |
| Tracker Track btn | BLOCK outbound | ShipmentTracker → `shipment-track` L559–637 | **Outbound** ShipEngine/EasyPost if keys present; also **writes** a shipment into user's bucket. Without keys: errors, no call. USPS_TRACKING_USERID mentioned in comments but **not implemented** in handler body |

## Keep BLOCKED
1. **Tracker → Track** (shipment-track) — may hit real carrier APIs + persist
2. **Rate quoter** live quotes (rates-quote) when SHIPENGINE/EASYPOST keys present — outbound
3. **route-optimize / RouteOptimizer** — sends stop strings to Nominatim + OSRM (public; still external)
4. Anything that would Publish/share a logistics artifact publicly, email, SMS, agent deploy, paid jobs — none found in domain writes, but LensShell Publish/share stays off per standing rules
5. Do **not** enter real tracking numbers, real account numbers, or real addresses you care about

## Test-safe (CRUD OK under constraints)
Fleet vehicles, shipments create/edit/delete/status, carriers add/delete, pickups schedule/cancel (fake confirmation #), docks + appointments, load board post/bid/accept (own board), POD confirm, GPS track init/ping, geofences create/delete/evaluate, freight invoice audit/dispute (fake $), exceptions flag/update, HOS/compliance compute with fake drivers.

Constraints:
- Titles/refs: `QA LT4 logistics 2026-11-09 <thing>`
- Fake origins/destinations/addresses/tracking #s only
- Delete fixtures afterwards (or log if no delete)
- Expect RCA-form-hotkey-steal (f/s/t/w/r/c/m/x/v) to interrupt typing
- Hotkey/typing bugs → mark BLOCKED by RCA, continue other checks

## Gaps / UI bugs (not cross-user leaks)
- Dashboard "0 shipments" vs Visibility/EDI showing `shp_mv4f4mhb_iuqf13` — likely list/source mismatch within same user bucket, ticket as functional bug
- On-Time Rate `null%` — dashboard-summary returns null when no completed+ETA set (L1472–1476)
- "Harness data looks shared" — shared QA account, not `_shared` bucket (code evidence)
- Cross-lens create broadcast leak (title/tags to all sessions) from earlier Science check still applies to generic lens.create; logistics macros use logisticsLens Maps directly — confirm separately if UI also uses generic create
- Live not proven: whether production has SHIPENGINE/EASYPOST keys set

