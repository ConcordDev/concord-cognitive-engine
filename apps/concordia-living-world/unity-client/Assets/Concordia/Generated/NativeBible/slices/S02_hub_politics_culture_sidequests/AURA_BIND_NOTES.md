# Aura bind notes — S02 Hub politics

Bind this facet after Canon guest spawns and after S01's band filters. Guest plates already live in `npcs/HUB_GUESTS_REDESIGN.md`. Reuse them. Do not commission a new turnaround for Elias, Seraphine, Jax, Mama, Nyx, Zero, or the three pillars. Do not download packs. Do not wipe `Library`. Do not re-download pines.

Art for the two roles and the one officer already lives on `npc_role_iron_warden`, `npc_role_court_merchant`, and `npc_role_grid_officer`. CX body, Concordia face, wardrobe on CX sockets. A Quaternius body is a failed bind. Spawn nothing until the CX mesh for that role exists.

## Geography to read, not rebuild

1. Radii from `Canon`: court 16, ring 34, law 42, wall 56. Arena (0, 0, 18), radius 8.
2. Gate holds from `HubPlaza.PlaceGate`: `(cos(angle) * 34, 0, sin(angle) * 34)`. Plaques already exist. This slice adds no arch mesh. The owner call that dropped the wrought-iron gate stays in force.
3. Pillar and guest stands stay on the `GuestDef` coordinates. Do not restage them into a country-scale street grid to literalize "two streets."
4. Uncounted Wharf (`arch_ix_grid_coast`) is Cyber and Crime. No Hub xz. Do not instance the kit, the pipe glue, the sodium lamps, or `hyb_billdrone` for this slice.
5. Pinewood Crossing stays the milepost at city (62, −28). S01 and `q_hub_pinewood_milepost` own that ground.

## Presences

1. `presence_watch_shoulder`: six `npc_role_iron_warden`, only between 42 m and 56 m. Hail, patrol, no bounty camp. Sword is steel on the shoulder. Crossing inside 42 m and outside `InArena` swaps the weapon resolve to `wpn_1h_court_flower` until they leave. They do not enter the inner 16 m and they do not stand on the sand. Leader id for faction UI is `captain_ren_solare`. Do not rename them Gale.
2. `presence_court_stall`: four `npc_role_court_merchant` inside 42 m, outside the Arena disk, outside the triangle of the three pillar stands. Flower at the collar. No steel transaction completes.
3. `enc_hub_count_fails`: spawn one `npc_role_grid_officer` at the Grid gate hold only while `q_hub_slate_at_grid_gate` is active. Height 1.78. Visor down, Concordia jaw visible, long coat, no sentinel shoulders. One step along the spoke toward the origin. On that step, resolve `wpn_1h_grid_pulseblade` as a flower. Apply no health table and drop no loot. Play the carry-back as root and bloom to the membrane, then despawn. A player hit, a sand chase, or a membrane cross fails the quest and despawns the officer without a corpse.
4. `mob_hub_courtesy_press`: only while `q_hub_fan_closed` is on the objection step. Three `npc_role_court_merchant` and two `npc_role_court_labor`. Cap 5. Inside 42 m, off the sand, off the pillar triangle, on the Sundering spoke. No health, no loot. Despawn back to ordinary work when the fan quest completes or fails. If either role mesh is missing, spawn none of the five.
5. `mb_hub_unsigned_courier`: one `npc_role_shadow_courier` at planar (−46, 0). Height 1.78. Satchel, soft shoes, no mask. Hail with `verb_social_hail`. Hostile only if the player attacks while the point is outside 42 m. Then capoeira and `wpn_throw_court_lantern`. No loot. If their position enters the 42 m disk and `InArena` is false, resolve the throw as `wpn_1h_court_flower`, end the scuffle, and path them back to (−46, 0). Do not require this fight for `q_hub_eight_cords`. Signing the ninth cord is a fail of the politics, not a reward.

Missing mesh: spawn nothing for that presence. Do not borrow a warden from another pack, a drone, or a beast.

## Quests

Register the ten objects in `POLITICS.json` beside the volume Hub list. Do not edit the ids in `left_in_place`.

Givers and turn-ins are Canon guest ids: `elias`, `seraphine`, `jax`, `mama`, `nyx`, `concord`, `vesper`, `thorne`, `lyra`, `zero`. Maren (`archivist_maren`) receives the three distances and does not turn that quest in. Concord does. Volume's `concordia_first_breath` alias is a different chain. Do not spawn a second Concordia for this measure. Do not swap Lyra Silentchant for `engineer_lyra_brassgate`.

Board lines and gossip fire after turn-in. Skill ids are lookups: `skill_presence_witness`, `skill_presence_etiquette`, `skill_presence_unchosen`, `skill_presence_flower_law`, `skill_presence_refuse_count`, `skill_presence_bargain`, `skill_presence_bond`. `q_hub_no_ninth_line` recognizes `skill_presence_second_hour` and does not grant it. This slice does not mark SkillLattice done. Item ids `item_flower_wreath`, `item_rose_pin`, `item_witness_slate`, and `item_court_bread` already exist in the vendor file. Give the pin as a quest item, not as a second `prop_rose_pin` on Mama's collar. Her collar pin stays. Vesper's loaf is one charity item, not a stack on her ledger.

Distance check on `q_hub_three_distances` uses planar distances between Canon pillar stands, tolerance 0.15 m. A motive string on the filing strikes Maren's line and blocks turn-in. The Sovereign's dialogue stays `…`.

`q_hub_eight_cords` touches eight existing plaques. It does not start eight world quests and does not open the Frontier.

`q_hub_slate_at_grid_gate` may speak the words Uncounted Wharf once in Nyx's offer. The objective target is `gate_grid_plaque`. There is no wharf reach-location. `q_hub_blank_count` uses the same plaque and must not spawn the officer. Handing the scratched slate to Zero fails both quests.

`q_hub_two_books` reaches one `presence_court_stall` and the Dawn plaque at (0, −34). It does not draw a Market Well polygon.

`q_hub_held_inward` reaches (0, 34) and (−24.04, 24.04) and returns to (12.8, −14.5). It does not path to Upper Grove (−70, 36).

`q_hub_no_ninth_line` stays inside the 16 m court for the pillar circuit. Lyra's own stand is (5.5, 14.8). The staff stays `wpn_focus_lyra_staff`.

## Do not bind

- Any `mon_boss_*`, any health bar inside 42 m, any Arena invasion. The shoulder scuffle is the only armed mini-boss, and only past the lip.
- `hyb_billdrone`, coast labor, coast bandits, Grid sentinels, or neon banners in the plaza.
- A new faction id for Crimson Court, Syndicate, Anti-Sovereign, Luminary, shadow network, or Census Authority on the Hub row list.
- A Founding Day replay, a ninth Refusal lesson, a genealogy prop, or a southern-arc vote.
- S01 fauna caps, including a pigeon tally.
- Vinewood lettering, or any rename of Pinewood Crossing.
- Romance staging for Concord and Concordia. No confession line.
