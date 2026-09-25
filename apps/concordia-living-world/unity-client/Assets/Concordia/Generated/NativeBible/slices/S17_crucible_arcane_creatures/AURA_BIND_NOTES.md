# Aura bind notes — S17 Crucible foundry beasts

Bind this facet after the Crucible block of `volume/DENSITY_TABLES.json` and after `enc_unender` in `BOSSES_AND_RAIDS.json`. This slice adds caps, three derived floors, three mini-boss windows, one adjacency window, the drop condition on the existing seam, and four quests. It does not replace weights, the Un-Ender clock, the Compound Mark clock, the mystic budget, or the token id.

Art prompts already live on `faun_lattice_moth`, `mon_crucible_drift`, `hyb_latticebasilisk`, `mon_boss_unender`, `mon_boss_compound_mark`, and `npc_role_crucible_mystic`. Reuse those. Do not commission a sheet for a mote swarm, a stone warden, an echo serpent, a Crucible construct, a census hybrid, a kiln on lattice ground, or a closed clock. Do not download packs. Do not wipe `Library`. Do not re-download pines.

## Spawn order

1. `gap_wit_procgen` is the open derived in `CREATURES.json`: center (−43.66, −10.42), 3.72 m between Witnesses radius 23 at (−62.76, 5.49) and Procgen radius 23 at (−24.55, −26.33). Moths use that floor at night, cap 4. A foundry module does not fit. If CountryCenter stops resolving those two capitals, the moths become nothing.
2. `gap_cult_procgen` is the open at (1.87, −21.66), 7.66 m between Cultists radius 23 at (28.29, −17.0) and Procgen. `enc_rib_notch` fields one basilisk there at hours 8–10 when `day_index % 3 == 0`. `enc_unender` fields the boss there on the volume clock. They do not share an hour.
3. `gap_eng_procgen` is the open at (10.85, −31.34), 25.50 m between Engineers radius 25.5 at (48.72, −36.71) and Procgen. The capital midpoint is not this point. Drift masses use this floor, cap 2. `enc_two_masses` is those two at hours 11–13 when `day_index % 3 == 1`.
4. If `arch_ix_crucible_foundry` has no transform, `enc_numeral_open` and `q_s17_missing_numeral` spawn and complete nothing. Do not move the clock to a capital, to `gap_wit_procgen`, onto the bare 7.66 m open, or onto `gap_proc_meta`. The recommended seat, once a transform is authored, is one 4 m module in that 7.66 m open. An 8 m 2×2 bay does not fit the throat. `gap_proc_meta` is 14.74 m and would clear 8 m. It stays cap 0. This note does not author the transform.
5. `unend_hall`, `shard_yard`, and `leaning_stack` are not floors for any id in this facet.
6. `faun_lattice_moth` day cap 0. Night cap 4 on the witness open. During `enc_vein_short` the count stays 4. If `enc_unender` is open that night, the vein window does not arm. A completed pattern removes the four and does not aggro them.
7. `mon_crucible_drift` cap 2 on the engineer open. Three shards are the body. A fourth light is VFX with no hitbox. The catalog spawn line that says 1–3 is not a third mass. The catalog was not edited.
8. `hyb_latticebasilisk` ambient cap 0. `enc_rib_notch` fields 1. No density weight is added.
9. `mon_boss_unender` ambient cap 0. The volume window fields 1 after the telegraph. A kited basilisk, moth, drift mass, or walker despawns at the lip of the open.
10. `npc_role_crucible_mystic` budget stays 4, CX only, Sword, `wpn_focus_crucible_unend`. One of the four may stand on the moth gap during `enc_vein_short`. That walker has no legal strike. The other three stay on spans and the shard cart. Lyra, Emer, and Ono are not cloned. Named lore persons are not extras.
11. `enc_numeral_open`: hours 17–19, every third day, cron family `0 17 */3 * *`, on `glue_clock_face_unclosed` once placed. Creature count 0. `mon_boss_compound_mark` stays on Sere. `item_rem_furnace_eye` in the bay fails the clear.
12. `enc_unender`: volume hours 20–23, every third day, cron left as written. Phases stay Gap, Close attempt, Almost ninth.
13. East overlaps, the six wider fields (`gap_proc_meta`, `gap_proc_ref`, `gap_wit_cult`, `gap_wit_meta`, `gap_wit_ref`, `gap_wit_eng`), capitals, districts at (+8, −6), wilds 90–126 m, the 3.50 m sliver outside the engineer rim, and Pinewood Crossing (62, −28): cap 0 for every id this slice owns.

Missing mesh on any row: spawn nothing for that row. Do not borrow a bowtie moth, a particle blob, a Grid construct, a Sere kiln, a Ruins wraith, a CX body for the ring or the serpent or the moth or the mass, a Quaternius body, or a Kenney body. Clips may retarget later onto a native mesh that does not yet exist. People retarget onto CX only.

`canon_kind_alias` drift resolves to `mon_crucible_drift` at cap 2. Construct resolves to nothing on this continent; S11 already set `mon_grid_construct` Crucible cap to 0. Wraith resolves to nothing.

## Hit resolution

Crucible steel is live. Do not apply Flower Law to a shard thrown on these opens. Do apply it if the shard is dragged inside the Hub 42 m disk and outside the Arena. Health stays the table already on the creature row: `table:faun_critter`, `table:mon_skirmisher`, `table:mon_brute`, `table:boss_region`. The walker has no health table on the role. Do not invent one. The walker does not enter hit resolution.

`skill_craft_unend` is the notch, the vein, and the seam. `skill_steel_shard` is the volume's other seam tool. The monster row's `skill_craft_lattice_unend` is not bound as a second skill. Do not retune the skill files. Do not grant either skill from this slice's quests. Volume quests already grant them where they grant them.

`faun_lattice_moth`, `mon_crucible_drift`, and `hyb_latticebasilisk` are `hostile: false`. The rib window and the two-mass window set aggro on the instance. The moth window does not. `mon_boss_unender` is `hostile: true` and still does not exist outside its hour. Those files were not edited.

The boss rule on the ring remains the monster text plus the volume phases. Forced completion with the gap still open drops `item_rem_unclosed_seam`. Walking out drops nothing. A ninth-close drops nothing. The cart does not sell the seam.

## Quest mouths

`q_s17_rib_notch`, `q_s17_three_plates`, `q_s17_vein_short`, and `q_s17_missing_numeral` offer and turn in at `vend_crucible_cart` through `npc_role_crucible_mystic`. They do not spawn beasts in the overlaps, on a capital, or on Pinewood. They do not clone the unique list in `CREATURES.json`. The numeral quest waits while the gantry has no transform. Hidden truths stay out of board lines and gossip.
