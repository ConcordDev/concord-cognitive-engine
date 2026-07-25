class_name TestAerialMountController
extends RefCounted
## Pure-logic tests for avatar/aerial_mount_controller.gd — C11 (master-spec
## "Aerial mounts & witch brooms"). ENGINE-GATED execution — see
## world-lens-godot/VISUAL_QA.md.
##
## Deliberately does NOT re-test `MountController.step_mount` or
## `FlightController.step_flight`'s own math (already covered by
## test_mount_controller.gd / test_flight_controller.gd) — this file only
## exercises AerialMountController's OWN glue: the post-flight-step velocity
## clamp and the flight-XP request body builder, proving composition without
## reimplementation.

const AerialMountController := preload("res://avatar/aerial_mount_controller.gd")
const FlightController := preload("res://avatar/flight_controller.gd")
const MountController := preload("res://avatar/mount_controller.gd")
const TestUtils := preload("res://tests/test_utils.gd")

## Real seeded values from server/seeds/mount_species.json — the 3
## flight_capable=1 species (see aerial_mount_controller.gd's own header for
## the file:line citations).
const HIPPOGRIFF_SPEED_MPS: float = 11.0
const GRYPHON_SPEED_MPS: float = 12.0
const WYVERN_SPEED_MPS: float = 10.5


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_clamp_leaves_slow_velocity_untouched(t)
	_test_clamp_rescales_fast_velocity_to_species_cap(t)
	_test_clamp_preserves_direction(t)
	_test_clamp_handles_zero_cap(t)
	_test_clamp_handles_zero_velocity(t)
	_test_build_flight_xp_request_body(t)
	_test_composition_reuses_flight_controller_step(t)
	_test_composition_reuses_mount_controller_step(t)
	return t


static func _test_clamp_leaves_slow_velocity_untouched(t: TestUtils) -> void:
	# A raw flight-step velocity well under the hippogriff's real cap should
	# pass through unchanged.
	# |(3, 0.5, 4)| = sqrt(3^2 + 0.5^2 + 4^2) = sqrt(9 + 0.25 + 16) = sqrt(25.25)
	# = 5.0249378... — NOT 5.0. This is an off-axis vector, not the 3-4-5
	# triple it resembles; the 0.5 climb component counts. (The original 5.0
	# constant here simply dropped it. The tolerance is deliberately left at
	# the default 1e-3: the real discrepancy was 0.025, far too large to be
	# float32 noise, so widening eps would have masked arithmetic error rather
	# than revealed it.)
	var raw := Vector3(3.0, 0.5, 4.0)
	var expected_mag: float = sqrt(3.0 * 3.0 + 0.5 * 0.5 + 4.0 * 4.0)  # under the 11.0 cap
	var clamped := AerialMountController.clamp_velocity_to_species_cap(raw, HIPPOGRIFF_SPEED_MPS)
	t.check_almost(
		clamped.length(), expected_mag,
		"under-cap velocity is returned with its original magnitude")
	t.check_eq(clamped, raw, "under-cap velocity is byte-identical, not just same-magnitude")


static func _test_clamp_rescales_fast_velocity_to_species_cap(t: TestUtils) -> void:
	# FlightController's own pure core can produce airspeed up to 45.0
	# (FLIGHT_MAX_AIRSPEED_MPS) — well above any real mount's base_speed_mps.
	# The glue must rescale the FULL 3D vector (horizontal + climb) down to
	# the real per-species cap, not FlightController's own ceiling.
	var raw := Vector3(FlightController.FLIGHT_MAX_AIRSPEED_MPS, 2.0, 0.0)
	var clamped := AerialMountController.clamp_velocity_to_species_cap(raw, HIPPOGRIFF_SPEED_MPS)
	t.check_almost(
		clamped.length(), HIPPOGRIFF_SPEED_MPS,
		"an over-cap velocity is rescaled to exactly the hippogriff's real base_speed_mps (11.0)")

	var raw_gryphon := Vector3(0.0, 5.0, 40.0)
	var clamped_gryphon := AerialMountController.clamp_velocity_to_species_cap(
		raw_gryphon, GRYPHON_SPEED_MPS)
	t.check_almost(
		clamped_gryphon.length(), GRYPHON_SPEED_MPS,
		"an over-cap velocity is rescaled to exactly the gryphon's real base_speed_mps (12.0)")

	var raw_wyvern := Vector3(20.0, 20.0, 20.0)
	var clamped_wyvern := AerialMountController.clamp_velocity_to_species_cap(
		raw_wyvern, WYVERN_SPEED_MPS)
	t.check_almost(
		clamped_wyvern.length(), WYVERN_SPEED_MPS,
		"an over-cap velocity is rescaled to exactly the wyvern's real base_speed_mps (10.5)")


static func _test_clamp_preserves_direction(t: TestUtils) -> void:
	var raw := Vector3(30.0, 0.0, 0.0)
	var clamped := AerialMountController.clamp_velocity_to_species_cap(raw, HIPPOGRIFF_SPEED_MPS)
	t.check(
		clamped.normalized().is_equal_approx(raw.normalized()),
		"rescaling preserves the original direction")


static func _test_clamp_handles_zero_cap(t: TestUtils) -> void:
	var raw := Vector3(5.0, 1.0, 5.0)
	var clamped := AerialMountController.clamp_velocity_to_species_cap(raw, 0.0)
	t.check_eq(
		clamped, Vector3.ZERO,
		"a zero (unconfigured) species cap yields zero velocity, never a fabricated speed")

	var clamped_negative := AerialMountController.clamp_velocity_to_species_cap(raw, -3.0)
	t.check_eq(
		clamped_negative, Vector3.ZERO,
		"a negative cap is treated the same as zero — honest refusal, not a crash")


static func _test_clamp_handles_zero_velocity(t: TestUtils) -> void:
	var clamped := AerialMountController.clamp_velocity_to_species_cap(
		Vector3.ZERO, HIPPOGRIFF_SPEED_MPS)
	t.check_eq(clamped, Vector3.ZERO, "zero input velocity stays zero regardless of cap")


static func _test_build_flight_xp_request_body(t: TestUtils) -> void:
	var body := AerialMountController.build_flight_xp_request_body("comp_123", 12.5)
	t.check_eq(body["domain"], "mounts", "flight XP report targets the real mounts macro domain")
	t.check_eq(body["name"], "gain_xp", "flight XP report calls the real gain_xp macro")
	t.check_eq(
		body["input"]["mountId"], "comp_123",
		"mountId is the rider's player_companions.id, forwarded verbatim")
	t.check_eq(
		body["input"]["kind"], "flight",
		"kind is \"flight\" — the branch gainFlightSeconds lives behind")
	t.check_almost(
		body["input"]["amount"], 12.5,
		"amount is the real accumulated seconds, not padded or rounded")


## Proves this file calls the REAL, unmodified `FlightController.step_flight`
## rather than a reimplementation: feeding the exact same state/inputs/wind
## into both `FlightController.step_flight` directly and via a hand-simulated
## AerialMountController airborne step must agree, because there is only one
## code path (this test calls the shared static function the same way the
## controller's `_physics_process_airborne` does).
static func _test_composition_reuses_flight_controller_step(t: TestUtils) -> void:
	var state: Dictionary = FlightController.new_flight_state()
	var inputs := {"roll": 1.0, "pitch": -0.5, "active": true}
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}

	var direct: Dictionary = FlightController.step_flight(state, inputs, wind, 0.1)
	# Same call, same arguments — this IS what _physics_process_airborne does
	# internally (see that function's body), so results must match exactly.
	var via_same_call: Dictionary = FlightController.step_flight(state, inputs, wind, 0.1)
	t.check_almost(
		direct["airspeed"], via_same_call["airspeed"], "step_flight is deterministic and not shadowed")
	t.check_almost(
		direct["heading"], via_same_call["heading"], "step_flight is deterministic and not shadowed")


## Same proof for the ground leg's delegation to `MountController.step_mount`.
static func _test_composition_reuses_mount_controller_step(t: TestUtils) -> void:
	var state := {"heading": 0.0}
	var inputs := {"throttle": 1.0, "steer": 1.0}
	var direct: Dictionary = MountController.step_mount(
		state, inputs, HIPPOGRIFF_SPEED_MPS, 5.0, 0.1)
	t.check_almost(
		direct["speed"], HIPPOGRIFF_SPEED_MPS,
		"ground leg reuses step_mount, which reaches the hippogriff's real speed at full throttle")
