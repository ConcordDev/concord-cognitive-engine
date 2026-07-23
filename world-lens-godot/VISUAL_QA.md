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

---

Until every box above is checked on a real machine, treat the Godot client as
**structurally complete but visually unproven.**
