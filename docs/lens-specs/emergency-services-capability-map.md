# emergency-services — capability map (Frontend Rebuild Program)

Reference systems: **Tyler Technologies / CentralSquare-style CAD** (computer-
aided dispatch — incident intake, unit status boards, live map, priority
queueing, dispatch lifecycle) and **NIMS/ICS-style incident-command tooling**
(readiness rollups, response-time analytics, alerting). No consumer rival
exists at this category; content fills via a free public feed (USGS
earthquakes) + user-authored incidents/units by design, so this scores
*feature* parity against a professional CAD shape, not content volume. This
supersedes `docs/lens-specs/emergency-services.md` as the rebuild-program
capability-map artifact — that doc verified the backend macro surface and the
CAD console honestly, but predates the audit below, which found the *page*
wrapping that real backend in a disconnected fake surface.

## Backend macro surface (verified via read of `server/domains/emergencyservices.js`, 2026-07-09)

`registerLensAction("emergency-services", …)`, 20 macros in one file:

- **Field calculators** (pure-compute): `triageAssess` (START-method triage
  color/response-time), `dispatchOptimize` (nearest-available-unit
  assignment), `incidentLog` (24h volume/type/avg-response rollup),
  `resourceReadiness` (vehicle/personnel/supplies weighted readiness score).
- **CAD substrate** (per-user, STATE-backed): `incident-create`,
  `incident-list`, `incident-status`, `unit-add`, `unit-list`,
  `ems-dashboard`.
- **CAD operational layer** (live map, dispatch lifecycle, triage queue,
  timeline, alerting — haversine-distance real math, not a stub):
  `incident-create-geo`, `unit-position`, `map-state`, `nearest-unit`,
  `dispatch-unit`, `unit-status-advance`, `triage-queue`,
  `incident-timeline`, `readiness-rollup`, `active-alerts`.
- **Live external feed**: `feed` — fetches the real USGS 2.5+/day earthquake
  GeoJSON feed server-side, dedupes against a per-user `feedSeen` set, and
  bulk-mints a `dtu.create` per new event (title, magnitude, location,
  ISO time, tsunami flag, USGS source tag). Free public API, no key.

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/emergency-services/` already had 3 files / ~950
LOC of genuinely real, macro-wired UI:

- `CADConsole.tsx` (560 LOC) — the entire CAD operational surface in one
  purpose-built component: incident intake with lat/lng, unit roster intake
  with lat/lng, a live map (`map-state`) with priority-toned incident pins
  and status-toned unit pins, a readiness rollup strip, an active-alerts
  panel with SLA-breach flags, a dispatch-score-ordered triage queue, a
  selected-incident detail view with nearest-unit ranked recommendations
  (`nearest-unit`) and a one-click dispatch button (`dispatch-unit`), an
  incident timeline (`incident-timeline`), and a unit roster grid driving
  the legal status-transition lifecycle (`unit-status-advance`). No
  seed/mock data anywhere — verified by reading the file.
- `EmergencyServicesActionPanel.tsx` (265 LOC) — a real dispatch/EMS bench
  wiring all four field calculators (`triageAssess`, `dispatchOptimize`,
  `incidentLog`, `resourceReadiness`) plus mint-a-shift-DTU, DM a shift
  brief, publish an anonymized volume report, and an agent-composed
  supervisor brief (`chat_agent.do`).
- `QuakeFeed.tsx` (128 LOC, now ~155) — real client-side USGS feed fetch
  (4 feed windows), event stats (max magnitude / M5+ count / tsunami count),
  and a per-event `SaveAsDtuButton`.

## What was actually wrong (genuinely broken/generic/fake) — the worst offender in this batch

1. **7 of the page's 9 tabs ran on a completely disconnected generic-CRUD
   store.** `Dashboard`/`Calls`/`Units`/`Fire`/`EMS`/`Dispatch`/`Resources`/
   `Map` all read from `useLensData<ArtifactDataUnion>('emergency-services',
   currentType, …)` where `currentType` cycled through the literal strings
   `Call`/`Unit`/`FireIncident`/`EMSCall`/`Dispatch`/`Resource`. **Two of
   those six strings (`FireIncident`, `EMSCall`) never matched any macro
   registered anywhere in the domain file** — those tabs rendered a
   permanently empty list with a "no records" placeholder pretending to be
   real content. Only the 9th tab (`CAD`) mounted the real, comprehensive
   `CADConsole`.
2. **A literal fabricated statistic.** The Dashboard's top stat-card row
   hardcoded `{ icon: Clock, label: 'Avg Response', value: '4.2m', ... }` —
   a bare string constant with zero computation behind it, rendered beside
   three counts that at least derived from (fake-store) data. Textbook
   CLAUDE.md §3 fabrication: a decorative number presented as live
   telemetry. **Removed outright — not replaced with a different
   placeholder number.**
3. **A duplicate, disconnected Map tab.** Plotted `lat`/`lng` off the same
   fake `calls` array while `CADConsole`, mounted one tab over, already
   renders every incident/unit pin from the real `map-state` macro. Two
   different "map" UIs on one page, one of them fake.
4. **Two real macros with zero frontend caller.** `ems-dashboard` (a
   purpose-built `{incidents, openIncidents, units, availableUnits,
   byKind}` summary) and `feed` (server-side USGS dedup + bulk DTU-mint,
   materially different from `QuakeFeed`'s client-only per-item save) were
   both fully implemented and completely unreferenced anywhere in the
   frontend.
5. **Generic scaffold body.** The page rendered `<UniversalActions
   domain="emergency-services" artifactId={items[0]?.id} />` directly in
   its JSX — the auto-discovered macro-button-wall body. `node
   scripts/grade-ux-polish.mjs --honest` confirmed the pre-change state
   would have capped at `tier: "functional"` had the rest of the page not
   already been disqualifying; post-change the literal tag is gone from
   the page entirely.
6. **Two real panels bolted below the tab nav, unreachable from it.**
   `EmergencyServicesActionPanel` (the field-calculator bench) and
   `QuakeFeed` (the seismic feed) were both rendered unconditionally
   *after* `</LensPageShell>`, outside every tab — a user clicking through
   the 9 visible tabs would never discover either real surface without
   scrolling past the fake list section first.

## What changed

- Retired the entire fake generic-CRUD tab structure: the `useLensData`
  fake store, the `CallData`/`UnitData`/`IncidentData`/`ArtifactDataUnion`
  interfaces, the search-and-"New {type}" bar tied to it, the severity-badge
  row computed off the fake `calls` array, the `items.map(...)`
  list-with-analyze/delete section, and the duplicate Map tab.
- Removed the literal `'4.2m'` fabricated stat with no replacement fake
  number.
- Removed `<UniversalActions>` (import + JSX) entirely; the page no longer
  renders `LensPageShell`'s bundled `LensFeaturePanel` capabilities-list
  wrapper either — the header is now hand-built, matching the pattern the
  rest of this rebuild wave settled on (see `astronomy`/`bio`).
- Consolidated around what's real, into 4 honest tabs instead of 9:
  **Dashboard** (new — see below), **CAD Console** (unchanged, already
  comprehensive), **Quick Actions** (`EmergencyServicesActionPanel`, now
  reachable from the tab nav instead of bolted below it), **Seismic Feed**
  (`QuakeFeed`, likewise promoted into the tab flow). Fewer tabs than
  before, on purpose — tab count was never the honest signal.
- New `EmsOverviewPanel.tsx` (`components/emergency-services/`) — a real
  Dashboard wiring `ems-dashboard` + `readiness-rollup` into `StatTile`/
  `StatTileGrid` KPI tiles (open incidents, available units, readiness %,
  out-of-service count), a fleet-status banner with kind-coverage-gap
  warnings, and an incidents-by-kind bar breakdown. Loading/error states
  via `Skeleton`/`ErrorState`. Every number is one of the two live macros'
  actual return fields — no client-side derivation of anything the backend
  didn't already compute.
- `QuakeFeed.tsx` gained a bulk **"Ingest to substrate"** action that calls
  the `feed` macro directly (`{ limit: 15 }`) and renders its real
  `{ingested, skipped}` result ("Ingested 3 new events as DTUs · 12 already
  tracked."), alongside (not replacing) the existing manual per-event
  `SaveAsDtuButton` — the two are genuinely different affordances: one
  ingests the whole feed server-side with dedup + provenance tags, the
  other saves a single hand-picked event client-side.

## Reference-parity checklist (Tyler/CentralSquare CAD + NIMS/ICS shape)

| Capability | Disposition | Where |
|---|---|---|
| Incident intake with location + priority | ALREADY REAL | `CADConsole` (`incident-create-geo`) |
| Unit roster with location | ALREADY REAL | `CADConsole` (`unit-add`, `unit-position`) |
| Live incident/unit map | ALREADY REAL | `CADConsole` (`map-state`) |
| Dispatch lifecycle (available→dispatched→en_route→on_scene→clear) | ALREADY REAL | `CADConsole` (`dispatch-unit`, `unit-status-advance`) |
| Nearest-unit recommendation (distance + ETA) | ALREADY REAL | `CADConsole` (`nearest-unit`) |
| Priority-ordered triage/dispatch queue with SLA-breach flags | ALREADY REAL | `CADConsole` (`triage-queue`) |
| Per-incident event timeline | ALREADY REAL | `CADConsole` (`incident-timeline`) |
| High-priority alerting | ALREADY REAL | `CADConsole` (`active-alerts`) |
| Resource readiness rollup (fleet status, coverage gaps) | ALREADY REAL | `CADConsole` inline strip; now also `EmsOverviewPanel` (`readiness-rollup`) |
| START-method field triage | ALREADY REAL | `EmergencyServicesActionPanel` (`triageAssess`) |
| Dispatch-optimization calculator | ALREADY REAL | `EmergencyServicesActionPanel` (`dispatchOptimize`) |
| 24h incident-volume / response-time analytics | ALREADY REAL | `EmergencyServicesActionPanel` (`incidentLog`) |
| Fleet readiness scoring (vehicles/personnel/supplies) | ALREADY REAL | `EmergencyServicesActionPanel` (`resourceReadiness`) |
| Live external hazard feed (seismic) | ALREADY REAL | `QuakeFeed` (client USGS fetch) |
| Ops-summary dashboard (open incidents / available units / by-kind) | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `EmsOverviewPanel.tsx` (`ems-dashboard`) |
| Bulk hazard-feed ingest with dedup + provenance | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | `QuakeFeed` "Ingest to substrate" (`feed`) |
| Multi-agency / mutual-aid interop | GENUINELY MISSING | Deferred — would need a cross-tenant substrate; out of scope for a UI-polish batch |
| Licensed CAD-grade map tiles / AVL hardware integration | GENUINELY MISSING | Deferred — structural (needs a paid data source), not a buildable frontend gap |
| Recorded 911 audio / CAD-to-RMS handoff | GENUINELY MISSING | Deferred — no free API identified with acceptable ToS |

Overall: the CAD operational core was already close to professional-CAD
feature parity, entirely inside `components/emergency-services/` — the
defect was 100% in `page.tsx`: a large disconnected fake surface fronting
real depth, a hardcoded fabricated stat, and two real panels users could
never reach through the tab nav. All four fixed in this pass; the two
remaining unsurfaced macros are now wired.

## Verify-gate results (2026-07-09)

- `npx eslint app/lenses/emergency-services/page.tsx components/emergency-services/CADConsole.tsx components/emergency-services/EmergencyServicesActionPanel.tsx components/emergency-services/QuakeFeed.tsx components/emergency-services/EmsOverviewPanel.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/grade-ux-polish.mjs --honest` — `emergency-services` now `tier: "polished"`, `isGenericScaffold: false`, `pillarsPresent: 5`, `antiPatterns: 0`.
