# World-asset credits (trees / buildings / creatures / weapons)

All files under `vegetation/`, `building/`, and `creature/` are sourced
from the **MomusPark** and **medieval-fair** collections by **Polygonal
Mind**, released **CC0** (public domain), catalogued by the
[Open Source 3D Assets](https://github.com/ToxSam/open-source-3D-assets)
registry (`data/projects.json` → `data/assets/pm-momuspark.json` /
`pm-medieval-fair.json`), original files hosted at
`github.com/ToxSam/cc0-models-Polygonal-Mind`.

Files under `weapon/` are sourced from two separate official creator
repositories (see the table below for per-file attribution):
[KenneyNL/Starter-Kit-FPS](https://github.com/KenneyNL/Starter-Kit-FPS)
(Kenney, CC0 — the repo's own MIT license covers the Godot project code
only, the README states "Sprites and 3D Models _(CC0 licensed)_") and
[KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)
(Kay Lousberg / kaylousberg.com, CC0 — "free to use in personal,
educational and commercial projects", attribution not mandatory but
credited here anyway). Both were downloaded via `git sparse-checkout`
(not `curl`+guessed paths) so every companion file (external texture
references, `.bin` buffers) came from the same commit and the same
directory as the model that references it — the two firearm files (which
Kenney's Godot GLTF export leaves as an external-texture-URI GLB rather
than a fully embedded one) were re-packed into single self-contained
`.glb` files with [`@gltf-transform/cli`](https://gltf-transform.dev/)
`copy` (embeds any external buffer/image reference into the binary
container; does not alter geometry, materials, or license) precisely so
`asset-loader.ts`'s single-URL fetch works — the wand/staff files needed
the same treatment for a different reason (KayKit ships them as loose
`.gltf`+`.bin`+shared-texture, not `.glb`). All four re-packed files were
verified with `gltf-transform validate` (zero errors) and
`gltf-transform inspect` (real non-degenerate geometry: 158–1,158
vertices each, one textured material each) before being committed.

Loaded via `lib/world-lens/asset-loader.ts`'s filesystem-convention
fallback (`/models/{kind}/{id}.glb`) — the same real-asset-first,
graceful-procedural-fallback pattern `lib/concordia/hero-mesh-registry.ts`
uses for characters. Drop a differently-named file in any slot to replace
it; delete a file to fall back to the existing procedural generator
(`l-system-tree.ts`, `procedural-buildings.ts`, `creature-mesh-builder.ts`,
`weapon-archetypes.ts`) for that slot — nothing else needs to change.

| File | Source name | Used for |
|---|---|---|
| `vegetation/tree_01.glb`..`tree_04.glb` | Tree_01_Art..Tree_04_Art (MomusPark) | `TreeLayer.tsx` — picked per-tree by a seeded hash for variety |
| `vegetation/bush_01.glb`, `flower_01.glb` | Bush_01_Art, Flower_01_a (MomusPark) | sourced, not yet wired to a consumer — vegetation-kind bonus content for a future pass |
| `building/tavern.glb` | Shelter_Art (MomusPark) | `BuildingRenderer3D.tsx` `tavern` archetype |
| `building/market.glb` | Booth_Food01 (medieval-fair) | `BuildingRenderer3D.tsx` `market` archetype |
| `building/archive.glb` | Str_Amphitheater_01_Art (MomusPark) | `BuildingRenderer3D.tsx` `archive` archetype |
| `creature/quadruped_01.glb`..`_03.glb` | DeerArmature, MountainLion, PigArmature (MomusPark) | `creature-renderer.ts` `quadruped` topology, picked per-creature by seeded hash |
| `creature/winged_biped_01.glb` | Owl (MomusPark) | `creature-renderer.ts` `winged_biped` topology |
| `weapon/firearm_pistol.glb` | `blaster.glb` (Kenney, Starter-Kit-FPS) | `weapon-archetypes.ts` `firearm_pistol` archetype — `carry: ['pistol']` |
| `weapon/firearm_rifle.glb` | `blaster-repeater.glb` (Kenney, Starter-Kit-FPS) | `weapon-archetypes.ts` `firearm_rifle` archetype — `carry: ['rifle']` |
| `weapon/staff.glb` | `staff.gltf` (Kay Lousberg, KayKit Adventurers) | `weapon-archetypes.ts` `staff` archetype — `carry: ['staff']` |
| `weapon/wand.glb` | `wand.gltf` (Kay Lousberg, KayKit Adventurers) | `weapon-archetypes.ts` `wand` archetype — `carry: ['wand']` |

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
- **Buildings/trees/creatures/weapons are un-tested by the diff-coverage
  gate** — `components/world-lens/` and `lib/world-lens/` are on this
  repo's documented jsdom-can't-exercise-WebGL exemption list
  (`scripts/check-diff-coverage.mjs` `SKIP` array), same as every other 3D
  rendering file in this codebase. Verified instead by: `tsc`/`eslint`
  clean, all 16 downloaded/re-packed GLBs confirmed valid glTF-binary via
  `gltf-transform validate`, and (for the first 12) each asset
  independently rendered through a real Three.js
  `GLTFLoader`/SwiftShader pipeline with a visual check (not just "the
  code compiles").
- **The 2 firearms and 2 magic items cover only a fraction of what's
  visibly equippable.** `character-schema.ts`'s `Accessories.carry` union
  also includes `'satchel' | 'tome' | 'tool-belt' | 'pouch'`, none of
  which render as a real prop (or a procedural placeholder) yet — same
  "declared but not wired" gap the firearms/wand were in before this
  pass. Melee weapons (`sword`/`axe`/`mace`/`dagger`/`bow`/etc. — the 12
  `weapon-archetypes.ts` archetypes that predate this pass) are still
  procedural-geometry-only; no real GLB exists for them.
- **No muzzle flash, no bolt/lever animation, no trigger-pull pose** —
  the firearm meshes render correctly held/holstered, but nothing about
  their appearance changes when the `firearm_pistol`/`firearm_rifle`
  control schemes' `fire` action is triggered. Actually firing (a real
  projectile leaving the barrel, a real muzzle-flash light/particle keyed
  to the shot rather than a generic swing/cast VFX) is unbuilt — a
  separate scope from "the gun is now visible," not silently assumed.
- **The staff/wand meshes are static props, not spellcast anchors.**
  They render correctly as carried items, but the existing per-element
  particle VFX (`element-vfx.ts`, `world-vfx-bridge.ts`) still spawns its
  burst at the caster's general position/target, not specifically at the
  staff/wand tip. Anchoring the burst origin to the weapon mesh's tip
  bone/vertex is a natural follow-up, not done in this pass.
