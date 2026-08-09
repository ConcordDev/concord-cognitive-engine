extends SceneTree
## toon_material_coverage_probe.gd — one-off verification for Phase S1: do
## the placeholder building box and the primitive avatar capsules actually
## carry the real toon ShaderMaterial once spawned, not Godot's engine
## default? Real engine, real node construction — not a property-shape
## assertion on the accessor functions alone (those are already pinned by
## tests/test_art_style.gd; this checks the SPAWN PATHS actually use them).
##
## Run:
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/toon_material_coverage_probe.gd

const SceneBootstrap := preload("res://world/scene_bootstrap.gd")
const AvatarRig := preload("res://avatar/avatar_rig.gd")
const ArtStyle := preload("res://world/art_style.gd")

var _frame := 0
var _result := {}
var _rig: Node3D = null


func _initialize() -> void:
	pass


func _process(_delta: float) -> bool:
	# _ready() on newly add_child'd nodes below fires on a later frame, not
	# synchronously within this call -- wait one full frame before reading
	# anything those _ready() calls build (same lesson this session's other
	# probes already learned the hard way, e.g. weapon_attach_probe.gd).
	_frame += 1
	if _frame == 1:
		_run()
		return false
	if _frame < 3:
		return false
	_report()
	return true


func _run() -> void:
	# Building placeholder box.
	var bootstrap := SceneBootstrap.new()
	bootstrap.world_id = "cyber"
	get_root().add_child(bootstrap)
	bootstrap.apply_scene({
		"ok": true, "format": "concord-scene/v1", "worldId": "cyber",
		"nodes": [{"id": "n1", "type": "unknown_type", "transform": {
			"translation": [0, 0, 0], "rotationY": 0.0, "scale": [1, 1, 1]}}],
	})
	var box: MeshInstance3D = null
	for c in bootstrap.get_children():
		if c is MeshInstance3D:
			box = c
			break
	var expected_mat := ArtStyle.make_toon_material("cyber")
	_result["box_has_material"] = box != null and box.material_override != null
	_result["box_material_is_shader_material"] = box != null and box.material_override is ShaderMaterial
	if box != null and box.material_override != null:
		_result["box_shader_matches_toon_shader"] = box.material_override.shader == ArtStyle.toon_shader()
		var band_shadow = box.material_override.get_shader_parameter("band_shadow")
		var expected_shadow = expected_mat.get_shader_parameter("band_shadow")
		_result["box_band_shadow_matches_world_palette"] = band_shadow == expected_shadow

	# Avatar primitive capsule -- built inside AvatarRig's _ready(), which
	# runs on a later frame than add_child() returns; _report() (frame 3)
	# reads it after that has had time to fire.
	_rig = AvatarRig.new()
	_rig.kind = "npc"
	_rig.rig_id = "coverage-probe"
	_rig.world_id = "cyber"
	_rig.prefer_glb = false  # stay on the primitive so this checks THAT path
	get_root().add_child(_rig)


func _report() -> void:
	var primitive := _rig.get_node_or_null("PrimitivePlaceholder")
	var capsule_mat = null
	if primitive != null:
		for socket in primitive.get_children():
			for mi in socket.get_children():
				if mi is MeshInstance3D:
					capsule_mat = mi.material_override
					break
			if capsule_mat != null:
				break
	_result["capsule_has_material"] = capsule_mat != null
	_result["capsule_material_is_shader_material"] = capsule_mat is ShaderMaterial
	if capsule_mat != null:
		_result["capsule_shader_matches_toon_shader"] = capsule_mat.shader == ArtStyle.toon_shader()

	_result["ok"] = true
	print("[toon_coverage_probe] RESULT ", JSON.stringify(_result))
