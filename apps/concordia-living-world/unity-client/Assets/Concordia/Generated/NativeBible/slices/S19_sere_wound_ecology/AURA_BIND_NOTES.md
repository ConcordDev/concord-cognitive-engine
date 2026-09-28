# Aura bind notes — S19 Sere wound ecology

Bind this facet after the Sere block of `volume/DENSITY_TABLES.json` and after `enc_compound_mark` in `BOSSES_AND_RAIDS.json`. This slice adds caps, four derived floors, three mini-boss windows, the drop condition on the existing eye, and four quests. It does not replace weights, the furnace clock, the enforcer budget, or the token id.

Art prompts already live on `faun_smog_roach`, `faun_sodium_rat`, `faun_mark_hound`, `hyb_markharpy`, `mon_road_watcher`, `mon_boss_compound_mark`, and `npc_role_sere_enforcer`. Reuse those. The watcher sheet is one mesh, eight skins; this facet uses `sere_invoice` only. Do not commission a census disc, a Ruins import, a rifle, a full-body fire, or a ninth gate. Do not download packs. Do not wipe `Library`. Do not re-download pines.

## Spawn order

1. `gap_verge_keshar` is the open at (−31.76, 21.34), 19.67 m between Verge radius 23 at (−31.52, −12.74) and Keshar radius 25.5 at (−32.0, 55.43). Roaches use the 4 m band against Keshar's rim, cap 8, day and night. A 4 m circle at the midpoint is `enc_chest_stamp` while `furnace_belt` has no transform. If CountryCenter stops resolving those two capitals, the lip and the stamp become nothing.
2. `gap_aldermere_tally` is the open at (18.99, 5.14), 22.86 m between Aldermere radius 23 at (44.5, −17.98) and the Tally House radius 23 at (−6.52, 28.26). One `faun_mark_hound` by day. Night cap 0. `enc_one_tile` is that same hound at hours 12–14 when `day_index % 2 == 0`.
3. `gap_dovrane_keshar` is the open at (1.22, 35.74), 26.23 m between Dovrane radius 25.5 at (34.44, 16.06) and Keshar. One `mon_road_watcher` in skin `sere_invoice`, weapon `wpn_pole_sere_fork`. `enc_empty_post` is hours 5–7 when `day_index % 4 == 1`. The body count stays 1.
4. `gap_tally_hollow` is the seam at (−27.24, 13.29), 5.13 m between the Tally House and Hollowford radius 23 at (−47.97, −1.68). `faun_sodium_rat` night 6, day 2. No hall fits. Crime's street caps stay where S09 put them.
5. If `furnace_belt` has no transform, `enc_compound_mark` spawns nothing. Do not move the kiln to a capital, to the (+8, −6) district step (−23.52, −18.74), or onto the bare midpoint. The recommended seat, once a transform is authored, is the Verge-side 8 m of `gap_verge_keshar`, ending 1.84 m short of the midpoint. This note does not author the transform. When that seat exists, `hyb_markharpy` ambient and `enc_chest_stamp` both go to 0 and do not relocate.
6. Sub-4 m slivers, the 4.16 m Tally–Spire corridor, every negative overlap, wilds 90–126 m, hollow–keshar, curtain–table, `tessera_spire`, `mark_tenement`, Pinewood Crossing (62, −28), and the megaworld present (−125.27, −269.29): cap 0 for every id this slice owns.
7. `faun_smog_roach` cap 8 on the lip. The herd line 10–30 is not a spawn count. Inside the harpy circle and inside a placed hall, cap 0.
8. `faun_mark_hound` cap 1. Herd line is already 1. Shared skeleton `faun_veil_hound` does not pull Tunya's hounds or the Pinewood verge into this open.
9. `hyb_markharpy` ambient 1 outside the midpoint circle, window 2, peak 2. `mon_tunya_harpy` stays off Sere.
10. `mon_grid_drone` cap 0. S11's deck caps and `enc_disc_triangle` stay on the Grid. The WorldDef drone alias is unresolved here on purpose.
11. `mon_boss_compound_mark` ambient 0. The volume window fields 1 after the telegraph, on the placed hall only. Hours 17–20, cron `0 17 */3 * *`.
12. `npc_role_sere_enforcer` budget stays 4, CX only, Wing Chun, `wpn_throw_sere_marktile`. One stands on the lip. One stands on the Aldermere–Tally open. The other two stay on desks and the belt with no new pin. Unique NPCs in `ECOLOGY.json` are not cloned.

Missing mesh on any row: spawn nothing for that row. Do not borrow a scorpion, a glowing-eyed rat, a parrot, a pinup harpy, a Grid disc, a Ruins wraith, a wolf rename, a CX body for the kiln or the harpy or the hound or the roach or the rat, a Concordia face on the watcher, or a Quaternius body. Clips may retarget later onto a native mesh that does not yet exist. People retarget onto CX only.

## Hit resolution

Sere steel is live. People use Wing Chun. Do not apply Flower Law on these opens. Do apply it if a body is dragged inside the Hub 42 m disk and outside the Arena. Health stays the table already on the creature row: `table:faun_critter`, `table:faun_med`, `table:mon_skirmisher`, `table:mon_elite_human`, `table:boss_region`. Do not invent hit points.

`skill_presence_name_holder` is the eye phase. The monster row's `skill_presence_name_the_holder` is not a second skill. Do not retune the skill file. Do not grant the skill from this slice's quests. Volume quests already grant it where they grant it.

`faun_smog_roach`, `faun_sodium_rat`, and `hyb_markharpy` are `hostile: false`. The stamp window sets aggro on the pair. The roach and the rat never enter hit resolution as attackers. `faun_mark_hound` and `mon_road_watcher` and `mon_boss_compound_mark` are `hostile: true` in the catalogs. Instance aggro for the hound and the watcher is the window rule in `ECOLOGY.json`. Those files were not edited.

The boss rule remains the monster text plus the volume phases. Cooled eye, ledger outside, seed library unsold: `item_rem_furnace_eye`. Any other ending drops nothing. The eye in the Crucible bay fails S17. Witness heat from a Tessera-facing loot is heat, not a second item.

## Quest mouths

`q_s19_lip_not_omen` and `q_s19_heat_not_a_name` offer and turn in with the lip enforcer. `q_s19_no_second_pan` uses the enforcer on the Aldermere–Tally open. `q_s19_empty_tariff` offers on the post board and turns in by leaving. They do not spawn beasts in the overlaps, on a capital, or on Pinewood. They do not clone the unique list. The stamp quest cannot finish if the hall is placed before the window ever arms. Hidden truths stay out of board lines and gossip.
