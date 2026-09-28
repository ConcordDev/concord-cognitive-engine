# Mission report — Concordia native bible

**STATUS: COMPLETE (design authority).** All required files are on disk. No meshes, no pack downloads, no hero images.

## Counts delivered

| Family | Required | Delivered | File |
| --- | ---: | ---: | --- |
| Wildlife species | ≥24 | **30** | `creatures/ANIMALS.json` |
| Combat monster families, bosses included | ≥16 | **19** (5 bosses) | `creatures/MONSTERS.json` |
| Crossbreeds | ≥12 | **14** | `creatures/HYBRIDS.json` |
| NPC visual roles | ≥18 | **23** | `npcs/ROLES.json` |
| Hub presences redesigned | 18 | **18** (15 `HubGuests` + 3 `Pillars`) | `npcs/HUB_GUESTS_REDESIGN.md` |
| Weapon culture skins | 7 verb families × ≥3 | **31** weapons; each family has ≥3 skins (polearm is 3 thrust + 1 sweep) | `weapons/WEAPONS.json` |
| Architecture kits | Hub + 9 spokes | **10** world kits + **3** named blends | `architecture/KITS.json` |
| Props | clutter + interactive | **40** | `props/PROPS.json` |
| Skills | ≥40 | **45** (steel 16, presence 14, craft 15) | `skills/SKILLS.json` |
| Aura prompts | one per id | **215** | `aura/PROMPTS_INDEX.json` |

Hybrids each carry `primary_plan`, `secondary_trait`, and `combat_hook`. Skills each carry AbilityId, VerbId, Cost, Cooldown, tags, effects, targeting, progression ranks, VfxCue, and WeaponFilter. Kits each carry footprint, snap, reuse tier, ten-world materials, and traversal anchors.

## Canon pins used

- WorldIds from `Canon.cs`: Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible, Sere.
- Fantasy display name is the Sundering. Hub is the Unburned Court. Flower Law radius 42m. Arena exception.
- Pinewood Crossing is named. Vinewood is not.
- Fight styles: Karate, MuayThai, WingChun, Capoeira, Sword.
- Guest ids and heights match `Canon.HubGuests` and `Canon.Pillars`.
- Compiler topologies match `CreatureCompiler.TopologyFor`.
- Skill VFX elements point at existing Gabriel Aguiar prefabs where `SkillLattice.VfxPath` already routes them.

## Honest gaps (not papered over)

- `SkillLattice` is still a VFX lookup. These rows are the catalog to bind; they are not live talents.
- `CX_Mount_Horse` exists; a ride controller does not. `skill_craft_wagon` and `skill_craft_tack` refuse to fake a mounted camera.
- Firearm animation coverage is 0%. Gunsmithing is a vise and parts. No rifle mesh.
- Sealie must not bind the compiler's flamingo stem. The animal row says spawn the native mesh or nothing.
- Humanoids stay CX. Quaternius is not a body donor.
- No concept images were generated, to protect disk.

## Disk

- Free space at the start of the write was about 11Gi on the data volume. The bible itself is about 900KB of markdown and JSON (primary tree `du` ≈ 896K; Unity mirror ≈ 992K).
- No Poly Haven dump, no image batch, no Unity Library wipe, no process kills.

## Files

Primary: `~/.zuko/native-bible/`  
Mirror: `Assets/Concordia/Generated/NativeBible/`

Required list is present in both trees: README, art direction, taxonomy, creature JSON + catalog, NPC JSON + guest notes + catalog, weapons JSON + catalog, kits JSON + intersections + catalog, props JSON, skills JSON + verb map + progression + catalog, bind schema, Aura batches, prompts index, this report.

## NEXT for Aura bind

1. B0 silhouette contact sheet, then B1 the eighteen Hub plates (CX face).
2. Bind one vertical slice before the rest of the catalog: Pinewood stag + salt road milepost + Court flower weapon + `skill_steel_ward_cut` + `skill_presence_flower_law`, using `BIND_SCHEMA.md`.
3. Second slice: Sundering wolf (native mesh), fold basilisk, ward-blade, `arch_kit_fantasy_sunder` graybox.
4. Only then bosses and hybrids.
5. Do not retarget Quaternius over CX. Do not mark SkillLattice "done" until a rank changes an `ActionRunner` window or an effect magnitude in play.

## Addendum — content volume (2026-09-22)

The catalogs above were not rewritten. Playable volume sits beside them in `volume/` (mirror `Assets/Concordia/Generated/NativeBible/volume/`).

- 81 quest loops (`volume/QUESTS_BY_WORLD.json`), at least 8 per WorldId. Canon ids kept where the chain was already a full loop; new ids are `q_<world>_<slug>`.
- 14 raid encounters, 12 companions, 52 items, 14 vendors, density for all 10 worlds, 3 mounts and 4 vehicles with the ride-clip gap stated.
- Bind order for EVERYTHING paste Phase 7: `volume/AURA_BIND_ORDER.md`.
- Prompt addendum is B12–B17 in `aura/AURA_GENERATION_BATCHES.md` (B10–B11 were already props and skill cues).
- Status and gaps: `volume/VOLUME_MISSION_REPORT.md` (**STATUS: COMPLETE**).


## Addendum — look, feel, map (2026-09-24)

Catalogs in this bible were not rewritten. The megaworld look pack sits beside them at `~/.zuko/lookfeel/` (mirror `Assets/Concordia/Generated/LookFeel/`).

- Master map, ten style boards, ten geography briefs, UI / light / cue language, and the organic feed notes.
- Prompt rows appended to `aura/PROMPTS_INDEX.json`: batches `B18_lookfeel_env`, `B19_lookfeel_arch`, `B20_lookfeel_flora`. Prior 215 ids are unchanged. B12–B17 in the batch file remain the volume sheets.
- Status: `lookfeel/LOOKFEEL_MISSION_REPORT.md`.
