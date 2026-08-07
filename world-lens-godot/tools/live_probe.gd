extends SceneTree
## live_probe.gd — one-off verification tool (not part of the automated
## visual-QA harness; that lives in tools/visual_probe.gd and renders
## synthetic fixtures). This one boots the REAL res://scenes/boot.tscn
## against a REAL running Concord server + REAL auth token, lets the real
## gateway round-trip (scene:request -> scene:data -> apply_scene) happen,
## then reports what actually got spawned and saves a screenshot. Never
## fabricates a count -- if SceneBootstrap isn't found, it says so and exits
## non-zero rather than printing a fake 0.
##
## Run (needs Xvfb, matches visual_probe.gd's invocation):
##   CONCORD_GATEWAY_URL=... CONCORD_GODOT_AUTH_TOKEN=... CONCORD_WORLD_ID=... \
##   CONCORD_LIVE_PROBE_OUT=/tmp/out.png CONCORD_LIVE_PROBE_FRAMES=300 \
##   xvfb-run -a -s "-screen 0 1280x720x24" godot --path world-lens-godot \
##     --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/live_probe.gd

var _frame := 0
var _max_frames := 300
var _out_path := "/tmp/live_probe.png"
var _boot: Node = null


func _initialize() -> void:
	_max_frames = int(OS.get_environment("CONCORD_LIVE_PROBE_FRAMES")) if OS.get_environment("CONCORD_LIVE_PROBE_FRAMES") != "" else 300
	_out_path = OS.get_environment("CONCORD_LIVE_PROBE_OUT") if OS.get_environment("CONCORD_LIVE_PROBE_OUT") != "" else _out_path
	print("[live_probe] driver=", DisplayServer.get_name(), " frames=", _max_frames)

	var packed: PackedScene = load("res://scenes/boot.tscn")
	if packed == null:
		push_error("[live_probe] could not load boot.tscn")
		quit(2)
		return
	_boot = packed.instantiate()
	get_root().add_child(_boot)


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < _max_frames:
		return false

	# Walk the real Boot node's children to find SceneBootstrap by class,
	# not by a guessed name -- it's added as a plain child in boot.gd.
	var bootstrap: Node = null
	for child in _boot.get_children():
		if child.get_script() != null and String(child.get_script().get_global_name()) == "SceneBootstrap":
			bootstrap = child
			break

	var spawned := -1
	if bootstrap != null:
		spawned = bootstrap.get_child_count()

	var tex := get_root().get_texture()
	var img = tex.get_image() if tex != null else null
	var saved := false
	if img != null and not img.is_empty():
		saved = img.save_png(_out_path) == OK

	var cam := get_root().get_camera_3d()
	var cam_info := {}
	if cam != null:
		cam_info = {"pos": str(cam.global_position), "fov": cam.fov, "near": cam.near, "far": cam.far}

	var bounds_center := Vector3.ZERO
	var bounds_radius := -1.0
	if bootstrap != null:
		bounds_center = bootstrap.get_bounds_center()
		bounds_radius = bootstrap.get_bounds_radius()

	var result := {
		"ok": true,
		"bootstrap_found": bootstrap != null,
		"spawned_children": spawned,
		"screenshot_saved": saved,
		"screenshot_path": _out_path,
		"camera": cam_info,
		"bounds_center": str(bounds_center),
		"bounds_radius": bounds_radius,
	}
	print("[live_probe] RESULT ", JSON.stringify(result))
	return true
