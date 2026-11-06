# Quest content audit (A-01)

Generated 2026-10-26 by Claude from repo `content/` and `Canon/`. Regenerate with the script named at the end.

## Summary

- **Quests:** 135, with 314 objectives.
- **Unity can complete** 250/314 objectives (`QuestLog.CanDo`: defeat, deliver, gather, interact, observe, reach_location, talk_to). Quests completable end to end in Unity: 97/135.
- **The server records progress for** 83/314 objectives (types with a `recordObjectiveProgress` call site: defeat, gather, kill, talk_to). Quests completable end to end online: 3/135.
- **Canon files:** 0 missing, 0 differ from `content/`.

Online (A-05), a quest finishes on the server only when the server records every objective. `reach_location`, `interact`, `deliver` and `observe` have no server writer yet, so most quests cannot finish online; that is server work, not a client gap.

## Objective types

| Type | Count | Unity | Server |
|---|---:|:---:|:---:|
| `reach_location` | 73 | yes | no |
| `talk_to` | 69 | yes | yes |
| `interact` | 41 | yes | no |
| `deliver` | 36 | yes | no |
| `observe` | 17 | yes | no |
| `any_of` | 13 | no | no |
| `gather` | 13 | yes | yes |
| `talk_to_npc` | 10 | no | no |
| `perceive_clue` | 6 | no | no |
| `travel` | 5 | no | no |
| `branch_decision` | 5 | no | no |
| `macro` | 4 | no | no |
| `attend_event` | 3 | no | no |
| `stealth_traverse` | 3 | no | no |
| `collect_item` | 2 | no | no |
| `wait_for_event` | 2 | no | no |
| `rsvp_event` | 1 | no | no |
| `craft` | 1 | no | no |
| `cook` | 1 | no | no |
| `consume` | 1 | no | no |
| `defeat` | 1 | yes | yes |
| `tame` | 1 | no | no |
| `time_window` | 1 | no | no |
| `open_lens` | 1 | no | no |
| `create_dtu` | 1 | no | no |
| `infiltrate_or_persuade` | 1 | no | no |
| `dialogue` | 1 | no | no |
| `use_skill` | 1 | no | no |

`talk_to_npc` is spelled differently from `talk_to`; `QuestLog.Norm` only lower-cases, so Unity treats it as unsupported.

## Canon sync

Every source file is in Canon and identical.

## Per quest

| Source | World | Canon | Quest | Objectives | Unity | Server | Unsupported in Unity |
|---|---|---|---|---:|---:|---:|---|
| `content/quests/brackish-trust.json` | concordia-hub | present | `brackish_01_notice` | 1 | 1 | 0 |  |
| `content/quests/brackish-trust.json` | concordia-hub | present | `brackish_02_choice` | 1 | 0 | 0 | any_of |
| `content/quests/brackish-trust.json` | concordia-hub | present | `brackish_03_intelligence` | 1 | 0 | 0 | any_of |
| `content/quests/consolidation-stake.json` | concordia-hub | present | `consolidation_01_two_ledgers` | 3 | 3 | 1 |  |
| `content/quests/consolidation-stake.json` | concordia-hub | present | `consolidation_02_two_worlds` | 5 | 3 | 2 | travel |
| `content/quests/faction-quests.json` | concordia-hub | present | `faction_scholars_1` | 4 | 4 | 3 |  |
| `content/quests/faction-quests.json` | concordia-hub | present | `faction_scholars_2` | 4 | 4 | 2 |  |
| `content/quests/faction-quests.json` | concordia-hub | present | `faction_wardens_1` | 4 | 4 | 2 |  |
| `content/quests/faction-quests.json` | concordia-hub | present | `faction_wardens_2` | 4 | 4 | 1 |  |
| `content/quests/faction-quests.json` | concordia-hub | present | `faction_merchants_1` | 4 | 4 | 2 |  |
| `content/quests/faction-quests.json` | concordia-hub | present | `faction_merchants_2` | 4 | 4 | 4 |  |
| `content/quests/faction-quests.json` | concordia-hub | present | `faction_network_1` | 3 | 3 | 1 |  |
| `content/quests/faction-quests.json` | concordia-hub | present | `faction_network_2` | 3 | 3 | 2 |  |
| `content/quests/first-adaptation.json` | concordia-hub | present | `first_adaptation_01_print` | 2 | 2 | 1 |  |
| `content/quests/first-adaptation.json` | concordia-hub | present | `first_adaptation_02_yard` | 3 | 3 | 1 |  |
| `content/quests/first-adaptation.json` | concordia-hub | present | `first_adaptation_03_name` | 2 | 2 | 1 |  |
| `content/quests/first-day-arc.json` | concordia-hub | present | `first_day_claim_land` | 2 | 1 | 0 | macro |
| `content/quests/first-day-arc.json` | concordia-hub | present | `first_day_invite_friend` | 1 | 0 | 0 | macro |
| `content/quests/first-day-arc.json` | concordia-hub | present | `first_day_attend_event` | 2 | 0 | 0 | attend_event, rsvp_event |
| `content/quests/first-day-arc.json` | concordia-hub | present | `first_day_witness_faction_move` | 2 | 0 | 0 | macro, talk_to_npc |
| `content/quests/first_cycle_phase_d.json` | concordia-hub | present | `first_cycle_phase_d` | 4 | 4 | 0 |  |
| `content/quests/founding-day-reading.json` | concordia-hub | present | `founding_day_01_gather` | 2 | 2 | 1 |  |
| `content/quests/founding-day-reading.json` | concordia-hub | present | `founding_day_02_reading` | 4 | 4 | 0 |  |
| `content/quests/founding-day-reading.json` | concordia-hub | present | `founding_day_03_sign` | 2 | 2 | 1 |  |
| `content/quests/impossible-print.json` | concordia-hub | present | `impossible_print_01_kiren` | 2 | 2 | 0 |  |
| `content/quests/impossible-print.json` | concordia-hub | present | `impossible_print_02_orin` | 2 | 2 | 0 |  |
| `content/quests/impossible-print.json` | concordia-hub | present | `impossible_print_03_kel` | 2 | 2 | 0 |  |
| `content/quests/impossible-print.json` | concordia-hub | present | `impossible_print_04_synthesis` | 3 | 3 | 0 |  |
| `content/quests/kael-torchlight.json` | concordia-hub | present | `kael_torchlight` | 3 | 2 | 2 | craft |
| `content/quests/main-arc.json` | concordia-hub | present | `cracks_in_the_compact` | 4 | 4 | 3 |  |
| `content/quests/main-arc.json` | concordia-hub | present | `the_shadow_archive` | 4 | 4 | 2 |  |
| `content/quests/main-arc.json` | concordia-hub | present | `warden_crackdown` | 4 | 4 | 2 |  |
| `content/quests/main-arc.json` | concordia-hub | present | `broker_gambit` | 4 | 4 | 3 |  |
| `content/quests/main-arc.json` | concordia-hub | present | `the_merchants_dilemma` | 4 | 4 | 3 |  |
| `content/quests/main-arc.json` | concordia-hub | present | `the_reckoning` | 4 | 4 | 3 |  |
| `content/quests/main-arc.json` | concordia-hub | present | `a_new_compact` | 5 | 5 | 4 |  |
| `content/quests/nesha-old-seam.json` | concordia-hub | present | `nesha_seam_01_pattern` | 1 | 1 | 0 |  |
| `content/quests/nesha-old-seam.json` | concordia-hub | present | `nesha_seam_02_history` | 2 | 2 | 2 |  |
| `content/quests/nesha-old-seam.json` | concordia-hub | present | `nesha_seam_03_mediate` | 3 | 3 | 1 |  |
| `content/quests/onboarding.json` | concordia-hub | present | `first_cycle_cook` | 3 | 2 | 1 | cook |
| `content/quests/onboarding.json` | concordia-hub | present | `first_cycle_eat` | 1 | 0 | 0 | consume |
| `content/quests/onboarding.json` | concordia-hub | present | `first_cycle_fight` | 3 | 3 | 2 |  |
| `content/quests/onboarding.json` | concordia-hub | present | `first_cycle_commune` | 2 | 2 | 1 |  |
| `content/quests/onboarding.json` | concordia-hub | present | `the_arrival` | 4 | 4 | 2 |  |
| `content/quests/onboarding.json` | concordia-hub | present | `first_contact` | 4 | 4 | 3 |  |
| `content/quests/onboarding.json` | concordia-hub | present | `the_choice` | 4 | 4 | 2 |  |
| `content/quests/onboarding.json` | concordia-hub | present | `first_cycle_befriend` | 3 | 2 | 0 | tame |
| `content/quests/onboarding.json` | concordia-hub | present | `first_cycle_sneak` | 2 | 1 | 0 | stealth_traverse |
| `content/quests/onboarding.json` | concordia-hub | present | `first_cycle_kingdom_visit` | 2 | 2 | 0 |  |
| `content/quests/onboarding.json` | concordia-hub | present | `first_cycle_play` | 1 | 0 | 0 | any_of |
| `content/quests/sealed-record.json` | concordia-hub | present | `sealed_01_notice` | 3 | 3 | 1 |  |
| `content/quests/sealed-record.json` | concordia-hub | present | `sealed_02_isa` | 3 | 3 | 0 |  |
| `content/quests/sealed-record.json` | concordia-hub | present | `sealed_03_cavity` | 4 | 2 | 0 | stealth_traverse, time_window |
| `content/quests/sealed-record.json` | concordia-hub | present | `sealed_04_choice` | 1 | 0 | 0 | any_of |
| `content/quests/southern-arc-mystery.json` | concordia-hub | present | `southern_arc_01_notice` | 2 | 2 | 1 |  |
| `content/quests/southern-arc-mystery.json` | concordia-hub | present | `southern_arc_02_witness` | 3 | 3 | 1 |  |
| `content/quests/southern-arc-mystery.json` | concordia-hub | present | `southern_arc_03_oracle` | 3 | 3 | 1 |  |
| `content/quests/southern-arc-mystery.json` | concordia-hub | present | `southern_arc_04_assembly` | 2 | 2 | 0 |  |
| `content/quests/southern-arc-mystery.json` | concordia-hub | present | `southern_arc_05_choice` | 1 | 0 | 0 | any_of |
| `content/quests/the-handshake-revelation.json` | concordia-hub | present | `the_handshake_revelation` | 11 | 1 | 0 | macro, talk_to_npc, travel |
| `content/quests/sub-worlds/concord-link-frontier/mara-letter.json` | concord-link-frontier | present | `frontier_mara_01_call` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/concord-link-frontier/mara-letter.json` | concord-link-frontier | present | `frontier_mara_02_deliver` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/concord-link-frontier/mara-letter.json` | concord-link-frontier | present | `frontier_mara_03_return` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/concord-link-frontier/silas-quinn-portal.json` | concord-link-frontier | present | `frontier_silas_01_observe` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/concord-link-frontier/silas-quinn-portal.json` | concord-link-frontier | present | `frontier_silas_02_kel` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/concord-link-frontier/silas-quinn-portal.json` | concord-link-frontier | present | `frontier_silas_03_synth` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/concord-link-frontier/zara-perimeter.json` | concord-link-frontier | present | `frontier_zara_01_brief` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/concord-link-frontier/zara-perimeter.json` | concord-link-frontier | present | `frontier_zara_02_token` | 3 | 3 | 1 |  |
| `content/quests/sub-worlds/concord-link-frontier/zara-perimeter.json` | concord-link-frontier | present | `frontier_zara_03_watch` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/crime/ada-pell-log.json` | crime | present | `crime_ada_01_morgue` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/crime/ada-pell-log.json` | crime | present | `crime_ada_02_cross` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/crime/ada-pell-log.json` | crime | present | `crime_ada_03_return` | 1 | 1 | 1 |  |
| `content/quests/sub-worlds/crime/dahlia-ledger.json` | crime | present | `crime_dahlia_01_meet` | 2 | 1 | 0 | any_of |
| `content/quests/sub-worlds/crime/dahlia-ledger.json` | crime | present | `crime_dahlia_02_steal` | 2 | 1 | 0 | stealth_traverse |
| `content/quests/sub-worlds/crime/dahlia-ledger.json` | crime | present | `crime_dahlia_03_destination` | 1 | 0 | 0 | any_of |
| `content/quests/sub-worlds/crime/thorpe-bust.json` | crime | present | `crime_thorpe_01_bell` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/crime/thorpe-bust.json` | crime | present | `crime_thorpe_02_maddox` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/crime/thorpe-bust.json` | crime | present | `crime_thorpe_03_haldane` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/cyber/ghost-7-trace.json` | cyber | present | `cyber_ghost_01_oren` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/cyber/ghost-7-trace.json` | cyber | present | `cyber_ghost_02_lavren` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/cyber/ghost-7-trace.json` | cyber | present | `cyber_ghost_03_choice` | 1 | 0 | 0 | any_of |
| `content/quests/sub-worlds/cyber/kira-packet-map.json` | cyber | present | `cyber_kira_01_tea` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/cyber/kira-packet-map.json` | cyber | present | `cyber_kira_02_map` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/cyber/kira-packet-map.json` | cyber | present | `cyber_kira_03_trace` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/cyber/silver-identity.json` | cyber | present | `cyber_silver_01_visit` | 2 | 1 | 0 | any_of |
| `content/quests/sub-worlds/cyber/silver-identity.json` | cyber | present | `cyber_silver_02_choose` | 1 | 0 | 0 | any_of |
| `content/quests/sub-worlds/cyber/silver-identity.json` | cyber | present | `cyber_silver_03_close` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/fantasy/lyra-thorne-chain.json` | fantasy | present | `fantasy_lyra_01_satchel` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/fantasy/lyra-thorne-chain.json` | fantasy | present | `fantasy_lyra_02_moonleaf` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/fantasy/lyra-thorne-chain.json` | fantasy | present | `fantasy_lyra_03_master` | 3 | 3 | 2 |  |
| `content/quests/sub-worlds/fantasy/maeris-crossing.json` | fantasy | present | `fantasy_maeris_01_fragment` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/fantasy/maeris-crossing.json` | fantasy | present | `fantasy_maeris_02_steps` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/fantasy/maeris-crossing.json` | fantasy | present | `fantasy_maeris_03_return` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/fantasy/seraphine-heir.json` | fantasy | present | `fantasy_seraphine_01_audience` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/fantasy/seraphine-heir.json` | fantasy | present | `fantasy_seraphine_02_lacquer` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/fantasy/seraphine-heir.json` | fantasy | present | `fantasy_seraphine_03_choice` | 1 | 0 | 0 | any_of |
| `content/quests/sub-worlds/lattice-crucible/emer-print.json` | lattice-crucible | present | `lattice_emer_01_sketches` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/lattice-crucible/emer-print.json` | lattice-crucible | present | `lattice_emer_02_track` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/lattice-crucible/emer-print.json` | lattice-crucible | present | `lattice_emer_03_breach` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/lattice-crucible/ono-nesha-letter.json` | lattice-crucible | present | `lattice_ono_01_sit` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/lattice-crucible/ono-nesha-letter.json` | lattice-crucible | present | `lattice_ono_02_carry` | 3 | 3 | 0 |  |
| `content/quests/sub-worlds/lattice-crucible/ono-nesha-letter.json` | lattice-crucible | present | `lattice_ono_03_return` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/lattice-crucible/voss-pact.json` | lattice-crucible | present | `lattice_voss_01_drill` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/lattice-crucible/voss-pact.json` | lattice-crucible | present | `lattice_voss_02_pact` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/lattice-crucible/voss-pact.json` | lattice-crucible | present | `lattice_voss_03_calla` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/sovereign-ruins/calla-rebellion.json` | sovereign-ruins | present | `ruins_calla_01_camp` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/sovereign-ruins/calla-rebellion.json` | sovereign-ruins | present | `ruins_calla_02_plan` | 3 | 3 | 0 |  |
| `content/quests/sub-worlds/sovereign-ruins/calla-rebellion.json` | sovereign-ruins | present | `ruins_calla_03_dawn` | 2 | 1 | 0 | any_of |
| `content/quests/sub-worlds/sovereign-ruins/silv-marn-dome.json` | sovereign-ruins | present | `ruins_silv_01_circle` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/sovereign-ruins/silv-marn-dome.json` | sovereign-ruins | present | `ruins_silv_02_teach` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/sovereign-ruins/silv-marn-dome.json` | sovereign-ruins | present | `ruins_silv_03_dome` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/sovereign-ruins/thanis-glyph.json` | sovereign-ruins | present | `ruins_thanis_01_audience` | 3 | 3 | 1 |  |
| `content/quests/sub-worlds/sovereign-ruins/thanis-glyph.json` | sovereign-ruins | present | `ruins_thanis_02_layer` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/sovereign-ruins/thanis-glyph.json` | sovereign-ruins | present | `ruins_thanis_03_compose` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/superhero/iron-hex-redemption.json` | superhero | present | `superhero_hex_01_silas` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/superhero/iron-hex-redemption.json` | superhero | present | `superhero_hex_02_kor` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/superhero/iron-hex-redemption.json` | superhero | present | `superhero_hex_03_meeting` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/superhero/mira-discretion.json` | superhero | present | `superhero_mira_01_warn` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/superhero/mira-discretion.json` | superhero | present | `superhero_mira_02_intel` | 1 | 0 | 0 | any_of |
| `content/quests/sub-worlds/superhero/mira-discretion.json` | superhero | present | `superhero_mira_03_published` | 1 | 1 | 0 |  |
| `content/quests/sub-worlds/superhero/sifu-revelation.json` | superhero | present | `superhero_sifu_01_tell` | 2 | 2 | 1 |  |
| `content/quests/sub-worlds/superhero/sifu-revelation.json` | superhero | present | `superhero_sifu_02_carry` | 2 | 2 | 0 |  |
| `content/quests/sub-worlds/superhero/sifu-revelation.json` | superhero | present | `superhero_sifu_03_gift` | 1 | 1 | 0 |  |
| `content/world/sere/quests/main-arc.json` | sere | present | `sere_arc_1_the_ferrymans_hint` | 3 | 0 | 0 | open_lens, perceive_clue, talk_to_npc |
| `content/world/sere/quests/main-arc.json` | sere | present | `sere_arc_2_assemble_the_proof` | 3 | 0 | 0 | collect_item, perceive_clue |
| `content/world/sere/quests/main-arc.json` | sere | present | `sere_arc_3_interrupt_the_tea` | 3 | 0 | 0 | perceive_clue, talk_to_npc |
| `content/world/sere/quests/main-arc.json` | sere | present | `sere_arc_4_heal_the_pact` | 1 | 0 | 0 | branch_decision |
| `content/world/tunya/quests/arks-of-memory.json` | tunya | present | `tunya_arks_of_memory_1_first_pilgrimage` | 4 | 3 | 1 | create_dtu |
| `content/world/tunya/quests/arks-of-memory.json` | tunya | present | `tunya_arks_of_memory_2_curated_vault` | 3 | 1 | 0 | branch_decision, infiltrate_or_persuade |
| `content/world/tunya/quests/bloc-secret.json` | tunya | present | `tunya_bloc_secret_1_twelfth_district` | 3 | 1 | 0 | attend_event, perceive_clue |
| `content/world/tunya/quests/bloc-secret.json` | tunya | present | `tunya_bloc_secret_2_breach_or_protect` | 1 | 0 | 0 | branch_decision |
| `content/world/tunya/quests/nil-protection.json` | tunya | present | `tunya_nil_protection_1_silent_walk` | 3 | 1 | 0 | perceive_clue, wait_for_event |
| `content/world/tunya/quests/nil-protection.json` | tunya | present | `tunya_nil_protection_2_inner_grove` | 3 | 1 | 0 | branch_decision, dialogue |
| `content/world/tunya/quests/vessine-origin.json` | tunya | present | `tunya_vessine_origin_1_resonance_choir` | 3 | 1 | 0 | attend_event, perceive_clue |
| `content/world/tunya/quests/vessine-origin.json` | tunya | present | `tunya_vessine_origin_2_chart_match` | 3 | 0 | 0 | branch_decision, use_skill, wait_for_event |

Script: `.Aura/tools/quest_audit.py` (run with python3 from anywhere).
