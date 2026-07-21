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
| `weapon/dagger.glb` | `dagger.gltf` (Kay Lousberg, KayKit Adventurers) | `weapon-archetypes.ts` `dagger` archetype |
| `weapon/shortsword.glb`, `longsword.glb` | `sword_1handed.gltf` (Kay Lousberg, KayKit Adventurers) | `weapon-archetypes.ts` `shortsword`/`longsword` archetypes — same source file, two different `REAL_ASSET_NORMALIZATION` target sizes (0.67m / 1.05m); the pack ships one one-handed sword model, not two, so scaling one asset for both sub-tiers is the technique used here rather than a shortcut |
| `weapon/greatsword.glb` | `sword_2handed.gltf` (Kay Lousberg, KayKit Adventurers) | `weapon-archetypes.ts` `greatsword` archetype |
| `weapon/axe.glb` | `axe_1handed.gltf` (Kay Lousberg, KayKit Adventurers) | `weapon-archetypes.ts` `axe` archetype |
| `weapon/halberd.glb` | `axe_2handed.gltf` (Kay Lousberg, KayKit Adventurers) | `weapon-archetypes.ts` `halberd` archetype — a long-hafted axe reads reasonably as a halberd/poleaxe silhouette; not a bespoke halberd model |
| `weapon/crossbow.glb` | `crossbow_1handed.gltf` (Kay Lousberg, KayKit Adventurers) | `weapon-archetypes.ts` `crossbow` archetype |

11 of the pack's melee/carry weapons in total (dagger + 2 swords sharing 1
source + greatsword + axe + halberd + crossbow, alongside the 2 firearms +
staff + wand from the first pass) — plus their companion textures
(`knight_texture.png`, `barbarian_texture.png`, `rogue_texture.png`,
`mage_texture.png`, each shared across several models within the pack)
— all sourced from the SAME `git sparse-checkout` of
`KayKit-Character-Pack-Adventures-1.0` as the original staff/wand pass,
re-packed the same way with `gltf-transform copy`, and validated the same
way (`gltf-transform validate`, zero errors; `gltf-transform inspect`,
real non-degenerate geometry, 340–2,100 vertices each).

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
  clean, all 23 downloaded/re-packed GLBs confirmed valid glTF-binary via
  `gltf-transform validate` + `gltf-transform inspect` (real non-
  degenerate geometry, one textured material each), and (for the first
  12 — building/tree/creature) each asset independently rendered through
  a real Three.js `GLTFLoader`/SwiftShader pipeline with a visual check
  (not just "the code compiles"). The 11 weapon files added after that
  don't have the SwiftShader visual-check pass — this environment's
  weapon-sourcing work happened in a later session without that harness
  re-run; `gltf-transform inspect`'s geometry/material verification is
  the floor that was done for all of them.
- **`mace`/`club`/`scimitar`/`spear`/`bow`** have no sourced real asset —
  the KayKit Adventurers pack (the only weapon-bearing CC0 GitHub repo
  found reachable through this environment's egress allowlist — kenney.nl,
  itch.io, poly.pizza, and quaternius.com are all org-policy-blocked for
  this session, see `/root/.ccr/README.md`) doesn't include those 5
  shapes. They keep the existing procedural silhouette. So does every
  `Accessories.carry` value with no `weapon-archetypes.ts` archetype at
  all (`'satchel' | 'tome' | 'tool-belt' | 'pouch'`).
- **Discharge flash exists and is real, but it's a visual companion to
  attacking, not a ranged-combat system.** `AvatarSystem3D.tsx`'s
  `handleCombatAnim` — the same client-predicted trigger that already
  lights up the (separately pre-existing, unrelated) weapon-swing trail —
  now also checks whether the local player's equipped weapon is one of
  the 4 discharge-capable archetypes (`firearm_pistol`/`firearm_rifle`/
  `staff`/`wand`) and, if so, spawns a real particle burst
  (`concordia:particle-effect` → `world-vfx-bridge.ts`, already mounted,
  not a new pipeline) at that weapon's actual muzzle/tip world position
  via `weapon-archetypes.ts#getDischargeWorldPosition`. What this
  deliberately does NOT do: there is no ranged-attack input, no
  projectile, and no server-side ranged hit resolution anywhere in this
  codebase — the canonical combat model (see `CLAUDE.md`'s own "Skyrim-
  style action, NOT RTwP" invariant) is melee-reach-based, and this flash
  fires on the *existing* melee attack trigger regardless of which
  weapon archetype is equipped. Building real ranged combat (a `fire`
  input binding, a travelling projectile, server-authoritative ranged hit
  resolution) is a materially larger, separate feature — the
  `firearm_pistol`/`firearm_rifle` `ControlScheme`s in
  `lib/concordia/combat/control-schemes.ts` already describe the intended
  key bindings for it (`fire`/`aim`/`reload`/`scope` etc.) but are
  currently only rendered as a HUD legend reference
  (`ControlLegend`/`BARE_HANDS` in `app/lenses/world/page.tsx`), not
  wired to real input dispatch.
- **The firearm muzzle direction is a well-supported inference, not a
  verified one.** `REAL_ASSET_NORMALIZATION`'s `'center'` pivot for
  `firearm_pistol`/`firearm_rifle` assumes local +Z is "forward" (the
  muzzle end), inferred from both source files' bounding-box asymmetry
  (pistol: 0.9 vs 0.7 on ±Z; rifle: 1.18 vs 0.7 — consistent across both,
  and a rifle barrel being longer than its stock is physically what
  you'd expect on the longer side) — a reasonable, cross-checked
  heuristic, but this environment has no headless WebGL renderer to
  visually confirm it. If the flash ever visibly comes out the back of
  the gun instead of the barrel, that's the thing to revisit.
- **Real melee-weapon assets have no swing-trail hookup either way.**
  While auditing the trail block this pass touched, found
  `weaponTrailRef.current.setActive(true)` fires on every attack, but
  the trail's `.sample(position, nowSec)` — the call that actually feeds
  it a moving weapon-tip position each frame — is never invoked anywhere
  in the file. The trail mesh is added to the scene but its geometry
  buffer never receives a real sample, so `rebuildGeometry()`'s
  `samples.length >= minSamples` guard never passes and `mat.opacity`
  stays 0 forever — the weapon-swing trail effect has been fully inert
  since before this pass (predates it; not a regression from this work,
  and out of scope for what this pass set out to fix). Flagged here per
  this repo's incidental-bug-report policy.
