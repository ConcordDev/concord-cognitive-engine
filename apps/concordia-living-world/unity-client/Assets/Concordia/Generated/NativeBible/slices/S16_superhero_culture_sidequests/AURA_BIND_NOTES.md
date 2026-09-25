# Aura bind notes — S16 Permanent Dawn culture

Bind this facet after S15 and after the Superhero block of `volume/DENSITY_TABLES.json`. Leave weights, creature caps, role budgets, `enc_unfinished_sunrise`, `enc_yielded_stoop`, `enc_open_brow`, `enc_pauldron_medal`, and `enc_podium_chalk` on their clocks. Leave Canon lore, factions, countries, and npc sheets unread by any writer. Download no packs. Wipe no `Library`. Re-download no pines. Stop no Concord, Unity, or Claude process.

Art direction is the Superhero row: marble composite, chrome, glass. Palette `#d8d4dc` `#ffd0a0` `#3a78ff`, kit gold `#c8a060`, Canon ground `#4a5870`, sun `#ffd0a0`. Stylized realism PBR. One readable mass. No full-body glow, no kinetic cascade on Vale, no sonic ring on Juno, no emergence VFX on Devon. A faction cloth color may sit on a coat and must leave the dawn silhouette. Foundation is `arch_kit_superhero_dawn`. Ground floor is the culture. 100 m read is a municipal block, a storefront, a headquarters door, and a skyline of claims that already exist as circles. Humanoids on the pair list are CX with the Concordia face. Plates and cloth use `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. Fight style Karate stays on people, empty-handed here. Quaternius is not a body. A firearm is not a mesh. A child is not a presence. A kestrel is not a clerk.

## Spawn pairs

A schedule room spawns a unique only when this list pairs it to an anchor. Any other room spawns nothing. Bind the window in this table once. A second row that names the same person spawns no clone. Missing CX mesh: that person is absent. No elite and no adept speaks their lines. Elite budget 4 and mystic budget 2 stay spent by S15. These uniques do not spend them.

| Unique | Window | Sheet room | Anchor |
| --- | --- | --- | --- |
| `task_force_commander_sasha_vale` | Clock 8–12 | `task_force_HQ_municipal` | (−14.87, 29.22). The capital (−22.87, 35.22) is 10 m away and is a visit, not a second body. |
| `civil_rights_lead_juno_park` | Clock 8–12 and 18–22 | `movement_office_storefront` | (−47.95, −16.88). One body across both windows. The rights capital is 10 m away and does not get a copy. |
| `baseline_lead_devon_cross` | Clock 8–12 | `resistance_headquarters` | (−26.07, −46.6). The Baseline capital is 10 m away and keeps the S15 mystic. He does not replace that mystic. |

Outside those windows the unique is absent even if the anchor is loaded. Elias, Bex, Vesper, both Marcus sheets, Kade, Aldis, Kira, Mira, Kor, Iron Hex, Silas, Helen, Ana Pell, Dale Carver, Robin Orange, and walker_bullet are not in the pair list. They spawn nothing in this facet. Devon's son has no sheet.

The Stratus, Freeus, Quartus, Penanus, and Solnus blocks that also name these districts stay unstaged where they disagree with the primary day. Vale is not kept on the HQ through 17–20 to satisfy Penanus while the evening block puts her in a dining room. Juno is not kept through 13–16 while afternoon is varies. Devon is not kept through the afternoon while the sheet says chambers.

## Encounters

`enc_s16_briefing` is Vale alone, 8–12. No health table.

`enc_s16_storefront_day` is Juno alone, 8–12 and 18–22. No health table. The overlap midpoint 9.34 m away stays empty of her.

`enc_s16_headquarters` is Devon alone, 8–12. No health table. The mystic at the capital stays S15's.

`enc_s16_grid_empty` is a visit at (−36.76, 13.93). Bodies none. The arterial 8.03 m away stays S15's eleven stand and stays empty of a new body.

`enc_s16_campus_empty` is a visit at (59.16, 16.78). Bodies none. No dean, no student, no kestrel.

`enc_s16_two_faces` is `notice_two_faces`. Hours 18–22. Bodies none. The board text is the telegraph. It does not suppress `enc_open_brow`, and that window does not suppress it. The gap is 67.73 m from the board.

Killing Vale, Juno, or Devon fails the quest open on that pin. No writ, token, chit, credit, band, or medal drops.

## Quests

Register the eight objects in `POLITICS.json` beside the volume Superhero list and beside S15's four. Leave the canon chains, the eight `q_superhero_*` rows, and `q_s15_spire_gap`, `q_s15_eleven_stand`, `q_s15_no_flinch`, `q_s15_act_unpassed` on their givers.

Turn-in matches the JSON. Board lines fire after turn-in. No quest grants a skill, a coin amount, an item, a faction delta, a memory shard, or a DTU.

`q_s16_three_heights` may reach the gap while `enc_open_brow` is up. The jackal clear stays S15's. The errand does not continue to the Spire gate. `q_s16_motto_on_the_grid` must not path the 8.03 m onto the arterial. `q_s16_four_arrests` and `q_s16_clinic_unplaced` must not walk the overlap as their clear. `q_s16_draft_not_vote` must not turn in to the mystic. `q_s16_two_headlines` must not instantiate Mira. `q_s16_less_than_apex` must not build a dining room. `q_s16_three_purses` runs only while all three windows overlap, clock 8–12. Vale names 580 and 22. Juno names 220 and 24. Devon names 160 and 18. No writ, token, or chit is instantiated. Do not split 580. Do not open `starting_sparks` 14000, 3200, or 1800 as a wallet. The three desks are speech at the anchors that already exist. They are not new rooms.

## Notice bind

`notice_two_faces` binds as text on the municipal anchor during 18–22. It has no creature id, no remembrance item, and no phase that spawns a sentinel. The battle roof is not given a placeholder transform. The Hub gate at (0, −34) and the Present at (0, −220) stay empty of this notice. Flower Law stays on the Hub disk. The 41.99 m Dawn-local radius of the Task Force capital is not that disk.

## Materials

Coat cloth uses the faction colors already on the sheets as a small field of dye, not a reskin of the city: Vale `#0a3a5a` and `#c8c8c0`, Juno `#5a3866` and `#e8c0d6`, Devon `#3a5a3a` and `#c8a050`. Marble, chrome, and dirty glass stay the architecture. Albedo has no baked lighting. Wear sits on edges. No cel outline. No cape. No Vinewood signage.
