# Aura Open-World Reference Pack — Concordia
**Updated:** 2026-09-21 · **Root:** `Assets/Concordia/AuraRefs/`  
**Rule:** Study this pack BEFORE generating or dressing. Prefer on-disk Concordia-native plates over generic fantasy kits. Kenney/Quaternius = mesh stopgap only, never visual identity.

---

## 0. How to use this pack
1. Open **north-star** images and match lighting/silhouette/cloth sockets.
2. Read **atlas PDF** + `design/HUB-CITY-FROM-ATLAS.md` for what Hub *is*.
3. Index every CX plate via `CX_PLATE_INDEX.json` (147 plates → materials already exist).
4. Compare Play shots to **hub-vistas** + **world-tours** (fail if Play looks emptier).
5. Apply **worth-traveling heuristics** (§4) on every Crown Road segment.
6. Lore → concept → prefab → bind → Play proof. Never invent lore lines (`WorldBook` refuses).

---

## 1. North-star images (OPEN THESE FIRST)
| File | Use |
|---|---|
| `north-star/court-tree-plate.jpg` | **Emotional #1** — Unburned Court: ancient tree, teal haze, warm god rays, red cloth on real sockets, wet engraved stone, rim-lit hero. Ban Prim cubes / floating banners. |
| `north-star/city-vinewood-density.jpg` | **City density #1** — varied heights, lived-in clutter, canopy mass, sharp sun/shadow. Ban beige megablocks / empty grey slabs. |
| `north-star/city-vinewood-NOTE.md` | Dutch notes on the city ref. |
| `north-star/Concordant_Megaworld_Atlas.pdf` | Lore cosmography: Hub heart, Canon Ring, gates, cargo spokes, dungeons, Year 91 timeline. |

Also: `design/FULL-MAP-ART-REFACTOR-BRIEF.md` (canonical art refactor), `design/HUB-CITY-FROM-ATLAS.md`, `design/DENSITY-STREAMING-CHARTER.md`.

---

## 2. Hub vista targets (what sprawl should look like)
Folder: `hub-vistas/`
- `HUB-AERIAL-2026-09-20.png` / `HUB-AERIAL-perspective-2026-09-20.png`
- `HUB-OBLIQUE-2026-09-20.png`
- `HUB-VISTA-court-to-market-2026-09-20.png`
- `HUB-VISTA-crown-spoke-out-2026-09-20.png`
- `HUB-VISTA-heart-ring-2026-09-20.png`

**Pass:** from Court you can read Market / wall / at least one gate spoke. **Fail:** endless PlazaPad tile or single grey ring.

---

## 3. World tour stills (per-continent look targets)
Folder: `world-tours/` — `tour-HUB`, `tour-SUNDERING`, `tour-TUNYA`, `tour-CYBER`, `tour-CRIME`, `tour-FRONTIER`, `tour-DAWN`, `tour-RUINS`, `tour-CRUCIBLE`, `tour-SERE`.

WorldId lockstep: Hub; Fantasy=Sundering; Tunya; Cyber=Grid; Crime=Iron Coast; Frontier; Superhero=Dawn/Aegis; Ruins; Crucible; Sere (no Link gate).

On SoftEnter, sky/ground/civic kit must shift toward that tour still — not Hub palette pasted on a new Present.

---

## 4. Worth-traveling heuristics (research → Concordia rules)
Sources: Joel Burgess GDC open-world motivation; Ghost of Tsushima weenies (~every 30s something pulls the eye); POI diversity (≥3 different gameplay POIs on horizon); Kevin Lynch paths/edges/districts/nodes/landmarks; Starfield criticism (scale ≠ density; avoid empty procedural repeats / menu-first travel); RDR2 ambient ecology + road encounters; BotW triangle terrain + shrine breadcrumbs; Skyrim/Tsushima concept→in-engine early.

| # | Heuristic | Concordia action |
|---|---|---|
| H1 | Distant weenie always visible | Gate towers, Court tree, mountains, smoke — WorldKit.Landmark + HubPlaza |
| H2 | Mid-road breadcrumb ≤30–60s walk | Wayposts (P4 CX), carts, shrines, travelers, wildlife (RoadWorld + CxDress) |
| H3 | Horizon diversity (≥3 POI types) | Combat / social / explore mix — not three same houses |
| H4 | Districts with unique silhouette | Hub: Council / Archive / Market / Warden wall (atlas) |
| H5 | Roads tell stories | Salt Route clutter, spoils, gossip, cargo props matching spoke |
| H6 | Ambient life without player | RoadLife walkers, Guest schedules, wildlife, cloth/mist (WorldBreath) |
| H7 | Travel changes physics/look | SoftEnter / link_gate (never fake teleport menu) |
| H8 | Consequence of travel | Kill → LastEvent “fell” → Hub still knows (cascade) |
| H9 | Avoid Starfield trap | Prefer dense Hub + dressed spokes over thin empty ring kilometers |
| H10 | Concept early in engine | CX plates → mats (done) → prefabs → Play stills vs north-star |

**Starfield keep:** bespoke Neon/Akila moments that feel authored.  
**Starfield avoid:** identical outposts, map-ping every POI, commute-as-content, 1000 empty cells.

---

## 5. Lore → concept → native asset pipeline
`bible/CONTENT_PIPELINE.md` + `bible/LORE.md` + `bible/CINEMATIC.md` + `bible/CHARACTERS.md` + `bible/CREATURES.md` + `bible/FACTIONS.md` + `bible/ECOLOGY.md` + `bible/WORLD.md` + `bible/VISUAL.md`.

**Process Aura must follow for anything new:**
1. **Study lore** — Canon JSON / HubGuests / Gates / atlas § for that world. Do not invent names or lines.
2. **Mood board** — north-star + matching CX plates + Poly Haven HDRI for that biome.
3. **Concept** — if a plate is missing, generate a new `CX_` plate into `Generated/P*` with README (scale, sockets, license: Concordia original). Push color/silhouette harder than final (Tsushima lesson).
4. **Blockout** — FreePacks/PolyHaven mesh as proxy only.
5. **Dress native** — apply CX material; save prefab under `Generated/Prefabs/...`.
6. **Bind** — ModularPerson / GuestNpc / RoadWorld / WorldKit / CxDress / DropSpoils.
7. **Play proof** — screenshot vs north-star / tour still; write PASS/FAIL.

Paths: see `AuraRefs/ASSET_PATHS.md`. **Never symlink** PolyHaven/Generated into AuraRefs (duplicate import kills Unity MCP). Use `Generated/` and `PolyHaven/` under Assets/Concordia/ directly.

External CC0 (already mostly on disk — do not redownload 13GB):
- https://polyhaven.com/ (HDRIs, textures, models) — CC0
- https://ambientcg.com/ — CC0 fills if Poly Haven missing a ground type

---

## 6. CX plate index (147) — Concordia-native look bible
Machine index: `CX_PLATE_INDEX.json`  
Materials: `Generated/Materials/P0–P4` (**147/147 exist — do not redo mats**).  
Prefabs: still mostly missing — bake next.

### P0 — Play cast (27)
Hero Court/Steel, 5 Sundering bandits, road NPCs, weapons, mount, spoils, Court+Steel HUD.

### P1 — Bestiary (29)
Wildlife, predators, watchers — bind Fantasy road + world fauna tables.

### P2 — Dress / gear / VFX / tiles (43)
Props, signs, gear, create-kit, tiles, VFX.

### P3 — Named faces (19)
15 HubGuests + 3 Pillars + Sere Tessera — GuestNpc must spawn these.

### P4 — Civic per world (29)
Hub / Sundering / Ruins / Tunya / Crime / Grid / Frontier / Dawn / Crucible / Sere wayfinding + transit + street furniture.

Bibles: `Generated/CX_MANIFEST.md`, `CONCORDIA_ASSET_BIBLE.md`, `CONCORDIA_TEN_CONTINENT_VISUAL_BIBLE.md`, `CONCORDIA_GAMEPLAY_GENOME.md`.

---

## 7. Systems to bind (do not reinvent)
`MegaworldMap`, `ContinentStream` (SoftEnter / link_gate / WildernessGate), `HubLook`, `HubPlaza`, `RealmFill`, `RoadWorld`, `WildernessWildlife`, `WorldKit`, `DressVocab`, `WorldVisualDirector`, `CxDress`, `ModularPerson`, `GuestNpc` / Canon.HubGuests, `WorldBook` / NoteKill cascade, `TrainingDummy`.

---

## 8. QA / proof references
`qa-proof/sundering-road/`, `qa-proof/after-travel-sundering.png`  
Prior FAIL patterns: journey stamp clobbering kill, spoils parented under corpse, no GossipEar — cascade code fixed; **re-prove in Play**.

Project Screenshots: `Assets/Screenshots/` (Court plate series Sep 19).  
Aura captures: `~/Library/Application Support/AuraForUnity/CapturedImages/787ad77ff6579c24/`.

---

## 9. Player expectation checklist (Concordia native)
- [ ] Every named NPC looks like their CX plate / guest entry
- [ ] Every world SoftEnter shifts look + civic kit
- [ ] Roads always show a weenie + a breadcrumb
- [ ] Kill leaves spoils + memory the Hub can speak
- [ ] Towns feel lived-in (jobs, clutter, schedule) not mannequin waiting rooms
- [ ] Landmarks are unique silhouettes (Court tree, gatehouses, Market Well)
- [ ] No magenta; no Prim architecture identity; no Quaternius hero

---

## 10. Generation gaps still allowed to fill (lore-first)
Only after studying Canon/atlas — new CX plates for:
- Hub district landmarks (Market Well, Archive stacks, Warden gatehouse hero)
- Architecture kits per Tunya culture (Masond/Asbir/Aekon/Fluxom/Nil) — see FULL-MAP brief
- Missing WorldKit.Ground albedos (wet asphalt, neon grid, metal plate, concrete) if not in Poly Haven aliases
- Per-style combat VFX beyond the four P2 plates

Write new plates to `Generated/P*` with `CX_` prefix + material + prefab. Update `CX_PLATE_INDEX.json` mentally in your report.
