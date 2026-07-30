# Hero mesh asset credits

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

`legend` and every `_archetype_*__<world>.glb` per-world variant still use
the three.js-sourced Mixamo characters from the previous pass (Soldier.glb
→ warrior/guard/hunter's OLD per-world variants, Michelle.glb →
scholar/mystic/trader's OLD per-world variants, Xbot.glb → legend) —
sourced from `github.com/mrdoob/three.js`'s `examples/models/gltf/`
(MIT-licensed repo; their own example page credits "model from
mixamo.com"). Recoloring/re-authoring the per-world variants with more
Rocketbox avatars (there are 115 to choose from) is a natural follow-up,
not done in this pass for scope reasons.

## The Three Above All (unchanged)

The four named-entity meshes (`sovereign_first_refusal.glb`,
`concord_first_thought.glb`, `concordia_first_breath.glb`,
`weaver_of_echoes.glb`) remain untouched — lore-unique characters that
deserve bespoke art rather than a reused stock rig.
