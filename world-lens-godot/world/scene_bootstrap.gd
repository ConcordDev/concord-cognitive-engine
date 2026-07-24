class_name SceneBootstrap
extends Node3D
## SceneBootstrap — consumes a `concord-scene/v1` payload (from scene-export.js)
## and instantiates placeholder geometry for each building node.
##
## The transform mapping (node_to_transform) is a PURE STATIC func so it can be
## unit-tested without a scene tree. The engine part builds one MeshInstance3D +
## unit BoxMesh per node and applies the mapped transform.
##
## Honest handling: an {ok:false} scene payload is logged and surfaced via the
## `scene_failed` signal — no geometry is fabricated. Placeholder boxes are
## explicitly NOT a visual-quality claim (see VISUAL_QA.md).
##
## Additive (C14 — land↔air transition): `scene:data`'s `landingPads` field
## (server/lib/scene-export.js, real touch-down markers from
## `content/world/concordia-hub/city-layout.json`'s standalone `landingPads`
## array, see server/lib/building-purpose.js#landingPadsForWorld) is parsed
## and stored via `parse_landing_pads` (pure static — see tests/
## test_scene_bootstrap.gd) and exposed through `get_landing_pads()` for
## `avatar/land_air_transition_controller.gd#wire_landing_pads_from_scene_
## bootstrap` to consume. No geometry is spawned for pads (they have no
## authored mesh yet — same "no fabrication" posture as everything else in
## this file); a world with no authored pads (every world other than
## concordia-hub today) yields an honest empty array.

signal scene_ready(count: int)
signal scene_failed(reason: String)
signal landing_pads_ready(pads: Array)

const SCENE_FORMAT := "concord-scene/v1"

var _spawned: Array[Node3D] = []
var _landing_pads: Array = []


## Apply a scene:data payload. Clears any prior spawn.
func apply_scene(payload: Dictionary) -> void:
	if not bool(payload.get("ok", false)):
		var reason := String(payload.get("reason", "unknown"))
		push_warning("[scene] export failed: %s" % reason)
		scene_failed.emit(reason)
		return
	if String(payload.get("format", "")) != SCENE_FORMAT:
		scene_failed.emit("unexpected_format")
		return

	_clear()
	var nodes: Array = payload.get("nodes", [])
	for node in nodes:
		if typeof(node) == TYPE_DICTIONARY:
			_spawn_node(node)

	_landing_pads = SceneBootstrap.parse_landing_pads(payload.get("landingPads", []))
	landing_pads_ready.emit(_landing_pads)

	scene_ready.emit(_spawned.size())


## Real pad data from the most recent `apply_scene` call — see
## `land_air_transition_controller.gd#wire_landing_pads_from_scene_bootstrap`.
## Returns a duplicate so callers can't mutate this node's internal state.
func get_landing_pads() -> Array:
	return _landing_pads.duplicate(true)


func _spawn_node(node: Dictionary) -> void:
	var mapped := SceneBootstrap.node_to_transform(node)
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3.ONE  # unit box; scale lives in the basis
	mi.mesh = mesh
	mi.name = String(node.get("id", "node"))

	var origin: Vector3 = mapped["origin"]
	var rot_y: float = mapped["rotationY"]
	var scale: Vector3 = mapped["scale"]
	var basis := Basis().rotated(Vector3.UP, rot_y).scaled(scale)
	mi.transform = Transform3D(basis, origin)

	add_child(mi)
	_spawned.append(mi)


func _clear() -> void:
	for n in _spawned:
		if is_instance_valid(n):
			n.queue_free()
	_spawned.clear()


# ── Pure static transform mapping ────────────────────────────────────────────
# concord-scene/v1 is Y-up, rotationY in radians, scale = [w, h, d] footprint —
# which matches Godot's Y-up convention directly (no axis swap needed).

static func node_to_transform(node: Dictionary) -> Dictionary:
	var t: Dictionary = node.get("transform", {})
	var tr: Array = t.get("translation", [0, 0, 0])
	var sc: Array = t.get("scale", [1, 1, 1])
	var rot_y := float(t.get("rotationY", 0.0))
	return {
		"origin": Vector3(float(tr[0]), float(tr[1]), float(tr[2])),
		"rotationY": rot_y,
		"scale": Vector3(float(sc[0]), float(sc[1]), float(sc[2])),
	}


## Passes through well-shaped pad entries verbatim (id, position:{x,z},
## radius_m, elevation_m, district_id, name, purpose — whatever the server
## sent); silently drops any entry missing the two fields the transition
## controller actually depends on (`position` with `x`/`z`, and `radius_m`)
## rather than fabricating a placeholder pad. Never throws on malformed
## input — an empty/missing `raw` array yields an empty result.
static func parse_landing_pads(raw: Array) -> Array:
	var out: Array = []
	for entry in raw:
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		if not entry.has("position") or not entry.has("radius_m"):
			continue
		var pos = entry["position"]
		if typeof(pos) != TYPE_DICTIONARY or not (pos.has("x") and pos.has("z")):
			continue
		out.append(entry.duplicate(true))
	return out
