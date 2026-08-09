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

### The other 5 worlds — also real Rocketbox avatars now (2026-08-08, same session)

Extended to every remaining world with per-world variants. The Rocketbox
catalog turned out to be non-uniform in a way the first pass's "exactly 7
`.tga` files, canonical names" filter didn't capture: some avatars have no
`opacity_color` texture at all (FBX2glTF then emits 4 placeholder images,
not 5), and file-naming details vary avatar to avatar (`_acu` suffixes,
different numeric prefixes with no relation to the folder name). Rather
than hand-verify 30 more avatars against a fixed template, the pipeline was
made manifest-driven: every avatar folder under `Assets/Avatars/` was
scanned once (via the same blob-less `git ls-tree` partial clone, still
zero blob fetches) into a lookup table of each avatar's *actual*
`body_color`/`body_normal`/`head_color`/`head_normal`/`opacity_color`
filenames, filtered to avatars with ≤8 total textures (excludes
heavily-geared professions the same way the first pass's manual screen
did). The conversion script looks up real filenames per avatar instead of
assuming a template, and probes each GLB's actual texture count (4 or 5)
before patching — verified empirically first against a no-opacity avatar
(`Male_Adult_11`: FBX2glTF emits exactly 4 textures, order
`[bodyNormal, bodyColor, headNormal, headColor]`, no 5th slot) so the patch
step never guesses.

Per-world avatar selection (loosely themed per world's tone; no avatar is
reused within a world, and none collide with the universal set or
`concordia-hub`'s table above):

| World | warrior | guard | hunter | scholar | mystic | trader |
|---|---|---|---|---|---|---|
| `sovereign-ruins` | Male_Adult_01 | Male_Adult_04 | Male_Adult_06 | Medical_Male_01 | Female_Adult_06 | Female_Adult_07 |
| `cyber` | Male_Adult_08 | Male_Adult_09 | Male_Adult_10 | Business_Male_03 | Female_Adult_08 | Business_Female_04 |
| `fantasy` | Male_Adult_11 | Male_Adult_12 | Male_Adult_13 | Male_Adult_14 | Female_Adult_09 | Female_Adult_10 |
| `lattice-crucible` | Male_Adult_15 | Male_Adult_16 | Male_Adult_17 | Medical_Male_02 | Female_Adult_11 | Female_Adult_12 |
| `concord-link-frontier` | Male_Adult_18 | Male_Adult_20 | Pilot_Male_01 | Business_Male_04 | Female_Adult_13 | Female_Adult_14 |

All under `Assets/Avatars/Adults/` or `Assets/Avatars/Professions/` per
name (e.g. `Assets/Avatars/Adults/Male_Adult_01`,
`Assets/Avatars/Professions/Medical_Male_01`). `fantasy` intentionally
avoids Business/Medical/Military avatars (a business suit or lab coat
would read as a wrong-world mismatch); `sovereign-ruins` leans rugged
civilian + one medical for a "survivor camp" tone; `cyber` leans corporate
+ business for a corpo-hacker tone; `concord-link-frontier` includes a
real Pilot avatar for its exploration/scouting theme.

All 30 outputs validated clean (`gltf-transform validate`, 0 errors) and
inspected to confirm the right texture count landed (18 avatars got the
full 5-slot patch, 12 got the 4-slot no-opacity variant — both counts are
correct FBX2glTF behavior for those specific source avatars, not a bug).

`legend` in every world remains on the prior pass's Mixamo Xbot.glb — no
Rocketbox avatar obviously reads as "legendary" the way the other 6
archetypes map onto real professions/civilians, so it's left alone rather
than force-fitting a mismatch just because a replacement pipeline exists.

## The Three Above All (unchanged)

The four named-entity meshes (`sovereign_first_refusal.glb`,
`concord_first_thought.glb`, `concordia_first_breath.glb`,
`weaver_of_echoes.glb`) remain untouched — lore-unique characters that
deserve bespoke art rather than a reused stock rig.
