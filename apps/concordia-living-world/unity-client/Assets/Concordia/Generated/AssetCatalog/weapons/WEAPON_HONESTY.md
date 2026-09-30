# B27 weapon honesty

Batch `B27_weapons`. Slice A09. Eighteen held meshes. B8 rows stay.

No rifles. `Pistol_*` stays unbound. No stock, no barrel, no trigger on these meshes. No lettering. No Vinewood. No Quaternius body. CX is not a weapon.

## Flower and steel (Court only)

Flower Law is the Hub disk of 42 m. Live steel is not plaza clutter.

| id | Prompt mesh | Steel skin |
| --- | --- | --- |
| wpn_1h_court_petal_sheath | One bloom on a short grip | Same bounds, arena sand only, about 8 m around local (0, 18) |
| wpn_imp_court_pruner | Wood jaws, one petal | Same bounds, arena sand only |

`wpn_1h_court_flower` stays the drawn Court sword. `Sword_Idle` inside the disk. `Sword_Attack` only for the sheath's steel skin on arena sand. The pruner stays down (`Idle_Loop`) inside the disk. Arena heavy is a time-scaled `Sword_Attack`, labeled procedural.

## Thin worlds

| World | Already in B8 | New 100 m read |
| --- | --- | --- |
| Ruins | Wide cleaver, long stylus | Short wedge, long hook, thick chisel, shallow D with no stock |
| Sere | Two-tine fork, square tile | One-tine comma, bent bar, cup and coal, two tongs |
| Superhero | Big maul head, sphere | Short blunt cylinder, flat disc, wedge, long crook |
| Crucible | Jagged shard, open ring | Notched chisel, two blocks and a gap, open V, open C |

Dawn street mobs (alley finisher, arterial kicker, pad grappler) stay empty-handed. Mercy blue is contact VFX. No killing beam. The plaza heart stays empty.

Crucible gaps stay open. Construct cap stays 0. These are held tools. Do not seat them on Rib Frame, Vent Jack, or Gap Bracket.

## Clips

| Kind | Bind |
| --- | --- |
| One-hand edge | `Sword_Attack` |
| Heavy and improvised | procedural: time-scaled `Sword_Attack` |
| Pole | procedural thrust, same fallback |
| Sinew bow | release missing; mesh holstered; do not use `Sword_Attack` as a shot |
| Glass disc | throw missing; do not use `Sword_Attack` as a throw |
| Wound coal | hold only; glow is VFX, no flame mesh |

`softenter_landmark` and `softenter_adjacent` are false.

## Grid gadgets and Crucible tools (A23)

Batch `B27_gadgets`. Eighteen held meshes. B8 Grid weapons stay: pulse blade, count pike, rail bow, cable whip. B27 Crucible tools stay: seam chisel, vent bar, lattice pike, open caliper. The thrown shard and the Un-End ring stay.

No rifles. No stock, no barrel, no trigger on these meshes. No lettering. No digit on a Grid face. No hologram sheet. No Vinewood. No Quaternius body. CX is not a weapon. Flower Law stays the Hub disk of 42 m and does not cover these rows.

| id | World | 100 m read |
| --- | --- | --- |
| wpn_imp_grid_fiberspool | Cyber | short fat cylinder, one groove |
| wpn_imp_grid_cornerbar | Cyber | short L |
| wpn_imp_grid_conduitsnips | Cyber | small open X |
| wpn_focus_grid_crackedloupe | Cyber | ring and a stub |
| wpn_throw_grid_blankpuck | Cyber | flat blank disc |
| wpn_imp_grid_openclamp | Cyber | C and a knob |
| wpn_imp_grid_nestedrod | Cyber | short stack, three shoulders |
| wpn_imp_grid_blankkey | Cyber | blank T |
| wpn_imp_grid_horseshoe | Cyber | open U |
| wpn_focus_grid_tallyclick | Cyber | box and one lever |
| wpn_imp_crucible_seamroller | Crucible | circle with a wedge gone |
| wpn_1h_crucible_driftawl | Crucible | short spike, tip notch |
| wpn_2h_crucible_slagspoon | Crucible | empty bowl, short haft |
| wpn_imp_crucible_openwrench | Crucible | handle and an open jaw |
| wpn_focus_crucible_gapblock | Crucible | two slabs and a slot |
| wpn_imp_crucible_quartzfile | Crucible | flat rectangle |
| wpn_1h_crucible_pinpunch | Crucible | short fat peg |
| wpn_focus_crucible_brokenloop | Crucible | small open O |

Grid rows park in the mid-rise, off the sky floor from (−25.77, −58.0) to (−19.37, −62.8). Named set `sky_bridge` stays unplaced. The bridge runner stays empty-handed. Capoeira stays the empty-hand bias. The census plinth, the blank slate, the drone, and the billdrone stay their own meshes. The nested rod stays collapsed. The clamp jaw and the horseshoe mouth stay open. The tally face stays blank. The puck throw clip is missing.

Crucible rows sit on `arch_kit_crucible_lattice`, outside the named gaps. Gaps stay open. Construct cap stays 0. Do not seat these on Rib Frame, Vent Jack, or Gap Bracket. The slag spoon has no flame. The pin punch is not `prop_cruc_cl_open_pin`. The broken loop is smaller than `wpn_focus_crucible_unend`.

| Kind | Bind |
| --- | --- |
| Drift awl, pin punch | `Sword_Attack` |
| Spool, corner bar, snips, clamp, nested rod, blank key, horseshoe, roller, spoon, wrench, file | procedural: time-scaled `Sword_Attack` |
| Loupe, tally click, gap block, broken loop | hold only |
| Blank puck | throw missing; do not use `Sword_Attack` as a throw |

`softenter_landmark` and `softenter_adjacent` are false. `Pistol_*` stays unbound.

## Cycle 2 thin fill

Sixteen more held meshes on the same batch. The first eighteen stay. B8 stays. B27 gadgets stay. File `batches/B27_weapons_cycle2.json`.

No rifles. No stock, no barrel, no trigger. No lettering. No flame mesh on Sere. No killing beam on Dawn. Crucible gaps stay open. Construct cap stays 0.

| id | world | 100 m read | clip |
| --- | --- | --- | --- |
| wpn_pole_court_budstaff | Hub | long line, one closed bud | Sword_Idle inside 42 m; steel thrust on arena sand |
| wpn_imp_court_petalrake | Hub | short head, three blunt teeth | tool down; steel heavy on arena sand |
| wpn_focus_court_seedcup | Hub | cup and one seed | hold both skins |
| wpn_1h_court_thornpin | Hub | short pin, one thorn | Sword_Idle inside 42 m; Sword_Attack on arena sand |
| wpn_imp_ruins_ashmallet | Ruins | round head, short haft | procedural heavy |
| wpn_2h_ruins_slabbar | Ruins | long flat bar | procedural heavy |
| wpn_1h_ruins_bonepick | Ruins | short L, one point | Sword_Attack |
| wpn_imp_sere_sootrake | Sere | flat lip, no tines | procedural heavy |
| wpn_1h_sere_cinderawl | Sere | short spike | Sword_Attack |
| wpn_throw_sere_clinker | Sere | closed lump | throw missing |
| wpn_focus_dawn_quietplate | Superhero | flat round plate | hold |
| wpn_2h_dawn_stretcherpole | Superhero | long blunt pole | procedural heavy |
| wpn_1h_dawn_padhook | Superhero | short crook | Sword_Attack |
| wpn_imp_crucible_seambrush | Crucible | bristles stop short | procedural heavy |
| wpn_pole_crucible_reachrod | Crucible | ball tip, open ring | procedural thrust |
| wpn_focus_crucible_coolcube | Crucible | cube, open groove | hold |

Court prompts are the flower form. Steel skins share those bounds and sit on arena sand only, about 8 m around local (0, 18). The bud staff is not the petal sheath. The rake is not the pruner. The seed cup is not the lantern. The thorn pin is not the drawn sword.

The ash mallet is not the fossil chisel. The slab bar is not the unburial cleaver. The bone pick is not the stylus. The sinew bow stays holstered.

The soot rake is not the brand hook or the two-tine fork. The cinder awl is not the wound-coal cup. The clinker is not the mark tile. Do not bind `Sword_Attack` as that throw. Sere rows are not Link gates.

The quiet plate is not the glass disc. The stretcher pole is not the mercy maul. The pad hook is not the launch crook. Dawn street mobs stay empty-handed. Mercy blue stays contact VFX.

The brush gap, the reach-rod ring, and the cube groove stay open. Do not seat them on Rib Frame, Vent Jack, or Gap Bracket. Teal stays inside the unfinished gap. Lilac stays inside the Gap Bracket. The reach ring is smaller than the Un-End ring and is not the broken loop.
