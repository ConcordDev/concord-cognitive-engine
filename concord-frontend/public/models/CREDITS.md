# World-asset credits (trees / buildings / creatures / weapons / terrain)

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
| `vegetation/bush_01.glb` | Bush_01_Art (MomusPark) | `resource-node-renderer.ts` — real GLB for `herb` resource nodes (2026-07-21), real-asset-first ahead of the procedural icosahedron fallback |
| `vegetation/flower_01.glb` | Flower_01_a (MomusPark) | sourced, not yet wired to a consumer — vegetation-kind bonus content for a future pass |
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

### `mace`/`club`/`spear`/`bow` (2026-07-21, later same session)

A prior pass in this same session searched only 2 additional GitHub repos
beyond KayKit before concluding these 5 shapes were unavailable — too
narrow a search, not a real dead end (the domain-allowlist constraint
that blocks kenney.nl/itch.io/poly.pizza/quaternius.com/opengameart.org
is about which *file hosts* are reachable, not which *country* a creator
is in — GitHub itself is reachable regardless of who committed to it). A
broader search (11 repos checked) found real, committed `.glb` binaries —
not link-list READMEs — in
[SnowdenWintermute/speed-dungeon](https://github.com/SnowdenWintermute/speed-dungeon),
a dungeon-crawler game repo that bundles third-party OpenGameArt/Quaternius
weapon models with an explicit per-file artist-attribution table in its
own source (`packages/game-world-view/src/scene-entities/items/
equipment-base-item-to-asset-id.ts` + `../artists.ts`) — the repo's own
top-level `LICENSE.md` (PolyForm Noncommercial) covers its *code*, not
these bundled third-party assets, which retain their original OpenGameArt
licenses per that same attribution table (how the author was able to
legally bundle them in the first place). Sourced via `git sparse-checkout`
of the exact `packages/frontend/public/3d-assets/equipment/holdables/`
paths (not `curl`+guessed paths), re-packed with `gltf-transform copy`,
and validated with `gltf-transform validate` (zero errors for all 4;
`club.glb` had 4 harmless `UNUSED_OBJECT` hints — unused UV channels — for
severity-2 pre-repack, cleaned by the repack itself) and `gltf-transform
inspect` (real bounding-box + vertex-count data, cross-checked against
the source repo's own filenames before wiring — not assumed).

| File | Source name | License / artist | Used for |
|---|---|---|---|
| `weapon/mace.glb` | `mace.glb` (speed-dungeon, from OpenGameArt "19 Low Poly Fantasy Weapons") | **CC0** — Ryan Hetchler ([opengameart.org/users/ralchire](https://opengameart.org/users/ralchire)) | `weapon-archetypes.ts` `mace` archetype |
| `weapon/club.glb` | `club.glb` (speed-dungeon, from OpenGameArt "Stylised Fantasy Weapons") | **CC-BY 3.0 — attribution required.** mastahcez ([opengameart.org/users/mastahcez](https://opengameart.org/users/mastahcez)) | `weapon-archetypes.ts` `club` archetype |
| `weapon/spear.glb` | `spear.glb` (speed-dungeon, from OpenGameArt "19 Low Poly Fantasy Weapons") | **CC0** — Ryan Hetchler | `weapon-archetypes.ts` `spear` archetype |
| `weapon/bow.glb` | `recurve-bow.glb` (speed-dungeon, from OpenGameArt "19 Low Poly Fantasy Weapons") | **CC0** — Ryan Hetchler | `weapon-archetypes.ts` `bow` archetype |

**`club.glb` is CC-BY 3.0, the one non-CC0 asset in this whole
directory — this line IS the required attribution.** Per CC-BY 3.0 terms:
"Club" 3D model by **mastahcez** (OpenGameArt.org, "Stylised Fantasy
Weapons" pack), used under
[CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/), no modifications
to the model itself beyond re-scaling/re-pivoting for in-engine use (see
`weapon-archetypes.ts#normalizeRealAssetScale`). The license claim itself
comes from the speed-dungeon repo's own in-source comment
(`// https://opengameart.org/content/stylised-fantasy-weapons`) and
public per-file license metadata OpenGameArt.org displays for
CC-BY-licensed uploads, cross-referenced via web search — this
environment could not fetch opengameart.org directly (same
domain-allowlist constraint as everywhere else in this file) to
re-verify the live page, so treat this as sourced-but-not-independently-
re-confirmed, same honesty standard as the muzzle-direction inference
below. If this is ever wrong, it needs correcting, not silently trusting.

Other repos checked and rejected in this pass (real files existed for
some but licensing was unverifiable or absent, or the repo was another
link-list): `BoQsc/cc0-melee-weapons-pack-glb`,
`M3-org/base-meshes` (a real CC0 hit for `mace` too — redundant with the
speed-dungeon copy, not used, kept as a fallback source note),
`nanos-world/nanos-world-quaternius` (Unreal `.uasset` format, not
glTF-compatible), `KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0`,
`KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0`,
`SummerEngine/template-3d-voxel-sandbox` (had mace/scimitar files but no
verifiable license grant), `MolochDaGod/ObjectStore` (large asset dump,
no attribution/license at all — too risky), `ToxSam/open-source-3D-assets`
(real CC0 registry, but zero weapon items in its catalog). **`scimitar`
was not found in any of the 11 repos checked** and remains procedural —
see the Known Limitations section below.

## Terrain ground textures (2026-07-21, same session)

`TerrainRenderer.tsx` previously had **zero texture images** — every
zone (`grass`/`dirt`/`cobblestone`/`sand`/`asphalt`/`brick`/`gravel`/
`wild_grass`) rendered as a flat hardcoded per-vertex hex color on
Simplex-noise-displaced geometry. Loaded via a new
`lib/world-lens/terrain-textures.ts` (same real-asset-first,
graceful-fallback pattern as everything else in this file), tiled every
4m across each 250m terrain chunk, and multiplied against the *existing*
per-vertex AO/biome-blend/natural-variation color tint (that system is
unchanged — the real texture layers on top of it, doesn't replace it).

Sourced from **[Roblox/creator-docs](https://github.com/Roblox/creator-docs)**
(`content/en-us/assets/modeling/terrain/Material-*.jpg`), the official
Roblox developer-documentation repo's own terrain-material reference
images — real Git-LFS-tracked JPEGs (640×640), fetched via
`media.githubusercontent.com/media/...` (the LFS-resolving raw endpoint;
plain `raw.githubusercontent.com` only serves the LFS pointer text for
these), each visually inspected before use (real photographic/rendered
ground surfaces, not placeholders). **License: CC-BY 4.0**, per the
repo's own root `LICENSE` file and `README.md`'s "Licenses" section
("For prose, this project uses the Creative Commons Attribution 4.0
International Public License... Code samples are available under the
MIT License" — these images aren't code samples, so the general CC-BY-4.0
grant governs them). **This attribution line satisfies that requirement:**
ground textures by Roblox, from
[github.com/Roblox/creator-docs](https://github.com/Roblox/creator-docs),
used under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).

| File | Source name | Used for |
|---|---|---|
| `terrain/grass.jpg` | `Material-Grass.jpg` | `grass` **and** `wild_grass` zones — no separate wild-grass photo was sourced; the existing per-vertex zone-color tint still differentiates them |
| `terrain/dirt.jpg` | `Material-Mud.jpg` | `dirt` zone (Paths) |
| `terrain/cobblestone.jpg` | `Material-Cobblestone.jpg` | `cobblestone` zone (Docks district) |
| `terrain/sand.jpg` | `Material-Sand.jpg` | `sand` zone (River banks) |
| `terrain/asphalt.jpg` | `Material-Asphalt.jpg` | `asphalt` zone (Roads) — slightly blue-tinted in the source photo; the existing per-vertex tint pulls it back toward the zone's authored grey |
| `terrain/brick.jpg` | `Material-Brick.jpg` | `brick` zone (Exchange district) — Roblox's own terrain/ground material set, not a wall texture, so it's genuinely a ground-level brick surface |
| `terrain/gravel.jpg` | `Material-Ground.jpg` | `gravel` zone (Forge district) — **honest substitute, not a dedicated match.** Roblox's terrain material set has no separate "Gravel" entry; `Material-Ground.jpg` (a pebbly rocky-dirt surface, visually checked) was the closest available. A truer gravel photo would need a further targeted search — not done in this pass. |

Other sources checked and rejected: `mrdoob/three.js`'s own
`examples/textures/terrain/grasslight-big.jpg` (a real, independently
CC-BY-3.0-licensed grass texture per that folder's own `readme.txt` —
not used here since the Roblox set gave a matching style across all 7
zones, but a legitimate second option if this one ever needs replacing)
and `examples/textures/brick_diffuse.jpg` (real file, but no license
readme exists for it specifically, unlike the terrain folder — licensing
ambiguous, not used). Several GitHub hits for personal Unity/Unreal
game-dev repos had plausibly-sourced ambientCG/Poly Haven-style ground
textures but zero per-repo license or credit file — not used, per this
file's own standing rule of not trusting an asset's provenance without a
verifiable license signal.

### These 7 photos also feed the procedural PBR generator (same session)

`lib/world-lens/procedural-texture.ts` — the canvas-based synthetic PBR
generator used as the substrate fallback (tier 3) for building/interior
materials (`lib/world-lens/pbr-loader.ts`'s 3-tier resolution,
`procedural-buildings.ts`/`interior-decor.ts`) — previously synthesized
every material kind's colors from hand-picked hex constants (e.g.
`dirt: '#6b5230'`, `brick: '#3a2520'`). `lib/world-lens/
terrain-reference-palettes.ts` now carries real average/shadow/highlight
color statistics sampled directly from the 7 photos above (average color,
darkest sampled tone, lightest sampled tone — a ~102k-pixel stride sample
of each 640×640 photo via a headless-Chromium canvas read, real numbers,
not estimated). `procedural-texture.ts`'s generator mixes between those
real tones instead of arbitrary hex for every overlapping/new kind (dirt,
brick, plus 5 newly-added kinds with no prior procedural equivalent:
`grass`, `sand`, `cobblestone`, `gravel`, `asphalt`) — the existing
(kind, seed) space was already infinite via the generator's RNG-driven
speckle/pattern placement; this only changes what colors that infinite
space draws from, anchoring every generated variant to something a camera
actually saw. The 6 kinds with no terrain-photo counterpart (`stone`,
`wood`, `cloth`, `metal`, `leather`, `thatch`) are unchanged. Verified with
a real headless-Chromium WebGL render of the actual bundled module (not a
mock) during development — every kind produces a visually distinct,
recognizable material; the underlying RGB math was independently checked
against `terrain-reference-palettes.ts`'s real sampled values outside any
renderer to rule out a browser color-management artifact skewing the
visual check.

### `cloth`/`metal`/`leather` also grounded, from a different real source (2026-07-21, later same session)

The remaining 3 of the 6 previously-hardcoded procedural kinds
(`cloth`, `metal`, `leather` — `stone`/`wood`/`thatch` still have no real
reference and are unchanged) are now grounded too, via
`lib/world-lens/material-reference-palettes.ts`. Source: the same
`Roblox/creator-docs` repo (CC-BY-4.0, same license as the 7 terrain
photos), but a different asset type —
`content/en-us/assets/modeling/surface-appearance/{013_WornLeather,
023_WornMetals,07_CottonCanvasDenim}.png`, Roblox's own rendered
material-preview spheres for their SurfaceAppearance material catalog
documentation. **This is a genuinely different provenance tier from the
terrain photos and is documented as such in
`material-reference-palettes.ts`'s own doc comment** — these are rendered
PBR-material preview renders (a sphere lit against a white page
background), not flat photographed material swatches. Sampling used a
45%-center-crop (stays inside the sphere, away from the white background)
and an 8th/92nd luminance-percentile pick for dark/light instead of a
literal min/max (a literal min/max would have picked up the sphere's
specular hotspot and silhouette ambient-occlusion shadow — lighting
artifacts of the render, not material color). Unlike the terrain photos,
these preview images are not shipped in the repo or displayed anywhere —
only the extracted avg/dark/light statistics are used, so there are no
new files under `public/models/` for this entry.

`lib/concordia/armor-system.ts` (the 4-slot parametric armor-piece
builder — head/torso/arms/legs × heavy_plate/robed/leather/exposed
silhouettes) previously built every material as a flat solid-color
`MeshStandardMaterial` with zero texture detail. It now calls
`makePBR()` for a `normalMap`/`roughnessMap` pair keyed off silhouette
(heavy_plate→metal, robed→cloth, leather & exposed→leather) — real
material surface detail (brushed-metal streaks, leather crinkle, cloth
weave) layered on top. Deliberately `normalMap`/`roughnessMap` only,
never `map` (albedo): the real per-faction dye color
(`appearance.primaryColor`/`secondaryColor`/`accentColor`, still applied
via `material.color`) stays the actual displayed color — the texture
only adds surface detail, it doesn't override the color customization.

### Everyone wears their own armor now (2026-07-21, later same session)

`armor-system.ts`'s builder existed but nothing called it — `createArmorSet`/
`createArmorPiece` had zero callers anywhere in the app. Wired in two places:

- **`character-schema.ts`'s `generateAppearance`** now computes a real,
  individually-seeded `ArmorAppearance` for every character (archetype
  picks the default silhouette — warrior/guard/legend→heavy_plate,
  scholar/mystic→robed, hunter/trader→leather; civilians get a seeded
  pick between leather/exposed; colors reuse the character's own
  clothing palette so armor reads as one coherent outfit). The seed
  string is the SAME composite `worldId::factionId::id` this whole
  function hashes everything else from, so no two characters — including
  two NPCs of the same archetype/faction — read as recolored clones.
- **`enhanced-avatar-builder.ts`** (the local player + every hero-flagged
  NPC's procedural body) now builds and attaches that armor, scaled by
  `totalHeight / 1.75` (armor-system.ts's geometry is dimensioned for the
  'average' archetype's 1.75m reference height) and anchored at the
  correct body landmark per slot (head centers on the head mesh; torso +
  legs share the waist line; arms anchor the shoulder line — verified
  against armor-system.ts's own internal per-slot offsets).
- **`hero-mesh-registry.ts`** (`attachArmorToHeroMesh`) extends the same
  armor onto real hero GLB meshes (Microsoft Rocketbox / Mixamo rigs) via
  `Object3D.attach()` — the standard three.js technique for parenting a
  freshly-built object onto a bone while landing it at the bone's current
  world position with identity rotation (not the bone's own rest-pose
  local rotation, which for a limb bone points along the limb rather than
  world-up) — so armor pieces then move/rotate WITH the bone as the rig
  animates. Torso/legs attach to `Hips`, arms to `Spine2` (falling back to
  `Spine1`/`Spine`), head to `Head`; a skeleton missing a bone just skips
  that slot rather than throwing. `AvatarSystem3D.tsx` now computes the
  rich appearance (armor included) once, up front, and passes `rich.armor`
  into `loadHeroMesh` before attempting the GLB — the procedural fallback
  path reuses the same object instead of rolling a second one, so a hero
  NPC wears the identical deterministic kit whichever render path it
  actually takes.

Verified with a real headless-Chromium WebGL render of the actual bundled
`buildEnhancedAvatar` + `generateAppearance` modules (not a mock): three
different archetypes (warrior/scholar/hunter) render as three visibly
distinct characters — a dark-plated knight with pauldrons and a chest
sigil, a hooded robe reaching the ankles, and a tan leather-vest hunter
carrying a bow — proving the per-character seed genuinely drives visible
variety, not just distinct data. The bone-attach mechanism (parent
tracking, world-position landing, moves-with-the-bone-on-rig-animation)
is unit-tested directly (`tests/lib/hero-mesh-armor-attach.test.ts`); it
was not separately verified against a REAL Rocketbox rig's actual
rest-pose bone orientations in a live render (no real hero-GLB NPC was
available to render in this session's headless-browser harness) — flagged
as the one honest residual on this half of the feature, not silently
assumed correct.

One known, pre-existing architectural quirk this work exposed rather than
introduced: `generateAppearance`'s `override` parameter only overwrites
the FINAL returned object's fields — it does not retroactively influence
other fields computed earlier in the function from the pre-override
local variable (e.g. `override: { bodyArchetype: 'legend' }` does not
change `totalHeight`/`proportions`, which are derived from the seeded
pick before override is ever applied). Armor's own tier-5-for-legend rule
was fixed to read `override?.bodyArchetype` directly so authored deity
NPCs get it right, but the broader quirk (also affecting
`CharacterPreviewCanvas.tsx`'s live clothing-color selections not
retroactively recoloring armor) is a pre-existing characteristic of this
function's design, not something this session's scope covered fixing
everywhere it appears.

### Resource nodes are real, real-asset-first, and clickable (2026-07-21, later same session)

`lib/world-lens/resource-node-renderer.ts` (real per-node meshes polling
`GET /api/worlds/:worldId/nodes`, already wired into `ConcordiaScene.tsx`
via `attach-world-renderers.ts`) previously built every node kind from
flat-color procedural primitives only — no real asset was ever attempted,
and nothing on the mesh was clickable (the only gather UI was a
disconnected 2D "Nearby resources" HUD list). Two fixes:

- **Real GLB first for `tree`/`herb` node kinds.** Reuses the exact
  `loadAsset`/`instanceFromCache`/`resolveAssetReference` pipeline
  `TreeLayer.tsx` already uses (same real CC0 `tree_01-04.glb` variants),
  plus finally wires `bush_01.glb` (previously sourced but unused — see
  the vegetation table above) for `herb` nodes. `ore_vein`/`stone`/
  `crystal`/`spring` node kinds have no real asset available and keep
  their existing distinct procedural shapes (rock/crystal/water) — an
  honest gap, not silently hidden.
- **Click-to-gather.** Every built node object (real GLB or procedural)
  is tagged `userData.isResourceNode` + `nodeId` (recursively, via
  `traverse`, so a hit on any sub-mesh of a multi-mesh real GLB still
  resolves). `ConcordiaScene.tsx`'s existing canvas-click raycaster
  (already checks avatars → now resource nodes → buildings → terrain, in
  that priority order) dispatches `concordia:node-click`; `world/page.tsx`
  listens and calls the SAME `gatherFromNode()` the 2D HUD list's Gather
  button already used — one real gather call path, not two — with the
  same tool-swing + dust-particle feedback the freeform right-click
  gather path already had. A depleted node (rendered as a stump) shows an
  honest "depleted" message instead of a silent no-op.

A real concurrency bug was caught and fixed during development, not
shipped: making `reconcile()` async (real-asset lookups need to
`await`) meant two overlapping calls — the renderer's own construction-
time auto-refresh racing an explicit `refresh()` — could each pass the
"not yet tracked" check for the same node before either wrote back,
building and adding two objects for one node. Confirmed via a real
headless-Chromium render during development (5 server nodes rendered as
10 scene objects) before being serialized with a chained-promise guard
(`reconcileChain`) and re-verified (5 nodes → 5 objects).

### Gathering tools + NPC gather visibility (2026-07-21, later same session)

Two closing pieces for "AI NPCs will be cutting down trees... it's hard
to do that with no tool":

- **`axe`/`pickaxe`/`hoe`/`sickle` are now real `Accessories['carry']`
  values.** `axe` reuses the real `axe.glb` weapon archetype directly
  (`weapon-archetypes.ts`, `createWeapon({archetype:'axe',...})`) —
  holstered at the hip, not drawn — since a lumberjack's axe and a combat
  axe are the same object in this world; no second asset needed.
  `pickaxe`/`hoe`/`sickle` have no real GLB, so they're honest procedural
  props (wood-shaft cylinder + shaped metal head — a bent-cone pick, a
  flat-blade hoe, a curved-torus-arc sickle) in the same style already
  established for `tool-belt`/`tome`. `character-schema.ts`'s
  `generateAppearance` gives civilian (unmatched-archetype) characters a
  seeded 35% chance to carry one — "regular townsfolk" now read as
  people who actually chop/mine/farm, not generic idle extras.
- **NPC gathering is no longer silent.** `server/lib/npc-simulator.js`'s
  `gather_resource` action wrote only to the DB (`activity_resources` +
  `world_resource_nodes`) with zero broadcast. A new `_emitGather`
  (mirroring the file's own existing `_emitBark` pattern exactly) sends
  `world:npc-gather` with the real node's position/type/resource —
  `world/page.tsx`'s `handleNpcGather` bridges it into the SAME
  tool-swing + dust-particle feedback the player's own click-to-gather
  gets, targeted at the NPC's own entity id. An NPC gathering resources
  is now a real, watchable action.

## All of this session's assets are now registered in the evo-asset pipeline (2026-08-08)

Every real asset sourced this session — `building/forge.glb`,
`building/tower.glb`, `building/market__crime.glb`,
`building/archive__sovereign-ruins.glb`,
`building/tavern__concord-link-frontier.glb`, and the 4 undead hero
archetypes documented in `public/meshes/heroes/CREDITS.md` — is now
registered in `content/evo-seed/world-lens-manifest.json`, which
`server/lib/evo-asset/source-loaders.js#bootstrapWorldLensAssets` feeds
into the evo-asset registry at server boot. This is the real procedural
asset-refinement engine already in the codebase
(`server/lib/evo-asset/refinement-passes.js`'s geometry subdivision,
age/interaction-driven procedural wear, material upgrades, and LOD
generation, scheduled by `scheduler.js#runEvolutionTick`) — registering
these assets gives it genuine reference material to run those passes
against instead of only the 3 CC0 primitive-placeholder seed meshes.
Pinned by `server/tests/integration/evo-asset-world-lens-seed.test.js`.

## `building/archive__sovereign-ruins.glb` and `building/tavern__concord-link-frontier.glb` (2026-08-08)

The 2 remaining lore-matched candidates this doc's earlier entries
flagged as queued, now wired using the same per-world mechanism as
`market__crime.glb`:
- `archive__sovereign-ruins.glb` — `crypt.gltf` from
  `KayKit-Halloween-Bits-1.0` (Kay Lousberg, CC0). A real stone
  mausoleum/crypt facade, screenshot-verified in a real Godot render
  before use — matches `sovereign-ruins`' actual authored lore (`content/
  world/sovereign-ruins/factions.json`'s Three Archivists faction:
  "Sovereign Archive", "collapse memorial", "silent library") far better
  than the universal fantasy-toned archive building.
- `tavern__concord-link-frontier.glb` — `basemodule_A.gltf` from
  `KayKit-Space-Base-Bits-1.0` (Kay Lousberg, CC0). A small dome-shaped
  waypoint module with a landing ramp; screenshot-checked against the
  pack's larger cargo-depot pieces too before picking this one, since
  `concord-link-frontier`'s real lore (`content/world/concord-link-
  frontier/factions.json`'s Couriers' Guild: "link_post_alpha",
  "courier_safehouses", "human-scale walker network") reads as a modest
  waypoint/rest-stop, not bulk shipping infrastructure.

Both re-packed via `gltf-transform copy`, validated clean, and confirmed
to load in a real Godot engine render before being committed — same
discipline as every other asset in this file.

## `building/market__crime.glb` — first per-world building variant (2026-08-08)

Per explicit instruction to look at each sub-world's actual authored lore
before placing an asset, not just its genre label: `content/world/crime/
factions.json`'s Ghost Network faction literally controls
`dockside_warehouses` and `abandoned_subway_lines` — a grounded modern
urban-crime setting, not the fantasy-toned market/tavern/archive trio the
universal buildings serve. `KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0`
(Kay Lousberg, **CC0**, `LICENSE.txt` read directly) ships real modern
storefront/apartment buildings (`building_A`..`building_H`) — 3 candidates
(`building_A`/`C`/`E`) were re-packed and **actually screenshotted in a
real Godot render** before picking one (not judged from bbox stats alone):
`building_A` and `building_C` read as small single-shop storefronts;
`building_E` (2,397 real vertices) is a genuine 3-story orange brownstone
with a ground-floor shop, striped awning, and a fire hydrant — the most
convincingly "real modern city block" of the three, and the one used.

This is Godot-only today — `world-lens-godot/world/building_archetype.gd`
+ `assets/asset_resolver.gd`'s `fallback_url` gained a per-world
`{archetype}__{world_id}.glb` preference (mirroring the existing player/
npc hero-mesh convention), with a real two-stage retry in
`scene_bootstrap.gd` (per-world, then universal, then placeholder) so
every OTHER world/archetype pair without an authored variant is
unaffected — verified this doesn't regress by loading both
`market__crime.glb` and the pre-existing universal `market.glb` in a real
engine render, confirming both are independently real and reachable.
**The Three.js `BuildingRenderer3D.tsx`/`asset-loader.ts` path has no
`worldId` parameter to thread through yet — an honest, documented gap,
not a silent omission.** The component has no world context in scope
today; threading one through was judged a real, separate risk to the
flagship web client's existing building-render path rather than a safe
same-pass addition, and was deliberately deferred rather than done
blind. A future pass extending `AssetReference` with an optional
`worldId` and wiring it through whatever parent actually holds world
context is the concrete next step, not a redesign.

See `world-lens-godot/docs/KAYKIT_INVENTORY.md` for the two other
strongly lore-matched candidates queued for this same mechanism once
picked up: `concord-link-frontier` (real "Frontier"/courier/link-post
lore) + `KayKit-Space-Base-Bits-1.0`'s cargo depots/landing pads/base
modules; `sovereign-ruins` (real "Archive"/"collapse memorial"/"silent
library" lore) + `KayKit-Halloween-Bits-1.0`'s graves/coffins/crypt/
broken-fence set — a much better fit for a ruined, archival, funerary
setting than the horror-mode framing an earlier pass in this same
inventory doc first guessed at.

## `building/forge.glb` and `building/tower.glb` (2026-08-08)

**RESOLVED — both building archetypes now have a real CC0 mesh; the
"Known limitations" bullet below describing them as unavailable is
stale for these two and kept only for the still-genuinely-missing
creature/vegetation gaps.** Sourced from
[KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0)
(Kay Lousberg / kaylousberg.com, **CC0** — "free to use in personal,
educational and commercial projects", attribution not mandatory but
credited here anyway), downloaded via `git clone` (plain HTTPS to
GitHub — reachable in this environment even when the general
domain-allowlist blocks kenney.nl/itch.io/opengameart.org/etc, since
GitHub's git-protocol traffic rides a separate path from raw HTTPS
fetches; confirmed empirically this session).

This is a genuinely different source pack from the
`market`/`tavern`/`archive` trio above (Polygonal Mind) — a prior
session-long search of that same trusted source's 17 sub-collections,
plus `KayKit-Dungeon-Remastered-1.0`, came up empty for forge/tower (see
the "Known limitations" bullet's superseded text below and
`world-lens-godot/VISUAL_QA.md` for the full search record). The
Medieval Hexagon Pack is a *different* Kay Lousberg release built
specifically around named building types (blacksmith, tower, tavern,
market, church, mine, castle, barracks, ...) in 4 team-color palettes
(yellow/green/red/blue; no neutral variant exists for buildings, only
for terrain/wall/bridge pieces) — the `blue` variant was used for both,
picked as a reasonably neutral-reading slate/stone tone rather than the
brighter yellow/red.

Verified before shipping, not judged by filename: both source `.gltf`
files passed `gltf-transform validate` (zero errors/warnings) and were
loaded in a **real Godot 4.4 instance** via `tools/glb_load_probe.gd`
under `xvfb-run --rendering-driver opengl3` against a real local HTTP
server, with the actual rendered screenshot inspected — `forge.glb`
shows a stone furnace with a lit hearth, chimney, and a wood-and-canvas
lean-to stall (visibly a blacksmith, not an ambiguous shape);
`tower.glb` shows a complete, enclosed round stone tower with windows, a
door, and a conical roof (not the incomplete "modular base" trap the
prior tower search hit). Re-packed into self-contained `.glb` via
`gltf-transform copy` (same technique as every other re-packed asset in
this file — embeds the external `.bin`/texture references into one
binary container) and re-validated post-repack (clean).

| File | Source name | Used for |
|---|---|---|
| `building/forge.glb` | `building_blacksmith_blue.gltf` (KayKit Medieval Hexagon Pack) | `BuildingRenderer3D.tsx` / Godot `building_archetype.gd` `forge` archetype |
| `building/tower.glb` | `building_tower_A_blue.gltf` (KayKit Medieval Hexagon Pack) | `BuildingRenderer3D.tsx` / Godot `building_archetype.gd` `tower` archetype |

Both clients pick these up with **zero code changes** — `BuildingRenderer3D.tsx`
already derives its scale from the loaded GLB's own measured AABB against
the DTU's declared footprint (`cloned.scale.set(dtu.dimensions.width /
size.x, ...)`), and Godot's `scene_bootstrap.gd` does the identical
AABB-based rescale — both were already written to auto-pick-up a real
asset dropped into this convention-based path, the same as every other
building archetype.

## Known limitations (honest, not hidden)

- **`serpentine` /
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
- **RESOLVED (2026-07-21, later same session) — `mace`/`club`/`spear`/`bow`
  now have real sourced meshes; only `scimitar` remains procedural.** The
  original version of this bullet claimed all 5 shapes were unavailable
  after checking the KayKit pack + 2 additional link-list repos — that
  was a genuinely too-narrow search, not a real dead end. The
  domain-allowlist constraint (kenney.nl/itch.io/poly.pizza/
  quaternius.com/opengameart.org blocked, `/root/.ccr/README.md`) is
  about which *file hosts* this session can reach, not which *country* a
  creator or repo is from — a broader GitHub search (11 repos, any
  creator/region) found real committed binaries for 4 of the 5 missing
  shapes. Full sourcing detail + per-file license (including the one
  CC-BY 3.0 asset, `club.glb`, which requires attribution) is in the
  `mace`/`club`/`spear`/`bow` section above, not repeated here.
  `scimitar` genuinely was not found in any of the 11 repos checked and
  stays on the procedural builder — that part of the original claim
  held up.
- **`satchel`/`tome`/`tool-belt`/`pouch` now render real procedural
  props** (2026-07-21, same pass as ranged combat) — previously these 4
  `Accessories.carry` values had no branch in
  `enhanced-avatar-builder.ts` at all and rendered nothing, unlike every
  weapon carry value. Not routed through `weapon-archetypes.ts` (they
  aren't combat weapons, no tip/discharge point needed): a leather satchel
  box at the hip, a smaller front-center pouch, a torus tool-belt band
  with 3 tool cylinders around the waist, and a two-tone (cover + lighter
  "pages" sliver) tome strapped to the lower back — all using the same
  leather/cotton `PBR_REFERENCE` values the existing boots/cape props
  already use, colored from `clothing.belt.color` (a real, previously
  unused `ClothingKit` field) with a leather-brown fallback. Pinned by 7
  new tests in `tests/lib/enhanced-avatar-builder-carry-weapons.test.ts`.
- **Discharge flash exists and is real** — see below, it's now one part of
  a real ranged-combat path, not a standalone cosmetic. `AvatarSystem3D.tsx`'s
  `handleCombatAnim` — the same client-predicted trigger that already
  lights up the (separately pre-existing, unrelated) weapon-swing trail —
  checks whether the local player's equipped weapon is one of the 4
  discharge-capable archetypes (`firearm_pistol`/`firearm_rifle`/`staff`/
  `wand`) and, if so, spawns a real particle burst
  (`concordia:particle-effect` → `world-vfx-bridge.ts`, already mounted,
  not a new pipeline) at that weapon's actual muzzle/tip world position
  via `weapon-archetypes.ts#getDischargeWorldPosition`.
- **RANGED COMBAT IS NOW REAL (2026-07-21, same session as the
  weapon-trail fix above).** The prior version of this note said "there is
  no ranged-attack input, no projectile, and no server-side ranged hit
  resolution anywhere in this codebase" — that gap is closed:
  - **Fire input**: `CombatInputController.tsx` binds Mouse0 to
    `dispatchFire()`, gated on the resolved hand's `loadout.weaponClass`
    (already inferred from inventory item names by
    `server/lib/combat/loadout.js`) being `'pistol'`/`'rifle'`. A
    non-firearm loadout leaves left-click doing nothing here (falls
    through to `ConcordiaScene`'s ordinary interact-click), so melee
    players see no behavior change.
  - **Aim resolution**: `ConcordiaScene.tsx` runs a throttled (~20Hz)
    screen-center raycast against the avatars/buildings/terrain layers
    each frame while in a player-tracking camera mode, and publishes the
    result on the shared `cameraLookState.aimHitPoint`/`aimHitEntityId`
    bridge (`lib/world-lens/camera-look-state.ts`) — the same
    cross-component pattern already used for yaw/pitch/lock-on, since
    `CombatInputController` has no scene access of its own.
  - **Projectile visual**: a new pooled hit-scan tracer system
    (`lib/world-lens/projectile-tracer.ts`) draws a fading streak from the
    weapon's real muzzle point (`getDischargeWorldPosition`, unchanged) to
    `cameraLookState.aimHitPoint`, fired from the same discharge-flash
    block above. It draws the full-length line **instantly**, not a
    slow-traveling mesh — the server resolves ranged hits as an instant
    distance check (see below), so an animated travel-time projectile
    would misrepresent the actual mechanic; this matches how hit-scan
    weapons read in most action games.
  - **Server-side hit resolution**: `dispatchFire()` emits the same
    `combat:attack` socket event melee attacks already use, with
    `style: 'fire'`, and it resolves through the exact same
    `cityPresence.applyAttack()` distance-gated damage path as every
    other attack — no separate/parallel ranged-combat code path was
    built. Two real, independently-fixed bugs surfaced while wiring this:
    (1) the socket handler's `range` field had **no upper bound at all**
    (`Number(data.range) || 3`) even before this session touched it — a
    modified client could claim any range and "hit" a target anywhere on
    the map; now clamped via a new `combat-limits.js#clampAttackRange`
    to the same `COMBAT_MAX_REACH_M` (80m) ceiling the HTTP NPC route
    already enforced. (2) ranged fire needed its own cooldown class
    (`attack-cooldown.js`'s new `fire` track, 200ms) so it doesn't share
    a track with melee light attacks. Both are pinned by real behavioral
    `node:test` coverage (`server/tests/socket-combat-range-cap.test.js`,
    `server/tests/combat-cooldown-per-action.test.js`), and the client
    wiring is pinned by `tests/world-lens-ranged-combat-wiring.test.ts` +
    `tests/lib/projectile-tracer.test.ts`.
  - **Still honest gaps, not silently glossed over**: the
    `firearm_pistol`/`firearm_rifle` `ControlScheme`s in
    `lib/concordia/combat/control-schemes.ts` describe `aim`/`reload`/
    `scope` bindings beyond plain `fire` — those are NOT wired (no ADS
    zoom, no magazine/reload state, no scope overlay); only `fire` is
    real. Damage numbers (11 pistol / 16 rifle base) are a first-pass
    balance guess, not a playtested value — same caveat this file's other
    untuned constants carry. `armorPierce: 1` is a flat default, not
    per-weapon. The crosshair raycast reuses `ConcordiaScene`'s existing
    avatars/buildings/terrain layers verbatim; it does not account for
    partial occlusion nuance beyond "first raycast hit," so a shot that
    should clip a thin prop edge may resolve slightly differently than a
    player's eye reads it — an acceptable approximation, not a
    correctness bug.
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
- **CORRECTION (2026-07-21, later same session) — the weapon-trail claim
  directly above was wrong about the mechanism and has been fixed, not
  just flagged.** The original audit claimed `.sample()` was "never
  invoked anywhere in the file" — false; a real per-frame `trail.sample(...)`
  call site existed. The actual bug was one level deeper: that call fed
  it a position read from `pMesh.userData?.boneMap?.get('rightHand')`, a
  bone map ONLY `AvatarSystem3D.tsx`'s legacy procedural avatar builder
  (`createAvatarMesh`) sets — and `createAvatarMeshSmart`'s `wantEnhanced`
  flag is unconditionally `true` whenever `opts.isLocalPlayer` is set, so
  the real local player's avatar always comes from `buildEnhancedAvatar`
  instead, which never sets `userData.boneMap`. Net visible effect was
  identical (an always-empty trail, `mat.opacity` stuck at 0) but the
  cause was "the bone this specific avatar never has," not "the sample
  call doesn't exist." Fixed by having the per-frame block look up the
  player's actually-equipped weapon by name
  (`weapon_<archetype>`, `getObjectByName`) and read its real tip via
  `weapon-archetypes.ts#getWeaponTipWorldPosition` — a new, general
  "business end" point now computed for **every** archetype (widened
  from `dischargeLocal`, which only ever covered the 4 firearm/staff/wand
  archetypes the muzzle-flash needs) — falling back to the old boneMap
  lookup only if no equipped weapon is found (kept as a strict addition,
  not a narrowing, in case a future legacy-avatar caller relies on it).
  This is the exact "runtime-truth over source-guessing" mistake
  `CLAUDE.md` itself warns about, made and then caught within this same
  multi-session arc — recorded here rather than silently rewritten, per
  this repo's own "docs are a build artifact" discipline.

## Interior furniture — real CC0 meshes upgrade the procedural interior decor (2026-08-08)

`lib/world-lens/interior-decor.ts` previously rendered every building
interior (tavern/archive/forge/market/tower) with hand-built primitive
props only (box/cylinder/sphere geometry). Five real CC0 meshes now
upgrade the highest-impact primitives in place, following the same
real-mesh-first / honest-primitive-fallback pattern `resource-node-renderer.ts`
already established for trees/bushes — the primitive is still built and
returned synchronously exactly as before (so `decorateInterior`'s contract
and `propCount()` never change), and a best-effort async upgrade swaps in
the real mesh when it resolves, leaving the primitive untouched on any
failure. Source: `KayKit-Furniture-Bits-1.0` (Kay Lousberg,
kaylousberg.com), **CC0** — verified by reading `LICENSE.txt` directly in
the cloned repo, not assumed from the pack name. Repacked via
`gltf-transform copy` into self-contained `.glb`, validated clean.

| File | Source (`Assets/gltf/`) | Used by | Role |
|---|---|---|---|
| `prop/furniture_table.glb` | `table_medium.gltf` | tavern, archive | upgrades the primitive dining/reading table |
| `prop/furniture_rug.glb` | `rug_rectangle_A.gltf` | tavern, archive | upgrades the primitive floor rug |
| `prop/furniture_shelf.glb` | `shelf_A_big.gltf` | archive (×2) | upgrades the primitive shelf-with-scrolls assembly (the real mesh replaces both the shelf frame AND the procedural scroll props, since they're children of the same primitive group the upgrade hides) |
| `prop/furniture_cabinet.glb` | `cabinet_medium.gltf` | market | new extra dressing beside the stall counter — no procedural equivalent, honestly absent if the asset never resolves |
| `prop/furniture_armchair.glb` | `armchair.gltf` | tavern | new extra dressing near the fireplace — same honest-absence contract |

Registered into the evo-asset pipeline (`content/evo-seed/world-lens-manifest.json`,
`category: "prop"`) so the refinement-pass scheduler has real reference
material for this asset kind — `prop` was previously a declared `AssetKind`
in `asset-loader.ts` with **zero real files behind it anywhere in the
codebase** (flagged as a known gap in `docs/KAYKIT_INVENTORY.md`); this is
the first content in that slot.

## Market world-dressing — real CC0 crate/barrel/pallet props (2026-08-08)

Three more CC0 meshes from `KayKit-Prototype-Bits-1.0` (Kay Lousberg,
CC0 — verified via `LICENSE.txt` directly) close the "building variety +
world props" item's remaining half (per-world building variants were
already wired; this is the "crates/barrels near market stalls" world
props). Added as pure extras (no procedural equivalent) to the market
interior via the same `addRealMeshExtra` honest-absence contract:

| File | Source (`Assets/gltf/`) | Role |
|---|---|---|
| `prop/market_barrel.glb` | `Barrel_A.gltf` | storage-corner dressing opposite the cabinet |
| `prop/market_crate.glb` | `Box_A.gltf` | stacked beside the barrel |
| `prop/market_pallet.glb` | `Pallet_Small.gltf` | ground dressing under the crate |

Registered into the evo-asset pipeline (`category: "prop"`,
`world-dressing` tag) alongside the furniture set above. The remaining ~69
Prototype-Bits assets (generic blockout walls/floors/pillars/target props)
are genuinely genre-neutral blockout geometry per the pack's own stated
purpose — no further Concordia-specific fit identified this pass.

**Explicitly not attempted this pass**: a full house-furniture *placement*
renderer consuming `building_rooms.furniture_layout_json` (the per-coord
JSON substrate documented in `CLAUDE.md`'s Belonging-sprint invariants) —
that data exists server-side but has **no frontend consumer anywhere**
today (confirmed by grep — zero references to `furniture_layout_json`/
`furnitureLayout`/`placeFurniture` in `concord-frontend/`). Wiring it would
mean building a new player-house interior scene/UI, not a same-pass asset
swap-in into an already-live rendering path; a real, separate feature, not
silently implied as done by this section. The remaining 48 unused
KayKit-Furniture-Bits assets (beds, chairs, couches, cabinets, shelves,
bookcases, lamps, picture frames, more rugs) are the natural content for
that future renderer once it exists.

## Restaurant kitchen — real 3D interior, sourced from KayKit-Restaurant-Bits-1.0 (2026-08-08)

**Correction to the earlier session's finding on this same day**: it was
first concluded that Restaurant-Bits had "no consuming 3D surface" because
`RestaurantDashboard.tsx` (the 2D Diner-Dash overlay CLAUDE.md documents)
has no 3D scene of its own. That was true but missed the right mechanism —
`interior-decor.ts`'s `decorateInterior` is a **genre-agnostic archetype
system**, not tavern/archive/forge/market/tower-specific; a restaurant is
just a 6th archetype away, the same way every other building interior in
this codebase already works. Also found while wiring this: the reveal
system that toggles a building's interior visible on camera zoom/door-entry
(`interior-reveal.ts#shouldRevealInterior`) is itself real, tested, pure
logic with **zero live caller anywhere in the 3D scene** — its own file
header's claim of "a ConcordiaScene listener... reads this" is aspirational,
not yet true for ANY archetype. So today every archetype's interior (this
new restaurant one included) is real and mountable via
`attachInteriorDecor`/`setInteriorVisible`, but nothing in the live scene
calls those yet — a real, separate, deeper gap than "restaurant has no
kitchen," left honestly unaddressed this pass (it's not restaurant-specific
and fixing it safely means touching the large, load-bearing
`ConcordiaScene.tsx`, out of scope for this asset-sourcing session).

`restaurant` is now a 6th real `BuildingArchetype`
(`lib/world-lens/procedural-buildings.ts`) with its own procedural
diner-shaped exterior (flat roof + rooftop exhaust vent, distinct from
tavern's pitched-cone silhouette) and a matching `InteriorArchetype` in
`interior-decor.ts` whose interior is real-mesh-first from the ground up
(no procedural kitchen primitives existed to retrofit, unlike the
furniture/market cases above). `building-silhouette.ts` maps the real
`restaurant` station `building_type` (`StationInteractionRouter`'s
`ROUTER_TABLE` key) to it — previously fell through to the `market`
default.

| File | Source (`Assets/gltf/`) | Role |
|---|---|---|
| `prop/kitchen_counter.glb` | `kitchencounter_straight_A.gltf` | base counter (primitive-upgraded, same pattern as furniture_table) |
| `prop/kitchen_stove.glb` | `stove_multi.gltf` | cooking range |
| `prop/kitchen_hood.glb` | `extractorhood.gltf` | wall-mounted extractor hood over the stove |
| `prop/kitchen_fridge.glb` | `fridge_A.gltf` | walk-in-adjacent fridge |
| `prop/kitchen_dishrack.glb` | `dishrack.gltf` | dishrack |
| `prop/kitchen_table.glb` | `kitchentable_A.gltf` | prep/dining table |

Source: `KayKit-Restaurant-Bits-1.0` (Kay Lousberg, kaylousberg.com),
**CC0** — verified via `LICENSE.txt` directly. Repacked via `gltf-transform
copy`, validated clean. Registered into the evo-asset manifest
(`category: "prop"`, `restaurant`/`kitchen` tags). The remaining ~138
Restaurant-Bits assets (ingredient props, plated food, more counter/table
variants, paper-towel shelf) are the natural content for a future denser
pass on this same archetype — this pass covers the 6 pieces that make the
room read as a real kitchen, not the full catalog.

### `hub/` — Unburned Court shared kit (2026-09-03)

`public/models/hub/*.glb` is the **one starting piece** all three presenters
share (Unity `StreamingAssets/HubKit`, Vite `/models/kenney/`, Godot
`kind=hub` → `{base}/models/hub/{id}.glb`). Kenney CC0 props + KayKit
`forge.glb`/`tower.glb` already credited above. Full provenance:
`content/concordia-assets/hub/ATTRIBUTION.md`. Not the 118MB Kenney kitchen.

