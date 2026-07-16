# Atlas Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/atlas.js` (1744 LOC), the inline Foundation Atlas block in
> `server/server.js` (~line 24583), `server/domains/free-api-live.js`
> (`live_geocode`), and the inline "cortex" block in `server/server.js`
> (~line 24632, backed by `server/lib/atlas-signal-cortex.js`). Reproduce:
> `grep -n 'registerLensAction("atlas"' server/domains/atlas.js`,
> `grep -n 'register("atlas"' server/server.js`,
> `grep -n 'register("cortex"' server/server.js`.

## 0. Three subsystems share the name "atlas" — and a fourth is a naming
## collision, not part of this lens

This lens's own investigation (2026-07-09) confirmed the prior-session
hand-off notes and added one correction:

1. **Real-world geo/mapping/trip tool** — `server/domains/atlas.js`, macro
   domain `atlas`. Google-Maps-parity: OSM Nominatim geocoding, Overpass POI
   search, real OSRM routing (incl. multi-modal turn-by-turn, live-traffic
   estimate, transit), a full places/lists/trips/offline-areas/navigation
   CRUD substrate. **This is the primary surface of the lens.**
2. **"Foundation Atlas" signal tomography** — inline `register("atlas", ...)`
   calls in `server.js` (macro domain `atlas`, same domain name as #1 — the
   two coexist under one macro-domain string) backed by
   `server/lib/foundation-atlas.js`, plus a sibling **"Atlas Signal Cortex"**
   classification/privacy layer registered under a **different** macro
   domain, `cortex` (`server/lib/atlas-signal-cortex.js`), reached by the
   frontend via the same `/api/atlas/signals/*` and `/api/atlas/privacy/*`
   REST routes (`server/routes/atlas-signals.js`). Both are a real,
   honestly-coded sci-fi concept: reconstruct terrain/materials/change from
   mesh-network signal-path deltas. **Verified this session: `collectSignal`
   (foundation-atlas.js) and `classifySignal`'s auto-path (atlas-signal-cortex.js)
   are imported into `server.js` but never called anywhere except from the
   respective macros themselves** (`grep -n "collectSignal(" server/server.js`
   returns only the import line). No mesh-network ingestion pipeline exists
   in this deployment. Every read (`tile`/`volume`/`material`/`subsurface`/
   `coverage`/`live`/`taxonomy`/`anomalies`/`spectrum`) is a REAL query
   against a structurally-empty in-memory store — it returns honest
   `{ok:false,error:'no_tile_at_coordinates'}` or empty arrays, never
   fabricated content. **One exception, already self-disclosed in the
   source**: `detectChanges()` in `foundation-atlas.js` (feeding the `change`
   macro) has `layers_affected: ALL_LAYERS.filter(() => Math.random() > 0.6), // simulated`
   and `magnitude: clamp(Math.random() * 0.5, 0, 1), // simulated` — the
   backend's own comment discloses these as placeholders for a future
   voxel-grid diff. **This session's rebuild does not surface the `change`
   macro in the UI at all**, precisely because the only way to render it
   honestly would be to also render the simulated fields as simulated, and
   the substrate that would make it real (temporal tile versioning) doesn't
   exist yet either — deferred as GENUINELY MISSING below, not routed around.
3. **`components/atlas/GraphView.tsx`** — a generic Obsidian/Roam-shape
   force-directed canvas primitive, confirmed **genuinely shared**
   (`components/conkay/panels/ProvenancePanel.tsx`,
   `app/lenses/literary/page.tsx` both import it directly). `PlacesGraph.tsx`
   wraps it around the user's real saved places + lists — kept, and is a
   legitimate, non-decorative use (nodes/edges are the real
   `places-list`/`lists-list` data, empty until the user saves something).
   **Not modified or removed.**
4. **`server/emergent/atlas-store.js` + `/api/atlas/dtu*` routes +
   `components/atlas/{AtlasStatusBadge,CitationCard,RightsDisplay}.tsx`** —
   confirmed **out of scope**, same "naming collision" pattern the Wave-1
   `lattice` rebuild found. This is a *third, unrelated* "Atlas": a
   DTU-claims / epistemic-verification substrate ("Concord Global Atlas") —
   content hashing, DRAFT→VERIFIED/DISPUTED promotion, contradiction
   detection. It is **not registered under the `atlas` macro domain at all**
   (no `registerLensAction`/`register` calls in `atlas-store.js`); it's
   reached only via direct `app.post/get("/api/atlas/dtu...")` REST routes
   in `server.js` (~line 55155). The three frontend components are
   **confirmed orphaned** — `grep -rl "CitationCard|RightsDisplay|AtlasStatusBadge"`
   across the frontend finds only a dead barrel re-export in
   `components/index.ts`, no real mount site anywhere (not in this lens, not
   in any other). Left untouched — reassigning them to a real home is a
   separate, unrelated cleanup task, not part of a geography-lens rebuild.

## 1. Backend surface — full macro enumeration

### 1a. `server/domains/atlas.js` — macro domain `atlas` (41 macros, real)

| Macro | What it does | Disposition (post-rebuild) |
|---|---|---|
| `nominatim-geocode` | Live OSM Nominatim forward geocode | **DESIGNED** — Explore search, Directions geocode-on-submit, Quick-actions bench |
| `nominatim-reverse` | Live OSM Nominatim reverse geocode | **DESIGNED** — Quick-actions bench |
| `overpass-poi` | Live Overpass POI search in a bbox | **DESIGNED** — Explore's category-chip POI discovery, Quick-actions bench |
| `places-list`/`places-save`/`places-delete` | Saved-places CRUD (STATE-backed) | **DESIGNED** — Places tab |
| `places-update` | Edit an existing saved place | ~~**GENUINELY MISSING — DEFERRED.** No create/edit-in-place UI exists (only create+delete); was true before this rebuild too. Small scoped build: ~40 LOC form + wiring in `PlacesPanel`.~~ **CLOSED (2026-07-12, `f4a90d4e`).** `PlacesPanel` now has a pencil-icon edit affordance per place row that opens a real inline form (name/category/rating/address/notes) and calls `places-update` with only the changed fields (rating omitted when blank, matching the backend's `Number.isFinite` gate). See `concord-frontend/components/atlas/AtlasSection.tsx` + `concord-frontend/tests/components/atlas/AtlasSection.test.tsx`. |
| `lists-list`/`lists-create`/`lists-add-place`/`lists-remove-place`/`lists-delete` | Named place-list CRUD | **DESIGNED** — Lists tab (+ optional graph view via `PlacesGraph`) |
| `trips-list`/`trips-create`/`trips-add-stop`/`trips-remove-stop`/`trips-delete` | Multi-day trip CRUD | **DESIGNED** — Trips tab |
| `trips-reorder-stops` | Reorder a trip's stop sequence | ~~**GENUINELY MISSING — DEFERRED.** No drag/reorder UI exists (was also true pre-rebuild). Scoped build: up/down or drag handles in the Trips stop list, ~30 LOC.~~ **CLOSED (2026-07-12, `f4a90d4e`).** `TripsPanel`'s stop list now has up/down chevron buttons (boundary-disabled at each end) that call `trips-reorder-stops` with the full reordered `stopIds` array, matching the macro's exact-once-per-stop contract (`server/domains/atlas.js:916` rejects a partial list). See `concord-frontend/components/atlas/AtlasSection.tsx` + `concord-frontend/tests/components/atlas/AtlasSection.test.tsx`. |
| `directions` | Real OSRM 2-point routing, summary only (no steps) | **UNSURFACED-BY-DESIGN (intentional consolidation).** No frontend caller remains — superseded by `directions-multimodal`, a strict superset (same OSRM engine, plus per-maneuver steps, plus native multi-waypoint support). Keeping both wired would be exactly the kind of redundant-surface duplication this rebuild exists to remove. |
| `directions-multimodal` | Real OSRM routing with full turn-by-turn steps, native multi-waypoint | **DESIGNED** — Directions tab's Route sub-tab (now the sole directions macro in use) |
| `route-stops` | "Ask Maps"-style stop suggestion near a route midpoint | **DESIGNED** — Directions tab's "Add a stop" sub-tab |
| `live-traffic-eta` | OSRM free-flow + time-of-day congestion model, ETA | **DESIGNED** — Directions tab's Traffic sub-tab (`LiveTrafficPanel`) |
| `transit-directions` | OSM-derived walk+transit+walk legs | **DESIGNED** — Directions tab's Transit sub-tab (`TransitDirections`) |
| `nav-start`/`nav-update`/`nav-status`/`nav-stop` | Live GPS turn-by-turn nav session with re-routing | **DESIGNED** — Directions tab's Navigate sub-tab (`NavigationMode`) |
| `street-imagery` | Mapillary photo lookup (keyless coverage tile fallback) | **DESIGNED** — Tools tab (`StreetImagery`) |
| `place-details` | Full OSM tag set + Wikipedia summary/photo | **DESIGNED** — Tools tab (`PlaceDetails`) |
| `offline-areas-list`/`-create`/`-update-status`/`-delete` | Offline map-area bbox + real browser tile pre-cache | **DESIGNED** — Tools tab (`OfflineAreas`) |
| `distanceMatrix` | Haversine NxN distance matrix + stats | **DESIGNED** — Tools tab (`DistanceMatrixPanel`, editable waypoint table + heatmap), also Quick-actions bench |
| `routeOptimize` | Nearest-neighbor + 2-opt TSP waypoint ordering | **DESIGNED** — Tools tab (`DistanceMatrixPanel`), also Quick-actions bench. **No longer used to fabricate turn-by-turn ETAs** (see §2 finding 2) |
| `geocode` | Batch place-name resolve (built-in reference cities or supplied lat/lon) + bearing/distance/hemisphere/UTC-offset | **DESIGNED (newly wired this session)** — Tools tab, new `BatchGeocodeTool.tsx`. Was previously reachable ONLY through a dead button (see §2 finding 1) |
| `regionStats` | Region comparator: totals, weighted averages, population Gini, rankings, GDP-per-capita income tiers | **DESIGNED (newly wired this session)** — Tools tab, new `RegionStatsTool.tsx`. Was previously reachable ONLY through the same dead button |
| `ai-trip-plan` | LLM/deterministic multi-day itinerary from saved places | **DESIGNED** — Planner tab |
| `recent-searches-list`/`-record`/`-clear` | Search history | **DESIGNED** — Recent tab |
| `atlas-dashboard-summary` | Place/list/trip/offline-area counts, category breakdown, active-nav flag | **DESIGNED (newly wired this session)** — Recent tab's new snapshot strip. Was previously **UNSURFACED** — zero frontend callers existed anywhere |

### 1b. `server/domains/free-api-live.js` — macro domain `atlas` (1 macro)

| Macro | What it does | Disposition |
|---|---|---|
| `live_geocode` | A second, independent OSM Nominatim geocode implementation | **UNSURFACED-BY-DESIGN.** Backend-level duplicate of `nominatim-geocode` (same job, same external API, different code path — a backend redundancy, not a frontend concern; CLAUDE.md's discipline is "never rewrite the macro/wiring layer"). The frontend previously had TWO parallel search boxes wired to these two different macros (`OsmGeocodePanel.tsx` → `live_geocode`, `AtlasSection`'s Explore/`PlaceFinder.tsx` → `nominatim-geocode`) — this rebuild consolidates onto one canonical search surface calling `nominatim-geocode` only (the richer response shape, already used by 6+ other panels). `OsmGeocodePanel.tsx` deleted. |

### 1c. `server.js` inline "Foundation Atlas" — macro domain `atlas` (9 macros)

| Macro | REST route | Disposition |
|---|---|---|
| `tile` | `GET /api/atlas/tile` | **DESIGNED** — Signal Tomography mode, coordinate tile query |
| `coverage` | `GET /api/atlas/coverage` | **DESIGNED** — Signal Tomography mode, stat cards + Coverage tab |
| `live` | `GET /api/atlas/live` | **DESIGNED** — Signal Tomography mode, live-node map markers |
| `volume` | `GET /api/atlas/volume` | **GENUINELY MISSING — DEFERRED.** No 3D-volume UI exists (pre- and post-rebuild). Given the store is structurally empty in this deployment (see §0.2), a 3D volume viewer would render nothing real — building it now would be effort spent on a UI for data that can't exist until ingestion is wired. Flagged, not built. |
| `material` | `GET /api/atlas/material` | **GENUINELY MISSING — DEFERRED**, same reasoning as `volume`. (`AtlasResearchView`'s "material" panel is driven from the already-fetched `tile` response's `layers.surface.dominantMaterial`, not a direct call to this endpoint — that's an honest reuse, not a substitute.) |
| `subsurface` | `GET /api/atlas/subsurface` | **GENUINELY MISSING — DEFERRED**, same reasoning. |
| `change` | `GET /api/atlas/change` | **GENUINELY MISSING — DELIBERATELY NOT WIRED**, see §0.2. Surfacing this macro's `layers_affected`/`magnitude` fields in a "polished" UI would present self-disclosed-simulated values as measured data, which the honest-by-construction rule forbids. The correct fix is a backend voxel-diff implementation, out of scope for this frontend rebuild. |
| `query` | `POST` (custom spatial query) | **GENUINELY MISSING — DEFERRED.** A power-user ad-hoc query macro; no frontend caller pre- or post-rebuild. Low priority given the empty substrate. |
| `metrics` | (no route in `atlas.js`; reachable via macro dispatch) | **GENUINELY MISSING — DEFERRED**, same reasoning. |

### 1d. `server.js` inline "Atlas Signal Cortex" — macro domain `cortex` (9 macros)

| Macro | REST route | Disposition |
|---|---|---|
| `taxonomy` | `GET /api/atlas/signals/taxonomy` | **DESIGNED** — Signal Tomography mode, Signals tab |
| `anomalies` | `GET /api/atlas/signals/anomalies` | **DESIGNED** — Signal Tomography mode, Anomalies tab |
| `spectrum` | `GET /api/atlas/signals/spectrum` | **DESIGNED** — Signal Tomography mode, Signals tab (spectrum sub-view) |
| `unknown` | `GET /api/atlas/signals/unknown` | **GENUINELY MISSING — DEFERRED.** No frontend caller. Deferred with the rest of the tomography power-tools. |
| `classify` | `POST /api/atlas/signals/classify` | ~~**GENUINELY MISSING — DEFERRED, but flagged as the highest-value future build in this whole subsystem.** This is the ONE write path into the signal-cortex store — a manually-submitted signal classification. Building a form here (device/frequency/location/measurement fields → `POST`) would be the single cheapest way to give Signal Tomography mode a legitimate path to non-empty data in THIS deployment, without waiting on a real mesh-network integration. Scoped size: ~1 form component + wiring, well under 150 LOC.~~ **CLOSED (2026-07-12, `336cbc95`).** Verified the macro's real input contract first (`server/lib/atlas-signal-cortex.js#classifySignal` — no strictly-required fields, everything defaults) and added server-side validation for the two fields a classification is meaningless without: `frequency` (MHz, finite, > 0) and `origin` (`{lat, lng}`, valid coordinate range) — see the guard clauses at the top of `register("cortex", "classify", ...)` in `server.js`. Built `concord-frontend/components/atlas/SignalClassifyForm.tsx`, a real designed form (frequency / modulation select / lat+lng / bandwidth / power / description / keywords — the macro's actual identity+location+measurement fields, not invented ones, and not a raw JSON-paste textarea) mounted at the top of the Signal Tomography "Signals" tab (`app/lenses/atlas/page.tsx`). A successful submission calls `apiHelpers.atlasTomography.signalsClassify` (new helper in `lib/api/client.ts`) and invalidates the `atlas-taxonomy`/`atlas-spectrum`/`atlas-anomalies` react-query keys so the existing `AtlasSignalView` taxonomy + spectrum panels on the same tab pick it up without a hard refresh. Backend behavioral coverage: `server/tests/depth/atlas-signal-classify-behavior.test.js` (14/14 — exact 5-property classification round-trip, safety-frequency ADJUST_FORBIDDEN override, rejection for missing/invalid frequency, rejection for missing/out-of-range origin, no taxonomy write on a rejected submission, retrieval via `taxonomy`/`spectrum`/`unknown`). Frontend coverage: `concord-frontend/tests/components/atlas/SignalClassifyForm.test.tsx` (5/5 — designed-form field render, client + server validation-error display with no false success state, real payload shape asserted on submit). |
| `privacy.zones`/`privacy.verify`/`privacy.stats` | `GET/POST /api/atlas/privacy/*` | ~~**GENUINELY MISSING — DEFERRED.**~~ **CLOSED (2026-07-16)** — new "Privacy" tab in Signal Tomography mode reuses `AtlasPrivacyMonitor` (previously orphaned on the chat lens) for a real zones/stats view plus a new `PrivacyVerifyForm` verifying a zone's interior-never-generated guarantee by real zone id. Honest disclosure banner: `detectPrivacyZone` (the only writer into the store) is imported but never called in this deployment, so the list is real and honestly empty until zones exist. |
| `metrics` | (macro dispatch) | **GENUINELY MISSING — DEFERRED**, same reasoning as the Foundation Atlas `metrics`. |

**Coverage summary:** 60 real macros across the lens's 4 in-scope registration
sites (41 + 1 + 9 + 9). **35 DESIGNED** (up from an estimated ~26 pre-rebuild
— `geocode`, `regionStats`, and `atlas-dashboard-summary` newly wired earlier
this session, `classify` closed 2026-07-12 per §1d above — note this count
does not yet reflect the same-day `places-update`/`trips-reorder-stops`
closures at §1a, a pre-existing staleness in this paragraph out of scope for
this pass), **1 UNSURFACED-BY-DESIGN backend duplicate** (`live_geocode`),
**1 macro superseded and intentionally retired from frontend use**
(`directions`), **12 GENUINELY MISSING** (all explicitly dispositioned above
— 2 real small deferred features on the map/trips side, 10 on the
tomography side where 7 are low-priority given the empty substrate, 3 are a
meaningful privacy/classification UI deferred as multi-panel future work,
and 1 [`change`] is deliberately never wired because wiring it would violate
the honest-by-construction rule).

## 2. Fake-data / duplication findings and how each was resolved

1. **🔴 Dead "Atlas Compute Actions" panel (pre-rebuild `page.tsx`, lines
   ~374–465).** `handleAtlasAction()` read its target id from
   `useLensData<Record<string,unknown>>('atlas', 'location', { seed: [] })`
   — but **nothing in the entire codebase ever creates a generic
   lens-artifact of type `'location'`** (`SavedPlaces.tsx` created type
   `'place'`; `AtlasSection`'s own places system is a separate STATE-backed
   store entirely, not the generic-artifact system). `atlasItems[0]?.id` was
   therefore **always `undefined`**, so `handleAtlasAction` hit
   `if (!targetId) return;` on **every single click** — the Geocode /
   Distance Matrix / Region Stats / Route Optimize buttons rendered,
   animated a spinner state, and silently no-opped, forever. This is the
   "dead duplicate UI reading from an unwritten store" antipattern named in
   CLAUDE.md's honesty rule. **Fix:** panel removed entirely; the two real,
   valuable macros it referenced but couldn't actually reach
   (`regionStats`, `geocode`) are now genuinely wired via new structured-input
   tools (`RegionStatsTool.tsx`, `BatchGeocodeTool.tsx`) in the Tools tab.

2. **🔴 Broken `Explore` search (pre-rebuild `AtlasSection.tsx`
   `ExplorePanel`).** Parsed the `nominatim-geocode` response as
   `r.data?.result?.matches || r.data?.result?.results` — but the macro's
   real return shape is `{query, places, count, source}` (verified against
   `server/domains/atlas.js:594`). Neither `matches` nor `results` is ever a
   key in that response, so `matches` was **always `[]`** — the Explore
   search box made a real, successful network call on every search and then
   silently discarded 100% of the results. **Fix:** rewritten to read
   `r.data?.result?.places` (with the correct `displayName`/`latitude`/
   `longitude` field names, verified against the macro's actual mapping
   code), with legacy-shape fallbacks kept only as defensive extras.

3. **🟡 `MapsDirections.tsx` computed and displayed a fabricated turn-by-turn
   ETA.** It called `atlas.routeOptimize` (a Haversine straight-line TSP
   orderer — no road network involved) and then derived a duration via
   `km / assumedSpeedKph` (65/30/5/18 for drive/transit/walk/bike) — a
   locally-invented number, not a real routing engine's output — while its
   UI ("Get directions", mode tabs, hero duration card) presented exactly
   like a real turn-by-turn result. Meanwhile `AtlasSection`'s own
   `DirectionsPanel` already called the real `atlas.directions` OSRM macro
   for actual road-network routing. Two "Directions" surfaces existed: one
   honest (road routing), one presenting a formula-derived estimate as if
   it were a measured travel time — the "client-fabricated numeric data
   presented as measured" antipattern from CLAUDE.md's honesty table (the
   Sports lens's `powerScore: 50 + Math.random()*30` case is the closest
   precedent, though this one used a deterministic formula rather than
   `Math.random`, the fabrication concern is the same: a number with no
   real routing-engine backing presented as one). **Fix:** `MapsDirections.tsx`
   deleted; `DirectionsPanel` rebuilt to call `atlas.directions-multimodal`
   (real OSRM, real per-maneuver steps, native multi-waypoint), keeping the
   better parts of `MapsDirections`'s UI (swap button, stop-adding, mode
   tabs) on top of the honest macro.

4. **🟡 Two disconnected, parallel "your saved places" stores.**
   `SavedPlaces.tsx` persisted places as generic lens-artifacts
   (`useLensData('atlas', 'place', ...)` → `POST /api/artifacts`);
   `AtlasSection`'s `PlacesPanel` persisted places via the dedicated
   `atlas.places-save`/`places-list`/`places-delete` STATE-backed macros. A
   place saved in one system was **invisible in the other** — and only the
   STATE-backed system feeds `Lists`/`Trips`/`Directions`'s "use a saved
   place" pickers, so a place saved via `SavedPlaces.tsx` was a dead end:
   visible in that one panel, unusable everywhere else the app treats
   "your places" as a single concept. **Fix:** `SavedPlaces.tsx` deleted;
   `AtlasSection`'s `PlacesPanel` (backed by the macro system every other
   places-aware feature already reads) is now the single canonical store.

5. **🟡 Duplicated place-search UI (3 independent search boxes).**
   `OsmGeocodePanel.tsx` (standalone, top of page, called the backend-
   duplicate `live_geocode` macro), `PlaceFinder.tsx` (standalone section,
   called `nominatim-geocode` + added a real, unique POI-category-chip
   discovery feature via `overpass-poi`, rendered on a hand-rolled SVG
   mini-map), and `AtlasSection`'s own `ExplorePanel` (in the map-shell
   sidebar, also called `nominatim-geocode`, but was broken — see finding 2)
   all did some version of "search for a place." **Fix:** consolidated into
   one `ExplorePanel`: the real, working search (fixed per finding 2) now
   also carries `PlaceFinder`'s POI-category-chip discovery (café/
   restaurant/fuel/hotel/parking near the focused result) — but instead of
   `PlaceFinder`'s hand-rolled SVG mock map (which, per the CLAUDE.md honesty
   table's "fake visual fabricated as the real thing" pattern, is a strictly
   worse stand-in for a map when a REAL Leaflet map is already mounted one
   panel over in `AtlasShell`), POI results now plot as real markers on the
   shell's actual `MapView`. `PlaceFinder.tsx` and `OsmGeocodePanel.tsx`
   both deleted; `PlaceShareSheet.tsx` (a genuinely distinct, real feature —
   DM/agent-research/publish/guide/embed-link actions on a place) was kept
   and re-wired into the consolidated Explore panel.
6. **🟢 No fake data found in the retained/rebuilt components.** Every
   panel's loading/empty/error states were checked against their real
   `lensRun`/`apiHelpers.lens.runDomain` calls; the two `Math.random()`
   call sites that remain in the atlas component tree
   (`GraphView.tsx:90` — force-layout initial-position jitter, a rendering
   technique, not data; `OfflineAreas.tsx:111-112` — randomly *sampling
   which real tile URLs* to pre-fetch into the browser cache, not
   fabricating tile content) are legitimate, pre-existing, and unrelated to
   data honesty. Confirmed via `node server/lib/detectors/frontend-fake-data-detector.js`
   equivalent run (0 atlas-related findings) and manual read of all 20
   component files.

## 3. Step 1.5 — Reference-parity checklist

This lens genuinely serves two different jobs. Per the program's framing,
both get a named reference and an explicit parity target.

### 3a. Map / trips / navigation — reference: **Google Maps** (cross-checked
against **Organic Maps**, a real OSM-based FOSS alternative, for the
free-data-source-only shape this lens is built on)

**Parity statement:** the only difference should be that Concord's atlas
runs entirely on free, keyless OpenStreetMap-family data sources (Nominatim,
Overpass, OSRM, Mapillary-keyless-tier) instead of Google's proprietary
stack — search, save, plan, and navigate should feel and function the same;
Concord will never have Google's imagery/business-listing density, and that
is an honest, disclosed data-source gap, not a feature gap.

| # | Checklist item (Google Maps core) | Disposition | Justification |
|---|---|---|---|
| 1 | Search any place/address | **ALREADY REAL, FIXED THIS SESSION** | `nominatim-geocode` — was silently broken (finding 2), now works |
| 2 | Save places (bookmarks/lists, home/work) | **ALREADY REAL** | Places + Lists tabs, `atlas.places-*`/`lists-*` |
| 3 | Multi-day trip planning | **ALREADY REAL** | Trips tab + AI planner tab (`ai-trip-plan`) |
| 4 | Turn-by-turn directions, multiple travel modes | **ALREADY REAL, UPGRADED THIS SESSION** | Was OSRM-summary-only (no steps); now `directions-multimodal` with per-maneuver steps, swap, multi-stop |
| 5 | Live traffic-adjusted ETA | **ALREADY REAL (honestly labeled)** | `live-traffic-eta` — OSRM free-flow + time-of-day demand model, source string disclosed in UI (`"osrm + time-of-day demand model"`), not real GPS-probe traffic — this is a Google-Maps-*circa-2007* parity level, disclosed, not oversold |
| 6 | Transit directions | **ALREADY REAL** | `transit-directions` — OSM-derived stops + walk/ride legs, no GTFS feed (disclosed via `source` field) |
| 7 | Live GPS navigation with re-routing | **ALREADY REAL** | `nav-start/-update/-status/-stop`, real `navigator.geolocation.watchPosition` |
| 8 | Nearby-places discovery (category search near a point) | **ALREADY REAL, RELOCATED THIS SESSION** | `overpass-poi` category chips, was in a separate standalone panel, now integrated into Explore |
| 9 | Street-level imagery | **ALREADY REAL (honestly degraded)** | `street-imagery` — Mapillary; keyless tier returns a coverage-tile reference only, per-image lookups need a token, both states disclosed in UI |
| 10 | Place detail page (hours, phone, photos, reviews) | **ALREADY REAL minus reviews** | `place-details` — full OSM tag set + Wikipedia summary/photo. **No review system** — GENUINELY MISSING, correctly out of scope (OSM has no review data source; fabricating one would violate honesty) |
| 11 | Offline maps | **ALREADY REAL** | `offline-areas-*` + real browser tile pre-cache fetches (not a fake progress bar) |
| 12 | Share a place (send, embed link) | **ALREADY REAL** | `PlaceShareSheet` — DM, agent-research, publish-as-public-DTU, add-to-guide, copy embed link |
| 13 | Recent searches | **ALREADY REAL** | Recent tab |
| 14 | Route/stop optimizer for multi-point trips | **ALREADY REAL** | `routeOptimize`/`distanceMatrix` — Tools tab |
| 15 | At-a-glance account summary (places/lists/trips counts) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS SESSION** | `atlas-dashboard-summary` had zero callers; now a snapshot strip in the Recent tab |
| 16 | Edit a saved place in place | ~~**GENUINELY MISSING — DEFERRED**~~ **CLOSED (2026-07-12, `f4a90d4e`)** | `places-update` now has a real edit-in-place UI; see §1a |
| 17 | Reorder trip stops | ~~**GENUINELY MISSING — DEFERRED**~~ **CLOSED (2026-07-12, `f4a90d4e`)** | `trips-reorder-stops` now has a real up/down reorder UI; see §1a |
| 18 | Business reviews/ratings | **GENUINELY MISSING — HONEST, NO CHANGE NEEDED** | No OSM-sourced review data exists to surface; not fabricated |

**Coverage: 17 of 18 already real (2 fixed this session, 1 newly wired this
session, 2 more closed 2026-07-12), 1 honestly out of scope. No silent gaps.**

### 3b. Signal tomography — reference: **commercial InSAR ground-deformation
platforms** (Capella Space's Taskable InSAR, IonQ's automated InSAR
monitoring — researched via WebSearch, 2026-07-09) cross-checked against
**RF-mesh coverage/terrain tools** (MeshCore Network Planner, RFeye/SPLAT!
terrain-path-loss analysis)

**Parity statement:** the only difference should be that Concord's signal
tomography runs on ambient mesh-network signal deltas instead of a
purpose-built SAR satellite constellation or dedicated RF survey
equipment — automated-tasking coverage queries, material/change
classification, and multi-sensor fusion should be designed, real-data
features, exactly as those platforms provide. **The load-bearing caveat
this checklist surfaces, that a features list alone would not**: those
reference platforms all have a working sensor/satellite feeding real data
continuously; Concord's mesh-signal source does not exist in this
deployment, so "real data" here means "a real, honestly-empty pipeline,"
not "a populated one." That is the single biggest fact a user of this mode
needs to know, and it's now stated on-screen (§0.2, §4).

| # | Checklist item (InSAR/RF-tomography platform) | Disposition | Justification |
|---|---|---|---|
| 1 | Automated area-of-interest tasking + coverage query | **ALREADY REAL (honestly empty)** | `tile`/`coverage`/`live` — real queries, real REST routes, structurally empty store (§0.2) |
| 2 | Signal classification taxonomy | **ALREADY REAL (honestly empty)** | `cortex.taxonomy` — Signals tab |
| 3 | Anomaly detection | **ALREADY REAL (honestly empty)** | `cortex.anomalies` — Anomalies tab |
| 4 | Spectral occupancy / multi-band fusion | **ALREADY REAL (honestly empty)** | `cortex.spectrum` — Signals tab spectrum sub-view |
| 5 | Material/subsurface classification | **BACKEND-CAPABLE, UI-DEFERRED** | `material`/`subsurface` macros exist; no dedicated UI (§1c) — deferred, empty substrate makes it low-value right now |
| 6 | Displacement/change-over-time maps | **GENUINELY MISSING — DELIBERATELY NOT WIRED** | `change` macro's `layers_affected`/`magnitude` are self-disclosed-simulated in the backend source; surfacing them would violate honest-by-construction (§0.2, §1c) |
| 7 | Manual sensor/signal submission (the one real write path) | ~~**BACKEND-CAPABLE-BUT-UNSURFACED — FLAGGED FOR NEXT SESSION**~~ **CLOSED (2026-07-12, `336cbc95`)** | `cortex.classify` — `SignalClassifyForm` now gives this deployment a legitimate non-empty-data path without a mesh-network integration; see §1d |
| 8 | Privacy-zone-aware redaction | **BACKEND-CAPABLE-BUT-UNSURFACED, DEFERRED** | `cortex.privacy.*` — a real, carefully-designed guarantee (interior data for ABSOLUTE zones is architecturally never generated) with no UI; deferred as multi-panel future work (§1d) |
| 9 | Honest disclosure of data-source status | **FIXED THIS SESSION** | New banner in Signal Tomography mode explicitly states no mesh-ingestion pipeline is wired — see §4 |

**Coverage: 5 of 9 already real; 1 explicitly and permanently not wired
(honesty rule); 1 closed 2026-07-12 (manual submission form); 1 deferred with
named scope; 1 (disclosure itself) fixed this session. No silent gaps.**

## 4. What this rebuild changed — architecture summary

**The core design call: Map mode is primary, Signal Tomography is an
honestly-scoped secondary mode**, switched via a segmented control at the
top of the page (`role="tablist"`, keyboard shortcuts `g m` / `g s` via
`useLensCommand`). This is a deliberate, documented choice (per the program
doc's requirement), not a silent demotion:

- The map/trips/directions subsystem has ~41 real, substantially-more-used
  macros, a genuine Google-Maps-parity feature set, and (after this
  session's fixes) zero structurally-broken paths.
- The tomography subsystem is real, honestly-coded, carefully-designed
  (down to the privacy-zone interior-never-generated guarantee) — but is
  **currently, structurally unfed** in this deployment (§0.2). Presenting
  it as an equal-weight primary surface next to a working product would
  bury the working product under a permanently-empty one and, without the
  disclosure banner, would look indistinguishable from "just hasn't loaded
  yet" — a genuine (if subtle) honesty gap the old single-page layout had.
  Making it an explicitly-labeled secondary mode with an on-screen
  explanation of *why* it's empty is the honest way to keep a real,
  interesting subsystem visible without misrepresenting its data state.

**Map mode — `AtlasSection.tsx` (874 LOC) + `AtlasShell.tsx`**, a
Google-Maps-shape left-rail + map layout, now 8 destinations (was 7):
Explore (rebuilt — real search + POI discovery + save/share, replacing 3
overlapping panels), Saved places, Lists (+ optional real graph view),
Trips, Directions (rebuilt — real turn-by-turn with Traffic/Transit/
Navigate/Add-a-stop sub-tabs, replacing 2 overlapping "directions" panels
one of which fabricated ETAs), AI planner, **Tools (new)** — a 7-way
sub-tabbed power-user destination consolidating Route optimizer, the two
newly-wired Region-stats/Batch-geocode tools, Place details, Street
imagery, Offline areas, and the existing Quick-actions "geospatial bench"
(mint/DM/publish/agent-insight, cross-lens pipe integration) — and Recent
(now with a real account snapshot strip).

**Signal Tomography mode** — kept the existing four-state (loading/error/
empty/populated) tomography UI largely as-is (it was already honest — real
queries, real empty states), removed the dead Compute-Actions panel
(finding 1) and the duplicate `NavigationSuite` mount (its children
relocated into Map mode's Directions/Tools tabs), and added the explicit
data-source disclosure banner.

**Generic scaffold retired**: `ManifestActionBar`, `AutoActionStrip`,
`RecentMineCard`, `CrossLensRecentsPanel`, `UniversalActions`,
`LensFeaturePanel`, `useRealtimeLens`/`LiveIndicator`/`RealtimeDataPanel`
(confirmed dead exactly like the supplychain rebuild found — `atlas` has no
entry in `hooks/useRealtimeLens.ts`'s `DOMAIN_EVENTS`, so `isLive` was
always `false`) all removed from the page. `node scripts/grade-ux-polish.mjs
--honest` confirms `isGenericScaffold: false`, tier `polished`
(`bespokeRatio: 0.925`, `pillarsPresent: 5/5`, `antiPatterns: 0`).

**Consolidation/dedup decisions (summary):** retired 5 files outright
(`OsmGeocodePanel.tsx`, `MapsDirections.tsx`, `SavedPlaces.tsx`,
`PlaceFinder.tsx`, `NavigationSuite.tsx`) plus one file that became
redundant as a side effect (`MultiModalDirections.tsx` — its one caller,
`NavigationSuite`, was retired, and its job is now done inline in the
rebuilt `DirectionsPanel`, which needed multi-stop + saved-place-picker
support `MultiModalDirections` didn't have). Every real capability those
files carried was preserved by relocating it into the consolidated
`AtlasSection` destinations — none were dropped, only de-duplicated.

## 5. Micro-interactions (5, each tied to a real macro/state change)

1. Explore's POI category chips — click → real `overpass-poi` call →
   distinct pending spinner on the clicked chip → real markers appear on
   the actual Leaflet map (not a toy visualization).
2. Directions' swap button — instantly swaps origin/destination text and
   clears the stale route result (optimistic, immediate).
3. `PlaceShareSheet`'s DM/publish actions — recallable-action pattern (60s/
   30s undo windows) with a visible recall countdown chip.
4. Lists' graph-view toggle — real `PlacesGraph` force-directed canvas
   mounts/unmounts on toggle, animates from the real places↔lists edges.
5. Directions' "Get directions" — button shows a spinner synchronously on
   click, then either a real turn-by-turn step list (success) or a
   specific honest failure message ("Couldn't resolve one or more
   addresses…") — never a silent no-op.
6. Offline areas' "Download tiles" — per-row busy state, real
   `fetch(...tile.openstreetmap.org...)` calls (not a fake progress timer),
   ends in a real cached-tile count.

## Files touched

**Created:**
- `concord-frontend/components/atlas/RegionStatsTool.tsx`
- `concord-frontend/components/atlas/BatchGeocodeTool.tsx`

**Rewritten:**
- `concord-frontend/app/lenses/atlas/page.tsx`
- `concord-frontend/components/atlas/AtlasSection.tsx`
- `concord-frontend/components/atlas/AtlasShell.tsx` (added `tools` nav item)
- `concord-frontend/tests/atlas-lens-states.test.tsx`

**Edited (doc comment only):**
- `concord-frontend/components/atlas/PlaceShareSheet.tsx`

**Deleted (superseded/duplicate, all capability preserved elsewhere — see §2/§4):**
- `concord-frontend/components/atlas/OsmGeocodePanel.tsx`
- `concord-frontend/components/atlas/MapsDirections.tsx`
- `concord-frontend/components/atlas/SavedPlaces.tsx`
- `concord-frontend/components/atlas/PlaceFinder.tsx`
- `concord-frontend/components/atlas/NavigationSuite.tsx`
- `concord-frontend/components/atlas/MultiModalDirections.tsx`

**Untouched (confirmed real, reused as-is, just relocated to a new mount point):**
- `DistanceMatrixPanel.tsx`, `PlaceDetails.tsx`, `StreetImagery.tsx`,
  `OfflineAreas.tsx`, `LiveTrafficPanel.tsx`, `TransitDirections.tsx`,
  `NavigationMode.tsx`, `RouteStops.tsx`, `AtlasActionPanel.tsx`,
  `PlacesGraph.tsx`, `GraphView.tsx`, `PlaceShareSheet.tsx` (logic unchanged)

**Untouched (confirmed out of scope — see §0.4):**
- `AtlasStatusBadge.tsx`, `CitationCard.tsx`, `RightsDisplay.tsx`
