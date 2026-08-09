class_name VegetationRenderer
extends Node3D
## VegetationRenderer — Phase M2. Spawns one node per real, district-bounded
## deterministic vegetation placement (server/lib/vegetation-scatter.js),
## delivered via the existing one-shot `scene:data` channel — see
## world/scene_bootstrap.gd#parse_vegetation/vegetation_ready. Mirrors
## world/dtu_prop_renderer.gd's asset strategy: a real GLB when one
## resolves, else a tinted placeholder primitive that stays up forever on
## failure — never fabricates.
##
## Individual Node3D per instance, NOT PropInstancer/MultiMesh — the
## realistic per-world instance count (tens, not hundreds, for
## concordia-hub's real district geometry) doesn't warrant MultiMesh's
## batching machinery, and PropInstancer doesn't support this class's
## per-instance async-GLB-upgrade lifecycle. Revisit if density ever grows
## into the hundreds.
##
## No new backend surface was needed to deliver this — `vegetation` is a
## field on the SAME `scene:data` payload buildings/districts/landing pads
## already arrive on, so there's no separate poller here.

signal vegetation_spawned(count: int)

const AssetResolver := preload("res://assets/asset_resolver.gd")
const GlbLoader := preload("res://assets/glb_loader.gd")

## Frontend static-asset origin — vegetation GLBs live in
## concord-frontend/public/models/vegetation/*.glb, same origin as building
## GLBs (scene_bootstrap.gd's own frontend_asset_base_url).
@export var frontend_asset_base_url: String = "http://127.0.0.1:3000"
@export var world_id: String = ""

var _spawned: Dictionary = {}  # entry id -> Node3D holder


## Spawns one holder per entry, clearing any previous spawn first. An empty
## `entries` array (every world but concordia-hub today) is a real "nothing
## here" answer, not an error — this simply spawns nothing.
func spawn(entries: Array) -> void:
	_clear()
	for entry in entries:
		if typeof(entry) == TYPE_DICTIONARY:
			_spawn_one(entry)
	vegetation_spawned.emit(_spawned.size())


func _spawn_one(entry: Dictionary) -> void:
	var id := String(entry.get("id", ""))
	if id.is_empty() or _spawned.has(id):
		return

	var holder := Node3D.new()
	holder.name = "vegetation_%s" % id
	holder.transform = entry_to_transform(entry)
	add_child(holder)
	_spawned[id] = holder

	var species := String(entry.get("species", ""))
	var placeholder := _build_placeholder(species)
	holder.add_child(placeholder)

	var resolver := AssetResolver.new()
	resolver.base_url = frontend_asset_base_url
	add_child(resolver)
	resolver.resolved.connect(_on_resolved.bind(holder, placeholder), CONNECT_ONE_SHOT)
	# Honest: no real asset resolved -> the placeholder built above just stays.
	resolver.resolve_failed.connect(func(_k, _i, _r): pass, CONNECT_ONE_SHOT)
	resolver.resolve("vegetation", species)


func _on_resolved(_kind: String, _id: String, url: String, holder: Node3D, placeholder: Node3D) -> void:
	if not is_instance_valid(holder):
		return
	var loader := GlbLoader.new()
	add_child(loader)
	loader.loaded.connect(_on_glb_loaded.bind(holder, placeholder), CONNECT_ONE_SHOT)
	# Honest: a failed fetch/parse leaves the placeholder in place, never a
	# fabricated or partial mesh.
	loader.load_failed.connect(func(_u, _r): pass, CONNECT_ONE_SHOT)
	loader.load_glb(url)


func _on_glb_loaded(_url: String, root: Node3D, holder: Node3D, placeholder: Node3D) -> void:
	if not is_instance_valid(holder):
		return
	if is_instance_valid(placeholder):
		placeholder.queue_free()
	holder.add_child(root)


func _build_placeholder(species: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.15
	mesh.bottom_radius = 0.25
	mesh.height = 1.5
	mi.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = placeholder_color_for_species(species)
	mi.material_override = mat
	return mi


func _clear() -> void:
	for node in _spawned.values():
		if is_instance_valid(node):
			node.queue_free()
	_spawned.clear()


# ── Pure static helpers ──────────────────────────────────────────────────────

## Real x/y/z/rotationY/scale -> Transform3D. Missing fields default to
## identity, never a fabricated offset — same posture as
## DtuPropRenderer.placement_to_transform.
static func entry_to_transform(entry: Dictionary) -> Transform3D:
	var x := float(entry.get("x", 0.0))
	var y := float(entry.get("y", 0.0))
	var z := float(entry.get("z", 0.0))
	var rotation_y := float(entry.get("rotationY", 0.0))
	var scale_v := float(entry.get("scale", 1.0))
	var basis := Basis(Vector3.UP, rotation_y).scaled(Vector3(scale_v, scale_v, scale_v))
	return Transform3D(basis, Vector3(x, y, z))


## Distinguishing (not "final art") placeholder tint per species — purely so
## different species read differently at a glance pre-GLB, mirroring
## DtuPropRenderer.slot_color's exact posture. An unrecognized species gets
## an honest neutral green default rather than a crash.
static func placeholder_color_for_species(species: String) -> Color:
	match species:
		"tree_01":
			return Color(0.24, 0.42, 0.20)
		"tree_02":
			return Color(0.20, 0.36, 0.18)
		"tree_03":
			return Color(0.30, 0.46, 0.22)
		"tree_04":
			return Color(0.18, 0.32, 0.16)
		"bush_01":
			return Color(0.34, 0.48, 0.24)
		"flower_01":
			return Color(0.62, 0.42, 0.55)
		_:
			return Color(0.3, 0.4, 0.2)
