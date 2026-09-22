# Taxonomy

Spine for every id in this bible. Add a row only if it fits a family below. New families need a reason and a skeleton or a verb that already exists.

## Continents

`Hub` `Ruins` `Tunya` `Fantasy` `Crime` `Cyber` `Frontier` `Superhero` `Crucible` `Sere`

Gates on the Hub ring, in `Canon.Gates`: Cyber, Ruins, Fantasy, Tunya, Frontier, Crime, Superhero, Crucible. Sere is a waystone, not a ninth Refusal gate.

DressVocab cultures, when a mesh must fall back: `court` `grove` `ash` `street` `grid` `drift`.

## Fauna (`faun_`)

Wildlife. They can nip. They are not boss budgets.

| Subclass | Job | Examples |
| --- | --- | --- |
| Prey / herd | Hunting and roads | Pinewood stag, terrace goat, wind pronghorn |
| Predator | Ecology, small fights | Sundering wolf and its ash and dust subspecies (one skeleton) |
| Working | Settlement life | Veil hound, wharf hound, marked hound (one hound skeleton) |
| Mount | Traversal prop until ride code exists | Wagon horse |
| Aerial | Sky and roof density | Court pigeon, ark heron, rain gull, aegis kestrel |
| Critter | Cheap ambient | Lantern moth, sodium rat, smog roach, rib lizard |

Topologies accepted by `CreatureCompiler.TopologyFor`: `quadruped`, `winged_quadruped`, `winged_biped`, `serpentine`, `humanoid`, `amorphous`, `polyped`, `eel`.

Canon kind aliases (compiler / RoadWorld): wolf, hound, sealie, horse. Griffin, basilisk, harpy, wraith, drone, sentinel, construct, drift are monsters, not wildlife, even though `Canon` lists them on `WorldDef.fauna`.

## Monsters (`mon_`)

| Role | Job |
| --- | --- |
| Brute | One mass, few heavy attacks |
| Skirmisher | Readable alone, often in a small group |
| Swarmer | Cheap disc or jackal, group telegraph |
| Tank | Plates, a weak point that is painted or placed |
| Artillery | Distinct windup color |
| Aerial | Winged, dive or grab |
| Elite humanoid | Road watcher, masked, CX proportions |
| Boss | A personality and a law, not a larger HP bar |

Bosses: `mon_boss_held_curse`, `mon_boss_unfinished`, `mon_boss_census`, `mon_boss_unender`, `mon_boss_compound_mark`.

## Hybrids (`hyb_`)

Required fields: `primary_plan`, `secondary_trait`, `combat_hook`.

Pass: one locomotion, one donor, one telegraph. Shared skeleton with the primary. No third animal. No thin legs. No new gait.

## People

| Kind | Where |
| --- | --- |
| Visual role `npc_role_` | Factions × labor, guard, merchant, bandit, elite, mystic |
| Hub guest | `Canon.HubGuests` (15) + `Canon.Pillars` (3) = 18 presences. Notes only. |
| Road bandit | `npc_role_road_bandit`, skinned per spoke, id pattern `road-bandit-{SHORTNAME}` |
| Road watcher | `mon_road_watcher`, one mesh, culture skins |

Fight styles stay the five in `Canon.FightStyle`: Karate, MuayThai, WingChun, Capoeira, Sword.

## Weapons (`wpn_`)

Verb first, culture skin second.

| Verb family | Id stem |
| --- | --- |
| One-hand slash | `verb_1h_slash` (thrust is a sibling, `verb_1h_thrust`) |
| Two-hand heavy | `verb_2h_heavy` |
| Polearm | `verb_polearm_thrust`, `verb_polearm_sweep` |
| Bow | `verb_bow_release` |
| Thrown | `verb_thrown` |
| Magic focus | `verb_cast_release`, `verb_cast_loop` |
| Improvised | `verb_improvised_swing` |

## Architecture

One high or medium kit per WorldId, sub-kits `hall` `room` `stair` `door` `facade` `prop_clutter`. Three rare glue kits `arch_ix_*`. Footprints are multiples of 4m. Door clear is 1.2 × 2.2m. Corridor at least 2.4m.

## Props (`prop_`)

`structural` (repeat), `clutter`, `set`, `hero` (sparse). Interaction: `none`, `loot`, `animate`, `physics`.

## Skills (`skill_`)

Trees: **steel** (HitResolver verbs), **presence** (hail, witness, law), **craft** (GameplayCore stations and CX dress). Each skill has one `VerbId`. Ranks live in `ProgressionTable`. See `skills/PROGRESSION_TREES.md`.

## Biome declaration (what may spawn)

| WorldId | Fauna | Monsters | Kit |
| --- | --- | --- | --- |
| Hub | court pigeon, moth, cat, hare, stag on the ring, horse at the stable outside the law | salt wyrm outside 42m only | `arch_kit_hub_court` |
| Fantasy | wolf, boar, owl, elk, finch, stag | basilisk, griffin, held curse | `arch_kit_fantasy_sunder` |
| Tunya | sealie, veil hound, goat, pollen hare, heron, finch | harpy, reap jackal | `arch_kit_tunya_veil` |
| Ruins | ash wolf, crow, rib lizard | wraith, crawler, unfinished | `arch_kit_ruins_ash` |
| Crime | dock hound, rat, gull | bill hound, census drone skin | `arch_kit_crime_coast` |
| Cyber | stray, sparrow | drone, sentinel, construct, census | `arch_kit_cyber_grid` |
| Frontier | dust wolf, horse, pronghorn | domebreaker | `arch_kit_frontier_road` |
| Superhero | kestrel | mercy sentinel | `arch_kit_superhero_dawn` |
| Crucible | unclosed moth | drift, un-ender | `arch_kit_crucible_lattice` |
| Sere | marked hound, roach | compound mark, drone skin | `arch_kit_sere_mark` |

Hybrids spawn on the borders named in their `world_ids`, never as a random mash in the Hub plaza.
