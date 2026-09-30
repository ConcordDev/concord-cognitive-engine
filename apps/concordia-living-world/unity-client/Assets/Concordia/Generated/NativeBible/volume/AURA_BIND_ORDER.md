# Aura bind order — volume, after the art bible

Art generation stays `aura/AURA_GENERATION_BATCHES.md` **B0 through B11**. B10 is already props. B11 is already skill cues. Do not renumber those. Volume prompt addendum on that file is **B12–B17** (text only).

This page is the **gameplay bind** for EVERYTHING paste **Phase 7** (`AURA_EVERYTHING_NO_DEFERRAL.txt`: density, all Canon worlds, raids, vendors). Phase 6 already asked for one phased boss, one mount ritual, and companion banter. If those are still thin, bind VB0 before VB1. Do not skip Phase 7's per-world quest once VB0 is in.

Skill rows stay lookups until a rank changes `ActionRunner`. Missing meshes spawn nothing.

## VB0 — Phase 6 leftovers this volume now defines

Do this only where Phase 6 has no live loop yet.

1. `COMPANIONS.json` — bind three first: `comp_brackish` (gossip, not combat), `comp_gale` (parry on sand only), `comp_thorne` (curse folds inward). Intro / mid / postboss flags, no timer banter.
2. `MOUNT_AND_VEHICLE.json` — `mount_wagon_horse` + `veh_salt_wagon` at the Hub hitch **outside** the walls, Pinewood side. Lead ten meters. No seated camera.
3. One raid from `BOSSES_AND_RAIDS.json`: `enc_held_curse`. Board, scout, and sound before the circle. Crest shard only if the offer was refused.

## VB1 — Quests, one live loop per world (Phase 7.1)

File: `QUESTS_BY_WORLD.json`. Paste in this order so Hub memory exists before spokes.

1. Hub: `first_cycle_cook`, then `first_cycle_fight`, then `first_day_claim_land`. Canon files keep their voice lines.
2. Hub side chain, still Phase 7 density of consequence: `q_hub_flower_urn`, `q_hub_pinewood_milepost`.
3. One Canon-backed loop in each spoke, in gate order: Fantasy `fantasy_maeris_02_steps`, Tunya `q_tunya_fruit_not_tree`, Crime `q_crime_bell_tip`, Cyber `q_cyber_packet_tea`, Ruins `q_ruins_wraith_unfinished`, Frontier `q_frontier_hand_to_mira`, Superhero `q_superhero_leave_standing`, Crucible `q_crucible_hear_pact`, Sere `q_sere_open_table`.
4. Remaining rows in the JSON are the depth pass. Do not ship them as an action-button wall. Each one needs a giver, a board line, and a turn-in.

## VB2 — Raid roster (Phase 7.2)

File: `BOSSES_AND_RAIDS.json`. After `enc_held_curse` works, bind the other thirteen as scheduled telegraphs. A board with no fight yet is a legal thin state. A fight with no telegraph is not.

Suggested second and third: `enc_census` (Cyber), `enc_compound_mark` (Sere). They teach "do not fill the number" and "do not sell the ledger" without new meshes.

## VB3 — Vendors (Phase 7.4)

File: `VENDORS_AND_ITEMS.json`.

1. `vend_hub_vesper` loaf and `vend_hub_gale` flower, so standing changes a Hub price and the flower/steel state is visible.
2. `vend_sere_tessera_desk` so `marked` standing raises a price. That is the Mark, not a discount tier copied onto every world.
3. `vend_frontier_wright` tack and pin, with the spoken anim gap.
4. Other stalls after those three slates move units. Remembrance items stay out of default stock.

There is no `content/items` file under Canon today. These ids are the rows to insert when that table is opened. Until then the vendor slate can read this JSON directly.

## VB4 — Density (Phase 7.3 and 7.5)

File: `DENSITY_TABLES.json`.

1. Hub plaza: pigeons, moths at dusk, labor, merchants, one urchin (Brackish, not a pack), lantern posts, one urn, one milepost outside.
2. Tunya sealie only if the native mesh exists.
3. Spoke crowds from `npc_role_*` on the CX body. Budget numbers are caps, not spawn-all.
4. Weight `0` fauna are encounter-only. Do not ambient-spawn bosses.

## VB5 — Rest of the mounts

`mount_terrace_goat` (lead), `mount_wind_pronghorn` (follow, no bridle), `veh_frontier_windwagon`, `veh_grid_rail_dolly`, `veh_wharf_cart`. Push or lead. No gunship. No griffin mount.

## VB6 — Prompt sheets, only if a human asks for pixels

B12–B17 in `aura/AURA_GENERATION_BATCHES.md`. Default remains off. Disk was too tight for images on this pass anyway.

## Stop

- Do not retarget Quaternius over CX.
- Do not mark SkillLattice done from this folder.
- Do not put the Held Curse in the mount list.
- Do not letter Pinewood as anything else.
- Do not wipe `Library` or re-download pines to "make room" for this bind.
