# Visual QA — Godot World Lens

**This project has never been opened in a real Godot editor or renderer.**
Validation to date is **parse-and-lint-only** (`gdtoolkit` `gdparse` + `gdlint`,
all clean). The agent proxy blocks the Godot headless binary download, so
engine-import validation was not possible.

This file is the queue of every claim that requires **eyes on a real machine**
before it can be asserted anywhere. **No document in this repo — including
`docs/GODOT_INTEGRATION.md` — makes any visual-quality claim. All such claims
live only here, unverified, until checked off below.**

## How to run the QA pass

1. Install Godot 4.4.x (editor + export templates) on a machine with a GPU.
2. `godot --path world-lens-godot --editor` (or open the project in the editor).
3. First: `godot --headless --path world-lens-godot --import --quit` and fix any
   import errors — this is the engine-import validation the CI proxy blocked.
4. Point `boot.gd`'s `gateway_url` / `auth_token` / `world_id` at a running
   Concord server **with the gateway mounted** (see the Integration TODO in
   `docs/GODOT_INTEGRATION.md` — the gateway is not mounted yet).

## Checklist (all UNVERIFIED)

### Engine / project
- [ ] Project imports without errors (`--import --quit` exits 0).
- [ ] `boot.tscn` opens as the main scene; `boot.gd` runs `_ready` without runtime errors.
- [ ] No missing-resource warnings for the `preload` paths in `boot.gd`.

### Networking
- [ ] `GatewayClient` connects to a live `/godot-ws` and receives `hello` after `auth`.
- [ ] Reconnect/backoff behaves sanely after a server restart (1s→30s cap, jitter).
- [ ] `room:join world:<id>` succeeds and world events arrive in the room.
- [ ] Malformed / oversized inbound frames do not crash the client.

### Scene rendering
- [ ] `scene:request` → placeholder BoxMesh geometry appears.
- [ ] Placeholder boxes render at the **correct position / rotation / scale**
      versus the Three.js client for the same world (side-by-side).
- [ ] `rotationY` maps correctly (Y-up parity; no axis flip).
- [ ] `scale = [w, h, d]` footprint matches the building's real dimensions.
- [ ] `{ok:false}` scene payloads are handled honestly (no phantom geometry).

### Assets
- [ ] `GlbLoader` downloads and displays a real `.glb` correctly.
- [ ] `AssetResolver` resolve-endpoint path returns a usable URL; static fallback
      404s honestly (no fabricated asset).
- [ ] GLB cache returns visually-identical instances on repeat load.

### Interpolation (Phase 2 dependent)
- [ ] `SnapshotBuffer` sampling at now−120ms is visually smooth at real latency.
- [ ] Shortest-arc heading lerp does not spin the long way around at the ±PI wrap.
- [ ] Entities that vanish from a snapshot hold their last pose (no teleport-to-origin).

### Overall feel
- [ ] Framerate / draw-call budget acceptable for the target world size.
- [ ] Reconnect UX (visible state, no frozen frame) is acceptable.

### Phase 2 — Chunk streaming, LOD, and movement (added this pass; see `PHASE2_CLIENT.md`)

All of these are structurally complete (parse+lint clean, pure functions
covered by `tests/`) but **have never run inside a real Godot process.**
Nothing below has been asserted anywhere else in the repo.

- [ ] `ChunkManager.update()` actually issues `ResourceLoader.load_threaded_request`
      calls that resolve, and `poll()` correctly drains them into `chunk_ready`.
- [ ] Chunk load/unload as the player crosses a 100m boundary produces no
      visible pop-in/pop-out flash, hitch, or double-load race.
- [ ] `chunk_manager.gd`'s placeholder `scene_path_template` — `res://world/chunks/chunk_%d_%d.tscn` —
      doesn't exist as real content yet; this needs a real chunk-scene asset
      pipeline before streaming can be observed at all, not just tuned.
- [ ] `LodPolicy.apply_to_instance` actually changes `GeometryInstance3D.visibility_range_begin/end`
      the way Godot's renderer expects (fade margins, `VISIBILITY_RANGE_FADE_SELF` /
      `_DEPENDENCIES` interaction — the pure funcs only compute begin/end, they
      don't touch fade-mode, which this pass left at the engine default).
- [ ] LOD band transitions (50m/200m/500m/600m) read as smooth banding, not a
      jarring mesh pop, at real framerate and real asset complexity.
- [ ] `PropInstancer.build_multimesh` renders the expected number of visible
      instances at the expected transforms — this pass never rendered a
      single MultiMesh.
- [ ] `CharacterController` movement FEEL: does jumping with `COYOTE_MS=120`
      / `JUMP_BUFFER_MS=130` actually feel forgiving-not-floaty at 60fps input,
      matching how the Three.js/Rapier client feels for a human tester (the
      numbers are copied exactly from `physics-world.ts`/`jump-forgiveness.ts`,
      but "same numbers" is not the same claim as "same felt experience" until
      a person plays both back to back).
- [ ] Glide (`GLIDE_DESCENT_CAP=-1.5`, `GLIDE_HORIZ_BOOST=0.08`) and swim
      (`SWIM_BUOYANCY=4.5`, `SWIM_GRAVITY=1.2`) integration reads correctly
      against Godot's own gravity/physics-tick semantics — this pass
      hand-integrates vertical velocity exactly like `physics-world.ts` does,
      but Godot's `CharacterBody3D.move_and_slide()` collision resolution is a
      different code path than Rapier's `computeColliderMovement`, so the
      *composition* of "hand-integrated velocity + engine collision response"
      has never been observed, only each half separately.
- [ ] Raw-keycode WASD polling (`Input.is_key_pressed(KEY_W/A/S/D)`) actually
      drives visible movement — this intentionally bypasses Godot's InputMap
      action system (no bindings exist in `project.godot` yet; see the
      code comment in `player/character_controller.gd` for why), so remapping
      / gamepad support does not exist until a real input-adapter layer is
      built and verified on a real machine.
- [ ] `player:move` frames sent through `GatewayClient.send_event` actually
      reach a live `/godot-ws` gateway and produce a real `player:move:nack`
      to test the snap-back path against — **the server-side gateway is not
      mounted yet** (see `docs/GODOT_INTEGRATION.md`'s Integration TODO), so
      this entire path is unreachable end-to-end until that mount happens.
      The pure `snapback_position` logic is unit-tested against a
      hand-constructed nack payload only, never a real one.
- [ ] `tests/run_all.gd` and every `tests/test_*.gd` file actually execute
      and pass under `godot --headless --path world-lens-godot --script res://tests/run_all.gd`
      — they have only ever been `gdparse`d, never run. It is possible (if
      unlikely, given how mechanical the mirrored math is) that a real engine
      surfaces a runtime error (typed-array coercion, `String.join` signature
      mismatch, etc.) that static parsing cannot catch.

### DTU props (master-spec §3.3, units B6-B9 — `world/dtu_prop_renderer.gd` / `world/dtu_prop_interaction.gd`)

- [ ] `DtuPropRenderer.fetch_placements()` actually reaches a live
      `POST /api/lens/run` `{domain:"dtu_props", name:"list"}` and spawns one
      node per placement — **the `dtu_props` macro domain is built
      (`server/lib/dtu-props.js` + `server/domains/dtu-props.js`, both
      contract-tested server-side) but NOT wired into `server.js`'s
      `register()` call table** (see the STATUS note atop
      `server/domains/dtu-props.js`), so this path is unreachable end-to-end
      until that two-line wiring lands. Only the pure request-shape/transform
      helpers are unit-tested (`gdparse`-only) today.
- [ ] Placeholder box tint/size actually reads as visually distinct
      shelf-vs-counter-vs-window-vs-rooftop-vs-plaza at a glance, not just in
      the `Color`/`Vector3` values asserted by the pure tests.
- [ ] A resolved `.glb` (when `AssetResolver`/`GlbLoader` succeed) actually
      replaces the placeholder box in the live scene tree without a visible
      pop/flash, and the placeholder is correctly freed.
- [ ] `DtuPropInteraction.handle_click`'s physics raycast actually selects
      the intended prop in a populated 3D scene (untested past the pure
      `find_prop_ancestor` ancestor-walk, which only exercises plain `Node`
      trees, never a real `PhysicsRayQueryParameters3D` hit against a
      `CollisionShape3D`-bearing prop).
- [ ] Interact round-trip (`take`/`leave`/`arrange`) against a real running
      server: honest rejection reasons (`citation_consent_not_granted`,
      `not_owner`, `not_holding`) surface legibly to a human player, not just
      as a raw string in `interact_failed`.

---

### Game Design Lens — `design_command` first slice (D17 — `design/design_command_client.gd`)

- [ ] `DesignCommandClient.send_command(...)` actually reaches a live
      `/godot-ws` connection and a real `design_command:result` frame comes
      back — proven server-side end-to-end
      (`server/tests/godot-gateway-integration.test.js`, real ws client +
      real booted server + real SQLite/STATE assertions), but this GDScript
      file itself has never sent a frame to a live server or run inside a
      real Godot process; only `gdparse`/`gdlint` confirm it loads.
- [ ] `command_result`/`command_failed` signals actually reach a UI listener
      in a real scene tree (this unit ships no UI — D18's visual
      placement/authoring surface is the thing that would consume these
      signals; today nothing in the project connects to them).
- [ ] Extending `DESIGN_COMMAND_ACTIONS` (server-side) to the remaining ~36
      `gamedesign.js` macros, and building the actual click-to-place
      authoring UI in the 3D viewport, is unstarted — D18 scope.

---

### Avatar rig + locomotion (Migration M1 — `avatar/avatar_rig.gd` /
`avatar/animation_state_machine.gd` / `avatar/avatar_manager.gd`)

- [ ] `AvatarRig`'s primitive placeholder (capsule sockets per `bone_specs()`)
      actually reads as a legible humanoid silhouette, not a scattered pile of
      capsules — the pure `bone_world_offset()` math has never been seen
      rendered; an authoring mistake in one offset would only show up
      visually.
- [ ] GLB resolution (`_try_resolve_glb` → `AssetResolver`/`GlbLoader`, already
      QA-queued above) swaps cleanly onto a rig spawned by `AvatarManager`
      specifically — the reuse of those two nodes per-rig (one
      `HTTPRequest`-driven resolver + loader per avatar) has never been load-
      tested with more than a handful of concurrent avatars; a real world
      scene with dozens of remote players/NPCs resolving GLBs simultaneously
      could behave very differently than the pure logic implies (request
      fan-out, cache contention, memory).
- [ ] `animation_state_machine.select_state()`'s six locomotion states
      (idle/walk/run/jump/fall/land) have never been mapped onto real
      animation clips or even watched as a blend-weight number change while a
      capsule rig moves — this migration unit stores the decision
      (`AvatarRig.set_locomotion`) but wires no `AnimationPlayer`/
      `AnimationTree` to it yet. Whether the chosen `RUN_MIN_SPEED = 8.5`
      inference midpoint (see that file's own header comment on why it's an
      inference, not a mirrored constant) actually feels right for a remote
      avatar's run/walk read has NEVER been observed — it is a documented,
      reasoned guess, not a measured one.
- [ ] `AIRBORNE_VY_EPS = 0.3` (avatar_manager.gd) — the threshold that
      classifies a remote avatar's INTERPOLATED vertical velocity as
      "airborne" — has never been checked against real terrain-follow noise
      (a remote avatar walking over uneven ground could, in principle, false-
      trigger "jump"/"fall" if the terrain height sampling is noisier than
      assumed; there is no engine here to generate that noise and observe
      the threshold's behavior against it).
- [ ] `LAND_HOLD_MS = 150`'s transient "land" pose has never been seen —
      whether 150ms reads as a satisfying landing beat or is too
      short/long to register at all is unverified.
- [ ] `AvatarManager`'s despawn-on-staleness (`STALE_TIMEOUT_MS = 3000`) has
      never been observed against a real disconnect/reconnect or a player
      leaving render distance — whether 3s reads as "instant enough" or
      leaves a visible frozen ghost briefly is unverified.
- [ ] Whichever rig ends up under `player/character_controller.gd` (this unit
      does not wire that mount — the LOCAL player's presentation layer is
      out of scope here, see the module header comments) has never been
      confirmed to actually look right attached to a physics-driven
      `CharacterBody3D` versus a directly-positioned remote puppet.

---

### Procedural gait + foot IK (Migration M2 — `avatar/gait_solver.gd` /
`avatar/two_bone_ik.gd` / `avatar_rig.gd#apply_gait`)

The phase/foot-target/IK-angle MATH is pure and numerically cross-checked
(the two_bone_ik round-trip and edge-case-clamp claims were independently
verified with an equivalent standalone Python re-implementation of the same
formulas before being committed to GDScript, precisely because the real
engine can't run these tests here) — but nothing about how it *looks* on an
actual skeleton has been seen:

- [ ] `apply_gait()`'s per-frame walk/run leg motion, applied to the
      primitive placeholder's flat Node3D sockets via `_apply_bone_angle`,
      has never been rendered — whether the hip/knee angles this produces
      read as a believable walk cadence (vs. too stiff, too bouncy, or
      obviously not touching the ground on contact) is completely unproven.
      The pure math is unit-tested (`tests/test_gait_solver.gd`); nothing
      about how it looks in motion is.
- [ ] `LIFT_HEIGHT_M = 0.12` (`gait_solver.gd`) — the swing-phase foot
      clearance height, which has NO Three.js source to mirror (see that
      file's own header note) — is an unverified reasoned guess; whether it
      reads as a natural step versus a stomp or a shuffle is unknown.
- [ ] `PHASE_STRIDE_LEN_M = 0.75`, ported byte-for-byte from
      gait-synthesis.ts's `BODY_STRIDE_LENGTHS.average`, governed a
      TOTALLY DIFFERENT rendering pipeline there (FK bone rotation, not an
      IK effector target) — whether the same number still "reads right" once
      it's driving foot-target IK on a physically different rig (this
      port's primitive capsule sockets, not the Three.js client's actual
      skinned mesh) has never been checked side by side.
- [ ] Skeleton3D bone-name lookup in `_apply_bone_angle` (the branch that
      fires once a real GLB has resolved and repointed `_skeleton`) has
      never run against an actual named `Skeleton3D` — whether a real
      imported humanoid GLB's bone names line up with `bone_specs()`'s
      naming (`leftUpperLeg`/`leftLowerLeg`/`leftFoot`/etc.) at all is
      unknown; a mismatch would silently fall through to the primitive-
      socket branch with no error (by design — see the function's own
      "never fabricates a bone that isn't really there" comment — but that
      also means a real name mismatch would be silent, not a loud failure,
      until someone watches it).
- [ ] `two_bone_ik.gd`'s sagittal-plane simplification (X always ignored)
      has never been checked against a GLB rig that might expect real
      3-axis hip rotation (abduction/adduction, axial rotation) for a
      convincing walk from side-on camera angles, vs. the head-on/45-degree
      angles this simplification was reasoned against.
- [ ] `apply_gait`'s "idle plants both feet, everything else runs the same
      ground-gait cycle" simplification (no distinct jump/fall/land leg
      pose) has never been watched during an actual jump — whether the legs
      visibly keep walking mid-air (which would look wrong) is unverified.

---

---

### Mobility controllers (C10/C13 — `avatar/flight_controller.gd` /
`avatar/ground_vehicle_controller.gd` / `avatar/mount_controller.gd`)

All three ported physics cores were independently cross-checked against a
standalone Node.js re-implementation of the same formulas before being
committed (same discipline M2 used with an equivalent Python re-check for
`two_bone_ik.gd`) — the MATH is numerically verified. Nothing about how any
of it feels or looks in Godot's own physics/renderer has been observed:

- [ ] `FlightController` — does powered flight (bank → yaw drift, dive-gain
      airspeed, stall + nose-down recovery) feel like the intended
      "superhero flight" read, or too floaty/twitchy, at real framerate with
      real input latency? The numbers are ported byte-for-byte from
      `flight-physics.ts` (which itself only ever drove a HUD, never a
      real 3D body) — "same numbers" has never been checked against a real
      `CharacterBody3D.move_and_slide()` composition.
- [ ] `FlightController`'s raw-keycode roll/pitch mapping (A/D roll, W/S
      pitch) has never been flown — whether this control scheme reads as
      intuitive for a keyboard-only tester, or wants a different axis
      mapping / mouse-look, is unknown.
- [ ] `FlightController`'s honest-zero wind sample (see its own header note)
      means flight will feel perfectly still-air smooth even over a world
      that server-side `wind-currents.js` would report as gusty — that gap
      itself needs eyes to confirm it reads as "obviously calm" rather than
      "broken," until a future unit wires the real sample.
- [ ] `GroundVehicleController` driving a "car" — does throttle/steer/brake
      feel responsive against Godot's own collision response
      (`move_and_slide()`), or does the CharacterBody3D fight the hand-
      integrated velocity in a way the pure kinematics never modeled (the
      pure math has no notion of Godot's collision impulses)?
- [ ] `GroundVehicleController`'s pure core also covers "glider"/"plane" for
      a future C12 unit to reuse directly — neither has ever been driven in
      Godot; whether the lift/pitch/gravity composition reads as flight-like
      once a real body is doing the moving (vs. this unit's math-only
      verification) is unproven.
- [ ] `MountController`'s arc-turn kinematics (`yaw_rate = steer * speed /
      turn_radius_m`) are a REASONED ADDITION with no TS/JS source to
      compare against (see the file's own header) — whether a warhorse
      (turn_radius_m=4.0) actually reads as "harder to turn than" a dire
      wolf (turn_radius_m=3.0) at real framerate, or whether the effect is
      too subtle/too strong to notice while riding, is completely unverified.
- [ ] `MountController`'s ground-clamp gravity integration (a simple
      `is_on_floor()` check + `GRAVITY` fall, with no jump/glide/swim
      states unlike `player/character_controller.gd`) has never been ridden
      over real terrain — slopes, stairs, or uneven ground could expose
      awkward vertical popping that the flat pure math can't predict.
- [ ] All three controllers' `player:mode`/`player:move` gateway traffic has
      never reached a live server — the `set_flight_active`/
      `set_driving_active`/`set_riding_active` request→ack/nack round-trip
      is only unit-tested against hand-constructed nack payloads (mirroring
      `CharacterController.snapback_position`'s own existing test gap), never
      a real `player:mode:nack` from `applyPlayerMode`.
- [ ] None of the three controllers have any VISUAL representation wired
      (no mesh, no mounted-rider pose, no vehicle chassis model) — this unit
      is movement math + netcode only; a rider/vehicle/flying-avatar body is
      a separate, still-queued presentation unit.

---

Until every box above is checked on a real machine, treat the Godot client as
**structurally complete but visually unproven.**
