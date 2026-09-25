# Aura bind notes — S09 Iron Coast mobs

Bind this facet after the Crime block of `volume/DENSITY_TABLES.json` and after `enc_outstanding` in `BOSSES_AND_RAIDS.json`. This slice adds caps, one derived alley, three new windows, drop conditions on the invoice stamp, one small raid, and three quests. It does not replace weights, that clock, or the token id.

Art prompts already live on `faun_dock_hound`, `faun_sodium_rat`, `faun_rain_gull`, `mon_coast_billhound`, `hyb_billdrone`, `npc_role_coast_labor`, and `npc_role_coast_bandit`. Reuse those. Do not commission a sheet for a hellfire hound, a scrap golem, a chrome enforcer, a rage junkie, a sewer crawler, or a rifle crew. Do not download packs. Do not wipe `Library`. Do not re-download pines.

## Spawn order

1. If named set `wharf` has no transform, `enc_outstanding` and `faun_rain_gull` spawn nothing. Do not move the bill hound onto `floor_dockside_warehouses`, a capital, or the unclaimed street.
2. `floor_dockside_warehouses` is the placed anchor (10.72, 32.9). Labor, ambient hounds, `enc_hook_shift`, and `raid_unpaid_shift` use it. The armored-warehouse kit is optional dressing on that point, not a second floor.
3. `floor_unclaimed_street` is the gap derived in `MOBS.json`: midpoint (8.09, −2.55), between Ghost radius 23 at (2.72, 38.9) and North Market radius 23 at (13.45, −43.99). The Ghost-rim end of that line is still inside Iron Rose for 0.81 m. Do not walk the hood, the rats, or the rotor onto that bite. Bandits, rats, `enc_stair_switch`, and `enc_rotor_saddle` use the midpoint, which sits 17.42 m outside Rose. If CountryCenter stops resolving those capitals, the gap is unplaced and those spawns become nothing.
4. If named set `tenement` has no transform, the stair phase of `enc_stair_switch` stays on the ground and the rotor stays on the ground. Do not float a disc or invent a fire escape.
5. `npc_role_coast_labor` cap 3 on the warehouse. Plus 2 on a placed wharf. One budget slot stays unspawned. Sum never passes 6. The hook window replaces one of the three and does not add a fourth.
6. `npc_role_coast_bandit` cap 3 in total on the gap: one hail giver, one ambient, and either one lieutenant or two raid adds. Ambient drops to 0 while the stair window or the raid is up. The giver never joins the raid. Morgue, North Market block, capitals, Hexshore, federal floor, precinct: 0.
7. `faun_dock_hound` cap 3 on the warehouse, spaced, herd of one. Cap 0 during `raid_unpaid_shift`, which fields its own two. Plus 1 on a placed wharf, still not inside `enc_outstanding`.
8. `faun_sodium_rat` cap 6 at night and 2 by day on the gap. Sere cap added here is 0. Hostile stays false.
9. `faun_rain_gull` cap 8 day and 2 night on a placed wharf. They scream once as a far scout during the raid and never join the roster. `q_crime_gull_drop` is unchanged.
10. `enc_outstanding`: volume hours 18–21, every second day, one bill hound, no adds. Stamp, coin tooth, and ledger plate follow the conditions in `MOBS.json`.
11. `enc_stair_switch`: hours 10–13 when `day_index % 2 == 1`, using the volume day counter. One bandit.
12. `enc_hook_shift`: hours 14–17 when `day_index % 3 == 0`. One laborer. The other warehouse laborers stay on hail.
13. `enc_rotor_saddle`: hours 5–7 when `day_index % 3 == 1`. One billdrone. Catalog hostile flag is false. The window sets aggro without editing the file. Cyber cap 0. Coin tooth suppressed.
14. `raid_unpaid_shift`: hours 22–24 when `day_index % 4 == 3`. Skip the night if `enc_outstanding` is active. Suppress the three new windows instead of stacking them. Roster is one laborer, two bandits, two hounds. Slip grants once if it is still on the wood. The remembrance stamp does not drop.
15. Pinewood Crossing (62, −28), both syndicate capitals, uptown, the 14th, Halloran, Hexshore, the federal floor, the North Market block, the morgue, and the foundry set: cap 0 for every id this slice owns.

Missing mesh on any row: spawn nothing for that row. Do not borrow a fox, a wolf, a Grid drone disc, a bedsheet, a CX body for a hound, a Quaternius body, or a Kenney body. Clips may retarget later onto a native mesh that does not yet exist. People retarget onto CX only. `canon_kind_alias` hound on Crime resolves to `faun_dock_hound` at the cap above. The drone alias resolves to `hyb_billdrone` inside the rotor window only.

`barkeep_old_lou` is a giver, not a crowd. If he has no transform, `q_crime_collar_stays` does not start. Do not clone Lou, Jax, Mama, Bell, Dahlia, Maddox, or the other named ids listed in `MOBS.json`.

## Hit resolution

Coast steel is live. Close knives and the dock hook. Do not apply Flower Law to a thrust on the warehouse anchor. Do apply it if a body is dragged inside the Hub 42 m disk and outside the Arena: the blade is a flower. Health for creatures stays the table already on the row: `table:faun_med`, `table:faun_critter`, `table:faun_small`, `table:mon_brute`. The two roles have no creature table. This slice adds no hit points for them.

`skill_steel_invoice` is the short thrust from the hip. The skill file already points at an impact prefab and a `cue_invoice` stub. Use that. Do not retune the skill file. On the raid it is aimed at the slip.

`skill_presence_witness` keeps a paper on the wood and keeps the rotor's missing mark missing. Volume quests already grant it where they grant it. These three quests do not grant it again.

`skill_presence_bargain` stays on `q_crime_bell_tip`. This facet does not move Bell's corner.

`faun_dock_hound` and `mon_coast_billhound` are `hostile: true` in the catalogs. `faun_sodium_rat`, `faun_rain_gull`, and `hyb_billdrone` are `hostile: false`. The rotor window is the one place the hybrid becomes a fight. Labor stays on hail except the single hook lead and the single raid foreman, who are the same archetype and never both alive.

Faction deltas of +1 toward `iron_rose_syndicate` and `ghost_network` apply to the standing books that already track those houses. The role string `delgado_syndicate` and the volume string `ghost_contracts` are the older names of those same books. Write the delta once. Do not open a third book.

## Palette and light

Stained brick, rust corrugate, wet asphalt, sodium yellow as the practical. One emissive accent is the lamp, or the rotor's hub when that window is up, not a full-body glow. Rain is the weather. Albedo carries no baked lighting. Silhouettes must read in pure black at 100 m: cap and hook, hood and single plate, low-tailed hound, too-wide bill hound, hound with one spinal disc, gull line, rat as floor movement.
