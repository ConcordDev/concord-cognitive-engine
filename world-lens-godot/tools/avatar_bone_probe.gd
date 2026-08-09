extends SceneTree
## avatar_bone_probe.gd — one-off verification tool: what are the REAL bone
## names inside the hero-mesh GLBs (`_archetype_*.glb`)? avatar_rig.gd's
## weapon-attach code (Phase M1) needs a real hand-bone name to prefer over
## the primitive-placeholder's flat "rightForearm" socket when a GLB has
## resolved — this probe answers that from the actual asset instead of
## guessing at the Mixamo/VRM naming convention from documentation.
##
## Run (needs Xvfb; a real .glb served over plain HTTP at CONCORD_GLB_URL):
##   CONCORD_GLB_URL=http://127.0.0.1:PORT/_archetype_warrior.glb \
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/avatar_bone_probe.gd

const GlbLoader := preload("res://assets/glb_loader.gd")

var _loader: GlbLoader
var _result: Dictionary = {}
var _started := false
var _url := ""


func _initialize() -> void:
	_url = OS.get_environment("CONCORD_GLB_URL")
	if _url == "":
		push_error("[bone_probe] CONCORD_GLB_URL not set")
		_result = {"ok": false, "reason": "no_url"}
		return
	_loader = GlbLoader.new()
	get_root().add_child(_loader)
	_loader.loaded.connect(_on_loaded)
	_loader.load_failed.connect(_on_failed)


func _on_loaded(url: String, root: Node3D) -> void:
	var bone_names: Array = []
	var skeleton: Skeleton3D = null
	var stack: Array = [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n is Skeleton3D:
			skeleton = n
			break
		for c in n.get_children():
			stack.append(c)
	if skeleton != null:
		for i in range(skeleton.get_bone_count()):
			bone_names.append(skeleton.get_bone_name(i))
	_result = {"ok": true, "url": url, "skeleton_found": skeleton != null, "bone_count": bone_names.size(), "bone_names": bone_names}


func _on_failed(url: String, reason: String) -> void:
	_result = {"ok": false, "url": url, "reason": reason}


func _process(_delta: float) -> bool:
	if not _started and _loader != null:
		_started = true
		_loader.load_glb(_url)
	if _result.is_empty():
		return false
	print("[bone_probe] RESULT ", JSON.stringify(_result))
	return true
