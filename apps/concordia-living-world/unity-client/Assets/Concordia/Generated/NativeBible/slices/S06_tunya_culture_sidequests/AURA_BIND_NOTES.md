# Aura bind notes — S06 Tunya culture

Bind this facet after S05 and after the Tunya block of `volume/DENSITY_TABLES.json`. Do not retune weights, creature caps, `enc_twelfth_reap`, `enc_pollen_sleep`, or `enc_graft_charge`. Do not edit Canon lore, factions, countries, or npc sheets. Do not download packs. Do not wipe `Library`.

Art direction is the Tunya row: solarpunk, CLT timber, solar tile, limestone, palette `#6a7a3a` `#f0d080` `#c8721a` plus the kit's `#8aa0b4` on tile. Stylized realism PBR. One emissive is a sun-catch on tile, not a circuit and not a full-body glow. Foundation is `arch_kit_tunya_veil`. A faction awning may sit on an upper storey and must leave the terrace silhouette. 100 m read is a low shelter, a glacier gate, a dune hull, a harbor pier, a raid stone, a ruin door. Humanoids are CX with the Concordia face. Plates and cloth use `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. Quaternius is not a body. Capoeira stays on `npc_role_tunya_labor` and is not copied onto these uniques.

## Spawn pairs

A schedule room spawns a unique only when this list pairs it to an anchor. Any other room spawns nothing. Missing CX mesh: that person is absent. No laborer and no factor speaks their lines. Budgets 6 and 3 stay spent by the density table and by S05.

| Unique | Window | Sheet room | Anchor |
| --- | --- | --- | --- |
| dinye_chair_oren | Stratus 5–8 | dinye_council_hall | dinye_court (9, 18) |
| dinye_registrar_kira | Stratus 5–8 | dinye_council_hall_anteroom | same anchor, beside him, not a second site |
| aekon_smith_jera | Stratus 5–8 and Quartus 13–16 | aekon_ice_forge | aekon_forge (−10.5, 60.5) |
| the_ark_wright | Stratus 5–9 | asbir_ark_terminal | asbir_ark (−90, −58) |
| sahm_provost_kez | Stratus 5–8 and Freeus 9–12 | sahm_chancellery | Sahm Academy capital (−20, 45) |
| akeia_dock_jano | Stratus 5–8 and Freeus 9–12 | akeia_main_pier | akeia_harbor (32.5, 23) |
| strip_captain_mara | Stratus 5–8 and Freeus 9–12 | strip_main_avenue | strip_last_raid (61, 59.5). Declared: the avenue is unbuilt and the memorial is the patrol stone. |
| ruins_scholar_aldra | Stratus 5–8 | ruins_excavation_site | ruins entrance (−55, −55). The entrance is the dig until a trench exists. |

Outside those windows the unique is absent even if the anchor is loaded. Jera's shopfront, Kira's archive and tavern, Corin's third-chamber night, Jano's office and tavern, Mara's office and tavern row, and Kez's residence stay empty.

Rema, Vesh, Yon, Xochi, Yenna, Torrek, Iyatte, Thal, Levia, and the young Dinye walker are not in the pair list. They spawn nothing in this facet.

## Encounter

`enc_registrar_line` is Oren and Kira at dinye_court during Stratus, plus an empty queue. Do not fill the queue. Do not instance 409 registrars. No health table. If either mesh is missing, the missing one is absent and the quest still belongs to Oren. Killing either fails `q_s06_ochre_not_a_city`.

## Quests

Register the seven objects in `POLITICS.json` beside the volume Tunya list. Do not edit the canon chains, the eight `q_tunya_*` rows, or the four `q_s05_*` rows.

Turn-in matches the JSON. Board lines fire after turn-in. No quest grants a skill, a coin amount, an item, a faction delta, or a DTU.

Failure rules in the JSON are the bind. In particular: no city stake at Dinye; no twelfth interior and no ice blade at Aekon; no anomaly opening, no third chamber, no new circuit, and no interruption of Corin's own scheduled charge; no elephant and no Rema at the corral; no signed tide writ and no Vesh moved to the pier; no raid, no bug, no sealie, and no ship at the strip; no translation and no Nil crossing at the ruins.

Do not merge doubled names. Bahiij Crossing, Akeia Capital, and Cactem Breeder Camp each keep both points.

## Do not bind

- A fauna floor on any of these anchors. S05 already refused country capitals as substitute terraces. This slice still refuses that.
- A sealie, flamingo, orca, dye-bug, elephant, parrot harpy, or Quaternius body.
- A musket, a musket-staff, or any firearm on the Asbir kit.
- An ice spell on Jera, on Aekon, or on the Vessine.
- A circuit completion, a generator hum, or a DTU mint on the ark.
- Pinewood lettering, a milepost, or a Hub-gate quest. Fluxom Gate is not that post.
- Flower Law as a Tunya-local rule. Apply it only if a fight is dragged inside the Hub 42 m disk and outside the Arena.
- The named sets `terrace_farm`, `nil_shoal_stair`, and `veil_hall` as political interiors. They remain ecology floors.
- A walk through `extends_world` into Crime, Fantasy, Superhero, the Frontier, the Crucible, or Sovereign Ruins.
- Hidden truths listed in `unresolved_on_purpose`. They are not dialogue.

## Suggested check

With no unique meshes bound, every giver is absent and none of the seven errands can be turned in by a laborer. Bind only Oren and Kira: at Stratus, Dinye Council shows two CX people and no queue; outside Stratus it shows neither; the gate 10.8 m away has no new building. Bind Jera: she appears at the forge in Stratus and Quartus, the tally walks 8.7 m to Glacier Gate, and the gate does not open a twelfth. Bind Corin: during hours 5–9 she is at the ark, her own panels may charge, the anomaly door the player is shown stays dark, and the third chamber has no entrance. Bind Kez: the corral he sends you to is empty of animals, Rema is nowhere, and the emporium is a separate pin 17.5 m from the academy. Bind Jano: the writ returns unsigned, and the two Akeia Capital points stay 16.1 m apart with no interior. Bind Mara: she is at the raid stone, the dye strip is plants, Fluxom Gate is not Pinewood, and no ship exists. Bind Aldra: three clay copies, a shut chamber 27 m out, and Nil Threshold unchanged. Swing a blade on the dye strip and the steel stays steel. Swing it after dragging the fight onto the Hub plaza, outside the Arena, and the blade is a flower.
