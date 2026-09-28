# Aura bind notes — S08 Ruins politics

Bind this facet after S07 and after the Ruins block of `volume/DENSITY_TABLES.json`. Do not retune weights, creature caps, `enc_unfinished`, `enc_catalogue_walks`, `enc_rib_basket`, `enc_returned_kill`, or `enc_late_breath`. Do not edit Canon lore, factions, countries, or npc sheets. Do not download packs. Do not wipe `Library`.

Art direction is the Ruins row: abyssal ash, igneous, fossil bone, cold iron, palette `#5a5044` `#b89060` `#2a1c14` plus the kit's `#c8a070` on the dull sun. Stylized realism PBR. One emissive per figure, on a nib, a seal's edge, a brass button, or a mouth-light that dies when the name ends. Foundation is `arch_kit_ruins_ash`. A faction cloth color may sit on an upper storey and must leave the rib silhouette. 100 m read is a crooked slab, a camp table, a lodge, a compound door, a meeting house, a thick robed mass. Humanoids are CX with the Concordia face. Plates and cloth use `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. Fight style Sword stays on people. Quaternius is not a body.

## Spawn pairs

A schedule room spawns a unique only when this list pairs it to an anchor. Any other room spawns nothing. The sheets carry two clocks in one array, hour-bands and named phases. Bind the window in this table once. A second row that names the same person spawns no clone. Missing CX mesh: that person is absent. No keeper and no elite speaks their lines. Budgets 4 and 2 stay spent by the density table. These uniques do not spend them.

| Unique | Window | Sheet room | Anchor |
| --- | --- | --- | --- |
| archivist_three_kestra | Clock 7–11 | sovereign_archive | ruins_archivists_district (47.83, −39.42) |
| ruins_apprentice_sennit | Clock 7–11 | sovereign_archive | same pin, beside her |
| archivist_two_oeric | Clock 11–15 | sovereign_archive | same pin, after they leave |
| scavenger_boss_thren | Clock 3–7 | scavenger_camp_north | ruins_scavenger_crews_district (−23.7, −33.55) |
| spell_reader_iby | Clock 7–11 | scavenger_camp_north | same camp pin |
| the_long_summons_spirit | All diurnal except Dominus 1–4 | the_long_summons_chamber | ruins_spell_spirits_district (54.99, −6.82). Declared: the chamber is unbuilt and the district pin is the floor. Native ash-robe mass or nothing. |
| pilgrim_leader_isen | Clock 7–11 | pilgrim_lodge_at_the_gate | ruins_pilgrims_district (52.94, −8.36) |
| ruins_courier_pell | Clock 19–23 | pilgrim_lodge_at_the_gate | same lodge pin |
| envoy_chief_marrin | Clock 8–12 | envoy_compound | ruins_concordia_envoy_district (63.86, −9.91) |
| denier_priest_palen | Clock 8–11 | denier_meeting_house | ruins_cascade_deniers_district (19.25, −54.72) |

Outside those windows the unique is absent even if the anchor is loaded. Vela, the Silent Keeper, the Endless Blessing, Clovis, the returning pilgrim, Thanis, Hen, Zaen, Silv, Calla, Finn, Arn, Pol, the Almoner, and the generated Gale-names are not in the pair list. They spawn nothing in this facet.

District pins are 10.0 m from their capitals at (+8, −6). Do not merge a capital and its district into one transform. Do not spawn these uniques on the capital unless the quest walks the player there empty-handed.

## Encounters

`enc_morning_count` is Thren alone at the camp pin, hours 3–7. No health table. The sealed packet is a set dressing, not an item id. At 7 she is gone and Iby is there. Killing either fails the quest they give.

`enc_shelf_names` is three pins. The summons on the still-casting pin, Isen 2.6 m away at the lodge during 7–11, Marrin 9.4 m from the summons and 11.0 m from the lodge during 8–12. No one paths onto another's pin. No health table. Killing any of them fails the quest open on that pin. If the spirit mesh is missing, the shelf is Isen and Marrin only, and `q_s08_name_unanswered` cannot be turned in.

## Quests

Register the eight objects in `POLITICS.json` beside the volume Ruins list. Do not edit the canon chains, the eight `q_ruins_*` rows, or the four `q_s07_*` rows.

Turn-in matches the JSON. Board lines fire after turn-in. No quest grants a skill, a coin amount, an item, a faction delta, a memory shard, or a DTU.

Failure rules in the JSON are the bind. In particular: no fourth bench and no successor speech at the archive; no courtyard and no recopied line for Oeric; no opened seal and no south camp; no un-cast and no lesson from Iby; no paver and no memorial path for Isen; no letter and no Hub walk for Marrin; no journal and no ended movement for Palen; no answered name and no invented syllable for the summons.

Do not treat the (+8, −6) offset as a street to decorate. Six identical offsets are the file's generator, and they stay six identical offsets.

## Do not bind

- A fauna floor on any of these anchors. S07 already refused country capitals as substitute yards. This slice still refuses that. `basin_open_carry` keeps its wolves and gains no crew.
- A retune of `faun_ash_wolf`, `faun_catalogue_crow`, `faun_rib_lizard`, `mon_ruins_wraith`, `mon_ruins_crawler`, `hyb_ribwolf`, or `mon_boss_unfinished`.
- `hyb_ashfang`, `hyb_mercywraith`, `mon_sunder_griffin`, `ruin_rat_king`, `ash_revenant`, or `gloom_stalker` as a spawn.
- Vela on the archive pin. Her 20 m field is real on her sheet and has nowhere placed to sit.
- The Silent Keeper as a combat tutorial on a capital.
- A CX body, a hologram robe, or a full-body glow for the Long Summons.
- A pistol or any firearm on Marrin.
- Pinewood lettering on the compound. Local x 63.86 is not the Crossing.
- Flower Law as a Ruins-local rule. Apply it only if a fight is dragged inside the Hub 42 m disk and outside the Arena.
- The named sets `catalogue_hall`, `unburial_court`, and `bone_yard` as political interiors. They remain S07 floors.
- A coordinate for the throne, the rebel camp, the tent, or the refused circle.
- The generated factions Concord Keepers and Covenant Seekers.
- A walk through the π/4 gate into the Hub, or through any `extends_world` label. Every Ruins country already says `sovereign-ruins`.
- Hidden truths listed in `unresolved_on_purpose`. They are not dialogue.

## Suggested check

With no unique meshes bound, every giver is absent and none of the eight errands can be turned in by a keeper or an elite. Bind Kestra and Sennit: at 7–11 the archive pin shows two CX people; the capital 10 m away shows no new hall; after 11 both are gone. Bind Oeric: he appears at 11–15 on that same pin, says the evacuation sentence once, and the memorial courtyard stays empty. Bind Thren, then Iby: the seal is visible and not an inventory item; at 7 the pin changes hands; the unmapped quarter spawns neither. Bind the summons only with the ash-robe mass: one mouth-light, then dark, on a pin 2.6 m from the lodge; a missing mesh leaves the pin empty and blocks that turn-in. Bind Isen: the 10 m to the pilgrim capital is ash with no paver, and answering the summons fails his errand. Bind Marrin: the sheet gains two numbers and stays on the table; the compound is not lettered Pinewood. Bind Palen: pamphlets on the table, no journal prop, quarters empty. Bind Pell at 19–23 only, with nothing to carry. Swing a blade at the camp and the steel stays steel. Swing it after dragging the fight onto the Hub plaza, outside the Arena, and the blade is a flower.
