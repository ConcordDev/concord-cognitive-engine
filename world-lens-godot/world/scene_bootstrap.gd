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
##
## Additive (C15 — air legibility): `scene:data`'s `districts` field
## (server/lib/scene-export.js, real district rows from `listDistricts` —
## server/lib/districts.js, migration 374: boundary polygon, palette hex
## triple, lightingTag, elevationHint) is parsed via `parse_districts` (pure
## static, same verbatim-passthrough-or-drop posture as
## `parse_landing_pads`) and exposed through `get_districts()`. This file
## does not itself decide how a district's palette should look at altitude
## — that transform is `world/air_legibility.gd#legibility_for_altitude`,
## kept separate because it is a rendering-config concern, not a scene-
## parsing one. A future renderer wires the two together (see
## air_legibility.gd's own header for exactly where and why the actual
## material/shader application isn't built by this unit — no engine here to
## verify it against).
##
## Additive (F26 — rooftop as first-class space): each `scene:data.nodes`
## entry already carries `extras.levels` when the building resolves in the
## authored city-layout (server/lib/building-purpose.js, threaded through
## server/lib/scene-export.js) — a Dictionary like
## `{"ground": "...", "mid": "...", "rooftop": "The Observatory — rooftop
## deck."}`. That data had NO client consumer before this unit — a rooftop
## was a text description with nothing that could ever tell "is the player
## standing on it." `parse_rooftop_buildings` reduces the subset of nodes
## whose `levels` names a `rooftop` entry into a flat descriptor carrying
## the REAL geometry a reachability check needs: horizontal footprint
## half-extents (from the node's own `transform.scale` — the exact
## footprint this file already spawns a box mesh from) and roofline height
## (`transform.translation.y + transform.scale.y` — the building's actual
## authored height, never a guessed constant). The occupancy/reachability
## DECISION on top of this data lives in the consumer,
## `world/rooftop_access_controller.gd` (same split as landing pads:
## parsing lives here, gating logic lives in the controller).

signal scene_ready(count: int)
signal scene_failed(reason: String)
signal landing_pads_ready(pads: Array)
signal districts_ready(districts: Array)
signal rooftop_buildings_ready(buildings: Array)

const SCENE_FORMAT := "concord-scene/v1"

var _spawned: Array[Node3D] = []
var _landing_pads: Array = []
var _districts: Array = []
var _rooftop_buildings: Array = []


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

	_districts = SceneBootstrap.parse_districts(payload.get("districts", []))
	districts_ready.emit(_districts)

	_rooftop_buildings = SceneBootstrap.parse_rooftop_buildings(nodes)
	rooftop_buildings_ready.emit(_rooftop_buildings)

	scene_ready.emit(_spawned.size())


## Real pad data from the most recent `apply_scene` call — see
## `land_air_transition_controller.gd#wire_landing_pads_from_scene_bootstrap`.
## Returns a duplicate so callers can't mutate this node's internal state.
func get_landing_pads() -> Array:
	return _landing_pads.duplicate(true)


## Real district data (boundary/palette/lightingTag/elevationHint) from the
## most recent `apply_scene` call — see `world/air_legibility.gd` for the
## consumer. Returns a duplicate so callers can't mutate this node's
## internal state.
func get_districts() -> Array:
	return _districts.duplicate(true)


## Real rooftop-accessible building descriptors from the most recent
## `apply_scene` call — see `world/rooftop_access_controller.gd` for the
## consumer. Returns a duplicate so callers can't mutate this node's
## internal state.
func get_rooftop_buildings() -> Array:
	return _rooftop_buildings.duplicate(true)


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
	mi.transform = Transform3D(SceneBootstrap.node_basis(rot_y, scale), origin)

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

## Composes a node's basis: rotate about Y, THEN scale in the node's OWN frame.
##
## Order is load-bearing and was wrong until `scripts/visual-qa.mjs` rendered it
## and measured the footprint. The previous `Basis().rotated(UP, r).scaled(s)`
## composes as `from_scale(s) * R` — Godot's `Basis.scaled()` scales along the
## PARENT axes, applied after the rotation — so an 8x2 building at rotationY =
## PI/2 came out re-stretched back to 8 wide x 2 deep instead of 2 wide x 8
## deep: the footprint of any rotated building never rotated at all. Composing
## `R * from_scale(s)` scales along the node's own axes first, then rotates,
## which is what `concord-scene/v1`'s `scale = [w, h, d]` footprint means.
##
## Pure + static so it is pinned by `tests/test_scene_bootstrap.gd` without a
## scene tree, and independently by the rendered-pixel `transform-footprint`
## assertion in the visual harness.
static func node_basis(rot_y: float, scale: Vector3) -> Basis:
	return Basis().rotated(Vector3.UP, rot_y) * Basis.from_scale(scale)


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


## Passes through well-shaped district entries verbatim (id, name, boundary,
## palette, lightingTag, elevationHint — whatever the server sent); silently
## drops any entry missing `id` or a `palette` dict with at least a
## `primary` hex string — the two fields `air_legibility.gd#
## legibility_for_altitude` actually depends on — rather than fabricating a
## placeholder district. Never throws on malformed input — an empty/missing
## `raw` array (every world other than concordia-hub today, per
## districts.js's own "no authored layout for this world" honest-empty
## path) yields an honest empty result.
static func parse_districts(raw: Array) -> Array:
	var out: Array = []
	for entry in raw:
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		if not entry.has("id"):
			continue
		var palette = entry.get("palette", null)
		if typeof(palette) != TYPE_DICTIONARY or not palette.has("primary"):
			continue
		out.append(entry.duplicate(true))
	return out


## F26 — reduces the full `nodes` array (concord-scene/v1's per-building
## transform + extras) down to the rooftop-accessible subset, each as a
## flat descriptor: real horizontal footprint half-extents (from the
## node's own `transform.scale` [w,h,d] — the same footprint this file
## already spawns a box mesh from) + real roofline height
## (`translation.y + scale.y` — the building's actual authored height). A
## node only qualifies when its authored `extras.levels` (server/lib/
## building-purpose.js's per-building `levels` field, threaded through
## server/lib/scene-export.js) names a "rooftop" entry — currently only
## "station-observatory" in content/world/concordia-hub/city-layout.json,
## but any future building that authors a `levels.rooftop` string is
## picked up automatically, no code change needed. Never throws on
## malformed input; a node missing any required field is silently dropped,
## never fabricated.
static func parse_rooftop_buildings(nodes: Array) -> Array:
	var out: Array = []
	for node in nodes:
		if typeof(node) != TYPE_DICTIONARY:
			continue
		var extras = node.get("extras", null)
		if typeof(extras) != TYPE_DICTIONARY:
			continue
		var levels = extras.get("levels", null)
		if typeof(levels) != TYPE_DICTIONARY or not levels.has("rooftop"):
			continue
		var t = node.get("transform", null)
		if typeof(t) != TYPE_DICTIONARY:
			continue
		var tr: Array = t.get("translation", [])
		var sc: Array = t.get("scale", [])
		if tr.size() < 3 or sc.size() < 3:
			continue
		out.append({
			"id": String(node.get("id", "")),
			"name": String(node.get("name", "")),
			"lens": extras.get("lens", null),
			"purpose": String(levels.get("rooftop", "")),
			"x": float(tr[0]),
			"z": float(tr[2]),
			"half_w": float(sc[0]) / 2.0,
			"half_d": float(sc[2]) / 2.0,
			"roof_y": float(tr[1]) + float(sc[1]),
		})
	return out
