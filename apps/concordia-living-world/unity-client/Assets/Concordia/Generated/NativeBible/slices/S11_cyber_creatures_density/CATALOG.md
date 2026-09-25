# Catalog — S11 Grid creatures and sky-bridge density

WorldId Cyber. Display The Grid. Caps are instance budgets for this facet. Volume weights are cited and not edited.

## Floors

| Floor | Point | What stands there |
| --- | --- | --- |
| Sky deck, near snap | mainframe_district (−25.77, −58.0) | 1 sentinel, 1 officer, sparrow perch if a junction box is dressed |
| Sky deck, 8 × 4 m plan | near snap to far snap (−19.37, −62.8), mid (−22.57, −60.4) | drones, 3 laborers inside the budget |
| Hinge | street_doc_clinic_north (−21.25, 21.28) | 1 construct, 1 labor giver |
| Uncounted gap | (−5.695, −3.475), 21.75 m of open ground | 2 strays, 1 officer giver, the nullhound window |
| Census clock | volume anchor only | `mon_boss_census` when `census_block` is placed |
| Junction Null | volume anchor only | sentinel lead and construct hinge when a live junction box exists |

## Caps

| Id | Ambient | Window | Elsewhere |
| --- | --- | --- | --- |
| `mon_grid_drone` | 2 on the deck plan | 3 during `enc_disc_triangle`, ambient drops to 0 | Crime 0, Sere 0, every other Cyber floor 0 |
| `mon_grid_sentinel` | 1 at the near snap | 0 while `enc_junction_null` is active | Superhero 0 |
| `mon_grid_construct` | 1 at the clinic | that same 1 during `enc_hinge_blank` | Crucible 0 |
| `faun_grid_stray` | 2 in the gap, 4 m off the midpoint along the gap | stay, not on the cloak roster | deck 0, clinic 0 |
| `faun_cable_sparrow` | 4 by day, 2 at night, only if a junction box or cable tray is dressed on the district | stay, never a triangle vertex | no perch, cap 0 |
| `hyb_nullhound` | 0 | 1 during `enc_cloak_skip` | — |
| `hyb_censusconstruct` | 0 | — | Crucible 0 |
| `hyb_billdrone` | 0 | — | S09 owns the coast window |
| `mon_boss_census` | 0 | 1 on the volume clock if the block is placed | not on the deck |
| `npc_role_grid_labor` | 3 on the deck, 1 at the clinic | witnesses only | sum 4, budget 6, 2 unspent |
| `npc_role_grid_officer` | 1 at the near snap, 1 in the gap | witnesses only | sum 2, budget 2 |

## Mini-bosses

| Id | Body | When | Floor |
| --- | --- | --- | --- |
| `enc_disc_triangle` | `mon_grid_drone` × 3 | 21–23, `day_index % 2 == 0` | sky deck |
| `enc_hinge_blank` | `mon_grid_construct` × 1 | 9–11, `day_index % 3 == 1` | clinic |
| `enc_cloak_skip` | `hyb_nullhound` × 1 | 5–7, `day_index % 3 == 2` | gap |

`enc_census` (2–4, every third day) and `enc_junction_null` (13–15, every second day) stay on their volume clocks. Hours above do not overlap those clocks. If either volume event is still flagged active, the three new windows wait.

## Side quests

| Id | Giver | Floor |
| --- | --- | --- |
| `q_grid_sum_stays_dark` | one deck laborer, hail | sky deck |
| `q_grid_serial_stays_ground` | the clinic laborer | hinge |
| `q_grid_tick_skips` | the gap officer | uncounted gap |

No skill grant. No new item. `skill_steel_pulse` and `skill_presence_refuse_count` stay where the volume quests already grant them.

## Unspawned

`glitch_hound`, `neural_parasite`, `black_ice_construct`, `void_walker`, `rogue_drone_swarm` have Canon sentences and no bible ids. `hyb_censusconstruct` has a mesh row and stays at cap 0 so the sentinel's bar and the construct's hood do not merge. `hyb_billdrone` stays at cap 0 on Cyber. Capitals, overlap rims, Pinewood Crossing, and the three unplaced named sets do not receive these caps.
