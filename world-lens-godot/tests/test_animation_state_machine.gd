class_name TestAnimationStateMachine
extends RefCounted
## Pure-logic tests for avatar/animation_state_machine.gd. ENGINE-GATED
## execution — see world-lens-godot/VISUAL_QA.md. These call `select_state`
## and its static helpers directly; no scene tree or live rig node is needed,
## same pattern as tests/test_character_controller.gd.

const AnimationStateMachine := preload("res://avatar/animation_state_machine.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_idle_at_zero_velocity(t)
	_test_walk_threshold(t)
	_test_run_threshold(t)
	_test_blend_ramps_between_bands(t)
	_test_jump_and_fall_from_vertical_velocity(t)
	_test_land_hold_window(t)
	_test_action_override_precedence(t)
	_test_velocity_vector_input(t)
	_test_never_fabricates_motion_on_first_sighting_shape(t)
	return t


static func _test_idle_at_zero_velocity(t: TestUtils) -> void:
	var result := AnimationStateMachine.select_state({"speed": 0.0, "is_airborne": false})
	t.check_eq(result["state"], "idle", "zero speed selects idle")
	t.check_almost(result["blend"]["idle"], 1.0, "idle blend weight is 1.0 at rest")
	t.check(not result["is_override"], "plain locomotion is never flagged as an override")

	var below_cutoff := AnimationStateMachine.select_state({
		"speed": AnimationStateMachine.IDLE_MAX_SPEED - 0.01, "is_airborne": false,
	})
	t.check_eq(below_cutoff["state"], "idle", "speed just under IDLE_MAX_SPEED is still idle")


static func _test_walk_threshold(t: TestUtils) -> void:
	# Mirrors character_controller.gd:194's own idle/walk cutoff (0.05 m/s).
	var at_cutoff := AnimationStateMachine.select_state({
		"speed": AnimationStateMachine.IDLE_MAX_SPEED + 0.001, "is_airborne": false,
	})
	t.check_eq(at_cutoff["state"], "walk", "just above IDLE_MAX_SPEED selects walk")

	# AvatarSystem3D.tsx:190 MOVE_SPEED = 5.0 m/s — comfortably inside the
	# walk band (below RUN_MIN_SPEED's midpoint boundary of 8.5).
	var at_move_speed := AnimationStateMachine.select_state({"speed": 5.0, "is_airborne": false})
	t.check_eq(at_move_speed["state"], "walk", "the client's own MOVE_SPEED (5.0) selects walk")


static func _test_run_threshold(t: TestUtils) -> void:
	var below := AnimationStateMachine.select_state({
		"speed": AnimationStateMachine.RUN_MIN_SPEED - 0.01, "is_airborne": false,
	})
	t.check_eq(below["state"], "walk", "just under RUN_MIN_SPEED is still walk")

	var above := AnimationStateMachine.select_state({
		"speed": AnimationStateMachine.RUN_MIN_SPEED + 0.01, "is_airborne": false,
	})
	t.check_eq(above["state"], "run", "just over RUN_MIN_SPEED selects run")

	# AvatarSystem3D.tsx:191 RUN_SPEED = 12.0 m/s — the Three.js client's own
	# sprint speed must land solidly in the run band.
	var at_run_speed := AnimationStateMachine.select_state({"speed": 12.0, "is_airborne": false})
	t.check_eq(at_run_speed["state"], "run", "the Three.js client's own RUN_SPEED (12.0) selects run")


static func _test_blend_ramps_between_bands(t: TestUtils) -> void:
	var mid_walk := AnimationStateMachine.select_state({"speed": 1.0, "is_airborne": false})
	var blend: Dictionary = mid_walk["blend"]
	t.check(blend["idle"] > 0.0 and blend["idle"] < 1.0, "idle/walk band: idle weight is partial")
	t.check(blend["walk"] > 0.0 and blend["walk"] < 1.0, "idle/walk band: walk weight is partial")
	t.check_almost(blend["idle"] + blend["walk"], 1.0, "idle+walk weights sum to 1 in the crossfade")

	var run_band_start: float = AnimationStateMachine.RUN_MIN_SPEED - AnimationStateMachine.BLEND_BAND
	var mid_run_band := AnimationStateMachine.select_state({
		"speed": run_band_start + AnimationStateMachine.BLEND_BAND * 0.5, "is_airborne": false,
	})
	var run_blend: Dictionary = mid_run_band["blend"]
	t.check(run_blend["walk"] > 0.0 and run_blend["run"] > 0.0, "walk/run band: both weights nonzero")
	t.check_almost(run_blend["walk"] + run_blend["run"], 1.0, "walk+run weights sum to 1 in crossfade")


static func _test_jump_and_fall_from_vertical_velocity(t: TestUtils) -> void:
	var ascending := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": true, "vertical_velocity": 6.0,
	})
	t.check_eq(ascending["state"], "jump", "positive vertical velocity while airborne selects jump")
	t.check_almost(ascending["blend"]["jump"], 1.0, "jump blend weight is 1.0")

	var descending := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": true, "vertical_velocity": -4.0,
	})
	t.check_eq(descending["state"], "fall", "negative vertical velocity while airborne selects fall")

	var apex := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": true, "vertical_velocity": 0.0,
	})
	t.check_eq(apex["state"], "fall", "zero vertical velocity at the apex reads as fall, not jump")

	var moving_while_airborne := AnimationStateMachine.select_state({
		"speed": 12.0, "is_airborne": true, "vertical_velocity": 3.0,
	})
	t.check_eq(moving_while_airborne["state"], "jump", "airborne wins over locomotion speed")


static func _test_land_hold_window(t: TestUtils) -> void:
	var just_landed := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": false, "ms_since_grounded": 0,
	})
	t.check_eq(just_landed["state"], "land", "0ms since grounding selects the transient land state")

	var mid_hold := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": false,
		"ms_since_grounded": AnimationStateMachine.LAND_HOLD_MS - 1,
	})
	t.check_eq(mid_hold["state"], "land", "still inside LAND_HOLD_MS selects land")

	var past_hold := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": false,
		"ms_since_grounded": AnimationStateMachine.LAND_HOLD_MS,
	})
	t.check_eq(past_hold["state"], "idle", "past LAND_HOLD_MS falls back to ordinary locomotion")

	var never_landed := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": false, "ms_since_grounded": -1,
	})
	t.check_eq(never_landed["state"], "idle", "ms_since_grounded omitted/negative never triggers land")


static func _test_action_override_precedence(t: TestUtils) -> void:
	var wave := AnimationStateMachine.select_state({
		"speed": 5.0, "is_airborne": false, "action": "wave",
	})
	t.check_eq(wave["state"], "wave", "a non-locomotion action string overrides locomotion entirely")
	t.check(wave["is_override"], "action override is flagged as such")
	t.check_almost(wave["blend"]["wave"], 1.0, "override blend weight is 1.0 on its own key")

	var airborne_with_override := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": true, "vertical_velocity": 5.0, "action": "craft",
	})
	t.check_eq(airborne_with_override["state"], "craft", "an override wins even while airborne")

	# The network's own literal "walk"/"idle" action strings (the ONLY
	# locomotion labels the Three.js client ever actually sends over the
	# wire — see the module header) must NOT be treated as overrides; they
	# fall through to real kinematic classification.
	var explicit_walk_action := AnimationStateMachine.select_state({
		"speed": 0.0, "is_airborne": false, "action": "walk",
	})
	t.check_eq(
		explicit_walk_action["state"], "idle",
		"a literal 'walk' action string is a locomotion label, not an override")
	t.check(
		not explicit_walk_action["is_override"], "'walk'/'idle' action strings are never overrides")


static func _test_velocity_vector_input(t: TestUtils) -> void:
	# Vector3(x, y, z): horizontal speed is the xz-plane length; vertical
	# velocity is y. 3-4-5 triangle on the xz-plane => horizontal speed 5.
	var result := AnimationStateMachine.select_state({
		"velocity": Vector3(3.0, 0.0, 4.0), "is_airborne": false,
	})
	t.check_eq(result["state"], "walk", "Vector3 velocity derives horizontal speed (3-4-5 => 5.0 m/s)")

	var vertical := AnimationStateMachine.select_state({
		"velocity": Vector3(0.0, -2.0, 0.0), "is_airborne": true,
	})
	t.check_eq(vertical["state"], "fall", "Vector3 velocity derives vertical velocity for jump/fall")


static func _test_never_fabricates_motion_on_first_sighting_shape(t: TestUtils) -> void:
	# This is really an avatar_manager.gd contract (infer_kinematics), but the
	# shape it feeds INTO select_state is asserted here for completeness: a
	# fresh entity with speed 0 / not airborne must read as idle, never a
	# fabricated jump/run.
	var fresh := AnimationStateMachine.select_state({"speed": 0.0, "is_airborne": false})
	t.check_eq(fresh["state"], "idle", "a motionless/fresh reading never fabricates jump or run")
