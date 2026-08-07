class_name SceneBootstrap
extends Node3D
## SceneBootstrap — consumes a `concord-scene/v1` payload (from scene-export.js)
## and instantiates geometry for each building node.
##
## The transform mapping (node_to_transform) is a PURE STATIC func so it can be
## unit-tested without a scene tree. The engine part builds one MeshInstance3D +
## unit BoxMesh per node and applies the mapped transform.
##
## Honest handling: an {ok:false} scene payload is logged and surfaced via the
## `scene_failed` signal — no geometry is fabricated. Placeholder boxes remain
## the fallback for any node this file can't resolve a real mesh for (see
## VISUAL_QA.md) — they are explicitly NOT a visual-quality claim.
##
## Real-mesh upgrade (2026-08-07): every spawned node's `type` (the raw
## `building_type` string from `scene-export.js`) is resolved to an archetype
## via `world/building_archetype.gd` (a hand-ported subset of the Three.js
## client's `building-silhouette.ts` table). For the 3 archetypes with a real
## GLB today (market/tavern/archive — `concord-frontend/public/models/
## building/*.glb`), the box is REPLACED with a rescaled clone of that real
## mesh once it finishes loading — same "real-asset-first, box if nothing
## resolves" posture `BuildingRenderer3D.tsx` already uses in the Three.js
## client, and the same footprint-rescale math (measure the loaded mesh's
## AABB, then per-axis-scale to the node's authored [w,h,d]). Loading is
## async (HTTPRequest via AssetResolver + GlbLoader) and node spawning stays
## synchronous — a box always appears immediately, and is swapped for the
## real mesh only once (and if) the network fetch actually succeeds. A
## fetch failure (offline, no frontend host reachable, 404) leaves the box in
## place forever — no fabricated geometry, no fabricated success.
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
signal building_mesh_upgraded(archetype: String, node_count: int)

const SCENE_FORMAT := "concord-scene/v1"

const BuildingArchetype := preload("res://world/building_archetype.gd")
const AssetResolver := preload("res://assets/asset_resolver.gd")
const GlbLoader := preload("res://assets/glb_loader.gd")

## Origin that serves the real building GLBs — the FRONTEND's static `public/`
## dir (`concord-frontend/public/models/building/*.glb`), not the backend API
## (:5050). `AssetResolver.fallback_url("<this>", "building", "market")`
## produces `<this>/models/building/market.glb`, which matches that real
## serving path exactly — a rare case where the static-fallback URL
## convention lines up with where the asset actually lives (unlike hero
## meshes — see VISUAL_QA.md's open AssetResolver item).
@export var frontend_asset_base_url: String = "http://127.0.0.1:3000"

## Off switch: real building meshes require network access to
## frontend_asset_base_url. Headless/offline test runs should leave this
## false so nothing attempts an HTTPRequest.
@export var enable_real_building_meshes: bool = false

var _spawned: Array[Node3D] = []
var _landing_pads: Array = []
var _districts: Array = []
var _rooftop_buildings: Array = []

# archetype (String) -> Node3D real-mesh template once loaded, or "loading"
# (String sentinel) while a fetch is in flight. Absent key = not attempted.
var _building_templates: Dictionary = {}
# archetype (String) -> Array[MeshInstance3D] of currently-boxed nodes of that
# archetype, so a template arriving after they spawned can still upgrade them.
var _pending_upgrade: Dictionary = {}
var _asset_resolver: AssetResolver


func _ready() -> void:
	if enable_real_building_meshes:
		_asset_resolver = AssetResolver.new()
		_asset_resolver.base_url = frontend_asset_base_url
		_asset_resolver.use_resolve_endpoint = false  # static convention only; see header comment
		add_child(_asset_resolver)
		for archetype in BuildingArchetype.REAL_MESH_ARCHETYPES:
			_start_loading_archetype(archetype)


func _start_loading_archetype(archetype: String) -> void:
	if _building_templates.has(archetype):
		return
	_building_templates[archetype] = "loading"
	var url := AssetResolver.fallback_url(frontend_asset_base_url, "building", archetype)
	var loader := GlbLoader.new()
	add_child(loader)
	loader.loaded.connect(_on_building_glb_loaded.bind(archetype, loader))
	loader.load_failed.connect(_on_building_glb_failed.bind(archetype, loader))
	loader.load_glb(url)


func _on_building_glb_loaded(_url: String, root: Node3D, archetype: String, loader: GlbLoader) -> void:
	loader.queue_free()
	_building_templates[archetype] = root
	root.name = "_template_%s" % archetype
	# Kept off-tree (never add_child'd to the scene) — it exists only as a
	# clone source. Godot frees a Node's children fine even when the Node
	# itself was never parented, so this is safe to hold indefinitely.
	_upgrade_pending_nodes(archetype)


func _on_building_glb_failed(_url: String, _reason: String, archetype: String, loader: GlbLoader) -> void:
	loader.queue_free()
	# Honest failure: the archetype stays permanently box-only for THIS RUN.
	# "failed" is a distinct, permanent sentinel from "loading" -- erasing
	# the key entirely (an earlier version of this did that) let every
	# subsequently-spawned node of the same archetype re-trigger a brand new
	# fetch attempt via _spawn_node's `if not _building_templates.has(...)`
	# fallback, and a synchronous failure (e.g. Godot's HTTPRequest
	# rejecting a malformed URL, verified with a real browser load) retries
	# on literally the next node spawned -- a real, measured retry storm:
	# hundreds of attempts across one concordia-hub load, one per building
	# of that archetype. "failed" makes has(archetype) stay true forever
	# once a fetch has been tried and lost, so _spawn_node's fallback never
	# fires again for it this session.
	_building_templates[archetype] = "failed"
	push_warning("[scene] real building mesh failed to load for archetype '%s' — staying on placeholder box" % archetype)


func _upgrade_pending_nodes(archetype: String) -> void:
	var template: Node3D = _building_templates.get(archetype)
	if template == null or typeof(template) == TYPE_STRING:
		return
	var pending: Array = _pending_upgrade.get(archetype, [])
	var upgraded := 0
	for mi in pending:
		if is_instance_valid(mi) and _upgrade_one_node(mi, template):
			upgraded += 1
	_pending_upgrade[archetype] = []
	if upgraded > 0:
		building_mesh_upgraded.emit(archetype, upgraded)


## Replaces `mi`'s BoxMesh visuals with a rescaled clone of `template`, in
## place — same node, same name, same position in `_spawned` and in the
## scene tree, only its rendered content changes. Rescale is per-axis to the
## node's own authored footprint (mi's `transform.basis` already carries that
## footprint — see `node_basis`), measured against the template's own AABB,
## mirroring `BuildingRenderer3D.tsx`'s `cloned.scale.set(dtu.dimensions.width
## / size.x, ...)` real-asset rescale exactly.
func _upgrade_one_node(mi: MeshInstance3D, template: Node3D) -> bool:
	var footprint := mi.transform.basis.get_scale()
	if footprint.x <= 0.0 or footprint.y <= 0.0 or footprint.z <= 0.0:
		return false
	var clone := template.duplicate(DUPLICATE_USE_INSTANTIATION) as Node3D
	if clone == null:
		return false
	var aabb := _measure_aabb(clone)
	if aabb.size.x <= 0.0 or aabb.size.y <= 0.0 or aabb.size.z <= 0.0:
		clone.queue_free()
		return false
	# Reset the box mesh; the real asset now carries all visible geometry.
	mi.mesh = null
	# Un-scaled orientation-only basis (footprint now comes from the clone's
	# own scale below, not from mi's basis, since mi.mesh is gone). Uses the
	# rot_y stashed at spawn time rather than reverse-engineering yaw out of
	# a basis that also carries the footprint scale (get_euler() on a
	# non-orthonormal R*S basis is not reliably exact).
	var rot_y: float = mi.get_meta("rot_y", 0.0)
	mi.transform = Transform3D(Basis().rotated(Vector3.UP, rot_y), mi.transform.origin)
	clone.scale = Vector3(footprint.x / aabb.size.x, footprint.y / aabb.size.y, footprint.z / aabb.size.z)
	# Sit the clone's own local-space min-Y on the node's origin (buildings
	# are authored with origin at ground level, not centroid).
	clone.position = Vector3(-aabb.position.x * clone.scale.x, -aabb.position.y * clone.scale.y, -aabb.position.z * clone.scale.z)
	mi.add_child(clone)
	mi.set_meta("real_mesh", true)
	return true


func _measure_aabb(root: Node3D) -> AABB:
	var result := AABB()
	var first := true
	var stack: Array = [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is MeshInstance3D and n.mesh != null:
			var mesh_aabb: AABB = n.mesh.get_aabb()
			if n != root:
				mesh_aabb = n.transform * mesh_aabb
			if first:
				result = mesh_aabb
				first = false
			else:
				result = result.merge(mesh_aabb)
		for c in n.get_children():
			stack.append(c)
	return result


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


## Real focus point for an overview/orbit camera (session/camera_rig.gd) —
## the centroid of the CURRENTLY SPAWNED building nodes, never an assumed
## origin. Mirrors `engineering/fea_scene_builder.gd#get_bounds_center`'s
## exact honest-empty-fallback posture (Vector3.ZERO with nothing spawned,
## same default CameraRig already falls back to).
func get_bounds_center() -> Vector3:
	var positions: Array[Vector3] = []
	for n in _spawned:
		if is_instance_valid(n):
			positions.append(n.position)
	return SceneBootstrap.centroid(positions)


## Real radius (max distance from the centroid) of the currently spawned
## building nodes — used to size an overview camera's distance to the
## world's ACTUAL authored footprint instead of a guessed constant. A
## real city (concordia-hub: ~1000m x 1200m) and a small test world are
## different orders of magnitude; a fixed distance can't frame both.
## Empty/single-node scenes honestly yield 0.0.
func get_bounds_radius() -> float:
	var center := get_bounds_center()
	var max_dist := 0.0
	for n in _spawned:
		if is_instance_valid(n):
			max_dist = maxf(max_dist, n.position.distance_to(center))
	return max_dist


## Pure — average of a position array; Vector3.ZERO for an empty array
## (never a fabricated center for a scene with nothing spawned yet).
static func centroid(positions: Array[Vector3]) -> Vector3:
	if positions.is_empty():
		return Vector3.ZERO
	var sum := Vector3.ZERO
	for p in positions:
		sum += p
	return sum / positions.size()


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
	mi.set_meta("rot_y", rot_y)  # so a later real-mesh upgrade doesn't have to
	# reverse-engineer yaw out of a basis that also carries the footprint scale

	add_child(mi)
	_spawned.append(mi)

	if enable_real_building_meshes:
		var archetype := BuildingArchetype.archetype_for_type(String(node.get("type", "")))
		if BuildingArchetype.has_real_mesh(archetype):
			var template = _building_templates.get(archetype)
			if template != null and typeof(template) != TYPE_STRING:
				_upgrade_one_node(mi, template)
			else:
				if not _pending_upgrade.has(archetype):
					_pending_upgrade[archetype] = []
				_pending_upgrade[archetype].append(mi)
				if not _building_templates.has(archetype):
					_start_loading_archetype(archetype)


func _clear() -> void:
	for n in _spawned:
		if is_instance_valid(n):
			n.queue_free()
	_spawned.clear()
	_pending_upgrade.clear()


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
