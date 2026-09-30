# Catalog — S15 Permanent Dawn bosses

Two living rows with a cap, two role budgets spent as windows, one boss that stays encounter-only. Volume weights are unchanged. Country circles are rims. Kit sets spawn nothing until they have a transform.

| id | Name | Where | Cap | Place in the morning | Temper |
| --- | --- | --- | --- | --- | --- |
| `faun_aegis_kestrel` | Aegis Kestrel | `roof_pad`, day | 2. Night 0. During the yielded-stoop window the pair is the event and the ambient cap is 0 | Refuses the last strike on anything that has yielded | Hover is a kite. Stoop is an anchor, not a drone |
| `hyb_dawnjackal` | Dawn Jackal | `gap_baseline_spire` | Ambient 0. The open-brow window fields 2 | Marble brow is the mercy rule. These two are already cracked | Nip. A finish is the violation |
| `npc_role_dawn_elite` | Aegis | `roof_pad` once placed | Budget 4, unchanged. One of them is the medal during that window. The other three stay witnesses | People. CX. Karate. They do not take the final win, except the one who already did | Fist. The medal is the tell |
| `npc_role_dawn_mystic` | Luminary Adept | `street_kitchen` once placed. Until then, one body at the Baseline gate for the errands | Budget 2, unchanged. One writes the podium. The other keeps feeding | Pale coat, bread or a ledger. No laser eyes | The villainy is a finished name in chalk |
| `mon_dawn_mercy_sentinel` | Mercy Sentinel | `aegis_spire` | 0 ambient. 1 inside the volume sunrise window, and only after the set is placed | Tripod, one barrel, a brass halo that is metal | Offers a finishing blow and calls it help |

## Held at zero

| id | Why the cap is zero |
| --- | --- |
| `mon_grid_sentinel` | S11. Dawn skin is an art note. Superhero cap is 0. The sentinel alias on this continent resolves to `mon_dawn_mercy_sentinel` inside `enc_unfinished_sunrise` only. |
| `mon_grid_drone` | World ids are Cyber, Crime, and Sere. S11 owns the disc. WorldDef lists a drone. This facet does not resolve that alias into a spawn, and it does not borrow the kestrel to fill the hole. |
| `hyb_mercywraith` | Lists Superhero and Ruins. S07 set both worlds to 0 until a cross slice. Those gates are not neighbors. This facet does not build the import. |
| `mon_grid_construct` | Not a Dawn world id. |
| Canon seeds `street_mutant`, `energy_wraith`, `mech_hound`, `shadow_stalker`, `riot_elemental` | No bible ids. They are not aliased onto the kestrel, the jackal, the sentinel, or a CX body. |

## Mini-bosses

| Encounter | Body | Count | When | Clear |
| --- | --- | --- | --- | --- |
| `enc_yielded_stoop` | `faun_aegis_kestrel` | 2 | Hours 9–11 when the volume day index modulo 3 is 0. `roof_pad` only | Stand over what has yielded. The hover holds. Killing a bird fails. No sun feather |
| `enc_open_brow` | `hyb_dawnjackal` | 2 | Hours 18–20 when that index modulo 3 is 1. Gap midpoint (−4.4, −37.7) | Stop the nip. Do not become the finisher. Leave the chips |
| `enc_pauldron_medal` | `npc_role_dawn_elite` | 1 foe, 3 witnesses | Hours 12–14 when that index modulo 4 is 1. `roof_pad` only | `skill_steel_mercy` or a palm. They stand. The witnesses do not join |
| `enc_podium_chalk` | `npc_role_dawn_mystic` | 1 writer, 1 feeder | Hours 15–17 when that index modulo 2 is 1. `street_kitchen` only | Erase the name. Do not strike the coat. Do not carry the name to a press |

## Boss

`enc_unfinished_sunrise`. Volume clock: hours 5–7, every second day. Phases stay perch, band, same morning. `skill_steel_mercy` refuses the help in the first phase. Leaving the band is the second. Walking off the roof with no podium is the third. Taking the win ends the dawn and suppresses `item_rem_mercy_band`. Pure damage does not make a champion.

## Token

| id | Drops from | Suppressed when |
| --- | --- | --- |
| `item_rem_mercy_band` | Band left, player walked off | The band was taken as a medal, the help was accepted, or the spire is unplaced |

No second token. `feather_sun`, `marble_chip`, `halo_shard`, and `mercy_cell` stay table names on the bible rows. They are not remembrances. `prop_mercy_circlet` stays at its density weight of 0.

## Side quests

Four. One mystic role, inside budget 2. No skill grant. No DTU. No clone of Mira, Champion, Kor, Elias, Vesper, Marcus, Silas, Vale, Juno, Devon, Aldis, or Kira.

| id | What it asks | What it does not redo |
| --- | --- | --- |
| `q_s15_spire_gap` | Name the 13.6 m open. Do not finish a body in it. Do not take a spire chit | The eight `q_superhero_*` rows |
| `q_s15_eleven_stand` | Stand on the Bronx arterial. Restitution is not a victory | The swarm's hidden authorization |
| `q_s15_no_flinch` | Leave the lounge before anyone finishes anyone | The Iron Hex chain and Kor's conditions |
| `q_s15_act_unpassed` | Walk the 9.1 m overlap. The Registration Act is not yours to finish | Juno's negotiation and Devon's house |

## Empty on purpose

North nest of Enforcers, Luminary, and the Task Force. Rights–baseline overlap. The 26.6 m of air between the Task Force and the College. The 14.6 m between the Spire and the College. Every other positive gap. The wilds ring from 90 m to 126 m. Pinewood Crossing. `arch_ix_sunder_dawn`. Crime and Crucible imports.
