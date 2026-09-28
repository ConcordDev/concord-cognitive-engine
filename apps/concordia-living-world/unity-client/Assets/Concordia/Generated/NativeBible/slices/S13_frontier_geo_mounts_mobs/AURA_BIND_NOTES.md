# Aura bind notes — S13 Frontier salt, drift, mounts

Bind this facet after the Frontier block of `volume/DENSITY_TABLES.json`, after `enc_last_dome` and `enc_road_followed` in `BOSSES_AND_RAIDS.json`, and after S01's horse cap at Pinewood Crossing. This slice adds country floors, lead and follow rules, caps, two new windows, and three quests. It does not replace density weights, those two clocks, S01's hitch count, or the token ids.

Art prompts already live on `faun_dust_wolf`, `faun_wagon_horse`, `faun_wind_pronghorn`, `mon_frontier_domebreaker`, `mon_road_watcher`, `hyb_dustgriffin`, `npc_role_frontier_guard`, `npc_role_frontier_bandit`, and `npc_role_road_bandit`. Reuse those. Do not commission a sheet for a dust courser, a rail vulture, a thunder yak, a ridden griffin, a seated driver, or a rifle crew. Do not download packs. Do not wipe `Library`. Do not re-download pines.

## Spawn order

1. Pinewood Crossing (62, −28) carries a 12 m exclusion. Inside it, every id this slice owns has cap 0. That includes Link Post Alpha at (56.86, −23.79). S01's two horses, the stag, the hare, and the salt wyrm stay on S01's rules.
2. `floor_council_hitch` is the placed anchor `alliance_council_township` (54.82, −48.16). Two `faun_wagon_horse`, led, and one guard. The salt wagon hitches here. Named set `wagon_yard` adds no second hitch until it has a transform.
3. `floor_drift_gap` is (42.99, 14.03), the rim-gap center between Freenodes and Couriers. Three dust wolves. During `enc_canvas_dive` the wolf cap is 0 and one dustgriffin uses the center. Guard shoulders sit off the center and are not wolf tiles.
4. `floor_pale_flat` is (17.07, −50.92), the rim-gap center between Mesh Cult and Pioneer. Six pronghorn by day, zero at night, no pen, no tack.
5. `floor_cut` is (19.55, 5.29), the rim-gap center between Signal Pirates and Couriers. Two dome bandits and one road bandit. Two more guards stand on the Couriers rim of that gap, outside the disc.
6. `enclave_north_ridge`, both pirate and Freenode capitals, the mesh temple, brokers' camp, and the couriers' capital interior: cap 0 for bandits, wolves, horses, pronghorn, and the griffin.
7. `enc_chevron_morning`: hours 5–7 when `day_index % 2 == 0`, using the volume day counter. The three gap wolves. No added body. No drop.
8. `enc_canvas_dive`: hours 16–19 when `day_index % 5 == 4`. One dustgriffin. Wolves suppressed for those hours only. Catalog `hostile: false` stays in the file. The window's aggro is the dive against a staked sail, and a single pass against an open sail.
9. `enc_last_dome`: volume hours 12–15, every third day, one domebreaker. If the mile sentence has no transform, spawn nothing. Do not move the brute onto the drift gap, the cut, or the council hitch. Rivet drops only from this window, only after the sky is open and no replacement roof is built.
10. `enc_road_followed`: volume hours 8–11, every fourth day, one watcher, skin `frontier_iron`. If the wagon-mile sentence has no transform, spawn nothing. Do not split the anchor across the council hitch and the salt rim. Nail drops only from this window, only after the false stake is read and the offered dome is refused. The horse in phase two is led.
11. Guards sum to 5. One is the salt-chord giver and stays on the council. One is the sail giver and stays on the north drift shoulder. The road bandit is the argument giver and stays on the cut. Givers do not join a window as extra bodies.
12. Hub-ring gate at (−34, 0) and Frontier Present at (−220, 0) are the spoke. Country caps do not spawn on that line. `RoadWorld` salts already there are left as they are.

Missing mesh on any row: spawn nothing for that row. Do not borrow a fox, a Sundering wolf mesh to satisfy the dust wolf, a horse to satisfy the pronghorn or the griffin, a CX body for a wolf or a brute, a Quaternius body, or a Kenney body. Clips may retarget later onto a native mesh that does not yet exist. People retarget onto CX only. Canon fauna alias `wolf` resolves to `faun_dust_wolf` at the cap above. Alias `hound` has no Frontier animal row and resolves to nothing. `horse` on this facet resolves to the two council horses and does not consume S01's pair.

`postmaster_ria`, `captain_zara_morn`, `rider_silas_quinn`, `councillor_mara_pin`, and the rest of the unique list in `GEO.json` are not crowds. If a unique has no transform, no quest in this slice moves onto their id.

## Mounts

`mount_wagon_horse` verb is lead. Idle harness and lead-walk. Camera stays on foot beside the horse. `item_horse_tack` does not enable a ride controller. `veh_salt_wagon` hitches that mount and stops at the Pinewood exclusion.

`mount_wind_pronghorn` verb is call and follow. `tack_item_id` is null. A lead rope from the wright's stock does not become a bridle for this herd.

`veh_frontier_windwagon` has `hitch_mount_id` null. Sail is cloth. Stand pose in the bed is the honest occupancy. A sit clip is absent, so a sit is not played.

## Hit resolution

Frontier steel is live on the country floors. Muay Thai for wardens and dome bandits. Wagon iron for wardens uses `wpn_2h_frontier_wagoniron`. Skinner for both bandit roles uses `wpn_1h_frontier_skinner`. The road-bandit catalog fight style remains Sword in `ROLES.json`. Do not apply Flower Law on these floors. Do apply it on the Hub-ring gate stone, which lies inside 42 m: the bar is a flower there.

Health for creatures stays the table already on the row: `table:faun_med_predator`, `table:faun_mount`, `table:faun_med_prey`, `table:mon_brute`, `table:mon_elite_human`, `table:mon_elite`. The three roles have no creature table. This slice adds no hit points for them.

`skill_steel_dust_kick` is the heavy kick that raises dust and builds no shield. The skill file already owns its timings and its cue. Use that. On the chevron it meets the lead wolf. On the Last Dome, once that window can spawn, it meets the pin. It is not a dome.

`skill_presence_witness` stays the assist Kel already carries. `q_s13_two_cuts` calls for witness and does not grant the skill again.

`skill_craft_tack` and `skill_craft_wagon` stay on `q_frontier_hitch_not_ride`. The sail quest does not grant them.

## Drops

`item_rem_dome_rivet` and `item_rem_watcher_nail` stay single-stack remembrance. Side quests grant no items. Catalog loot names `hide_dust`, `hide_pale`, `horn_chip`, `hide_thick`, `canvas`, `pinion`, and `watcher_token` are not turned into quest rewards here.
