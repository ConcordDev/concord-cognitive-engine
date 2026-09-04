# VISUAL

**Status:** LIVE (vocabulary + Kenney fallback) · PENDING (Asset Store packs not in this tree)  
**Authority:** Unity (presentation) — culture keys come from `WorldId`, never invented place names  
**Source:** `DressVocab` in `FreePacks.cs`, `CityTown` in `RealmFill.cs`, `BuildingInterior.cs`

## LIVE

`DressVocab` maps each Refusal world to a culture kit:

| WorldId | Culture | Dressing |
|---|---|---|
| Hub | court | Unpaved Court. No town dump. |
| Tunya / Fantasy / Frontier | grove | Houses, trees, crops / palms. Fantasy + Ruins also get a fort rim. |
| Ruins | ash | Crypt / remnant stems. |
| Crime / Sere | street | Shop / warehouse / dumpster. |
| Cyber / Superhero | grid | Lab / skyline stems. Robot Kyle is grid-only, never medieval population. |
| Crucible | drift | Crystal / tower stems. |

Resolution order: `Assets/Store` (and AssetStore / FreeAssets) → HubKit Kenney → primitive. A missing pack never blanks a town.

Interior LOD (Tunya hitch budget):

- city index 0 — four playable `BuildingInterior.Open` rooms
- cities 1–3 — `FakeWindows` glow quads, no playable mesh
- cities 4+ — exterior only

Dump: `/tmp/concordia-visual.txt` on `CityTown.BuildAll` and **Concordia → Asset Store → Dump visual audit**.

Kenney stays the prototyping fallback. Plaques still refuse invented names.

## Curated stack (raw material — do not depend on one pack)

Import under `unity-client/Assets/Store/`. Do **not** commit the ~1.8 GB town demo.

| Role | Pack | Store |
|---|---|---|
| Medieval town (first grab) | Slavic Medieval Village Free | [167010](https://assetstore.unity.com/packages/3d/environments/fantasy/slavic-medieval-village-free-modular-environment-kit-167010) |
| Hero settlement | Medieval Fantasy Town Village — Demo Scenes | [280621](https://assetstore.unity.com/packages/3d/environments/fantasy/medieval-fantasy-town-village-environment-demo-scenes-280621) — 1–2 towns only |
| Walls / holds | Medieval Fortification (free filter) | [search $0](https://assetstore.unity.com/search?q=Medieval%20Fortification&orderBy=1&price=0-0) |
| Trees | URP Tree Models | [253340](https://assetstore.unity.com/packages/3d/vegetation/trees/urp-tree-models-253340) |
| Grass coverage | Point Grass Renderer | [207854](https://assetstore.unity.com/packages/3d/vegetation/point-grass-renderer-207854) |
| Bulk flora | Low Poly Trees and Vegetation (free filter) | [search $0](https://assetstore.unity.com/search?q=Low%20Poly%20Trees%20and%20Vegetation&orderBy=1&price=0-0) |
| Wilderness | Mountain — Stylized Fantasy Environment | [307488](https://assetstore.unity.com/packages/3d/environments/landscapes/mountain-stylized-fantasy-environment-307488) |
| Combat clips | Human Melee Animations FREE | [165785](https://assetstore.unity.com/packages/3d/animations/human-melee-animations-free-165785) — Concordia SM stays authoritative |
| Extra NPC meshes | Distant Lands Free Characters | [178123](https://assetstore.unity.com/packages/3d/characters/distant-lands-free-characters-178123) |
| Sci-fi seed | Sci-Fi Lab Kit | [324212](https://assetstore.unity.com/packages/3d/environments/sci-fi/sci-fi-lab-kit-modular-stylized-low-poly-environment-assets-324212) |
| Industrial NPC | Robot Kyle URP | [4696](https://assetstore.unity.com/packages/3d/characters/robots/robot-kyle-urp-4696) |
| Window density | Fake Interiors FREE | [104029](https://assetstore.unity.com/packages/vfx/shaders/fake-interiors-free-104029) |
| Terrain gen | MapMagic 2 | [165180](https://assetstore.unity.com/packages/tools/terrain/mapmagic-2-165180) |
| Controller reference | Starter Assets — ThirdPerson URP | [196526](https://assetstore.unity.com/packages/essentials/starter-assets-thirdperson-updates-in-new-charactercontroller-pa-196526) — do not replace Concordia’s controller |
| FX | Particle Pack | [127325](https://assetstore.unity.com/packages/vfx/particles/particle-pack-127325) |

Editor: **Concordia → Asset Store → 01…15**. Downloads require a signed-in Package Manager (My Assets). This machine had no `~/Library/Unity/Asset Store-5.x` cache, so every pack above is **pending** until imported.

## TARGET

`KINGDOM + BIOME + CULTURE` (from authored WorldId / staple / ecology) dresses roads, stone, farms, vegetation, markets, walls, clutter, occupations. A toxic/industrial world uses the grid vocabulary, not the grove kit. Concordia never becomes visually dependent on a single store pack.

## Gap

Packs are not in the repo. Dressing still reads Kenney until My Assets lands under `Assets/Store/`. Combat clip graph is still incomplete (Human Melee not imported). Point Grass is not wired — EdgeFlora uses extra Kenney/PBR grass patches as the honest coverage until that renderer exists.
