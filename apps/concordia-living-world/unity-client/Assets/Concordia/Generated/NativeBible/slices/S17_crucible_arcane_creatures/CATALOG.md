# Catalog — S17 Crucible foundry beasts

WorldId `Crucible`. Law: if it would end, un-end it. No ninth Refusal. Moth wings stay asymmetric. Density weights, the mystic budget of 4, the Un-Ender clock, and the Compound Mark clock are cited and not edited.

## Caps

| Id | Ambient | In its window | Other worlds |
| --- | --- | --- | --- |
| `faun_lattice_moth` | 4 at night on `gap_wit_procgen` | the same 4 during `enc_vein_short` | none in the row |
| `mon_crucible_drift` | 2 on `gap_eng_procgen` | the same 2 during `enc_two_masses` | none in the row |
| `hyb_latticebasilisk` | 0 | 1 during `enc_rib_notch` | none in the row |
| `mon_boss_unender` | 0 | 1 during `enc_unender` | none in the row |
| `npc_role_crucible_mystic` | budget 4, spans and cart | 1 of those 4 stands on the moth gap during `enc_vein_short` | — |
| `mon_grid_construct` | 0 | — | Cyber cap stays S11's 1 |
| `hyb_censusconstruct` | 0 | — | Cyber cap stays S11's 0 |
| `mon_boss_compound_mark` | 0 | — | Sere, `enc_compound_mark` only |
| `mon_road_watcher` | 0 | — | Frontier skin stays S13 |
| `mon_ruins_wraith`, `hyb_mercywraith` | 0 | — | Ruins / Dawn, already capped |

## Windows

| Id | Body | When | Floor |
| --- | --- | --- | --- |
| `enc_rib_notch` | `hyb_latticebasilisk` × 1 | 8–10, `day_index % 3 == 0` | `gap_cult_procgen` |
| `enc_two_masses` | `mon_crucible_drift` × 2 | 11–13, `day_index % 3 == 1` | `gap_eng_procgen` |
| `enc_vein_short` | moth × 4, one walker | 21–23, `day_index % 3 == 2`, and only if `enc_unender` is closed | `gap_wit_procgen` |
| `enc_numeral_open` | no new body | 17–19, same every-third-day cron as the Mark, closing before hour 20 | unplaced `glue_clock_face_unclosed` |
| `enc_unender` | `mon_boss_unender` × 1 | volume 20–23, every third day | `gap_cult_procgen` |

## Token and quests

| Id | Kind |
| --- | --- |
| `item_rem_unclosed_seam` | Existing remembrance. Forced completion with the gap still open. Walk-away and ninth-close both suppress it. |
| `q_s17_rib_notch` | Basilisk. The third alloy stays untaught. The rib notch stays open. |
| `q_s17_three_plates` | Drift. Three shards are the body. The flare is not a fourth plate. |
| `q_s17_vein_short` | Moth. The vein stops before the edge. The walker is not a legal strike. |
| `q_s17_missing_numeral` | Clock. The Mark's evening has a Crucible face. The last numeral stays missing. |

## Unspawned

`drift_mote_swarm`, `crucible_warden`, and `echo_serpent` have Canon sentences and no bible ids. The mote is not the drift mass. The warden is not the basilisk. The echo is not the basilisk. `wraith` on the WorldDef resolves to nothing here. `construct` resolves to `mon_grid_construct`, and S11 already set that Crucible cap to 0. The quartz patch in the construct's art note stays a sentence.

East overlaps (cultists inside meta, cultists–engineers, engineers–meta, refugees–meta, cultists–refugees, engineers–refugees) stay cap 0. Six wider opens also stay cap 0: procgen–meta 14.74 m, procgen–refugees 32.26 m, and the four Witness fields at 47.79 m, 55.20 m, 61.83 m, and 70.70 m. The 7.66 m throat is the narrowest gap that clears one 4 m module. An 8 m 2×2 bay does not fit it. Every capital and its (+8, −6) district, the wilds ring 90–126 m, and the 3.50 m sliver outside the engineer rim stay cap 0. Pinewood Crossing is Hub.

`unend_hall`, `shard_yard`, and `leaning_stack` are named lattice sets with no Canon transform. They are not substitute floors for these gaps.
