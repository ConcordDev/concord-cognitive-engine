class_name SfxSynth
extends RefCounted
## SfxSynth — port of the Three.js client's procedural Web Audio SFX engine
## (`concord-frontend/components/world-lens/SoundscapeEngine.tsx`'s
## `SFX_MAP`/`LAYER_MAP`/`SFX_ALIASES`/`resolveSfxId`/`playToneSequence`).
## Godot has no `.mp3`/`.ogg`/`.wav` source files anywhere in this repo for
## EITHER client — the Three.js client's whole SFX design is deterministic
## real-time oscillator synthesis (sine/triangle/square/sawtooth + a linear
## ADSR envelope + optional semitone-stacked chords), not sample playback.
## This ports that exact design rather than sourcing external audio assets
## (avoids repeating the tower/forge CC0-search dead end for something that
## was never asset-shaped to begin with — see VISUAL_QA.md's Audio entry).
##
## `SFX_MAP`/`LAYER_MAP`/`SFX_ALIASES` below are a byte-for-byte data port —
## every id, frequency, oscillator type, duration/attack/decay, and
## semitone stack matches SoundscapeEngine.tsx's tables exactly, so a
## sound designed once for the browser client reads as the same sound in
## Godot. `resolve_sfx_id` ports `resolveSfxId`'s exact precedence: known
## voice -> explicit alias -> suffix heuristic -> hyphenated-form retry ->
## honest passthrough of the raw id (never silently drops a request; an
## unresolvable id just plays nothing, which the CALLER can detect via an
## empty generated-buffer check, matching the TS version's silent no-op
## for an unknown id).
##
## `generate_samples` is a pure function: same def + pitch_mul always
## produces the identical waveform, so it's unit-testable without any
## audio subsystem running (see tests/test_sfx_synth.gd). The engine-only
## half (turning samples into a real playable `AudioStreamWAV` and
## actually hearing it) is verified separately by `audio/sfx_player.gd`'s
## real-engine probe.

const SAMPLE_RATE := 44100

# oscillator "type" strings match the TS OscillatorType values exactly:
# sine | triangle | square | sawtooth.
const SFX_MAP := {
	"ascending-chime":   {"freq": 523.0, "type": "sine",     "duration": 0.5,  "attack": 0.01,  "decay": 0.4,  "semitones": [0, 4, 7]},
	"low-thud":          {"freq": 80.0,  "type": "triangle", "duration": 0.3,  "attack": 0.01,  "decay": 0.25},
	"snap-click":        {"freq": 1200.0,"type": "sine",     "duration": 0.08, "attack": 0.001, "decay": 0.07},
	"coin-clink":        {"freq": 1046.0,"type": "triangle", "duration": 0.4,  "attack": 0.001, "decay": 0.35, "semitones": [0, 7]},
	"notification-glow": {"freq": 660.0, "type": "sine",     "duration": 0.6,  "attack": 0.02,  "decay": 0.5},
	"fanfare-short":     {"freq": 523.0, "type": "square",   "duration": 0.8,  "attack": 0.01,  "decay": 0.6,  "semitones": [0, 4, 7, 12]},
	"rumble":            {"freq": 40.0,  "type": "sawtooth", "duration": 0.8,  "attack": 0.1,   "decay": 0.6},
	"build-finish":      {"freq": 440.0, "type": "sine",     "duration": 0.5,  "attack": 0.01,  "decay": 0.4,  "semitones": [0, 7, 12]},
	"victory-sting":     {"freq": 659.0, "type": "square",   "duration": 1.0,  "attack": 0.01,  "decay": 0.8,  "semitones": [0, 4, 7, 12, 16]},
	"gather-tick":       {"freq": 880.0, "type": "sine",     "duration": 0.08, "attack": 0.001, "decay": 0.07},
	"gather-success":    {"freq": 698.0, "type": "sine",     "duration": 0.4,  "attack": 0.01,  "decay": 0.35, "semitones": [0, 5, 9]},
	"gather-miss":       {"freq": 120.0, "type": "triangle", "duration": 0.2,  "attack": 0.01,  "decay": 0.18},
	"gather-full":       {"freq": 523.0, "type": "sine",     "duration": 0.7,  "attack": 0.01,  "decay": 0.6,  "semitones": [0, 4, 7, 12]},
	"craft-hold":        {"freq": 220.0, "type": "sine",     "duration": 0.3,  "attack": 0.05,  "decay": 0.2},
	"craft-release-good":{"freq": 784.0, "type": "sine",     "duration": 0.4,  "attack": 0.01,  "decay": 0.35, "semitones": [0, 4]},
	"craft-release-bad": {"freq": 110.0, "type": "sawtooth", "duration": 0.25, "attack": 0.01,  "decay": 0.22},
	"xp-tick":           {"freq": 1320.0,"type": "sine",     "duration": 0.15, "attack": 0.001, "decay": 0.14},
	"level-up":          {"freq": 523.0, "type": "triangle", "duration": 1.2,  "attack": 0.01,  "decay": 0.9,  "semitones": [0, 4, 7, 12, 19]},
	"hit-light":         {"freq": 140.0, "type": "triangle", "duration": 0.18, "attack": 0.001, "decay": 0.16},
	"hit-heavy":         {"freq": 70.0,  "type": "sawtooth", "duration": 0.28, "attack": 0.001, "decay": 0.26, "semitones": [0, -5]},
	"hit-crit":          {"freq": 260.0, "type": "square",   "duration": 0.32, "attack": 0.001, "decay": 0.28, "semitones": [0, -7, 12]},
	"dodge-whoosh":      {"freq": 700.0, "type": "sine",     "duration": 0.14, "attack": 0.001, "decay": 0.12},
	"block-clang":       {"freq": 110.0, "type": "square",   "duration": 0.22, "attack": 0.001, "decay": 0.20, "semitones": [0, 7]},
	"kill-blow":         {"freq": 55.0,  "type": "sawtooth", "duration": 0.55, "attack": 0.001, "decay": 0.50, "semitones": [0, -12]},
	"combat-swing":      {"freq": 520.0, "type": "sawtooth", "duration": 0.13, "attack": 0.001, "decay": 0.12, "semitones": [0, -7]},
	"combat-swing-heavy":{"freq": 300.0, "type": "sawtooth", "duration": 0.22, "attack": 0.002, "decay": 0.20, "semitones": [0, -9]},
	"combat-gunshot":    {"freq": 2200.0,"type": "square",   "duration": 0.06, "attack": 0.001, "decay": 0.05},
	"hit-transient":     {"freq": 1800.0,"type": "triangle", "duration": 0.04, "attack": 0.001, "decay": 0.035},
	"hit-thump-deep":    {"freq": 38.0,  "type": "sawtooth", "duration": 0.22, "attack": 0.001, "decay": 0.20},
	"bone-crack":        {"freq": 360.0, "type": "sawtooth", "duration": 0.06, "attack": 0.001, "decay": 0.055,"semitones": [0, -3]},
	"footstep-grass":    {"freq": 180.0, "type": "triangle", "duration": 0.06, "attack": 0.001, "decay": 0.055},
	"footstep-stone":    {"freq": 320.0, "type": "square",   "duration": 0.05, "attack": 0.001, "decay": 0.045},
	"footstep-wood":     {"freq": 260.0, "type": "triangle", "duration": 0.07, "attack": 0.001, "decay": 0.065},
	"footstep-water":    {"freq": 420.0, "type": "sine",     "duration": 0.10, "attack": 0.001, "decay": 0.090},
	"footstep-mud-squelch": {"freq": 95.0, "type": "sawtooth", "duration": 0.13, "attack": 0.002, "decay": 0.115},
	"ui-click":          {"freq": 1500.0,"type": "square",   "duration": 0.03, "attack": 0.001, "decay": 0.025},
	"ui-hover":          {"freq": 900.0, "type": "sine",     "duration": 0.02, "attack": 0.001, "decay": 0.018},
	"craft-ding":        {"freq": 880.0, "type": "sine",     "duration": 0.32, "attack": 0.005, "decay": 0.28, "semitones": [0, 4, 7]},
	"inventory-rustle":  {"freq": 220.0, "type": "sawtooth", "duration": 0.18, "attack": 0.005, "decay": 0.16, "semitones": [0, 3, -2]},
	"sword-swoosh":      {"freq": 520.0, "type": "triangle", "duration": 0.16, "attack": 0.001, "decay": 0.14, "semitones": [0, -7]},
	"sword-swoosh-heavy":{"freq": 360.0, "type": "sawtooth", "duration": 0.22, "attack": 0.001, "decay": 0.20, "semitones": [0, -10]},
	"heartbeat-lub":     {"freq": 65.0,  "type": "sine",     "duration": 0.10, "attack": 0.005, "decay": 0.09},
	"heartbeat-dub":     {"freq": 50.0,  "type": "sine",     "duration": 0.14, "attack": 0.005, "decay": 0.13},
	"ghost-step":        {"freq": 58.0,  "type": "sawtooth", "duration": 0.20, "attack": 0.004, "decay": 0.18, "semitones": [0, -4]},
}

const LAYER_MAP := {
	"hit-confirm-light": [
		{"sfx": "hit-transient", "delay_ms": 0},
		{"sfx": "hit-light",     "delay_ms": 8},
	],
	"hit-confirm-heavy": [
		{"sfx": "hit-transient",  "delay_ms": 0},
		{"sfx": "hit-heavy",      "delay_ms": 10},
		{"sfx": "hit-thump-deep", "delay_ms": 18},
	],
	"hit-confirm-crit": [
		{"sfx": "hit-transient",  "delay_ms": 0},
		{"sfx": "hit-crit",       "delay_ms": 6},
		{"sfx": "bone-crack",     "delay_ms": 14},
		{"sfx": "hit-thump-deep", "delay_ms": 22},
	],
	"hit-confirm-kill": [
		{"sfx": "hit-transient",  "delay_ms": 0},
		{"sfx": "kill-blow",      "delay_ms": 8},
		{"sfx": "hit-thump-deep", "delay_ms": 30},
		{"sfx": "rumble",         "delay_ms": 90},
	],
}

const SFX_ALIASES := {
	"ui_menu_open": "snap-click", "ui_success": "gather-success", "ui_failure": "gather-miss",
	"ui_milestone": "fanfare-short", "ui_discovery": "notification-glow",
	"ui_npc_menu_open": "snap-click", "ui_workbench_open": "snap-click", "ui_workbench_close": "snap-click",
	"ui_seed_plant": "gather-tick", "ui_crop_harvest": "gather-success", "ui_dish_serve": "gather-success",
	"ui_water": "footstep-water",
	"ui_trivia_correct": "gather-success", "ui_trivia_wrong": "gather-miss",
	"ui_hack_step": "snap-click", "ui_hack_complete": "victory-sting", "ui_hack_reset": "low-thud", "ui_terminal_error": "gather-miss",
	"ui_code_test_pass": "gather-success", "ui_code_test_fail": "gather-miss", "ui_code_submit_pass": "fanfare-short",
	"ui_karaoke_top_grade": "victory-sting", "ui_karaoke_finish": "gather-success", "ui_karaoke_finish_low": "gather-miss",
	"ui_mahjong_tsumo": "fanfare-short", "ui_mahjong_discard": "snap-click", "ui_mahjong_no_win": "gather-miss", "ui_mahjong_lost": "low-thud",
	"ui_glyph_mint": "ascending-chime", "ui_glyph_mint_failed": "gather-miss", "ui_hybrid_minted": "ascending-chime", "ui_breed_failed": "gather-miss",
	"ui_climb_summit": "victory-sting",
	"ui_brawl_invite": "notification-glow", "ui_brawl_accept": "gather-success",
	"ui_brawl_queue_join": "snap-click", "ui_brawl_queue_leave": "snap-click",
	"ui_lfg_posted": "notification-glow", "ui_spectate_join": "snap-click",
	"axe_chop": "sword-swoosh-heavy", "pick_strike": "hit-heavy", "hoe_dig": "low-thud",
	"shovel_dig": "low-thud", "rustle": "inventory-rustle", "crop_snap": "gather-tick",
	"soil_pat": "footstep-grass", "reel": "gather-tick", "water_pour": "footstep-water",
	"hammer": "craft-ding", "forge_ring": "craft-ding", "sizzle": "craft-hold",
	"grind": "rumble", "wrench": "snap-click", "plate_set": "craft-ding", "work": "craft-hold",
	"spell_cast": "ascending-chime", "chime": "ascending-chime", "post_drive": "low-thud",
	"greet": "notification-glow", "coins": "coin-clink", "clap": "snap-click",
	"keys": "ui-click", "pick": "snap-click", "cloth": "inventory-rustle",
	"mount": "low-thud", "dismount": "low-thud", "eat": "gather-tick", "drink": "gather-tick",
	"shutter": "snap-click",
	"dash": "dodge-whoosh", "slide": "dodge-whoosh", "scrape": "footstep-stone",
	"vault": "dodge-whoosh", "thud": "low-thud",
	"fire_whoosh": "sword-swoosh", "ice_crackle": "snap-click", "thunder": "rumble",
	"water_surge": "footstep-water", "hiss": "craft-release-bad", "energy_hum": "notification-glow",
	"stone_grind": "rumble",
}


## Ports `resolveSfxId` exactly: known voice -> alias -> suffix heuristic ->
## hyphenated retry -> honest passthrough (never fabricates a mapping).
static func resolve_sfx_id(sfx_id: String) -> String:
	if sfx_id.is_empty():
		return sfx_id
	if SFX_MAP.has(sfx_id) or LAYER_MAP.has(sfx_id):
		return sfx_id
	if SFX_ALIASES.has(sfx_id):
		return SFX_ALIASES[sfx_id]
	if sfx_id.ends_with("_fail") or sfx_id.ends_with("_failed") or sfx_id.ends_with("_wrong") \
			or sfx_id.ends_with("_lost") or sfx_id.ends_with("_error") or sfx_id.ends_with("_no_win") \
			or sfx_id.ends_with("_leave"):
		return "gather-miss"
	if sfx_id.ends_with("_top_grade") or sfx_id.ends_with("_tsumo") or sfx_id.ends_with("_summit") \
			or sfx_id.ends_with("_complete"):
		return "victory-sting"
	if sfx_id.ends_with("_pass") or sfx_id.ends_with("_correct") or sfx_id.ends_with("_accept") \
			or sfx_id.ends_with("_finish") or sfx_id.ends_with("_minted") or sfx_id.ends_with("_mint") \
			or sfx_id.ends_with("_harvest") or sfx_id.ends_with("_serve") or sfx_id.ends_with("_win"):
		return "gather-success"
	if sfx_id.ends_with("_open") or sfx_id.ends_with("_close") or sfx_id.ends_with("_step") \
			or sfx_id.ends_with("_discard") or sfx_id.ends_with("_plant") or sfx_id.ends_with("_join") \
			or sfx_id.ends_with("_posted") or sfx_id.ends_with("_menu"):
		return "snap-click"
	var hy := sfx_id
	if hy.begins_with("ui_"):
		hy = "ui-" + hy.substr(3)
	hy = hy.replace("_", "-")
	if SFX_MAP.has(hy) or LAYER_MAP.has(hy):
		return hy
	return sfx_id


## Naive (non-bandlimited) oscillator waveforms — perceptually correct for
## short percussive SFX at these frequencies/sample rates; matches the
## TS port's own "reasonable effort, not perfect fidelity" scope (the real
## OscillatorNode is bandlimited internally; a naive port is the honest
## trade this session makes rather than implementing PolyBLEP for a one-
## shot game SFX layer).
static func _wave(osc_type: String, phase: float) -> float:
	match osc_type:
		"sine":
			return sin(phase)
		"square":
			return 1.0 if sin(phase) >= 0.0 else -1.0
		"sawtooth":
			var t := phase / TAU
			return 2.0 * (t - floor(0.5 + t))
		"triangle":
			var t2 := phase / TAU
			return 2.0 * absf(2.0 * (t2 - floor(t2 + 0.5))) - 1.0
		_:
			return sin(phase)


## Linear ADSR gain at time `t` (seconds) within one tone step: ramps
## 0 -> 0.25 over [0, attack], then 0.25 -> 0 over [attack, decay].
## Mirrors playToneSequence's `gain.gain.linearRampToValueAtTime` pair
## exactly (peak is always 0.25, matching the TS constant).
static func _envelope_gain(t: float, attack: float, decay: float) -> float:
	if t < 0.0 or t > decay:
		return 0.0
	if t <= attack:
		if attack <= 0.0:
			return 0.25
		return 0.25 * (t / attack)
	var decay_span := decay - attack
	if decay_span <= 0.0:
		return 0.0
	return 0.25 * (1.0 - (t - attack) / decay_span)


## Pure synthesis: generates the mixed, clamped waveform for `def` (an
## SFX_MAP-shaped Dictionary) at `pitch_mul`, sample_rate `SAMPLE_RATE`.
## Mirrors playToneSequence's per-step oscillator scheduling — each
## semitone (or the single base freq when none given) gets its own
## time-offset ADSR envelope within an arpeggiated, possibly-overlapping
## step grid — summed into one buffer and hard-clamped to [-1, 1] (the
## TS version can also technically clip on overlap; clamping here is the
## honest equivalent of what a real speaker/limiter would do).
static func generate_samples(def: Dictionary, pitch_mul: float = 1.0) -> PackedFloat32Array:
	if def.is_empty():
		return PackedFloat32Array()

	var base_freq := float(def.get("freq", 440.0))
	var osc_type := String(def.get("type", "sine"))
	var duration := float(def.get("duration", 0.2))
	var attack := float(def.get("attack", 0.01))
	var decay := float(def.get("decay", 0.15))
	var semitones: Array = def.get("semitones", [])

	var freqs: Array[float] = []
	if semitones.is_empty():
		freqs.append(base_freq * pitch_mul)
	else:
		for s in semitones:
			freqs.append(base_freq * pow(2.0, float(s) / 12.0) * pitch_mul)

	var step_duration := duration / float(freqs.size())
	var tail := 0.05
	var total_duration := 0.0
	for i in range(freqs.size()):
		total_duration = maxf(total_duration, float(i) * step_duration + decay + tail)

	var total_samples := int(ceil(total_duration * SAMPLE_RATE))
	if total_samples <= 0:
		return PackedFloat32Array()

	var out := PackedFloat32Array()
	out.resize(total_samples)
	out.fill(0.0)

	for i in range(freqs.size()):
		var f: float = freqs[i]
		var step_start := float(i) * step_duration
		var step_start_sample := int(step_start * SAMPLE_RATE)
		var step_len_samples := int(ceil(decay * SAMPLE_RATE)) + 1
		for n in range(step_len_samples):
			var sample_idx := step_start_sample + n
			if sample_idx < 0 or sample_idx >= total_samples:
				continue
			var t := float(n) / SAMPLE_RATE
			var g := _envelope_gain(t, attack, decay)
			if g <= 0.0:
				continue
			var phase := TAU * f * (step_start + t)
			out[sample_idx] += g * _wave(osc_type, phase)

	for i in range(out.size()):
		out[i] = clampf(out[i], -1.0, 1.0)

	return out


## Mechanical float->16-bit-PCM-LE conversion — the encode step
## `audio/sfx_player.gd` feeds into a real `AudioStreamWAV.data`.
static func float_samples_to_pcm16(samples: PackedFloat32Array) -> PackedByteArray:
	var bytes := PackedByteArray()
	bytes.resize(samples.size() * 2)
	for i in range(samples.size()):
		var v := clampf(samples[i], -1.0, 1.0)
		var s16 := int(round(v * 32767.0))
		bytes.encode_s16(i * 2, s16)
	return bytes
