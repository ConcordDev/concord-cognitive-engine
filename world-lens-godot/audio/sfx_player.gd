class_name SfxPlayer
extends Node
## SfxPlayer — the engine-facing half of the ported SFX system (see
## audio/sfx_synth.gd's own header for the full "why synthesized, not
## sample-based" rationale). Turns SfxSynth's pure waveform generation into
## real, audible playback via a pooled AudioStreamPlayer (2D, master-bus)
## and on-demand AudioStreamPlayer3D nodes (spatial, world-positioned).
##
## Generated `AudioStreamWAV`s are cached by (resolved_id, rounded pitch)
## so a repeated sound (footsteps, combo hits) doesn't re-synthesize every
## call — same efficiency shape a real game's SFX pool would want.
##
## Honest no-op discipline: `play_sfx`/`play_sfx_3d`/`play_layered` on an
## id that `SfxSynth.resolve_sfx_id` can't map to a known voice do
## nothing — mirrors the TS `triggerSFX`'s silent drop for an unknown id,
## never a fabricated fallback sound.

const SfxSynth := preload("res://audio/sfx_synth.gd")

## Master volume in [0, 1] — multiplies every generated stream's playback
## volume. Exposed for the settings menu (see VISUAL_QA.md's UI-chrome
## task) to wire a real slider onto; defaults to a sane audible level.
@export var master_volume: float = 0.8:
	set(v):
		master_volume = clampf(v, 0.0, 1.0)
		_apply_volume_to_pool()

const POOL_SIZE := 8

var _pool: Array[AudioStreamPlayer] = []
var _pool_next: int = 0
var _stream_cache: Dictionary = {}  # "id@pitch*100" -> AudioStreamWAV


func _ready() -> void:
	for i in range(POOL_SIZE):
		var p := AudioStreamPlayer.new()
		add_child(p)
		_pool.append(p)
	_apply_volume_to_pool()


func _apply_volume_to_pool() -> void:
	var db := linear_to_db(maxf(master_volume, 0.0001)) if master_volume > 0.0 else -80.0
	for p in _pool:
		p.volume_db = db


## Non-spatial (UI/global) one-shot playback. Honest no-op for an
## unresolvable id — never fabricates a fallback sound.
func play_sfx(sfx_id: String, pitch_mul: float = 1.0) -> void:
	var resolved := SfxSynth.resolve_sfx_id(sfx_id)
	if SfxSynth.LAYER_MAP.has(resolved):
		play_layered(sfx_id)
		return
	if not SfxSynth.SFX_MAP.has(resolved):
		return
	var stream := _stream_for(resolved, pitch_mul)
	if stream == null:
		return
	var player := _next_pool_player()
	player.stream = stream
	player.play()


## World-positioned one-shot playback via a temporary AudioStreamPlayer3D,
## auto-freed once the stream finishes. Mirrors playToneSpatial's role
## (Three.js client's HRTF-panned SFX) without needing occlusion/rolloff
## parity byte-for-byte — Godot's own AudioStreamPlayer3D distance
## attenuation is the real, built-in equivalent.
func play_sfx_3d(sfx_id: String, world_position: Vector3, pitch_mul: float = 1.0) -> void:
	var resolved := SfxSynth.resolve_sfx_id(sfx_id)
	if SfxSynth.LAYER_MAP.has(resolved):
		play_layered_3d(sfx_id, world_position)
		return
	if not SfxSynth.SFX_MAP.has(resolved):
		return
	var stream := _stream_for(resolved, pitch_mul)
	if stream == null:
		return
	var player := AudioStreamPlayer3D.new()
	get_tree().current_scene.add_child(player) if get_tree() != null and get_tree().current_scene != null else add_child(player)
	player.global_position = world_position
	player.stream = stream
	player.volume_db = linear_to_db(maxf(master_volume, 0.0001)) if master_volume > 0.0 else -80.0
	player.max_distance = 50.0
	player.unit_size = 1.0
	player.finished.connect(player.queue_free)
	player.play()


## Layered SFX (LAYER_MAP): schedules each step's `play_sfx` call at its
## real delay via one-shot SceneTree timers — mirrors the TS layered
## approach's setTimeout-based scheduling exactly (a high transient tick,
## a mid body, a deep thump, each genuinely time-offset, not pre-mixed).
func play_layered(sfx_id: String, pitch_mul: float = 1.0) -> void:
	var resolved := SfxSynth.resolve_sfx_id(sfx_id)
	var steps: Array = SfxSynth.LAYER_MAP.get(resolved, [])
	if steps.is_empty():
		return
	for step in steps:
		var delay_s: float = float(step.get("delay_ms", 0)) / 1000.0
		var voice: String = String(step.get("sfx", ""))
		if delay_s <= 0.0:
			play_sfx(voice, pitch_mul)
		else:
			get_tree().create_timer(delay_s).timeout.connect(play_sfx.bind(voice, pitch_mul))


func play_layered_3d(sfx_id: String, world_position: Vector3, pitch_mul: float = 1.0) -> void:
	var resolved := SfxSynth.resolve_sfx_id(sfx_id)
	var steps: Array = SfxSynth.LAYER_MAP.get(resolved, [])
	if steps.is_empty():
		return
	for step in steps:
		var delay_s: float = float(step.get("delay_ms", 0)) / 1000.0
		var voice: String = String(step.get("sfx", ""))
		if delay_s <= 0.0:
			play_sfx_3d(voice, world_position, pitch_mul)
		else:
			get_tree().create_timer(delay_s).timeout.connect(play_sfx_3d.bind(voice, world_position, pitch_mul))


func _next_pool_player() -> AudioStreamPlayer:
	var p := _pool[_pool_next]
	_pool_next = (_pool_next + 1) % _pool.size()
	return p


func _stream_for(resolved_id: String, pitch_mul: float) -> AudioStreamWAV:
	var key := "%s@%d" % [resolved_id, int(round(pitch_mul * 100.0))]
	if _stream_cache.has(key):
		return _stream_cache[key]
	var def: Dictionary = SfxSynth.SFX_MAP.get(resolved_id, {})
	if def.is_empty():
		return null
	var samples := SfxSynth.generate_samples(def, pitch_mul)
	if samples.is_empty():
		return null
	var stream := AudioStreamWAV.new()
	stream.data = SfxSynth.float_samples_to_pcm16(samples)
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SfxSynth.SAMPLE_RATE
	stream.stereo = false
	_stream_cache[key] = stream
	return stream
