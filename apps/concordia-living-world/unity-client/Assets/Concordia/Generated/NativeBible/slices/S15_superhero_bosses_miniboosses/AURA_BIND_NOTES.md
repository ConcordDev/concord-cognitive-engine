# Aura bind notes — S15 Permanent Dawn bosses

Bind this facet after the Superhero block of `volume/DENSITY_TABLES.json` and after `enc_unfinished_sunrise` in `BOSSES_AND_RAIDS.json`. This slice adds caps, one derived floor, four new windows, the drop condition on the existing band, and four quests. It does not replace weights, that clock, the elite budget, the mystic budget, or the token id.

Art prompts already live on `faun_aegis_kestrel`, `hyb_dawnjackal`, `mon_dawn_mercy_sentinel`, `npc_role_dawn_elite`, and `npc_role_dawn_mystic`. Reuse those. Do not commission a sheet for a street mutant, an energy wraith, a mech hound, a shadow stalker, a riot elemental, a Dawn disc, a caped Aegis, or a CX tripod. Do not download packs. Do not wipe `Library`. Do not re-download pines.

## Spawn order

1. If `roof_pad` has no transform, kestrels, elites, `enc_yielded_stoop`, and `enc_pauldron_medal` spawn nothing. Do not use a capital, the gap, or `aegis_spire` as the pad.
2. If `aegis_spire` has no transform, `enc_unfinished_sunrise` spawns nothing. Do not move the sentinel to Kane Tower, to the First Battle's unfinished skyscraper, or to the pad.
3. If `street_kitchen` has no transform, `enc_podium_chalk` spawns nothing. One `npc_role_dawn_mystic` may stand at `superhero_normie_resistance_gate` (−34.07, −40.6) for the four errands. The second mystic does not spawn until the kitchen exists. When the kitchen exists, both mystics stand there and the gate keeps a board. Budget stays 2.
4. `gap_baseline_spire` is the gap derived in `BOSSES.json`: midpoint (−4.4, −37.7), between Baseline radius 23 at (−34.07, −40.6) and Spire radius 23 at (25.27, −34.79). Jackals use that floor only during `enc_open_brow`. If CountryCenter stops resolving those capitals, the gap is unplaced and the jackals become nothing.
5. `faun_aegis_kestrel` cap 2, day, pad only. Night 0. Ambient 0 while `enc_yielded_stoop` is up. The event is the pair, not a third bird.
6. `hyb_dawnjackal` ambient cap 0. `enc_open_brow` fields 2. The catalog line that says 3–5 is not this street. The catalog was not edited. Tunya stays empty of this id.
7. `npc_role_dawn_elite` cap 4 on the pad once placed, CX only, Karate, `wpn_2h_dawn_shockmaul`. During `enc_pauldron_medal`, one is the foe and three are witnesses. Outside that window, zero of them are the medal. They never stand on the spire.
8. `mon_dawn_mercy_sentinel` ambient cap 0. The volume window fields 1, on the spire, after the telegraph. A kited kestrel, jackal, elite, or adept despawns at the launch lip.
9. `enc_yielded_stoop`: hours 9–11 when `day_index % 3 == 0`. Telegraph before the stoop commits. Killing a bird fails and drops no `feather_sun`.
10. `enc_open_brow`: hours 18–20 when `day_index % 3 == 1`. Catalog hostile on the hybrid is false. The window sets gap aggro without editing the file. Plates start broken. Do not finish the yielded body.
11. `enc_pauldron_medal`: hours 12–14 when `day_index % 4 == 1`. Witnesses do not aggro. A kill applies the faction pair in `BOSSES.json` and drops nothing.
12. `enc_podium_chalk`: hours 15–17 when `day_index % 2 == 1`. No legal strike. Erase the mark. Do not render the chalk name as a readable string.
13. `enc_unfinished_sunrise`: volume hours 5–7, every second day, cron left as written. Phases stay perch, band, same morning.
14. North nest, rights–baseline overlap, campus air, spire–college gap, wilds ring 90–126 m, Pinewood Crossing (62, −28), and `arch_ix_sunder_dawn`: cap 0 for every id this slice owns.

Missing mesh on any row: spawn nothing for that row. Do not borrow a disc, a sparrow, a Tunya jackal, a Grid door, a CX body for the sentinel or the jackal or the kestrel, a Quaternius body, or a Kenney body. Clips may retarget later onto a native mesh that does not yet exist. People retarget onto CX only.

`canon_kind_alias` sentinel on Superhero resolves to `mon_dawn_mercy_sentinel` inside the sunrise window only, count 1. It does not resolve to `mon_grid_sentinel`. The drone alias resolves to nothing in this facet.

## Hit resolution

Dawn steel is live. Do not apply Flower Law to a mercy shock on a Dawn roof. Do apply it if a body is dragged inside the Hub 42 m disk and outside the Arena: the maul is a flower. Health stays the table already on the creature row: `table:faun_small`, `table:mon_skirmisher`, `table:mon_artillery`. The elite and the adept have no health table on the role. Do not invent one. The elite clears by the knockdown `skill_steel_mercy` already defines as nonlethal below 15 percent. The adept does not enter hit resolution at all.

`skill_steel_mercy` is the refuse on the sentinel's first phase, the knockdown on a jackal, and the hit that leaves the medal standing. Bind `cue_mercy`. Blue only on the hit frame. The skill row already points at a lightning prefab. A disintegration does not fit. Do not retune the skill file. Do not grant the skill from this slice's quests. Volume quests already grant it where they grant it.

`faun_aegis_kestrel` is `hostile: true` in `ANIMALS.json`. Ambient pad birds do not open on a person who has not struck a yielded body. `hyb_dawnjackal` is `hostile: false`. The open-brow window is the fight. `mon_dawn_mercy_sentinel` is `hostile: true` and still does not exist outside its hour. Those files were not edited.

The boss rule on the sunrise remains the volume text. Leaving the band and walking off drops `item_rem_mercy_band`. Taking the band as a medal suppresses it. The shelf is `street_kitchen` when that set exists. A Luminary gate does not buy it.

## Quest mouths

`q_s15_spire_gap`, `q_s15_eleven_stand`, `q_s15_no_flinch`, and `q_s15_act_unpassed` offer and turn in at the Baseline gate through `npc_role_dawn_mystic`. They do not spawn beasts in the nest, the overlap, or the lounge. They do not clone the unique list in `BOSSES.json`. Hidden truths stay out of board lines, gossip, and chalk.
