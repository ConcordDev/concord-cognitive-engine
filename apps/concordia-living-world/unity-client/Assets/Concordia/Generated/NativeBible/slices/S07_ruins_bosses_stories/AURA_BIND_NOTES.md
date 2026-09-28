# Aura bind notes — S07 Ruins bosses

Bind this facet after the Ruins block of `volume/DENSITY_TABLES.json` and after `enc_unfinished` and `enc_catalogue_walks` in `BOSSES_AND_RAIDS.json`. This slice adds caps, one derived floor, three new windows, drop conditions on the two existing tokens, and four quests. It does not replace weights, those two clocks, or the token ids.

Art prompts already live on `faun_ash_wolf`, `faun_catalogue_crow`, `faun_rib_lizard`, `mon_ruins_wraith`, `mon_ruins_crawler`, `hyb_ribwolf`, `hyb_ashfang`, `hyb_mercywraith`, and `mon_boss_unfinished`. Reuse those. Do not commission a sheet for a rat king, a courtier revenant, a feral hound, a second crawler species, or a CX slab. Do not download packs. Do not wipe `Library`.

## Spawn order

1. If `bone_yard` has no transform, crows, lizards, the ambient crawler, ribwolves, `enc_rib_basket`, and `enc_catalogue_walks` spawn nothing. Do not use a capital, `basin_open_carry`, or the generic roadside ruin at local (14, 104) as the yard.
2. If `unburial_court` has no transform, `enc_unfinished` spawns nothing. Do not move the slab to the archivist capital or to the political court.
3. `basin_open_carry` is the gap derived in `BOSSES.json`: midpoint (4.1, −30.5), between scavenger radius 25.5 at (−31.7, −27.55) and archivist radius 25.5 at (39.83, −33.42). Wolves and the two dusk windows use that floor. If CountryCenter stops resolving those capitals, the gap is unplaced and those spawns become nothing.
4. `faun_ash_wolf` cap 4, one pack, dusk to night, day cap 0, open only. S03's Fantasy shoulder cap of 4 is unchanged and is not added to this four. Ambient cap 0 while `enc_returned_kill` is up.
5. `faun_catalogue_crow` cap 8, day, on ribs in the yard. Night 0. Inside an active yard circle, 0.
6. `faun_rib_lizard` cap 3, day, sunned bone. Night 0. Not a hitbox. Inside an active circle, 0.
7. `mon_ruins_crawler` ambient cap 1 in the yard outside the catalogue window. During `enc_catalogue_walks`, ambient 0 and the event fields one crawler.
8. `hyb_ribwolf` ambient cap 2 in the yard outside the basket window. During `enc_rib_basket`, ambient 0 and the event fields two.
9. `mon_ruins_wraith` ambient cap 2 on the archivist edge and in placed interiors. Cap 0 in the yard, on the north shelf, on the boss floor, and while `enc_late_breath` or `enc_catalogue_walks` is up.
10. `enc_rib_basket`: hours 11–13, every second day, yard circle. Telegraph board, scout, and sound before aggro. Catalog hostile flag on the hybrid is false. The window sets aggro inside the circle without editing the file.
11. `enc_catalogue_walks`: volume hours 15–17, every second day. If the basket circle is still occupied at 15:00, skip the day. Margins are two existing wraiths. Do not finish them.
12. `enc_returned_kill`: hours 18–20 when `day_index % 3 == 0`, using the volume day counter. Four wolves. No ashfang.
13. `enc_late_breath`: hours 18–20 when `day_index % 3 == 1`. One wraith at (14.4, −31.3). Both bangles start intact.
14. `enc_unfinished`: volume hours 21–23, every third day, one slab, no adds. A kited body despawns at the overlook lip.
15. North shelf, archive–denier overlap, wilds ring, Pinewood Crossing (62, −28), and the Fantasy ash shoulder: fauna cap 0 for every id this slice owns.

Missing mesh on any row: spawn nothing for that row. Do not borrow a fox, a finch, a bedsheet, a thin scorpion, a CX humanoid, a Quaternius body, or a Kenney body. Clips may retarget later onto a native mesh that does not yet exist. `canon_kind_alias` wolf on Ruins resolves to `faun_ash_wolf` only inside the open at the cap above. The griffin alias resolves to nothing in this facet. The wraith alias resolves to `mon_ruins_wraith` at the cap above, not to `ash_revenant`.

## Hit resolution

Ruins steel is live. Do not apply Flower Law to a staple cut in the ash. Do apply it if a body is dragged inside the Hub 42 m disk and outside the Arena: the blade is a flower, and the kite is not a catalogue. Health stays the table already on the row: `table:faun_critter`, `table:faun_med_predator`, `table:mon_skirmisher`, `table:mon_tank_small`, `table:boss_region`. No live numbers were authored here.

`skill_steel_unburial` opens the boss staples in the volume's second phase. Bind `cue_unburial`. The skill row points at an existing smoke prefab. Ash and a staple glint fit. A soul orb does not. Do not retune the skill file.

`skill_presence_lament` is the page-close during the ask, at rank 3 or higher, and the hand-stop on the late breath. It does not delete the dead. Bind `cue_lament`.

`skill_craft_catalogue` names a line and mends a staple. It does not raise a body. The catalogue-walk phase and the open-carry errand both use it. Do not grant the skill again from this slice's quests. Volume quests already grant it where they grant it.

`faun_ash_wolf` is `hostile: true` in `ANIMALS.json`. Instance aggro is the returned kill. The other yard bodies and the wraith are `hostile: false` in the catalogs. Windows set circle aggro without editing those files.

The boss rule on `mon_boss_unfinished` remains the law: close the page, or the slab stands once. Wearing the mask fails the Refusal and suppresses `item_rem_unfinished_mask`. The tooth drops only on a broken line with unfinished margins.

## Quests

Register the four objects in `BOSSES.json` beside the volume Ruins list. Do not edit `q_ruins_crow_catalogue`, `q_ruins_wraith_unfinished`, `q_ruins_fourth_plan`, `q_ruins_half_layer`, `q_ruins_undoing`, `q_ruins_lizard_rib`, `q_ruins_unstack`, `q_ruins_mask_scout`, or the canon chains `ruins_calla_02_plan`, `ruins_thanis_02_layer`, and `ruins_silv_02_teach`.

Giver is `npc_role_ruins_keeper`, inside the density budget of 4. One role, not four extra people. `scavenger_boss_thren` speaks once on the tooth errand and is not cloned. `calla` is not in these quests. Elite budget 2 stays on the tent.

`q_s07_basket_left` does not start while the yard is unplaced. `q_s07_mask_to_shelf` and `q_s07_tooth_not_chit` do not start unless the token is already in inventory, and they do not mint a token to become completable. Turn-in of a token removes it from the pack onto the shelf. Board lines fire after turn-in. No quest grants a skill. No quest mints a DTU. No quest speaks Vela's withheld cause, Zaen's meetings, or Hen's copy.

The open errand fails if a hide is looted, a returned kill is finished, a cairn is left at three, or the unmapped quarter is claimed. The basket errand fails if the rib is looted, the lizard dies, the basket is worn, or a capital was used as a fake yard. The mask errand fails if the mask is equipped, sold, spawned for the quest, or turned in at Calla's tent. The tooth errand fails if it is traded for chits, spawned for the quest, or used to start the fourth uprising.

## Do not bind

- `ruin_rat_king`, `ash_revenant`, `gloom_stalker`.
- A CX body for `mon_boss_unfinished`, for a wraith, or for any fauna id.
- `hyb_ashfang` on the Ruins side of the gate. `hyb_mercywraith` anywhere this facet touches, including the envoy capital.
- `mon_sunder_griffin` in the ash. A second crawler. A third ribwolf in the basket window. A fifth ash wolf on S03's shoulder.
- Fauna on the north shelf, in the archivist–denier overlap, in the wilds ring, or at Pinewood Crossing.
- A new `item_rem_` id. A weapon built from the mask or the tooth.
- The volume faction string `glyph_keepers` as if this slice had renamed it. New deltas use `ruins_archivists` and `ruins_scavenger_crews`.
- A paved pilgrim walk, an opened sealed vote-record, or a still-running spell in quarantine.

## Suggested check

With the yard and the unburial court unplaced, search the Ruins instance and find no crow, lizard, crawler, ribwolf, or Unfinished. The open, if the two capitals still resolve, holds at most four ash wolves at dusk and none at noon. On a second-day morning the yard, once placed, shows two ribwolves and no crawler event. That afternoon, if the morning circle is empty, one crawler and two margin wraiths, and the ambient crawler slot stays empty. On a dusk whose day index modulo 3 is 0, four wolves at the midpoint and no wraith event. On modulo 1, one wraith at the archivist edge and the pack not in event aggro. At the volume night, one slab under the overlook, no adds, and a worn mask produces no token. Swing inside the Hub disk at a kited wolf and get a flower, not a fang. Complete the four errands without a new skill, a new token id, or a line about Vela's cause.
