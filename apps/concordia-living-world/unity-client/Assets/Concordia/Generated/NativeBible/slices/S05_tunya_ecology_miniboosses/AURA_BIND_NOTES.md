# Aura bind notes — S05 Tunya ecology

Bind this facet after the Tunya block of `volume/DENSITY_TABLES.json` and after `enc_twelfth_reap` in `BOSSES_AND_RAIDS.json`. This slice adds caps, place filters, an ark-place table, two new encounter windows, law ties on the existing twelfth morning, and five quests. It does not replace weights, the twelfth clock, or `item_rem_reap_talon`.

Art prompts already live on the creature rows for `faun_nil_sealie`, `faun_veil_hound`, `faun_terrace_goat`, `faun_pollen_hare`, `faun_ark_heron`, `faun_grove_finch`, `mon_tunya_harpy`, `mon_tunya_reapjackal`, `hyb_pollenwyrm`, and `hyb_veilstag`. Reuse those. Do not commission a new sheet for an alpha harpy, an orca, or a winged stag. Do not download packs. Do not wipe `Library`.

## Spawn order

1. If `terrace_farm`, `nil_shoal_stair`, or `veil_hall` has no transform, every creature bound only to that set spawns nothing. Do not use RealmFill's corn ring, Nil Threshold (18, −8), Aekon Glacier Gate (−15, 68), Fluxom Gate (62, 18), or the Asbir Ark (−90, −58) as a substitute floor.
2. `faun_grove_finch` on terrace and canopy edge, day, cap 10, pollen-dust material. Night cap 0. Fantasy cap unchanged at S03's 12 with pine dust.
3. `faun_terrace_goat` cap 8, day, weed strips only. Zero on graft scars except for the seconds `q_s05_weed_between_tiles` is leading them off. No mount.
4. `faun_veil_hound` cap 4, pairs with labor, reed collar. Night at the upper stall. Aggro only if struck or if already called onto a reap. Ignore the hostile flag in `ANIMALS.json` for this instance rule. Do not edit the file.
5. `faun_pollen_hare` cap 6 in bloom weeks, day. Off bloom, cap 0. Gold is a surface coat.
6. `faun_ark_heron` cap 3, day, irrigation cuts. Night cap 0. Hold of First Arrival gets no extra bird from this slice. Asbir Ark (−90, −58) gets none: the dunes are not a cut.
7. `faun_nil_sealie` cap 4 on the shoal stair only. Bible scale, 0.55× player length. Zero in the inner grove, zero at Fluxom, zero on the terrace. If the compiler offers a flamingo, despawn and spawn nothing.
8. `mon_tunya_harpy` cap 4 in the canopy between thefts. `mon_tunya_reapjackal` cap 5 on the wounded edge. During `enc_twelfth_reap`, both ambient caps are 0.
9. `enc_twelfth_reap`: volume clock, hours 6–9, every third day. One existing harpy dressed as alpha, four existing jackals. No third mesh. Lip only, outside the district. Unplaced lip emits nothing.
10. `enc_pollen_sleep`: one `hyb_pollenwyrm`, hours 11–13, every second day, not on a twelfth morning. Deep shade past the last terrace. Ambient cap 0 otherwise. Cloud is VFX.
11. `enc_graft_charge`: one `hyb_veilstag`, hours 14–16, every fourth day, not while the twelfth window is up. Terrace lip. Fantasy cap 0. No wings. Pinewood Crossing is not a spawn point. S01's stag cap does not rise.

Inner grove, hall interiors, twelfth interior, Fluxom water, Asbir dunes, and the Hold stay at fauna cap 0 for this facet. Missing mesh on any row: spawn nothing for that row. Do not borrow flamingo, parrot, fox, wolf, elephant, orca, griffin, a western dragon, or a CX body. Quaternius and Kenney are not fauna meshes. Clips may retarget later onto a native mesh that does not yet exist.

## Hit resolution

Tunya steel is live. Do not apply Flower Law to a bite on the terrace. Do apply it if a body is dragged inside the Hub 42 m disk and outside the Arena: the blade is a flower, and the kite is not a Tunya fine. Health stays the table already on the row: `table:faun_critter`, `table:faun_small`, `table:faun_med`, `table:faun_med_prey`, `table:mon_skirmisher`, `table:mon_swarm_elite`, `table:mon_brute`, `table:mon_elite`. No live numbers. No `table:boss_region`, because there is no boss row.

`skill_presence_do_not_reap` is the grove stance. Both hands open. Poise returns while the wielder is not striking. A strike cancels it. Rank 1 is already the Tunya default. The twelfth phase already uses it to stagger the alpha. Bind `cue_grove`. The skill row names a heal VFX prefab as an existing path. Leaves and low pollen fit the law. A green beam into the sky does not. Do not retune the skill file from this slice.

`hyb_pollenwyrm` and `hyb_veilstag` and both monsters are `hostile: false` in the catalogs. The windows set aggro inside their circles after the telegraph, without editing those files. The hound's catalog hostile flag is the other way. The instance rule above is the one to bind.

## Quests

Register the five objects in `ECOLOGY.json` beside the volume Tunya list. Do not edit `q_tunya_fruit_not_tree`, `q_tunya_sealie_not_bird`, `q_tunya_pollen_ward`, `q_tunya_reap_fine`, `q_tunya_terrace_bell`, `q_tunya_heron_hold`, `q_tunya_choir_one_chart`, `q_tunya_twelfth_edge`, or the canon chains they extend.

Givers are `npc_role_tunya_labor` and `npc_role_tunya_merchant`, inside budgets 6 and 3. Turn-in matches the JSON. Board lines fire after turn-in. No quest grants a skill. No quest mints a DTU. No quest speaks the dump, the twelfth's living descendants, the deletion index, or Yenna's resonance.

The weed errand fails if a goat dies, a graft is cut, or a goat is mounted. The shoal errand fails if the sealie is struck, oversized, or a flamingo, or if the player enters the inner grove. The hound errand fails if the root dies, the hound dies, a fang is looted, or the district is entered. The sun errand fails if a circuit is completed, a feather is taken, a DTU is minted, or the heron dies. The hull errand fails if any of these species spawn within 40 m of the Asbir Ark, if the anomaly opens, if a solar panel is lifted, if a DTU is minted, or if turn-in goes to `the_ark_wright`.

`verdant_veil` deltas write the standing book already on `npc_role_tunya_labor`. They do not create a faction row. `npc_role_tunya_veil_labor` is the hound's tame_hook string and is absent from `ROLES.json`. Bind the heel to `npc_role_tunya_labor`.

## Do not bind

- An orca-horn sealie. `content/world/tunya/bestiary.json` `sealies` is authored and still has no mesh. Do not scale `faun_nil_sealie` up to satisfy it, and do not drop ivory, blubber, or the purple sac. A flamingo, a parrot harpy, an elephant, a cactem bug, Asbir shellfish as a creature, `hyb_dawnjackal`.
- A humanoid mob. Capoeira stays the people's style and has no beast in this slice to perform it.
- A `mon_boss_` import from another world, or a scaled wyrm or stag labeled as the region boss.
- The alpha as a new mesh. Wings on the veil stag. The veil stag at Pinewood Crossing or on the Fantasy verge.
- A second finch material on Tunya. Pollen dust here, pine dust on the Sundering.
- Fauna inside the Nil covenant, the twelfth interior, Fluxom harbor, or within 40 m of the Asbir ark, including on `q_s05_hull_stays_empty`.
- Vinewood lettering, or any rename of Pinewood Crossing.
- A mounted camera on the goat. A ride controller is not this row.

## Suggested check

With the three sets unplaced, search the Tunya instance and find none of these ten ids. Place only the shoal stair: up to four low sealies, dog-faced, no horn, no flamingo, and nothing else from this list. Place the terrace: goats on weed, hounds in pairs, finches by day with yellow dust, herons in the cuts, hares only in a bloom week, jackals only on the wounded edge. Place the canopy: harpies visiting, not perched in the hall rooms. On a twelfth morning the ambient harpy and jackal counts drop to zero and the lip shows one alpha and four jackals, and the district interior stays empty. At noon on an off-morning, one wyrm past the last lip, bees then rasp, and a cloud that is VFX. On a fourth-day afternoon, one wingless stag on the lip, and no extra stag at Pinewood Crossing. Swing inside the Hub disk at a kited jackal and get a flower, not a fang. Complete the five errands without a new skill, a new DTU, or a line about the dump. On the hull errand the Asbir sand stays empty while the terrace, if placed, still has its day flock.
