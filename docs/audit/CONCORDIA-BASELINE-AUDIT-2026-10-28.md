# Concordia — Baseline & Import-Readiness Audit (B3-1)

- **Slice:** B3-1 (Builder 3 — Concordia & Game, Lane 1 Build)
- **Date:** 2026-10-28
- **Base:** audited at `origin/main` @ `ec2a846942251d5010b93a5143ea094db3f41995` (SEC-7, #1731). This doc's branch was cut from the next main head, `92e39c35ba6004cb2b8e3ff121f1511dc7e4f6f8` (SEC-9, #1732); the `unity-client` tree is byte-identical between the two heads (verified by diff), so every count below holds for the branch base.
- **Method:** `git ls-tree -r` of `origin/main` (58,749 tracked paths under the Unity project) reconciled against the two on-disk Mixamo manifests and the asset folders verified on disk 2026-10-24. Docs only — no gameplay code, no imports, no merges, no deploys in this slice.
- **Scope limit:** This audit covers the canonical repo copy on `origin/main`. Local-only, gitignored content on any one machine (see §2) is not visible from the repo and is flagged as unverified where it matters.

## 1. Unity project location

Concordia lives in the **Living World Unity project**:

- Project root: `apps/concordia-living-world/unity-client/` in `ConcordDev/concord-cognitive-engine`
- Plan: `docs/LIVING_SOCIETY_PLAN.md`
- Unity version: **6000.5.9f1** (`ProjectSettings/ProjectVersion.txt`)
- The copies under the various `handoff3/wt-*` worktrees are branch checkouts of this same project, not separate projects. `origin/main` is canonical.
- All **1,272 FBX files** tracked in the repo are inside this `unity-client`; there are no FBX anywhere else in the repo.

## 2. Mixamo haul vs. what's imported in-project

Verified source copies (Muse VM disk, counts re-checked 2026-10-28):

| Set | On disk | Manifest verdict |
|---|---|---|
| Animation clips | **110 FBX** in `~/workspace/concordia-mixamo-clips/` | MANIFEST.md "FINAL TALLY — hunt complete 2026-10-24: 110 FBX clips, 66 MB, all verified on disk" (FBX for Unity, Without Skin, 30 fps, In Place where offered; source character X Bot) |
| Characters | **108 FBX** in `~/workspace/concordia-mixamo-characters/` | MANIFEST.md "SET COMPLETE (Oct 24): 108 files for Mixamo's 108 grid slots — 58 named + Ch01–Ch50 generic bodies, complete, no gaps/dupes" (T-pose, with skin/textures, no animation attached) |

Reconciliation against `origin/main`'s `unity-client` (exact basename match, then normalized match ignoring case/spaces/underscores — both run):

- **Clips imported: 0 of 110.** Explicit diff: all 110 clip filenames are absent from the project.
- **Characters imported: 0 of 108.** Explicit diff: all 108 character filenames are absent from the project.

This is **by design, not a loss**:

- `unity-client/.gitignore` carries the rule: `# Mixamo / character FBX (~587MB). Restore locally from the kitchen tree.` — it ignores `Assets/Concordia/Models/**` (exception: `Models/README.txt`).
- `Assets/Concordia/Models/README.txt` (committed) says the same: the local-only Mixamo/character FBX and the full Kenney kitchen are gitignored; "Copy those from the Mac kitchen if you have them."

What *is* committed under `Assets/Concordia/Models/humans/`:

- `Soldier.glb` and `Xbot.glb` — GLB models already in the project (Xbot is the Mixamo X Bot *character as a GLB*; it is not one of the 218 haul FBX, and no haul clip FBX accompanies it).
- 5 Rocketbox FBX (`Female_Adult_01/04`, `Male_Adult_01/05/08`) with textures.

The only Mixamo-named code in the project is `Assets/Concordia/Scripts/MixamoAvatar.cs` — a procedural avatar controller that binds whatever prefab it is given (its header notes Soldier.glb already carries Idle/Walk/Run and jump is procedural). No Mixamo folder exists anywhere under `Assets/`.

**Unverified remainder:** whether the Mac/Aura local copy of the project currently has the haul FBX restored under `Assets/Concordia/Models/` cannot be determined from `origin/main` or from this VM — that content is local-only by design. The check is a Mac-side listing of that folder; it has not been run in this slice.

**Wiring notes carried forward from the clips manifest:** `Pushing.fbx` and `Pull_Heavy_Object.fbx` were downloaded *without* "In Place" ticked and carry root motion; all other clips are In Place where Mixamo offered it.

**Blocker (unchanged, Ramaj-only):** the 3.6 GB all-in-one characters zip (`~/workspace/concordia-mixamo-characters-all.zip`, 108 FBX verified) is built; its Google Drive upload still waits on Ramaj's Drive Allow/connect step.

## 3. Quaternius / UAL baseline

**Present — confirmed on `origin/main`.**

- `Assets/Concordia/FreePacks/AURA_MANIFEST.json` exists (its `updated` field reads 2026-10-25T13:00:14; a second copy sits under `Assets/Concordia/PolyHaven/`).
- **66 FBX** under `Assets/Concordia/FreePacks/Quaternius/`:
  - Universal Animation Library Standard: `UAL1_Standard.fbx` **and** `UAL1_Standard_RM.fbx` (root-motion variant), under `Quaternius_Universal_Animation_Library_Standard/Universal Animation Library[Standard]/Unity/`.
  - RPG Characters — Nov 2020: Cleric, Monk, Ranger, Rogue, Warrior, Wizard + 6 weapon FBX (staff ×2, bow, arrow, dagger, sword).
  - Ultimate Animated Character Pack — Nov 2019: 50 FBX incl. BaseCharacter, Soldier_Male/Female, Knight_Male, Viking, Ninja, Zombie, Elf, Goblin, Witch, Wizard, Cow, Pug, and casual/profession bodies.
- Locomotion controllers already in project: `Assets/Concordia/Anim/ConcordiaLocomotion.controller` and `SoldierLocomotion.controller`.

AURA manifest pack counts vs. files actually tracked on `origin/main`: KenneyUI 7,448 = 7,448; GameIcons 10,810 = 10,810; FoozleUI 1,015 = 1,015; TinyRPGUI 202 = 202; Nature 7,247 = 7,247; VFX 208 = 208; Audio 420 = 420; Polish 591 = 591. Three packs differ — Quaternius (manifest 578 vs. 321 tracked), Fauna (165 vs. 97), ambientCG (2,507 vs. 2,499) — consistent with local-only/gitignored content on the authoring machine; flagged here, not resolved.

Other in-project FBX concentrations, for orientation: FreePacks/Props 472, PolyHaven/Models 345, FreePacks/Nature 329, FreePacks/Weapons 24, FreePacks/Fauna 17, Generated/Rig 2 (`CX_Humanoid_Female/Male.fbx`).

## 4. Honestly missing from Mixamo (parry / riposte / riding)

Per the clips MANIFEST.md final NOT FOUND roll-up (2026-10-24, all runs searched): Mixamo genuinely has **no parry, no riposte/counter-stab, and no riding set (horse idle · ride · dismount)**. The same roll-up lists 15 further misses: thumbs down, hugging, high five, chopping wood, hammering, sawing, sweeping, reading a book, cooking/stirring a pot, eating, warhammer swing, playful child-like run, meditation floating pose, ritual chanting, throne sit.

- **Riding route (as planned from the start):** mount/riding animation routes to **Unity's Animation Generator**, not Mixamo (clips manifest, final tally note). Mount *models* are a separate matter — the AURA manifest covers mounts via Quaternius farm-animal/horse packs in Fauna; a model existing is not a ride animation.
- **Parry / riposte:** no sourced replacement exists yet in any manifest or doc checked. They remain an open gap for a future slice to source or build procedurally (MixamoAvatar.cs already does procedural combat posing, which is one candidate route — noted, not decided here).

## 5. Done-state check (against the B3-1 assignment)

1. ✅ Unity project location in the assigned tree identified — §1 (`apps/concordia-living-world/unity-client`, canonical on `origin/main`).
2. ✅ Written inventory reconciling in-project imports against both manifests — §2 (0/110 clips, 0/108 characters in `origin/main`, explicit diff, with the gitignore design that explains it and the one unverified local remainder named).
3. ✅ Quaternius/UAL baseline confirmed present — §3 (UAL1_Standard + RM variant, RPG Characters, Ultimate Animated Character Pack; AURA_MANIFEST.json present).
4. ✅ Parry/riposte/riding listed as Mixamo-absent, riding's Unity Animation Generator route noted — §4.
5. ✅ Single inventory doc on its own branch off `origin/main`; tree otherwise clean; no merges, no deploys, no gameplay code.

*Builder 3 — Concordia & Game. Coordination via Concord Overseer — Founder Office.*
