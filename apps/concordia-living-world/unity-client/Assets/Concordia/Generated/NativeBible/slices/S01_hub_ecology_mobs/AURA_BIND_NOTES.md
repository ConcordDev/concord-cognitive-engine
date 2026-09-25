# Aura bind notes — S01 Hub ecology

Bind this facet after the Hub block of `volume/DENSITY_TABLES.json` (VB4 step 1: pigeons, moths at dusk, one urn, one milepost outside). This slice adds caps, band filters, and four quests. It does not replace the weight row.

Art prompts already live on the creature rows and in `aura/PROMPTS_INDEX.json` for `faun_court_pigeon`, `faun_court_cat`, `faun_lantern_moth`, `faun_saltroad_hare`, `faun_pinewood_stag`, `faun_wagon_horse`, and `hyb_saltwyrm`. Reuse those. Do not commission a new sheet for this slice. Do not download packs. Do not wipe `Library`.

## Spawn order

1. Band filters from `ECOLOGY.json` `bands`, using `Canon.HubLawRadius` (42), `Canon.WallRadius` (56), `Canon.InArena` (Arena at (0, 0, 18), radius 8), and Pinewood Crossing at city (62, −28).
2. `faun_court_pigeon` on roofs inside the law. Overhead arc may cross the Arena with collision off. Landed cap on the sand is 0. Gatehouse roof past 42 m and inside the wall: 2. Past the wall: 0. Night perched cap 4. Founding Day reading hour cap 24, then back.
3. `faun_lantern_moth` only at dusk and night, only inside lantern radii, only inside 42 m, never the Arena rack. Cap 24. Southern quarter of the civic posts caps at 6 of that 24. Alias `lamplighter_moth` must not create a second species. If both ids are in a spawner list, keep `faun_lantern_moth`.
4. `faun_court_cat` at market crates and archive steps, cap 3, player aggro off. Map `verb_fauna_pounce_mouse` to vermin. The bible `hostile: true` flag is the pounce, not a plaza fight. A player hit inside the flower disk uses the flower override and applies no health table.
5. `faun_saltroad_hare` from 42 m outward. Ambient inside the disk stays 0 except the single quest stray in `q_hub_hare_empty_hands`, which despawns on success, fail, or abandon.
6. `faun_pinewood_stag` only past the wall, cap 5, day. Group size 4 or 5. Never the plaza, never the sand.
7. `faun_wagon_horse` cap 2 at the hitch outside 42 m. Lead or stand. No seated camera. Do not attach Orin's exhausted-mount secret to these two.
8. `hyb_saltwyrm` cap 1 in the milepost ditch. `plaza_forbid` stays true. Also exclude `InArena`. Spit that intersects the 42 m disk becomes flower-crust and does not apply `salt_slow`. Do not raise `hostile` in `HYBRIDS.json`. The ditch encounter calls `verb_hyb_salt_spit`.

Missing mesh on any row: spawn nothing for that row. Do not borrow gull, wolf, elk, horse, lattice moth, sealie, flamingo, or a CX body. Quaternius and Kenney are not fauna meshes. Clips may retarget later onto a native mesh that does not yet exist. Until the mesh exists, the milepost and the ditch quests already have an unspawned success.

## Hit resolution

Inside the flower disk and outside the Arena, fauna take the flower, then bolt or resettle. Do not apply damage and a flower. On the Arena, spawn no fauna, so steel never has an animal target. Past 42 m, steel is live and these animals still prefer flight. The wyrm is the exception that spits. The stag's antler shove is aimed at a horse or the wyrm, not at a player bounty.

Loot hooks `meat_small`, `hide_salt`, `antler_pine`, and `brine_crystal` stay table names. No hunt in this slice pays them out. Do not invent hit points. Health remains `table:faun_critter`, `table:faun_small`, `table:faun_large_prey`, `table:faun_mount`, or `table:mon_skirmisher` as already written on the rows.

## Quests

Register the four objects in `ECOLOGY.json` `quests` beside the volume Hub list. Do not edit `q_hub_pinewood_milepost`, `q_hub_flower_urn`, `q_hub_lamplighter_round`, `q_hub_three_notebooks`, or `first_cycle_fight`.

Givers are existing people: guest `lamplighter`, guest `archivist_maren`, guest `asbir` (canon `lord_curator_asbir_thelane`), canon `ranger_kiren_owl`. Turn-in matches the JSON. Board lines fire after turn-in. `q_hub_ditch_spit` requires the milepost quest. The collar-broken branch turns the quest in and zeros the Watch delta.

`q_hub_moth_count` follows `speech_rule` in the quest object. Spawn the Lamplighter for it only when `q_hub_lamplighter_round` is neither accepted nor complete, and then do not also start that round as a second meeting. Otherwise leave chalk on `eastern_path_first_post` and do not spawn him. Maren remains the turn-in either way.

Skill ids cited (`skill_presence_witness`, `skill_presence_flower_law`, `skill_presence_lantern_step`) are lookups into the skill bible. This slice does not mark SkillLattice done.

## Do not bind

- Any `mon_boss_*`, any mini-boss, any Arena fauna wave.
- `plaza_strider`, `cistern_lurker`, a second moth, `ember_sprite` as plaza decor.
- `mon_road_watcher` in Hub. The taxonomy leaves Hub off that row.
- A pigeon census prop, a clipboard count, a Grid overhead number on the flock.
- Vinewood lettering, or any rename of Pinewood Crossing.
- Humanoid mobs. The Court's people are already CX guests and roles in other files.

## Suggested check

Stand at the urn, inside 16 m: pigeons and, after dusk, moths, and a cat if the market wedge is in view. No hare, no stag, no horse, no wyrm. Step onto the sand: no animals landed. Walk past 42 m: hares on the shoulder, horses only at the hitch. Past 56 m toward Pinewood: stag group if the mesh exists, one wyrm at the ditch, the milepost still reading Pinewood Crossing. Swing once at a pigeon in the Court and confirm a flower and a startle, and no health drop.
