class_name FeaSceneBuilder
extends Node3D
## FeaSceneBuilder — R5/E23: fetches a `concord-fea-scene/v1` payload from
## `server/domains/engineering.js`'s `feaScene` macro (via a plain
## `POST /api/lens/run`, the SAME macro envelope `dtu_prop_renderer.gd`
## already uses — no WebSocket gateway required) and renders it as a real
## 3D beam-frame structure: nodes as joint spheres, members as beams
## between them, colored by their REAL computed utilization ratio
## (server/lib/simulation/fea-solver.js's checkUtilization, echoed
## verbatim by the macro — never re-derived, rounded, or approximated
## here).
##
## Composes with the same posture `scene_bootstrap.gd` and
## `dtu_prop_renderer.gd` already established for this project: pure
## static transform/color math (unit-testable without an engine — see
## tests/test_fea_scene_builder.gd) plus a thin engine-glue layer that
## only ever spawns geometry backed by real solver data. An `{ok:false}`
## response, an unrecognized `format`, or an empty node/member list
## surfaces via `scene_failed` — no placeholder structure is invented in
## its place.
##
## Launch point (see docs/GODOT_PROTOCOL.md's `design_command` addendum):
## this deliberately does NOT go through the gateway's `design_command`
## channel — that channel's server-side dispatch
## (`_dispatchDesignCommand("game-design", ...)` in server/server.js) is
## hardcoded to the `game-design` macro domain, not a generic
## multi-domain dispatcher, so reaching `engineering.feaScene` through it
## would require changing that dispatch code itself — out of proportion
## for this unit. `request_scene()` below is this component's own minimal
## trigger: call it directly with a real FEA model (e.g. one already held
## by an engineering-lens caller, or forwarded from a parametric-mesh /
## structural-gate result) whenever a 3D view of that structure is
## needed — the same "plain REST macro call, no gateway required" posture
## `dtu_prop_renderer.gd` already uses for DTU props.
##
## STATUS: parse/lint validated only (gdparse + gdlint) — never opened in
## a real engine/renderer. See world-lens-godot/VISUAL_QA.md for exactly
## what's unverified (beam scale/thickness at real-world model
## dimensions, whether the color ramp reads correctly under default
## lighting).

signal scene_ready(node_count: int, member_count: int)
signal scene_failed(reason: String)
signal request_failed(reason: String)

const SCENE_FORMAT := "concord-fea-scene/v1"

## Visual radius of a beam member's cylinder mesh, in the FEA model's own
## length units (this is a fixed display proportion, not a real
## cross-section render — see the honest scale caveat in VISUAL_QA.md).
const BEAM_RADIUS := 0.03
## Radius of the small sphere marking each node/joint.
const NODE_RADIUS := 0.05

@export var base_url: String = "http://127.0.0.1:5050"
@export var auth_token: String = ""

var _spawned_nodes: Dictionary = {}   # nodeId -> Node3D
var _spawned_members: Array[Node3D] = []


## Fetch a fresh FEA solve for `model` ({nodes, members, loads, supports} —
## the same shape `engineering.runFEA`/`feaScene` already accept) and, on a
## real success, render it. This is the component's launch trigger — call
## it from whatever Godot scene/UI holds a structure worth visualizing.
func request_scene(model: Dictionary) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_request_completed.bind(req))

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth_token != "":
		headers.append("Authorization: Bearer %s" % auth_token)

	var body := JSON.stringify(FeaSceneBuilder.build_request_body(model))
	var err := req.request("%s/api/lens/run" % base_url, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		req.queue_free()
		request_failed.emit("request_error_%d" % err)


func _on_request_completed(
		result: int, code: int, _headers: PackedStringArray,
		response_body: PackedByteArray, req: HTTPRequest) -> void:
	req.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		request_failed.emit("http_%d_%d" % [result, code])
		return

	var parsed = JSON.parse_string(response_body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY:
		request_failed.emit("malformed_response")
		return

	apply_scene(parsed)


## Apply a `feaScene` result payload directly — accepts either the raw
## `/api/lens/run` envelope (`{ok, result:{...}}`) or an already-unwrapped
## `result` dict, so a caller that fetched the JSON some other way (a test,
## a cached/replayed response) can drive this without going through
## `request_scene()`'s HTTPRequest path.
func apply_scene(payload: Dictionary) -> void:
	var body := payload
	if payload.has("result") and typeof(payload.get("result")) == TYPE_DICTIONARY:
		if not bool(payload.get("ok", false)):
			scene_failed.emit(String(payload.get("error", "unknown")))
			return
		body = payload["result"]
	elif not payload.has("format"):
		# Neither an envelope with a "result" key nor a bare scene body.
		scene_failed.emit(String(payload.get("error", "malformed_payload")))
		return

	if String(body.get("format", "")) != SCENE_FORMAT:
		scene_failed.emit("unexpected_format")
		return

	var nodes: Array = body.get("nodes", [])
	var members: Array = body.get("members", [])
	if nodes.is_empty() or members.is_empty():
		scene_failed.emit("empty_model")
		return

	_clear()

	var positions := FeaSceneBuilder.node_positions(nodes)
	for node_id in positions:
		_spawn_node_marker(node_id, positions[node_id])

	var spawned_members := 0
	for m in members:
		if typeof(m) != TYPE_DICTIONARY:
			continue
		var node_i := String(m.get("nodeI", ""))
		var node_j := String(m.get("nodeJ", ""))
		if not positions.has(node_i) or not positions.has(node_j):
			continue  # honest skip — never draws a beam to a fabricated point
		_spawn_member_beam(m, positions[node_i], positions[node_j])
		spawned_members += 1

	scene_ready.emit(_spawned_nodes.size(), spawned_members)


func _spawn_node_marker(node_id: String, pos: Vector3) -> void:
	var mi := MeshInstance3D.new()
	mi.name = "fea_node_%s" % node_id
	var sphere := SphereMesh.new()
	sphere.radius = NODE_RADIUS
	sphere.height = NODE_RADIUS * 2.0
	mi.mesh = sphere
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.85, 0.85, 0.9)
	mi.material_override = mat
	mi.position = pos
	mi.set_meta("node_id", node_id)
	add_child(mi)
	_spawned_nodes[node_id] = mi


func _spawn_member_beam(member: Dictionary, from: Vector3, to: Vector3) -> void:
	var mi := MeshInstance3D.new()
	mi.name = "fea_member_%s" % String(member.get("id", ""))
	var length := from.distance_to(to)
	var cyl := CylinderMesh.new()
	cyl.top_radius = BEAM_RADIUS
	cyl.bottom_radius = BEAM_RADIUS
	cyl.height = length
	mi.mesh = cyl

	var utilization := float(member.get("utilization", 0.0))
	var color := FeaSceneBuilder.utilization_to_color(utilization)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.emission_enabled = true
	mat.emission = color
	mat.emission_energy_multiplier = 0.4
	mi.material_override = mat

	mi.transform = FeaSceneBuilder.beam_transform(from, to)
	mi.set_meta("member_id", String(member.get("id", "")))
	mi.set_meta("utilization", utilization)
	mi.set_meta("band", String(member.get("band", "")))
	mi.set_meta("pass", bool(member.get("pass", true)))
	add_child(mi)
	_spawned_members.append(mi)


func _clear() -> void:
	for n in _spawned_nodes.values():
		if is_instance_valid(n):
			n.queue_free()
	for n in _spawned_members:
		if is_instance_valid(n):
			n.queue_free()
	_spawned_nodes.clear()
	_spawned_members.clear()


## The node marker/beam currently spawned for a given FEA node/member id, if
## any (mirrors DtuPropRenderer.node_for — used by tests and by a future
## raycast-inspection layer, not built here).
func node_for(node_id: String) -> Node3D:
	return _spawned_nodes.get(node_id, null)


func member_count() -> int:
	return _spawned_members.size()


# ── Pure static helpers ──────────────────────────────────────────────────────

## Body for `POST /api/lens/run` — the exact envelope every macro call in
## this codebase uses (`{ domain, name, input }`), targeting the new
## `engineering.feaScene` macro (server/domains/engineering.js).
static func build_request_body(model: Dictionary) -> Dictionary:
	return {"domain": "engineering", "name": "feaScene", "input": {"model": model}}


## Maps the scene payload's `nodes` array (`{id,x,y,z}`, verbatim-echoed
## real input geometry — see feaScene's header comment) into a lookup of
## nodeId -> Vector3. Concord's scene-export convention is already Y-up
## (see scene_bootstrap.gd's header), so this is a direct passthrough with
## no axis remap. Entries with no id, or that aren't dictionaries, are
## skipped rather than producing a fabricated placement.
static func node_positions(nodes: Array) -> Dictionary:
	var out := {}
	for n in nodes:
		if typeof(n) != TYPE_DICTIONARY:
			continue
		var id := String(n.get("id", ""))
		if id == "":
			continue
		out[id] = Vector3(float(n.get("x", 0.0)), float(n.get("y", 0.0)), float(n.get("z", 0.0)))
	return out


## Data-driven utilization -> color ramp: green (0.0, unstressed) through
## yellow (~0.5) to red (>=1.0, at/over the material's allowable stress) —
## a real function of the REAL computed ratio `checkUtilization` returns
## (`member.utilization` in the feaScene payload), never a fixed or
## decorative gradient. Clamped to [0, 1] so an overstressed member
## (utilization > 1, the real "FAIL" case) still reads as solid red rather
## than extrapolating past it into an undefined color.
static func utilization_to_color(utilization: float) -> Color:
	var t := clampf(utilization, 0.0, 1.0)
	if t < 0.5:
		return Color(t * 2.0, 1.0, 0.0)  # green -> yellow
	return Color(1.0, 1.0 - (t - 0.5) * 2.0, 0.0)  # yellow -> red


## Builds the Transform3D for a beam cylinder spanning `from` -> `to`:
## origin at the midpoint, basis Y-axis aligned along the member direction
## (Godot's CylinderMesh extrudes along local +Y by construction). Falls
## back to an identity basis at the midpoint for a degenerate
## (zero-length) member rather than dividing by zero.
static func beam_transform(from: Vector3, to: Vector3) -> Transform3D:
	var mid := (from + to) * 0.5
	var dir := to - from
	var length := dir.length()
	if length < 0.000001:
		return Transform3D(Basis(), mid)
	var y_axis := dir / length
	# Pick a stable reference axis to build an orthonormal basis from; if the
	# member happens to run parallel to the reference, fall back to a second
	# reference so the cross products below never degenerate to zero.
	var reference := Vector3.RIGHT
	if absf(y_axis.dot(Vector3.RIGHT)) > 0.999:
		reference = Vector3.FORWARD
	var x_axis := reference.cross(y_axis).normalized()
	var z_axis := x_axis.cross(y_axis).normalized()
	var basis := Basis(x_axis, y_axis, z_axis)
	return Transform3D(basis, mid)
