class_name ProceduralPlayerMesh
extends Node3D
## ProceduralPlayerMesh — box/cylinder/sphere humanoid for the LOCAL player.
##
## Geometry + placement port enhanced-avatar-builder.ts (head sphere, box
## torso, cylinder arms/legs, box feet) driven by BodyProportions
## (character-schema.ts#proportionsFor). Flat StandardMaterial3D only — no
## SSS/hair-cards/eye-parallax (shaders not in this client yet).
##
## Honesty posture matches scripts/npcs/procedural_npc_mesh.gd and
## avatar/avatar_rig.gd's primitive path: never a fabricated Skeleton3D.
## Y origin is at the feet (CharacterBody3D convention). Collision is NOT
## owned here — callers mount CapsuleShape3D from
## BodyProportions.collision_capsule separately.

const BodyProportionsScript := preload("res://scripts/player/body_proportions.gd")

@export var body_archetype: String = "average"
@export var total_height: float = -1.0
@export var skin_color: Color = Color(0.78, 0.62, 0.50, 1.0)
@export var hair_color: Color = Color(0.18, 0.12, 0.08, 1.0)
@export var cloth_top_color: Color = Color(0.30, 0.38, 0.55, 1.0)
@export var cloth_bottom_color: Color = Color(0.22, 0.22, 0.28, 1.0)
@export var boots_color: Color = Color(0.227, 0.157, 0.125, 1.0)
@export var hair_style: String = "short"
@export var is_legend: bool = false
@export var show_eyes: bool = true

var _built: bool = false
var _part_count: int = 0
var _last_proportions: Dictionary = {}


func _ready() -> void:
	rebuild()


func rebuild() -> void:
	for child in get_children():
		child.queue_free()
	_part_count = 0
	_last_proportions = BodyProportionsScript.proportions_for(body_archetype, total_height)
	if body_archetype == "legend":
		is_legend = true
	_build_from_proportions(_last_proportions)
	_built = true


func apply_appearance(appearance: Variant) -> String:
	if typeof(appearance) != TYPE_DICTIONARY:
		return ""
	var a: Dictionary = appearance
	if a.has("bodyArchetype"):
		body_archetype = str(a.get("bodyArchetype", body_archetype))
	if a.has("totalHeight"):
		total_height = float(a.get("totalHeight", total_height))
	if a.has("skinColor"):
		skin_color = _color_from_hex(str(a.get("skinColor", "")), skin_color)
	if a.has("hairColor"):
		hair_color = _color_from_hex(str(a.get("hairColor", "")), hair_color)
	if a.has("hairStyle"):
		hair_style = str(a.get("hairStyle", hair_style))
	var clothing = a.get("clothing", {})
	if typeof(clothing) == TYPE_DICTIONARY:
		var top = clothing.get("top", {})
		if typeof(top) == TYPE_DICTIONARY and top.has("color"):
			cloth_top_color = _color_from_hex(str(top.get("color", "")), cloth_top_color)
		var bottom = clothing.get("bottom", {})
		if typeof(bottom) == TYPE_DICTIONARY and bottom.has("color"):
			cloth_bottom_color = _color_from_hex(str(bottom.get("color", "")), cloth_bottom_color)
		var boots = clothing.get("boots", {})
		if typeof(boots) == TYPE_DICTIONARY and boots.has("color"):
			boots_color = _color_from_hex(str(boots.get("color", "")), boots_color)
	is_legend = body_archetype == "legend"
	if is_inside_tree():
		rebuild()
	return body_archetype


func get_proportions() -> Dictionary:
	return _last_proportions.duplicate()


func get_part_count() -> int:
	return _part_count


func is_built() -> bool:
	return _built


func _build_from_proportions(p: Dictionary) -> void:
	var leg_len := float(p["legLength"])
	var torso_len := float(p["torsoLength"])
	var neck_len := float(p["neckLength"])
	var head_h := float(p["headHeight"])
	var head_w := float(p["headWidth"])
	var head_d := float(p["headDepth"])
	var shoulder_w := float(p["shoulderWidth"])
	var hip_w := float(p["hipWidth"])
	var arm_len := float(p["armLength"])
	var hand_len := float(p["handLength"])
	var foot_len := float(p["footLength"])

	var skin_mat := _make_mat(skin_color, 0.4 if is_legend else 0.78)
	var top_mat := _make_mat(cloth_top_color, 0.35 if is_legend else 0.72)
	var bottom_mat := _make_mat(cloth_bottom_color, 0.35 if is_legend else 0.72)
	var hair_mat := _make_mat(hair_color, 0.9)
	var boot_mat := _make_mat(boots_color, 0.85)

	# Head — SphereMesh radius = headWidth/2, then non-uniform scale for height/depth.
	var head_y := leg_len + torso_len + neck_len + head_h * 0.5
	var head := _add_sphere("Head", head_w * 0.5, skin_mat, Vector3(0.0, head_y, 0.0))
	head.scale = Vector3(1.0, head_h / head_w, head_d / head_w)

	if show_eyes:
		var eye_r := head_w * 0.06
		var eye_mat := _make_mat(Color(0.95, 0.95, 0.97, 1.0), 0.35)
		var eye_y := head_y + head_h * 0.15
		var eye_z := head_d * 0.45
		var eye_x := head_w * 0.22
		_add_sphere("EyeL", eye_r, eye_mat, Vector3(-eye_x, eye_y, eye_z))
		_add_sphere("EyeR", eye_r, eye_mat, Vector3(eye_x, eye_y, eye_z))

	if hair_style != "bald" and hair_style != "shaved":
		var hair_r := head_w * 0.55
		match hair_style:
			"long", "locs", "dreads", "braids":
				hair_r = head_w * 0.62
			"medium", "bun":
				hair_r = head_w * 0.58
			"ponytail":
				hair_r = head_w * 0.52
			_:
				hair_r = head_w * 0.55
		var hair := _add_sphere("Hair", hair_r, hair_mat, Vector3(0.0, head_y + head_h * 0.2, 0.0))
		hair.scale = Vector3(1.0, 0.7, 1.05)
		if hair_style == "ponytail":
			var tail := CylinderMesh.new()
			tail.top_radius = head_w * 0.08
			tail.bottom_radius = head_w * 0.06
			tail.height = head_h * 0.9
			_add_mesh_instance("HairTail", tail, hair_mat,
				Vector3(0.0, head_y - head_h * 0.1, -head_d * 0.55))

	# Torso
	var torso := BoxMesh.new()
	torso.size = Vector3(shoulder_w, torso_len, head_d * 0.7)
	_add_mesh_instance("Torso", torso, top_mat, Vector3(0.0, leg_len + torso_len * 0.5, 0.0))

	# Arms
	for sign in [-1.0, 1.0]:
		var ax: float = sign * (shoulder_w * 0.5 + head_w * 0.12)
		var upper := CylinderMesh.new()
		upper.top_radius = head_w * 0.18
		upper.bottom_radius = head_w * 0.18
		upper.height = arm_len * 0.5
		_add_mesh_instance(
			"UpperArm%s" % ("L" if sign < 0.0 else "R"),
			upper, top_mat,
			Vector3(ax, leg_len + torso_len - arm_len * 0.25, 0.0))

		var lower := CylinderMesh.new()
		lower.top_radius = head_w * 0.16
		lower.bottom_radius = head_w * 0.16
		lower.height = arm_len * 0.5
		_add_mesh_instance(
			"LowerArm%s" % ("L" if sign < 0.0 else "R"),
			lower, skin_mat,
			Vector3(ax, leg_len + torso_len - arm_len * 0.75, 0.0))

		_add_sphere(
			"Hand%s" % ("L" if sign < 0.0 else "R"),
			hand_len * 0.35, skin_mat,
			Vector3(ax, leg_len + torso_len - arm_len, 0.0))

	# Legs + feet
	for sign2 in [-1.0, 1.0]:
		var lx: float = sign2 * (hip_w * 0.25)
		var leg := CylinderMesh.new()
		leg.top_radius = head_w * 0.22
		leg.bottom_radius = head_w * 0.22
		leg.height = leg_len
		_add_mesh_instance(
			"Leg%s" % ("L" if sign2 < 0.0 else "R"),
			leg, bottom_mat,
			Vector3(lx, leg_len * 0.5, 0.0))

		var foot := BoxMesh.new()
		foot.size = Vector3(head_w * 0.4, head_w * 0.2, foot_len)
		_add_mesh_instance(
			"Foot%s" % ("L" if sign2 < 0.0 else "R"),
			foot, boot_mat,
			Vector3(lx, head_w * 0.1, foot_len * 0.3))


func _make_mat(albedo: Color, roughness: float) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = albedo
	mat.roughness = roughness
	if is_legend:
		mat.emission_enabled = true
		mat.emission = albedo
		mat.emission_energy_multiplier = 0.28
	return mat


func _add_sphere(part_name: String, radius: float, mat: Material, pos: Vector3) -> MeshInstance3D:
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 2.0
	return _add_mesh_instance(part_name, sphere, mat, pos)


func _add_mesh_instance(part_name: String, mesh: Mesh, mat: Material, pos: Vector3) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = part_name
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	_part_count += 1
	return mi


static func _color_from_hex(hex: String, fallback: Color) -> Color:
	if hex.begins_with("#") and Color.html_is_valid(hex):
		return Color.html(hex)
	if hex.begins_with("0x") or hex.begins_with("0X"):
		var h := "#%s" % hex.substr(2)
		if Color.html_is_valid(h):
			return Color.html(h)
	return fallback


## Pure. Expected mesh part count for a given hair_style / show_eyes combo —
## used by tests so a silent geometry regression is caught without a renderer.
## Base: head + torso + 2*(upper+lower+hand) + 2*(leg+foot) = 1+1+6+4 = 12
## +2 eyes when show_eyes, +1 hair (and +1 tail for ponytail) when not bald.
static func expected_part_count(hair_style: String, show_eyes: bool) -> int:
	var n := 12
	if show_eyes:
		n += 2
	if hair_style != "bald" and hair_style != "shaved":
		n += 1
		if hair_style == "ponytail":
			n += 1
	return n
