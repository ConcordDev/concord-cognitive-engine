class_name ProceduralNpcMesh
extends Node3D
## ProceduralNpcMesh — tinted capsule+sphere humanoid placeholder.
##
## Mirrors the honest primitive posture in avatar/avatar_rig.gd and the
## Three Pillars tableau (scenes/concordia-three-pillars.tscn): a CapsuleMesh
## body + SphereMesh head, never a fabricated Skeleton3D bind. Authored NPC
## scenes set palette exports; GLB upgrade can later replace this node the
## same way AvatarRig swaps its primitive for a resolved hero mesh.

@export var body_color: Color = Color(0.45, 0.42, 0.40, 1.0)
@export var accent_color: Color = Color(0.55, 0.50, 0.45, 1.0)
@export var height: float = 1.8
@export var radius: float = 0.32
@export var head_scale: float = 1.0
@export var show_accent_sash: bool = true

var _body: MeshInstance3D
var _head: MeshInstance3D
var _sash: MeshInstance3D


func _ready() -> void:
	_build()


func _build() -> void:
	for child in get_children():
		child.queue_free()

	var body_mat := StandardMaterial3D.new()
	body_mat.albedo_color = body_color
	body_mat.roughness = 0.78

	var accent_mat := StandardMaterial3D.new()
	accent_mat.albedo_color = accent_color
	accent_mat.roughness = 0.65

	var capsule := CapsuleMesh.new()
	capsule.radius = radius
	capsule.height = height
	_body = MeshInstance3D.new()
	_body.name = "Body"
	_body.mesh = capsule
	_body.material_override = body_mat
	_body.position = Vector3(0.0, height * 0.5, 0.0)
	add_child(_body)

	var sphere := SphereMesh.new()
	var head_r := 0.20 * head_scale
	sphere.radius = head_r
	sphere.height = head_r * 2.0
	_head = MeshInstance3D.new()
	_head.name = "Head"
	_head.mesh = sphere
	_head.material_override = body_mat
	_head.position = Vector3(0.0, height + head_r * 0.85, 0.0)
	add_child(_head)

	if show_accent_sash:
		var sash_mesh := BoxMesh.new()
		sash_mesh.size = Vector3(radius * 2.15, height * 0.12, radius * 0.55)
		_sash = MeshInstance3D.new()
		_sash.name = "AccentSash"
		_sash.mesh = sash_mesh
		_sash.material_override = accent_mat
		_sash.position = Vector3(0.0, height * 0.62, radius * 0.35)
		add_child(_sash)


func apply_palette(body: Color, accent: Color) -> void:
	body_color = body
	accent_color = accent
	if is_inside_tree():
		_build()
