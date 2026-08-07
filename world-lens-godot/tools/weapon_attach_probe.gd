extends SceneTree
## weapon_attach_probe.gd — one-off verification tool for Phase M1: does a
## REAL `avatar/avatar_rig.gd` instance, with `attach_weapon = true`, actually
## fetch a real weapon `.glb` and attach it under a real hand-bone
## BoneAttachment3D once the body GLB has also resolved? Exercises the real
## HTTP fetch (assets/glb_loader.gd), the real `AssetResolver.weapon_
## url_for_archetype` table, and the real `_hand_attach_point()` re-homing
## logic in avatar_rig.gd — not a mock of any of them.
##
## Run (needs Xvfb + a real static file server over concord-frontend/public/,
## same shape as tools/glb_load_probe.gd / avatar_bone_probe.gd):
##   CONCORD_ASSET_BASE_URL=http://127.0.0.1:PORT \
##   CONCORD_WEAPON_PROBE_ARCHETYPE=warrior \
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/weapon_attach_probe.gd

const AvatarRig := preload("res://avatar/avatar_rig.gd")

var _rig: Node3D
var _frame := 0
var _max_frames := 600
var _done := false


func _initialize() -> void:
	var base_url := OS.get_environment("CONCORD_ASSET_BASE_URL")
	if base_url == "":
		push_error("[weapon_probe] CONCORD_ASSET_BASE_URL not set")
		print("[weapon_probe] RESULT ", JSON.stringify({"ok": false, "reason": "no_base_url"}))
		quit(2)
		return
	var archetype := OS.get_environment("CONCORD_WEAPON_PROBE_ARCHETYPE")
	if archetype == "":
		archetype = "warrior"

	_rig = AvatarRig.new()
	_rig.kind = "player"
	_rig.rig_id = "weapon-probe"
	_rig.base_url = base_url
	_rig.archetype = archetype
	_rig.attach_weapon = true
	get_root().add_child(_rig)


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < _max_frames and not _done:
		return false

	# Real, engine-observed state — not asserted, walked.
	var body_source := "unresolved"
	if _rig.get("_glb_root") != null:
		body_source = "glb"
	elif _rig.get("_primitive_root") != null:
		body_source = "primitive"

	var weapon_root = _rig.get("_weapon_root")
	var weapon_attached := weapon_root != null
	var weapon_parent_class := ""
	var weapon_mesh_count := 0
	if weapon_attached:
		var p := (weapon_root as Node3D).get_parent()
		weapon_parent_class = p.get_class() if p != null else "none"
		var stack: Array = [weapon_root]
		while not stack.is_empty():
			var n: Node = stack.pop_back()
			if n is MeshInstance3D and n.mesh != null:
				weapon_mesh_count += 1
			for c in n.get_children():
				stack.append(c)

	var result := {
		"ok": true,
		"body_source": body_source,
		"weapon_attached": weapon_attached,
		"weapon_parent_class": weapon_parent_class,
		"weapon_mesh_instance_count": weapon_mesh_count,
		"frames_waited": _frame,
	}
	print("[weapon_probe] RESULT ", JSON.stringify(result))
	return true
