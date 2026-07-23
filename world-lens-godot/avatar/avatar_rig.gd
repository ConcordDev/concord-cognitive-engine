class_name AvatarRig
extends Node3D
## AvatarRig — presentation-layer puppet for one player or NPC avatar.
##
## Decoupled from movement/physics on purpose: the LOCAL player's
## CharacterBody3D (player/character_controller.gd) can mount one of these as
## a child for its visuals, and avatar_manager.gd drives one directly (no
## physics body — position is set from interpolated snapshot data) for every
## REMOTE player/NPC. Either owner calls the same small public API:
## `apply_transform()`, `set_locomotion()`, `get_locomotion_state()`.
##
## ── Asset strategy (honest-by-construction) ─────────────────────────────────
## 1. PREFERRED: resolve a real humanoid GLB via assets/asset_resolver.gd
##    (kind "player"/"npc", id = rig_id) + assets/glb_loader.gd. On success the
##    downloaded scene replaces the primitive placeholder as this node's
##    child, and `_skeleton` is repointed at whatever Skeleton3D the GLB
##    itself contains (if any) — that skeleton is real, ours is not touched.
## 2. FALLBACK: a primitive placeholder (CapsuleMesh limbs positioned per
##    BONE_SPECS) is shown immediately and stays up if the GLB never resolves
##    or 404s. This file NEVER claims a GLB loaded when it didn't — a failed
##    resolve/load just leaves the primitive in place (see
##    `_on_glb_loaded`/`_on_glb_failed`).
##
## The primitive is plain Node3D "sockets" positioned by summed BONE_SPECS
## offsets, each holding one MeshInstance3D — it is NOT skinned to a
## Skeleton3D (building a procedurally-authored, correctly-bound Skeleton3D
## bone hierarchy by hand, with no engine available in this container to load
## and visually confirm it, would be exactly the kind of fabricated-looking-
## but-unverifiable config the project's honesty invariant warns against —
## see world-lens-godot/player/character_controller.gd's own comment on the
## same tradeoff for InputMap). The empty `Skeleton3D` node this file DOES
## create is a real hookup point for a future GLB's skinned mesh, not a
## placeholder claiming to be rigged itself.
##
## Bone naming mirrors the Three.js client's gait-pose target list exactly —
## concord-frontend/lib/concordia/gait-synthesis.ts:54-71 (`GaitPose` fields)
## and concord-frontend/components/world-lens/AvatarSystem3D.tsx:199-219
## (`BONE_HIERARCHY`) — so a future Godot port of gait synthesis (out of
## scope for this migration unit) can address the same names without a
## renaming pass. This unit does not port gait synthesis itself.

signal rig_ready(source: String)  # "glb" or "primitive"
signal glb_load_failed(reason: String)

## Passed to AssetResolver as the `kind` query param.
@export var rig_id: String = ""
@export var kind: String = "npc"  # "player" | "npc"
@export var base_url: String = "http://127.0.0.1:5050"
@export var prefer_glb: bool = true

var _skeleton: Skeleton3D = null
var _primitive_root: Node3D = null
var _glb_root: Node3D = null
var _current_state: String = "idle"
var _current_blend: Dictionary = {}
var _resolver: Node = null
var _loader: Node = null


func _ready() -> void:
	_skeleton = Skeleton3D.new()
	_skeleton.name = "Skeleton3D"
	add_child(_skeleton)

	_build_primitive()
	rig_ready.emit("primitive")

	if prefer_glb:
		_try_resolve_glb()


## Set world position + Y-axis rotation (radians). Engine-gated (Node3D
## transform), but trivial — no math to hide behind a pure func.
func apply_transform(pos: Vector3, rotation_y: float) -> void:
	position = pos
	rotation.y = rotation_y


## Record the current locomotion/override decision (from
## animation_state_machine.select_state()). This unit does not yet wire real
## AnimationPlayer clips onto the primitive or a loaded GLB — that lands with
## the actual gait-synthesis port — so this just stores state for
## `get_locomotion_state()`/`get_locomotion_blend()` to expose a ready hook.
func set_locomotion(state: String, blend: Dictionary) -> void:
	_current_state = state
	_current_blend = blend


func get_locomotion_state() -> String:
	return _current_state


func get_locomotion_blend() -> Dictionary:
	return _current_blend


## Look up a placeholder bone socket by name (e.g. "hips", "chest"). Returns
## null if not built yet or name unknown. Useful to a future gait-synthesis
## port that wants to rotate/position individual sockets directly.
func get_bone_node(bone_name: String) -> Node3D:
	if _primitive_root == null:
		return null
	return _primitive_root.get_node_or_null(NodePath(bone_name)) as Node3D


func _build_primitive() -> void:
	var root := Node3D.new()
	root.name = "PrimitivePlaceholder"
	add_child(root)
	_primitive_root = root

	var specs := AvatarRig.bone_specs()
	for spec in specs:
		var socket := Node3D.new()
		socket.name = String(spec["name"])
		socket.position = AvatarRig.bone_world_offset(specs, String(spec["name"]))
		root.add_child(socket)

		var mesh_instance := MeshInstance3D.new()
		var capsule := CapsuleMesh.new()
		capsule.radius = float(spec["radius"])
		capsule.height = float(spec["height"])
		mesh_instance.mesh = capsule
		socket.add_child(mesh_instance)


func _try_resolve_glb() -> void:
	var AssetResolver := load("res://assets/asset_resolver.gd")
	var GlbLoader := load("res://assets/glb_loader.gd")
	_resolver = AssetResolver.new()
	_resolver.base_url = base_url
	add_child(_resolver)
	_resolver.resolved.connect(_on_resolved)
	_resolver.resolve_failed.connect(_on_resolve_failed)

	_loader = GlbLoader.new()
	add_child(_loader)
	_loader.loaded.connect(_on_glb_loaded)
	_loader.load_failed.connect(_on_glb_failed)

	_resolver.resolve(kind, rig_id)


func _on_resolved(_kind: String, _id: String, url: String) -> void:
	_loader.load_glb(url)


func _on_resolve_failed(_kind: String, _id: String, reason: String) -> void:
	# Honest: no fabricated URL guess beyond the resolver's own static
	# fallback convention (already tried inside AssetResolver itself). Stay
	# on the primitive.
	glb_load_failed.emit(reason)


func _on_glb_loaded(_url: String, root: Node3D) -> void:
	if root == null:
		return
	_glb_root = root
	add_child(_glb_root)
	var found := _find_skeleton(_glb_root)
	if found != null:
		_skeleton = found
	if _primitive_root != null:
		_primitive_root.visible = false
	rig_ready.emit("glb")


func _on_glb_failed(_url: String, reason: String) -> void:
	# Honest: the primitive placeholder stays visible; nothing is fabricated.
	glb_load_failed.emit(reason)


func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D:
		return node
	for child in node.get_children():
		var found := _find_skeleton(child)
		if found != null:
			return found
	return null


# ── Pure static bone layout (no engine calls) ────────────────────────────────

## Placeholder skeleton layout: name, parent name ("" = root-relative), local
## offset relative to the parent, and a capsule radius/height. Field names
## mirror gait-synthesis.ts's `GaitPose` targets (hips/spine/chest/neck +
## left/right upper/lower leg + foot + upper arm/forearm) plus a `head` socket
## for the name-tag/camera anchor that the Three.js client also carries
## (BONE_HIERARCHY, AvatarSystem3D.tsx:199-219). PURE DATA — no Node/Vector3
## engine dependency beyond the Vector3 value type, which is available to
## GDScript scripts outside a running scene tree, so this is testable without
## an engine boot.
static func bone_specs() -> Array:
	return [
		{
			"name": "hips", "parent": "",
			"offset": Vector3(0, 0.9, 0), "radius": 0.14, "height": 0.22,
		},
		{
			"name": "spine", "parent": "hips",
			"offset": Vector3(0, 0.18, 0), "radius": 0.13, "height": 0.20,
		},
		{
			"name": "chest", "parent": "spine",
			"offset": Vector3(0, 0.20, 0), "radius": 0.15, "height": 0.22,
		},
		{
			"name": "neck", "parent": "chest",
			"offset": Vector3(0, 0.14, 0), "radius": 0.06, "height": 0.06,
		},
		{
			"name": "head", "parent": "neck",
			"offset": Vector3(0, 0.10, 0), "radius": 0.12, "height": 0.12,
		},
		{
			"name": "leftUpperLeg", "parent": "hips",
			"offset": Vector3(-0.09, -0.05, 0), "radius": 0.07, "height": 0.40,
		},
		{
			"name": "leftLowerLeg", "parent": "leftUpperLeg",
			"offset": Vector3(0, -0.42, 0), "radius": 0.06, "height": 0.38,
		},
		{
			"name": "leftFoot", "parent": "leftLowerLeg",
			"offset": Vector3(0, -0.40, 0.05), "radius": 0.05, "height": 0.08,
		},
		{
			"name": "rightUpperLeg", "parent": "hips",
			"offset": Vector3(0.09, -0.05, 0), "radius": 0.07, "height": 0.40,
		},
		{
			"name": "rightLowerLeg", "parent": "rightUpperLeg",
			"offset": Vector3(0, -0.42, 0), "radius": 0.06, "height": 0.38,
		},
		{
			"name": "rightFoot", "parent": "rightLowerLeg",
			"offset": Vector3(0, -0.40, 0.05), "radius": 0.05, "height": 0.08,
		},
		{
			"name": "leftUpperArm", "parent": "chest",
			"offset": Vector3(-0.20, 0.08, 0), "radius": 0.05, "height": 0.30,
		},
		{
			"name": "leftForearm", "parent": "leftUpperArm",
			"offset": Vector3(0, -0.32, 0), "radius": 0.045, "height": 0.28,
		},
		{
			"name": "rightUpperArm", "parent": "chest",
			"offset": Vector3(0.20, 0.08, 0), "radius": 0.05, "height": 0.30,
		},
		{
			"name": "rightForearm", "parent": "rightUpperArm",
			"offset": Vector3(0, -0.32, 0), "radius": 0.045, "height": 0.28,
		},
	]


## Sum a bone's offset chain up to the root ("" parent) so a flat Node3D
## socket tree (no true parent/child nesting per bone) can still be placed at
## the correct cumulative local position. Pure; guards against a cyclic
## `parent` reference with a hop-count cap.
static func bone_world_offset(specs: Array, bone_name: String) -> Vector3:
	var by_name := {}
	for spec in specs:
		by_name[spec["name"]] = spec

	var offset := Vector3.ZERO
	var current := bone_name
	var guard := 0
	while current != "" and by_name.has(current) and guard < 32:
		var spec: Dictionary = by_name[current]
		offset += spec["offset"]
		current = String(spec["parent"])
		guard += 1
	return offset
