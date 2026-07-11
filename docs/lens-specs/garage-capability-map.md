# Garage lens — capability map (backfill, 2026-07-11)

## What this lens actually is

A vehicle fleet-management app over the `garage` domain
(`server/domains/garage.js`, 183 LOC, 8 macros, all thin delegations to
`server/lib/world-vehicles.js`) that browses/inspects/spawns vehicles in
the `world_vehicles` table (migration `177_world_vehicles.js`, extended by
`203_vehicle_tuning.js`; kinds: `cart`/`boat`/`canal_taxi`) — and
deliberately does **not** attempt to implement driving in a 2D page,
honestly handing that off to the 3D world lens instead.

This lens was rebuilt in an earlier wave of the Frontend Rebuild Program
(commit `2f9ed5f2`, "feat(garage): rebuild as fleet management app, honest
world-owned bridge for driving", Phase 3 Wave 1, 2026-07-09) — before the
`docs/lens-specs/*-capability-map.md` doc convention existed. This doc
backfills that gap against the current code.

**Frontend:**
- `concord-frontend/app/lenses/garage/page.tsx` — 425 LOC. Two-tab scope
  switcher (World / Mine), kind filter, sortable `DataTable`
  (icon/owner/capacity/fare/position columns), `StatTileGrid` counts by
  kind, a spawn depot with kind-select + async dispatch feedback
  (loading/success/error via `useMacroDispatchFeedback`), row-click-driven
  inspector drawer, world-scoping via the `concordia:activeWorldId`
  localStorage hint.
- `concord-frontend/components/garage/VehicleInspectorPanel.tsx` (197 LOC)
  — per-vehicle detail drawer: condition bar, live occupancy status dot,
  copy-id, and the same world-lens handoff banner as the page.

**Backend macro registrations** (`server/domains/garage.js`):
`garage.list` (:49, world-fleet read), `garage.mine` (:62, owner-scoped
read), `garage.get` (:89, single vehicle + live `occupantCount`),
`garage.spawn` (:130) / `garage.create` (:138, alias of `spawn` — the
manifest's generic-verb convention), `garage.mount` (:144),
`garage.dismount` (:156), `garage.move` (:170).

## Findings — verify pass, no defect

**Driving-bridge is a real, honest handoff — not a faked in-page driving
UI.** `page.tsx` renders an explicit banner: "This page manages your
fleet — browsing, inspecting, and spawning. Boarding, driving, and parking
a vehicle happen live in the 3D world: walk up to one and press `E`," with
a link to `/lenses/world`. `VehicleInspectorPanel.tsx` repeats the same
pattern per-vehicle. The `mount`/`dismount`/`move` macros exist, are
tested, and work — but are consciously left uncalled by this lens; the
actual in-world driving path lives in `concord-frontend/lib/world-lens/
vehicle-renderer.ts` + `vehicle-system.ts` +
`components/concordia/hud/VehicleHUD.tsx`, which this page's header
comment cites as evidence rather than duplicating. No
`setInterval`/fake-progress driving simulation anywhere in this lens.

**Wiring cross-check**: `page.tsx` calls `garage.list`, `garage.mine`,
`garage.spawn`; `VehicleInspectorPanel.tsx` calls `garage.get`. Zero
frontend callers for `garage.create` (intentional generic-verb alias, no
separate control needed), `garage.mount`, `garage.dismount`, `garage.move`
— all three explicitly documented as world-owned (driven by the 3D
world's real-time interaction loop, not this page). This is a deliberate,
documented disposition matching the historical claim exactly, not an
oversight.

**Fabricated data**: none. The only `grep` hit for "fake" across both
files is a code comment describing what the page deliberately avoids
doing. All rendered fields trace to real macro-response shapes.

**Generic-scaffold check**: clean — bespoke fleet-browser UX, no
`ManifestActionBar`/`AutoActionStrip`/`UniversalActions` scaffold.

**Historical-claim verification**: confirmed by commit `2f9ed5f2`:
+554/-123 LOC across the two frontend files, adding `garage.mine` as a
previously-uncalled macro, the new `VehicleInspectorPanel`, and the
explicit "driving lives in the 3D world, not here" bridge copy. Backend
`garage.js` was untouched by this commit (last touched earlier in
`6f439d9e`) — the rebuild was frontend-only, wiring existing macros rather
than adding backend surface.

**Overall verdict**: fully wired, no defect. All 8 macros are either
called or deliberately/documented as world-owned; the driving-bridge is a
real, honest handoff (a link + explicit copy, not a fake in-page driving
control); no fabricated data; UI is bespoke fleet-management, not generic
scaffold. The lens matches its historical one-line description precisely.

## Verification (run directly, 2026-07-11)

- `grep -n "registerLensAction(\"garage\"\|register(\"garage\"" server/domains/garage.js server/server.js` — 8 macros registered at `server/domains/garage.js:49,62,89,130,138,144,156,170`; none registered inline in `server.js`.
- `wc -l server/domains/garage.js` — 183.
- Backend test found: `server/tests/garage-domain-macros.test.js` (198 LOC) — drives each of the 8 macros against a real in-memory sqlite DB, asserting spawn persists, list/mine reflect it, get returns the full row, mount/dismount mutate occupancy.
- `node --test server/tests/garage-domain-macros.test.js` — **all passing**.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (documentation-only pass, no code touched).
- `node scripts/grade-ux-polish.mjs --honest` then inspected `audit/ux-polish-honest.json` for the `garage` entry — `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward (`git checkout -- audit/`).
