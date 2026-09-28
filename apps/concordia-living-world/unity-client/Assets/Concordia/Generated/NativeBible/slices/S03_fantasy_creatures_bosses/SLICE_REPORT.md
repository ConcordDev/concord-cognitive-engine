# SLICE REPORT — S03_fantasy_creatures_bosses

STATUS: COMPLETE

World: Fantasy (The Sundering). Facet: creatures_bosses. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Caps, mini-bosses, boss, quests, unspawned seeds |
| CREATURES.json | Primary: 8 creature rows, 3 mini-bosses, 1 boss, 4 side quests, 5 quiet seeds |
| STORIES.md | Law essay, creature stories, four quest backstories |
| AURA_BIND_NOTES.md | Bind order, seam rules, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S03_fantasy_creatures_bosses/`.

## Counts

- Creature rows: 8 (`faun_sunder_wolf`, `faun_ash_wolf`, `faun_dust_wolf`, `faun_wardwood_boar`, `faun_cursefold_owl`, `faun_blackroot_elk`, `faun_grove_finch`, `faun_pinewood_stag`).
- Dome wolf alive cap in Fantasy: 0. Ash wolf Fantasy-side cap: 4, NE margin only. Pine wolf: one pack, cap 6. Stag cap added: 0.
- Mini-bosses: 3. `enc_fold_basilisk` (existing clock, law deepened), `enc_ashfang_seam` (new window, existing `hyb_ashfang` body, count 2), `enc_cursebeak_lip` (new window, existing `hyb_cursebeak` body, count 1).
- Boss: 1, `mon_boss_held_curse` on the existing `enc_held_curse` clock. No adds. Refuse tag unchanged.
- Side quests: 4, givers already in canon or in the ward role budget. Hidden truth of the root curse withheld.
- Volume weights and the three published encounter clocks: cited, not edited.
- Prior Fantasy quests left in place: `fantasy_maeris_02_steps`, `q_fantasy_held_offer`, `q_fantasy_boar_off_path`, `q_fantasy_quench`, `q_fantasy_elk_calf`, `q_fantasy_lacquer_box`, `q_fantasy_basilisk_scout`, `q_fantasy_moonleaf`.

## Law placement

Hostility turns inward. The basilisk offers stillness, the cursebeak offers one peck, the ashfang pair offers a plate, and the Held Curse offers the win. Taking any of the three small offers fails that fight as a story and does not stamp `boss:held_curse_refused`. Rank 5 of `skill_steel_curse_fold` still unlocks only on the boss refuse, which `q_fantasy_held_offer` already witnesses. Gold in the wyrm's cracks is the same gold `q_fantasy_quench` rejects in a blade. The Sundering lane stays clear. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28).

## Honesty gaps

- Three near hills are inside the 56 m wall and are not stands: `CourtWalkHill_Near_0` at 72° / 48 m (its one +4.2 m shift still blocks the stride), `Near_1` at 90° / 52 m (unshifted, 13 m skirt covers the lane), `Near_2` at 108° / 50 m. `CourtWalkHill_Mid_1` at 90° / 128 m is outside the wall and still blocks after its one +5.5 m shift (origin ends at x = 5.5). Ambient bodies use the other hill origins, at the origin, not on a skirt. Ash stands require x ≥ 28 and a center outside 56 m on the pad at (28, 70). Caps did not change.
- S04 anchors are not fauna floors: pantheon temple (14.24, 23.34), wildwood gate (−29.55, 37.82, one ward inside the budget of 5), salt toll (62, −20, 8 m north of the post, one CX bandit). S04 quests, faction rows, and clocks were not edited.
- `thorn_wolf`, `mana_drake`, `bone_sentinel`, `gloom_stalker`, and `crystal_elemental` remain Canon seeds with no taxonomy id. Unspawned on purpose. Closing them would be a taxonomy change, which this slice does not make. Their seed damage numbers were not copied in as live stats.
- Fold shrine, blackroot road, Quiet Grove, Thornwood hall, and the bog have lore names and kit set names, and no point in `Canon.cs`. Until a set is placed, its creatures spawn nothing. The north hills are not a substitute floor for the wyrm.
- `hyb_ashfang` and `hyb_cursebeak` are `hostile: false` in `HYBRIDS.json`. The new windows set aggro inside the circle after the telegraph, without editing those files.
- `faun_dust_wolf` is a Frontier subspecies of the same skeleton. This Fantasy slice gives it a story and a cap of zero. It does not retune Frontier density and does not escort one across the Court.
- `faun_ash_wolf` home is Ruins. The Fantasy-side cap is the NE margin only. Ruins weights were not edited.
- King Aldous Ferrowyn IV (lore) and Queen Morwen (faction sheet, heir born without scales) both stand. This slice does not settle the throne and does not bind the wyrm to either.
- Velora's contingency and the apprentice behind `lore_root_curse` stay on their sheets. `q_s03_inward_howl` does not speak them.
- Health, damage, and loot stay table names already on the bible rows. No live numbers were invented.
- `skill_steel_curse_fold` names a flamethrower prefab as an existing VFX. The bind note points at `cue_curse_fold` instead. The skill file was not edited.
- `enc_milepost_fold` was not re-phased. The griffin stays on the Fantasy side of the Pinewood seam.
- S01 owns the stag cap. S02 owns Hub politics. S04 will own Sundering geography and politics beyond what these animals require. Those files were not rewritten.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` WorldId order, Fantasy WorldDef, gate angles, Sundering lane, `BlocksSunderingWalk`, wall 56 m, Hub law 42 m, guests `thorne` and `seraphine`. `CourtWalkableHorizon.cs` hill tables, remeasured so three near hills inside the wall and `Mid_1` stay empty. Fantasy `lore.json`, `creatures.json`, `factions.json`, `npcs.json`. Native bible art direction, taxonomy, animal and monster and hybrid rows, volume density, volume bosses, volume Fantasy quests, skill curse-fold, architecture kit `arch_kit_fantasy_sunder`. Art style guide WorldId map. Prior slices S01 and S02, read so this facet would not retune their caps or their quests. S04, read so its temple, wildwood gate, salt toll, and quests stay where that slice put them.
