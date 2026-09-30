# Aura bind notes — S24

Bind the anthology as text on people who already spawn from `Canon.HubGuests` and `Canon.Pillars`. Do not spawn a second copy. Do not replace a GuestDef coordinate. Do not load a Quaternius body, an elf skeleton, a vampire mesh, a plasma skin, a holographic coat, a screen-clone, a diagnostic cradle, a scythe, or a firearm.

Heights, colors, and stands are copied from `Canon.cs`. Plate costume is `native-bible/npcs/HUB_GUESTS_REDESIGN.md`. Where a spoke sheet disagrees, the plate wins the body and the sheet survives only as backstory text.

## Giver ids

These are the bind keys. Turn-in guest id matches giver guest id.

| quest | giver_guest_id | canon npc id, if any |
| --- | --- | --- |
| `q_s24_two_unnamed` | `lamplighter` | — |
| `q_s24_hours_unsaid` | `elias` | `enforcer_elias` |
| `q_s24_uncollected` | `vesper` | `luminary_vesper` |
| `q_s24_rule_holds` | `seraphine` | `seraphine_voss` |
| `q_s24_unsigned` | `jax` | `jax_rivera` |
| `q_s24_yearly_unopened` | `mama` | `mama_delgado` |
| `q_s24_no_number` | `zero` | `zero_nakamura` |
| `q_s24_one_scratch` | `nyx` | `nyx_torres` |
| `q_s24_grove_by_night` | `thorne` | `thorne_blackroot` |
| `q_s24_pockets_same` | `lyra` | — |
| `q_s24_disk_lip` | `warden` | — |
| `q_s24_the_pause` | `asbir` | `lord_curator_asbir_thelane` |
| `q_s24_ellipsis_filed` | `archivist_maren` | — |
| `q_s24_stand_still` | `brackish` | `child_mira_brackish` |
| `q_s24_one_paver` | `oldseam` | `preacher_old_seam` |
| `q_s24_not_a_tide` | `concordia` | — |
| `q_s24_no_fourth_mark` | `concord` | — |
| `q_s24_three_dots` | `sovereign` | — |

`q_s24_three_dots` succeeds only if the spoken line is exactly the three-dot ellipsis already on the GuestDef. A longer generated line is a failed bind, not a richer one.

Vesper's lines use the name and no pronoun.

Brackish is eleven, she, height 1.42, sheet id `child_mira_brackish`, display name Brackish. Do not age her up. Do not call her Mira. Do not route her lines to `elder_mira_lattice`. Do not put her in a fight. Do not write a romance flag.

Each quest carries `lines.offer` and `lines.close`. Bind those strings. `q_s24_three_dots` uses the three-dot ellipsis for both. `q_s24_yearly_unopened` may say Seraphine and may say cousin. It may not read the letter or decide the joke is blood.

## Flower Law

Inside 42 m, off the Arena disk, every blade is a flower. Gale's estoc is steel only while the player is inside 8 m of (0, 18). At (9, 18) it is a flower. That point is derived from the disk. It is not a new landmark to dress.

Thorne's walk to Upper Grove (−70, 36) leaves the disk. Steel is legal there. The quest still does not draw. Do not spawn a grove camp.

Jax's walk to Three Refusals Tavern (−48, −58) leaves the disk. Do not spawn a contract-giver, an interior, or a gun.

Do not retune S01 caps. Do not spawn `plaza_strider`, `cistern_lurker`, `hyb_saltwyrm`, or a pigeon as a combatant. Do not arm `enc_hub_count_fails` for these quests. That officer belongs to `q_hub_slate_at_grid_gate`.

## Props already specified

Lantern and brass rod. Closed wooden fan. Eight cords. Rose pin and a flower, knife undrawn. Ground-off serial pendant. Count slate. Wrapped hands. Wood staff. Open helm, plate, estoc on sand only. Three notebooks in a case. One book and a chain. Oversized shirt. Needle, cord, one cracked paver. Wilted real flowers, open hands. Chalk-ruined plain clothes, cord or folded rod. Dark coat, back turned.

Do not add a second prop to make the silhouette read. One prop taller or brighter than the torso is the plate rule.

## Do not load

- A root-and-bloom tide as a creature or a boss.
- A health bar on Concordia, Concord, or the Sovereign.
- The phrase that Concord admits he loves her, in captions, barks, or board lines.
- A status flag for being noticed by the Sovereign.
- The sealed genealogy's verdict, the ancestor's first name, Iyatte's cavity, Asbir's wife's name, Mira Lattice's wife's name, Brackish's parents, the Lamplighter's partner, the three Year 38 embassies, Nyx's children, Jax's liaison, the contents of Mama's yearly letter. Seraphine as the addressee is already public on the Coast. The joke is not.
- Skill grants. These hooks give xp only.
- Meshes, catalog rewrites, Library wipes, pine downloads.

## Filing checks

Maren rejects a supplied name on `q_s24_two_unnamed`, an opened letter or a second cousin on `q_s24_yearly_unopened`, and a motive clause on `q_s24_ellipsis_filed`.

Asbir rejects a Dawn fact offered as a Court fact on `q_s24_hours_unsaid`, and rejects a wife's name on `q_s24_the_pause`.

`q_s24_pockets_same` checks inventory count before and after. A delta other than 0 fails. No coin item is created to make the check possible.

`q_s24_stand_still` fails if the player's planar speed stays above a walk while she is delivering the sentence, or if the dialogue asks her age to increase.
