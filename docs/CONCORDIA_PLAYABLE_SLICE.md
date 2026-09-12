# Concordia Unity — Playable Alive Slice

**Status:** OPEN (ticket lock, 2026-09-12). Not green.  
**Pinned by:** `server/tests/concordia-playable-slice.test.js`  
**One-line verdict:** The simulation is alive in docs/server; the stage is mostly props. Playable-alive means **layer 3 is forced to express layer 1** — clips, grip, birds, fauna meshes, one NPC reaction — before another kernel law gets locked.

This is the only Concordia Unity work order until the acceptance captures below exist and the ban list is still holding.

---

## Owner sentence

**Playable Alive Slice = one Humanoid + `ConcordiaLocomotion` (Idle/Walk/Run/Sprint/JumpStart/JumpLand/Dodge/LightAttack), root motion off, zero LateUpdate bone hinging for locomotion, real palm grip (no root-parented weapons), Living Birds in Hub air (or cull), fauna real meshes or no spawn, one NPC reaction to sim truth proven in Capture, pack Hub, F8 HUD, one art contract.**

If a 60-second Hub walk still smells like a marionette, a stick glued to a hip, primitive doves, Kenney balloons, or a ticker that the bodies ignore, the slice is not green. Systems/kernel work does not count.

---

## Three layers that don’t share a body

1. **Kernel / docs** — megaworld laws, WorldField, organism birth/death, settlements/chronicle/consequences, kingdom snapshots, WorldMemory, CrossRing, talk/affinity. Rich, honest, locked.
2. **Unity AI stubs** — `NpcLife` / `FaunaLife` / `CourtBird` orbits. Thin wire. Mostly writes HUD strings.
3. **Pixels** — Rocketbox + primitives + ungeared hands + puppet gait. This is what the eye believes.

Alive means layer 3 expresses layer 1. Not more laws.

---

## Why this, not another kernel pass

The brain is ahead of the body. ExplosiveLLC / Kevin Iglesias / SoldierLocomotion / Living Birds sit on disk. Live bodies mostly run **procedural bone hinging**, **prop-glued weapons**, **primitive doves**, and a **town-diorama clock**. Humans smell a fake walk in half a second and a floating glaive immediately.

Checked against HEAD `concurrency-refactor` (2026-09-12), not memory:

### Walk is a puppet

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

### Weapons that aren’t gripped

`CharacterGear.Grip` parents a mesh to a hand Transform and aims the longest axis with `FromToRotation`. That’s prop-gluing, not gripping.

| Claim | Where it is true |
|---|---|
| No finger IK / hold pose | `Grip` is `SetParent(hand)` + `FromToRotation`. Hands stay open or idle. Blade floats through/near the palm. |
| Socket falls back to **root** | `CharacterGear.Attach`: `if (!socket) socket = body.transform`. Kenney / bad bind in `ModularPerson`: `leftHand = rightHand = body.transform`. Weapon parents to hip/chest. |
| Combat never re-grips | `Slash()` swings the upper arm with Eulers. Gear never re-grips, sheathes, or two-hands. |
| Captures match the code | Polo guy with a stick that never looks *held*. |

**Alive bar:** Weapon socket on palm + finger curl pose (or authored hold clip). If no hand bone → **don’t spawn a weapon**. Better empty hands than a floating glaive.

### Birds / fauna — pack on disk, toys in the sky

Living Birds Asset Store pack is on disk (`Assets/living birds`, `FreePacks.Bird()` → `lb_sparrow` / `lb_robin` / `lb_cardinal`). Hub does not use it.

| Claim | Where it is true |
|---|---|
| Hub air is primitive doves | `WorldBuilder.SpawnFauna`: **24×** `Dove{i}` + `CourtBird` = Sphere body + Cube wings on a sine orbit (`radius` 10–22, `height` 6.5+) |
| Grove birds only three, only two worlds | `DressGroveBirds` only Tunya/Fantasy, three stems |
| Missing fauna mesh → CourtBird | Non-Hub `SpawnFauna` rabbit/dog miss → Sphere + `CourtBird` |
| Evo stems are Kenney balloons | `EvoSpawner.StemFor`: wolf/hound → `Fox`, griffin → `Horse`, harpy → `Parrot`; miss → `CreatePrimitive` Sphere/Cube/Capsule |
| Behavior can be real | `FaunaLife` wander/graze/flee/hunt/sleep + WorldField retreat is a real little brain wearing the wrong body |

**Alive bar:** Living Birds prefabs in Hub air; fauna use real meshes or don’t spawn; disable `CourtBird` primitives in Captures forever.

### NPCs are spectators of the simulation’s press release

Plaza NPCs run `NpcLife` — a local hour schedule (sleep/work/stall/wander), walk-to-point, sit, talk proximity, `WorldClock.NoteAct("…")` lines for the HUD ticker. That’s a **town diorama clock**, not the kernel.

| Sim truth | NPC presentation |
|---|---|
| Settlement founded / abandoned | HUD / WorldBook overlay strings — bodies don’t flee, mourn, or leave |
| `world_consequences` / kills | Fauna may NoteKill; citizens don’t change jobs, trust, or routes |
| Kingdom `settlements[]` | Counted for status JSON; crowd roster stays authored spawn list |
| WorldField habitat / steel | FaunaLife samples field; ModularPerson crowd mostly ignores it |
| Organism / fauna-spawner | Parallel to CourtBird + Kenney rings; not one living ecology on screen |
| Talk / affinity / leverage | Panel works; body stays mannequin (no lean-in, gesture, look-at) |
| Weather / night | Clock text; NPCs don’t light lamps, go inside, or change cloth |

The ticker can say “Baron Hollow opens a shop” while the mesh doesn’t open anything.

**Alive bar:** One causal chain visible in 60s of play — e.g. kill in steel world → nearby NPCs flee or draw → chronicle line → same bodies still displaced when you return. Until then, “living world” is marketing over a schedule bot.

---

## Brutal order (do not reorder)

| Rank | Fix | Done when |
|---|---|---|
| **1** | Humanoid + real walk/run/idle clips (hero + NPCs). Same `ConcordiaLocomotion`. Jump/dodge/slash are clips. Zero LateUpdate bone hinging for locomotion | `ps-walk-cycle`, `ps-jump`, `ps-slash`, `ps-npc-pathing`. Empty dirt > mannequin crowd |
| **2** | Real hand grip + ban root-parented weapons | Palm socket + finger curl / hold clip. No `socket = body.transform`. No weapon if no hand bone. Capture `ps-grip` |
| **3** | Replace CourtBird primitives with Living Birds (or cull) | Hub air is `lb_sparrow` / `lb_robin` / `lb_cardinal` (or empty sky). `CourtBird` Sphere+Cube banned in Captures. Capture `ps-birds` |
| **4** | Fauna meshes that match FaunaLife (or don’t spawn) | No `StemFor` Fox-for-wolf / Horse-for-griffin / `CreatePrimitive` bodies with a living brain. Capture `ps-fauna` |
| **5** | One NPC reaction to sim truth (flee / shelter / mourn) | Proven in Capture: bodies move because the kernel did. Capture `ps-npc-react` |
| **6** | Hub pack architecture + night lights + debug HUD off | `ps-hub-day` / `ps-hub-night` / `ps-no-debug`. Grounding without the 4.5m hack. One art contract |

Ranks 4–8 of the first lock overlap visual P0 (PR #975) and are now **rank 6**. If that PR is merged, verify those captures, then spend the slice on **1–5**.

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

## Grip contract

- `CharacterGear.Attach` parents only to a resolved **hand bone**. If `leftHand` / `rightHand` is missing or equals `body.transform`, **return null** — do not spawn.
- Hold is a finger-curl pose or an authored hold clip on the same Humanoid. `FromToRotation` longest-axis is not a grip.
- `Slash` / sheathe / two-hand go through the controller (or a hold overlay), not forearm Eulers that leave the mesh floating.
- Kenney / bad-bind bodies do not get a sword glued to the root.

---

## Birds / fauna contract

- Hub `SpawnFauna` instantiates Living Birds prefabs (`FreePacks.Bird()` → `lb_sparrow` / `lb_robin` / `lb_cardinal`) or spawns **zero** birds. `CourtBird` primitive Sphere+Cube is retired from Hub and from Captures.
- `EvoSpawner.StemFor` maps to a real mesh of that kind, or `Spawn` returns null. Wolf is not a Fox. Griffin is not a Horse. Missing mesh is not `CreatePrimitive`.
- `FaunaLife` may stay. It must wear a matching body.

---

## One causal chain (rank 5)

Minimum, not a second kernel:

Pick **one** sim truth the plaza already has (a steel-world kill, a night hour, a consequence row) and make **the same bodies** do one visible thing: flee, draw, shelter, or mourn. Persist enough that returning still shows them displaced.

Do **not** add chronicle schema, affinity copy, or new megaworld laws to make this true. Wire the body to a fact that already exists.

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

All under `apps/concordia-living-world/unity-client/Captures/`. Fail the slice if any still shows sin-wave knees, polo-in-fantasy, floating geometry, a floater NPC, a root-parented weapon, primitive doves, Kenney-balloon fauna, or an OnGUI kernel dump.

| File | Must show |
|---|---|
| `ps-walk-cycle.png` (or short webm) | Hero Idle→Walk→Run in Hub. Feet plant. No BipedHinge skating. Pelvis not buried |
| `ps-jump.png` | JumpStart in air, JumpLand on contact. Animator stays enabled |
| `ps-npc-pathing.png` | At least two Hub NPCs in Walk/Run clips on the plaza ring, not T-pose / mannequin idle while translating |
| `ps-slash.png` | LightAttack clip, not a forearm Euler |
| `ps-grip.png` | Weapon in the palm, fingers curled or hold clip. Empty hands if no hand bone — never hip/chest glue |
| `ps-birds.png` | Hub air is Living Birds prefabs, or empty sky. No Sphere+Cube `CourtBird` |
| `ps-fauna.png` | A FaunaLife body whose mesh matches its kind, or no spawn. No Fox-for-wolf / primitive sphere with a brain |
| `ps-npc-react.png` | One causal chain: sim event → nearby NPCs flee/draw/shelter/mourn → ticker/chronicle agrees → bodies still displaced on return |
| `ps-hub-day.png` | Pack Hub, F8 off, compass + rings + one prompt |
| `ps-hub-night.png` | Same camera as day at night hour. Darkness + local lights. Not noon-minus-UI |
| `ps-no-debug.png` | No kernel dump overlay |

**Playable bar (not optional):** 30 seconds of Hub walk where feet never slide, jump arcs read, land recovers, camera never shows a buried pelvis.

**Alive bar (not optional):** 60 seconds of play where a weapon is held, Hub air is not primitive doves, fauna (if any) wear real meshes, and one NPC reaction to sim truth is visible.

---

## Ban list (until this ticket is GREEN)

**no new megaworld** features until this ticket is GREEN.

Do **not** land any of the following while Playable Alive Slice is OPEN:

- New megaworld / world-field / organism / settlement-chronicle / LOD / continent-streaming features
- More chronicle schema
- More affinity copy / talk-affinity / rumor / kingdom-audit systems whose only Unity surface is more OnGUI
- New ConKay hologram / JARVIS stage work that touches the Unity client
- New fauna species, dungeon holds, or city kits whose bodies would join the puppet crowd
- Softening `grade-*` / detector baselines to make a rugged frame look scored
- Adding more `BipedHinge` / `ApplyPrimitiveGait` / Mixamo LateUpdate hinging
- Treating `concordia-sr2-streets.test.js`’s `BipedHinge` pin as sacred — replace it when clips win
- Shipping `CourtBird` primitives, root-parented weapons, or `CreatePrimitive` fauna as “alive”

Kernel docs (`CONCORDIA_PERSISTENT_MEGAWORLD` on stacked branches, organism tests, field math) stay **read-only**. Unity **reveals** that state after the walk is a walk and the grip is a grip.

Allowed while OPEN: this ticket’s ranks 1–6, visual P0 merge from PR #975, bugfixes that unblock clips / grip / Living Birds / honest fauna skip (Humanoid avatar, grounding, AnimatorController, hand sockets).

---

## Art lock (rank 6)

If `docs/UNITY_ART_LOCK.md` is not on the branch yet, this sentence is the lock:

> Unity client fidelity = store-pack realism: Hub may wear one modern Rocketbox adult; every steel world wears that world’s imported costume (KayKit Knight / dress); architecture and foliage come from imported packs; URP lighting. Kenney / primitive / toon is a missing-prop fallback, never the look.

`docs/ART_STYLE_GUIDE.md` BotW/Palworld constants are retired for Unity.

---

## Explicitly not this slice

Continent streaming, organism tombstones, settlement chronicle schema, ConKay, more talk affinity copy, more world-field samples, 7-day / 100-hour certification. Those make the *doc* dope. They do not make the *stage* dope.
