class_name TestGaitSolver
extends RefCounted
## Pure-logic tests for avatar/gait_solver.gd AND avatar/two_bone_ik.gd.
## ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md. These call
## static functions directly; no scene tree or live rig node is needed, same
## pattern as tests/test_animation_state_machine.gd.

const GaitSolver := preload("res://avatar/gait_solver.gd")
const TwoBoneIK := preload("res://avatar/two_bone_ik.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_gait_phase_cycles_and_wraps(t)
	_test_stride_length_increases_with_speed(t)
	_test_foot_targets_alternate_out_of_phase(t)
	_test_two_bone_ik_reaches_reachable_target(t)
	_test_two_bone_ik_clamps_unreachable_far_target(t)
	_test_two_bone_ik_clamps_unreachable_close_target(t)
	return t


static func _test_gait_phase_cycles_and_wraps(t: TestUtils) -> void:
	t.check_almost(GaitSolver.gait_phase(0.0, 5.0), 0.0, "zero distance is phase 0")

	var half_stride: float = GaitSolver.PHASE_STRIDE_LEN_M * 0.5
	t.check_almost(
		GaitSolver.gait_phase(half_stride, 5.0), 0.5,
		"half PHASE_STRIDE_LEN_M of travel is half a cycle")

	t.check_almost(
		GaitSolver.gait_phase(GaitSolver.PHASE_STRIDE_LEN_M, 5.0), 0.0,
		"exactly one PHASE_STRIDE_LEN_M of travel wraps back to phase 0")

	# 2.25 cycles of travel should read as phase 0.25, regardless of speed —
	# mirrors advanceGaitPhase's own "no skating regardless of speed change"
	# invariant (gait-synthesis.ts:77-79): the phase-advance divisor never
	# reads the speed argument.
	var distance: float = GaitSolver.PHASE_STRIDE_LEN_M * 2.25
	t.check_almost(
		GaitSolver.gait_phase(distance, 1.0), 0.25,
		"phase wraps correctly past multiple full cycles at slow speed")
	t.check_almost(
		GaitSolver.gait_phase(distance, 11.0), 0.25,
		"phase at the same distance is identical regardless of speed")


static func _test_stride_length_increases_with_speed(t: TestUtils) -> void:
	var at_rest: float = GaitSolver.stride_length_for_speed(0.0)
	var at_half: float = GaitSolver.stride_length_for_speed(6.0)
	var at_max: float = GaitSolver.stride_length_for_speed(12.0)
	var past_max: float = GaitSolver.stride_length_for_speed(20.0)

	# gait-synthesis.ts:107 "0.4 + speedNorm * 0.6" applied to
	# PHASE_STRIDE_LEN_M (0.75m) — sampled exactly at speedNorm = 0, 0.5, 1.0.
	t.check_almost(at_rest, 0.75 * 0.4, "stride length at speed 0 is the 0.4 floor")
	t.check_almost(at_half, 0.75 * 0.7, "stride length at half SPEED_NORM_MAX")
	t.check_almost(at_max, 0.75 * 1.0, "stride length at SPEED_NORM_MAX is the full 0.75m")
	t.check_almost(
		past_max, at_max, "speed past SPEED_NORM_MAX clamps, same as speedNorm's own clamp")

	t.check(at_half > at_rest, "stride length strictly increases from rest to half speed")
	t.check(at_max > at_half, "stride length strictly increases from half to max speed")


static func _test_foot_targets_alternate_out_of_phase(t: TestUtils) -> void:
	var stride_len: float = GaitSolver.stride_length_for_speed(5.0)

	# gait-synthesis.ts:112 legPhaseR = legPhaseL + PI — the right foot at
	# phase P must equal the left foot at phase P + 0.5 (half a cycle later),
	# and vice versa.
	for p in [0.0, 0.1, 0.25, 0.6, 0.9]:
		var here: Dictionary = GaitSolver.foot_targets(p, 5.0, stride_len)
		var half_cycle_later: Dictionary = GaitSolver.foot_targets(
			fposmod(p + 0.5, 1.0), 5.0, stride_len)
		_check_vec_almost(
			t, here["right"], half_cycle_later["left"],
			"right foot at phase %s matches left foot half a cycle later" % p)
		_check_vec_almost(
			t, here["left"], half_cycle_later["right"],
			"left foot at phase %s matches right foot half a cycle later" % p)

	# At phase 0.25 the left leg is at its forward-swing peak
	# (sin(0.25*2*PI) == 1) while the right leg (PI out of phase) is at its
	# rearward peak (sin == -1) — the two feet are exact mirror-opposites,
	# never both forward at once.
	var quarter: Dictionary = GaitSolver.foot_targets(0.25, 5.0, stride_len)
	t.check(quarter["left"].z > 0.0, "left foot is forward at its phase-0.25 swing peak")
	t.check(quarter["right"].z < 0.0, "right foot is rearward while left is at its swing peak")

	# x is always 0 — foot_targets never claims lateral placement, that is
	# the rig's per-leg hip-socket anchor's job, not this solver's.
	var any_phase: Dictionary = GaitSolver.foot_targets(0.37, 8.0, stride_len)
	t.check_almost(any_phase["left"].x, 0.0, "foot_targets never sets a lateral (x) offset")
	t.check_almost(any_phase["right"].x, 0.0, "foot_targets never sets a lateral (x) offset")


static func _test_two_bone_ik_reaches_reachable_target(t: TestUtils) -> void:
	var root := Vector3(0.0, 0.9, 0.0)
	var upper_len: float = 0.40
	var lower_len: float = 0.38

	var targets: Array[Vector3] = [
		root + Vector3(0.0, -0.70, 0.0),
		root + Vector3(0.0, -0.50, 0.30),
		root + Vector3(0.0, -0.30, 0.05),
		root + Vector3(0.0, -0.60, -0.20),
	]

	for target in targets:
		var solved: Dictionary = TwoBoneIK.solve_two_bone(root, upper_len, lower_len, target)
		t.check(solved["reachable"], "target within [upper-lower, upper+lower] is reachable")
		t.check(solved["knee_angle"] >= 0.0, "knee_angle is never negative")

		var fk: Dictionary = TwoBoneIK.effector_position(
			root, upper_len, lower_len, solved["hip_angle"], solved["knee_angle"])
		_check_vec_almost(
			t, fk["foot"], target,
			"solve_two_bone + effector_position round-trips to the original target",
			0.01)


static func _test_two_bone_ik_clamps_unreachable_far_target(t: TestUtils) -> void:
	var root := Vector3(0.0, 0.9, 0.0)
	var upper_len: float = 0.40
	var lower_len: float = 0.38
	var max_reach: float = upper_len + lower_len

	# Straight down, but far beyond max_reach.
	var far_target := root + Vector3(0.0, -1.50, 0.0)
	var solved: Dictionary = TwoBoneIK.solve_two_bone(root, upper_len, lower_len, far_target)

	t.check(not solved["reachable"], "a target beyond upper+lower is flagged unreachable")
	t.check(
		solved["clamped_distance"] < max_reach,
		"clamped distance stays strictly under the full-extension length (EPS margin)")
	t.check(
		solved["knee_angle"] < 0.1,
		"a fully-extended clamp leaves the knee nearly straight (small residual flex, EPS margin)")

	# Direction must be PRESERVED — the classic IK "stretch straight toward
	# it" edge case (mirrors fabrik-ik.ts:81-89's own unreachable-target
	# behaviour): the solved foot should land along the same ray from root
	# toward far_target, just short of it.
	var fk: Dictionary = TwoBoneIK.effector_position(
		root, upper_len, lower_len, solved["hip_angle"], solved["knee_angle"])
	var expected_direction: Vector3 = (far_target - root).normalized()
	var actual_direction: Vector3 = (fk["foot"] - root).normalized()
	_check_vec_almost(
		t, actual_direction, expected_direction,
		"unreachable-far clamp preserves the original direction to the target", 0.01)


static func _test_two_bone_ik_clamps_unreachable_close_target(t: TestUtils) -> void:
	var root := Vector3(0.0, 0.9, 0.0)
	var upper_len: float = 0.40
	var lower_len: float = 0.38
	var min_reach: float = absf(upper_len - lower_len)

	# A target almost on top of the hip — closer than the chain can fold to.
	var close_target := root + Vector3(0.0, -0.005, 0.0)
	var solved: Dictionary = TwoBoneIK.solve_two_bone(root, upper_len, lower_len, close_target)

	t.check(not solved["reachable"], "a target closer than |upper-lower| is flagged unreachable")
	t.check(
		solved["clamped_distance"] > min_reach,
		"clamped distance stays strictly over the fully-folded length (EPS margin)")
	t.check(
		solved["knee_angle"] > PI * 0.9,
		"a fully-folded clamp bends the knee close to its maximum (near PI)")


## Vector3 tolerance-compare helper — TestUtils only has a float
## check_almost(); this wraps it per-axis with a shared label.
static func _check_vec_almost(
		t: TestUtils, actual: Vector3, expected: Vector3, label: String, eps: float = 0.001) -> void:
	t.check_almost(actual.x, expected.x, label + " (x)", eps)
	t.check_almost(actual.y, expected.y, label + " (y)", eps)
	t.check_almost(actual.z, expected.z, label + " (z)", eps)
