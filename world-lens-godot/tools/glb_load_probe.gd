extends SceneTree
## glb_load_probe.gd — one-off verification tool: does GlbLoader
## (assets/glb_loader.gd) actually download and parse a REAL production
## `.glb` file, not a synthetic fixture? This is the one item VISUAL_QA.md's
## "Assets" checklist calls out as genuinely never-exercised.
##
## Run (needs Xvfb; a real .glb served over plain HTTP at CONCORD_GLB_URL):
##   CONCORD_GLB_URL=http://127.0.0.1:PORT/name.glb \
##   CONCORD_GLB_PROBE_OUT=/tmp/out.png \
##   xvfb-run -a -s "-screen 0 1280x720x24" godot --path world-lens-godot \
##     --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/glb_load_probe.gd

const GlbLoader := preload("res://assets/glb_loader.gd")
const ArtStyle := preload("res://world/art_style.gd")

var _loader: GlbLoader
var _out_path := "/tmp/glb_load_probe.png"
var _settle_frames := 0
var _result: Dictionary = {}
var _done := false
var _url := ""
var _started := false


func _initialize() -> void:
	_url = OS.get_environment("CONCORD_GLB_URL")
	_out_path = OS.get_environment("CONCORD_GLB_PROBE_OUT") if OS.get_environment("CONCORD_GLB_PROBE_OUT") != "" else _out_path
	if _url == "":
		push_error("[glb_probe] CONCORD_GLB_URL not set")
		_result = {"ok": false, "reason": "no_url"}
		_done = true
		return

	# A light real environment so the loaded mesh isn't rendered flat-black
	# (same real ArtStyle path boot.gd now uses, not a bespoke test-only light).
	var we := WorldEnvironment.new()
	we.environment = ArtStyle.make_environment("concordia-hub")
	get_root().add_child(we)
	var sun := ArtStyle.make_sun("concordia-hub")
	sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
	get_root().add_child(sun)

	# Default framing (eye/target height ~1.1) suits a human-scale character;
	# a building-scale asset needs a further/higher vantage. Override via
	# CONCORD_GLB_PROBE_DISTANCE / CONCORD_GLB_PROBE_HEIGHT for larger assets
	# rather than hardcoding a second probe tool for a different asset scale.
	var dist := float(OS.get_environment("CONCORD_GLB_PROBE_DISTANCE")) if OS.get_environment("CONCORD_GLB_PROBE_DISTANCE") != "" else 5.0
	var height := float(OS.get_environment("CONCORD_GLB_PROBE_HEIGHT")) if OS.get_environment("CONCORD_GLB_PROBE_HEIGHT") != "" else 1.1
	var cam := Camera3D.new()
	var eye := Vector3(0, height, dist)
	var target := Vector3(0, height, 0.0)
	cam.transform = cam.transform.looking_at(target - eye, Vector3.UP)
	cam.position = eye
	get_root().add_child(cam)
	cam.make_current()

	_loader = GlbLoader.new()
	get_root().add_child(_loader)
	_loader.loaded.connect(_on_loaded)
	_loader.load_failed.connect(_on_failed)
	# HTTPRequest (created inside GlbLoader.load_glb) needs its owning node to
	# have actually entered the live tree first, which _initialize() runs
	# before -- defer the real request to the first _process() tick instead
	# of calling it here (matches the "request_error_3 / not inside tree"
	# failure this produced when called inline, fixed by testing it, not
	# assumed).


func _on_loaded(url: String, root: Node3D) -> void:
	get_root().add_child(root)

	var mesh_count := 0
	var total_verts := 0
	var stack: Array = [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is MeshInstance3D and n.mesh != null:
			mesh_count += 1
			for surf in range(n.mesh.get_surface_count()):
				var arrays: Array = n.mesh.surface_get_arrays(surf)
				if arrays.size() > Mesh.ARRAY_VERTEX and arrays[Mesh.ARRAY_VERTEX] != null:
					var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
					total_verts += verts.size()
		for c in n.get_children():
			stack.append(c)

	_result = {
		"ok": true,
		"url": url,
		"mesh_instance_count": mesh_count,
		"total_vertex_count": total_verts,
		"child_count": root.get_child_count(),
	}
	_settle_frames = 20  # let a couple frames render before capture


func _on_failed(url: String, reason: String) -> void:
	_result = {"ok": false, "url": url, "reason": reason}
	_done = true


func _process(_delta: float) -> bool:
	if not _started and _loader != null:
		_started = true
		print("[glb_probe] requesting ", _url)
		_loader.load_glb(_url)
	if _result.is_empty():
		return false
	if not _result.get("ok", false):
		print("[glb_probe] RESULT ", JSON.stringify(_result))
		return true
	if _settle_frames > 0:
		_settle_frames -= 1
		return false
	if not _done:
		var tex := get_root().get_texture()
		var img = tex.get_image() if tex != null else null
		var saved := false
		if img != null and not img.is_empty():
			saved = img.save_png(_out_path) == OK
		_result["screenshot_saved"] = saved
		_result["screenshot_path"] = _out_path
		print("[glb_probe] RESULT ", JSON.stringify(_result))
		_done = true
		return true
	return true
