# Aura — bind free visual packs NOW

Unity project (already your project-root):
`apps/concordia-living-world/unity-client`

Visual bar: `apps/concordia-living-world/bible/CINEMATIC.md`
Aura skill: `.Aura/Skills/visual-fidelity/SKILL.md`

## Asset roots (on disk, imported by Unity)
1. `Assets/Concordia/PolyHaven/` — CC0 photoreal env kit (~13GB)
   - Textures/ Models/ HDRIs/
   - Read `PolyHaven/AURA_MANIFEST.json` + `PolyHaven/README_FOR_AURA.md`
   - Maps are `_2k.jpg`. That is the library.
2. `Assets/Concordia/FreePacks/` — chars, fauna, UI, VFX, audio, ambientCG
   - Read `FreePacks/AURA_MANIFEST.json` + `FreePacks/README_FOR_AURA.md`

## Do this (priority order)
1. **Index FreePacks** into Concordia FreePacks / DressVocab / WorldVisualDirector.
2. **Poly Haven materials** — URP Lit from Diffuse + nor_gl + arm; kill magenta + primitives.
3. **HDRIs** — assign per world (Court / Steel / outdoor biomes) via WorldVisualDirector.
4. **Cast** — keep Rocketbox Biped + CX Humanoid/grips. Do **not** replace the hero with Quaternius (reverted). Make the existing body belong in the light.
5. **Fauna + Nature Kit** — road scatter, settlement animals; no flat Plane.
6. **UI** — Kenney + Foozle Lucifer + Tiny RPG: Court parchment vs Steel themes, shared layout; Game-icons for skills (CC-BY credit).
7. **Look** — URP SSAO + soft shadows already attempted in `HubLook`; raise lighting/atmosphere/camera/VFX until the CINEMATIC shots hold.
8. **Audio** — Kenney RPG + interface SFX on combat/UI.

## Do NOT
- Use paid Asset Store packs
- Leave cubes / magenta missing-mats
- Point at `/Users/dutch/Concordia` or Setup Guide tutorial (deleted/stale)
- Treat bind/index as the cinematic finish
- Start a second look stack beside `HubLook`

## Success is not “indexed”
Binding packs is step one. The finish is `bible/CINEMATIC.md` — ten Play shots, not a successful compile. Poly Haven maps are `_2k.jpg`; do not claim 4K/8K.

## NOTE (2026-09-15)
Poly Haven kit is staged at `/Users/dutch/concordia-asset-staging/PolyHaven` (not under Assets) so Unity can boot.
Bind FreePacks first. Re-import Poly Haven in batches when disk allows.
