class_name ConKayPresence
extends Node3D
## ConKayPresence — R5/E22 "ConKay spatial mode": the SAME ConKay identity
## already real on the web (concord-frontend/components/conkay/) given a
## presence inside the Godot Hub. This is NOT a new agent, a new persona, or
## a new state machine — it is a thin spatial renderer over the two real,
## cross-device ConKay facts documented in conkay_presence_state.gd's header
## (a macro call genuinely in flight, and the capability tier of the last
## completed verification), fed by the SAME server events the web widget's
## honesty contract already depends on (macro:started/macro:completed,
## real; conkay:verdict, new this unit — see server/lib/
## conkay-verdict-bridge.js). All state-derivation logic lives in
## ConKayPresenceState (pure, unit-tested); this file is only engine glue —
## building placeholder geometry and applying whatever ConKayPresenceState
## says to apply. It invents nothing about "when ConKay should look busy."
##
## ── Visual identity (kept consistent with the web widget, not reinvented) ──
## ConKayWidget.tsx's SVG glyph is a plain lattice-node motif: an outer ring
## (cyan-400 stroke), a solid core circle (cyan-300 fill), and three small
## satellite dots (cyan-200, one top-center + two lower flanks) — described
## in that file as "a simple lattice-node glyph consistent with ConKay's
## existing cyan/orbital visual identity." This node reproduces the SAME
## three-part composition in 3D: a core SphereMesh, an orbit TorusMesh ring,
## and three small satellite SphereMeshes at the same relative angular
## layout (one directly "above" in local space, two lower flanks) — not a
## new look. Only the core's color changes with state (see
## ConKayPresenceState.color_for_state); the ring and satellites stay the
## widget's resting cyan so the identity reads consistently at a glance.
##
## ── Honest motion rule (matches ConKayWidget.tsx's CSS discipline) ─────────
## ConKayWidget.tsx's own header states its 'thinking' ring "uses pure CSS
## `animate-spin` — motion appears ONLY while a real caller has asserted
## `state='thinking'`." This node's orbit ring follows the identical rule in
## `_process`: it spins ONLY while `_visual_state == STATE_THINKING` (a real
## macro call is in flight), at a constant rate, and stops dead — not
## decelerates, not completes an animation — the instant that becomes false.
## No timer estimates progress or counts down to a guessed completion; the
## rotation is driven purely by the current boolean, exactly like the CSS
## class it mirrors.
##
## ── Wiring (see world/boot.gd) ───────────────────────────────────────────
## Mounted in boot.gd alongside AerialTrafficController, following that same
## file's established pattern: instantiated once in `_ready()`, forwarded
## events via boot.gd's own `_on_event` match block (not this node
## registering itself against the gateway signal directly) — though
## `wire_gateway_events()` is also provided below for a caller that prefers
## that shape, mirroring AerialTrafficController's own dual-path precedent.
##
## STATUS: compiles under a real Godot 4.4 (docs/GODOT_RUNTIME.md) and loads with the rest of the
## project (0 parse errors). It has NO test suite of its own, so unlike its
## sibling conkay_presence_state.gd its logic is not engine-asserted — only
## its syntax and load are. And headless installs RasterizerDummy, so it has
## still never RENDERED. See world-lens-godot/VISUAL_QA.md.

const ConKayPresenceState := preload("res://conkay/conkay_presence_state.gd")
const ConKayPointing := preload("res://conkay/conkay_pointing.gd")

## Resting identity color for the ring/satellites — Tailwind cyan-400
## (#22d3ee) / cyan-200 (#a5f3fc), matching ConKayWidget.tsx's SVG stroke/dot
## colors exactly (see that file's `<svg>` block).
const RING_COLOR := Color(0.133, 0.827, 0.933, 0.55)
const SATELLITE_COLOR := Color(0.647, 0.953, 0.988, 0.85)

## Design dials, not measured — a placeholder scale until a real scene gives
## this a reason to be sized against actual avatar/building proportions.
## Roughly human-shoulder-height diameter for the core, per typical
## "ambient companion orb" scale in other engines' comparable UI.
@export var core_radius: float = 0.16
@export var orbit_radius: float = 0.40
@export var satellite_radius: float = 0.045

## Constant spin rate (radians/sec) applied to the orbit ring ONLY while
## genuinely busy — see class doc "Honest motion rule" above. A design dial,
## not a measured value.
@export var thinking_spin_rate: float = 2.2

var _inflight_run_ids: Dictionary = {}
var _tier: String = ""
var _visual_state: String = ConKayPresenceState.STATE_UNVERIFIED

var _core: MeshInstance3D
var _orbit: MeshInstance3D
var _core_material: StandardMaterial3D


func _ready() -> void:
	_build_geometry()
	_apply_visual_state()


## Alternate wiring path (unused by boot.gd today, provided for parity with
## world/aerial_traffic_controller.gd's own `wire_gateway_events` — see that
## file's identical method for precedent). Connects directly to a live
## GatewayClient's `event_received` signal.
func wire_gateway_events(gateway: Node) -> void:
	if gateway.has_signal("event_received"):
		gateway.event_received.connect(handle_event)


## Public entry point boot.gd's own `_on_event` match block calls for the
## three event names this presence cares about (macro:started,
## macro:completed, conkay:verdict). Ignores anything else. Never throws on
## a malformed/partial payload — missing fields degrade to the empty-string/
## false defaults `ConKayPresenceState`'s pure helpers already treat as "no
## information," never a crash.
func handle_event(evt: String, data: Dictionary) -> void:
	if evt == "macro:started" or evt == "macro:completed":
		var run_id := String(data.get("runId", ""))
		_inflight_run_ids = ConKayPresenceState.apply_macro_event(_inflight_run_ids, evt, run_id)
		_refresh()
	elif evt == "conkay:verdict":
		_tier = String(data.get("tier", ""))
		_refresh()


## R6 — called by world/boot.gd on every successful (re)auth. A
## `macro:completed` missed while this client was disconnected would
## otherwise leave `_inflight_run_ids` permanently non-empty — a busy/
## thinking indicator with nothing left to ever clear it, since
## `apply_macro_event` only removes an id on the completion event it never
## received. Resetting to the same unverified/idle state a fresh boot starts
## in is the honest choice on reconnect: a guessed "probably fine now" state
## would be a fabrication the rest of this class's honesty rules forbid.
func reset() -> void:
	_inflight_run_ids = {}
	_tier = ""
	_refresh()


func _refresh() -> void:
	var busy := ConKayPresenceState.is_busy(_inflight_run_ids)
	_visual_state = ConKayPresenceState.visual_state(busy, _tier)
	_apply_visual_state()


func _apply_visual_state() -> void:
	if _core_material == null:
		return
	var c := ConKayPresenceState.color_for_state(_visual_state)
	_core_material.albedo_color = c
	_core_material.emission = c


func _process(delta: float) -> void:
	if _orbit != null and _visual_state == ConKayPresenceState.STATE_THINKING:
		_orbit.rotate_y(thinking_spin_rate * delta)


## The real capability this unit builds for "point at buildings/props":
## rotates this node to face a REAL target position (a landing pad, an
## authored building's transform, a DTU prop's spawned position — anything
## already real in the scene, never an invented one). See
## conkay_pointing.gd's class doc for exactly what this does and does not
## do (no movement, no pathfinding).
func point_at(target: Vector3) -> void:
	transform.basis = ConKayPointing.look_at_basis(global_position, target)


## Convenience overload for pointing at another Node3D (e.g. a spawned
## building/prop instance) rather than a bare Vector3.
func point_at_node(target: Node3D) -> void:
	if target != null:
		point_at(target.global_position)


func _build_geometry() -> void:
	_core = MeshInstance3D.new()
	var core_mesh := SphereMesh.new()
	core_mesh.radius = core_radius
	core_mesh.height = core_radius * 2.0
	_core.mesh = core_mesh
	_core_material = StandardMaterial3D.new()
	_core_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_core.material_override = _core_material
	add_child(_core)

	_orbit = MeshInstance3D.new()
	var orbit_mesh := TorusMesh.new()
	orbit_mesh.inner_radius = maxf(orbit_radius - 0.015, 0.001)
	orbit_mesh.outer_radius = orbit_radius + 0.015
	_orbit.mesh = orbit_mesh
	var orbit_material := StandardMaterial3D.new()
	orbit_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	orbit_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	orbit_material.albedo_color = ConKayPresence.RING_COLOR
	_orbit.material_override = orbit_material
	add_child(_orbit)

	# Three satellite dots at the SAME relative layout as ConKayWidget.tsx's
	# SVG glyph: one top-center, two lower flanks (see that file's <svg>
	# circle cx/cy values — top at (12, 3.2), flanks at (19.8, 16) and
	# (4.2, 16) against a (12, 12) center in its 24-unit viewBox).
	var offsets: Array[Vector3] = [
		Vector3(0.0, orbit_radius, 0.0),
		Vector3(orbit_radius * 0.83, -orbit_radius * 0.35, 0.0),
		Vector3(-orbit_radius * 0.83, -orbit_radius * 0.35, 0.0),
	]
	for offset in offsets:
		var satellite := MeshInstance3D.new()
		var satellite_mesh := SphereMesh.new()
		satellite_mesh.radius = satellite_radius
		satellite_mesh.height = satellite_radius * 2.0
		satellite.mesh = satellite_mesh
		satellite.position = offset
		var satellite_material := StandardMaterial3D.new()
		satellite_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		satellite_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		satellite_material.albedo_color = ConKayPresence.SATELLITE_COLOR
		satellite.material_override = satellite_material
		add_child(satellite)
