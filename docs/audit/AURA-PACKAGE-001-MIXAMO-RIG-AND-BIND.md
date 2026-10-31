# AURA PACKAGE #1 — Mixamo rig conversion + clip bindings for roadmap F-05…F-20

- **For:** Aura (editor-side execution in `~/concord/aura-wt`, branch `aura/gameplay`). **From:** Builder 3 (Claude side — wiring & organization). **Date:** 2026-10-28.
- **What this is:** the exact, descriptive work package that turns the imported Mixamo library into usable animation for the roadmap's Feel phase. It resolves the `TODO_anim_*` labels named in tasks F-10…F-15 and the clip half of REQ-3. Nothing here is open-ended: every task names its files, its settings, and its verification. If a step cannot be done exactly as written, stop that step and file it in `.Aura/REQUESTS_FOR_CLAUDE.md` — do not improvise a substitute.
- **Sources (all verified by B3, 2026-10-28):** `.Aura/ROADMAP.md` task texts F-05…F-20; `REQUESTS_FOR_CLAUDE.md` REQ-3 + Zuko's 2026-10-24 mapping answer; the haul manifest (`~/workspace/concordia-mixamo-clips/MANIFEST.md` — download spec: FBX for Unity, Without Skin, 30 fps, In Place where offered; source character X Bot); the on-disk import at `Assets/Concordia/Animations/Mixamo/` (110 FBX + 110 `.meta`, filename-verified identical to the haul).
- **Conventions:** commit per task as `aura(PKG1-<n>): <what>` on `aura/gameplay`, per roadmap §0. Fill each task's `Result:` line in `.Aura/PROGRESS_LOG.md` (this package is not part of the 194 — log it there, do not edit ROADMAP.md task text). Screenshots to `~/.zuko/aura-shots/PKG1-<n>.png`. Respect `ConcordiaSettings.ReducedMotion` in anything that flashes or shakes (roadmap law). Court law: no combat tests inside the Hub Court — use the Proving Ring.

---

## PKG1-1 · Convert all 110 Mixamo FBX from Generic to Humanoid rig (do this FIRST — every other task in this package depends on it)

**Why:** the import metas carry `animationType: 2` (Generic). REQ-3's answer states the clips must be Humanoid before they retarget onto `ModularPerson` (the hero rig probe checks `avatar.isHuman && avatar.isValid`). UAL/Rocketbox clips already in use are Humanoid; the Mixamo set is not yet.

**Exact steps:**
1. In the Project window, open `Assets/Concordia/Animations/Mixamo/`.
2. Select **all 110 `.fbx` files** in that folder (the full list is Appendix A — count your selection: it must read 110).
3. Inspector → **Rig** tab → set **Animation Type = Humanoid**; set **Avatar Definition = Create From This Model**; leave Skin Weights and other tabs untouched. Click **Apply** once for the whole selection.
4. Wait for the import to finish (do not interrupt; if the editor asks about fixing bone orientations on any file, accept the default and note the filename in your Result line).

**Verify (all four must hold):**
- Spot-check `Dive_Roll.fbx.meta` in a text view: `animationType: 3` (Humanoid).
- Spot-check `One_Hand_Sword_Combo.fbx.meta` and `Talking.fbx.meta`: same, `animationType: 3`.
- In the editor, select `Dive_Roll.fbx` → Rig tab shows a valid avatar (green check in the avatar configuration preview; no "no valid Avatar" warning).
- Log line in PROGRESS_LOG: `PKG1-1 converted=110 failed=<n>` — if `failed` is not 0, list each failed filename and its console error verbatim.

**Result:** `PASS · converted 110/110 · commits <hash>` or `BLOCKED · <filenames + errors>`.

## PKG1-2 · Set loop flags and root-motion baking on the binding set

**Why:** F-09's law is "do not let root motion move the capsule," and one-shot clips must not loop. The haul was downloaded In Place where offered; exactly two files carry root motion and are flagged below.

**Exact steps (multi-select within `Assets/Concordia/Animations/Mixamo/`, Inspector → Animation tab):**
1. **Loop Time = ON, Loop Pose = ON** for exactly these 18 clips: `Breathing_Idle`, `Crouch_Idle`, `Falling_Idle`, `Falling_Idle_Variant`, `Fishing_Idle`, `Flying`, `Prone_Idle`, `Rifle_Aiming_Idle`, `Sitting_Idle_Chair`, `Sitting_Idle_Floor`, `Sleeping_Idle`, `Sword_And_Shield_Block_Idle`, `Talking`, `Treading_Water`, `Walking`, `Walking_Backwards`, `Left_Strafe_Walk`, `Right_Strafe_Walk`.
2. **Loop Time = OFF** for every other clip used in §PKG1-3's tables (combos, reacts, dodges, get-ups, death, emotes, work verbs).
3. **Root motion:** for every clip in the PKG1-3 tables **except** the two flagged next, set Root Transform Position (XZ) **Bake Into Pose = ON** (Based Upon = Original). **Exceptions — leave root motion live** on `Pushing.fbx` and `Pull_Heavy_Object.fbx` (downloaded without In Place; their travel is the interaction, used only by push/pull content, never by the player capsule).

**Verify:** re-select `Breathing_Idle.fbx` (loop on) and `Dive_Roll.fbx` (loop off, XZ baked) and confirm the Animation tab shows the set values; log `PKG1-2 loops=18 baked=<count>`.

**Result:** `PASS · <hash>` or the exact clip whose settings would not save.

## PKG1-3 · Bind clips to roadmap tasks (the tables ARE the task — bind exactly these, in this order)

For each roadmap task below: when you work that task, use these clips. Where a task's original text names a UAL clip that already works, the UAL clip stays primary and the Mixamo clip is the named alternate — do not churn working bindings. Where the task carries a `TODO_anim_*` label, binding the listed Mixamo clips **removes** the label.

| Roadmap task | Bind (exact file in `Assets/Concordia/Animations/Mixamo/`) | Notes |
|---|---|---|
| F-05 Jump/fall/land | *No change required* — UAL `Jump_Start/Jump_Loop/Jump_Land` stay primary. Alternates if UAL timing feels wrong: `Jumping_Up.fbx` (start), `Falling_Idle.fbx` (loop), `Falling_To_Landing.fbx` (land), `Falling_Idle_Variant.fbx` (long fall) | Mixamo alternates are recorded here so F-05 never blocks on sourcing |
| F-06 Crouch | UAL crouch loops stay primary. Alternates: `Crouch_Idle.fbx`, `Crouch_Walk_Forward.fbx` | — |
| F-07 Swim | UAL swim loops stay primary (the haul has **no** swim-forward clip). Add: `Treading_Water.fbx` (idle in water), `Swimming_To_Edge.fbx` (exit at edge) | Do not substitute anything else for swim-forward |
| F-08 Upper-body layer | *No Mixamo needed* — UAL `Sword_Idle/Sword_Attack/Punch_*` as the task text says | — |
| **F-10 3-beat light combo** — removes `TODO_anim_combo` | Armed: **`One_Hand_Sword_Combo.fbx`** (the full 3-hit combo in one clip; drive beat windows 0/1/2 via F-09's phase→normalized-time mapping). Variants by weapon: `Dual_Weapon_Combo.fbx` (dual wield), `Double_Dagger_Stab.fbx` (dagger), `Bayonet_Stab.fbx` (spear/polearm thrust). Unarmed: **`Punch_Combo.fbx`** (4 hits on disk; use beats 0–2), `Roundhouse_Kick.fbx` (unarmed heavy option) | Mirror variant per the task text = the same clip with the controller's mirror toggle, not a second file |
| **F-11 Heavy presentation** — removes `TODO_anim_heavy` | **`Great_Sword_Slash.fbx`** (overhead heavy), `Standing_Melee_Attack_Downward.fbx` (downward/axe heavy) | Play at ~0.7 speed per the task goal; the CombatMotion lunge stays code-side |
| **F-12 Directional dodge roll** | **`Dive_Roll.fbx`** (directed roll — rotate the character to the input vector, the clip rolls forward), **`Standing_Dodge_Backward.fbx`** (the no-input backstep, exactly as the task text specifies), `Running_Slide.fbx` (sprint dodge variant) | Supersedes the task text's "UAL Roll" sourcing; keep `DodgeAction` 350 ms i-frames / 18 stamina unchanged |
| **F-13 Guard + parry pose** — partially removes `TODO_anim_block` | Guard hold: **`Sword_And_Shield_Block_Idle.fbx`** (loop, set in PKG1-2). Block impact: **`Sword_And_Shield_Impact.fbx`**, **`Block.fbx`** (unarmed/shieldless chest block). **Parry: NO CLIP EXISTS — keep `TODO_anim_parry` and the procedural forearm raise exactly as the task goal describes** | Parry/riposte/ride wait on Ramaj's route pick (Animation Generator vs download) — B3 dossier D3 |
| **F-14 Directional hit reactions** | Light: **`Standing_React_Small_From_Right.fbx`**. Heavy/front: **`Standing_React_Large_From_Front.fbx`**. Body hit: **`Hit_Reaction.fbx`** | Honest gap: the haul has no left/back-specific reacts — side/back procedural lean (already in the task goal) covers them; do not mirror the right-react and call it a left-react in the Result line |
| **F-15 Stagger + knockdown** — removes `TODO_anim_getup` | Knockdown: **`Livershot_Knockdown.fbx`**. Get-up: **`Getting_Up.fbx`**; prone variant **`Getting_Up_From_Prone.fbx`**. Stagger: `Standing_React_Large_From_Front.fbx` held per the task's held-pose pattern | GuardBroken → knockdown path unchanged (code-side) |
| **F-16 Death** | **`Falling_Back_Death.fbx`** (player + hostiles) | Supersedes UAL `Death01` sourcing in the task text |
| **F-17 Interact / pickup / talk** | Pickup: **`Picking_Up.fbx`**. Chest/lid: **`Opening_A_Lid.fbx`**. Talk: **`Talking.fbx`** (loop). Sit-down interactions: `Sitting_Idle_Chair.fbx` | Repairs have **no** Mixamo equivalent in the haul — UAL `Fixing_Kneeling` stays for repairs; E-interact generic stays UAL `Interact` |
| **F-19 NPC job animations** | Sit: `Sitting_Idle_Chair.fbx` / `Sitting_Idle_Floor.fbx`. Stall/talk: `Talking.fbx`. Watch/idle life: `Breathing_Idle.fbx`, `Looking_Around.fbx`, `Shrugging.fbx`, `Sleeping_Idle.fbx`. Work verbs: `Digging.fbx`, `Fishing_Cast.fbx`, `Fishing_Idle.fbx`, `Watering.fbx`, `Typing.fbx`, `Writing.fbx`, `Drinking.fbx`. Social: `Waving_Gesture.fbx`, `Clapping.fbx`, `Cheering.fbx`, `Shaking_Hands.fbx`, `Quick_Formal_Bow.fbx`, `Salute.fbx`, `Standing_Thumbs_Up.fbx`, `Beckoning.fbx`, `Pointing_Gesture.fbx`, `Laughing.fbx`, `Crying.fbx`, `Angry_Gesture.fbx`, `Thinking.fbx`. **Sweep: NO sweeping clip exists anywhere in the haul** — UAL `Push_Loop` stays for Sweep; `Pushing.fbx` (root-motion, PKG1-2 exception) is the alternate for push interactions only | Job→clip mapping extends the task text's UAL table; log per-NPC clip names in the F-19 Verify as the task requires |
| **F-20 Creature locomotion** (verb-catalog additions) | `Zombie_Walk.fbx`, `Zombie_Attack.fbx`, `Mutant_Run.fbx`, `Mutant_Roaring.fbx`, `Stomp.fbx` | Add to `AnimationVerbCatalog.Creatures` alongside the Quaternius pack verbs |

**New information for a closed task — F-04:** F-04's Result records "no turn clip exists in UAL or any pack in this project," and its turn read is procedural (verified PASS — do not reopen it on this note). For the record: the haul **does** contain `Turning.fbx` (turn in place). If a future polish task wants a clip-based turn, it is sourced and rigged by PKG1-1.

**Surplus clips, bound to no F task yet (rigged by PKG1-1, catalogued here so nothing is folklore):** ranged set — `Standing_Draw_Arrow.fbx`, `Shooting_Arrow.fbx`, `Rifle_Aiming_Idle.fbx`, `Firing_Rifle.fbx`, `Reloading.fbx`, `Shooting_Pistol.fbx`, `Taking_Cover.fbx`, `Grenade_Throw.fbx` (C-phase ranged); magic set — `Standing_1H_Cast_Spell_01.fbx`, `Standing_2H_Cast_Spell_01.fbx`, `Standing_2H_Magic_Attack_01.fbx`; movement specials — `Sneak_Walk.fbx` (A-08 stealth), `Unarmed_Run_Forward.fbx` (casual run alternate), `Vault_Over_Box.fbx`, `Climbing_Ladder.fbx`, `Crawling.fbx`, `Fast_Run.fbx` (sprint alternate), `Injured_Walking.fbx`, `Drunk_Walk.fbx`, `Old_Man_Walk.fbx`, `Walking_With_Shopping_Bag.fbx`, `Box_Walk_Arc.fbx`, `Lifting_Object.fbx`; emote/performance — `Chicken_Dance.fbx`, `Ymca_Dance.fbx`, `Macarena_Dance.fbx`, `Belly_Dance.fbx`, `Swing_Dancing.fbx`, `Dancing_Ballet.fbx`, `Guitar_Playing.fbx`, `Singing.fbx`, `Terrified.fbx`, `Scared.fbx`, `Male_Sitting_Pose_Facepalm.fbx`; special — `Flying.fbx`, `Swing_To_Land.fbx`, `Driving.fbx`, `Entering_Car.fbx`, `Praying.fbx`.

**Stand-ins that REMAIN after this package (do not invent clips for these):** `TODO_anim_parry`, `TODO_anim_riposte`, `TODO_anim_ride` — no source exists in any holding (Mixamo has none; haul manifest confirms NOT FOUND). Resolution path is Ramaj's D3 pick; B3 owns the follow-up package when he picks.

## Package verification (whole package, after PKG1-1 + PKG1-2)

- Re-run the F-01 hero rig probe path (`HeroRigProbe.Audit()`) with three Mixamo clips assigned on a test NPC or the hero: `Dive_Roll`, `One_Hand_Sword_Combo`, `Talking` — the log must show `avatarValid=True` and `clipsFit=True` for each.
- One Play screenshot: an NPC playing `Talking` in the Court (not a T-pose), saved as `~/.zuko/aura-shots/PKG1-verify.png`.
- PROGRESS_LOG entry: `PKG1 PASS · rig converted 110 · bindings tabled for F-05…F-20 · stand-ins remaining: parry, riposte, ride`.

---

STANDARD CHECK
- Governing docs followed: Aura roadmap §0 + task texts F-05…F-20 (live tracker, read 2026-10-28); REQUESTS_FOR_CLAUDE.md REQ-3 incl. Zuko's mapping answer; haul MANIFEST.md (download spec + NOT FOUND lists); Builder Quality Standard; Ramaj's directive (2026-10-28): descriptive, non-vague steps for Aura
- Flows verified live or by behaviour tests: none run by B3 (editor work is Aura's). Every clip named was verified to exist on disk by filename (110/110 set diff vs the haul, B3-2 dossier §6); every "no clip exists" claim traces to the haul manifest's own NOT FOUND entries (parry, riposte, riding, sweeping, swim-forward)
- NOT RUN / not proven: the rig conversion itself (PKG1-1 is Aura's editor work — B3 cannot run the editor); whether each converted avatar validates clean (PKG1-1's Verify is the check); retarget quality per clip on the hero rig (visible only in Play — Aura's F-task Verify steps cover it)
- Fake data / stubs: none — the three genuine gaps are carried as named stand-ins (`TODO_anim_parry/riposte/ride`), exactly as REQ-3 prescribes
- Constraints held: PR-only, no excluded files touched, DATA_DIR temp, mem-gate used: no builds/tests run by B3 (docs-only package); aura-wt untouched by B3; nothing merged or deployed
- Queue check: latest Overseer directive checked 2026-10-28 19:40 ET (overnight working rule); START NOTICE sent: yes (2026-10-28 ~19:4x ET report, this package named as the item); current assignment: Aura Package #1
- Independent pass requested from: Aura (execution + Play verification in-editor); Overseer (package review)

*Builder 3 — Concordia & Game. Coordination via Concord Overseer — Founder Office.*

## Appendix A — the 110 FBX (selection checklist for PKG1-1)

Angry_Gesture · Bayonet_Stab · Beckoning · Belly_Dance · Block · Box_Walk_Arc · Breathing_Idle · Cheering · Chicken_Dance · Clapping · Climbing_Ladder · Crawling · Crouch_Idle · Crouch_Walk_Forward · Crying · Dancing_Ballet · Digging · Dive_Roll · Double_Dagger_Stab · Drinking · Driving · Drunk_Walk · Dual_Weapon_Combo · Entering_Car · Falling_Back_Death · Falling_Idle · Falling_Idle_Variant · Falling_To_Landing · Fast_Run · Firing_Rifle · Fishing_Cast · Fishing_Idle · Flying · Getting_Up · Getting_Up_From_Prone · Great_Sword_Slash · Grenade_Throw · Guitar_Playing · Hit_Reaction · Injured_Walking · Jumping_Up · Laughing · Left_Strafe_Walk · Lifting_Object · Livershot_Knockdown · Looking_Around · Macarena_Dance · Male_Sitting_Pose_Facepalm · Mutant_Roaring · Mutant_Run · Old_Man_Walk · One_Hand_Sword_Combo · Opening_A_Lid · Picking_Up · Pointing_Gesture · Praying · Prone_Idle · Pull_Heavy_Object · Punch_Combo · Pushing · Quick_Formal_Bow · Reloading · Rifle_Aiming_Idle · Right_Strafe_Walk · Roundhouse_Kick · Running_Slide · Salute · Scared · Shaking_Hands · Shooting_Arrow · Shooting_Pistol · Shrugging · Singing · Sitting_Idle_Chair · Sitting_Idle_Floor · Sleeping_Idle · Sneak_Walk · Standing_1H_Cast_Spell_01 · Standing_2H_Cast_Spell_01 · Standing_2H_Magic_Attack_01 · Standing_Dodge_Backward · Standing_Draw_Arrow · Standing_Melee_Attack_Downward · Standing_React_Large_From_Front · Standing_React_Small_From_Right · Standing_Thumbs_Up · Stomp · Swing_Dancing · Swing_To_Land · Swimming_To_Edge · Sword_And_Shield_Block_Idle · Sword_And_Shield_Impact · Taking_Cover · Talking · Terrified · Thinking · Treading_Water · Turning · Typing · Unarmed_Run_Forward · Vault_Over_Box · Walking · Walking_Backwards · Walking_With_Shopping_Bag · Watering · Waving_Gesture · Writing · Ymca_Dance · Zombie_Attack · Zombie_Walk
