# Concordia Geography Authority Audit (Phase 1)

**Date:** 2026-09-20  
**Directive:** Make existing Concordia map / geography data drive physical world — do **not** invent a parallel city/world system.  
**Scope:** Read-only map of authoritative systems, data flow, duplicates, gaps, files to modify, and the one-kingdom vertical slice.  
**Status:** PHASE 1 audit complete. **Sangree vertical slice SHIPPED 2026-09-20**. **Fleet expansion SHIPPED 2026-09-20** — all 9 playable civilizations now carry `countries.json` → regions → territories → settlements → regional roads.

### Slice ship evidence (2026-09-20)

| Gate | Result |
|---|---|
| Tunya capitals authored (no PlaceOnRing invent) | 12/12 nonzero — Sangree `(-4.43, -65.85)` |
| City id = `sandrun_sanguire` (GoldenSlice SettlementId) | pinned |
| Region `tunya/region/sangree` + kingdom polygon | pinned |
| SettlementDef districts from faction + forge services | pinned |
| Intra-Tunya regional roads | pinned |
| `WorldGeography.Validate()` with regional roads | pinned |
| EditMode `WorldGeographySangreeSliceTests` | **7/7 pass** |
| CityTown skips PlazaPad when districts compile | wired |
| NpcLife rebind after SettlementCompiler | wired |
| `WorldVisualProfileCatalog.ForCountry(Sangree)` stamp | wired |

### Fleet expansion evidence (2026-09-20)

| Gate | Result |
|---|---|
| `countries.json` for 8 non-Tunya civs (from faction Canon) | generated |
| Live oracle: 9 worlds, 72 cities, 70 territories, 0 near-zero caps | measured |
| Regional roads across fleet | 92 |
| `Validate()` errors | 0 |
| Tunya type differentiation | mining,capital,port,village,forge,town |
| EditMode `WorldGeographyFleetTests` | **8/8 pass** |

**Not claimed:** Fallout-4 density everywhere; continuous heightmaps; Play Mode memory certification for full multi-continent load.


**Companion locks (do not fight):**
- `docs/CONCORDIA_PERSISTENT_MEGAWORLD.md` — one continuous universe; worlds are civilizations/regions.
- `docs/CONCORDIA_PLAYABLE_SLICE.md` — pixels must express kernel truth (clips/grip/birds); this audit does not reopen that ban list.
- LeanPlay stays a **performance policy**, not final geography.

---

## 0. One-sentence finding

Concordia already has a semantic geography spine (`WorldGeography` ← `CityAtlas` ← Canon JSON / `MegaworldMap` / `WorldBook`) and a settlement compiler that can emit real streets and facades from `SettlementDef` — but **authoritative map coordinates are mostly missing or zeroed**, regions are **concentric rings not kingdom territories**, borders are **inter-civilization ring segments not political polygons**, and presentation still mixes **compiler towns + plaza slabs + primitive trade-route cubes**. The job is to make one data path authoritative and drive the existing compiler from real map coords — not to build a second world generator.

---

## 1. Authoritative map source

| Layer | Authority | Location | What it actually is |
|---|---|---|---|
| **World / continent IDs** | `WorldId` + `MegaworldMap` | `Assets/Concordia/Scripts/MegaworldMap.cs` | One plane: Hub at origin; 8 ring civs at `CivilizationRadiusKm * PresentMetersPerKm`; Sere off-ring. |
| **Canon / lore folder** | `WorldBook.Folder(WorldId)` | `WorldBook.cs` + `Resources/Concordia/Canon/<folder>/` | Authored JSON per civilization (factions, lore, NPCs; **only Tunya has `countries.json`** today). |
| **City list** | `CityAtlas` | nested in `WorldBook.cs` | Derived: Tunya from `countries` capitals; other worlds from factions with `controlled_districts`. Never invents empty worlds. |
| **Settlements / regions / places / borders / routes** | `WorldGeography` | `WorldGeography.cs` | Static defs built once from CityAtlas + MegaworldMap + WorldBook. Mutable state in `WorldSliceRec` via `EnsurePersistence`. |
| **Kernel settlements (server)** | `settlements` tables + `server/lib/settlements.js` | mig 287 / 446 / 447 | Living-society historical objects (`status`, founders, `region_id`). Parallel to Unity defs — must stay composed, not duplicated. |
| **WorldField** | Kernel `server/lib/concordia-world-field.js` + Unity `WorldField.cs` / `WorldFieldAuthority*` | continuous influence field | Physics/identity underfoot — **not** political borders. |
| **Visual grammar** | `WorldVisualProfileCatalog` | `WorldVisualProfileCatalog.cs` | Presentation only. `PresentationWorldProfile` is a thin adapter over it — **not** a second catalog. |

**Verdict:** There is already one intended semantic hierarchy. The renderer does not yet fully consume it as geographic truth.

---

## 2. Existing data flow (as implemented)

```
Canon JSON (Resources/Concordia/Canon/<world>/)
  countries.json (Tunya only) ──┐
  factions.json (+ districts) ──┤
                                ▼
                         CityAtlas.For(world)
                           · capital x,z if |coord|>2
                           · else PlaceOnRing() invents ring layout
                                ▼
                    WorldGeography.Build()
                      Regions: heartland / march / wilds (Hub: court)
                      Settlements: 1 SettlementDef per CityAtlas city
                      Places: settlement-center + district places
                      Borders/Routes: ring adjacency (Cyber→…→Crucible + Crime→Sere)
                                ▼
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
   RealmFill.CityTown.BuildAll            GeographyRuntime
   · PlazaPad / CrossStreets (slabs)      · cube TradeRoute segments
   · SettlementCompiler.Compile           · Prim region / wilderness markers
   · NpcLife walkers on plaza
              ▼
   ContinentStream LOD (impostor → L2/L3 full chunk)
              ▼
   ConcordClient.ApplyScene (kernel buildings → SettlementCompiler.CompileOne)
              ▼
   WorldVisualDirector + WorldVisualProfileCatalog (dressing / stamps)
```

**NPC / economy side paths (do not replace):**
- `NpcLife` / jobs / schedules — local presenters on spawned ModularPersons.
- Server: `procgen-settlements`, kingdom snapshot, trade, labor → chronicle.
- `RoadWorld` — mid-ring road life (threat, signs, walkers), not settlement streets.
- `GoldenSliceRuntime` — Tunya Sangree forge slice (already a one-settlement proof path).

---

## 3. Inventory by required concept

### 3.1 WorldId / continents / worlds
- **LIVE:** `MegaworldMap.All`, `Present()`, `ContinentStream` (`TravelMode = continent_stream`).
- **GAP:** Continuous heightmap continents compressed to walkable metres; no per-kingdom polygon mesh.

### 3.2 WorldGeography / RegionDef / SettlementDef / PlaceDef / TradeRouteDef / BorderDef
- **LIVE:** Full type surface + validation (`Validate`, `EnsurePersistence`).
- **Honest weakness:** Regions are **Circle/Ring discs** around each Present (`heartland` ≤34m, `march` 34–76, `wilds` 76–126) — not kingdoms. Borders are **midpoints between Present points**, not settlement-ownership frontiers. Trade routes are **straight Present→Present** with width, drawn as cubes.

### 3.3 Districts
- **LIVE as strings:** `SettlementDef.districts[]`, faction `controlled_districts`, PlaceDef `kind=district` with deterministic offset.
- **GAP:** No `DistrictDef` with footprint polygons, street hierarchy, or parcel graph beyond `PlotPlanner` inside `SettlementCompiler`.

### 3.4 Factions / kingdoms
- **LIVE:** WorldBook factions; server kingdom snapshot; Unity `ConcordClient.ApplyKingdom`; CityAtlas stamps abandoned status.
- **GAP:** Kingdoms are **not geographic entities** (no territory polygons, capital footprint, military presence mesh). Law 12 in megaworld doc still lists emergent borders as GAP.

### 3.5 Population / services
- **LIVE:** `populationBaseline` on SettlementDef; `services[]` string tags; slice `SettlementSliceRec.population`.
- **GAP:** Population does not drive parcel count beyond density heuristics in PlotPlanner; services do not force real market/housing building types from kernel rows.

### 3.6 Roads
- **International:** `TradeRouteDef` + `GeographyRuntime` + `RoadWorld` mid-ring life.
- **Settlement streets:** `SettlementCompiler.CompileRoadsOnly` / `PlotPlanner` from districts.
- **GAP:** No hierarchy major→regional→settlement→street→path wired as one graph. Plaza still uses hardcoded CrossStreets slabs.

### 3.7 Terrain / biome / rivers / coastlines
- **LIVE (presentation):** profile biomes, `WorldWaterSurface`, ContinentStream wilderness dressing, WorldField climate tags on regions.
- **GAP:** No authoritative hydrology / elevation that settles cities. Tunya country themes (cliff/desert/glacier) exist in `WorldVisualProfileCatalog.ForTunyaCountry` but capitals all sit at `(0,0)`.

### 3.8 Streaming
- **LIVE:** `ContinentStream` StreamIn/Out, L0–L3, impostors, staged full chunk, LeanPlay budget=1.
- **LIVE:** Persistence in WorldMemory / server settlements — unload must not delete rows (megaworld law 15).
- **Do not replace.**

### 3.9 Settlement compilation
- **LIVE:** `Settlement.SettlementCompiler` (+ `PlotPlanner`, `FacadeComposer`, `ModuleKit`, `RoofMesher`).
- Explicit policy: kernel rows win; else authored districts; else **build nothing** (no invented town).
- **LIVE consumer:** `RealmFill.CityTown` + `ConcordClient` staged RealizeScene.
- **Residual LeanPlay slabs:** `PlazaPad` 22×22 cube, CrossStreets walks — still present as plaza core around the compiler ring.

### 3.10 Visual profiles
- **Authority:** `WorldVisualProfileCatalog` only.
- `PresentationWorldProfile` / `WorldVisualDirector` consume it — keep as adapters.

### 3.11 NPC civilization
- **LIVE:** `NpcLife` jobs; RealmFill people; RoadWorld roles; GoldenSlice forge NPCs; server needs/routines.
- **GAP:** Workplaces are not systematically bound to compiled parcels / services from SettlementDef.

### 3.12 Navigation / vehicles / economy
- Navigation: local / NavMesh notes exist; mesh Read/Write issues on some kits (console noise).
- Economy: server trade + CrossRing tariffs; Unity tariff via `WorldGeography.TariffFor`.
- Vehicles/mounts: out of Phase 1–7 scope for the first slice.

---

## 4. Duplicate / conflicting systems

| Conflict | Systems | Resolution rule |
|---|---|---|
| City layout | Old hardcoded 10-slot Vector3[] (retired in comments) vs `SettlementCompiler` vs plaza slabs | **Compiler + Map coords** win; plaza slabs are temporary keep-out, not final city. |
| Settlement identity | Unity `SettlementDef` vs server `settlements` rows | Compose: server owns historical status; Unity owns presentation compile from same ids. |
| Regions | Unity concentric rings vs server `procgen_regions` / mig 447 `region_id` | Unify mapping; do not invent a third RegionDef. |
| Borders | `BorderDef` (ring) vs WorldField influences vs disputed_border lore | Field = physics; BorderDef = crossing infrastructure; kingdom polygons = missing layer to derive from ownership + geography. |
| Visual profile | Catalog vs PresentationWorldProfile | Catalog is sole author; Presentation is DTO. |
| Procgen settlements | `procgen-settlement-cycle` NPC packs vs Living Society settlements | Megaworld doc: wrap, don't enlarge packs as the live path. |
| LeanPlay | Performance thinning vs “final geography” | Keep LeanPlay; never treat its cubes as destination art. |

---

## 5. Critical missing authoritative data

1. **Real capital / settlement coordinates** — Tunya `countries.json`: **12/12 capitals at (0,0)** → `CityAtlas.PlaceOnRing` fabricates layout. Until coords (or anchors) are authored/derived, the “map” cannot drive geography.
2. **Kingdom territory polygons** (or deterministic Voronoi/ownership from settlements + disputed_border + terrain).
3. **Region defs that match countries** (especially Tunya: Dinye / Aekon / Asbir / Masond / …) instead of generic heartland/march/wilds.
4. **Hydrology + elevation authority** that cities respect (coasts, rivers, cliffs from country themes).
5. **District footprints** beyond string lists + angular offsets.
6. **Road graph** connecting settlements inside a civilization (not only Present-to-Present international routes).
7. **Workplace ↔ parcel binding** for NpcLife.

---

## 6. Exact files to modify (when Phase 2+ starts)

**Extend — do not replace:**

| File | Role in next work |
|---|---|
| `…/Scripts/WorldGeography.cs` | Region construction from countries; attach kingdom territory; keep SettlementDef spine. |
| `…/Scripts/WorldBook.cs` (`CityAtlas`) | Prefer authored capital/anchor coords; stop PlaceOnRing when real data exists; expose country→city mapping. |
| `…/Resources/Concordia/Canon/tunya/countries.json` (+ other worlds’ countries if added) | **Authoritative positions**, disputed borders, climate already present. |
| `…/Scripts/Settlement/SettlementCompiler.cs` + `PlotPlanner.cs` | Terrain-aware footprint; capital vs village density; district purpose from SettlementDef. |
| `…/Scripts/RealmFill.cs` (`CityTown`) | Remove/retire PlazaPad + CrossStreets as final city once compiler owns core; keep gate/plaque/beacon. |
| `…/Scripts/GeographyRuntime.cs` | Draw borders/routes from real waypoints; replace Prim markers with profile-aware dressing. |
| `…/Scripts/ContinentStream.cs` | Ensure full-chunk build calls the same compile path; LOD never drops settlement id state. |
| `…/Scripts/WorldVisualDirector.cs` + `WorldVisualProfileCatalog.cs` | Country-level stamp on Tunya slice; no new catalog. |
| `…/Scripts/ConcordClient.cs` | Keep kernel → CompileOne; kingdom status overlay. |
| `server/lib/settlements.js` + kingdom snapshot | Status / population / region_id remain kernel truth for Unity overlay. |
| Tests | Extend `SettlementRealKitTests` / `SettlementLiveBootTest` / `concordia-megaworld.test.js` — pin one-slice acceptance. |

**Do not create:** parallel `CityCompiler`, second `WorldGeography`, new visual-profile system, disconnected demo scene “cities.”

---

## 7. Recommended vertical slice (Phase 2–8 proof)

**ONE kingdom → ONE region → ONE city → districts → roads → buildings → NPC life**

| Choice | Value | Why |
|---|---|---|
| World | `WorldId.Tunya` | Only civilization with `countries.json` + country visual profiles + GoldenSlice already. |
| Kingdom / country | **Sangree** (`sangree` / Sandrun) | Fire-forge identity; `GoldenSliceRuntime` already pins forge / faction / settlement ids. |
| Region | Replace generic `tunya/region/heartland` locality with **Sangree country region** derived from country + anchors. |
| City | Capital from countries.json (**author real x,z first** — currently 0,0) or the GoldenSlice settlement id already in use. |
| Pipeline | `CityAtlas` → `SettlementDef` → `SettlementCompiler.Compile` (roads then buildings) → `NpcLife` workplaces on compiled plots → `WorldVisualProfileCatalog.ForTunyaCountry("sangree")`. |
| Out of slice | Other Tunya countries, ring international routes (keep as-is), Hub Court redesign, Playable Slice locomotion ban items. |

**Acceptance for the slice (maps to directive §17, narrowed):**
1. City position comes from authored Canon coords (not PlaceOnRing).
2. Districts visible as distinct street clusters from `SettlementDef.districts`.
3. Roads connect plaza/gate to district parcels (compiler), not only international cubes.
4. Buildings from ModuleKit (no greybox town when kit ready).
5. ≥1 workplace-bound NpcLife path using settlement services/district purpose.
6. Streaming unload of the chunk does not clear settlement slice / kernel status.
7. Visual profile reads Sangree (ash/forge), not generic Tunya grove.
8. Deterministic: same seed → same plan.
9. LeanPlay can thin density but must not leave PlazaPad as the only city read when kit is available.

---

## 8. Development order (bound to this audit)

| Phase | Action | Gate |
|---|---|---|
| **1** | This audit | Done |
| **2** | Author / derive map coords for Sangree (+ document scheme for remaining Tunya countries) | Capitals no longer all zero |
| **3** | Kingdom territory for Sangree from settlements + disputed_border + terrain theme | Spatial border, not rectangle scribble |
| **4** | RegionDef for Sangree country replaces ring-only for that locality | RegionAt returns country region |
| **5–7** | Drive SettlementCompiler from that SettlementDef; retire plaza slabs for that city | Navigable districts + buildings |
| **8–9** | Bind NpcLife + local nav to parcels | Jobs inside geography |
| **10–11** | Confirm ContinentStream LOD + WorldVisualProfileCatalog | Far = data, near = real |
| **12** | Perf + Play Mode hold on 16GB LeanPlay | No starvation regression |

---

## 9. What we will not do

- Place random buildings or hand-author ten cities.
- Treat LeanPlay PlazaPad / cube TradeRoutes as destination geography.
- Fork a new city/world generator beside `WorldGeography` + `SettlementCompiler`.
- Expand kernel megaworld schema while this pipeline is unproven (compose existing tables).
- Claim Fallout-4 density before the one-city slice proves the data→geometry path.

---

## 10. Kickoff sentence (locked)

> **Do not invent a new city/world system. Audit the existing Concordia map data and make that data drive the physical world — starting with one Tunya kingdom (Sangree) → one city compiled from SettlementDef.**

Phase 2 starts only when this audit is accepted and Sangree capital/anchor coordinates are made authoritative in Canon.
