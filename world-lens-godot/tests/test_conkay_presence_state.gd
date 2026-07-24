class_name TestConKayPresenceState
extends RefCounted
## Pure-logic tests for conkay/conkay_presence_state.gd (R5/E22 — ConKay
## spatial mode). ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md.

const ConKayPresenceState := preload("res://conkay/conkay_presence_state.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_apply_macro_event_started_and_completed(t)
	_test_apply_macro_event_ignores_missing_run_id(t)
	_test_apply_macro_event_completed_for_unknown_id_is_a_noop(t)
	_test_apply_macro_event_does_not_mutate_input(t)
	_test_is_busy_tracks_multiple_concurrent_runs(t)
	_test_visual_state_busy_always_wins(t)
	_test_visual_state_tier_mapping(t)
	_test_visual_state_unknown_or_empty_tier_is_unverified(t)
	_test_color_for_state_is_distinct_per_state(t)
	return t


static func _test_apply_macro_event_started_and_completed(t: TestUtils) -> void:
	var inflight := {}
	inflight = ConKayPresenceState.apply_macro_event(inflight, "macro:started", "run-1")
	t.check(ConKayPresenceState.is_busy(inflight), "busy immediately after macro:started")

	inflight = ConKayPresenceState.apply_macro_event(inflight, "macro:completed", "run-1")
	t.check(not ConKayPresenceState.is_busy(inflight), "idle again after the matching macro:completed")


static func _test_apply_macro_event_ignores_missing_run_id(t: TestUtils) -> void:
	var inflight := {}
	inflight = ConKayPresenceState.apply_macro_event(inflight, "macro:started", "")
	t.check(not ConKayPresenceState.is_busy(inflight),
		"an event with no runId never fabricates a run to track")


static func _test_apply_macro_event_completed_for_unknown_id_is_a_noop(t: TestUtils) -> void:
	var inflight := {"run-a": true}
	inflight = ConKayPresenceState.apply_macro_event(inflight, "macro:completed", "run-does-not-exist")
	t.check(ConKayPresenceState.is_busy(inflight),
		"completing an id that was never tracked as started doesn't clear a real in-flight run")


static func _test_apply_macro_event_does_not_mutate_input(t: TestUtils) -> void:
	var original := {}
	var after := ConKayPresenceState.apply_macro_event(original, "macro:started", "run-x")
	t.check(original.is_empty(), "the input dictionary is never mutated in place")
	t.check(ConKayPresenceState.is_busy(after), "the returned dictionary reflects the new state")


static func _test_is_busy_tracks_multiple_concurrent_runs(t: TestUtils) -> void:
	var inflight := {}
	inflight = ConKayPresenceState.apply_macro_event(inflight, "macro:started", "run-1")
	inflight = ConKayPresenceState.apply_macro_event(inflight, "macro:started", "run-2")
	t.check(ConKayPresenceState.is_busy(inflight), "busy while two runs are in flight")

	inflight = ConKayPresenceState.apply_macro_event(inflight, "macro:completed", "run-1")
	t.check(ConKayPresenceState.is_busy(inflight),
		"still busy — run-2 is still in flight even though run-1 finished")

	inflight = ConKayPresenceState.apply_macro_event(inflight, "macro:completed", "run-2")
	t.check(not ConKayPresenceState.is_busy(inflight), "idle once every tracked run has completed")


static func _test_visual_state_busy_always_wins(t: TestUtils) -> void:
	t.check_eq(
		ConKayPresenceState.visual_state(true, "proven"), ConKayPresenceState.STATE_THINKING,
		"a real in-flight call outranks even a strong prior verdict")
	t.check_eq(
		ConKayPresenceState.visual_state(true, ""), ConKayPresenceState.STATE_THINKING,
		"busy wins even with no prior verdict at all")


static func _test_visual_state_tier_mapping(t: TestUtils) -> void:
	t.check_eq(ConKayPresenceState.visual_state(false, "proven"), ConKayPresenceState.STATE_PROVEN)
	t.check_eq(ConKayPresenceState.visual_state(false, "flagged"), ConKayPresenceState.STATE_FLAGGED)
	t.check_eq(ConKayPresenceState.visual_state(false, "reasoned"), ConKayPresenceState.STATE_REASONED)


static func _test_visual_state_unknown_or_empty_tier_is_unverified(t: TestUtils) -> void:
	t.check_eq(
		ConKayPresenceState.visual_state(false, ""), ConKayPresenceState.STATE_UNVERIFIED,
		"no verdict has arrived yet -> honest Unverified, never a guessed tier")
	t.check_eq(
		ConKayPresenceState.visual_state(false, "some-unrecognized-string"),
		ConKayPresenceState.STATE_UNVERIFIED,
		"an unrecognized tier string degrades to Unverified, not a crash or a guess")


static func _test_color_for_state_is_distinct_per_state(t: TestUtils) -> void:
	var states := [
		ConKayPresenceState.STATE_THINKING,
		ConKayPresenceState.STATE_PROVEN,
		ConKayPresenceState.STATE_FLAGGED,
		ConKayPresenceState.STATE_REASONED,
		ConKayPresenceState.STATE_UNVERIFIED,
	]
	var seen: Array[Color] = []
	for s in states:
		var c: Color = ConKayPresenceState.color_for_state(s)
		t.check(not seen.has(c), "state '%s' has a color distinct from every earlier state" % s)
		seen.append(c)

	t.check_eq(
		ConKayPresenceState.color_for_state(ConKayPresenceState.STATE_IDLE),
		ConKayPresenceState.color_for_state(ConKayPresenceState.STATE_UNVERIFIED),
		"idle and unverified intentionally share ConKay's resting cyan identity color")
