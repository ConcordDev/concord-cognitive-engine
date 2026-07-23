class_name TestCharacterController
extends RefCounted
## Pure-logic tests for player/character_controller.gd's movement
## integration math + netcode gating. ENGINE-GATED execution — see
## world-lens-godot/VISUAL_QA.md. These call the class's STATIC methods
## directly; no CharacterBody3D needs to exist in a live scene tree for
## this to run under a real engine (static method calls on a preloaded
## script resource don't require an instance).

const CharacterController := preload("res://player/character_controller.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_gravity_and_glide(t)
	_test_swim(t)
	_test_coyote_time(t)
	_test_jump_buffer(t)
	_test_variable_jump_height(t)
	_test_send_throttle(t)
	_test_nack_snapback(t)
	return t


static func _test_gravity_and_glide(t: TestUtils) -> void:
	var v := CharacterController.integrate_gravity(0.0, 1.0, false)
	t.check_almost(v, -9.81, "one second of free fall loses 9.81 m/s when not gliding")

	var glide_v := CharacterController.integrate_gravity(-0.5, 1.0, true)
	t.check_eq(
		glide_v, CharacterController.GLIDE_DESCENT_CAP,
		"glide clamps descent at GLIDE_DESCENT_CAP")

	var still_ascending := CharacterController.integrate_gravity(10.0, 0.05, true)
	t.check(
		still_ascending > CharacterController.GLIDE_DESCENT_CAP,
		"glide never clamps while still ascending")

	var boosted := CharacterController.glide_horizontal_boost(1.0, 0.0, true)
	var expected_x: float = 1.0 + CharacterController.GLIDE_HORIZ_BOOST
	t.check_almost(boosted.x, expected_x, "gliding adds GLIDE_HORIZ_BOOST forward push")

	var unboosted := CharacterController.glide_horizontal_boost(1.0, 0.0, false)
	t.check_eq(unboosted.x, 1.0, "no boost is applied when not gliding")


static func _test_swim(t: TestUtils) -> void:
	var lo: float = CharacterController.SWIM_VEL_MIN
	var hi: float = CharacterController.SWIM_VEL_MAX

	var swim_v := CharacterController.integrate_swim(0.0, 1.0)
	t.check(swim_v > lo and swim_v < hi, "swim integration stays inside the clamp band")

	var swim_clamped_hi := CharacterController.integrate_swim(100.0, 1.0)
	t.check_eq(swim_clamped_hi, hi, "swim upward velocity clamps at the max")

	var swim_clamped_lo := CharacterController.integrate_swim(-100.0, 1.0)
	t.check_eq(swim_clamped_lo, lo, "swim downward velocity clamps at the min")


static func _test_coyote_time(t: TestUtils) -> void:
	t.check(
		CharacterController.can_jump(false, false, 0, 1000),
		"a grounded character can always jump")
	t.check(
		CharacterController.can_jump(true, false, 1000, 1050),
		"airborne within the coyote window can still jump")
	t.check(
		not CharacterController.can_jump(true, false, 1000, 1200),
		"airborne past the coyote window cannot jump")
	t.check(
		not CharacterController.can_jump(true, true, 1000, 1010),
		"a swimming character can never coyote-jump")


static func _test_jump_buffer(t: TestUtils) -> void:
	t.check(
		CharacterController.should_flush_buffer(1000, 1100),
		"a jump buffered within the window flushes on landing")
	t.check(
		not CharacterController.should_flush_buffer(1000, 1200),
		"a jump buffered outside the window does not flush")
	t.check(
		not CharacterController.should_flush_buffer(0, 1100),
		"0 means no buffered jump — it never flushes")


static func _test_variable_jump_height(t: TestUtils) -> void:
	var cut := CharacterController.cut_jump(10.0)
	var expected: float = 10.0 * CharacterController.JUMP_CUT_FACTOR
	t.check_almost(cut, expected, "releasing early cuts an ascending jump by JUMP_CUT_FACTOR")

	var not_cut := CharacterController.cut_jump(-5.0)
	t.check_eq(not_cut, -5.0, "releasing while already falling is a no-op")


static func _test_send_throttle(t: TestUtils) -> void:
	t.check(
		not CharacterController.should_send_move(1010, 1000),
		"sending again 10ms later is throttled")
	t.check(
		CharacterController.should_send_move(1033, 1000),
		"sending again 33ms later is allowed (~30Hz, matching the server cap)")
	t.check(
		CharacterController.should_send_move(1000, 0),
		"the very first send (last_sent_ms 0) is always allowed")


static func _test_nack_snapback(t: TestUtils) -> void:
	var fallback := Vector3(9, 9, 9)

	var good_nack := {"reason": "teleport", "prev": {"x": 1.0, "y": 2.0, "z": 3.0}}
	var snapped := CharacterController.snapback_position(good_nack, fallback)
	t.check(
		snapped.is_equal_approx(Vector3(1, 2, 3)),
		"a well-formed nack snaps to the server's prev position")

	var no_prev := CharacterController.snapback_position({}, fallback)
	t.check(
		no_prev.is_equal_approx(fallback),
		"a nack with no prev field falls back honestly, never fabricating a position")

	var bad_prev := CharacterController.snapback_position({"prev": "not_a_dict"}, fallback)
	t.check(
		bad_prev.is_equal_approx(fallback),
		"a malformed prev field (not a dictionary) falls back honestly")

	var partial_prev_data := {"prev": {"x": 1.0, "y": 2.0}}
	var partial_prev := CharacterController.snapback_position(partial_prev_data, fallback)
	t.check(
		partial_prev.is_equal_approx(fallback),
		"a prev field missing a required axis falls back honestly rather than guessing")
