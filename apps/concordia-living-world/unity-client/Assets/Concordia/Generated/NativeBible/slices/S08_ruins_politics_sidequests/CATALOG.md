# Catalog — S08 Sovereign Ruins politics

Six cultures on six canon factions. Eight errands. No new species, no new boss, no new item. Country circles are rims. Kit sets spawn nothing until they have a transform. S07 still owns the caps.

## Cultures

| id | Name | Who speaks | Public law this slice uses |
| --- | --- | --- | --- |
| `culture_twelve_benches` | Three benches, twelve archives | Kestra, Oeric, Sennit beside her. Vela stays in an unplaced chamber | A vote waited on a written history. Three people still write. Nine benches have no body |
| `culture_night_haul` | The night haul | Thren at the count, Iby after it | Carry what you can carry. A glyph-bearing find goes back. A sealed vote stays sealed. A live binding is walked around |
| `culture_still_cast` | The cast that has not finished | The Long Summons, on the still-casting pin | Fidelity to the original cast. Completion is not granted here |
| `culture_witness_walk` | The witness walk | Isen at the lodge | Come, see, carry the lesson home. The ground stays uncomfortable. He has not asked for a road |
| `culture_sister_watch` | The sister watch | Marrin at the compound | Study the exhaustion so Concordia does not repeat it. The public compact is a cap of 9 and a week |
| `culture_closed_book` | The closed book | Palen at the meeting house | The motto says abandoned, not collapsed. The journals he is known to hold do not come into the room |

## Regions

| id | Ground | Measured |
| --- | --- | --- |
| `region_third_bench` | Archivists capital (39.83, −33.42) r 25.5; `sovereign_archive` (47.83, −39.42), 10.0 m at (+8, −6) | Circle overlaps deniers 16.1 m, spirits 17.6 m, pilgrims 19.5 m, envoy 17.4 m |
| `region_north_camp` | Scavengers (−31.7, −27.55) r 25.5; `scavenger_camp_north` (−23.7, −33.55), 10.0 m | 71.8 m from the archivists. Gap 20.8 m is S07’s open carry. Touch with the deniers is 0.6 m |
| `region_still_casting` | Spirits (46.99, −0.82) r 25.5; `the_still_casting_quarter` (54.99, −6.82), 10.0 m | 2.6 m from the pilgrim capital and from the lodge pin |
| `region_lodge` | Pilgrims (44.94, −2.36) r 25.5; lodge (52.94, −8.36), 10.0 m | 11.0 m from the envoy capital |
| `region_compound` | Envoy (55.86, −3.91) r 25.5; compound (63.86, −9.91), 10.0 m | Local x 63.86 is not Pinewood |
| `region_meeting_house` | Deniers (11.25, −48.72) r 23.0; meeting house (19.25, −54.72), 10.0 m | Disputed with archivists, pilgrims, envoy. Fauna cap on that overlap stays 0 |
| `region_north_shelf` | Spirits, pilgrims, envoy, and the archivist circle’s northern reach | One shelf. S07 fauna cap 0. This slice adds people, not beasts |
| `region_open_carry` | Gap midpoint (4.1, −30.5), already derived in S07 | Wolves stay S07. No crew is given the gap as territory |
| `region_unplaced_court` | Throne, sanctum, rebel camp, rebel tent, scribe chamber, refused circle, memorial, silent library, south camp, unmapped quarter, research outpost, quarantine, alternative outpost, long-summons chamber, blessing grove, pilgrim path | Names in the sheets. No coordinate. Spawn nothing |

## Presences

One body each. Outside the window, absent. Keeper budget 4 and elite budget 2 stay the density table’s. These uniques do not spend them.

| id | Window | Anchor |
| --- | --- | --- |
| `archivist_three_kestra` | Clock 7–11 | `sovereign_archive` |
| `ruins_apprentice_sennit` | Clock 7–11, beside her, no quest | same pin |
| `archivist_two_oeric` | Clock 11–15 | same pin, after they leave |
| `scavenger_boss_thren` | Clock 3–7 | `scavenger_camp_north` |
| `spell_reader_iby` | Clock 7–11 | same camp pin |
| `the_long_summons_spirit` | All diurnal except Dominus 1–4 | `the_still_casting_quarter`, and only if a native ash-robe mass is bound |
| `pilgrim_leader_isen` | Clock 7–11 | `pilgrim_lodge_at_the_gate` |
| `ruins_courier_pell` | Clock 19–23, no quest | same lodge pin |
| `envoy_chief_marrin` | Clock 8–12 | `envoy_compound` |
| `denier_priest_palen` | Clock 8–11 | `denier_meeting_house` |

## Quests

| id | Giver | Stops at | Does not replace |
| --- | --- | --- | --- |
| `q_s08_three_of_twelve` | Kestra | A count of three staffed benches | Volume crow, wraith, cairn, lizard, mask scout; S07’s four |
| `q_s08_first_entry` | Oeric | The evacuation sentence, heard once at the archive pin | His morning form, which has no pin |
| `q_s08_seal_not_tonight` | Thren | The sealed Council record stays shut | Any opening of the vote, any south-camp scene |
| `q_s08_walk_around_it` | Iby | One binding marked, then walked around | Un-casting, teaching the reading, the unmapped quarter |
| `q_s08_ground_unpaved` | Isen | Lodge to pilgrim capital and back, ground still ash | A paved route, a formal Concordia pilgrimage |
| `q_s08_cap_nine_seven_days` | Marrin | Cap 9 and seven days, written as inventory | The unsigned letters, the Hub, the algebra |
| `q_s08_desk_stays_shut` | Palen | The motto, spoken. The journals, absent from the table | Ending the denier movement |
| `q_s08_name_unanswered` | The Long Summons | One call heard. No answer given | Completing the cast, naming the dead recipient |

No quest grants a skill, a coin amount, an item, a faction delta, or a memory shard.

## Standing ecology

| id | Political place | Who owns the numbers |
| --- | --- | --- |
| `faun_ash_wolf` | The unclaimed gap between crews and archivists | S07 cap |
| `faun_catalogue_crow`, `faun_rib_lizard`, `mon_ruins_crawler`, `hyb_ribwolf` | Bone yard, unplaced | S07 |
| `mon_ruins_wraith` | A person-shaped gap, not a faction | S07 |
| `mon_boss_unfinished` | Unburial court, which is not Thanis’s throne | S07 `enc_unfinished` |
| `hyb_ashfang`, `hyb_mercywraith`, `mon_sunder_griffin` | Cap 0 on this continent for the reasons S07 wrote | S07 |

`ruin_rat_king`, `ash_revenant`, and `gloom_stalker` stay unspawned canon seeds.

## Political encounters

| id | Bodies | Health |
| --- | --- | --- |
| `enc_morning_count` | Thren, hours 3–7, camp pin. Iby arrives at 7 as Thren’s window ends | None |
| `enc_shelf_names` | Long Summons on the still-casting pin; Isen 2.6 m away at the lodge during 7–11; Marrin 9.4 m away at the compound during 8–12 | None |

A fight on either encounter fails the quest that is open there. Steel stays steel. Flower Law is not applied on this continent.
