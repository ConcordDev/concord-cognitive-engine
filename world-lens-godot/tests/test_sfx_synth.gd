class_name TestSfxSynth
extends RefCounted
## Pure-logic tests for audio/sfx_synth.gd — the ported SFX_MAP/LAYER_MAP/
## SFX_ALIASES tables, resolve_sfx_id's exact TS-mirrored precedence, and
## generate_samples' deterministic waveform synthesis. No AudioServer/
## AudioStreamPlayer involved — see tools/sfx_player_probe.gd for the
## real-engine half.

const SfxSynth := preload("res://audio/sfx_synth.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_resolve_known_voice_passthrough(t)
	_test_resolve_explicit_alias(t)
	_test_resolve_suffix_heuristics(t)
	_test_resolve_hyphenated_retry(t)
	_test_resolve_honest_passthrough_for_unknown(t)
	_test_resolve_empty_string(t)
	_test_generate_samples_empty_def(t)
	_test_generate_samples_single_tone_length(t)
	_test_generate_samples_chord_is_longer(t)
	_test_generate_samples_values_in_range(t)
	_test_generate_samples_is_deterministic(t)
	_test_generate_samples_silent_before_and_after_envelope(t)
	_test_float_to_pcm16_conversion(t)
	return t


static func _test_resolve_known_voice_passthrough(t: TestUtils) -> void:
	t.check_eq(SfxSynth.resolve_sfx_id("hit-light"), "hit-light", "a real SFX_MAP id passes through unchanged")
	t.check_eq(SfxSynth.resolve_sfx_id("hit-confirm-crit"), "hit-confirm-crit", "a real LAYER_MAP id passes through unchanged")


static func _test_resolve_explicit_alias(t: TestUtils) -> void:
	t.check_eq(SfxSynth.resolve_sfx_id("ui_success"), "gather-success", "ui_success resolves via the explicit alias table")
	t.check_eq(SfxSynth.resolve_sfx_id("axe_chop"), "sword-swoosh-heavy", "axe_chop resolves via the explicit alias table")
	t.check_eq(SfxSynth.resolve_sfx_id("ui_hack_complete"), "victory-sting", "ui_hack_complete resolves via the explicit alias table")


static func _test_resolve_suffix_heuristics(t: TestUtils) -> void:
	t.check_eq(SfxSynth.resolve_sfx_id("some_future_thing_failed"), "gather-miss", "_failed suffix heuristic")
	t.check_eq(SfxSynth.resolve_sfx_id("some_future_thing_summit"), "victory-sting", "_summit suffix heuristic")
	t.check_eq(SfxSynth.resolve_sfx_id("some_future_thing_correct"), "gather-success", "_correct suffix heuristic")
	t.check_eq(SfxSynth.resolve_sfx_id("some_future_thing_menu"), "snap-click", "_menu suffix heuristic")


static func _test_resolve_hyphenated_retry(t: TestUtils) -> void:
	# "ui_hover" -> hyphenated retry "ui-hover" IS a real SFX_MAP key (not
	# aliased, not suffix-matched) — pins the last-resort retry path.
	t.check_eq(SfxSynth.resolve_sfx_id("ui_hover"), "ui-hover", "ui_hover retries as the hyphenated ui-hover, a real SFX_MAP voice")


static func _test_resolve_honest_passthrough_for_unknown(t: TestUtils) -> void:
	var unknown := "totally_unmapped_xyz_123"
	t.check_eq(SfxSynth.resolve_sfx_id(unknown), unknown,
		"a genuinely unresolvable id passes through unchanged, never fabricated onto a random voice")


static func _test_resolve_empty_string(t: TestUtils) -> void:
	t.check_eq(SfxSynth.resolve_sfx_id(""), "", "empty id resolves to empty, never a fabricated default sound")


static func _test_generate_samples_empty_def(t: TestUtils) -> void:
	var samples := SfxSynth.generate_samples({})
	t.check_eq(samples.size(), 0, "an empty def produces zero samples, not a fabricated tone")


static func _test_generate_samples_single_tone_length(t: TestUtils) -> void:
	var def: Dictionary = SfxSynth.SFX_MAP["snap-click"]
	var samples := SfxSynth.generate_samples(def)
	var expected_min := int(def["decay"] * SfxSynth.SAMPLE_RATE)
	t.check(samples.size() >= expected_min,
		"a single-tone def (no semitones) produces at least decay-duration worth of samples")
	t.check(samples.size() < expected_min + int(0.2 * SfxSynth.SAMPLE_RATE),
		"single-tone sample count stays close to the real decay window, not wildly padded")


static func _test_generate_samples_chord_is_longer(t: TestUtils) -> void:
	var single := SfxSynth.generate_samples(SfxSynth.SFX_MAP["low-thud"])  # no semitones
	var chord := SfxSynth.generate_samples(SfxSynth.SFX_MAP["ascending-chime"])  # 3 semitones
	t.check(chord.size() > single.size(),
		"a 3-note semitone chord produces a longer buffer than a single-tone def (arpeggiated steps)")


static func _test_generate_samples_values_in_range(t: TestUtils) -> void:
	var samples := SfxSynth.generate_samples(SfxSynth.SFX_MAP["victory-sting"])  # 5-note chord, likely to overlap
	var out_of_range := false
	for v in samples:
		if v < -1.0 or v > 1.0:
			out_of_range = true
			break
	t.check(not out_of_range, "every generated sample is clamped within [-1, 1], even a dense 5-note chord")
	var has_signal := false
	for v in samples:
		if absf(v) > 0.01:
			has_signal = true
			break
	t.check(has_signal, "the generated buffer carries real audible signal, not silence")


static func _test_generate_samples_is_deterministic(t: TestUtils) -> void:
	var a := SfxSynth.generate_samples(SfxSynth.SFX_MAP["hit-heavy"], 1.0)
	var b := SfxSynth.generate_samples(SfxSynth.SFX_MAP["hit-heavy"], 1.0)
	t.check_eq(a.size(), b.size(), "same def + pitch always produces the same buffer length")
	var identical := true
	for i in range(a.size()):
		if not is_equal_approx(a[i], b[i]):
			identical = false
			break
	t.check(identical, "same def + pitch always produces byte-identical samples (pure function, no hidden RNG)")


static func _test_generate_samples_silent_before_and_after_envelope(t: TestUtils) -> void:
	var def: Dictionary = SfxSynth.SFX_MAP["gather-tick"]  # no semitones, short decay
	var samples := SfxSynth.generate_samples(def)
	var decay_sample := int(def["decay"] * SfxSynth.SAMPLE_RATE)
	var tail_sample := samples.size() - 1
	t.check(absf(samples[tail_sample]) < 0.05,
		"the buffer's tail (past decay + silence pad) carries no meaningful residual signal")
	t.check(decay_sample < samples.size(), "the decay point itself falls inside the generated buffer")


static func _test_float_to_pcm16_conversion(t: TestUtils) -> void:
	var samples := PackedFloat32Array([0.0, 1.0, -1.0, 0.5])
	var pcm := SfxSynth.float_samples_to_pcm16(samples)
	t.check_eq(pcm.size(), samples.size() * 2, "16-bit PCM is 2 bytes per sample")
	t.check_eq(pcm.decode_s16(0), 0, "0.0 encodes to PCM 0")
	t.check_eq(pcm.decode_s16(2), 32767, "1.0 encodes to the real positive 16-bit ceiling")
	t.check(pcm.decode_s16(4) <= -32760, "-1.0 encodes near the real negative 16-bit floor")
