# RIG_VEHICLE

Vehicles in this pass are carts, wagons, dollies, and hand carts. No steering-wheel hero, no cockpit, no mounted gun, no rifle rack. A mount is a creature (`RIG_CREATURE.md`), not this rig.

`Driving_Loop` (UAL1) is a seated human clip. Use it only if a later world has a real seat and a CX driver. Do not play it on a horse and do not park a driver inside the Hub Flower Law disk as set dressing.

## Graph

No Animator required for the first bind. A small driver reads rigidbody or spline speed `v` (m/s).

| state | motion | formula / note |
| --- | --- | --- |
| veh.parked | wheels still, hitch slack | v = 0, bob 0 |
| veh.roll | wheels spin, bed steady | ω = v / r per wheel, r from mesh radius |
| veh.brake | spin eases, bed pitches forward a few degrees | damp ω over ~0.4 s |
| veh.bump | one vertical bob | y = a·sin(phase), a ≤ 0.04 m on cobble, less on road |
| veh.hitch_idle | shafts or lead ring settle | local sway, no animal clip inside the prop |
| veh.sail_luff | cloth sail or awning on a wind-wagon | shader or the B21 awning card; Frontier only when that prop exists |
| veh.door | gate or tailgate | 0–90°, `use.push` on the human if someone moves it |
| veh.occupant | none by default | no invisible driver |

Wheel meshes need a pivot at the axle, not a baked spin in the albedo. B26 supplies `veh_spare_iron_wheel` (radius about 0.42 m, axle hole is the pivot). Hand-cart radii live on `veh_hub_handcart` (0.28 m), `veh_frontier_handcart` (0.34 m), and `veh_link_hub_barrow` (0.22 m). Cycle 2 adds `veh_pinewood_log_bogie` at 0.26 m. The travois, the water cradle, and the Link step skid are runners, so ω stays unused. Urban radii: `veh_grid_rail_dolly` and `veh_cyber_rail_shoe` 0.18 m, `veh_cyber_skybridge_cart` 0.22 m, `veh_wharf_cart` 0.32 m, `veh_crime_dock_loader` 0.16 m, `veh_crime_pallet_jack` 0.05 m. `veh_cyber_drone_sled` and `veh_ix_wharf_skid` are runners, so ω is unused. `ω = v / r` uses the wheeled radius. Do not bake a spin into the albedo.

## Hub and spokes

- Hub wagon stays `prop_wagon`. Market hand cart is `veh_hub_handcart`: `veh.parked` and `veh.roll` only. Outside the 42 m disk when the load is steel. An empty bed may sit in the market.
- Frontier wind-wagon keeps `prop_wagon` as the bed. `veh_frontier_wind_sail` is the cloth. Play `veh.sail_luff` on that sail only. Do not stake the sail into a roof. Still no rifle.
- Draft collar, hitch rope, lead rope, pin, and trace hook are parts. They use `veh.hitch_idle`. No animal clip inside the part. No rider bone.
- Link halt barrow and wheel chock park outside the 56 m wall. They do not roll onto the Frontier plaque at (−34, 0).
- Crime wharf cart and Cyber dolly use the radii above and their own materials. Do not retint a Hub wagon and call it a new vehicle. `veh_cyber_skybridge_cart` pushes on the existing sky-bridge module. The module is not inside the cart mesh. `veh_cyber_drone_sled` has an empty ring and no rotor. `mon_grid_drone` and `hyb_billdrone` stay on the creature graph. `veh_crime_dock_loader` and `veh_crime_pallet_jack` stay off the 1.2 × 2.2 m warehouse door clear. No cockpit. No traffic sim. `Driving_Loop` stays unbound.
- Boats, if a later slice adds one: `veh.bump` on water, oar as a human `use.interact` loop, not a new controller.

## Honest gaps

Coverage lists vehicle verbs mostly missing. Shipping `ω = v / r` plus bob is the procedural path. Do not drop in a Mixamo car clip or a Quaternius vehicle mesh as Concordia canon.

## Deep pass (A19, `B21_anim_deep`)

Controller name is `VehicleRoll`. It has no Animator. Inputs are planar speed `v` (m/s), `brake`, a bump pulse, door 0–1, and sail 0–1. The pusher is a CX body on `Walk_Loop` beside the prop. The driver reads that speed. It does not add a seat, a cockpit, or a traffic sim.

| class | ids | motion |
| --- | --- | --- |
| wheel | `prop_wagon`, spare iron wheel, both hand carts, Link barrow, wharf cart, sky-bridge cart, dock loader, rail dolly, rail shoe, pallet jack | `ω = v / r` on the axle pivot. Both wheels share the signed rate. Radii stay the table above. Rail wheels do not steer; the rail turns. Pallet prongs stay level. |
| runner | drone sled, wharf skid, salt keg skid | translation and `veh.bump` only. `ω` stays unused. The sled ring does not spin. |
| hitch | draft collar, hitch rope, lead rope, wagon pin, trace hook | `veh.hitch_idle`, sway about 2°. No animal clip inside the part. |
| sail | `veh_frontier_wind_sail` | `veh.sail_luff`, amplitude ≤ 8°, Frontier cloth only. The Hub awning card stays on the market bay. |
| carry | walker pack frame | parented to the human. `Walk_Loop` on the body. The frame stays `veh.parked`. |
| lock | Link halt chock, wharf chock | forces `veh.parked` on the parent. A requested `v` does not spin the blocked axle. |
| still | blank slate, Frontier road chest | `veh.parked`. No axle. |

Brake pitches the bed about 3° and damps `ω` over 0.4 s. Bump height is ≤ 0.04 m on cobble, 0.02 m on road, 0.015 m on the sky floor. Tailgate and gate use `veh.door` from 0° to 90° while the human plays `use.interact`. `Driving_Loop` stays unbound. Placement already keeps a steel load outside the Hub 42 m disk; this driver does not add a second zone check. No rifle rack. No mounted gun.

## Atlas mobility (cycle 2)

W05 sea edges do not add a hull, an oar, or a wheel. `sea_crime_superhero` stays a minute count. The Frontier sail does not become an Exodus ship. `tunya_nil` forces `v = 0` on every wheeled id. Glacier, salt track, Masond foot crossing, and the drift bridge site do not spin an axle. A cart already placed on a Crown Road may `veh.roll` at the body's walk speed. No new wagon. No cockpit. `Driving_Loop` stays unbound.

## Cycle 2 parts (A08)

The first fourteen Hub and Frontier rows stay. These twelve do not add a seat.

| class | ids | motion |
| --- | --- | --- |
| hitch | halter, feed bag, wagon tongue, singletree | `veh.hitch_idle`. No animal clip inside the part. No bit. |
| brake | `veh_wagon_brake_shoe` | parent `prop_wagon` plays `veh.brake`. The shoe itself stays parked. |
| door | `veh_wagon_tailgate` | `veh.door` from 0° to 90° while the human plays `use.interact`. |
| still | `veh_wagon_canvas` | `veh.parked`. Rolled. Does not use `veh.sail_luff`. |
| runner | water keg cradle, Frontier travois, Link step skid | translation and `veh.bump` only. |
| wheel | `veh_pinewood_log_bogie` | `ω = v / r`, r = 0.26 m. Bunk stays empty. |
| lock | `veh_link_stop_bar` | forces `veh.parked` at the Link halt. Not a weapon. |

The horse stays led on `quad.walk`. The travois drags beside that walk. `Driving_Loop` stays unbound.
