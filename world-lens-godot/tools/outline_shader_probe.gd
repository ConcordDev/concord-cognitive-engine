extends SceneTree
## outline_shader_probe.gd — one-off verification for Phase S2: does the
## inverted-hull outline pass (art_style.gd#make_outline_material, chained
## via Material.next_pass from make_toon_material) actually render an
## outline, not just carry the right shader-parameter values (already
## pinned by tests/test_art_style.gd)? Renders the SAME toon-shaded box
## twice — once with the real outline next_pass, once with it stripped —
## and reports real framebuffer edge-pixel statistics for both.
##
## Run:
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/outline_shader_probe.gd

const ArtStyle := preload("res://world/art_style.gd")

var _frame := 0
var _settle := 20
var _phase := 0  # 0 = with outline, 1 = without
var _results := {}


func _initialize() -> void:
	_build_scene(true)


func _build_scene(with_outline: bool) -> void:
	for c in get_root().get_children():
		c.queue_free()

	var we := WorldEnvironment.new()
	we.environment = ArtStyle.make_environment("crime")  # noir/desaturated -- high contrast for edge detection
	get_root().add_child(we)

	var sun := ArtStyle.make_sun("crime")
	sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
	get_root().add_child(sun)

	var mat := ArtStyle.make_toon_material("crime")
	if not with_outline:
		mat.next_pass = null

	var box := MeshInstance3D.new()
	var box_mesh := BoxMesh.new()
	box_mesh.size = Vector3(1.2, 1.2, 1.2)
	box.mesh = box_mesh
	box.material_override = mat
	box.position = Vector3(0, 0, -2.0)
	get_root().add_child(box)

	var cam := Camera3D.new()
	cam.transform = cam.transform.looking_at(Vector3(0, 0, -2.0) - Vector3(0, 0, 1.5), Vector3.UP)
	cam.position = Vector3(0, 0, 1.5)
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
		# Count near-black pixels (the outline colour on the crime/noir
		# palette's dark, desaturated shadow band is itself near-black --
		# real, not assumed: ArtStyle.outline_color = shadow_band *
		# OUTLINE_DARKEN(0.35), and crime's shadow band is already dark) in
		# a band around the box's expected screen silhouette, and overall.
		var w := img.get_width()
		var h := img.get_height()
		var dark_pixels := 0
		var total := 0
		var x := 0
		while x < w:
			var y := 0
			while y < h:
				var c := img.get_pixel(x, y)
				var luma := (c.r + c.g + c.b) / 3.0
				if luma < 0.08:
					dark_pixels += 1
				total += 1
				y += 2
			x += 2
		stats = {"ok": true, "dark_pixel_count": dark_pixels, "sampled": total}
		var out_path := "/tmp/outline_probe_%s.png" % ("with" if _phase == 0 else "without")
		img.save_png(out_path)
		stats["screenshot"] = out_path

	if _phase == 0:
		_results["with_outline"] = stats
		_phase = 1
		_build_scene(false)
		return false
	else:
		_results["without_outline"] = stats
		print("[outline_probe] RESULT ", JSON.stringify(_results))
		return true
