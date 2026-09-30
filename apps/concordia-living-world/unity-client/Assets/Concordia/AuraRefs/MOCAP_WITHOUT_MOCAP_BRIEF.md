# Mocap-quality movement without a mocap shoot (Concordia) — 2026-09-21

Yes, you can get “it glides like mocap” without a suit. Modern games do it by (1) using a real clip library, (2) blending/retargeting to Humanoid, (3) inertializing transitions. Hardware mocap is optional later.

## What we already have on disk
Installed and unused for gameplay:
- Quaternius UAL1 Standard (CC0): `Assets/Concordia/FreePacks/Quaternius/Quaternius_Universal_Animation_Library_Standard/.../Unity/UAL1_Standard.fbx` (+ `_RM.fbx`)
  Verified takes: Idle_Loop, Walk_Loop, Walk_Formal_Loop, Sprint_Loop, Jump_Start/Loop/Land, Roll, Sword_Attack, Sword_Idle, Hit_Chest, Hit_Head, Death01, Sitting_*, Swim_*, Crouch_Idle_Loop, Push_Loop, Pistol_Idle_Loop, Spell_Simple_Idle_Loop, Idle_Talking_Loop.
  Import meta currently has `clipAnimations: []` — Unity is NOT splitting clips. That’s why Concordia still uses Ethan Idle/Walk/Run.
- KCC Ethan (Unity sample, already driving ConcordiaLocomotion): Idle, Walk, Run, WalkTurn, WalkTurnSharp, RunTurn, RunTurnSharp, StandTurn, Crouch, MidAir, IdleJumpUp, JumpAndFall.
- 0 standalone `.anim` files. 5 controllers (ConcordiaLocomotion + SoldierLocomotion + Ethan demo).
- Kevin Iglesias Human Basic Motions / Melee: **NOT installed**.
- Quaternius character FBX meshes exist; **do not use those meshes as hero identity**. Clips only.

## Free / legal sources to snipe
| Source | License / use | Why | URL |
|---|---|---|---|
| Quaternius UAL1 (already in project) | CC0 commercial, no attribution | Bind first | already on disk |
| Quaternius UAL2 Standard | CC0 commercial | combos, parkour, farming, extra locomotion | https://quaternius.itch.io/universal-animation-library-2 |
| Mixamo animations | Free with Adobe ID; commercial **in the finished game**; do **not** redistribute raw FBX in a public asset pack | extra walk/run/strafe/combat/emotes | https://www.mixamo.com |
| Kevin Iglesias Human Melee Animations FREE | Unity Asset Store EULA, commercial, no attribution, no resale of pack | 1H/2H/polearm attack, combat idle, hit, death, 8-dir run | https://assetstore.unity.com/packages/3d/animations/human-melee-animations-free-165785 |
| Unity Starter Assets / KCC Ethan | already in project | keep as fallback only | on disk |

Do **not** treat as commercial-safe unless plan/terms rechecked:
- DeepMotion Animate 3D **Freemium = personal / non-commercial**. Premium required for commercial.
- Cascadeur Free = non-commercial, no FBX. Indie/Pro needed for commercial FBX.
- CMU / AMASS / many academic mocap sets = research licenses.

Rokoko Vision / Create: video-to-FBX, Mixamo skeleton export, commercial use of generated data claimed on product FAQ; free tier is only ~30s/month. Use after UAL/Mixamo/Kevin, for custom Concordia moves (Court idle, Brackish gait), not first.

## No-hardware pipeline that actually looks like mocap
1. **Library first** (this week): extract UAL1 clips, import UAL2 + Kevin FREE + selected Mixamo, retarget to Unity Humanoid, in-place locomotion (root XZ baked) + RM copies for committed roll/attack if needed.
2. **Bind**: ConcordiaLocomotion blend tree + action states; `SetFloat("Speed", v, 0.12, dt)`; no LateUpdate full-body fight.
3. **Polish**: crossfade 0.10–0.20s, inertialize overlays, foot IK lock, stride warp to LocomotionKernel speed.
4. **Custom later**: phone video → Rokoko Vision or Mixamo auto-rigger / Cascadeur (paid if commercial) for unique Concordia verbs. Do not invent a motion-matching DB until 80+ locomotion clips exist.

## Anti-patterns
- Claiming Ethan Idle as LightAttack.
- Using Quaternius **mesh** as the hero.
- Checking Mixamo FBX into a public redistributable pack.
- DeepMotion free-tier clips in a commercial ship.
- Building motion matching before clips are bound.
