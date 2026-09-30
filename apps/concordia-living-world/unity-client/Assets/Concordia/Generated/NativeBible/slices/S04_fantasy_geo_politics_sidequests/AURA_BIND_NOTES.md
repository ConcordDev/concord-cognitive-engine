# Aura bind notes — S04 Sundering geography

Bind this facet after S03 caps and after the Fantasy block of `volume/DENSITY_TABLES.json`. Do not edit those files. Do not edit `countries.json`, `factions.json`, or the volume quest list. Art direction is the mythical row: weathered granite, moss, timber, gold leaf worn thin, palette `#3a6a48` `#c8b48a` `#6a5438` `#c8a060`. One emissive stitch on a ward or a mystic. No full-body glow. No cel. No Quaternius body. No goblin head mesh. CX plates only. Do not download pines. Do not wipe `Library`. Do not stop Concord, Unity, or Claude.

Kit is `arch_kit_fantasy_sunder`. A Hub court piece may show at the salt-road joint the way the kit file already allows. Do not dress the verge as `arch_kit_ruins_ash` or as a Crime tenement. Do not letter Vinewood.

## Spawn order

1. Leave `Canon.BlocksSunderingWalk` empty. Nothing in this slice gets a collider on x = 11.2 ± 2.6 m, z up to 240. The pantheon temple anchor (14.24, 23.34) is inside that problem. Spawn nothing on it: no Kaelan, no column, no paper prop.
2. Pinewood Crossing stays the Hub post at (62, −28). Fantasy weight for `prop_pine_milepost` stays 0. The grove-side ward is the existing S03 pine-verge guard, one mesh, now also the giver for `q_s04_salt_writ` and `q_s04_one_braid`.
3. `enc_salt_toll` at (62, −20). One `npc_role_road_bandit`. CX, patchwork on the granite-moss palette. No health table. If the role mesh is missing, spawn nothing and do not borrow a wolf, a stag, or a griffin. The quest step waits.
4. Wildwood gate (−29.55, 37.82): one additional `npc_role_sunder_guard`. That is the third of the density budget of 5. He does not patrol into the 42 m disk.
5. The other two guards wait on the `ward_barrack` named set. Until that set exists, spawn nothing. Do not spend them on camp north or the temple point.
6. Mystics: one at `fantasy_bog_crossing` only when that transform exists, and one never, until the Quiet Grove has a real point. Neither is Maeris and neither is Thorne.
7. Kaelan only at (6.24, 29.34). Aria only at (−16.97, −30.61). Corin only at (−21.55, 31.82). Each is one unique. Inside 42 m their steel is a flower. Missing mesh: that quest's giver is absent. Do not put their lines on a guard.
8. Maeris is the existing unique. Do not move her to a new bog coordinate. `q_s04_greenmire_blank` fails closed when `fantasy_bog_crossing` has no transform.
9. League gate (−58.26, −21.21): a board with two marks. No Grokka. No warband bodies. No props at camp north. Camp south is not placed.
10. Do not spawn halls on the Voss gate, the Crown gate, the university gate, the thieves' gate, or the crimson quarter. Those regions are readable and unbuilt.
11. S03 fauna, the three mini-bosses, the Held Curse, and `enc_milepost_fold` keep their caps, clocks, and sides. The toll does not leash the griffin. The stag cap does not rise.

## Hit resolution

Fantasy steel is live outside the Hub disk. Inside 42 m and outside the Arena, a drawn Sundering blade is a flower, including Corin's, Aria's, and any knife at the thieves' gate. Dragging the toll inside the disk flowers the blade and fails `q_s04_salt_writ`. Killing him also fails it. Do not add a damage table to make the fail more real.

No quest grants `skill_steel_curse_fold`, `skill_steel_salt_draw`, or `skill_steel_ward_cut`. Those stay on the grants they already have. `skill_affinity.gun` in meta.json is not a license to put a firearm in a ward's hands.

## Quests

Register the six objects beside the volume Fantasy list and the four S03 quests. Do not edit the ids in `left_in_place` inside `POLITICS.json`.

Board lines and gossip fire after turn-in. Faction reputation numbers on the sheets stay as written. Reward coin is 0. Reward skills are empty.

Hidden text that must not appear in subtitles or board lines: the apprentice who released the curse, the manner of Seraphine's mother's death, the fate of the seven guests, the contents of the vault, Corin's nine-year knowledge, Kaelan's unanswered prayer, the scaleless heir as a fact the player is asked to prove, Iyatte's mirror-children.

## Do not bind

- A mesh on `pantheon_temple_central`.
- A second milepost, a Greenmire village, nineteen memorial stones, a monastery, a keep, a refugee column, a drake, a crypt door, a case folder, a treaty seal.
- Grokka, Velith, Renn, Morwen, or Caelan as ambient crowds. They were not given posts.
- Any retune of S01 stag caps, S02 Hub seats, or S03 creature windows.
- Vinewood lettering. A Quaternius or Kenney body. A generic orc kit standing in for the league.

## Suggested check

Walk the lane from the spawn north: no new collider, including at z ≈ 23 where the temple anchor wants to be. Read Pinewood Crossing and do not find a second post. Talk the toll down without a health bar; draw on him and fail the salt quest; do not find a Thornvale writ in his inventory because he has no inventory. Stand at the pantheon gate and confirm the temple anchor is empty. Stand at the glade and confirm a drawn blade is a flower. Visit the league gate and count two marks, zero bodies, and a post 120 m away that still says Pinewood Crossing. Confirm Aria's gate does not open a vault and Maeris does not gain a village. Search the Fantasy instance for a new boss id and find none.
