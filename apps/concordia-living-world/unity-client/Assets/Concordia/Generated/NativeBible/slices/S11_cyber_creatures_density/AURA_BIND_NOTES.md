# Aura bind notes — S11 Grid density

Bind this facet after the Cyber block of `volume/DENSITY_TABLES.json` and after `enc_census` and `enc_junction_null` in `BOSSES_AND_RAIDS.json`. This slice adds caps, one derived deck, one derived gap, three new windows, and three quests. It does not replace weights, those two clocks, or any token id.

Art prompts already live on `mon_grid_drone`, `mon_grid_sentinel`, `mon_grid_construct`, `faun_grid_stray`, `faun_cable_sparrow`, `hyb_nullhound`, `npc_role_grid_labor`, and `npc_role_grid_officer`. Reuse those. Do not commission a sheet for a glitch hound, a neural parasite, a black-ice body, a void walker, a self-replicating swarm, a census-construct hybrid, or a billdrone on a Grid deck. Do not download packs. Do not wipe `Library`. Do not re-download pines.

## Spawn order

1. If named set `census_block` has no transform, `enc_census` and `mon_boss_census` spawn nothing. Do not move the hanging rings onto the mainframe district, the clinic, or the gap.
2. If no live junction box exists, `enc_junction_null` spawns nothing. Do not borrow the near snap to fake the box. `q_cyber_sparrow_nest` still owns moving a nest. A nest on a ledge is not a sentinel anchor.
3. `floor_mainframe_deck` is the placed anchor (−25.77, −58.0) plus 8 m along unit (0.8, −0.6) to (−19.37, −62.8). Sentinel, officer, laborers, and drones use that plan. If the district anchor is missing, the deck is unplaced and those spawns become nothing. Named set `sky_bridge` is optional dressing. Until it is dressed, drones hover on the plan because their gait is hover. Do not spawn a bridge mesh to justify them.
4. Sparrows spawn only when `prop_junction_box` or the kit cable tray is dressed on that district. No perch, cap 0. Do not perch them on a drone, an officer, or a sentinel.
5. `floor_clinic_hinge` is the placed anchor (−21.25, 21.28). One construct and one labor giver. The capital (−29.25, 27.28) stays empty. A hinge-room module is used only when the kit room is actually placed on the clinic point. Until then the construct stands on the point.
6. `floor_uncounted_gap` is the open segment derived in `DENSITY.json`: midpoint (−5.695, −3.475), between AI Rights radius 23 at (−39.39, −6.95) and the Cordon Guild radius 23 at (28, 0). Strays, the gap officer, and `enc_cloak_skip` use that ground. If either capital stops resolving, the gap is unplaced and those spawns become nothing. Named set `uncounted_alley` is not a second floor.
7. `npc_role_grid_labor` cap 3 on the deck and 1 at the clinic. Two budget slots stay unspawned. Sum never passes 6. During `enc_disc_triangle` the three deck laborers stay witnesses. During `enc_hinge_blank` the clinic laborer stays a witness. None of them join a creature roster.
8. `npc_role_grid_officer` cap 1 at the near snap and 1 in the gap. Sum is the whole budget of 2. They wear cloth shoulders and a bar visor down. They are not `mon_grid_sentinel`. They carry `wpn_1h_grid_pulseblade` if they carry anything. No rifle. During the triangle and the cloak they stay witnesses.
9. `mon_grid_drone` cap 2 ambient on the deck, 0 everywhere else, including Crime and Sere. During `enc_disc_triangle` ambient drops to 0 and the window fields 3. Peak is 3, not 5.
10. `mon_grid_sentinel` cap 1 at the near snap. Cap 0 while `enc_junction_null` is active. Superhero cap 0. Catalog hostile is false. This slice does not flip the ambient door into a fight.
11. `mon_grid_construct` cap 1 at the clinic. `enc_hinge_blank` uses that same instance, it does not add a second. Crucible cap 0. Catalog hostile is false. The window sets aggro for that instance without editing the monster file.
12. `faun_grid_stray` cap 2 in the gap, at the two points 4 m off the midpoint along the gap axis. Deck and clinic 0. Hostile stays false. During the cloak window they stay and they are not adds.
13. `faun_cable_sparrow` cap 4 day and 2 night on a dressed perch at the district. They are not triangle vertices.
14. `enc_cloak_skip` fields 1 `hyb_nullhound` at the gap midpoint. Ambient cap of that hybrid is 0. Catalog hostile is false. The window sets aggro. Cyber is its only world in this facet.
15. `hyb_censusconstruct` cap 0. `hyb_billdrone` cap 0. Do not satisfy a missing nullhound with the billdrone, and do not satisfy a missing construct with the hybrid.
16. `enc_disc_triangle`: hours 21–23 when `day_index % 2 == 0`, using the volume day counter. Suppress if `enc_census` or `enc_junction_null` is active.
17. `enc_hinge_blank`: hours 9–11 when `day_index % 3 == 1`. Same suppression.
18. `enc_cloak_skip`: hours 5–7 when `day_index % 3 == 2`. Same suppression.
19. Pinewood Crossing (62, −28), every capital, `under_district`, `nevex_tower_central`, the Polysteel tower top, the AI storefront, the fixer meeting house, and any floor not named above: cap 0 for every id this slice owns.

Missing mesh on any row: spawn nothing for that row. Do not borrow a fox, a wolf, a bird for a disc, a disc for a dog, a CX body for a drone or a sentinel or a construct or a hound, a Quaternius body, or a Kenney body. Clips may retarget later onto a native mesh that does not yet exist. People retarget onto CX only. `canon_kind_alias` drone on Cyber resolves to `mon_grid_drone` at the cap above. It does not resolve to `hyb_billdrone` or to `rogue_drone_swarm`. Sentinel resolves to `mon_grid_sentinel`. Construct resolves to `mon_grid_construct`.

If Nyx, Kira, Silver, or Lavren is required as a transform, that requirement belongs to the volume quests already aimed at them. These three quests start from the role bodies on the floors above. Do not clone the named list in `DENSITY.json`.

## Hit resolution

Grid steel is live. Pulse and the drone's ram. Do not apply Flower Law to a hit on the deck. Do apply it if a body is dragged inside the Hub 42 m disk and outside the Arena: the blade is a flower. Health stays the table already on the row: `table:mon_swarm`, `table:mon_tank`, `table:mon_skirmisher`, `table:faun_small`, `table:faun_critter`. The nullhound uses `table:mon_skirmisher`. The boss, if it ever binds, stays `table:boss_region`. The two roles have no creature table. This slice adds no hit points for them.

`skill_steel_pulse` is the cut. The skill file already exists. Use it on a lens or a tool arm. Do not retune the skill file. Volume quest `q_cyber_practice_rail` already grants it. These quests do not grant it again.

`skill_presence_refuse_count` clears a count-lock during a name-ask. Volume quests already grant it. These quests do not grant it again. Using it on the hinge, if the player has it, keeps the serial ground off. Not having it does not block the quest. Refusing to stamp the blank is enough.

`mon_grid_drone` is `hostile: true`. `mon_grid_sentinel`, `mon_grid_construct`, `faun_grid_stray`, `faun_cable_sparrow`, and `hyb_nullhound` are `hostile: false`. The hinge window and the cloak window are the fights for those two. The sentinel door is not a fight in this facet.

Faction deltas of +1 toward `blackout_resistance` and +1 toward `cyber_street_docs` apply to the standing books that already track those factions. The volume string `uncounted` and the role string `census_authority` are not country ids. Do not open books under those names. The role string `zero_collective` on the laborer is a real faction, and these quests do not also write that book. One delta per quest, on the book named in `DENSITY.json`.

## Palette and light

Carbon, scratched glass, gunmetal, acrylic. Ground `#1a1228`, lens and law-green `#3dffa0`, banner magenta `#c45aa8`, harsh white on a chipped coil or a coat edge. Night on the deck is high-contrast practicals: one cyan lens, cloth banners, no full-body glow. Albedo carries no baked lighting. Silhouettes must read in pure black at 100 m: thick disc, door shoulders with a bar and no cloth, asymmetric hood with a tool arm, one-eared dog, round sparrow, dog chevron with two rectangles, officer with cloth shoulders and the bar down, tech with the visor up and a coil.
