# Concordia Lore-Generated Assets

This provenance ledger records generated assets grounded in authored Concordia lore and bound through the existing runtime authorities. Presence is not acceptance: each entry still requires scale, material, collider, staged construction, interaction, and a named Play-shot gate.

## Authority and integration contract

- Registry of record: `Assets/Concordia/Generated/WorldContent/WORLD_CONTENT_REGISTRY.json`.
- Canonical runtime path: `ConcordiaGame -> WorldBuilder -> ContinentStream -> WorldVisualDirector/GoldenSliceRuntime`.
- `WorldVisualDirector` owns world hero presentation and staged visual dressing.
- `GoldenSliceRuntime` remains the sole Tunya/Sangree forge spawn, gameplay, persistence, and interaction authority.
- `HubLook` remains the sole live URP look stack. Master materials are routed through the existing `FreePacks.ApplyMat` hook; property-block aging is routed through `PresentationSurfaceFidelity`.
- `ContinentStream` retains L1 impostors and L2/L3 staged full chunks. No travel rebuild, persistence rewrite, LeanPlay change, or second renderer was introduced.

## Bound world heroes

### Hub — Unburned Court canopy

- Asset: `Assets/Concordia/Generated/RealWorld/Concordia_Real_Oak.prefab`
- Binding: `Chunk_Hub/HubPlaza/CourtTree.Root`
- Semantic identity: `hub/unburned-court-canopy`
- Lore anchors: `hub_the_heart_claimed`, `hub_the_ring_of_doors`, `hub_the_one_conquest_attempt`
- Runtime authority: `HubPlaza.BuildStaged` and `HubLook.EnsureCourtTreeCanopy`
- Status: **BOUND / REUSED** — wrapper, banner aliases, lantern sockets, and inspection marker are staged; tree source resolution remains in HubLook.
- Material status: Court stone master remains in the existing HubLook WetStone path; tree is not overwritten by a second material authority.

### Ruins — Refusal Cascade Archive

- Asset: `Assets/Generated_Models/RefusalCascadeArchive/RefusalCascadeArchive.fbx`
- Generated material: `Assets/Generated_Models/RefusalCascadeArchive/RefusalCascadeArchive_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat`
- Binding: `Chunk_Ruins/VisualFidelity/RefusalCascadeArchive`
- Semantic identity: `ruins/refusal-cascade-archive`
- Lore anchors: `ruins_lore_glyph_discovery`, `ruins_lore_the_cascade`, `ruins_lore_evacuation`, `ruins_archivists`
- Status: **BOUND / GENERATED** — staged hero, master material hook, walkable collider, ConKay inspection identity, property-block surface aging, and ContinentStream L1/L2/L3 marker.

### Tunya — Sangree Fire Forge

- Asset: `Assets/Generated_Models/Concordia_Sangree_Fire_Forge/Concordia_Sangree_Fire_Forge.fbx`
- Generated material: `Assets/Generated_Models/Concordia_Sangree_Fire_Forge/Concordia_Sangree_Fire_Forge_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_ObsidianAshForgeStone.mat`
- Binding: `Chunk_Tunya/GoldenSlice_SandrunSanguire/ForgePresentation`
- Semantic identity: `concordia_real_forge`
- Lore anchors: `lore_vrellan_arrival`, `sangree`, `sandrun_sanguire`, `sangree_smith_orla`
- Runtime authority: `GoldenSliceRuntime.SettlementId`, `Present`, and `EnsurePresentation`
- Status: **BOUND / REUSED / GOLDENSLICE-AUTHORITATIVE** — WorldHeroCatalog validates and dresses the existing presentation only; it never creates a second forge or changes the gameplay authority.
- Play status: interaction and named visual shot remain **UNVERIFIED**.

### Fantasy — Root Curse Forest Shrine

- Asset: `Assets/Generated_Models/RootCurseForestShrine/RootCurseForestShrine.fbx`
- Generated material: `Assets/Generated_Models/RootCurseForestShrine/RootCurseForestShrine_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_RootCurseOrganic.mat`
- Binding: `Chunk_Fantasy/VisualFidelity/RootCurseForestShrine`
- Semantic identity: `fantasy/root-curse-forest-shrine`
- Lore anchors: `fantasy_the_unwatched_realm`, `lore_root_curse`, `fantasy_quiet_grove`, `wildwood_circle`, `fantasy_obsidian_crown`
- Status: **BOUND / GENERATED** — staged hero, root-safe collider, inspection identity, master material hook, surface aging, and L1/L2/L3 marker.

### Frontier — Mesh Gate

- Asset: `Assets/Generated_Models/FrontierMeshGate/FrontierMeshGate.fbx`
- Generated material: `Assets/Generated_Models/FrontierMeshGate/FrontierMeshGate_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat`
- Binding: `Chunk_Frontier/VisualFidelity/FrontierMeshGate`
- Semantic identity: `frontier/mesh-gate`
- Lore anchors: `frontier_lore_the_mesh_gate`, `frontier_lore_handshake_protocol`, `frontier_lore_freenode_emergence`, `frontier_couriers_guild`, `frontier_freenodes`
- Status: **BOUND / GENERATED** — deterministic-center hero, collider, inspection identity, master material hook, surface aging, and L1/L2/L3 marker.

### Crime — dockside / warehouse evidence hero

- Asset: `Assets/Generated_Models/CrimeHero/CrimeHero.fbx`
- Generated material: `Assets/Generated_Models/CrimeHero/CrimeHero_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_WetCourtStone.mat`
- Binding: `Chunk_Crime/VisualFidelity/CrimeHero`
- Semantic identity: `crime/dockside-warehouse-evidence`
- Lore anchors: `lore_first_truce`, `crime_anchor_disaster`, `lore_drone_swarm_aftermath`, `ghost_network`, `iron_rose_syndicate`
- Status: **BOUND / GENERATED** — generated exactly once from the audited brief; no truce, disaster, or drone aftermath is resolved. Master material, collider, inspection identity, surface aging, and L1/L2/L3 marker are staged through the canonical path.
- Missing feature status: **UNVERIFIED** — authored Crime rain-puddle decal and true decal renderer remain absent.

### Cyber — Grid mainframe / substation contrast hero

- Asset: `Assets/Generated_Models/GridHero/GridHero.fbx`
- Generated material: `Assets/Generated_Models/GridHero/GridHero_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat`
- Binding: `Chunk_Cyber/VisualFidelity/GridHero`
- Semantic identity: `cyber/mainframe-substation-blackout-contrast`
- Lore anchors: `lore_the_upload`, `lore_first_blackout`, `cyber_quarter_blackout`, `zero_collective`, `blackout_resistance`
- Status: **BOUND / GENERATED** — power/infrastructure contrast is staged without invented AI verdicts or faction alliances; collider, inspection identity, master material, surface aging, and L1/L2/L3 marker are bound.

### Superhero — Permanent Dawn unfinished rooftop

- Asset: `Assets/Generated_Models/PermanentDawnHero/PermanentDawnHero.fbx`
- Generated material: `Assets/Generated_Models/PermanentDawnHero/PermanentDawnHero_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat`
- Binding: `Chunk_Superhero/VisualFidelity/PermanentDawnHero`
- Semantic identity: `superhero/unfinished-dawn-rooftop`
- Lore anchors: `lore_first_battle_at_dawn`, `lore_first_sighting`, `lore_drone_swarm_incident`, `enforcers_movement`, `luminary_empire`
- Status: **BOUND / GENERATED** — unfinished rooftop language is staged; no final victory monument or resolved conflict is authored. Collider, inspection identity, material hook, surface aging, and L1/L2/L3 marker are bound.

### Crucible — Seven Doors

- Asset: `Assets/Generated_Models/SevenDoors/SevenDoors.fbx`
- Generated material: `Assets/Generated_Models/SevenDoors/SevenDoors_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat`
- Binding: `Chunk_Crucible/VisualFidelity/SevenDoors`
- Semantic identity: `crucible/seven-doors-unclassified`
- Lore anchors: `crucible_lore_seven_doors`, `crucible_lore_charter_question`, `crucible_lore_seventh_door_origin`, `crucible_lore_drift_walker`, `crucible_witnesses`
- Status: **BOUND / GENERATED** — seven-door visual is staged; no eighth/ninth door, classification, or Charter verdict is fabricated. Collider, inspection identity, material hook, surface aging, and L1/L2/L3 marker are bound.

### Sere — First Launch Cradle

- Asset: `Assets/Generated_Models/FirstLaunchCradle/FirstLaunchCradle.fbx`
- Generated material: `Assets/Generated_Models/FirstLaunchCradle/FirstLaunchCradle_Material.mat`
- Master material: `Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat`
- Binding: `Chunk_Sere/VisualFidelity/FirstLaunchCradle`
- Semantic identity: `sere/first-launch-cradle`
- Lore anchors: `lore_sere_the_ark_exodus`, `lore_sere_the_quiet_fall`, `lore_sere_second_twin_siege`, `the_open_table`, `the_clearing_spire`
- Status: **BOUND / GENERATED** — Ark Exodus terminal landmark is staged; Deep Watcher remains unpictured and unresolved. Collider, inspection identity, material hook, surface aging, and L1/L2/L3 marker are bound.

## Renderer and performance status

The renderer benchmark remains additive and uses the existing `Assets/Concordia/Generated/Performance/ConcordiaVisualBenchmark.unity` path.

| Feature | Status | Evidence / boundary |
|---|---|---|
| URP baseline / active renderer | ENABLED | Universal pipeline remains active; no renderer replacement. |
| Forward+ | DISABLED | Active renderer remains Forward; no unmeasured migration. |
| GPU Resident Drawer | DISABLED | Audited pipeline flag is 0. |
| GPU occlusion culling | DISABLED | Audited camera flag is 0; no separate Concordia implementation. |
| SRP Batcher | ENABLED | Audited pipeline flag is 1. |
| Adaptive Probe Volumes | DISABLED | Light Probe Groups remain the active path; no APV asset/component. |
| Temporal AA / reconstruction | PARTIAL | HubLook applies TemporalAntiAliasing High; reconstruction result is unverified. |
| HDR | PARTIAL | Camera HDR and HDR grading are runtime-enabled; HDR display/output is disabled. |
| Volumetric atmosphere | PARTIAL | HubVolumeFogFeature exists but is inactive; HubLook shader-global fallback remains. |
| Shadows | PARTIAL | Main-light runtime path exists; saved cascade/additional-light/soft-shadow state is not aligned. |
| Terrain and vegetation LOD | PARTIAL | No Concordia Terrain authority or regional vegetation LOD gate was found. |
| Impostors / HLOD | PARTIAL | ContinentStream custom distance bands and imported stand-ins; true HLOD/GPU path unverified. |
| Wetness / surface fidelity | PARTIAL | HubLook + PresentationSurfaceFidelity property-block/PBR path; decals/engraved plate remain open. |
| Decals | MISSING | No DecalProjector or decal renderer feature. |
| Reflections | PARTIAL | HubLook realtime probe path exists; cross-world validation remains unverified. |
| Water | MISSING | No live water renderer; WaterPuddle is shader-level support only. |
| Wind / cloth / hair | PARTIAL | Lightweight transform sway and primitive hair only; production simulation/LOD unverified. |
| World streaming | ENABLED | ContinentStream and WorldStreamManager remain live authorities. |
| Streaming frame budget | PARTIAL | WorldStreamManager 3.5ms drain budget and staged yields are preserved. |
| Shader variants | PARTIAL | No ShaderVariantCollection or build stripping coverage report. |
| Render Graph | PARTIAL | HubVolumeFogFeature uses RenderGraph; project-wide validation/cost capture absent. |
| Measured runtime performance | INCONCLUSIVE | Stable Play capture is still required for Hub, each new hero, impostor/full chunk, and CPU/GPU/GC/render counters. |

## Open / unverified gates

- Named Play shots and stable runtime interactions for every bound hero are **UNVERIFIED**.
- GPU timing, end-to-end frame envelopes, GC deltas, material/draw/triangle budgets, and memory/VRAM budgets require a representative Play run.
- Crime rain-puddle decal, live water surface, APV, Forward+, GPU Resident Drawer/occlusion, shader variant coverage, true HLOD/GPU impostors, HDR display output, production cloth/hair simulation, and authored engraved/puddle geometry remain open or unsupported.
- Existing mesh-readability warnings for `island_tree_03_LOD0` and `Lantern_01/Lantern_01_glass`, plus missing-pack warnings, remain outside this integration and must be resolved or explicitly excluded before sign-off.
