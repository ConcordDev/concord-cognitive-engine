extends SceneTree
## glb_outline_probe.gd — one-off verification for Phase S3: does
## ArtStyle.apply_outline_to_tree actually reach a REAL loaded GLB's own
## mesh surfaces (not a synthetic BoxMesh fixture — tests/test_art_style.gd
## already covers that) and produce a visible outline, the same way
## tools/outline_shader_probe.gd already proved for a plain toon-shaded box?
##
## Run (needs Xvfb; a real .glb served over plain HTTP at CONCORD_GLB_URL):
##   CONCORD_GLB_URL=http://127.0.0.1:PORT/models/building/tavern.glb \
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/glb_outline_probe.gd

const GlbLoader := preload("res://assets/glb_loader.gd")
const ArtStyle := preload("res://world/art_style.gd")

var _loader: GlbLoader
var _url := ""
var _phase := 0  # 0 = with outline, 1 = without
var _root: Node3D = null
var _frame := 0
var _settle := 20
var _results := {}


func _initialize() -> void:
	_url = OS.get_environment("CONCORD_GLB_URL")
	if _url == "":
		push_error("[glb_outline_probe] CONCORD_GLB_URL not set")
		print("[glb_outline_probe] RESULT ", JSON.stringify({"ok": false, "reason": "no_url"}))
		quit(2)
		return

	var we := WorldEnvironment.new()
	we.environment = ArtStyle.make_environment("crime")
	get_root().add_child(we)
	var sun := ArtStyle.make_sun("crime")
	sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
	get_root().add_child(sun)

	var cam := Camera3D.new()
	var eye := Vector3(1.0, 0.6, 1.5)
	cam.transform = cam.transform.looking_at(Vector3(0, 1, 0) - eye, Vector3.UP)
	cam.position = eye
	get_root().add_child(cam)
	cam.make_current()

	_loader = GlbLoader.new()
	get_root().add_child(_loader)
	_loader.loaded.connect(_on_loaded)
	_loader.load_failed.connect(_on_failed)


func _on_loaded(_url2: String, root: Node3D) -> void:
	get_root().add_child(root)
	_root = root
	if _phase == 0:
		var touched := ArtStyle.apply_outline_to_tree(root, "crime")
		_results["surfaces_touched"] = touched


func _on_failed(_url2: String, reason: String) -> void:
	_results = {"ok": false, "reason": reason}
	_frame = 999999  # force exit path below


func _process(_delta: float) -> bool:
	if _loader != null and _root == null and _frame == 0:
		_loader.load_glb(_url)
	_frame += 1
	if _root == null and _frame < 600:
		return false
	if _root == null:
		print("[glb_outline_probe] RESULT ", JSON.stringify({"ok": false, "reason": "load_timeout_or_failed"}))
		return true

	if _settle > 0:
		_settle -= 1
		return false

	var tex := get_root().get_texture()
	var img = tex.get_image() if tex != null else null
	if img != null and not img.is_empty():
		var out_path := "/tmp/glb_outline_probe_%s.png" % ("with" if _phase == 0 else "without")
		img.save_png(out_path)
		_results["screenshot_%s" % ("with" if _phase == 0 else "without")] = out_path

	if _phase == 0:
		_phase = 1
		_root.queue_free()
		_root = null
		_settle = 20
		_frame = 0
		_loader = GlbLoader.new()
		get_root().add_child(_loader)
		_loader.loaded.connect(_on_loaded)
		_loader.load_failed.connect(_on_failed)
		return false
	else:
		_results["ok"] = true
		print("[glb_outline_probe] RESULT ", JSON.stringify(_results))
		return true
