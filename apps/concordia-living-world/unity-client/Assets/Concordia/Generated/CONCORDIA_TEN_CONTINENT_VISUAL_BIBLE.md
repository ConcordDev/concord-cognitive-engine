# Concordia — Ten-Continent Visual Bible

Status: executable presentation profile layer added; runtime shot and performance acceptance remain pending.

Canonical source: Megaworld Atlas / Concordia authored canon. This document defines presentation grammar only. WorldBuilder, WorldGeography, ContinentStream, GoldenSliceRuntime, persistence, simulation, and LeanPlay remain authoritative for world truth.

## Global visual rule

Concordia has one shared physical-quality floor and ten distinct visual identities.

Every continent must target:

- physically plausible PBR materials;
- believable scale and terrain formation;
- high-detail hero geometry;
- dense but intelligently culled vegetation or infrastructure;
- realistic water and shoreline treatment where water is present;
- atmospheric depth, shadows, contact evidence, weathering, and roughness variation;
- environmental storytelling with NPCs and usable places occupying the world;
- explicit L0-L4 presentation scaling instead of visibly degraded filler;
- authored architecture and material culture rather than repeated procedural cubes or generic asset-pack dressing.

## Presentation authority

The executable profile layer is:

`WorldVisualProfileCatalog`

It is consumed by:

`WorldVisualDirector → WorldHeroCatalog / WorldGeography / WorldBook / WorldWeatherFx`

`PresentationWorldProfile` delegates to the same catalog. No second renderer or gameplay authority is introduced.

## L0-L4 policy

- **L0 — Macro:** terrain, mountain/coast/city silhouette, roads, rivers, skyline, and simulation-backed data.
- **L1 — Cluster:** settlement, district, forest, ruin, industrial, or infrastructure cluster with hierarchical culling.
- **L2 — Staged chunk:** streamed terrain, authored anchors, profile dressing, hero binding, weather, and NPC presence.
- **L3 — Authored fidelity:** near-player hero geometry, material breakup, contact evidence, interaction colliders, and local atmosphere.
- **L4 — Interaction:** inspection, ownership, provenance, gameplay use, physical response, and causal presentation.

## Ten continent profiles

### Hub — The Unburned Court

Pre-industrial civic fantasy capital. Wet dressed stone, concentric walls, gates, arcades, archives, markets, forest canopy, banners, lanterns, layered repairs, and credible civic occupation. The Hub is the most believable place, not the most fantastical.

### The Sundering

High-magic sword-and-sorcery. Ancient forests, ravines, waterfalls, alpine terrain, House Voss, Wildwood root architecture, dragon territories, Thornwood construction, grounded luminous roots, magical pollen, rune scars, and environmental magic that preserves physical material credibility.

### The Frontier

Low-magic peer-mesh frontier. Small settlements, cabins, workshops, farms, relay gates, cairns, Walker Paths, weather stations, hand-built bridges, courier infrastructure, and long stretches where civilization visibly disappears into wilderness.

### Tunya

The largest multi-biome ark continent. It is country-driven rather than a single grove profile. The executable subprofiles include Masond cliff-arrival, Asbir buried archive/desert, Sangree fire-forge, Aekon glacial ark, Fluxom wet-industrial harbor, and Nil listening grove. Additional canon countries inherit the Tunya fallback until their dedicated grammar is authored.

### The Crucible

Unstable drift geography. Impossible transitions, folded strata, spatial seams, floating fragments, interrupted roads, contradictory water, unstable weather, and readable hero locations. Macro drift creates the contradiction; bespoke landmarks remain visually legible.

### The Grid

Near-future neon megacity. Wet pavement, dense utilities, food stalls, cables, service corridors, elevated transit, skybridges, tower silhouettes, surveillance infrastructure, atmospheric haze, Under-District maintenance spaces, and a Glitch Chapel where a broken AR layer appears physically embedded.

### Iron Coast

Grounded noir modern crime city. Brick warehouses, concrete apartments, docks, freight yards, overpasses, row buildings, garages, river markets, rain, steam, headlights, tungsten interiors, river fog, and ordinary places concealing criminal infrastructure. It is not cyberpunk.

### Aegis

Modern superhero metropolis. Glass, steel, concrete, giant transit networks, dense pedestrian life, parks, rooftops, recognizable skyline anchors such as Kane Tower, Bronx Arterials, low-rent districts, and neural clinics where advanced biological technology is ordinary civic infrastructure.

### Sovereign Ruins

Silent classical archive civilization. Marble, limestone, forums, libraries, temples, aqueducts, statues, cracked streets, moss, vines, birds, rain, dust, and functioning glyph/archive infrastructure. It is abandoned but not dead: books write themselves and the city continues to operate.

### Sere

Earth after centuries of extraction. Old Capital, Spire City, Furnace Belt, Breadlands, Flooded Lowland, Drowned Provinces, Contested Passes, Offshore Haven, River Delta, and Highland must read as exhausted real infrastructure rather than stylized wasteland. Pollution, extraction, flooding, repair, and survival are the visual history.

## Tunya profile rules

The Tunya country profile is resolved from authored `WorldBook.Country.country_id`, name, and theme. Profile markers preserve the chosen grammar on country anchors and staged dressing.

- Masond: cliff terraces, ark arrival, vertical pathways, bridges, and river works.
- Asbir: dunes, dry wadis, salt, buried structures, shaded courts, and preserved vaults.
- Sangree/Sandrun: blackened stone, ore routes, ash, furnaces, and heavy craft. The existing GoldenSlice forge remains the sole forge authority.
- Aekon: blue-white glaciers, exposed ark structures, frozen ruins, warm holds, and Ice Oath atmosphere.
- Fluxom: canals, dye industry, industrial harbor infrastructure, sanitation, and refugee movement.
- Nil: ancient roots, dense wet canopy, minimal construction, refusal-field approach, silence, and sparse bioluminescence.

## Acceptance rule

A registry entry, generated model, material, or profile is not visually complete by itself. Each world must eventually pass:

1. staged runtime instantiation;
2. named Play shot at L2/L3;
3. material, scale, collider, and lighting validation;
4. NPC/activity/environment evidence;
5. L0-L4 transition validation;
6. steady-state CPU/GPU/GC/render-stat measurement;
7. persistence and provenance inspection where the object is interactive.

The current profile/catalog pass is compile-clean and authority-safe. Authored water-place surfaces are now generated by `WorldWaterSurface` using the existing water material, but shoreline breakup, runtime travel, final shots, decals, APV, GPU Resident Drawer, GPU occlusion, true HLOD/impostor quality, and the steady-state benchmark remain explicitly unverified.
