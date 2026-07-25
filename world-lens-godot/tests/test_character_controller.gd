class_name TestCharacterController
extends RefCounted
## Pure-logic tests for player/character_controller.gd's movement
## integration math + netcode gating.
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 32 checks
## are asserted on every run. The header's prior prediction that static
## method calls on a preloaded script resource would need no CharacterBody3D
## instance under a real engine turned out to be correct; it is now an
## observed fact rather than a forecast.
##
## Verified: the gravity/swim integration, glide boost, jump-forgiveness
## buffer/coyote gating, the <=30Hz `should_send_move` rate gate, action
## classification, and `snapback_position` — i.e. the numeric parity with
## physics-world.ts / jump-forgiveness.ts that this port claims.
##
## NOT verified: the live CharacterBody3D half — `_physics_process` +
## `move_and_slide` collision response against real world geometry — and,
## crucially, FEEL. "Feels identical to the Three.js/Rapier client for the
## same inputs" is the claim this file's subject makes, and no headless run
## can substantiate it: RasterizerDummy draws nothing and there is no player
## at a display. Queued in world-lens-godot/VISUAL_QA.md.

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
	_test_classify_action(t)
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


static func _test_classify_action(t: TestUtils) -> void:
	# R5 continuation — real idle/walk/run classification of the LOCAL
	# player's own outgoing `action` field. Mirrors
	# AnimationStateMachine.IDLE_MAX_SPEED / RUN_MIN_SPEED and
	# server/lib/city-presence.js's classifyLocomotion thresholds exactly.
	t.check_eq(
		CharacterController.classify_action(0.0), "idle",
		"stationary speed classifies as idle")
	t.check_eq(
		CharacterController.classify_action(CharacterController.LOCOMOTION_IDLE_MAX_SPEED - 0.01),
		"idle", "just under the idle cutoff still classifies as idle")

	t.check_eq(
		CharacterController.classify_action(CharacterController.LOCOMOTION_IDLE_MAX_SPEED + 0.01),
		"walk", "just over the idle cutoff classifies as walk")
	t.check_eq(
		CharacterController.classify_action(CharacterController.MOVE_SPEED), "walk",
		"the controller's own MOVE_SPEED (5.0) classifies as walk")
	t.check_eq(
		CharacterController.classify_action(CharacterController.LOCOMOTION_RUN_MIN_SPEED - 0.01),
		"walk", "just under the run boundary still classifies as walk")

	t.check_eq(
		CharacterController.classify_action(CharacterController.LOCOMOTION_RUN_MIN_SPEED), "run",
		"exactly at the run boundary classifies as run")
	t.check_eq(
		CharacterController.classify_action(CharacterController.RUN_SPEED), "run",
		"the controller's own RUN_SPEED (12.0) classifies as run")

	# Sanity: the controller's own RUN_SPEED must actually exceed MOVE_SPEED,
	# or a Shift-held player would move at the same speed as an idle-handed
	# walker and could never be classified/seen as running at all (the
	# pre-this-unit gap this whole change closes).
	t.check(
		CharacterController.RUN_SPEED > CharacterController.MOVE_SPEED,
		"RUN_SPEED must exceed MOVE_SPEED for a run mechanic to exist at all")
