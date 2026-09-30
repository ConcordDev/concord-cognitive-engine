# Mount honesty — Hub and Frontier (B26)

The wagon horse already exists as `faun_wagon_horse`. The open wagon already exists as `prop_wagon`. This batch adds parts and smaller travel props. It does not add a ride controller.

| Gameplay id | Mesh | Verb |
| --- | --- | --- |
| `mount_wagon_horse` | `faun_wagon_horse` + `veh_tack_draft_collar` | lead |
| `mount_wind_pronghorn` | `faun_wind_pronghorn` | follow, no bridle, no new mesh |
| `veh_salt_wagon` | `prop_wagon` + pin + trace hook | hitch and walk |
| `veh_frontier_windwagon` | `prop_wagon` + `veh_frontier_wind_sail` | drift, player on foot |
| Link halt | `veh_link_hub_barrow`, `veh_link_halt_chock`, `veh_frontier_road_chest` | park outside the plaque |

`mount_terrace_goat` is Tunya. `veh_grid_rail_dolly` and `veh_wharf_cart` are in `B26_vehicles_urban`. The Held Curse is not a mount. A griffin is not a horse.

## Cycle 2 fill

Twelve more rows in `batches/B26_vehicles_cycle2.json`. The first fourteen stay. No saddle, no bit, no stirrup, no rider bone.

| Gameplay id | Mesh | Verb |
| --- | --- | --- |
| `mount_wagon_horse` | `faun_wagon_horse` + `veh_horse_halter` + `veh_feed_bag` | lead; collar stays the first batch |
| `veh_salt_wagon` | `prop_wagon` + tongue, singletree, brake shoe, tailgate | hitch and walk; tailgate is `veh.door` |
| `veh_frontier_drag` | `veh_frontier_travois` | drag; horse walks beside; player on foot |
| `veh_pine_haul` | `veh_pinewood_log_bogie` | push; bunk empty; radius 0.26 m |
| Link halt | `veh_link_step_skid`, `veh_link_stop_bar` | park outside the wall; bar forces parked |

`veh_wagon_canvas` stays rolled. It does not luff. `veh_frontier_wind_sail` stays the sail. `veh_water_keg_cradle` has no salt crust. `mount_wind_pronghorn` still has no bridle row.

Flower Law is the Hub disk of 42 m. The wall is 56 m. The Frontier plaque is (−34, 0), inside the disk. Perimeter vehicles stop past the wall. They do not enter the plaque. The Link stays a two-minute step.

Wheel spin is `ω = v / r` from `animations/RIG_VEHICLE.md`. The spare wheel's axle hole is the pivot. `Driving_Loop` stays unbound.

## Grid and Iron Coast (B26 urban)

Ten travel props. No street traffic, no cockpit, no rider. `mon_grid_drone` and `hyb_billdrone` stay fauna. The sled's ring is empty.

| Gameplay id | Mesh | Verb |
| --- | --- | --- |
| `veh_grid_rail_dolly` | this batch | push; coil and blank slate are other meshes |
| `veh_cyber_skybridge_cart` | this batch | push on `env_cyber_skybridge_segment`; bridge not in the cart |
| `veh_cyber_drone_sled` | this batch | push; runners; no rotor |
| `veh_wharf_cart` | this batch | push; crate stays `prop_dock_crate` |
| `veh_crime_dock_loader` | this batch | push; empty hook eye |
| `veh_crime_pallet_jack` | this batch | push; the hand truck kept out of B23 |

The measured sky floor runs from (−25.77, −58.0) to (−19.37, −62.8). Named set `sky_bridge` stays unplaced. Flower Law is the Hub disk of 42 m and does not cover these worlds. The warehouse door clear stays 1.2 × 2.2 m. `Driving_Loop` stays unbound.
