extends SceneTree
## textured_toon_shader_probe.gd — one-off verification for "toon-shading
## reach onto real GLB meshes" (2026-08-08): does
## ArtStyle.make_toon_material_textured's shader actually COMPILE and
## RENDER a real sampled albedo texture's colour (banded lighting, real
## texture preserved) under a real rasterizer, not just carry the right
## shader-parameter Dictionary values (already pinned by
## tests/test_art_style.gd's pure-logic checks)? Renders the SAME box mesh
## three ways: (a) the new textured toon material fed a distinctly-coloured
## 1x1 texture, (b) the FLAT toon material (make_toon_material, no texture
## involved), (c) the texture alone under Godot's own default unlit-ish
## material — and reports real framebuffer colour statistics for all three,
## so a human/later pass can confirm (a) reads recognisably closer to (c)'s
## hue than (b)'s hue is (proof the shader is really sampling the texture,
## not silently falling back to the flat palette).
##
## Run:
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/textured_toon_shader_probe.gd

const ArtStyle := preload("res://world/art_style.gd")

## A distinctly warm-orange texture colour, chosen to read clearly
## different from "crime" world's own noir/desaturated toon palette (so a
## silent fallback to the flat palette would be visually obvious in the
## reported average colour, not just a subtle shift).
const TEX_COLOR := Color(0.9, 0.35, 0.05)

var _frame := 0
var _settle := 20
var _phase := 0  # 0 = textured toon, 1 = flat toon, 2 = raw texture (reference)
var _results := {}


func _initialize() -> void:
	_build_scene(0)


func _make_texture() -> ImageTexture:
	var img := Image.create(4, 4, false, Image.FORMAT_RGB8)
	img.fill(TEX_COLOR)
	return ImageTexture.create_from_image(img)


func _build_scene(phase: int) -> void:
	for c in get_root().get_children():
		c.queue_free()

	var we := WorldEnvironment.new()
	we.environment = ArtStyle.make_environment("crime")
	get_root().add_child(we)

	var sun := ArtStyle.make_sun("crime")
	sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
	get_root().add_child(sun)

	var box := MeshInstance3D.new()
	var box_mesh := BoxMesh.new()
	box_mesh.size = Vector3(1.2, 1.2, 1.2)
	box.mesh = box_mesh

	if phase == 0:
		var base := StandardMaterial3D.new()
		base.albedo_texture = _make_texture()
		box.material_override = ArtStyle.make_toon_material_textured("crime", base)
	elif phase == 1:
		box.material_override = ArtStyle.make_toon_material("crime")
	else:
		var unlit := StandardMaterial3D.new()
		unlit.albedo_texture = _make_texture()
		unlit.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		box.material_override = unlit

	box.position = Vector3(0, 0, -2.0)
	get_root().add_child(box)

	var cam := Camera3D.new()
	cam.transform = cam.transform.looking_at(Vector3(0, 0, -2.0) - Vector3(0, 0, 1.5), Vector3.UP)
	cam.position = Vector3(0, 0, 1.5)
	get_root().add_child(cam)
	cam.make_current()

	_frame = 0


func _sample_center_avg(img: Image) -> Dictionary:
	var w := img.get_width()
	var h := img.get_height()
	var cx := int(w / 2)
	var cy := int(h / 2)
	var half := 30
	var r := 0.0
	var g := 0.0
	var b := 0.0
	var n := 0
	var x: int = maxi(0, cx - half)
	while x < mini(w, cx + half):
		var y: int = maxi(0, cy - half)
		while y < mini(h, cy + half):
			var c := img.get_pixel(x, y)
			r += c.r
			g += c.g
			b += c.b
			n += 1
			y += 2
		x += 2
	if n == 0:
		return {"ok": false}
	return {"ok": true, "r": r / n, "g": g / n, "b": b / n, "sampled": n}


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < _settle:
		return false

	var tex := get_root().get_texture()
	var img = tex.get_image() if tex != null else null
	var stats := {"ok": false}
	if img != null and not img.is_empty():
		stats = _sample_center_avg(img)
		var out_path := "/tmp/textured_toon_probe_phase%d.png" % _phase
		img.save_png(out_path)
		stats["screenshot"] = out_path

	var keys: Array[String] = ["textured_toon", "flat_toon", "raw_texture_reference"]
	var key: String = keys[_phase]
	_results[key] = stats

	if _phase < 2:
		_phase += 1
		_build_scene(_phase)
		return false

	print("[textured_toon_shader_probe] RESULT ", JSON.stringify(_results))
	return true
