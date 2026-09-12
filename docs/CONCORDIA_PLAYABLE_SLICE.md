# Concordia Unity — Playable Slice

**Status:** OPEN (ticket lock, 2026-09-12). Not green.  
**Pinned by:** `server/tests/concordia-playable-slice.test.js`  
**One-line verdict:** Concordia currently renders a living-world simulator wearing a prototype costume and a puppet walk. Playable means **costume + clip locomotion + planted feet + non-scaffold Hub** before another kernel law gets locked.

This is the only Concordia Unity work order until the acceptance captures below exist and the ban list is still holding.

---

## Owner sentence

**Playable Slice = one Humanoid (or one retargeted) skeleton for hero + NPCs, one `AnimatorController` with Idle/Walk/Run/Sprint/JumpStart/JumpLand/Dodge/LightAttack, root-motion policy decided, zero LateUpdate bone hinging for locomotion, pack Hub underfoot, F8 HUD, one art contract.**

If a 30-second Hub walk still smells like a marionette, the slice is not green. Systems/kernel work does not count.

---

## Why this, not another kernel pass

The brain is ahead of the body. ExplosiveLLC / Kevin Iglesias / SoldierLocomotion sit on disk. Live bodies mostly run **procedural bone hinging** because Rocketbox is Generic/Biped, Mixamo clips need Humanoid, and the code prefers authored gait when clips skate. Humans smell a fake walk cycle in half a second.

Checked against HEAD `concurrency-refactor` (2026-09-12), not memory:

| Claim | Where it is true |
|---|---|
| Dual body pipelines on the player | `ConcordiaPlayer` calls `avatar?.SetGait` **and** `person?.SetGait` every move |
| Clips almost never win | `ModularPerson` `_clipsFit = !_biped && ctrl && av && av.isHuman && av.isValid`. Rocketbox `Bip01` sets `_biped` → Animator disabled → `ApplyAuthoredGait` |
| Pack controllers are leftovers | `LoadLocomotion()` loads `SoldierLocomotion` / StarterAssets / Kevin demo controller. ExplosiveLLC `RPG-Character-Animation-Controller` is not the required path |
| LateUpdate panic hatch | `_clipsFit && _plantFrames == 6` hand-height check **nulls the Animator** |
| Slash is a forearm Euler | `_slashT` rotates `_uArmR` / Mixamo `_rArm` |
| Dodge is a velocity shove | `ConcordiaPlayer` `_vel += wish * 12.4f` |
| Jump is velocity + procedural tuck | Space sets `_vel.y = 8.2f`; Mixamo `ApplyJump` / ModularPerson `BipedHinge` tuck |
| Mixamo disables Animator in air | `animator.enabled = grounded` |
| NpcLife lies about grounded | `_person?.SetGait(speed, true)` while walking |
| SR2 **ratifies the puppet** | `concordia-sr2-streets.test.js` requires `BipedHinge(` and `_clipsFit = !_biped`. That pin is the defect, not the destination. The slice **retires** it. |
| Grounding 4.5m hack (this base) | `Grounding.SnapPoint` drops hits outside `y ∈ [-0.2, 4.5]` to `0.08`. In-flight visual P0 (PR #975) removes it — still required here until merged. |
| HubPlaza primitives (this base) | Court still ships `HubLook.Prim` cylinders/cubes unless PR #975 is in. Pack meshes are the Playable Slice floor, not optional polish. |

Kevin Iglesias has Idle/Walk/Run/Jump/Turn/Talk FBX. ExplosiveLLC RPG FREE has Walk/Run/Attack/Idle/DiveRoll on a Humanoid. Neither is the live contract. `SoldierLocomotion.controller` is a Speed blend tree over soldier clips — thin leftover, not the slice controller.

---

## Brutal order (do not reorder)

| Rank | Fix | Done when |
|---|---|---|
| **1** | One Humanoid + real `ConcordiaLocomotion` controller on the **hero** | Walk/run/idle are clips. Capture `ps-walk-cycle` |
| **2** | Same controller (or LOD twin) on every `ModularPerson` NPC | Plaza walkers animate. Capture `ps-npc-pathing`. Empty dirt > mannequin crowd |
| **3** | Delete procedural locomotion for authored bodies | No `ApplyAuthoredGait` / `ApplyPrimitiveGait` / Mixamo `ApplyProceduralGait` on the live path. Primitive fallback only if **no** mesh bound |
| **4** | Hub plaza from imported packs, not Prim cylinders | `ps-hub-day` shows pack floor/gates. No floating rib cubes |
| **5** | Grounding / spawn plant | No 4.5m ceiling hack. Feet on real ground. `ps-walk-cycle` pelvis never buried |
| **6** | Attack / dodge / jump **clips** | `ps-jump` and a slash still. No forearm Euler as the hero melee |
| **7** | OnGUI kernel behind F8 (default off). Night is darkness + lamps | `ps-hub-night` vs day is unmistakable. `ps-no-debug` has no kernel dump |
| **8** | One art contract | `docs/UNITY_ART_LOCK.md` (PR #975) or this ticket’s copy: Hub may wear one Rocketbox adult; steel worlds wear pack costume; Kenney/toon is missing-prop |

Ranks 4–8 overlap visual P0 (PR #975). If that PR is merged, do not rebuild them — verify the captures still hold, then spend the slice on **1–3–6**.

---

## Controller contract

New asset: `Assets/Concordia/Anim/ConcordiaLocomotion.controller` (also copied under `Resources/Concordia/` if runtime load needs it).

**Required states:** `Idle`, `Walk`, `Run`, `Sprint`, `JumpStart`, `JumpLand`, `Dodge`, `LightAttack`.  
**Parameters:** `Speed` (float), `Grounded` (bool), `Jump` (trigger), `Dodge` (trigger), `Attack` (trigger), `Sit` (bool, optional).  
**Root motion:** **off** for this slice (CharacterController owns translation). Feet must still plant visually — off is allowed; skating is not.  
**Clip sources (in order, Humanoid only):** Kevin Iglesias Human Basic Motions (in-place Walk/Run/Idle/Jump) → ExplosiveLLC RPG FREE (attacks, roll) → Starter Assets third-person as last Humanoid fallback. Soldier.glb / Mixamo Vanguard is **not** the Hub hero mesh.

`ModularPerson.LoadLocomotion` must load `ConcordiaLocomotion` first. `MixamoAvatar` is removed from the player, or becomes a no-op when `ModularPerson` is bound.

**`_clipsFit` rule after the slice:** authored Humanoid with a valid avatar **plays clips**. Biped Generic is retargeted or replaced — not a reason to keep `BipedHinge` as the walk. The plant-frame-6 Animator-null is deleted, not tuned.

`NpcLife` passes the real CharacterController grounded flag into `SetGait`. Hardcoded `true` is a bug.

---

## Locomotion feel (hero only, this slice)

Not a full AAA character controller. Minimum so the walk sells:

- Turn rate falls as planar speed rises (no instant spin at sprint).
- Jump: clip + existing `_vel.y`; land recovers through `JumpLand`, not a snap to Idle.
- Dodge: clip + short i-frame / velocity; not only `_vel += wish * 12.4`.
- Mixamo `animator.enabled = grounded` is forbidden.

Accel lerp may stay. Crouch / analog / lock-on are **out of slice**.

---

## Acceptance captures

All under `apps/concordia-living-world/unity-client/Captures/`. Fail the slice if any still shows sin-wave knees, polo-in-fantasy, floating geometry, a floater NPC, or an OnGUI kernel dump.

| File | Must show |
|---|---|
| `ps-walk-cycle.png` (or short webm) | Hero Idle→Walk→Run in Hub. Feet plant. No BipedHinge skating. Pelvis not buried |
| `ps-jump.png` | JumpStart in air, JumpLand on contact. Animator stays enabled |
| `ps-npc-pathing.png` | At least two Hub NPCs in Walk/Run clips on the plaza ring, not T-pose / mannequin idle while translating |
| `ps-hub-day.png` | Pack Hub, F8 off, compass + rings + one prompt |
| `ps-hub-night.png` | Same camera as day at night hour. Darkness + local lights. Not noon-minus-UI |
| `ps-slash.png` | LightAttack clip, not a forearm Euler |

**Playable bar (not optional):** 30 seconds of Hub walk where feet never slide, jump arcs read, land recovers, camera never shows a buried pelvis.

---

## Ban list (until this ticket is GREEN)

**no new megaworld** features until this ticket is GREEN.

Do **not** land any of the following while Playable Slice is OPEN:

- New megaworld / world-field / organism / settlement-chronicle / LOD / continent-streaming features
- New ConKay hologram / JARVIS stage work that touches the Unity client
- New talk-affinity / rumor / kingdom-audit systems whose only Unity surface is more OnGUI
- New fauna species, dungeon holds, or city kits whose bodies would join the puppet crowd
- Softening `grade-*` / detector baselines to make a rugged frame look scored
- Adding more `BipedHinge` / `ApplyPrimitiveGait` / Mixamo LateUpdate hinging
- Treating `concordia-sr2-streets.test.js`’s `BipedHinge` pin as sacred — replace it when clips win

Kernel docs (`CONCORDIA_PERSISTENT_MEGAWORLD` on stacked branches, organism tests, field math) stay **read-only**. Unity **reveals** that state after the walk is a walk.

Allowed while OPEN: this ticket’s ranks 1–8, visual P0 merge from PR #975, bugfixes that unblock clips (Humanoid avatar, grounding, AnimatorController).

---

## Art lock (rank 8)

If `docs/UNITY_ART_LOCK.md` is not on the branch yet, this sentence is the lock:

> Unity client fidelity = store-pack realism: Hub may wear one modern Rocketbox adult; every steel world wears that world’s imported costume (KayKit Knight / dress); architecture and foliage come from imported packs; URP lighting. Kenney / primitive / toon is a missing-prop fallback, never the look.

`docs/ART_STYLE_GUIDE.md` BotW/Palworld constants are retired for Unity.

---

## Explicitly not this slice

Continent streaming, organism tombstones, settlement chronicle, ConKay, talk affinity, more world-field samples, 7-day / 100-hour certification. Those make the *doc* dope. They do not make the *walk* dope.
