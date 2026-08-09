extends SceneTree
## local_player_probe.gd — one-off verification tool: does the LOCAL
## player's real physics body (world/boot.gd#_spawn_local_player_if_needed
## -> player/character_controller.gd) actually spawn, actually collide with
## the world's real collision geometry, and actually settle instead of
## falling through forever? Also verifies the ground texture load and the
## camera's handoff from the aerial establishing shot to following the
## local player.
##
## Loads the REAL res://scenes/boot.tscn against a REAL running Concord
## server + REAL auth token (same pattern as tools/live_probe.gd), then
## samples the spawned CharacterController's global_position.y over many
## real physics frames -- a body that's still falling through the world
## keeps decreasing without bound; a body that hit real collision and
## settled converges to a stable value near the ground/roof it landed on.
## Never fabricates a "settled" verdict: it reports the actual samples.
##
## Run (needs Xvfb, a real running server + real static asset server):
##   CONCORD_GATEWAY_URL=... CONCORD_GODOT_AUTH_TOKEN=... CONCORD_WORLD_ID=... \
##   CONCORD_FRONTEND_URL=http://127.0.0.1:PORT \
##   CONCORD_LOCAL_PLAYER_PROBE_OUT=/tmp/out.png \
##   xvfb-run -a -s "-screen 0 1280x720x24" godot --path world-lens-godot \
##     --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/local_player_probe.gd

var _frame := 0
var _max_frames := 600
var _out_path := "/tmp/local_player_probe.png"
var _boot: Node = null
var _character: Node = null
var _y_samples: Array[float] = []
var _spawned_at_frame := -1
## A body dropped from world/boot.gd's SPAWN_DROP_HEIGHT_M (80m) above a
## real measured world center can start noticeably higher still (the
## center's own y-component adds on top -- concordia-hub's real measured
## bounds center sits ~27m up, so an observed real first-fall-frame
## sample landed at ~113m). Free-fall from ~113m at g=9.81 takes
## sqrt(2*113/9.81) ~= 4.8s ~= 288 frames@60fps to even REACH the ground --
## sampling for "is it settled" before that elapses just measures an
## honestly-still-falling body and reports it as unsettled, which is what
## an earlier version of this probe actually did (first_sampled_y=113,
## last_sampled_y=88.6 over a 120-frame window starting AT spawn --  a
## real, physically-correct fall, not a bug, just sampled too early).
const FALL_SETTLE_DELAY_FRAMES := 400
const SAMPLE_WINDOW_FRAMES := 120  # ~2s at 60fps -- long enough to see real settling AFTER the fall completes


func _initialize() -> void:
	_max_frames = int(OS.get_environment("CONCORD_LOCAL_PLAYER_PROBE_FRAMES")) if OS.get_environment("CONCORD_LOCAL_PLAYER_PROBE_FRAMES") != "" else 600
	_out_path = OS.get_environment("CONCORD_LOCAL_PLAYER_PROBE_OUT") if OS.get_environment("CONCORD_LOCAL_PLAYER_PROBE_OUT") != "" else _out_path
	print("[local_player_probe] driver=", DisplayServer.get_name(), " frames=", _max_frames)

	var packed: PackedScene = load("res://scenes/boot.tscn")
	if packed == null:
		push_error("[local_player_probe] could not load boot.tscn")
		quit(2)
		return
	_boot = packed.instantiate()
	get_root().add_child(_boot)


func _find_character() -> Node:
	for child in _boot.get_children():
		if child.get_script() != null and String(child.get_script().get_global_name()) == "CharacterController":
			return child
	return null


func _process(_delta: float) -> bool:
	_frame += 1

	if _character == null:
		_character = _find_character()
		if _character != null:
			_spawned_at_frame = _frame

	var frames_since_spawn := _frame - _spawned_at_frame if _character != null else -1
	if _character != null and frames_since_spawn >= FALL_SETTLE_DELAY_FRAMES \
			and _y_samples.size() < SAMPLE_WINDOW_FRAMES:
		_y_samples.append((_character as Node3D).global_position.y)

	var have_enough_samples := _character != null and _y_samples.size() >= SAMPLE_WINDOW_FRAMES
	if _frame < _max_frames and not have_enough_samples:
		return false

	var tex := get_root().get_texture()
	var img = tex.get_image() if tex != null else null
	var saved := false
	if img != null and not img.is_empty():
		saved = img.save_png(_out_path) == OK

	var settled := false
	var last_y := 0.0
	var first_y := 0.0
	var max_drift := 0.0
	if _y_samples.size() >= 10:
		# Compare the last 10% of samples' spread against the total fall
		# distance -- real settling means the tail barely moves; a body
		# still falling through the world keeps monotonically decreasing.
		var tail_start := int(_y_samples.size() * 0.9)
		var tail_min := _y_samples[tail_start]
		var tail_max := _y_samples[tail_start]
		for i in range(tail_start, _y_samples.size()):
			tail_min = minf(tail_min, _y_samples[i])
			tail_max = maxf(tail_max, _y_samples[i])
		max_drift = tail_max - tail_min
		first_y = _y_samples[0]
		last_y = _y_samples[_y_samples.size() - 1]
		settled = max_drift < 0.05  # metres -- real physics rest, not still falling

	var result := {
		"ok": _character != null,
		"character_found": _character != null,
		"sample_count": _y_samples.size(),
		"first_sampled_y": first_y,
		"last_sampled_y": last_y,
		"tail_max_drift_m": max_drift,
		"settled": settled,
		"frames_waited": _frame,
		"screenshot_saved": saved,
		"screenshot_path": _out_path,
	}
	print("[local_player_probe] RESULT ", JSON.stringify(result))
	return true
