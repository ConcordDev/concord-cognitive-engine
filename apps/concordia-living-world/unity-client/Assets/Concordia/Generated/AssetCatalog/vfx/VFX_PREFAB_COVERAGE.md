# VFX prefab coverage (B28)

B11 still has one prompt row per skill. `skills/SKILLS.json` still names a Gabriel Aguiar prefab on each `VfxCue`. This sheet says which of those paths Aura may keep, and which eleven shapes the prefab cannot be. Do not delete the B11 rows. Do not generate the refused prefab as the cue.

Pack root: `Assets/GabrielAguiarProductions/FreeQuickEffectsVol1/Prefabs/`.

## New concept rows

| id | Replaces | Parents |
| --- | --- | --- |
| `vfx_hub_flower_quench` | `vfx_Heal_02` | `skill_craft_quench` |
| `vfx_hub_cut_flower` | `vfx_Heal_02` | `skill_steel_flower_step`, `skill_presence_flower_law`; Ward Cut under Flower Law |
| `vfx_cyber_number_break` | `vfx_Lightning_01` | `skill_steel_pulse`, `skill_presence_refuse_count` |
| `vfx_crucible_unclosed_seam` | `vfx_Heal_02` | `skill_craft_unend`, the gap of `skill_steel_shard`, Gap Bracket tint, four B27 open tools on hit |
| `vfx_ruins_ash_page` | `vfx_Smoke_01` | `skill_presence_lament` |
| `vfx_tunya_pollen_stance` | `vfx_Heal_02` and `vfx_Smoke_01` | `skill_presence_do_not_reap`, `skill_craft_pollen`, reed tip of `skill_steel_reed` |
| `vfx_fantasy_curse_fold` | `vfx_Flamethrower_01` | `skill_steel_curse_fold` |
| `vfx_dawn_mercy_stop` | `vfx_Lightning_01` | `skill_steel_mercy` |
| `vfx_sere_coal_dark` | flame and smoke prefabs | `wpn_focus_sere_woundcoal` |
| `vfx_crime_chalk_tick` | `vfx_Impact_01` | `skill_presence_witness` |
| `vfx_hub_flame_pool` | `vfx_Flamethrower_01` | `skill_steel_lantern` only |

## Keep the named prefab

One-shot `vfx_Impact_01`: Court Palm, Collective Shoulder, Archive Chain, Salt Draw chip (the arrow stays a mesh), the Invoice thrust tick, Poise Answer, Kitbash, Clear the Vise, Take the Plate, Seat the Plate, Seal the Container, the ash mallet. Ward Cut steel uses the ground wedge. Splice uses the bead. Shard Cast uses Impact twice for the two hits. Forge Commit uses Impact at the hammer, not the flamethrower jet.

One-shot `vfx_Smoke_01`: Unburial contact puff only. The windup is the ash stop. No column.

`vfx_Shockwave_01` stays off Dust Kick. The dust fan is the cue. A dome read is a reject.

## Spawn nothing from the pack

The B11 line is "None", or the cue is already a prop or a clip.

- Carry the Rumor, Smile When You Object, Keep a Bond, The Price, You Cannot Own the Heart. Hail spawns the mote only at Court night inside 42 m. Day and every other world spawn nothing.
- Wagon Lash and Set the Tack. The strap and the harness are the cue. No shockwave dome. Camera stays on foot.
- Graft. Cloth wrap. No heal burst.
- Mend the Record. One Impact tick for the staple. No smoke column.
- Spellwell. The basin mesh moves. The charge is the well seat. No sky pillar and no heal blob.
- Name the Holder. The tile and the furnace eye. Not coal, not smoke.
- Second Hour. Do not spawn Heal. A still dust column is ambient kit dust, not a new sheet.
- Lantern Step. The bracket lantern mesh. Not the ground pool and not a jet.
- Gunsmith. No muzzle flash. `Pistol_*` stays unbound.

## B27 and bosses

- Sinew bow stays holstered. No release trail.
- Glass disc has no throw clip. No disc trail.
- Mercy baton is Impact, not the gold stop ring.
- Gap Lion `boss.tell` is the shoulder ring on the mesh. No extra card.
- Gap Bracket uses `vfx_crucible_unclosed_seam` with lilac `#c8b4ff` inside the gap. The gap stays open. Construct cap stays 0.
- Dawn street strikes stay `Punch_Jab` and `Punch_Cross` with Impact. Empty hands. No mercy ring on those mobs.
- Blue contact on Dawn is not Lightning_01 and not this stop ring.

## Cycle 2 — still the wrong prefab

The first eleven cards stay. These eight are tells the pack still cannot be. B11 rows stay.

| id | Replaces as the tell | Parents |
| --- | --- | --- |
| `vfx_steel_ground_wedge` | `vfx_Impact_01` on a slash | `skill_steel_ward_cut` when the hit is steel; Court steel skins of the thorn pin, bud staff, and petal rake on arena sand; Ruins slab bar and bone pick |
| `vfx_invoice_ankle_gap` | the tell, not the thrust tick | `skill_steel_invoice` |
| `vfx_frontier_dust_fan` | `vfx_Shockwave_01` | `skill_steel_dust_kick` |
| `vfx_ruins_ash_stop` | the smoke column read | `skill_steel_unburial` windup |
| `vfx_tunya_harvest_ring` | `vfx_Heal_02` on the tree | `skill_presence_do_not_reap` when the tree is the target |
| `vfx_cyber_splice_bead` | `vfx_Lightning_01` | `skill_craft_splice` |
| `vfx_spellwell_seat` | `vfx_Heal_02` | `skill_craft_spellwell` |
| `vfx_hub_hail_mote` | `vfx_Heal_02` | `skill_presence_hail` at night inside 42 m |

Dust Kick no longer keeps the shockwave. A clamped ring still reads as a shield, and the skill refuses a dome. The fan is ankle height and lateral. Frontier gossip dust still spawns no mesh. Second Hour stays ambient kit dust.

Ward Cut inside the 42 m disk stays `vfx_hub_cut_flower`. The wedge is the steel slash. The ash mallet, palm, shoulder, chain, parry, kitbash, vise, salvage, dress, and seal stay Impact. Invoice keeps Impact for the thrust tick. The ankle ring is the step-out tell: Coast sodium `#e0b050`, Sere eye `#e07030`. It is not the chalk tick and not the mercy ring. The gap stays open.

Unburial may keep a one-shot `vfx_Smoke_01` puff at contact. The puff must not column. The windup is the ash stop. Close the Page stays the ash page.

The harvest ring sits on `flora_tunya_terrace_tree` only. Fruit stays on the tree. The ankle sheet stays `vfx_tunya_pollen_stance`. The splice bead is one steady cyan point. It is not a beam and not the broken token. No digit. The well seat is a chip in the basin. No sky pillar. On the Crucible the gap stays open. Construct cap stays 0. The hail mote is one warm point, Court night, inside 42 m. Day spawns nothing. Other worlds spawn nothing for Hail.

Seam brush, reach rod, and cool cube reuse `vfx_crucible_unclosed_seam` on hit. They do not get a new card. Sere rake, awl, and clinker stay Impact or unbound. The clinker throw stays missing. Dawn plate, pole, and hook stay Impact, not the mercy ring. Seed cup is a hold.

## Laws

Flower Law is the Hub disk of 42 m. Cut flower and flower quench stay inside it. Arena sand, about 8 m around local (0, 18), keeps steel Impact. No rifles. No lettering on the ash page or the broken token. No Vinewood. CX bodies are unchanged.
