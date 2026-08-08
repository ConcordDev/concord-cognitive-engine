# Hero mesh asset credits

## Undead archetypes — a real visual for hostile NPCs (2026-08-08)

`server/lib/npc-archetypes.js` has real `body_type: 'undead'` NPC
archetypes (`undead`/`zombie`/`wraith`/`lich_king`/`plague_bearer`,
`faction: 'undead'`) that previously rendered as a color-tinted
procedural humanoid (the `undead: '#37474f'`/`'#546e7a'` body-type tint)
— no real mesh existed, unlike the 7 occupation archetypes below. Every
hostile/undead encounter looked identical to a friendly NPC wearing a
dark tint, which undercuts combat/horror content reading as designed.

Sourced from
[KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0)
(Kay Lousberg / kaylousberg.com, **CC0**, `LICENSE.txt` read directly),
downloaded via `git clone`. All 4 files are already self-contained `.glb`
(no repack needed) and passed `gltf-transform validate` clean. One
(`Skeleton_Warrior.glb`) was loaded in a real Godot 4.4 instance via
`tools/glb_load_probe.gd` under `xvfb-run --rendering-driver opengl3` and
the actual screenshot inspected: a real, unmistakably-toon-styled
skeletal warrior (helmeted skull face, armored bone limbs, red cape,
clawed boots) — visually distinct from every living archetype below, not
an ambiguous shape mistaken for something else.

Mapping is grounded in the source archetypes' own real game data
(`level_range`, `occupation`, `is_immortal`/`quest_giver`), not arbitrary:

| Archetype key | Source mesh | Real data justifying the pick |
|---|---|---|
| `undead` | `Skeleton_Warrior.glb` | generic `undead` archetype (`level_range [2,7]`, `occupation: 'wanderer'`) — the baseline hostile skeleton |
| `zombie` | `Skeleton_Minion.glb` | weakest tier (`level_range [1,4]`) — the smallest/least-armored of the 4 source meshes |
| `wraith` | `Skeleton_Rogue.glb` | higher tier (`level_range [5,9]`) — the source pack's agile/stealth-coded skeleton, fitting a wraith's speed theme |
| `lich` | `Skeleton_Mage.glb` | `lich_king` is `is_immortal: 1, quest_giver: 1` — a named boss-tier spellcaster, matched to the pack's mage-coded skeleton |

`plague_bearer` (`level_range [5,9]`) has no further distinct mesh
available among the 4 sourced — it keyword-matches to `undead`
(`hero-mesh-registry.ts`'s `OCCUPATION_KEYWORDS`), an honest reuse, not a
fabricated new asset. Wired into both clients with **zero new resolution
mechanism** — `ARCHETYPE_FALLBACK_PATH` + `OCCUPATION_KEYWORDS` in
`hero-mesh-registry.ts` (Three.js) already generically support any
archetype key; Godot's `AvatarRig`/`AssetResolver` already resolve
per-instance `archetype` values the identical way. See
`world-lens-godot/VISUAL_QA.md` for the Godot-side wiring + verification
record.

## R7 — the local player now actually uses these (2026-07-30)

Every asset below existed and was fully wired for hero NPCs before this
pass — but `components/world-lens/AvatarSystem3D.tsx` explicitly excluded
the LOCAL PLAYER from this path (`if (!opts.isHero || opts.isLocalPlayer)
return null`), so a player's own body always rendered as the enhanced-
avatar-builder's primitive sphere/box/cylinder geometry regardless of how
much real content sat unused right here. Fixed: the player is now eligible
for the same real-GLB path, via a new heuristic
(`archetypeForPlayerAppearance`) that maps the character-customizer's
body/clothing choices onto the closest of the 7 archetypes below.

**Known, honest limitation**: `loadHeroMesh` never applies
`appearance.skinColor`/`hairColor`/clothing colors onto the loaded GLB's
own baked materials — only the primitive/enhanced builder respects those.
So the player gets a real, professionally modeled body instead of a
primitive one, but not (yet) in the exact skin tone/hair color/clothing
color their customizer selections chose. Recoloring a real scanned/rigged
mesh per-option is a separate, larger content task (per-archetype texture
variants, or a shader-based tint pass) — not done in this pass.

## Universal archetype slots (current)

Six of the 7 base archetype slots now use **Microsoft Rocketbox** avatars —
a library of 115 professionally-modeled, rigged, textured (diffuse +
normal + specular) human characters, developed over ~10 years by Microsoft
Research and released under the **MIT license**
(https://github.com/microsoft/Microsoft-Rocketbox). Real fabric/skin
texture detail, not flat placeholder color — a meaningful step up from the
generic Mixamo test characters used in the previous pass.

| Archetype | Source avatar | Rocketbox path |
|---|---|---|
| `warrior` | Wood_Male_01 | `Assets/Avatars/Professions/Wood_Male_01` |
| `guard` | Sports_Male_01 | `Assets/Avatars/Professions/Sports_Male_01` |
| `hunter` | Gardener_Male_01 | `Assets/Avatars/Professions/Gardener_Male_01` |
| `scholar` | Business_Male_01 | `Assets/Avatars/Professions/Business_Male_01` |
| `mystic` | Female_Adult_02 | `Assets/Avatars/Adults/Female_Adult_02` |
| `trader` | Business_Female_01 | `Assets/Avatars/Professions/Business_Female_01` |
| `legend` | Xbot (Mixamo, via three.js) | unchanged from the prior pass — see below |

None of Rocketbox's 115 avatars are fantasy/combat-archetype-coded (it's a
research library: business/medical/fire/police/military/construction/
sports/everyday-adult characters) — the mapping above is the closest
reasonable thematic fit, not a perfect one. `legend` deliberately stays on
the previous pass's Mixamo Xbot rather than forcing a mismatched profession
onto it.

### Conversion pipeline (for reproducing or extending)

Rocketbox ships as FBX (3ds Max export) with TGA textures — not
glTF/GLB. Getting each avatar in required:

1. Download the avatar's `.fbx` + `Textures/*_{body,head,opacity}_*.tga`
   from the Rocketbox repo (`raw.githubusercontent.com`, no auth needed).
2. Convert FBX → GLB via Facebook's `FBX2glTF` (via the `fbx2gltf` npm
   package's bundled Linux binary). This produces correct geometry/skin/
   materials but 1×1 placeholder images — FBX2glTF can't resolve the
   FBX's internal texture references to real files.
3. Decode each TGA (via the `tga` npm package) and re-encode as PNG at
   1024px (via `sharp`), keeping the pipeline reasonable for a web game
   vs. the source 2048px assets.
4. Patch the GLB's 5 placeholder images with the real PNGs, in FBX2glTF's
   fixed emission order (verified empirically, consistent across every
   avatar tried): `[bodyNormal, bodyColor, headNormal, headColor,
   opacityColor]` — via `@gltf-transform/core`, which handles the binary
   buffer/bufferView bookkeeping correctly (no hand-rolled GLB patching).

### Bone naming — a second convention

Rocketbox rigs use 3ds Max's Biped naming (`Bip01 Pelvis`, `Bip01 L
Thigh`, `Bip01 L UpperArm`, ...), not Mixamo's `mixamorig:`-prefixed
convention. Rather than rewrite every asset's bone names,
`lib/concordia/hero-mesh-registry.ts`'s `buildBoneMap()` was extended
with a `BIPED_TO_CANONICAL` alias table so it now recognizes both
conventions — any future asset source just needs one more table entry,
not a GLB-mutating pass.

## `legend` and per-world archetype variants (prior pass, unchanged)

`legend` and every OTHER world's `_archetype_*__<world>.glb` per-world
variant still use the three.js-sourced Mixamo characters from the previous
pass (Soldier.glb → warrior/guard/hunter's OLD per-world variants,
Michelle.glb → scholar/mystic/trader's OLD per-world variants, Xbot.glb →
legend) — sourced from `github.com/mrdoob/three.js`'s
`examples/models/gltf/` (MIT-licensed repo; their own example page credits
"model from mixamo.com").

### `concordia-hub`'s 6 per-world variants — now real Rocketbox avatars (2026-08-08)

The "natural follow-up" flagged above (re-authoring per-world variants with
more of Rocketbox's 115 avatars) is done for one world — `concordia-hub`,
the flagship default world — as a concrete, verified slice rather than a
blind 36-file batch across all 6 worlds. Each is a genuinely distinct
avatar from its universal-slot counterpart (see the table above), so a
`concordia-hub` player reads as visually different from the site-wide
default, not a recolor:

| Archetype | `concordia-hub` variant | Rocketbox path |
|---|---|---|
| `warrior` | Male_Adult_03 | `Assets/Avatars/Adults/Male_Adult_03` |
| `guard` | Male_Adult_05 | `Assets/Avatars/Adults/Male_Adult_05` |
| `hunter` | Male_Adult_07 | `Assets/Avatars/Adults/Male_Adult_07` |
| `scholar` | Business_Male_02 | `Assets/Avatars/Professions/Business_Male_02` |
| `mystic` | Female_Adult_04 | `Assets/Avatars/Adults/Female_Adult_04` |
| `trader` | Business_Female_03 | `Assets/Avatars/Professions/Business_Female_03` |

Converted via the exact pipeline documented above (FBX2glTF → TGA→PNG via
`tga`+`sharp` → 5-texture patch via `@gltf-transform/core` in the
documented `[bodyNormal, bodyColor, headNormal, headColor, opacityColor]`
order), run as a standalone Node script against `raw.githubusercontent.com`
(the repo's real default branch is `master`, not `main` — verified before
fetching, not assumed). Each output validated clean
(`gltf-transform validate`, 0 errors) and inspected to confirm all 5
textures landed as real 1024×1024 PNGs in the correct material slots
(`baseColorTexture`/`normalTexture` on both `_body` and `_head` materials),
not left as FBX2glTF's placeholder images. Avatars were pre-screened via
`git ls-tree` against a blob-less partial clone to pick "plain" avatars
(body+head only, no extra equipment texture sets — Military/Fire/Police
professions carry helmet/gear textures that would need a 6th+ image slot
the documented patch order doesn't handle) before downloading anything.

`legend` and the other 5 worlds' per-world variants remain on the prior
pass's Mixamo characters — extending this to the rest is a mechanical
repeat of the same script with a new avatar-selection table per world, not
attempted further this pass for scope reasons (each world needs its own
"which 6 avatars fit this world's tone" judgment call, not just a
technical rerun).

## The Three Above All (unchanged)

The four named-entity meshes (`sovereign_first_refusal.glb`,
`concord_first_thought.glb`, `concordia_first_breath.glb`,
`weaver_of_echoes.glb`) remain untouched — lore-unique characters that
deserve bespoke art rather than a reused stock rig.
