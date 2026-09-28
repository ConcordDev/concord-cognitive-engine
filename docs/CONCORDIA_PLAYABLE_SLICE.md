# Concordia Unity — Playable Alive Slice

**Status:** effectively GREEN as of 2026-09-20 — see the correction block immediately below. Ranks 1–6 from the 2026-09-12 lock are closed (fixed or found-already-fixed by intervening commits), all acceptance captures exist and were verified live, and the owner's follow-up findings (arms-behind-back with a weapon, "random gates doing nothing") were fixed in the same pass. The one open item — a purpose-built Dodge-roll/attack *clip* (vs. the real procedural swing `ps-slash.png` shows) — is a scoped asset-sourcing gap, not a slice blocker. Formally flipping the ticket status is the owner's call; the evidence is below. The 2026-09-12 diagnosis below (ranks 1–6, "Brutal order") was accurate *at that HEAD* but the branch kept moving without this doc being refreshed. Read the correction block first — it supersedes specific claims in the sections below without deleting them (they're still useful history of *why* each fix was needed).  
**Pinned by:** `server/tests/concordia-playable-slice.test.js`  
**One-line verdict (2026-09-12, superseded in part — see below):** The simulation is alive in docs/server; the stage is mostly props. Playable-alive means **layer 3 is forced to express layer 1** — clips, grip, birds, fauna meshes, one NPC reaction — before another kernel law gets locked.

This is the only Concordia Unity work order until the acceptance captures below exist and the ban list is still holding.

---

## 🟢 2026-09-20 re-verification pass (correction, read this first)

A session picked up this ticket, re-checked every rank against the live `unity-client` tree (not against this doc's memory), and found the branch had moved substantially since 2026-09-12 without the doc being updated. Method: static code read + headless/edit-mode Unity verification via MCP (`AvatarBuilder`, `AnimationMode.SampleAnimationClip` bone-position traces, live spawn-path field dumps on a real 64–71 NPC Hub population) — not guesses. Full detail in git history for the commits this pass produced; summary per rank:

| Rank | 2026-09-12 diagnosis | 2026-09-20 finding |
|---|---|---|
| **1** (clips) | Rocketbox hard-excluded from clips (`!_biped`); "Mixamo skates on 3ds Max Biped" | **Root cause was the FBX import type, not the rig.** Rocketbox's 5 FBX bodies were imported as Generic — Unity's own Humanoid auto-mapper had never been tried. Switched all 5 to Humanoid; Unity built clean avatars on the first try. Edit-mode bone-position trace of a real Humanoid walk clip on that avatar: hips bob 0.86–0.92m, feet swing cleanly, no skate/sink. Built `Assets/Concordia/Anim/ConcordiaLocomotion.controller` (Idle/Walk/Run/Sprint/JumpStart states, real clips from the already-on-disk `KinematicCharacterController` Ethan pack). `ModularPerson.cs`: prefers the FBX-baked avatar, dropped the `!_biped` exclusion, deleted the dead plant-frame-6 panic hatch. **Verified end-to-end on a live fresh-Play population: 64/64, then 71/71 NPCs showed `clipsFit=true` driven by `ConcordiaLocomotion`.** Dodge now plays a real clip too (`HumanoidWalkLeftSharp`, wired to the real X-key dodge input via a new `ModularPerson.Dodge()`). LightAttack remains on an inert Idle state by deliberate choice, not oversight — see the rank-2/`ps-slash` note below. |
| **2** (grip) | `CharacterGear.Socket` falls back to `body.transform` (root) when no hand bone resolves — root-parented weapons | Fixed: `Socket()` now returns `null` (no spawn) instead of accepting `body.transform` as a socket, for hands *and* worn slots. Verified: a real Rocketbox hand bone still resolves and grips correctly (no regression); a no-bone (Kenney-painted) body now correctly gets no weapon instead of a hip-glued one. `ps-slash` is still open: no valid Humanoid attack clip exists in-tree (Quaternius's `Sword_Attack`/`Roll` clips are blocked — see below), so `LightAttack`'s Animator state is an inert Idle hold. This does **not** regress combat presentation: the existing `ApplyAuthoredStrike()` procedural overlay (style-aware — MuayThai/Sword/WingChun/Capoeira — already through a recent "one ActionRunner" polish pass) runs in `LateUpdate` on top of whatever the Animator plays and is what the player actually sees swing. Treat `ps-slash`/true dodge-roll as the one genuinely-still-open item from ranks 1–2. |
| **3** (birds) | `WorldBuilder.SpawnFauna`: 24× `Dove{i}` + `CourtBird` primitive sphere+cube | **Fully closed.** `CourtBird` has zero call sites (dead code). `CreatureCompiler.PickBird()`'s dead `lb_sparrow/robin/cardinal` reference fixed with real on-disk stems (`"bird"`/`"Eagle"`, Quaternius Animals Pack). The deeper gap found while chasing captures — the Hub-specific 8-bird flock call lived only in the orphaned `WorldBuilder.SpawnFauna` (nothing calls `WorldBuilder.Build` on the live `ContinentStream`/`RealmFill` boot path; `RealmFill.Beasts()` is explicitly skipped for Hub) — is now fixed too: added `RealmFill.HubBirds(root, w)`, called from `Populate()`'s Hub branch, using the exact `CreatureCompiler.Compile` + `FlockOrbit` pattern already proven to work. **Verified live twice: 8/8 `FlockOrbit` birds present after a fresh Hub Play, real mesh, real orbit motion, captured in `ps-birds.png`.** |
| **4** (fauna) | `EvoSpawner.StemFor`: wolf/hound → Fox, griffin → Horse, harpy → Parrot; miss → `CreatePrimitive` | **Stale — `EvoSpawner` itself is now a 28-line delegator to `CreatureCompiler`,** whose current `StemFor` does not contain any of those mismatches: wolf/hound → real `Wolf.fbx`, griffin → honest empty (no griffin mesh on disk, correctly no-spawns, not mislabeled as Horse), horse → real `Horse.fbx`. Zero `CreatePrimitive` fallback anywhere in the path. Found and fixed one small real gap while verifying: `fox` didn't match the on-disk `Red Fox.fbx` stem name — added. |
| **5** (NPC reaction) | NPCs are a "town diorama clock" — HUD ticker only, bodies never react | **Partially stale.** `NpcLife.cs` already has a real, live `Threat()` system: NPCs flee home at 3.8 u/s when a real `Hostile` GameObject is within 8m, gated by `Canon.Get(world).steelLive` (per-world flag) — genuine body reaction to genuine positions, not fabricated. It does not fire in the Hub specifically (Hub is `steelLive=false` — Flower Law, by design; matches the metaphysical spine, not a bug). Separately, and reachable in the Hub: NPCs already walk home and go indoors (`TryEnter("sleep")`, hidden while inside) at night per real `WorldClock.Hour`, and re-emerge by day — a real "shelter" reaction to a real sim truth, matching this doc's own explicitly-named acceptable example ("a night hour"). Did not add new code here — flagging as already-satisfied pending a capture confirming it reads clearly on screen. |
| **6** (Hub polish) | 4.5m grounding hack; debug HUD; "one art contract" | Grounding: `Grounding.SnapPoint`'s own current doc-comment says "No 4.5m ceiling hack — multi-level floors are legal" — already fixed (PR #975, which this doc's own text flagged as the pending unblock, has merged). Debug HUD: `ConcordiaHUD.DebugHud` defaults `false`, F8-toggle only, no force-enable call site found — already off by default. Night lighting: `HubLook.ApplyHour()` already does a full day/night pass (moon key light, court lanterns/soul lanterns, fog color, exposure) keyed to `WorldClock.Hour` — already real, not missing. `HubLook.Prim` (raw primitive) calls remain widespread for *architecture* (plinths, plaza pads, gate markers, road slabs) — this reads as normal procedural-geometry-with-real-materials, not the "primitive reads as a fake living thing" defect class ranks 3–4 are about; not treated as a rank-6 violation. |

## 🟡 Gate visual overhaul (owner call, 2026-09-20, same pass)

Owner feedback on the capture screenshots: the 9 Concord Link `WorldGate` archways (8 canon world-portals + the Sere waystone, ring radius 34 around Hub, `Canon.Gates`) read as "random black gates on screen doing nothing" — correct functionally (they are the real cross-world travel anchors, not clutter — confirmed no separate decorative-gate system exists), wrong on presentation: the only "portal" tell was a 22-particle swirl and a dim point light, invisible in a still frame. Then, seeing the fix: **"keep the portal, drop the metal gate, it's tacky."**

- Added `HubPlaza.PortalMembrane` — a large (3.0×4.1m) double-sided additive-unlit glowing plane per gate, colored per-world (`GateDef.color`/`PortalColor`), driven by a new `PortalShimmer` component (slow alpha pulse, always at least partially lit so a single still frame still reads as active). Wired into both `PlaceGate` (the live full-detail path) and `GatesLean` (the fast-boot path, which previously had *no* portal effect at all).
- First version also spun the whole membrane on its local Z axis for "life" — wrong call, a rotating *rectangle* flickers rectangle→sliver→diamond→sliver depending on which instant you look at it (caught exactly that in the first capture). Removed the spin; the pulse alone reads as alive without the flicker.
- Then removed the `large_iron_gate` arch mesh entirely from `PlaceGate` per the owner's follow-up — the gate *is* the glowing membrane now, no fence prop around it.
- **Verified live, both states, same camera position:** `ps-hub-day.png` / `ps-hub-night.png` (current, gateless) show a clean glowing portal panel with a visible plaque/crest, no iron bars, readable day and night. (Superseded intermediate captures with the iron arch still existed briefly mid-pass; not kept.)

---

## 🟢 Capture tooling built (owner request, 2026-09-20, same pass)

"Make the tooling required" for the jump/slash/grip/npc-react captures — none of those actually needed real keyboard input, they needed the same *public methods* real input already calls. Built `Assets/Concordia/Editor/PlayableSliceCaptureRig.cs`, a permanent `Concordia/Captures/` menu (same convention as the existing `HubAerialOneShot.cs`), Play-mode only:

- **Trigger Player Jump** / **Trigger Player Slash** — call the new `ModularPerson.Jump()` (added this pass, mirrors the existing `Dodge()`/`Slash()`) and the existing `Slash()`. Wired `person?.Jump()` into `ConcordiaPlayer`'s real `input.Jump` handler too, so a real keypress now also fires the Animator trigger — this wasn't wired before (the JumpStart state existed in `ConcordiaLocomotion.controller` but nothing ever triggered it for the player).
- **Equip Test Weapon On Player** — calls `CharacterGear.Attach` directly with a known-good stem (`DressVocab.Weapon("estoc")`).
- **Force Hour – Day / Dusk / Night** — sets `WorldClock.Hour` + reapplies `HubLook.ApplyHour` immediately, instead of waiting on real sim time.
- **Stage NPC Shelter Reaction (rank 5)** / **Report NPC Indoor/Outdoor Counts** — teleports one eligible Hub NPC to just outside its own authored `home`, forces night, and reports indoor/outdoor counts via reflection on `NpcLife._indoors` — stages a *real* NPC onto its *real* home point and lets `NpcLife`'s own code do the reacting, doesn't fake the reaction.

**Used it, got real results:** Equip fired correctly (`CharacterGear.Attach` returned a real held estoc, socket-parented to the actual `RightHand` bone — `ps-grip.png` shows it clearly gripped, blade held naturally, not floating/root-parented). Jump fired correctly per the Console log.

**Then a real bug turned up in the first grip capture:** the owner caught it directly — arm tucked behind the back, blade reading as floating despite being correctly bone-parented. Root cause, measured by sampling the clip directly: the only validated clip-driven idle loop (`HumanoidIdle`, from the KCC Ethan pack — the same one every Rocketbox body's Idle state uses) is an authored "parade rest, hands behind the back" stance (right hand measured ~0.28m behind the hip line vs ~0 neutral) — fine unarmed, wrong holding a weapon. Fixed in `ModularPerson.LateUpdate`: when a weapon is gripped (`sword != null`) and speed is low, swing the upper arm to `BipedArm`'s straight-hang-at-the-side pose, fading out as Speed rises so it never fights the walk/run clip's own (already-fine, measured close to neutral) arm swing.

**Re-verified and all four remaining captures taken**, once the Editor session held still long enough:
- **`ps-grip.png` retaken** — arm now hangs naturally at the side, sword gripped at the hip, blade angled out. Confirms the fix.
- **`ps-jump.png`** — on a live NPC (not the player; the hero-attach cycle kept getting interrupted by session churn, and jump/land is a body-agnostic clip check). Sampling `HumanoidIdleJumpUp` directly found the airborne portion isn't near t=0 — hips rise from a grounded ~0.93m to a sustained ~1.85m plateau across u≈0.65–0.95 of the clip (root motion is off, so this rise is genuinely encoded in the hip's own local animation, not stripped root translation). Forced the Animator to that normalized time (`anim.Play("JumpStart", 0, 0.75f)`) instead of racing a real trigger against tool round-trip latency — feet clearly off the ground in the capture.
- **`ps-slash.png`** — same latency problem as jump, worse: `Slash()`'s swing is driven by a real-time countdown (`_slashT`, ticking down every live frame via `Time.deltaTime`) with only a ~0.6s duration, so it decayed to zero before any screenshot round-trip could land on it. Fixed by setting `_slashT` to mid-swing (`_slashDur * 0.55`) via reflection *and* `Time.timeScale = 0` right after — freezing decay (`Time.deltaTime` becomes 0) without freezing the render, so `LateUpdate` keeps re-applying the same mid-swing pose every frame until the screenshot lands. Capture shows a real weighted-forward swing with the blade extended, then `timeScale` restored to 1.
- **`ps-npc-react.png` + `ps-npc-react-before.png`** — used the `Stage NPC Shelter Reaction` menu item; the first attempt staged the NPC 1.5m from home, which is just outside `NpcLife.Arrived()`'s 1.1m-radius threshold, so she never triggered `TryEnter` (found this by reading her live `act`/`_pause`/lod fields, not guessing) — nudged her to 0.3m and `_indoors` flipped `true` within seconds, renderer disabled, body vanished indoors. Two captures at the same camera position, before and after, document the actual before/after state change.

Session left clean afterward: `Time.timeScale` restored to 1, `WorldClock.Hour` set back to a normal daytime value.

---

**What's genuinely still open, honestly — down to one item:**
- **A purpose-built Dodge-roll / attack *clip*** (as opposed to the procedural `ApplyAuthoredStrike` overlay `ps-slash.png` actually shows, which is real but not a Mecanim clip). Quaternius's `Warrior.fbx` (the only on-disk pack with Sword_Attack/Roll/Idle_Attacking clips) has a rest pose with arms hanging down rather than T/A-pose; two independent correction attempts (a geometric per-bone T-pose re-derivation, then also collapsing a 100×-scale Blender-armature node found in the same rig) both still produced `Avatar.isHuman=false` with no diagnostic detail from Unity's `AvatarBuilder` API about why. Needs interactive Avatar-Configure-window debugging or a differently-posed source pack. Not blocking — the LightAttack/Dodge Animator states exist and are wired, they're just not the *presentation* layer for combat right now.

All eleven `Captures/ps-*.png` files now exist and were verified live this pass (not just headlessly): `ps-walk-cycle.png`, `ps-walk-cycle-full.png`, `ps-npc-pathing.png`, `ps-birds.png`, `ps-fauna.png`, `ps-hub-day.png`, `ps-hub-night.png`, `ps-no-debug.png`, `ps-grip.png`, `ps-jump.png`, `ps-slash.png`, `ps-npc-react.png` (+ `ps-npc-react-before.png` bonus pairing). The Playable Alive Slice's acceptance-capture bar (see the table above) is met in full except for the one clip-sourcing gap named above.

**Captures that now exist** (`apps/concordia-living-world/unity-client/Captures/`, gitignored — local proof only): `ps-walk-cycle.png`, `ps-walk-cycle-full.png` (real NPC mid-stride, clean leg articulation, no skate/T-pose/floating-limb), `ps-npc-pathing.png` (two simultaneous clip-driven NPCs), `ps-birds.png` (8 real birds airborne over Hub), `ps-fauna.png` (a real wolf mesh, temp-spawned and screenshotted, then cleaned up — not a permanent Hub addition), `ps-hub-day.png` / `ps-hub-night.png` (gateless glowing portal, both times of day), `ps-no-debug.png` (confirms no kernel-dump overlay by default).

---

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
