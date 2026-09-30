# Concordia Asset Bible

Status: **v0.2 — living contract** (not a claim that every listed family is acquired or bound).

Date: 2026-09-19

Locked vs open (this revision):

| Topic | State |
|---|---|
| Source hierarchy + license row schema | **LOCKED** |
| Authority / evidence table | **LOCKED** (extend, do not replace stacks) |
| Asset classes (Hero / Modular / Scanned-detail) | **LOCKED** |
| Family-to-kit conversion minimums | **LOCKED** as targets |
| North-star plate lighting / materials / socket / vegetation recipe | **LOCKED** to Unburned Court plate |
| Tunya culture design languages (Masond / Asbir / Aekon / Fluxom / Nil / Court) | **LOCKED** to brief table (v0.1 grammars were drift — rewritten below) |
| Unburned Court kit ledger + Hub Court source matrix | **LIVING** — evidence-backed; many leaves still **MISSING** or **CANDIDATE** |
| Continent kit rollout beyond Court first slice | **OPEN** |
| Megascans entitlement / Sketchfab specialty imports | **OPEN** — record before integrate |
| LeanPlay / staged construction / fps budgets | **LOCKED** — do not set LeanPlay=false; keep staged yields |

North-star plate: `~/.zuko/remaining-work/CONCORDIA-ART-STYLE-REF-court-tree.jpg` (Unburned Court / Hub).

---

## North Star

The Unburned Court is the visual benchmark: a real ancient tree dominates the north composition; teal atmospheric depth sits behind warm canopy-filtered key light; red cloth is tensioned from real sockets on branches or stone; the ground is wet, engraved, beveled stone with readable puddles and contact darkening; architecture is weathered, mossy, and physically assembled; the hero's dark plate and ember veins remain readable under rim light. Unity primitives may remain only as hidden gameplay/collider scaffolding or as an explicitly marked temporary blockout. They are not visual identity.

---

## Authority and evidence

| Evidence | Current project fact | Consequence |
|---|---|---|
| `Assets/Concordia/Scripts/HubLook.cs` | Existing URP look stack owns sky, grading, PBR helpers, Court rig, puddles, banners, and hero rim | Extend this stack; do not create another renderer/look stack |
| `Assets/Concordia/Scripts/HubPlaza.cs` | Court floor, gates, Sanctum, banners, clutter, lights, and staged construction are runtime-generated | Refactor these builders in place and keep staged yields |
| `Assets/Concordia/Scripts/FreePacks.cs` | Asset index spans imported packs, Poly Haven, generated assets, and FreePacks; `SpawnStore` intentionally gates visual-grade content | Route all visual kit resolution through a source-aware catalog; never silently cube-fallback |
| `Assets/Concordia/PolyHaven/` | Poly Haven HDRIs (~100 `_2k`), Models (~349), Textures (~791) are present | Use as one material/HDRI/nature layer, never as Tunya identity; project copy is `_2k` / `_1k` meshes — do not claim 4K/8K |
| `Assets/Concordia/FreePacks/` | Kenney, Quaternius, fauna, UI, VFX, Nature Kit, ambientCG stub, audio present | Kenney/Quaternius remain utility/prototype or non-identity source tiers |
| `Assets/Concordia/Generated/RealWorld/` | Present: `Concordia_Real_ForestGrass`, `Concordia_Real_ForestTree`, `Concordia_Real_Oak`, `Concordia_Real_Forge`, `Concordia_Real_Industrial_Hangar` | Candidate modular/scanned-detail / hero-tree inputs — not finished heroes until integrated and shot-tested |
| `Assets/Concordia/Scripts/ContinentStream.cs` | Wilderness construction is staged and frame-budgeted | Any new dressing must be staged and respect LeanPlay budgets |
| `Assets/Concordia/Generated/runtime-stage.txt` and `play-heartbeat.txt` | Runtime stability is still under verification after staged road seeding | Art changes must not reintroduce synchronous population or visual bursts |

---

## Source hierarchy (non-negotiable)

1. **Real-world photography** — design truth. Use for proportion, joinery, wear, material culture, settlement logic, and silhouette. Required coverage includes African and North/South American architecture; medieval/early-modern towns; industrial cities; ports; cliff, desert, mountain, and glacier settlements; forests, wetlands, farms, ruins, caves, fortifications, bridges, roads, markets, workshops, mines, ships, docks, interiors, furniture, clothing, tools, weapons, signage, and religious structures. Photography is reference unless a separately licensed production asset is acquired.
2. **Megascans** — photoreal environmental mass/detail: cliffs, boulders, vegetation, debris, and industrial clutter. License and project entitlement must be recorded before integration. **OPEN** — entitlement not recorded in this Bible yet.
3. **Poly Haven** — materials, HDRIs, nature, and props; one layer only. The question is always “what physical asset families does this place need, and what is the best source for each?” Never “find Poly Haven assets for Tunya.” Project copy is `_2k` HDRIs / `_1k` many meshes; do not represent it as 4K/8K.
4. **Sketchfab** — specialty candidates only after license check. Required lifecycle: reference → candidate → license → import → scale/material/socket/collider audit → integrate → Play shot.
5. **Kenney** — utility/prototyping only: placeholders, colliders, UI, debug, and explicit non-identity prototypes. Never Court/Tunya visual identity.
6. **Custom Blender/Unity** — Concordia kits derived from the grammars below; all generated pieces require provenance and a validation record.
7. **Hand-authored heroes** — bespoke landmarks: Hold of First Arrival, Curated Vault, Listening Grove, Aekon Ark, Vessine Choir, Fluxom harbor, Tunyan ruins, and the Unburned Court tree plate.

### License rule for every asset-family ledger row

Every row must carry:

- primary source and exact asset/candidate identifier;
- secondary source or explicit `none — bespoke`;
- license type and attribution obligation;
- whether the file is actually present in this Unity project;
- import path and source checksum/URL in the private acquisition ledger;
- permitted use (`reference`, `scanned-detail`, `modular`, `hero`, `utility-only`);
- required attribution file update;
- whether redistribution in WebGL/build is permitted;
- scale, material, collider, LOD, socket, interaction, and provenance status.

No asset is production-ready when its license is unknown.

---

## Asset classes

### Hero

Bespoke, authored landmarks with unique silhouette, composition, interaction anchors, lore provenance, and named shot-gate coverage. Heroes do not come from arbitrary pack-stem selection. Required examples: Unburned Court tree plate, Hold of First Arrival, Curated Vault, Listening Grove, Aekon Ark, Vessine Choir, Fluxom harbor, and Tunyan ruins.

### Modular

Reusable kits with controlled dimensions, snap points, material slots, damage/wear variants, doors/roofs/foundations, gameplay sockets, and LOD variants. A modular piece must be usable in more than one authored composition without becoming visual soup.

### Scanned-detail

Photogrammetric or high-detail surface/prop inputs used for close-up breakup, decals, rocks, bark, debris, engravings, wetness, and contact evidence. Scanned detail cannot be used as a whole-place generator without a grammar and composition pass.

---

## Family-to-kit conversion rule

A reference family becomes a kit only after a coverage map exists. Minimum example for an architectural family:

- 30+ reference images: proportion, material, climate, joinery, openings, roofline, street edge, interior threshold, wear, and ornament study;
- 12 modular wall/facade modules;
- 8 foundations/plinths;
- 6 roof modules;
- 6 corner/termination modules;
- 6 opening modules;
- 4 stair/ramp modules;
- 4 structural column/beam modules;
- 4 material/wear variants;
- 3 door/gate modules;
- 3 signage/utility modules;
- 3 debris/contact-detail families;
- 2 LOD groups plus collision variants;
- socket map for banners, lamps, cables, doors, NPC work, storage, and interaction.

This is a minimum for a place-defining family, not a promise that every family needs exactly these counts.

---

## World coverage ledger

| Family | Primary source | Secondary source | License rule | Class | Current project evidence | Required integration |
|---|---|---|---|---|---|---|
| Terrain, cliffs, boulders | Real-world photography + Megascans candidates | Poly Haven nature/materials | Megascans entitlement and Poly Haven CC0 record required | Modular + scanned-detail | Poly Haven models/textures/HDRIs present | biome grammar, scale, scatter, LOD, collider, shot |
| Wet ground, stone, engraved paving | Real-world photography | Poly Haven textures + Concordia material/mesh | Poly Haven CC0; custom mesh provenance | Modular + scanned-detail | `HubLook.WetStone` + `cobblestone_square` present; **engraved atlas MISSING** | engraved atlas/mesh, puddle masks, bevels, contact darkening |
| Ancient trees, roots, canopy | Real-world photography | Poly Haven nature + custom Blender hero | source license recorded; custom hero owned by Concordia | Hero + modular + scanned-detail | `Concordia_Real_Oak` / `ForestTree` + PH trees present as **candidates** | north composition, branch sockets, canopy LOD, root collision |
| Vegetation and understory | Real-world photography | Megascans/Poly Haven | exact source/license per species family | Modular + scanned-detail | FreePacks Nature (Kenney — utility only) + Poly Haven folders present | regional species grammar, density budget, wind response |
| Court architecture | African/medieval/early-modern stone references | Sketchfab specialty after license, custom kits | no unknown-license mesh in build | Hero + modular | `large_iron_gate` present; Court still uses generated/Prim fallback paths | bespoke weathered kit, moss/wetness, openings, sockets |
| Tunya architecture | African and regional real-world photography | custom Blender/Unity kit; scanned detail | reference images are design truth; production assets licensed/owned | Hero + modular | current Tunya vocabulary is generic grove/house/tree | Masond/Asbir/Aekon/Fluxom/Nil grammars below |
| Industry, ports, workshops, mines | real-world photography | Megascans, Poly Haven, licensed specialty | source family must be named per region | Modular + scanned-detail | `Concordia_Real_Forge` / `Industrial_Hangar` + pack folders present | work-purpose props, infrastructure, readable economy |
| Props and furniture | real-world photography | Poly Haven/Sketchfab after license/custom | CC0 or explicit production license | Modular + scanned-detail | FreePacks/DressVocab prop routes + PH barrels/crates/pots present | semantic catalog, interaction sockets, material/culture binding |
| Characters and clothing | real-world photography | Rocketbox/CX existing project assets + custom gear | existing project entitlement and attribution retained | Hero + modular | `Generated/Prefabs/CX_Humanoid_*` exist | no Quaternius hero replacement; cast-in-light, gear, animation |
| Weapons and tools | real-world photography | existing MYFG/project assets + custom | verify imported entitlement | Hero + modular | `CX_Weapon_Longsword` / `Hatchet` present | grip/socket/material/wear/provenance |
| Vehicles, mounts, ships | real-world photography | custom/licensed specialty | ownership and redistribution check | Hero + modular | `CX_Mount_Horse` present; authored instances incomplete | one physical grammar per class, persistent identity |
| Signage, cloth, banners | real-world photography | custom cloth/texture; licensed specialty | texture/mark ownership and attribution required | Modular + scanned-detail | `CourtBannerSway` + accent banner sockets exist; **no fabric PH texture family found**; cloth still debt | real attachment sockets; no floating rings |
| Lighting, HDRI, atmosphere | real-world photography | Poly Haven HDRIs + URP `HubLook` | Poly Haven CC0 and current `_2k` limit | Modular system | `HubLook` owns HDRI, volume, sun, grade, Court Fill/Rim | shot-matched key/fill/rim/fog and weather variants |
| UI identity | real-world material references | existing Kenney/Foozle/TinyRPG/Game-icons | retain CC0 / CC-BY attribution | Modular system | UI packs exist; Court/Steel intent documented | parchment vs steel themes, shared layout |

---

## North-star plate breakdown (Unburned Court)

Enforceable recipe extracted from the style plate. Implement through `HubLook` + Court kit — do not invent a second look stack.

### Lighting recipe

| Layer | Spec | Notes |
|---|---|---|
| Teal volumetric fog | Color ≈ `#008080` / cyan-teal (RGB ~0.0–0.15, 0.45–0.55, 0.50–0.55). Open-world density start ~`0.006`–`0.012` (see `HubLook.LiveFog`); Court local fog punch subordinate to key | Dense enough to separate near/mid/far; never wash white |
| Warm god-ray key | Warm white / cream key `#FDF5E6`–`#FFE4B5`, high elevation through canopy gaps; strong directional shafts | Key owns the plate; fog must not overpower shafts |
| Fill | Soft cool-teal fill opposite key; lower intensity than key | Retain midground form without flattening contrast |
| Rim | Warm rim on hero plate + stone edges (existing `Rim` light path in `HubLook`) | Ember veins and dark plate must remain readable |
| Soul lanterns | 2+ grounded white-to-cyan point lights on low pillars; specular anchors in puddles | Physical mount required; emissive core + metal/glass housing |
| Exposure / grade | HDR with preserved foreground shadow detail; ethereal bright background | Do not crush wet stone into mud |

### Materials

| Material | Spec | Present evidence |
|---|---|---|
| Engraved wet stone | Charcoal / dark slate `#2F4F4F`–`#1C1C1C`; high smoothness; puddle masks; recessed geometric engravings; bevel breaks; moss in recesses; contact darkening | `HubLook.WetStone` + PH `cobblestone_square` / medieval blocks = **base candidates**. **Engraved atlas / displacement mesh = MISSING** |
| Bark / trunk | Rough/matte bark; root flare into paving; moss contact | PH bark textures + `bark_debris_01` / roots present; hero trunk still **CANDIDATE** |
| Cloth | Deep red `#B22222`–`#D02020`; translucent sheen; optional dark geometric/rune motifs; visible weight and tension | Runtime banner materials exist; **dedicated fabric texture family MISSING in PolyHaven listing**; bespoke cloth required |
| Metal / glass (lanterns) | Aged metal housing + emissive cyan-white core | PH `Lantern_01`, `wooden_lantern_01` = **candidates** |

### Socket rules (cloth)

1. Every banner/streamer has **exactly two authored anchors** (origin + tension/end or origin + secondary fix).
2. Anchors live on **branch sockets or stone sockets** — never world-space orphans.
3. A visible **tension path** exists between anchors (cloth stretch direction matches socket pair).
4. Named sockets (Court first slice): `CourtTree.BannerSocket.N/E/S/W`, `CourtStone.BannerSocket.*`, `CourtStone.LanternSocket.*`.
5. Acceptance: no cloth whose parent is not a branch/stone/socket; no floating rings; no Prim cube “banners.”

### Vegetation

| Rule | Spec |
|---|---|
| Hero canopy | **One** massive ancient tree dominates north/center composition |
| Accent flora | Sparse reddish-pink leaf accents matching red cloth; no uniform tree ring |
| Understory | Restrained moss/roots/weeds at stone contacts — not Kenney Nature Kit as identity |
| Forbidden | Repeated circular tree ring; Kenney Nature as Court visual identity |

### Color palette (Court plate)

| Role | Approx hex |
|---|---|
| Teal fog | `#008080` |
| Deep red cloth | `#B22222` |
| Dark slate stone | `#2F4F4F` |
| Warm white / god ray | `#FDF5E6` |
| Soul lantern | white→cyan emissive |

---

## Tunya visual grammars

A grammar is a constrained, testable rule set. It is not a mood board.

**v0.1 → v0.2 correction:** v0.1 drifted (Masond as low courtyards; Asbir as watch towers; Aekon as generic ark-engineering; Nil as wetland/void). Grammars below match the brief design-language table **exactly**.

### Masond

**Brief design language:** African cliff settlements, vertical streets, retaining walls, harbor, sea caves, lookout towers.

| Rule | Enforceable spec |
|---|---|
| Role | Cliff-harbor culture: settlement climbs rock faces and ties into sea edge |
| Roof forms | Flat or shallow mono-pitch stone/timber roofs; terrace roofs used as streets; occasional lean-to over market bays; **no** steep northern gables as identity |
| Masonry | Rough-coursed local cliff stone; thick retaining walls; battered faces; visible tie-ins to living rock; lime/ochre wash in high-wear civic zones |
| Foundations | Cut into cliff benches; stepped plinths; pile/stone footings at harbor; sea-cave mouths framed with worked stone lintels |
| Street widths | **Vertical streets** primary: stairs/ramps 1.8–3.0 m clear; cliff terraces 2.5–4.5 m; harbor quay 4–8 m; no wide flat plaza as default |
| Color palette | Warm ochre / sandstone, charcoal cliff, sea-teal reflections, faded indigo cloth, weathered timber |
| Materials | Cliff stone, packed earth, dark timber, rope, salt-stained metal, woven awnings |
| Construction methods | Retaining-wall terraces; rock-cut rooms; stacked courses keyed into cliff; lookout towers as vertical markers; harbor moles and cave-mouth docks |
| Prop vocabulary | Fishing gear, drying racks, amphorae/jars, cliff ladders, signal horns, market tables, mooring lines, lookout braziers |
| Lighting grammar | Bright coastal key; deep cliff-shade cool fill; warm practicals in cave mouths and night lookouts; specular wet quay |
| Kit minimum | ≥30 cliff/harbor architecture refs → 12 retaining/wall modules, 8 foundations/plinths, 6 terrace-roof modules, 6 stair/ramp, 4 lookout tower, 3 dock/cave-mouth, 6 market, 8 props + 30 deco |
| Forbidden identity | Low courtyard compounds as Masond identity; generic fantasy keep; Kenney Nature/houses; flat European street grid |

### Asbir

**Brief design language:** Saharan / buried architecture, caravan settlements, Curated Vault grammar, wind erosion.

| Rule | Enforceable spec |
|---|---|
| Role | Desert caravan culture; architecture sinks into dunes; Curated Vault is the hero landmark |
| Roof forms | Domes, flat sand-covered roofs, low vaults; wind-scoop / vent caps; cloth shade sails over caravan courts — **not** tall pitched roofs |
| Masonry | Adobe / rammed earth / pale sandstone; thick thermal walls; buried courtyards; wind-eroded edges and undercut bases |
| Foundations | Partially buried; bermed walls; dune-locked plinths; Vault threshold as cut stone into packed earth |
| Street widths | Narrow shaded alleys 1.5–2.5 m; caravan lanes 4–6 m; open dune approaches taper into settlement mouths |
| Color palette | Bone / sand / pale ochre, faded indigo and teal cloth accents, dark iron fittings, deep Vault interior shadow |
| Materials | Adobe, rammed earth, pale stone, woven mats, rope, sand, oxidized iron, parchment/cloth covers |
| Construction methods | Excavation + berm; wind-break walls; courtyard compounds half-buried; Vault as curated subterranean mass with controlled entries |
| Prop vocabulary | Caravan packs, camel gear proxies, water jars, sand screens, trade crates, route markers, Vault seals/plinths |
| Lighting grammar | Hard high-angle sun; soft sand bounce fill; interiors cool and dim; Vault practicals sparse and ceremonial |
| Wear | Wind abrasion, sand scour lines, undercut corners, patched adobe, cloth fray |
| Kit minimum | ≥30 Saharan/buried refs → 12 wall/berm modules, 8 buried foundations, 6 dome/vault roofs, 6 openings, 4 wind-scoop, 4 caravan-court, Curated Vault as **Hero** (bespoke) |
| Forbidden identity | Elevated watch-tower culture as Asbir identity (v0.1 drift); European desert fantasy tents-as-town; Kenney as identity |

### Aekon

**Brief design language:** Glacier + crashed Ark, ice caves, survival settlements, Long Winter landmark silhouette.

| Rule | Enforceable spec |
|---|---|
| Role | Survival culture on ice; crashed Ark is the Long Winter landmark silhouette |
| Roof forms | Low insulated sheds; canvas/hide over timber frames; ice-cave mouths with timber lintels; Ark hull plates as improvised roofs |
| Masonry / structure | Ice and packed snow walls; dark timber frames; scavenged Ark metal panels; stone only where glacial moraine allows |
| Foundations | Ice shelves, moraine pads, staked timber on frozen ground; Ark sections as immovable anchors |
| Street widths | Narrow ice paths 1.2–2.0 m; sled runs 2.5–3.5 m; cleared plaza only at Ark entry |
| Color palette | Ice cyan/white, charcoal timber, oxidized Ark metal, ember practicals, deep blue cave shadow |
| Materials | Ice, snow, dark timber, oxidized metal, rope, hide, ceramic/insulating panels from Ark salvage |
| Construction methods | Ice-cave habitation; lean-tos against Ark hull; cable/anchor fields; survival dens with sealed entries |
| Prop vocabulary | Sleds, ice axes, crates of salvage, fuel drums, rope coils, navigation markers, Ark hatch hardware |
| Lighting grammar | Hard cold key; warm practicals only at hearths/work; specular ice caves; Ark metal rim highlights |
| Landmark | **Aekon Ark** — kilometer-readable crashed hull silhouette (Hero) |
| Kit minimum | ≥30 glacier/survival/wreck refs → 10 hull/deck salvage modules, 8 ice-wall/cave modules, 6 shed roofs, 6 service/hatch, 4 cable/socket families, Ark Hero bespoke |
| Forbidden identity | Generic sci-fi tower; temperate stone village; “ark” as decorative boat prop only |

### Fluxom

**Brief design language:** Historic industrial ports, dye mills, canals, warehouses, authoritarian civic massing.

| Rule | Enforceable spec |
|---|---|
| Role | Industrial harbor-state; dye economy + canal logistics; civic buildings read as authoritarian mass |
| Roof forms | Long warehouse ridges; sawtooth mill roofs; flat civic roofs with parapets; crane gantries as skyline |
| Masonry | Brick and cut stone civic massing; tarred timber warehouses; iron frames; repetitive bay rhythms |
| Foundations | Canal quay walls; piled docks; raised warehouse plinths above flood line |
| Street widths | Canal towpaths 2–3 m; warehouse alleys 3–4 m; civic avenues 8–12 m; dock aprons 6–10 m |
| Color palette | Wet stone grey, brick red/brown, dye-stained teal/indigo/magenta accents, oxidized iron, tar black |
| Materials | Brick, wet stone, tarred timber, iron, rope, painted civic signage, dyed cloth in mills |
| Construction methods | Canal cuts; mill races; warehouse bay grids; monumental civic blocks (authoritarian massing); crane sockets |
| Prop vocabulary | Dye vats, barrels, bolts of cloth, manifests, cranes, carts, mooring hardware, mill gears |
| Lighting grammar | Cool teal environmental fill + warm practicals in mills/docks; reflective wet quay (related to Court teal language but industrial, not sacred) |
| Kit minimum | ≥30 industrial-port refs → 12 quay modules, 8 warehouse bays, 6 sawtooth/ridge roofs, 6 bridges/ramps, 5 dock fittings, 4 civic-mass modules, dye-mill prop family |
| Forbidden identity | Cute fantasy harbor; generic medieval dock without mills/canals; Kenney industrial toys as identity |

### Nil

**Brief design language:** Old-growth forest culture, sacred groves, Listening Grove — **NOT** generic fantasy forest.

| Rule | Enforceable spec |
|---|---|
| Role | Forest-sacred culture; settlement yields to living trees; Listening Grove is the hero landmark |
| Roof forms | Living-branch shelters; low bark/shingle roofs under canopy; platform decks in trunks; **no** pointed elf spires |
| Masonry | Minimal stone — root-bound plinths, grove markers, listening stones; wood and living material dominate |
| Foundations | Raised root platforms; non-invasive pier footings; paths that divert around hero trees |
| Street widths | Soft paths 1.0–2.0 m; ceremonial grove approaches 3–5 m clearing; no grid streets |
| Color palette | Deep canopy green, bark brown, moss, soft biolum/teal listening accents, restrained leaf-red seasonal accents |
| Materials | Living wood, bark, moss, woven screens, rope, stone markers, leaf thatch |
| Construction methods | Grove clearing etiquette; platform carpentry; sacred-tree exclusion zones; Listening Grove as acoustic/ritual space |
| Prop vocabulary | Listening stones, hanging chimes/cloth strips (socketed to branches), offering bowls, woven screens, root benches |
| Lighting grammar | Broken canopy shafts; teal mist in depth; warm understory practicals rare; Listening Grove has distinct hush lighting |
| Landmark | **Listening Grove** — Hero; not a pack of repeated fantasy trees |
| Kit minimum | ≥30 old-growth/sacred-grove refs → 8 platform modules, 6 screen/wall, 6 roof/shelter, 6 path/root foundations, Listening Grove Hero, understory scanned-detail |
| Forbidden identity | Generic fantasy forest village; wetland/void grammar (v0.1 drift); Kenney Nature Kit as Nil identity; Quaternius trees as sacred heroes |

### Unburned Court / Hub

**Brief design language:** Match the north-star plate exactly as the player’s first emotional plate.

| Rule | Enforceable spec |
|---|---|
| Role | Neutral sacred civic ground; Hub is not a normal conquered settlement |
| Roof forms | Restrained gatehouse / flanking roofs only; Court itself is open paving under one canopy — no roof ring closing the plaza |
| Masonry | Weathered engraved charcoal stone; beveled courses; moss-broken edges; monumental but not LEGO-slab |
| Foundations | Continuous wet paving field on deep plinths; gatehouse footings grown into by roots |
| Street widths | Broad open court (shot-driven, typically ≥20 m clear to tree); approach paths secondary |
| Color palette | Teal fog `#008080`, deep red cloth `#B22222`, dark slate stone `#2F4F4F`, warm god-ray `#FDF5E6` |
| Materials | Engraved wet stone, bark/root, socketed red cloth, soul-lantern metal/glass |
| Construction methods | Modular stone blocks + heavy engraving decals; hero-tree asset; tensioned cloth spline/socket system |
| Prop vocabulary | Soul lanterns, lore stones, restrained seating/market traces, banners, roots, engraved plinths |
| Lighting grammar | Warm god rays through canopy + teal fog depth + cool shadow planes + warm rim on hero |
| Attachment grammar | Every banner: two anchors + tension path; every lantern: physical mount or grounded stand |
| Vegetation | One hero canopy + restrained understory — no repeated tree ring |
| Forbidden identity | Prim FallbackArch; Sanctum cube wings/crown; floating banner blocks; Kenney as Court identity; generic circular tree ring; Poly Haven-only “Tunya look” |
| Shot gate | Court plaza, hero body, readable wet floor, cloth attachments, tree canopy, atmosphere, Court HUD, stable frame budget; side-by-side with `CONCORDIA-ART-STYLE-REF-court-tree.jpg` |

---

## Unburned Court kit ledger

Evidence from light `ls` of `FreePacks/`, `PolyHaven/`, `Generated/RealWorld/`. **Do not invent mesh paths.** Status: `PRESENT` = on disk; `CANDIDATE` = present but not shot-validated as Court identity; `MISSING` = required by plate, not found.

### Hero

| Leaf | Primary source | Secondary | License rule | Present-in-project evidence | Status |
|---|---|---|---|---|---|
| Court hero tree / canopy | Real-world photography → bespoke Blender hero | `Generated/RealWorld/Concordia_Real_Oak.prefab` or `Concordia_Real_ForestTree.prefab`; PH `island_tree_*` / `jacaranda_tree` as interim only | Custom owned by Concordia; PH CC0 if used interim | Oak + ForestTree prefabs **PRESENT**; PH trees **PRESENT** | **CANDIDATE** — not locked as final hero |
| Weathered gatehouse | Real-world photography → custom kit | PH `large_iron_gate` (`Models/large_iron_gate/large_iron_gate_1k.fbx`) as gate leaf only | PH CC0; custom masonry owned by Concordia | `large_iron_gate` **PRESENT** | Gate leaf **CANDIDATE**; full gatehouse massing **MISSING** |
| Engraved Court floor (hero field) | Real-world photography → custom engraved mesh/atlas | PH `cobblestone_square` / `medieval_blocks_*` / `patterned_paving*` as temporary albedo | Custom engraving required for plate | WetStone path + PH textures **PRESENT**; engraved atlas **MISSING** | **MISSING** engraved hero treatment |
| Listening / lore stones (Court set) | Custom | none — bespoke | Concordia-owned | Not found as named Court assets | **MISSING** |

### Modular

| Leaf | Primary source | Secondary | License rule | Present-in-project evidence | Status |
|---|---|---|---|---|---|
| Court wall / flanking masonry | Custom modular kit from Court grammar | PH stone textures (`castle_brick_*`, `medieval_wall_*`, `granite_wall`) | Custom mesh + PH CC0 mats | Textures **PRESENT**; Court wall modules **MISSING** | **MISSING** modules |
| Plinth / foundation blocks | Custom | PH paving textures | Custom + PH CC0 | Textures **PRESENT**; modules **MISSING** | **MISSING** |
| Corner / termination / bevel pieces | Custom | scanned-detail wear | Concordia-owned | **MISSING** | **MISSING** |
| Opening / arch modules (non-Prim) | Custom | PH `large_iron_gate` for iron leaf | No Prim FallbackArch as identity | Gate **PRESENT**; arch kit **MISSING** | **MISSING** (debt: Prim FallbackArch) |
| Lantern pillar / stand modules | Custom stands | PH `Lantern_01`, `wooden_lantern_01`, `street_lamp_*` | PH CC0 props; custom pillars | Lanterns **PRESENT** | Prop **CANDIDATE**; Court pillar kit **MISSING** |
| Banner socket hardware | Custom sockets on tree/stone | none | Concordia-owned | `HubLook` CourtTree banner sockets **PRESENT** in code | Code sockets **PRESENT**; authored mesh hardware **MISSING** |

### Scanned-detail

| Leaf | Primary source | Secondary | License rule | Present-in-project evidence | Status |
|---|---|---|---|---|---|
| Wet / mossy stone breakup | Poly Haven textures | Megascans (OPEN entitlement) | PH CC0; Megascans when entitled | `mossy_cobblestone`, `brick_moss_001`, `moss_01` model, rock sets **PRESENT** | **CANDIDATE** |
| Bark / roots | Poly Haven | RealWorld oak materials | PH CC0 | Bark textures + `pine_roots` / `root_cluster_*` / `bark_debris_01` **PRESENT** | **CANDIDATE** |
| Rocks / debris | Poly Haven | Megascans | PH CC0 | Multiple `rock_*`, `coast_*`, `namaqualand_*` **PRESENT** | **CANDIDATE** |
| Puddle / wetness masks | Custom masks via `HubLook` | PH wet-capable stone albedos | Concordia-owned masks | WetStone helpers **PRESENT**; plate-grade puddle mesh **OPEN** | **CANDIDATE** / partial |
| Red cloth / banner material | Custom cloth texture + runtime mesh | none found in PH fabric listing | Concordia-owned; optional licensed specialty | No PH fabric/cloth texture family found in listing; runtime red banners exist in code | **MISSING** production cloth asset |
| Understory / accent leaves | Poly Haven plants | Megascans; Kenney Nature = **utility only** | PH CC0; Kenney never Court identity | PH plants **PRESENT**; Kenney Nature Kit **PRESENT** (utility-only) | PH **CANDIDATE**; Kenney **FORBIDDEN** as identity |
| Soul lantern emissive treatment | Custom material on PH lantern mesh | `Lantern_01` | PH CC0 mesh + Concordia emissive | `Lantern_01` **PRESENT** | **CANDIDATE** |

### Court kit gaps (summary)

**MISSING (block SHOT 01 plate):** engraved wet-stone atlas/mesh; Court modular wall/plinth/arch kit; production red cloth material; authored gatehouse massing; lore stones; lantern pillar modules.

**CANDIDATE (present, need scale/material/socket/shot validation):** `Concordia_Real_Oak` / `ForestTree`; PH `large_iron_gate`; PH `Lantern_01`; PH bark/roots/rocks/paving textures; `HubLook` WetStone + Court sockets.

**FORBIDDEN as Court identity:** Kenney Nature Kit; Quaternius; Prim FallbackArch / Sanctum cube wings-crown; orphan banner rings.

---

## Source-assignment matrix — Hub Court kit leaves

Filled for Court first-slice leaves. Format: `primary | secondary | license | use-in-Concordia rule`.

| Bible leaf | Primary | Secondary | License | Use-in-Concordia rule |
|---|---|---|---|---|
| WORLD / Court paving field | Real-world engraved stone photography | PH `cobblestone_square`, `medieval_blocks_*`, `patterned_paving*` | PH CC0; custom engraving Concordia-owned | Modular + scanned-detail; engraving required before SHOT 01 claim |
| WORLD / atmosphere HDRI | Real-world mood refs | PH `_2k` HDRIs via `HubLook` | PH CC0 | System only; match teal fog + warm key; do not swap stacks |
| VEGETATION / hero canopy | Real-world ancient tree refs | `Concordia_Real_Oak` / `ForestTree`; PH trees interim | Custom preferred; PH CC0 interim | Hero; one canopy; branch sockets mandatory |
| VEGETATION / roots & bark detail | Real-world | PH bark + `root_cluster_*` | PH CC0 | Scanned-detail only |
| VEGETATION / understory | Real-world species grammar | PH plants; Megascans when entitled | PH CC0; Kenney utility-only | Never Kenney as Court identity |
| ARCHITECTURE / gatehouse | Real-world weathered stone | Custom modular + PH `large_iron_gate` | Custom + PH CC0 | Hero + modular; kill Prim FallbackArch renderers |
| ARCHITECTURE / flanking walls | Real-world | Custom kit + PH stone mats | Custom + PH CC0 | Modular; moss/bevel/wear required |
| ARCHITECTURE / foundations/plinths | Real-world | Custom | Concordia-owned | Modular |
| CIVILIZATION / sacred Court (non-settlement) | North-star plate | none — bespoke composition | Concordia-owned | Hero plate; not a Tunya town kit |
| PROPS / soul lanterns | Real-world lantern refs | PH `Lantern_01` / `wooden_lantern_01` | PH CC0 + custom emissive | Modular prop family; grounded mounts |
| PROPS / red banners/cloth | Real-world cloth/tension refs | Custom cloth; runtime `CourtBannerSway` | Concordia-owned | Modular; **two sockets + tension path** mandatory |
| PROPS / lore stones / seating | Real-world | Custom | Concordia-owned | Modular; restrained density |
| PROPS / debris & contact | Real-world | PH rocks/moss/debris | PH CC0 | Scanned-detail |
| CHARACTERS / hero readability | Existing CX / Rocketbox path | `Generated/Prefabs/CX_Humanoid_*` | Existing entitlement | Hero cast under Court rim; no Quaternius replacement |
| VEHICLES | n/a for Court plate | — | — | Out of Court first slice |
| WORLD-SPECIFIC / Unburned Court | This Bible + north-star plate | HubPlaza / HubLook integration | Concordia-owned contract | First build slice after Bible |

---

## Unburned Court first-build slice

1. Replace primitive visual massing only after preserving trigger/collider/gameplay parents.
2. Author a Court hero root with named sockets:
   - `CourtTree.Root`, `CourtTree.BannerSocket.North/East/South/West`;
   - `CourtStone.BannerSocket.*`;
   - `CourtStone.LanternSocket.*`;
   - `CourtFloor.EngravingAnchor.*`;
   - `CourtFloor.PuddleAnchor.*`.
3. Use one bespoke or authored tree asset as the north composition anchor. Current generated oak/tree prefabs are **candidates**; final choice requires bounds/material/scale/shot validation.
4. Replace repeated cylinder/cube puddles with a real ground material/mesh treatment: engraved normal detail, bevel response, puddle mask, roughness variation, and edge breakup.
5. Keep cloth physically attached to sockets. Sway may remain lightweight, but the transform origin must be a branch/stone attachment point and the cloth must have a tension direction.
6. Build soul lanterns as a semantic prop family with emissive core, metal/glass housing, grounded or mounted collision, and warm/cyan practical light.
7. Keep teal fog subordinate to the key; use actual URP volume/scene lighting already owned by `HubLook` and validate normals/shadows in Play.
8. Preserve LeanPlay: staged yields for tree/ground/props; no synchronous burst after `realmfill_done`. **Do not set LeanPlay=false.**
9. Compare side-by-side with `CONCORDIA-ART-STYLE-REF-court-tree.jpg` before claiming the shot complete.

---

## Debt kill list

### Prim FallbackArch / Sanctum cube wings-crown

- Source: `Assets/Concordia/Scripts/HubPlaza.cs`, `FallbackArch`, `Sanctum`, and `PlaceStoneLite` paths.
- Rule: primitives may retain colliders or gameplay anchors, but their renderers must not define Court identity.
- Acceptance: authored/modular arch or explicit empty/hold state; no cube wings/crown in SHOT 01.

### Orphan banner rings

- Source: `HubLook.EnsureAccentBanners`, `HubPlaza.Banners`, `HubPlaza.Clutter`, and any banner/flag spawn path.
- Rule: every cloth instance requires an attachment socket ID, parent anchor, tension direction, and non-floating bounds check.
- Acceptance: no cloth exists with a world-space parent that is not a branch/stone/socket anchor; no invisible ring geometry.

### FreePacks stem/alias failures

- Source: `FreePacks.Mesh`, `Spawn`, `SpawnStore`, `DressVocab`, and per-world callsites.
- Rule: a missing stem returns an explicit catalog miss and records the requested semantic family; it must not silently turn a new identity asset into a cube.
- Acceptance: audit output lists requested stem, resolved asset path, source class, license state, and fallback reason. Kenney fallback is allowed only where the callsite explicitly declares utility/prototype.

### Coordination and budget

- Coordinate FreePacks, HubPlaza, WorldStream, and Zuko through the asset ledger and stage markers.
- Preserve staged road/world construction. Visual dress work is frame-budgeted and generation-aware.
- Maintain separate budgets for LeanPlay, Desktop, and WebGL. The current project contract is URP, `_2k` Poly Haven, and HubKit-only WebGL where required.
- **Do not set LeanPlay=false.**

---

## Continent kit rollout

1. Establish the Bible and source ledger. ← **v0.2 living contract (this doc)**
2. Close Unburned Court SHOT 01/02 baseline.
3. Build Masond/Asbir/Aekon/Fluxom/Nil modular families and authored landmark heroes (Hold of First Arrival, Curated Vault, Listening Grove, Aekon Ark, Fluxom harbor, Tunyan ruins, Vessine Choir).
4. Bind each family through one source-aware resolver and one staged world-dress path.
5. Add road, settlement, interior, vegetation, vehicle, mount, and weather families per grammar.
6. Run visual-fidelity shot gate and runtime stability checks after each regional family.

---

## Completion rule

Asset presence, successful import, clean compilation, or indexing is not completion. A family is complete only when it has source/license provenance, grammar coverage, technical validation, gameplay sockets, correct scale/material/LOD/collider behavior, staged runtime integration, and a named Play shot that holds side-by-side against the reference.
