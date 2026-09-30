# Art Style Reference Guide: The Ten-World Mega-Continent

## 1. The Core Aesthetic: GTA x Palworld Hybrid (Stylized Realism)
Stylized Realism PBR — not toony/cel-shaded. GTA backbone (surface truth, micro-wear, real scale) + Palworld infusion (clean bold silhouettes, saturated light, strong emissives, high-contrast ambient).

### Visual Pillar Split
- **GTA Backbone:** Full PBR (Albedo, Roughness, Metallic, Normal, AO). Micro-scratches, wear, peel, rust, stains. Human-centric proportions; weighty traversal.
- **Palworld Infusion:** Clean bold silhouettes, slightly amplified scale, curated lighting — saturated light temps, strong bounces, high-contrast emissives. No messy micro-geometry on forms.

### Technical Directives
1. High-fidelity textures; strip extreme HF noise from base meshes (readable at distance).
2. Day: bright + crisp colored ambient shadows. Night/dungeon: high-contrast saturated key lights.
3. Clean topology + visible bevels for specular definition.

## 2. Architecture: Functional Mashups + Unique Silhouettes
Aggressive verticality & traversal integration (scaffolds, pipes, ledges, pillars as climb/stunt anchors). Layering Rule: foundation = base world identity; upper levels = faction retrofits (tech/neon/augments).

## 3. Ten Worlds Architectural Matrix (style sectors)
| Style Sector | Materials | Palette | Signature |
|---|---|---|---|
| Cyber | carbon, scratched glass, gunmetal, acrylic | midnight blue, magenta, cyan, harsh white | sky-bridges, neon ad sheets |
| Crime | stained brick, rust corrugate, asphalt, rebar | sepia, rust, sodium yellow, asphalt grey | tenements + armored warehouses, fire escapes |
| Superhero | white marble composite, chrome, self-clean glass | daylight gold, platinum, royal blue | crystalline spires, levitating crowns, roof launchpads |
| Mythical | weathered granite, mossy jade, timber, gold leaf | emerald, bleached stone, terracotta, ethereal gold | titan pillars, floating shrines + runic chains |
| Arcane/Magic | obsidian glass, basalt, iridescent quartz, dark oak | amethyst, violet, charcoal, runic blue | non-Euclidean lean, cycling staircases |
| Steampunk/Industrial | riveted iron, brass, soot brick, copper pipe | smog copper, coal, furnace amber, gaslamp | clocks, steam vents, airship sky docks |
| Solarpunk/Eco | CLT timber, solar tile, limestone | flora green, timber beige, sky blue, warm sun | tree-trunk buildings, terrace farms, facade waterfalls |
| Wasteland/Diesel | armor plate, containers, salvage, mesh | sandstorm tan, oil black, hazard orange, primer grey | scrap forts on overpasses, drill/truck pillars |
| Cosmic/Alien | opalescent alloy, chromium, liquid polymer | void black, nebula pink, biolum lavender, chrome | seamless curves, dilating doors, orbiting shards |
| Underworld/Abyssal | igneous rock, fossil bone, cold iron | magma crimson, cave green, obsidian, sulfur | stalactite cities, ribcage supports over lava |

## 4. Intersection / Blend Zones
Cyber-Crime Slums of Tomorrow; Mythical-Superhero Pantheon of Champions; Arcane-Industrial Tech-Magic Foundries. Unified ground flooring; weathering bleed; utility cross-overs (pipes → fiber).

## 5. Lookdev Spec
- 100m silhouette rule
- Visible bevel widths (no infinitely sharp 90°)
- Albedo free of baked lighting; slightly more saturated than real
- Normal maps carry fine detail (not poly)

## Concordia WorldId Mapping (canonical)
| Style Sector | Concordia WorldId | Display |
|---|---|---|
| Mythical | Fantasy | The Sundering |
| Solarpunk/Eco | Tunya | Tunya |
| Underworld/Abyssal (+ ash) | Ruins | Sovereign Ruins |
| Crime (+ diesel grit) | Crime | Iron Coast |
| Cyber | Cyber | The Grid |
| Wasteland/Diesel (+ frontier) | Frontier | The Frontier |
| Superhero | Superhero | Permanent Dawn / Aegis |
| Arcane + Cosmic blend | Crucible | The Crucible |
| Wasteland wound / abyssal bleed | Sere | Sere |
| Court civic (hub) — GTA grit + Palworld light, Flower Law plaza | Hub | Unburned Court |
| Steampunk accents | mix into Crime foundries + Crucible forges + Frontier docks | — |
