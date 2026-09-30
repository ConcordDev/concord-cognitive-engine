# RIG_HUMANOID_BIPED

**Avatar:** CX Humanoid male/female. **Controller:** `ConcordiaLocomotion`.
**In-place** column feeds the blend tree. **`_RM`** is the root-motion twin for committed moves only.
**Pistol_*** clips are on the UAL1 FBX and stay **unbound**.

`src` is `UAL1` (on disk), `ETHAN` (fallback already in project), `MISSING` (procedural or a later Mixamo/Kevin clip). Do not treat MISSING as shipped.

## Locomotion

| state | src | clip | fallback |
| --- | --- | --- | --- |
| loc.idle | UAL1 | Idle_Loop | secondary breathe |
| loc.walk | UAL1 | Walk_Loop | — |
| loc.walk_formal | UAL1 | Walk_Formal_Loop | SoftEnter civic walk |
| loc.jog | UAL1 | Jog_Fwd_Loop | — |
| loc.sprint | UAL1 | Sprint_Loop | — |
| loc.crouch_idle | UAL1 | Crouch_Idle_Loop | — |
| loc.crouch_fwd | UAL1 | Crouch_Fwd_Loop | — |
| loc.strafe_l | MISSING | — | lean on Walk_Loop, MoveX −1 |
| loc.strafe_r | MISSING | — | lean on Walk_Loop, MoveX +1 |
| loc.turn | ETHAN | WalkTurn / StandTurn | yaw warp until Mixamo turn |

Brackish and other short CX adults: same clips, stride scale by height/1.75. No child skeleton in this matrix.

## Traversal

| state | src | clip | fallback |
| --- | --- | --- | --- |
| trav.jump_start | UAL1 | Jump_Start | RM on commit |
| trav.jump_loop | UAL1 | Jump_Loop | — |
| trav.jump_land | UAL1 | Jump_Land | — |
| trav.dodge_roll | UAL1 | Roll | RM; this is the dodge |
| trav.swim_idle | UAL1 | Swim_Idle_Loop | spoke water only |
| trav.swim_fwd | UAL1 | Swim_Fwd_Loop | spoke water only |
| trav.climb | MISSING | — | parkour later (UAL2); until then no climb state |

## Combat (karate + flower blade)

| state | src | clip | fallback |
| --- | --- | --- | --- |
| combat.sword_idle | UAL1 | Sword_Idle | upper body, blade down |
| combat.sword_slash | UAL1 | Sword_Attack | light; RM optional |
| combat.heavy | MISSING | — | time-scaled Sword_Attack + hip drop |
| combat.jab | UAL1 | Punch_Jab | Hub karate light 1 |
| combat.cross | UAL1 | Punch_Cross | Hub karate light 2 |
| combat.guard | MISSING | — | upper-body freeze of Sword_Idle arms |
| react.hit_chest | UAL1 | Hit_Chest | — |
| react.hit_head | UAL1 | Hit_Head | — |
| react.knockdown | MISSING | — | Hit_Chest + hip sink |
| react.death | UAL1 | Death01 | — |

Flower quench is VFX on the blade, not a clip. Inside the 42 m Flower Law disk the sheathed/rest pose is the default. Arena sand may use Sword_Attack.

Iron Coast (`B22_npc_spoke`) uses the same jab and cross for empty-hand Wing Chun. Grid empty hands use the same two clips with a Capoeira back-foot mesh bias. Switchknife and pulseblade stay on `combat.sword_slash` for the existing B7 bandit and officer only. Invoice weight stays holstered. No pistol clip. No rifle clip.

Cycle 2 district cloth uses that same pair. Coast rows (ghost shoulder, block diamond, blank disc, case hip, cuff bars) are Wing Chun. Grid rows (cut cuff, clinic roll, open ring) keep the Capoeira back-foot bias. The shoulder square, back diamond, bare wrist, cloth cylinder, blank disc, hip case, pale bars, and open ring do not add a clip. The ring is not a gadget swing. Spawn weight 0.

Sundering grove and ash (`B22_npc_fantasy`) do not take `combat.sword_slash`. That clip stays on the B7 ward. Tunya terrace and ark use `combat.jab` and `combat.cross` empty-handed. Capoeira is the mesh bias. The clay jar, quilt patch, and rib collar have no swing clip. No pistol clip. No rifle clip.

Cycle 2 outfits and faces add no clip. The seed cuff, bark apron, soot collar, split sleeve, stem cord, eave shawl, rib wrap, and lamp hem have no swing. Grove and ash still do not take `combat.sword_slash`. Terrace and ark stay on jab and cross. No pistol clip. No rifle clip.

Ruins density (`B22_npc_edge`) does not take `combat.sword_slash`. That clip stays on the unburial elite and the existing Ruins blades. Frontier Muay Thai and Sere Wing Chun use `combat.jab` and `combat.cross` empty-handed. The shin bands, collar pin, slate, and cairn stick have no swing clip. No pistol clip. No rifle clip.

B27 held tools use the same upper body. `Sword_Attack` covers the ash knife, brand hook, mercy baton, and seam chisel. Procedural heavy covers the furnace bar, fossil chisel, soot tongs, pad wedge, vent bar, open caliper, and the arena steel pruner. Procedural thrust covers the rib hook, launch hook, and lattice pike. `wpn_bow_ruins_sinew` and `wpn_throw_dawn_glassdisc` stay unbound. `wpn_focus_sere_woundcoal` is a hold. Court bloom and wood pruner inside 42 m do not play `Sword_Attack`.

Cycle 2 uses that same upper body and adds no clip. `Sword_Attack` covers the bone pick, the cinder awl, the pad hook, and the arena steel thorn pin. Procedural heavy covers the ash mallet, the slab bar, the soot rake, the stretcher pole, the seam brush, and the arena steel petal rake. Procedural thrust covers the arena steel bud staff and the reach rod. Holds: seed cup, quiet plate, cool cube, and the flower skins of the bud staff, petal rake, and thorn pin. `wpn_throw_sere_clinker` stays unbound. No pistol clip. No rifle clip.

B27 gadgets use that same upper body. `Sword_Attack` covers the drift awl and the pin punch. Procedural heavy covers the fiber spool, corner bar, conduit snips, open clamp, nested rod, blank key, horseshoe, seam roller, slag spoon, open wrench, and quartz file. Holds: cracked loupe, tally click, gap block, broken loop. `wpn_throw_grid_blankpuck` stays unbound. The bridge runner does not equip them.

## Interact, work, emote, SoftEnter

| state | src | clip | fallback |
| --- | --- | --- | --- |
| use.interact | UAL1 | Interact | doors, notices, urn |
| use.pickup | UAL1 | PickUp_Table | crates, hod |
| use.push | UAL1 | Push_Loop | cart, door leaf |
| use.talk | UAL1 | Idle_Talking_Loop | upper body |
| use.sit_enter | UAL1 | Sitting_Enter | council bench |
| use.sit_idle | UAL1 | Sitting_Idle_Loop | — |
| use.sit_talk | UAL1 | Sitting_Talking_Loop | — |
| use.sit_exit | UAL1 | Sitting_Exit | — |
| use.torch | UAL1 | Idle_Torch_Loop | night lantern |
| use.kneel_work | UAL1 | Fixing_Kneeling | stand-in for sweep; not a broom cycle |
| use.dance | UAL1 | Dance_Loop | rare plaza emote, never SoftEnter |
| use.spell_idle | UAL1 | Spell_Simple_Idle_Loop | mystic guests only |
| use.spell_cast | UAL1 | Spell_Simple_Shoot | mystic guests only |
| softenter.idle | UAL1 | Idle_Loop or Walk_Formal_Loop | 0.33 s blend; cut if reduced motion |

## Masks

- UpperBody: spine, chest, head, both arms. Legs stay on the locomotion tree during jab, talk, torch.
- Full body: death, roll, jump, sit enter/exit, dance.
- Jaw and blink stay on the procedural face layer. Do not author a second face clip set in B21.

## Atlas mobility (cycle 2)

No new humanoid state. W05 kinds reuse the rows above. See `MOBILITY_BIND.md`.

| kind | state | note |
| --- | --- | --- |
| gate | loc.walk_formal → softenter.idle | 2 plaque minutes. Not the 4800-minute Crown Road. Blade stays down inside 42 m. |
| road | loc.walk | 5 km/h read. Jog is local play. |
| walker | loc.walk | stride scale 0.7. No mount. |
| weak | loc.crouch_fwd | waystone. Climb stays MISSING. Not a Sere gate. |
| sea | none | No hull. Swim only if the body is already in spoke water. |
