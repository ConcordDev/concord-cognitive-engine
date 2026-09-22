# Progression trees

Three Concord-native trees. Ranks are data. They scale magnitude and cooldown and add tags. They do not add C# classes.

SkillLattice today is a VFX lookup (`HubObjectives.SkillLattice`). These rows are the catalog it should bind: `group` = tree, `skillType` = AbilityId, `element` = VfxCue.element.

Gates use systems that already exist or are named in the Unity client:

- `FactionStandingBook` standing and witness heat
- `WorldEventLog` for gossip and law stamps
- `HitResolver` / `ActionRunner` for steel timing
- `GameplayCore` Fabrication, Gunsmithing, Spellcrafting, Vehicles, Containers for craft
- `CxDress` sockets for plates
- Flower Law via `Canon.HubLawRadius` (42m) and Arena exception

Honest gaps stay in the effect, not in the fiction: no ride controller, firearm animation coverage 0%, SkillLattice not yet a talent economy.

## Steel (16)

| AbilityId | Verb | Rank 1 | Rank 5 |
| --- | --- | --- | --- |
| `skill_steel_palm` | `verb_unarmed_light` | default:hub_unarmed | trainer:gale_rank5 |
| `skill_steel_shoulder` | `verb_unarmed_heavy` | default:merchant_or_crime | trainer:mama_rose |
| `skill_steel_chain` | `verb_unarmed_light` | default:wingchun_worlds | rank5:three_hits_are_one_action |
| `skill_steel_flower_step` | `verb_dodge` | default:capoeira_worlds | rank5:iframe_220ms |
| `skill_steel_ward_cut` | `verb_1h_slash` | weapon:wpn_1h_sunder_wardblade_or_court_flower | boss:mon_boss_held_curse refused |
| `skill_steel_curse_fold` | `verb_2h_heavy` | weapon:2h_or_cursefold_focus | boss:held_curse_refused |
| `skill_steel_reed` | `verb_polearm_thrust` | weapon:polearm | rank5:reach_2.8m |
| `skill_steel_salt_draw` | `verb_bow_release` | weapon:bow | rank5:draw_faster |
| `skill_steel_lantern` | `verb_thrown` | item:lantern | rank5:flame_persists_4s |
| `skill_steel_invoice` | `verb_1h_thrust` | weapon:1h_coast_or_tile | rank5:heat_+0.05 |
| `skill_steel_pulse` | `verb_1h_slash` | weapon:pulse | boss:census_refused |
| `skill_steel_dust_kick` | `verb_unarmed_heavy` | default:frontier | rank5:curtain_2.5s |
| `skill_steel_mercy` | `verb_2h_heavy` | weapon:dawn_maul_or_orb | boss:refused_final_blow |
| `skill_steel_unburial` | `verb_2h_heavy` | weapon:wpn_2h_ruins_unburial | boss:page_closed |
| `skill_steel_parry` | `verb_parry` | default:any_combat | rank5:perfect_parry_riposte_tag |
| `skill_steel_shard` | `verb_thrown` | item:shard | rank5:split_tracks_a_second_target_manually |

## Presence (14)

| AbilityId | Verb | Rank 1 | Rank 5 |
| --- | --- | --- | --- |
| `skill_presence_hail` | `verb_social_hail` | default:all | rank5:hail_pulls_a_schedule_pause |
| `skill_presence_witness` | `verb_social_mark` | quest:first_witness | rank5:heat_decays_slower |
| `skill_presence_gossip` | `verb_social_gossip` | default:after_first_kill_memory | rank5:two_events_not_one |
| `skill_presence_flower_law` | `verb_interact` | default:hub | rank5:allies_in_radius_also_flower |
| `skill_presence_refuse_count` | `verb_cast_release` | quest:nyx_or_zero | rank5:duration_12s |
| `skill_presence_do_not_reap` | `verb_cast_loop` | default:tunya | rank5:regen_faster |
| `skill_presence_name_holder` | `verb_social_mark` | quest:tessera | rank5:redirect_lasts_two_slams |
| `skill_presence_etiquette` | `verb_social_hail` | quest:seraphine | rank5:refund_a_single_gouged_price |
| `skill_presence_bond` | `verb_social_hail` | default:after_three_hails | rank5:bond_survives_a_world_hop |
| `skill_presence_lament` | `verb_cast_release` | quest:maren_or_keeper | rank5:page_stays_closed |
| `skill_presence_lantern_step` | `verb_interact` | default:hub_night | rank5:lights_a_short_path |
| `skill_presence_bargain` | `verb_social_hail` | default:merchant | rank5:standing_discounts_stack_once |
| `skill_presence_second_hour` | `verb_cast_loop` | quest:lyra | rank5:allies_in_4m |
| `skill_presence_unchosen` | `verb_social_hail` | quest:concordia_pillar | rank5:can_release_a_tamed_hound |

## Craft (15)

| AbilityId | Verb | Rank 1 | Rank 5 |
| --- | --- | --- | --- |
| `skill_craft_forge` | `verb_craft_commit` | station:forge | rank5:tier_up_one_material |
| `skill_craft_kitbash` | `verb_craft_commit` | craft:forge_rank2 | rank5:keep_both_palettes |
| `skill_craft_gunsmith` | `verb_craft_commit` | station:vise | rank5:parts_quality |
| `skill_craft_wagon` | `verb_interact` | prop:wagon | rank5:cargo_container |
| `skill_craft_graft` | `verb_craft_commit` | tool:graft_knife | rank5:living_shaft_bonus |
| `skill_craft_catalogue` | `verb_craft_commit` | station:cairn_or_forge | rank5:staple_holds |
| `skill_craft_splice` | `verb_craft_commit` | prop:junction | rank5:clean_signal |
| `skill_craft_unend` | `verb_cast_release` | quest:lattice | rank5:rewind_blocked_for_allies |
| `skill_craft_quench` | `verb_craft_commit` | station:forge_in_hub | rank5:quench_is_reversible_fast |
| `skill_craft_salvage` | `verb_interact` | default:after_first_break | rank5:rare_plate_chance_up |
| `skill_craft_pollen` | `verb_craft_commit` | craft:graft_rank1 | rank5:two_wads |
| `skill_craft_dress` | `verb_craft_commit` | default:first_plate | rank5:three_sockets_one_action |
| `skill_craft_tack` | `verb_interact` | animal:faun_wagon_horse | rank5:tack_is_cosmetic_plus_cargo |
| `skill_craft_spellwell` | `verb_craft_commit` | station:basin | rank5:two_charges |
| `skill_craft_seal` | `verb_interact` | default:first_container | rank5:seal_shows_your_name |

## How a rank is granted

1. Default or station or weapon filter passes.
2. Use-count on that AbilityId (local until a kernel ledger exists).
3. Faction standing from `FactionStandingBook` (not a single world heat float).
4. A quest id or a boss rule on the creature row.
5. The rank-5 tag is the only new tag. It modifies an effect already on the skill.

Respec is a Presence act at the Archive lectern: drop to rank 1, keep the unlock flags, pay nothing that the economy has not defined. Do not invent a currency.
