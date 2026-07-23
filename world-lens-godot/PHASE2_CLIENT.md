# Godot World Lens — Phase 2: client-side streaming, LOD, and movement

**Status: built, parse/lint-clean, unit-tested logic — NOT run in a real
engine, NOT wired to a live server.** This note describes what landed in
this pass. It intentionally does not touch `docs/GODOT_INTEGRATION.md`
(server-side unit, edited concurrently elsewhere) — see that doc for the
Phase 1 gateway/network-foundation architecture this phase builds on top of.

## What this pass is

Phase 1 shipped the network foundation (raw-WebSocket gateway client,
interpolation buffer, scene bootstrap, asset loaders). Phase 2 adds the
client-side systems a native Godot world actually needs to feel like a
world rather than a single static scene: chunk streaming, level-of-detail,
instanced props, and a CharacterBody3D player controller with the same
kinematic feel as the existing Three.js/Rapier client.

Every numeric constant below was pulled from the **actual Three.js source**
(`concord-frontend/lib/world-lens/physics-world.ts`,
`concord-frontend/lib/world-lens/jump-forgiveness.ts`,
`concord-frontend/lib/world-lens/lod.ts`) and the **actual server source**
(`server/lib/city-presence.js`, `server/server.js`'s `player:move` socket
handler) — read, not guessed, per CLAUDE.md's compute-don't-guess principle.
No number in this phase was invented.

## Files added

| File | Role | Pure vs. engine-gated |
|---|---|---|
| `world/chunk_manager.gd` | Grid-keyed chunk streaming: computes the desired chunk ring around the player, diffs it against what's loaded, drives `ResourceLoader.load_threaded_request`/`load_threaded_get_status`/`load_threaded_get`. | Coordinate math (`world_to_chunk`, `chunk_load_set`, `diff_chunk_sets`) is pure static. The threaded-load orchestration (`update`/`poll`) is engine-gated. |
| `world/lod_policy.gd` | Pure distance→band decisions mirroring Godot's `visibility_range_begin/end` model, banded EXACTLY like `lod.ts`'s `STANDARD_LOD_BANDS` (50/200/500m) + its `distanceCullMeshes` cull distance (600m). | Fully pure except `apply_to_instance`, a one-line wrapper that writes the computed range onto a real `GeometryInstance3D`. |
| `world/prop_instancer.gd` | MultiMesh-based instancing helper for repeated DTU props (assembles a transform list, then builds a `MultiMesh`/`MultiMeshInstance3D`). | Transform-list assembly (`build_transforms` + helpers) is pure static. `build_multimesh`/`build_instance` touch real `MultiMesh`/`MultiMeshInstance3D` resources. |
| `player/character_controller.gd` | `CharacterBody3D` player movement: gravity, jump with coyote-time + jump-buffer + variable height, glide, swim. Streams `player:move` intent through the injected `GatewayClient` at ≤30Hz and snaps back on `player:move:nack`. | All the actual movement MATH (gravity/glide/swim integration, jump-forgiveness gates, the 30Hz send-gate, nack position selection) is pure static. `_physics_process`, `_ready`, input polling, and `move_and_slide()` are engine-gated. |
| `tests/test_utils.gd` | Minimal assert-collector (no gdUnit4 dependency) so the pure functions above have a runnable-once-an-engine-exists test surface. | N/A (test infra). |
| `tests/test_chunk_manager.gd`, `tests/test_lod_policy.gd`, `tests/test_prop_instancer.gd`, `tests/test_character_controller.gd` | One suite per module above, covering every pure function's boundary cases (chunk-edge flooring, ring sizes, diff correctness; band boundaries with no gaps/overlaps; missing-field fallback honesty; gravity/glide/swim integration values; coyote/buffer/cut-jump timing; throttle gate timing; nack snap-back honesty on missing/malformed `prev`). | Pure logic only — see "Testing" below for why these have never actually executed. |
| `tests/run_all.gd` | Headless aggregator: `godot --headless --path world-lens-godot --script res://tests/run_all.gd` runs all four suites and exits non-zero on any failing check. | Engine-gated (needs a real `godot` binary to run at all). |

## Design choices worth flagging

- **Chunk grid matches the server's own grid.** `ChunkManager.CHUNK_SIZE = 100`
  is not an arbitrary streaming-radius pick — it's the exact value of
  `server/lib/city-presence.js`'s `CHUNK_SIZE`, the same constant the server
  uses to compute `chunkCrossed` on a `player:move:ack`. A client streaming
  grid on a different pitch than the server's crossing-detection grid would
  desync "you just entered a new chunk" semantics between the two.
- **LOD bands match the Three.js client exactly, not approximately.**
  50m/200m/500m/600m are `lod.ts`'s literal `STANDARD_LOD_BANDS` + cull
  distance. A Godot chunk and a Three.js chunk of the same content should
  pop detail at the same distances.
- **Movement constants match `physics-world.ts` exactly, not approximately.**
  `GRAVITY=9.81`, `JUMP_DEFAULT_VY=7.5`, `GLIDE_DESCENT_CAP=-1.5`,
  `GLIDE_HORIZ_BOOST=0.08`, `SWIM_BUOYANCY=4.5`, `SWIM_GRAVITY=1.2` are the
  literal constants from `PhysicsWorld`; `COYOTE_MS=120`,
  `JUMP_BUFFER_MS=130`, `JUMP_CUT_FACTOR=0.45` are the literal constants
  from `jump-forgiveness.ts`. The swim integration even mirrors the same
  `0.85` per-step damping factor and `[-3.0, 3.5]` clamp band, not just the
  headline constants — see the source comment in `integrate_swim`.
- **Send-throttle matches the server's own accept-rate, not a guess.**
  `MOVE_SEND_MIN_INTERVAL_MS = 33` is copied from `server.js`'s literal
  `if (now - _moveRateState.last < 33) return;` guard on the `player:move`
  socket handler. Sending faster than this would just waste bandwidth on
  frames the server silently drops.
- **No client-side prediction for other entities** — this phase only adds
  local-player movement prediction (standard, expected, and how the
  Three.js client already works via Rapier). Remote entities still go
  through `net/snapshot_buffer.gd`'s interpolation-at-now−120ms path from
  Phase 1; nothing in this phase changes that contract.
- **Raw keycode input, not Godot's InputMap.** `character_controller.gd`
  polls `Input.is_key_pressed(KEY_W/A/S/D)` directly instead of registered
  input actions. `project.godot` has no `[input]` action bindings in this
  skeleton, and hand-authoring Godot's serialized `InputEventKey` resource
  format inside a `.godot` config file — with no engine available to load
  and verify it — would be exactly the kind of unverifiable, plausible-
  looking-but-unproven config this project's honesty invariants warn
  against. Raw keycodes need no project-level config and are unambiguous.
  A real input-adapter (remapping, gamepad, mobile touch) is future work,
  not a Phase 2 claim.
- **Jump/glide/swim are exposed as public methods** (`request_jump`,
  `release_jump`, `set_glide`, `set_swim`), mirroring `physicsWorld`'s own
  API shape (`requestJump`/`releaseJump`/`setGlide`/`setSwim`) rather than
  being wired to specific keys internally — same reasoning as above: who
  calls these (which key, which mobile gesture) is an input-binding
  decision this phase deliberately doesn't make.
- **Honest fallback, never a fabricated position.** `snapback_position`
  returns the caller-supplied `fallback` (the client's own current
  position) whenever the server's nack payload is missing or malformed —
  it never invents a plausible-looking snap target. Same principle in
  `prop_instancer.gd`: a prop entry missing a `position`/`scale` field gets
  the literal identity transform (origin, no rotation, unit scale), not an
  interpolated or randomized stand-in.
- **Chunk scene assets don't exist yet.** `chunk_manager.gd`'s
  `scene_path_template` (`res://world/chunks/chunk_%d_%d.tscn`) is a
  convention, not a promise those files exist — exactly like Phase 1's
  `AssetResolver.fallback_url`. A failed threaded load surfaces via
  `push_warning`, never a silently-empty "loaded" chunk.

## Testing

**Everything above is validated at exactly one level: `gdparse` +
`gdlint` (via `gdtoolkit` 4.5.0) — 16/16 `.gd` files in this project parse
cleanly, and `gdlint .` reports zero problems.** This confirms the code is
syntactically valid, loadable GDScript. It does **not** confirm any of the
following, all queued honestly in `VISUAL_QA.md`'s new "Phase 2" section:

- That `tests/run_all.gd` and its four suites actually execute successfully
  under a real `godot --headless` invocation (they have only ever been
  parsed, never run — the official Godot 4.4 headless binary download is
  403-blocked by this container's agent proxy, exactly as Phase 1
  documented for the same reason).
- That the movement feels forgiving-not-floaty, that LOD transitions read
  as smooth, that chunk streaming doesn't pop or hitch, or that the
  MultiMesh instancing renders the expected geometry.
- That the `player:move`/`player:move:nack` path works end-to-end against
  a live server — the Phase 1 gateway is still not mounted in `server.js`
  (see `docs/GODOT_INTEGRATION.md`'s Integration TODO), so this path is
  presently unreachable outside of unit tests exercising the pure
  `snapback_position`/`should_send_move` functions against hand-built
  payloads.

### Reproduction (what CAN be verified today)

```bash
cd world-lens-godot
for f in $(find . -name '*.gd'); do gdparse "$f"; done && gdlint .
```

Expected: every file parses, `gdlint .` reports `Success: no problems found`.

### Reproduction (once an engine is available — not run yet)

```bash
godot --headless --path world-lens-godot --script res://tests/run_all.gd
```

Expected exit code 0 with four `[PASS]` lines; a non-zero exit and any
`[FAIL]` line would mean either a genuine logic bug or (more likely, given
this is the first real execution) a GDScript runtime behavior this pass's
static analysis couldn't see — investigate before assuming the math above
is wrong.

## Explicitly out of scope for this pass

- Mounting the Phase 1 gateway server-side (`server/server.js`) — a
  separate, concurrently-running unit by design; this pass only touches
  `world-lens-godot/`.
- Real chunk scene content, real prop meshes, real player-avatar meshes —
  everything above operates on placeholder/injected resources.
- Godot InputMap action bindings / gamepad / mobile touch input.
- Any change to `docs/GODOT_INTEGRATION.md` (left to the server-side unit).
