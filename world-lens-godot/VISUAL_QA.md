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

---

Until every box above is checked on a real machine, treat the Godot client as
**structurally complete but visually unproven.**
