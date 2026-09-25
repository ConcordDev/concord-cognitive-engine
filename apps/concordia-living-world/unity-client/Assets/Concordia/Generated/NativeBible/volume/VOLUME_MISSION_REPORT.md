# Volume mission report

**STATUS: COMPLETE (design authority).** Content volume only. No meshes, no pack downloads, no hero images, no Library wipe.

## Counts

| Need | Required | Delivered |
| --- | ---: | ---: |
| Quest defs, all 10 WorldIds | ≥8 each, ≥80 total | **81** (Hub 9, each other world 8) |
| Boss / raid encounters | ≥12 | **14** (5 `mon_boss_*` plus 9 named events on existing `mon_*` bodies) |
| Companions | ≥10 | **12** |
| Items | ≥40 | **52** (13 remembrance) |
| Vendors | ≥12 | **14** |
| Density tables | 10 worlds | **10** |
| Mounts / vehicles | tack, wagon, ≥3 mounts, ≥3 vehicles | **3 mounts, 4 vehicles**, tack + wagon pin called out |

Validation: id cross-check against `skills/SKILLS.json`, `npcs/ROLES.json`, `creatures/ANIMALS.json`, `creatures/MONSTERS.json`. Quest reward items and raid remembrance ids resolve into `VENDORS_AND_ITEMS.json`. Every quest has 2–4 objectives, rewards, faction delta, and board / gossip / prop hooks. Zero errors on that pass.

## Canon pins held

- WorldIds from `Canon.cs`. Fantasy display name is the Sundering. Hub is the Unburned Court.
- Flower Law 42m. Arena exception on Gale's rack and the urn quest.
- Pinewood Crossing named on the milepost quest, the milepost raid, and the Hub density table.
- CX humanoids. No Quaternius bodies, shopkeeps, or mount donors.
- Sealie row says native mesh or nothing.
- Skill ids are references. SkillLattice is still a lookup.
- Existing Canon quest ids reused where the loop was already a complete 2–3 step chain (`first_cycle_cook`, `first_cycle_fight`, `first_day_claim_land`, `fantasy_maeris_02_steps`). Other Canon files are extended with `q_*` rows and `extends_canon_id`, not rewritten.
- Sere had no `quests/` folder. Eight new loops use Wend, Esha, Tomas, and the Curtain archivist from `Canon/sere/npcs.json`.

## Gaps (not papered over)

- No `content/items` JSON under Canon. Vendor ids are the extension surface, not a claim that a Unity item table already lists them.
- Ride controller and seated clips are absent. Mount and vehicle rows are lead, hitch, or push.
- Firearm coverage is still 0%. `item_gunsmith_part` is a vise part.
- `enc_twelfth_reap` and `enc_catalogue_walks` and `enc_junction_null` have no unique mesh. They dress existing monsters.
- Companion `kel` uses the name from `frontier_silas_02_kel`. If Canon spells that npc id differently, the Canon id wins.
- `comp_esha` uses `npc_role_sere_enforcer` only as the nearest CX silhouette. She is not an enforcer.
- Brackish is a child. Her companion row is gossip and bread. No combat, no romance.
- Coin rewards can be negative on purchase loops (Bell's tip, the switchknife, Tomas's permit). That is a cost.
- Disk at the start of the write was effectively full (~232MB reported, writes failing). A user-owned slice of `~/.npm/_cacache` was removed so these text files could land. No Unity `Library` delete, no pine re-download, no images.
- Prompt batches B10 and B11 were already props and skill cues. Volume prompts were appended as B12–B17 so those batches were not overwritten.

## Files

Primary: `~/.zuko/native-bible/volume/`  
Mirror: `Assets/Concordia/Generated/NativeBible/volume/`

Required list: README, QUESTS_BY_WORLD.json, QUESTS_CATALOG.md, BOSSES_AND_RAIDS.json, COMPANIONS.json, VENDORS_AND_ITEMS.json, DENSITY_TABLES.json, MOUNT_AND_VEHICLE.json, AURA_BIND_ORDER.md, this report.
