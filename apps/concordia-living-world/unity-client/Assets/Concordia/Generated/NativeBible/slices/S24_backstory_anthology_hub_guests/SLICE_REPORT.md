# SLICE REPORT — S24_backstory_anthology_hub_guests

STATUS: COMPLETE

Revision: cycle 2. The cycle-1 anthology was already on disk. This pass keeps the same eighteen people and the same eighteen quest ids. It corrects three canon slips and adds an offer line and a close line on every hook.

World: Hub. Facet: backstory. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity, Concord, or Claude process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Eighteen stands, eighteen hooks, animals left to S01 |
| ANTHOLOGY.json | Primary: backstories, unsaid facts, giver ids, objectives |
| STORIES.md | The eighteen remainders, and why there is no boss |
| AURA_BIND_NOTES.md | Plate over sheet, flower-law resolution, filing checks |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S24_backstory_anthology_hub_guests/`.

## Counts

- HubGuests with a backstory and a hook: 15.
- Pillars with a backstory and a hook: 3.
- New guest ids: 0. New pillar ids: 0.
- Side quests: 18. All `q_s24_*`. Giver id equals turn-in id. Each has `lines.offer` and `lines.close`.
- Rewards: xp only (25, 30, 35, or 40). Coin 0. Items none. Skills none. Faction deltas none.
- Creatures added: 0. Mobs added: 0. Mini-bosses: 0. Bosses: 0.
- Coordinates invented as landmarks: 0. One derived lip, (9, 18), sits 9 m east of Arena center so the 8 m disk can be stepped off.

## Law placement

Flower Law stays 42 m. Gale's steel is live only inside 8 m of (0, 18). At (9, 18) the same blade is a flower. Thorne may legally carry steel at Upper Grove (−70, 36) and does not draw. Jax may legally carry steel at Three Refusals Tavern (−48, −58) and does not draw, and does not bring a firearm. Pinewood Crossing stays (62, −28) and is not an objective. Broken Spire is not an objective.

## Cycle-2 corrections

The yearly letter is not to an unnamed cousin. `lore_voss_envoy` already says Mama and Lady Seraphine Voss correspond as cousins, and neither has explained the joke. `q_s24_yearly_unopened` may name Seraphine. It still fails if the letter is opened, if a different cousin is invented, or if the joke is settled as blood. Seraphine's rule-with-Thorne hook is not this letter.

`child_mira_brackish` is an id. The name is Brackish. Mira Lattice (`elder_mira_lattice`) is Speaker of the Assembly. Calling the child Mira, or routing her line to the Speaker, fails `q_s24_stand_still`.

Year 89 has two widows in the sources. Lore says the Curator lost a wife. The Speaker's sheet says she lost her wife, and she is alive, so the losses are not one marriage. Neither name is spoken. The Lattice Correspondence is described as fifteen years, headed Year −15 to Year 91, and Asbir has been Lord Curator nineteen years. `q_s24_the_pause` does not pick a duration.

`nesha_seam_01_pattern`, `nesha_seam_02_history`, and `nesha_seam_03_mediate` stay in `left_in_place`. The paver hook does not perform the mediation and does not cancel it.

The salt wyrm remains S01's one ditch animal. No boss, mini-boss, or mob was added in either cycle. `ember_sprite` stays on the Training Hollow fight.

## What was not redone

Volume Hub quests, S01's four ecology quests and caps, S02's six politics quests, and S22's four companion errands stay in `left_in_place`. The new hooks are the unsaid facts those slices named and did not spend: the second lamplighter, the Dawn's seventy-two hours, Vesper's uncollected half, the unwritten rule, an unsigned tavern offer, a yearly unopened letter, a gap with no number, one scratch, the night grove, pockets unchanged, the disk's lip, Asbir's pause, an unglossed ellipsis, a sentence heard standing still, one paver, a tide that is not raised, a slate with no fourth mark, and three dots.

## Sheet corrections recorded, not patched

Thorne's sheet body is an elf. The plate wins: CX, wrapped hands, no glow.

Seraphine's sheet is a vampire with a singing rapier. The plate wins: CX, closed wooden fan.

Vesper's sheet uses he and a plasma coat. The plate uses she and a worn pale coat. Lines use the name and no pronoun.

Elias's sheet is a masked heavy with purple veins. The plate is a dark coat and ink. The seventy-two hours stay unsaid, not worn.

Zero's sheet is an upload with clones. The Court body is the standing man. The cradle is not spawned.

Nyx's EMP, Jax's marksmanship, and Mama's shotgun do not cross. Firearm coverage stays zero.

Brackish's plate says "him" once. The sheet says she, eleven. This slice follows the sheet.

Old Seam's guest title is the lantern-path mender. The sheet title is preacher. Both jobs, one person.

Maren, Gale, Lyra, the Lamplighter, and the three pillars have no npc-sheet biography. None was invented past the lore events and the guest lines.

## Honesty gaps

- `hub_archive_audience_chamber` and the other schedule rooms in the npc sheets have no metres in `Canon.cs`. Quests use GuestDef stands and two city coordinates from `cities.json`. No room coordinate was fabricated.
- Upper Grove and Three Refusals Tavern are `status: stub` in `cities.json`. The walks use the published xz and do not author an interior.
- (9, 18) is arithmetic on the Arena disk, not a surveyed cobble. A binder should test planar distance to (0, 18) as greater than 8, not snap to a tile that falls back inside.
- Asbir's wife and Mira Lattice's wife, the Lamplighter's partner, the Year 38 embassies, the Voss ancestor, Jax's liaison, Nyx's children, the three adults, Brackish's parents, and the previous Oracle are unnamed in the sources. They stay unnamed. Mama's yearly addressee is Seraphine. The letter's contents stay unnamed.
- The Sovereign's successful line is the ellipsis. A binder that trims punctuation or expands silence into prose will fail `q_s24_three_dots` on purpose.
- No live play session was run. This slice is text. Guest coordinates were copied from `Canon.cs`.

## Sources read

`Canon.cs` WorldId, gates, HubGuests, Pillars, Hub law, Arena. `concordia-hub/lore.json`, `npcs.json` (Asbir, Brackish, Old Seam, Mira Lattice), `cities.json`, `creatures.json`, `quests/nesha-old-seam.json`. Spoke sheets for Elias, Vesper, Seraphine, Thorne, Jax, Mama, Zero, Nyx. `crime/lore.json` `lore_voss_envoy`. Fantasy lore for the three refusals. Native bible guest plate, art direction, bind schema. Volume quest catalog. S01 ecology, S02 politics, S22 cast boundary.
