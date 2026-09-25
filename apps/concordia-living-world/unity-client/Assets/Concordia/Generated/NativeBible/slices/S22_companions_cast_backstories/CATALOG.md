# S22 catalog

Twelve companions. Six errands. No new creature, boss, skill, item, or faction delta. Cycle 2 adds speak windows, one conditional line per stage, and two errands. The twelve ids did not change.

## Cast

| id | Name | Home | Gate walker | Assist | Unlock already in volume or canon |
| --- | --- | --- | --- | --- | --- |
| `comp_brackish` | Brackish | Hub | No. Salt road to (62, −28) only | `skill_presence_gossip` | `q_hub_brackish_supper` |
| `comp_old_seam` | Old Seam | Hub | No. Dome perimeter and salt road | `skill_presence_lantern_step` | `q_hub_nesha_gap` |
| `comp_maren` | Maren Ashveil | Hub | No. Plaques, then back | `skill_presence_witness` | `q_hub_brackish_supper` |
| `comp_gale` | Arena Warden Gale | Hub | No. Arena disk only | `skill_steel_parry` | `q_hub_flower_urn` |
| `comp_thorne` | Thorne Blackroot | Fantasy | Yes, if the offer was refused | `skill_steel_curse_fold` | `q_fantasy_held_offer` |
| `comp_maeris` | Maeris | Fantasy | Bog edge only. Not the Crucible disk | `skill_presence_second_hour` | `fantasy_maeris_02_steps` |
| `comp_nyx` | Nyx Torres | Cyber | Yes | `skill_presence_refuse_count` | `q_cyber_missing_number` |
| `comp_jax` | Jax Rivera | Crime | Yes. Never with Vesper | `skill_steel_invoice` | `q_crime_invoice_lands` |
| `comp_kel` | Kel Sandren | Hub (sheet). Volume says Frontier | Yes. He teaches the rule | `skill_presence_witness` | `q_frontier_find_kel` |
| `comp_esha` | Esha Varan | Sere | No. Not on the Court | `skill_presence_name_holder` | `q_sere_open_table` |
| `comp_calla` | Calla Bren | Ruins | Yes. Follow does not start the fourth | `skill_steel_unburial` | `q_ruins_wraith_unfinished` |
| `comp_vesper` | Vesper Kane | Superhero (sheet). Stall is Hub | No. Stall-bound | `skill_presence_bargain` | `q_hub_brackish_supper` |

## Flags

Each person has `companion_<id>_intro`, `_mid`, and `_postboss`. Intro once. Mid fires on the quest named in that companion's `mid_fires_on`. Postboss only at their own stand, remembrance still held, not spent as coin, ink, gold, or a mask.

A conditional line in `banter_alts` may replace the primary line at the moment the flag flips. The flag still flips once. It does not replay when the condition changes later. An empty subtitle is never the quiet: Nyx's quiet is the sentence "The quiet is the line."

Home-world banter fires only in `home_speak_phases`. Dominus sleep, vigils, and night locks stay silent. Court guests with `court_stand_always` may still speak at their GuestDef.

Do not reuse the shared strings `companion_intro_spoken`, `companion_mid_flag`, and `companion_postboss_remembrance` from the volume file. One flip would speak the whole cast.

## Who does not attend a circle

| Encounter | Companion fact |
| --- | --- |
| `enc_held_curse` | Thorne scouts the lip only after a refusal. He does not enter the circle. Taking the offer dismisses him. |
| `enc_fold_basilisk` | Maeris does not scout it. The overlook quest stays the overlook quest. |
| `enc_unfinished` | Calla leaves it unfinished. The mask is a question. |
| `enc_census` | Nyx pulls a person off a painted number. She does not ink the token. |
| `enc_junction_null` | Nyx is not the striker. |
| `enc_outstanding` | Jax produces the invoice. He does not hide it. |
| `enc_compound_mark` | Esha allows one brand. A second mark ends the walk. The ledger stays off a capital floor. |
| `enc_last_dome`, `enc_road_followed` | Kel does not mount and does not finish them. |
| `enc_unfinished_sunrise`, `enc_unender` | Gale stays on the sand. Vesper stays at the stall. Neither prices the token. |

`enc_twelfth_reap`, `enc_milepost_fold`, and `enc_catalogue_walks` gain nobody.

## Side quests

| id | Where | What completes it | xp |
| --- | --- | --- | --- |
| `q_s22_one_walker` | `hub_portal_plaza` (no metre) | Name one legal walker, or name none | 40 |
| `q_s22_milepost_names` | Seam's stand, then (62, −28), then the bell-tower | The child says Pinewood Crossing and comes back | 45 |
| `q_s22_not_a_pair` | Jax (−18.2, −5.5), Vesper (7.2, 9.1), Maren (6.4, −3.1) | Maren writes the fact and not the reason | 50 |
| `q_s22_framed_riddle` | Nyx (−14.5, −12.2), Thorne (12.8, −14.5) | No word is added to the framed riddle | 35 |
| `q_s22_penanus_minute` | Portal plaza at Penanus, courier house at Solnus | Kel logs the off-schedule minute. Nobody is told. The portal is not entered | 40 |
| `q_s22_bead_count` | Thorne (12.8, −14.5), only after a curse refusal | The braid is counted. No bead is taken | 30 |

Coin 0. Items none. Skills none. Faction deltas none.

Kel's mid flag is `q_s22_penanus_minute`. Gale's is `q_hub_flower_urn`. Maeris's is `fantasy_maeris_02_steps`. Esha's is `q_sere_one_brand`. Calla's is `q_ruins_wraith_unfinished`. The other mids are the four earlier errands.

Taking a bead dismisses Thorne the same way taking the Held Curse offer does. The guest row stays. The minute is not delivered to the Refusal Keep, to Silas, or to the Assembly, and it does not open the creature breach the courier sheet names as a later clue.

Mama Delgado's sheet does not say she already holds the unit authorization and is withholding it. Cycle 1 inferred that. The inference is withdrawn. The player is still not the channel, and still does not tell Vesper that the Ghost is Jax.

## Not promoted

Lamplighter, Elias Voss, Seraphine Voss, Mama Iron Rose, Kael Nakamura, Lyra Silentchant, Asbir Thelane. Concordia, Concord, the Sovereign. No Tunya companion. No Crucible companion.

## Body

CX only. Heights from `GuestDef` where a guest exists: Brackish 1.42, Old Seam 1.58, Maren 1.70, Vesper 1.78, Jax 1.80, Nyx 1.70, Gale 1.90, Thorne 1.96. One emissive accent. Thorne's green thread is a wrist cord, not a full tattoo. Nyx's knuckle is the accent, not a pair of glowing arms. Vesper has no halo and no mask. Esha has no Tessera tile. Gale's estoc exists on the sand and is a flower anywhere else in the Court.
