# Aura bind notes — S12 Grid politics

Bind this facet after S11 and after the Cyber block of `volume/DENSITY_TABLES.json`. Leave weights, creature caps, `enc_census`, `enc_junction_null`, `enc_disc_triangle`, `enc_hinge_blank`, and `enc_cloak_skip` on their clocks. Leave Canon lore, factions, countries, and npc sheets unread by any writer. Download no packs. Wipe no `Library`. Re-download no pines.

Art direction is the Cyber row: carbon, scratched glass, gunmetal, acrylic, cable tray. Palette `#1a1228` `#3dffa0` `#c45aa8` `#d8d4dc`. Stylized realism PBR. One emissive per figure: a cyan pip, a magenta circuit on a chest plate, a dull acrylic clasp, a rolled sleeve with no glow. Foundation is `arch_kit_cyber_grid`. A faction cloth color may sit on an upper storey and must leave the stack silhouette. 100 m read is a tower hash, a clinic hash, a meeting-house door, a deck that already has a sentinel. Humanoids on the pair list are CX with the Concordia face. Plates and cloth use `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. Fight style Capoeira stays on people, empty-handed here. Quaternius is not a body. A firearm is not a mesh. A drone is not a person.

## Spawn pairs

A schedule room spawns a unique only when this list pairs it to an anchor. Any other room spawns nothing. Bind the window in this table once. A second row that names the same person spawns no clone. Missing CX mesh: that person is absent. No laborer and no officer speaks their lines. Labor budget 6 and officer budget 2 stay spent by S11. These uniques do not spend them.

| Unique | Window | Sheet room | Anchor |
| --- | --- | --- | --- |
| `street_doc_marit` | Clock 8–13 | `street_doc_clinic_north` | Hash (−32.88, 20.15). The placed hinge (−21.25, 21.28) is 11.68 m away and stays S11's. |
| `polysteel_president_vexis` | Clock 7–11 | `polysteel_tower_top` | Hash (16.09, −52.20). The placed anchor (16.13, −57.36) is 5.16 m away and empty. |
| `nevex_vp_kael_renn` | Clock 7–12 | `nevex_tower_central_executive_floor` | Hash of `nevex_tower_central` (−50.05, −40.63). The executive floor has no separate hash. The placed anchor (−45.43, −39.38) is 4.79 m away and empty. |
| `fixer_guildmaster_ren_cordon` | Clock 8–12 | `fixer_guild_meeting_house` | Hash (34.47, −4.70). The placed anchor (36.0, −6.0) is 2.01 m away and empty. |

Outside those windows the unique is absent even if the anchor is loaded. Kael Nakamura, both Iris sheets, Nyx Torres, Old Dom, Oren Lim, Silver, Kira, Lavren, Holt, and the generated `doctor_ren_chase` are not in the pair list. They spawn nothing in this facet.

Hash pins come from `DeterministicOffset("settlement/cyber/{faction_id}:{district}", 8+2i)`. Leave the (+8, −6) trade-zone anchors where the country file and S11 put them. Leave the deck on (−25.77, −58.0) through (−19.37, −62.8). Leave the gap on (−5.695, −3.475).

## Encounters

`enc_s12_clinic_hash` is Marit alone, 8–13. No health table. The hinge construct stays on the placed clinic through `enc_hinge_blank` (9–11, `day_index % 3 == 1`). Marit does not path.

`enc_s12_two_stacks` is Vexis through 11 and Renn through 12, 67.14 m apart. No health table. No path between towers. Vexis inside the Blackout circle does not spawn Nyx. Renn inside the Zero circle does not spawn Nakamura.

`enc_s12_cordon_morning` is Ren alone, 8–12. No health table. Safe house seven at 16.93 m stays empty.

`enc_s12_empty_name` is four empty places all day: legal clinic, storefront hash, under hash, Zero capital. No projection is authored for the advocate. Spawning a CX there would choose an origin.

Killing Marit, Vexis, Renn, or Ren fails the quest open on that pin. No pin, slate, or chrome token drops.

## Quests

Register the seven objects in `POLITICS.json` beside the volume Cyber list and beside S11's three. Leave the canon chains, the eight `q_cyber_*` volume rows, and `q_grid_sum_stays_dark`, `q_grid_serial_stays_ground`, `q_grid_tick_skips` on their givers.

Turn-in matches the JSON. Board lines fire after turn-in. No quest grants a skill, a coin amount, an item, a faction delta, a memory shard, or a DTU.

`q_s12_stacks_and_under` walks the deck and must not retune who is already standing there. `q_s12_quarter_stays_blank` reaches `neon_arc` and must not rename it to the Neon Quarter. `q_s12_lacks_standing` reaches an empty office and must not instantiate either Iris to fill it.

## Props

`prop_junction_box`, `prop_cable_coil`, and `prop_count_slate` already exist on the kit. This facet places no new prop and does not move a nest, a coil, or a slate. The unplaced named sets stay unplaced. A physical neon banner is cloth on a stack, one magenta, and it is not a UI panel floating off the mesh.

## Hard fails

A Quaternius body, a rifle, a pistol, a baton, a second copy of any unique, a body on Pinewood Crossing, a Flower Law disk around a deck, a census digit filled in, a cause written for the dark week, a merged Iris, a Nakamura coat on Renn, a health bar on a president. Until a native mesh exists, the pair spawns nothing.
