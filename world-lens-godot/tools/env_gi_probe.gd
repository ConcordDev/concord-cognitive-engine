extends SceneTree
## env_gi_probe.gd — one-off verification tool for Phase S4: does enabling
## SDFGI/glow/SSAO on `ArtStyle.make_environment()` actually change the
## rendered frame, not just the Environment resource's properties (already
## pinned by `tests/test_art_style.gd`'s engine-executed checks)? Renders the
## SAME toon-shaded scene twice — once with the real (spec-driven) dials,
## once with them forced off — and reports real pixel statistics for both, so
## the caller can compare rather than trust a claim.
##
## Run:
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/env_gi_probe.gd

const ArtStyle := preload("res://world/art_style.gd")

var _frame := 0
var _settle := 30
var _phase := 0  # 0 = GI/post on, 1 = GI/post off
var _results: Dictionary = {}


func _initialize() -> void:
	_build_scene(true)


func _build_scene(gi_on: bool) -> void:
	for c in get_root().get_children():
		c.queue_free()

	var env := ArtStyle.make_environment("concordia-hub")
	if not gi_on:
		env.sdfgi_enabled = false
		env.glow_enabled = false
		env.ssao_enabled = false
		env.adjustment_enabled = false
	var we := WorldEnvironment.new()
	we.environment = env
	get_root().add_child(we)

	var sun := ArtStyle.make_sun("concordia-hub")
	sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
	get_root().add_child(sun)

	# A simple toon-shaded room: floor + 3 boxes at different depths, so GI
	# bounce/AO contact-shadowing has real geometry to act on (a single flat
	# plane with nothing else in the scene would make SDFGI's effect
	# genuinely invisible regardless of whether it's on).
	var mat := ArtStyle.make_toon_material("concordia-hub")
	var floor_mesh := MeshInstance3D.new()
	var floor_plane := PlaneMesh.new()
	floor_plane.size = Vector2(10, 10)
	floor_mesh.mesh = floor_plane
	floor_mesh.material_override = mat
	get_root().add_child(floor_mesh)

	for i in range(3):
		var box := MeshInstance3D.new()
		var box_mesh := BoxMesh.new()
		box_mesh.size = Vector3(1, 1, 1)
		box.mesh = box_mesh
		box.material_override = mat
		box.position = Vector3(-1.5 + i * 1.5, 0.5, -1.0 - i * 0.8)
		get_root().add_child(box)

	var cam := Camera3D.new()
	cam.transform = cam.transform.looking_at(Vector3(0, 0.3, -1.5) - Vector3(0, 1.6, 2.5), Vector3.UP)
	cam.position = Vector3(0, 1.6, 2.5)
	get_root().add_child(cam)
	cam.make_current()

	_frame = 0


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < _settle:
		return false

	var tex := get_root().get_texture()
	var img = tex.get_image() if tex != null else null
	var stats := {"ok": false}
	if img != null and not img.is_empty():
		var sum := 0.0
		var count := 0
		var w := img.get_width()
		var h := img.get_height()
		var step := 4  # sample, not every pixel — cheap and sufficient for a mean
		var i := 0
		while i < w:
			var j := 0
			while j < h:
				var c := img.get_pixel(i, j)
				sum += (c.r + c.g + c.b) / 3.0
				count += 1
				j += step
			i += step
		stats = {"ok": true, "mean_luma": sum / max(count, 1), "sampled_pixels": count}
		var out_path := "/tmp/env_gi_probe_%s.png" % ("on" if _phase == 0 else "off")
		img.save_png(out_path)
		stats["screenshot"] = out_path

	if _phase == 0:
		_results["gi_on"] = stats
		_phase = 1
		_build_scene(false)
		return false
	else:
		_results["gi_off"] = stats
		print("[env_gi_probe] RESULT ", JSON.stringify(_results))
		return true
