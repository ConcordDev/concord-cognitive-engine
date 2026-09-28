# Aura bind notes — S03 Sundering creatures

Bind this facet after the Fantasy block of `volume/DENSITY_TABLES.json` and after `enc_held_curse`, `enc_fold_basilisk`, and `enc_milepost_fold` in `BOSSES_AND_RAIDS.json`. This slice adds caps, seam filters, two new encounter windows, law ties on the existing basilisk and the Held Curse, and four quests. It does not replace weights, clocks, or remembrance items.

Art prompts already live on the creature rows and in `aura/PROMPTS_INDEX.json` for `faun_sunder_wolf`, `faun_ash_wolf`, `faun_dust_wolf`, `faun_wardwood_boar`, `faun_cursefold_owl`, `faun_blackroot_elk`, `faun_grove_finch`, `faun_pinewood_stag`, `mon_sunder_basilisk`, `mon_sunder_griffin`, `mon_boss_held_curse`, `hyb_ashfang`, and `hyb_cursebeak`. Reuse those. Ash and dust are material callouts on the B0 wolf skeleton, not new animals. Do not commission a new sheet. Do not download packs. Do not wipe `Library`.

## Spawn order

1. Keep `Canon.BlocksSunderingWalk` empty. No fauna collider on x = 11.2 ± 2.6 m, z up to 240. Do not use `CourtWalkHill_Near_0`, `Near_1`, `Near_2`, or `Mid_1` as stands. Near_0 and Mid_1 still block after the builder's single shift. Near_1 and Near_2 are inside the 56 m wall.
2. `faun_grove_finch` on legal hill origins, day, cap 12, pine-dust material. Zero on the lane and on the four empty hills. Zero in the Quiet Grove. No Tunya fauna riding along on the northwest pad.
3. `faun_sunder_wolf` one pack, cap 6, dusk–night, either a legal hill origin or wardwood, never both, never the ash margin, never the fold circles. Day visible cap 0.
4. `faun_wardwood_boar` cap 5, day, off the ward path. The existing path herd belongs to `q_fantasy_boar_off_path` only.
5. `faun_ash_wolf` cap 4 on the NE pad where x ≥ 28 and the stand is outside 56 m. The pad's west edge at x = 10 is the lane. Shared rig with the pine wolf. Ruins weights unchanged. They do not share space with the pine pack. Do not put them on the pantheon temple, the wildwood gate, or the salt toll.
6. `faun_dust_wolf` cap 0 for the whole Fantasy instance, quests included. A mis-bind despawns. Frontier weights unchanged.
7. `faun_pinewood_stag` adds 0. S01's cap of 5 on the verge toward (62, −28) is the herd. The post still reads Pinewood Crossing.
8. `faun_cursefold_owl` cap 3 at night on curse-stones outside both circles, and only after `cursefold_shrine` is placed. Until then, spawn nothing. Do not plant stones on the north hills to satisfy the cap.
9. `faun_blackroot_elk` cap 6 adults at dawn on `blackroot_road` only. Calf cap 0. Approach hills stay empty of elk.
10. `enc_fold_basilisk`: one `mon_sunder_basilisk` on the fold floor, volume clock, weight 0 ambient. Overlook stays scout-only.
11. `enc_ashfang_seam`: two `hyb_ashfang` on that same ash stand, after board, scout, and sound. Hours 7–10, every second day. Ambient cap 0 outside the window. Bible `hostile: false` stays in the catalog; this window sets aggro.
12. `enc_cursebeak_lip`: one `hyb_cursebeak` on the lip, hours 15–17, every third day, suppressed on a Held Curse dusk. Not the milepost griffin. Not inside either circle.
13. `enc_milepost_fold`: leave the volume phases. Fantasy side of the Pinewood seam. Do not move the griffin onto the north approach. Do not kite it through the 42 m disk.
14. `mon_boss_held_curse`: one, fold floor, volume clock, no adds. If `cursefold_shrine` has no transform, spawn nothing.

Quiet Grove, Thornwood halls, and the bog steps stay at fauna cap 0. Missing mesh on any row: spawn nothing for that row. Do not borrow fox, horse, crow, stag, sealie, flamingo, a western dragon, or a CX body. Quaternius and Kenney are not fauna meshes. Clips may retarget later onto a native mesh that does not yet exist.

## Hit resolution

Fantasy steel is live. Do not apply Flower Law to a bite on the north shoulder. Do apply it if a body is dragged inside the Hub 42 m disk and outside the Arena: the blade is a flower, the animal is not a legal target, and the kite itself fails `q_s03_not_a_dome_wolf` if that quest is up. Health stays the table already on the row: `table:faun_critter`, `table:faun_small`, `table:faun_med_predator`, `table:faun_med_prey_tough`, `table:faun_large_prey`, `table:mon_brute`, `table:mon_skirmisher`, `table:mon_elite`, `table:boss_region`. No live numbers.

`skill_steel_curse_fold` pays poise and grants `Curse.Inward` for its active window. Gold on the caster shuts as the hit lands. The skill row currently names a flamethrower prefab as an existing VFX path. That picture is the wrong law. Bind `cue_curse_fold`, the dull seam that closes. Do not play the flamethrower as the Held Curse's breath. Outward breath remains the story-fail already on the boss row, not a new damage table.

Mini-boss refuses do not set `boss:held_curse_refused` and do not unlock rank 5. `q_fantasy_held_offer` still owns that witness.

## Quests

Register the four objects in `CREATURES.json` beside the volume Fantasy list. Do not edit `fantasy_maeris_02_steps`, `q_fantasy_held_offer`, `q_fantasy_boar_off_path`, `q_fantasy_quench`, `q_fantasy_elk_calf`, `q_fantasy_lacquer_box`, `q_fantasy_basilisk_scout`, or `q_fantasy_moonleaf`.

Givers who already exist: role `npc_role_sunder_guard` at two posts inside the density budget of 5, guest id `thorne` (sheet `thorne_blackroot`, one person, do not spawn both), and `velora_mossheart`. Turn-in matches the JSON. Board lines fire after turn-in. The ash errand fails if the player damages a catalogue wolf, loots a plate, or enters the ashfang circle. The coat errand fails if a dome wolf is emitted. The grove errand fails if any fauna id spawns inside it. The howl errand fails if a wolf or the boar dies, or if `thorn_wolf` or a vine snare is spawned. No quest grants a skill. Ward cut and curse-fold keep the grants they already have.

Velora's contingency arrow and the root-curse apprentice stay off the dialogue for `q_s03_inward_howl`.

## Do not bind

- `thorn_wolf`, `mana_drake`, `bone_sentinel`, `gloom_stalker`, `crystal_elemental`.
- A humanoid mob of any kind. Bone orchard and the Lit Veil do not receive a skeleton prop from this slice.
- `faun_dust_wolf` anywhere in Fantasy. `faun_ash_wolf` off the NE margin. A second pinewood herd. Elk or the boss on the approach hills.
- Basilisk, cursebeak, or wolves as adds in `enc_held_curse`.
- The Held Curse in the drake aerie, or as Queen Morwen's or King Aldous's mount.
- Vinewood lettering, or any rename of Pinewood Crossing.
- A new wolf skeleton, a new gait, or a gaze-cone on the cursebeak.

## Suggested check

Stand on the lane at x = 11.2 and walk north: no body blocks the stride, including on Near_0 and Mid_1. Step onto a legal hill origin by day: finches, and a boar if the cap is up, and no elk, no basilisk, no wyrm. The three near hills inside the wall stay empty. At dusk: one wolf pack, chevrons, dull amber. On the east margin of the pad near (28, 70): ash coats, same chevron, and nowhere else. Pinewood's post still says Pinewood Crossing, and the stag count does not rise above the Hub cap. Search the whole Fantasy instance for a dome wolf and find none. With the shrine unplaced, fold floor, lip, and boss emit nothing. With the shrine placed, noon brings one basilisk on the floor, mid-afternoon one cursebeak on the lip, dusk the wyrm alone, and the three circles do not overlap. Swing inside the Hub disk at a kited wolf and get a flower, not a pelt. Refuse a plate, a peck, and the crest as three different acts, and confirm only the crest stamps the boss refuse.
