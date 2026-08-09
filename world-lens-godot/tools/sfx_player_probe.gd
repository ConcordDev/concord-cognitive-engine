extends SceneTree
## sfx_player_probe.gd — real-engine verification for the ported SFX system:
## does a REAL SfxPlayer, running inside a real SceneTree with a real
## AudioServer, actually assign a real generated AudioStreamWAV to a real
## AudioStreamPlayer and start it playing? Does an unresolvable id stay a
## genuine no-op? Does a layered SFX (LAYER_MAP) fire its later steps for
## real, on their own delayed timers, not just synchronously?
##
## Headless is sufficient — AudioServer runs on the null/dummy driver in
## `--headless` mode and still processes real AudioStreamPlayer state
## (playing/stream/get_playback_position), so this makes a real claim
## about the engine wiring without needing actual sound hardware.
##
## Run:
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/sfx_player_probe.gd

const SfxPlayer := preload("res://audio/sfx_player.gd")

var _player: SfxPlayer
var _frame := 0
var _result := {}


func _initialize() -> void:
	_player = SfxPlayer.new()
	get_root().add_child(_player)


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < 3:
		return false

	if _frame == 3:
		# 1. A known, single-tone id actually plays on a real pool player.
		_player.play_sfx("snap-click")
		return false

	if _frame == 4:
		var any_playing := false
		var played_stream_len := -1
		for p in _player._pool:
			if p.playing:
				any_playing = true
				played_stream_len = p.stream.data.size() if p.stream != null else -1
		_result["single_tone_played"] = any_playing
		_result["single_tone_stream_bytes"] = played_stream_len

		# 2. An unresolvable id is a genuine no-op — no pool player starts.
		var before := []
		for p in _player._pool:
			before.append(p.playing)
		_player.play_sfx("totally_unknown_nonexistent_id_xyz")
		_result["unknown_id_before"] = before
		return false

	if _frame == 5:
		var after := []
		for p in _player._pool:
			after.append(p.playing)
		# Honest comparison: the unknown-id call must not have started any
		# NEW player beyond what was already playing from step 1 (that
		# earlier sound may still legitimately be playing this soon).
		var new_players_started := 0
		var before: Array = _result.get("unknown_id_before", [])
		for i in range(after.size()):
			if after[i] and i < before.size() and not before[i]:
				new_players_started += 1
		_result["unknown_id_started_new_player"] = new_players_started > 0

		# 3. Layered SFX: the first step fires immediately (frame 5), later
		# steps are genuinely scheduled via SceneTree timers, not fired
		# synchronously — verified by checking a cache-key/pool state change
		# ACROSS real elapsed frames below, not all at once.
		_player.play_layered("hit-confirm-kill")  # 4 steps: 0, 8, 30, 90 ms delays
		_result["layer_cache_size_at_fire"] = _player._stream_cache.size()
		return false

	if _frame == 70:  # ~1.1s of real frames at 60fps-equivalent idle processing — plenty past the 90ms last layer step
		var cache_after: int = _player._stream_cache.size()
		_result["layer_cache_size_after_wait"] = cache_after
		_result["layer_all_steps_generated"] = cache_after > int(_result.get("layer_cache_size_at_fire", 0))

		# 4. play_sfx_3d actually creates and configures a real AudioStreamPlayer3D.
		var root3d := Node3D.new()
		get_root().add_child(root3d)
		if current_scene == null:
			current_scene = root3d
		_player.play_sfx_3d("hit-light", Vector3(3.0, 0.0, -2.0))
		return false

	if _frame == 71:
		var found_3d := false
		var found_pos := Vector3.ZERO
		for c in get_root().get_children():
			for gc in c.get_children():
				if gc is AudioStreamPlayer3D:
					found_3d = true
					found_pos = gc.global_position
		_result["spatial_player_created"] = found_3d
		_result["spatial_player_position"] = [found_pos.x, found_pos.y, found_pos.z]
		_result["ok"] = true
		print("[sfx_player_probe] RESULT ", JSON.stringify(_result))
		return true

	return false
