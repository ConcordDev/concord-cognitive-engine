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
