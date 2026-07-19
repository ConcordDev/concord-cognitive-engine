# World-asset credits (trees / buildings / creatures)

All files under `vegetation/`, `building/`, and `creature/` are sourced
from the **MomusPark** and **medieval-fair** collections by **Polygonal
Mind**, released **CC0** (public domain), catalogued by the
[Open Source 3D Assets](https://github.com/ToxSam/open-source-3D-assets)
registry (`data/projects.json` → `data/assets/pm-momuspark.json` /
`pm-medieval-fair.json`), original files hosted at
`github.com/ToxSam/cc0-models-Polygonal-Mind`.

Loaded via `lib/world-lens/asset-loader.ts`'s filesystem-convention
fallback (`/models/{kind}/{id}.glb`) — the same real-asset-first,
graceful-procedural-fallback pattern `lib/concordia/hero-mesh-registry.ts`
uses for characters. Drop a differently-named file in any slot to replace
it; delete a file to fall back to the existing procedural generator
(`l-system-tree.ts`, `procedural-buildings.ts`, `creature-mesh-builder.ts`)
for that slot — nothing else needs to change.

| File | Source name | Used for |
|---|---|---|
| `vegetation/tree_01.glb`..`tree_04.glb` | Tree_01_Art..Tree_04_Art (MomusPark) | `TreeLayer.tsx` — picked per-tree by a seeded hash for variety |
| `vegetation/bush_01.glb`, `flower_01.glb` | Bush_01_Art, Flower_01_a (MomusPark) | sourced, not yet wired to a consumer — vegetation-kind bonus content for a future pass |
| `building/tavern.glb` | Shelter_Art (MomusPark) | `BuildingRenderer3D.tsx` `tavern` archetype |
| `building/market.glb` | Booth_Food01 (medieval-fair) | `BuildingRenderer3D.tsx` `market` archetype |
| `building/archive.glb` | Str_Amphitheater_01_Art (MomusPark) | `BuildingRenderer3D.tsx` `archive` archetype |
| `creature/quadruped_01.glb`..`_03.glb` | DeerArmature, MountainLion, PigArmature (MomusPark) | `creature-renderer.ts` `quadruped` topology, picked per-creature by seeded hash |
| `creature/winged_biped_01.glb` | Owl (MomusPark) | `creature-renderer.ts` `winged_biped` topology |

## Known limitations (honest, not hidden)

- **`forge` and `tower` building archetypes** have no real asset yet — they
  keep the existing procedural silhouette. Same for every `serpentine` /
  `eel` / `fish` / `shark` / `cephalopod` / `polyped` / `amorphous` /
  `humanoid` creature topology and `winged_quadruped`.
- **No baked gait animation** on real creature assets in this pass — they
  get a light idle bob (`wrapRealCreatureMesh` in `creature-renderer.ts`)
  instead of the procedural mesh's per-limb walk cycle. Honest tradeoff:
  real geometry/texture, simpler motion, rather than a fake walk animation
  bolted onto someone else's rig.
- **Art style is consistent but stylized** — MomusPark is a "avant-garde
  NFT gallery park" collection: flat-shaded low-poly geometry with
  painterly/swirled textures and crystal accents, not a photorealistic or
  neutral style. It reads as a deliberate, cohesive aesthetic (confirmed
  by rendering each file and looking at it), but it won't visually match
  every district's tone equally well — a district-appropriate re-skin is a
  natural follow-up, not a defect in what shipped.
- **Buildings/trees/creatures are un-tested by the diff-coverage gate** —
  `components/world-lens/` and `lib/world-lens/` are on this repo's
  documented jsdom-can't-exercise-WebGL exemption list
  (`scripts/check-diff-coverage.mjs` `SKIP` array), same as every other 3D
  rendering file in this codebase. Verified instead by: `tsc`/`eslint`
  clean, all 12 downloaded GLBs confirmed valid glTF-binary, and each
  asset independently rendered through a real Three.js
  `GLTFLoader`/SwiftShader pipeline with a visual check (not just "the
  code compiles").
