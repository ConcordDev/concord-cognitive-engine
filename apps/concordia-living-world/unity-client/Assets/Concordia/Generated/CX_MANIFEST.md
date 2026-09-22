# Concordia CX_ photoreal plates — coverage audit

Drop: `Assets/Concordia/Generated/`  
Prefix: `CX_`  
**142 unique plates** (plus 5 tile 2×2 checks in `P2/Tiles/_verify/`).  
Photoreal studio plates, not skinned FBX. Unity still binds 3D from FreePacks until a dresser pass.

Checked against: `Canon.cs` (WorldId, Gates, HubGuests, Pillars, fauna, fight styles), `Appearance.OutfitNames`, `RoadWorld.RoleFor`, `content/world/*/creatures.json` + Sere/Tunya bestiaries, Hub HUD surfaces.

## User-facing Hub (must have)

| Surface | Status |
|---|---|
| Pillars: Concordia, Concord, Sovereign | **covered** `P3/Pillars/` |
| All 15 `HubGuests` | **covered** `P3/Guests/` |
| Court lantern, cobble, Court HUD | covered |
| Arena dummy, Steel HUD, longsword, grip | covered |
| Character-create outfits (6) | Court linen, Bronze traveler (NPC), Grid runner (NPC+suit), Frontier duster (scout), Crimson court (gown plate), Night market (coat plate) |
| Hair: Crop/Short/Sweep/Bun/Long/Topknot | Short, Sweep (hero), Bun. Crop / Long / Topknot still missing as isolated plates |

Brackish is a plaza teenager (Canon height 1.42). Not a toddler.

## Every WorldId

| World | Canon fauna | Plate | Signature extra | Road NPC |
|---|---|---|---|---|
| Hub / Unburned Court | none | plaza strider, lamplighter moth | — | Court guard |
| Fantasy / Sundering | wolf, griffin, basilisk | all three | Thorn Wolf, Mana Drake, Bone Sentinel, Gloom Stalker, Crystal Elemental | Iron Warden + 5 bandits |
| Ruins | wraith, wolf, griffin | all three | ash revenant not unique (wraith stands in) | Glyph keeper |
| Tunya | sealie, hound, harpy | sealie, hound, raptor (avian analog) | — | Grove merchant |
| Crime | hound, drone | both | Chrome Enforcer | Crime fixer |
| Cyber / Grid | drone, sentinel, construct | all three | pulse baton | Grid runner |
| Frontier | hound, wolf | both | Dust Courser, Thunder Yak, Rail Vulture | Frontier scout |
| Superhero / Dawn | drone, sentinel | both | Mech Hound | Dawn watcher |
| Crucible | drift, wraith, construct | all three | Echo Serpent | Lattice walker |
| Sere (off-ring) | hound, drone | both | Furnace Hound + Tessera clerk | (no RoleFor; Tessera plate is the stand-in) |

Humanoid harpy: **blocked by image moderation**. Raptor is the Tunya sky analog. Do not retry the humanoid prompt.

## Outfits / weapons / HUD / VFX

- Outfits: 6/6 named Appearance slots have a plate or a dressed NPC.
- Weapons: longsword, hatchet, bow, switchblade, pulse baton. Frontier rifle is on the scout, not isolated.
- HUD: Court + Steel × health, inventory, dialogue, quest toast.
- VFX: hit sparks, parry ring, flower-step, curse-fold. Missing per-style: pulse, shockwave, ash-cut, invoice, pollen ward.

## Still not a full bestiary (honest)

These catalogs exist and do **not** each have a unique plate: Tunya domestic list (goat, oxen, mluskrat…), Sere tithe rat / ledger crow / drowned eel / Deep Watcher (anomaly — not invented), Hub cistern lurker, Crime rage junkie / scrap golem / night crawler / ash hound, Cyber glitch hound / neural parasite / void walker / drone swarm, Superhero street mutant / energy wraith / shadow stalker / riot elemental, Ruins ruin rat king, Crucible drift mote swarm / crucible warden, Tunya **countries** (Dinye, Aekon, …) as architecture kits.

Crossbreeds: none invented. Wait for `creature-crossbreeding` genomes.

## P4 — civic / day-to-day (signs, transit, street)

Signs are **blank or symbolic** so Unity can write metres/names. No baked street names.

| World | Wayfinding | Transit | Street furniture |
|---|---|---|---|
| Hub | lantern-flame waypost | flower-cart | plaza bench |
| Sundering | vine ward-post | living-wood forest cart | (well/shrine already P2) |
| Ruins | glyph mile-marker | wrecked ash tram | catalog kiosk |
| Tunya | harvest waystone | ox-cart | irrigation trough |
| Crime | wet chevron sign | night cab | hydrant + dumpster |
| Grid | polymer pylon | maglev car | data kiosk |
| Frontier | (ring post P2) | wagon + boxcar | windmill pump |
| Dawn | sun-disc post | lift cage + rooftop gondola | — |
| Crucible | drift-warning marker | shard-tram | — |
| Sere | tessera post | ore tram | smog-lamp |

Still thinner: traffic lights as systems, full station interiors, Tunya Bloc-country road marks, numbered Grid streets (by design the Grid refuses numbers — pylons stay unnumbered).

## Should create next (ranked)

Plates on disk do not change a walk until they are bound. After bind, these are the holes that still read as empty world.

### 0 — Bind (SHIPPED)

Skinned Humanoid is Rocketbox Bip01, copied to `Generated/Rig/CX_Humanoid_{Male,Female}.fbx`. Grip sockets `CX_Grip_R` / `CX_Grip_L` bake onto the hands. `ModularPerson` loads those prefabs first, dresses Court/Steel tints from the CX palette, and `CharacterGear.Grip` parents the CX longsword into the right-hand socket. HUD draws `CX_HUD_*_health`. Ring signs get a CX plate face. Menu: **Concordia → Bake CX Humanoid Prefabs**.

Honest: the FBX is the existing skinned Humanoid, not a photogrammetry rebuild of the 2D plates. Plates are albedo/HUD/civic; the skeleton walks.

### 1 — Architecture the walker actually hits (`WorldKit.Landmark`)

Each country needs a **house, tower/keep, tree, and gate mouth** in its own material language. Today WorldKit asks DressVocab for those stems and falls back to Kenney.

| World | Landmark still missing as CX_ |
|---|---|
| Hub | eight Ring gate mouths, bronze dome, embassy |
| Sundering | overgrown keep, ward-well, living statue |
| Ruins | ash tower, altar, coffin/column (already spawned, no photoreal plate) |
| Tunya | grove-house, mesa granary, crop rows as photoreal |
| Crime | tenement, neon-blank sign, alley |
| Grid | corp tower, maglev station shell |
| Frontier | waystation, rail shed |
| Dawn | vertical stack / rooftop keep |
| Crucible | lattice keep that looks unfinished |
| Sere | furnace-belt shed, Clearing Spire stub |

### 2 — Ground WorldKit already names

`WorldKit.Ground` wants: `ash_soil`, `grove_moss`, `stone_tiles`, `wet_asphalt`, `neon_grid`, `packed_earth`, `concrete_floor`, `metal_plate`. We have packed earth, moss, cobble, ash, sand. **Missing: wet asphalt, neon grid, metal plate, concrete, grove-moss as a Tunya fill.**

### 3 — Stations the player can enter

World lens stations: farm, restaurant, karaoke, mahjong, trivia, hacking terminal, programming console, factory, attraction, creature pen, glyph altar. Each needs an **interior plate + one prop** or the building stays a Kenney box when you press E.

### 4 — Day-to-day per country (after civic P4)

We have sign + transit + one street object. Still missing, and they matter:

- **Food** — Court bread/lantern-tea, Tunya fruit (not bananas), Crime noodle cart, Grid vending, Frontier trail rations, Sere meal-ticket tin
- **Work** — chrome-shop chair (Grid), ledger desk (Sere), catalog lectern we have, forge we have, farm tools
- **Doors / windows / mail** — blank letter plate (modern coins in spoils are wrong)
- **Weather dressing** — Crime rain puddle decal, Frontier dust devil, Ruins ash fall, Sere smog, Dawn god-ray, Crucible drift motes (VFX, not Kenney sparks)
- **Time of day** — one night lantern pass of Hub plaza (same layout, night grade)

### 5 — Combat language (`Canon.Get(id).style`)

Have: hit sparks, parry, flower-step, curse-fold.  
Need one VFX each: **Palm / Ash cut / Reed / Pulse / Dust-kick / Fist-shockwave / Invoice / Shard / Tessera-break**.

### 6 — Character-create remainder

Hair still missing isolated: Crop, Long, Topknot.  
Bodies: one heavier, one slighter, matching the hero identity rules.  
Wardrobe slots exist as plates; they are not modular meshes.

### 7 — Bestiary remainder (do not invent)

Leave Deep Watcher unpictured (Sere ships evidence, not a verdict).  
Worth plating only if they spawn on the road: Hub cistern lurker, Ruins rat-king, Crime scrap golem, Cyber glitch hound, Dawn street mutant, Tunya domestic ox/goat (ox-cart exists; the animal does not).

### 8 — Do not create

- Another hero. Identity is locked.
- Humanoid harpy (moderation).
- Crossbreeds without a genome.
- FBX / 2B / quest graphs / kill-cascade (kernel already has `world_consequences`).
- Text on signs.

If the next pass is art, do **§1 gate mouths + WorldKit grounds**. If the next pass is the game, do **§0 bind**.
