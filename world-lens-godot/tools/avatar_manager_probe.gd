extends SceneTree
## avatar_manager_probe.gd — one-off verification tool: does the FULL
## remote-avatar chain actually work end to end — AvatarManager.ingest_
## snapshot() -> _spawn_rig() -> AvatarRig._try_resolve_glb() ->
## AssetResolver.fallback_url() -> a real GlbLoader fetch -> a real GLB
## swapped onto the rig — not just each piece proven standalone (glb_load_
## probe.gd already proved GlbLoader+the resolved URL load a real mesh in
## isolation; this proves the WIRING between AvatarManager and that proven
## URL/loader actually fires it).
##
## Does NOT require a second live authenticated session: `city:positions`
## is just a Dictionary shape (see world/boot.gd#users_array_to_dict) that
## AvatarManager.ingest_snapshot() consumes directly, so this feeds it one
## synthetic entity locally and watches for the SAME rig_ready("glb")
## signal a real socket-delivered snapshot would trigger. What this does
## NOT prove: that a real second browser session's city:positions
## broadcast reaches this client's gateway and gets forwarded correctly —
## that server/gateway leg is exercised elsewhere (VISUAL_QA.md's
## GatewayClient/live-connection entries); this tool starts from
## ingest_snapshot() onward.
##
## Run (needs Xvfb; a real frontend static-asset server serving
## /meshes/heroes/*.glb over plain HTTP at CONCORD_FRONTEND_URL):
##   CONCORD_FRONTEND_URL=http://127.0.0.1:PORT \
##   CONCORD_AVATAR_PROBE_WORLD=concordia-hub \
##   CONCORD_AVATAR_PROBE_OUT=/tmp/out.png \
##   xvfb-run -a -s "-screen 0 1280x720x24" godot --path world-lens-godot \
##     --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/avatar_manager_probe.gd

const AvatarManager := preload("res://avatar/avatar_manager.gd")
const ArtStyle := preload("res://world/art_style.gd")

var _manager: AvatarManager
var _frame := 0
var _max_frames := 600  # real network I/O needs real wall-clock frames
var _out_path := "/tmp/avatar_manager_probe.png"
var _done := false
var _rig_ready_source := ""
var _connected_rig: Node = null  # guards against connecting twice
var _settle_frames := 0  # post-signal render settle, same pattern as glb_load_probe.gd


func _initialize() -> void:
	_out_path = OS.get_environment("CONCORD_AVATAR_PROBE_OUT") if OS.get_environment("CONCORD_AVATAR_PROBE_OUT") != "" else _out_path
	var frontend_url := OS.get_environment("CONCORD_FRONTEND_URL")
	if frontend_url == "":
		push_error("[avatar_manager_probe] CONCORD_FRONTEND_URL not set")
		quit(2)
		return
	var world_id := OS.get_environment("CONCORD_AVATAR_PROBE_WORLD") if OS.get_environment("CONCORD_AVATAR_PROBE_WORLD") != "" else "concordia-hub"

	var we := WorldEnvironment.new()
	we.environment = ArtStyle.make_environment(world_id)
	get_root().add_child(we)
	var sun := ArtStyle.make_sun(world_id)
	sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
	get_root().add_child(sun)

	var cam := Camera3D.new()
	var eye := Vector3(0, 1.3, 4.0)
	cam.transform = cam.transform.looking_at(Vector3(0, 1.1, 0.0) - eye, Vector3.UP)
	cam.position = eye
	get_root().add_child(cam)
	cam.make_current()

	_manager = AvatarManager.new()
	_manager.base_url = frontend_url
	_manager.world_id = world_id
	get_root().add_child(_manager)

	# Real city:positions wire shape (server/lib/city-presence.js#broadcastPositions,
	# world/boot.gd#users_array_to_dict on the consuming side) -- exactly what
	# a live second session's snapshot would deliver, fed in directly.
	_manager.ingest_snapshot(Time.get_ticks_msec(), {
		"synthetic-probe-user": {"x": 0.0, "y": 0.0, "z": 0.0, "direction": 0.0},
	}, "player")


func _on_rig_ready(source: String) -> void:
	# Fires twice per rig in the real chain: "primitive" synchronously at
	# spawn (AvatarRig._ready(), before any network I/O), then "glb" only
	# if/when _on_glb_loaded actually swaps a real mesh in. Only the LATER
	# one is the claim this tool exists to check -- never latch on the
	# first fire.
	if source == "glb":
		_rig_ready_source = "glb"


func _process(_delta: float) -> bool:
	_frame += 1

	if _connected_rig == null:
		for child in _manager.get_children():
			if child.get_script() != null and String(child.get_script().get_global_name()) == "AvatarRig":
				_connected_rig = child
				child.rig_ready.connect(_on_rig_ready)
				break

	if _frame < _max_frames and _rig_ready_source == "":
		return false

	# A freshly-added GLB root's transform/visibility isn't guaranteed to
	# have reached the renderer in the exact frame _on_glb_loaded() ran --
	# glb_load_probe.gd hit this same issue and settles 20 frames before
	# capturing; same fix here rather than a fresh guess.
	if _rig_ready_source == "glb" and _settle_frames < 20:
		_settle_frames += 1
		return false

	var tex := get_root().get_texture()
	var img = tex.get_image() if tex != null else null
	var saved := false
	if img != null and not img.is_empty():
		saved = img.save_png(_out_path) == OK

	var rig_child_count := -1
	var rig_found := false
	for child in _manager.get_children():
		if child.get_script() != null and String(child.get_script().get_global_name()) == "AvatarRig":
			rig_found = true
			rig_child_count = child.get_child_count()

	var result := {
		"ok": rig_found,
		"rig_found": rig_found,
		"rig_child_count": rig_child_count,
		"glb_swapped": _rig_ready_source == "glb",
		"frames_waited": _frame,
		"screenshot_saved": saved,
		"screenshot_path": _out_path,
	}
	print("[avatar_manager_probe] RESULT ", JSON.stringify(result))
	return true
