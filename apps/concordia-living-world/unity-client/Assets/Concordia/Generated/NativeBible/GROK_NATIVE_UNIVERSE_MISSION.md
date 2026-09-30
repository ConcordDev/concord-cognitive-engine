You are Grok on Ramaj Duncan's Mac building Concordia's NATIVE UNIVERSE ASSET + SKILL BIBLE.

## GOAL
Create a complete Concordia-native content bible: creatures, monsters, animals, crossbreeds, NPC visual designs, weapons, architecture kits, props, and skills/moves designed to bind and evolve inside Concordia Unity + Concord backend. This is generation + design authority — GTA×Palworld stylized realism — not generic asset-pack soup.

## READ FIRST (required context — do not skip)
1. ~/.zuko/ART_STYLE_GTA_PALWORLD_TEN_WORLD.md  — VISUAL NORTH STAR (GTA grit + Palworld light/silhouette). Obey 100m silhouette, bevels, PBR rules, ten-world matrix + Concordia WorldId mapping.
2. ~/.zuko/CONCORDIA_LORE_AND_ASSETS_INVENTORY.md — canon lore + gaps
3. ~/.zuko/CONCORDIA_ASSET_COUNTS_LIVE.md — live Mac counts
4. ~/.zuko/OPEN_WORLD_UNIVERSE_CONTENT_BAR.md — industry content bar / taxonomy / Unity bind fields
5. ~/.zuko/FULL_SCALE_RPG_TLDR.md and FULL_SCALE_RPG_RESEARCH_AND_CONCORD_AUDIT.md if present
6. Skim: Assets/Concordia/AuraRefs/, Concordant_Megaworld_Atlas.pdf notes, Canon-related scripts, Generated/Animation/COVERAGE.md, FreePacks/Fauna

Unity client root:
`/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client`

## HARD CONSTRAINTS
- Disk is CRITICAL (~4 GB free). Do NOT download bulk packs, Poly Haven dumps, or flood PNGs. Prefer markdown + JSON + YAML + short prompt catalogs. If you generate images, max ~20 hero concept sheets total, small resolution, under ~/.zuko/native-bible/concepts/ only.
- Do NOT kill Concord, Claude RC, Unity, or wipe Library.
- Do NOT replace CX humanoid identity with Quaternius meshes. Clips OK; CX stays Concordia face.
- Prefer SURFACE existing systems: CreatureCompiler, EvoCatalog/EvoSpawner, SkillLattice→real builds, HitResolver/ActionRunner/Hostile/CombatMotion, FactionStandingBook, WorldEventLog, GameplayCore crafting.
- Canon names: Hub = Unburned Court + Flower Law 42m; Fantasy = Sundering; use Pinewood Crossing not "Vinewood" unless you explicitly alias it.
- Every asset gets stable IDs matching bible schema (faun_*, mon_*, npc_*, wpn_*, arch_*, skill_*).

## VOLUME TARGET (alpha-credible native pack — plethora, not AAA 500k assets)
Per OPEN_WORLD bar, deliver:
- Wildlife/animals: ≥24 species across biomes (Hub ring + spokes)
- Combat monster families: ≥16 (incl. bosses) with readable silhouettes
- Crossbreeds/hybrids: ≥12 obeying primary body + secondary trait + one combat hook
- NPC visual roles: ≥18 (factions × labor/guard/merchant/bandit/elite/mystic + named Hub guest redesign notes for the 18 canon guests)
- Weapons: full verb matrix — 1H slash, 2H heavy, polearm, bow, thrown, magic focus, improvised — each with ≥3 culture skins across worlds
- Architecture kits: one kit package per WorldId (Hub+9 spokes) with sub-kits (hall/room/stair/door/facade/prop clutter) + 3 named intersection blend zones
- Skills/moves: ≥40 data-driven abilities across Steel / Presence / Craft (or better Concord-native trees), each bound to VerbId + montage intent + tags + progression ranks + aura/VFX prompts — designed to evolve (rank tables, unlock gates, faction/quest grants)

## OUTPUTS (write all of these)
Primary dir: `~/.zuko/native-bible/`
Mirror copies into:  
`…/unity-client/Assets/Concordia/Generated/NativeBible/`

Required files:
1. `README.md` — how to use the bible with Aura/Unity
2. `00_ART_DIRECTION.md` — restated GTA×Palworld rules + world mapping
3. `01_TAXONOMY.md` — full taxonomy
4. `creatures/ANIMALS.json` + `creatures/MONSTERS.json` + `creatures/HYBRIDS.json` + `creatures/CATALOG.md`
5. `npcs/ROLES.json` + `npcs/HUB_GUESTS_REDESIGN.md` + `npcs/CATALOG.md`
6. `weapons/WEAPONS.json` + `weapons/CATALOG.md`
7. `architecture/KITS.json` + `architecture/INTERSECTIONS.md` + `architecture/CATALOG.md`
8. `props/PROPS.json`
9. `skills/SKILLS.json` + `skills/VERB_MAP.md` + `skills/PROGRESSION_TREES.md` + `skills/CATALOG.md`
10. `unity/BIND_SCHEMA.md` — YAML field contract for CreatureCompiler / SkillLattice / CharacterGear / CxDress
11. `aura/AURA_GENERATION_BATCHES.md` — ordered Aura paste batches to turn bible → in-engine CX plates/prefabs/VFX (text prompts only)
12. `aura/PROMPTS_INDEX.json` — every concept prompt tagged by id
13. `MISSION_REPORT.md` — STATUS, counts delivered, disk used, NEXT for Aura bind

JSON entries MUST include: id, display_name, lore_blurb, taxonomy_tags, world_ids[], art_style_notes (GTA/Palworld), silhouette_notes, palette, scale_vs_player, unity_bind stubs, aura_prompt, stats_hooks, verb_ids where relevant.

Skills MUST include: AbilityId, VerbId, Cost, Cooldown, RequiredTags, BlockedByTags, EffectsToApply, TargetingMode, ProgressionTable, VfxCue/AuraPrompt, WeaponFilter.

Hybrids MUST state primary_plan, secondary_trait, combat_hook and pass silhouette/telegraph rules.

Architecture kits MUST state footprint/snap intent, reuse tier, materials from the ten-world matrix, traversal anchors (ledges/pipes/scaffolds).

## PROCESS
1. Ingest the six context files.
2. Draft taxonomy aligned to Canon WorldIds.
3. Generate all catalogs (animals→monsters→hybrids→npcs→weapons→architecture→props→skills).
4. Write Aura batch plan last.
5. Write MISSION_REPORT.md and stop.

START NOW. Work until all required files exist. Prefer depth and Concordia-native names over generic fantasy filler.
