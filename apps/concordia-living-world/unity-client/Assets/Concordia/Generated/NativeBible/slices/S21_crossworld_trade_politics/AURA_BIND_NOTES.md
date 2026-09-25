# Aura bind notes — S21 Cross

Bind this facet after the Hub plaques exist and after S01–S20. It adds four boards and four quests. It does not replace gate geometry, `GatePost` rates, `BorderDef` rows, blend kits, density weights, or any prior quest id.

Do not commission a creature, a guard, a clerk, a caravan mesh, a ninth gate, a blend graybox, or a rifle. Do not download packs. Do not wipe `Library`. Do not re-download pines. A board is text on a gate that `HubPlaza.PlaceGate` already places, or a reading of a `BorderDef` that `WorldGeography` already builds. Missing mesh is not a hole these pins have, because they spawn nothing.

## Spawn order

1. `notice_one_rate` at the Cyber gate center (34.00, 0.00). Spawn count 0. All hours. The plaque already carries tariff 0.05, inspection 1, owner `Concordant Watch` while the clock is Hub.
2. The Frontier plaque (−34.00, 0.00) and the Crucible plaque (24.04, −24.04) are objectives of that errand. They do not get a second prop. The two `a guard` bodies already spawned by `GatePost` stay the host's bodies. Do not add a third. Do not rename them into authored guests.
3. `notice_steel_before_spoke` at the Frontier plaque (−34.00, 0.00). Spawn count 0. The step (−43.50, 0.00) is walked and left empty. Do not build a milestone there. Do not move Pinewood Crossing off (62, −28).
4. `notice_open_border` at the Crime plaque (−24.04, −24.04). Spawn count 0. The reading at `border/concord-link-frontier/crime` (−187.78, −77.78) spawns no guard, no inspector, no road watch, and no `arch_ix_crucible_foundry` module.
5. `notice_no_ninth_plaque` at the Crucible plaque (24.04, −24.04). Spawn count 0. The Sere lip (−17.71, −38.08) receives no arch, no tariff chalk, and no `WorldGate`. The false center (−14.34, −30.83) is not built.
6. The other five Hub plaques keep the same post lines and receive no board from this facet.
7. The eight other border midpoints, and `border/crime/sere` at (−140.41, −212.43), receive no pin. CountryAt's claim of Crime at that last point stays the resolver's claim.
8. `arch_ix_grid_coast`, `arch_ix_sunder_dawn`, and `arch_ix_crucible_foundry` stay without transforms. `hyb_billdrone` stays on S09's window. Do not stand it on the wharf to satisfy the kit sentence.

`ConcordiaHost.GateGuards` stays 2. Spoke-clock gates that spawn 1 when Lean Play is off stay at 1. This facet does not edit the host.

## Hit resolution

Boards do not enter hit resolution. Gate guards keep whatever combat the existing `NpcLife` watch job already has. Striking one is not an objective and not a turn-in.

Inside 42 m, outside the Arena disk of radius 8 m at (0, 0, 18), Flower Law still flowers steel. At (−43.50, 0.00), with both the actor world and the clock still Hub, steel is live. Do not flower that step to make the errand feel like the Court. Do not treat the Frontier present as reached.

No skill is granted. `skill_presence_witness`, `skill_presence_etiquette`, `skill_steel_mercy`, `skill_steel_curse_fold`, `skill_craft_forge`, and `skill_craft_unend` stay the grants and the legal notes they already are. Faction deltas stay empty. Do not write a delta to `concordant_watch`, `frontier_couriers_guild`, `ghost_network`, `the_tessera`, or any far-face id. Coin on these four quests is 0. A caravan row is not appended to `tariffsCsv` by completing an errand.

## Quest mouths

`q_s21_one_rate` offers and turns in on `notice_one_rate`. Frontier and Crucible plaques are objectives.

`q_s21_steel_before_the_spoke` offers and turns in on `notice_steel_before_spoke`. The lip step is an objective. Reaching radius 152 along the Frontier bearing is not required and does not complete the errand early.

`q_s21_open_border` offers and turns in on `notice_open_border`. The midpoint is an objective. Placing the foundry fails it.

`q_s21_no_ninth_plaque` offers and turns in on `notice_no_ninth_plaque`. The empty lip is an objective. Entering Sere, or standing on `border/crime/sere`, is not a substitute.

Hidden truths stay off the boards. The sealed Voss genealogy, the drone corridor's toll story, and the Sere holder accounts stay the slices that already hold them. Gossip on complete is the public sentence only.

## SoftEnter bind

If a binder can read `ContinentStream.LastTravelKind` and `WorldClock.LastEvent`, use them for `q_s21_steel_before_the_spoke`. Success at the lip is: kind has not become `link_gate` on this errand, the last event is still whatever it was when the board was read, and the clock is Hub. A kill line that was already present still counts as success. A new journey line means the player passed the arrive disk or took a link, and the lip objective fails until they take the errand again from the plaque.

Do not call `SoftEnter(Sere)` to finish `q_s21_no_ninth_plaque`.
