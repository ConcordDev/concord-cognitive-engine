# Art direction — GTA × Palworld, ten Concordia worlds

Source of truth for look: `~/.zuko/ART_STYLE_GTA_PALWORLD_TEN_WORLD.md`. This file restates it for production and pins it to `WorldId`.

## Look

Stylized realism PBR. Not toon, not cel.

**GTA backbone.** Albedo, roughness, metallic, normal, AO. Micro-scratches, peel, rust, stains, harness gall, soot. Human-scale weight. Bevels wide enough to catch a specular at gameplay camera. Albedo has no baked lighting and runs slightly more saturated than a photograph. Fine detail lives in the normal map, not in noisy micro-geometry.

**Palworld infusion.** One readable mass. Bold silhouette at 100m and at the chase camera. Saturated light, crisp colored shadows by day, high-contrast practicals at night. One emissive accent, not a full-body glow. Forms stay clean; wear sits on the surface.

**100m test.** A pure black shape must still say what it is: stag, hound, griffin, sentinel, warden, tenement, spire. If it needs color to be identified, the silhouette has failed.

**Thin limbs.** Forbidden as the only hit surface. Pillar legs, thick coils, thick cables. Horizon's scorpion rejection applies.

## Humanoids

CX male and CX female are the body. Concordia face stays. Wardrobe is plates and cloth on `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. A mask is allowed on watchers and Census officers. A Quaternius body is not.

## Layering

Foundation is the world's own kit. Upper floors may show a faction retrofit (awnings, cables, iron) that does not erase the foundation silhouette. Traversal is built in: ledges, pipes, scaffolds, fire escapes, terrace lips, rib crawls, launch lips. Anchors are listed per kit.

## World matrix

| WorldId | Display | Style sector | Materials | Palette | Signature |
| --- | --- | --- | --- | --- | --- |
| Hub | Unburned Court | Court civic, GTA grit + Palworld lantern light | limestone, cobble, brass, timber | `#c4b49a` `#ffe6c0` `#6a5a40` `#c8721a` | Flower Law plaza, 42m, Arena exception, Pinewood Crossing outside the wall |
| Fantasy | The Sundering | Mythical | granite, moss, timber, thin gold leaf | `#3a6a48` `#c8b48a` `#6a5438` `#c8a060` | Held curse, ward steel, titan pillars |
| Tunya | Tunya | Solarpunk | CLT timber, solar tile, limestone | `#6a7a3a` `#f0d080` `#c8721a` | Terraces, grafts, do not reap |
| Ruins | Sovereign Ruins | Abyssal + ash | igneous, fossil bone, cold iron | `#5a5044` `#b89060` `#2a1c14` | Catalogue, unfinished death, rib structure |
| Crime | Iron Coast | Crime + diesel grit | stained brick, rust corrugate, asphalt | `#3a342c` `#8a6a48` `#c8a060` | Tenements, fire escapes, sodium lamps, the bill |
| Cyber | The Grid | Cyber | carbon, scratched glass, gunmetal, acrylic | `#1a1228` `#3dffa0` `#c45aa8` | Sky-bridges, physical neon banners, Census |
| Frontier | The Frontier | Wasteland + frontier | timber, salvage plate, canvas | `#c8b070` `#efe6d4` `#4a3828` | Open road, wagons, no dome |
| Superhero | Permanent Dawn | Superhero | marble composite, chrome, glass | `#d8d4dc` `#ffd0a0` `#3a78ff` | Spires, roof pads, refuse the final win |
| Crucible | The Crucible | Arcane + cosmic | basalt, quartz, obsidian glass, dark oak | `#204040` `#20ffd0` `#c8b4ff` | Unclosed patterns, leaning stairs that still snap |
| Sere | Sere | Wound / abyssal bleed | soot brick, oil concrete, brand tile | `#3a3428` `#c8a060` `#8a3030` | Furnace belt, compound Mark, no Flower Law |

Steampunk (brass, soot brick, clocks, copper pipe) is not its own world. It appears in the Iron Coast foundry, the Frontier dock, and the Unclosed Foundry blend.

## Three blends

Named in `architecture/INTERSECTIONS.md`:

- Uncounted Wharf — Grid into Iron Coast
- Held Crown Stair — Sundering granite under Dawn marble
- Unclosed Foundry — Crucible quartz through Crime brass

Unified ground, weathering that crosses the joint, pipes that become fiber.

## What this bible will not draw

- Cel outlines, chibi, pinup armor, generic orc kits, Vinewood signage
- Full-body fire auras, hologram clothing, particle-only creatures
- A rifle hero mesh while firearm verb coverage is zero
- A mounted-camera fantasy while the ride controller is absent
- Skull-bikini liches, hellfire hounds, parrot harpies, flamingo sealies
