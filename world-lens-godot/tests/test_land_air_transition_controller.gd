class_name TestLandAirTransitionController
extends RefCounted
## Pure-logic tests for avatar/land_air_transition_controller.gd — C14
## (master-spec "land↔air transition: stations, pads, state changes").
## ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md.
##
## Covers, per the C14 unit brief: correct trigger detection for each
## transition type (jump-then-sustained-ascend, pad takeoff, mounted
## takeoff, landing by ground-contact, landing by pad), the mode-request
## payload shape, ack/nack state resolution (apply-on-ack /
## rollback-on-nack), and landing-pad-proximity gating.

const LandAirTransitionController := preload("res://avatar/land_air_transition_controller.gd")
const TestUtils := preload("res://tests/test_utils.gd")

## Real authored pads from content/world/concordia-hub/city-layout.json's
## `landingPads` array (see land_air_transition_controller.gd's own header
## for the citation chain) — used verbatim as test fixtures so the gating
## tests exercise the real shape, not an invented one.
const PLAZA_PAD := {
	"id": "landing-pad-plaza-north", "position": {"x": 0, "z": 280}, "radius_m": 14,
}
const RIVERSIDE_PAD := {
	"id": "landing-pad-riverside", "position": {"x": 0, "z": -300}, "radius_m": 14,
}
const ALL_PADS := [PLAZA_PAD, RIVERSIDE_PAD]


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_should_launch_flight_requires_all_conditions(t)
	_test_should_launch_from_pad_requires_all_conditions(t)
	_test_should_launch_mounted_requires_standstill_not_airborne(t)
	_test_should_land_on_ground_contact_while_descending(t)
	_test_should_land_near_pad_even_while_ascending(t)
	_test_is_within_landing_pad_gating(t)
	_test_nearest_landing_pad_picks_closest_and_handles_empty(t)
	_test_accumulate_ascend_ms_resets_on_interruption(t)
	_test_build_mode_request_payload_shape(t)
	_test_resolve_mode_transition_ack_and_nack(t)
	return t


static func _test_should_launch_flight_requires_all_conditions(t: TestUtils) -> void:
	# All conditions satisfied: airborne, still rising, ascend held long
	# enough, flight-capable.
	t.check(
		LandAirTransitionController.should_launch_flight(false, 3.0, true, 400.0, 350.0, true),
		"launches when airborne + rising + ascend held past threshold + flight-capable")

	t.check(
		not LandAirTransitionController.should_launch_flight(true, 3.0, true, 400.0, 350.0, true),
		"refuses while still grounded — must have actually left the ground")
	t.check(
		not LandAirTransitionController.should_launch_flight(false, -2.0, true, 400.0, 350.0, true),
		"refuses while falling (vertical_vel <= 0) — not mid-jump-ascent")
	t.check(
		not LandAirTransitionController.should_launch_flight(false, 3.0, false, 400.0, 350.0, true),
		"refuses when the ascend input isn't held")
	t.check(
		not LandAirTransitionController.should_launch_flight(false, 3.0, true, 100.0, 350.0, true),
		"refuses before the hold duration reaches the threshold")
	t.check(
		not LandAirTransitionController.should_launch_flight(false, 3.0, true, 400.0, 350.0, false),
		"refuses when the caller marks the player not flight-capable — honest external gate")


static func _test_should_launch_from_pad_requires_all_conditions(t: TestUtils) -> void:
	t.check(
		LandAirTransitionController.should_launch_from_pad(true, true, true, true),
		"launches from a pad when grounded + near a real pad + ascend held + flight-capable")
	t.check(
		not LandAirTransitionController.should_launch_from_pad(false, true, true, true),
		"refuses a pad takeoff while already airborne (nonsensical — already flying)")
	t.check(
		not LandAirTransitionController.should_launch_from_pad(true, false, true, true),
		"refuses when not actually within a pad's radius — no fly-anywhere shortcut")
	t.check(
		not LandAirTransitionController.should_launch_from_pad(true, true, false, true),
		"refuses without a deliberate ascend-hold — standing on a pad alone isn't a takeoff")


static func _test_should_launch_mounted_requires_standstill_not_airborne(t: TestUtils) -> void:
	# Distinct from should_launch_flight: mounts have no jump apex, so
	# liftoff is a standstill ascend-hold while genuinely grounded.
	t.check(
		LandAirTransitionController.should_launch_mounted(true, true, 400.0, 350.0, true),
		"a flight-capable mount lifts off from a standstill once the hold threshold is reached")
	t.check(
		not LandAirTransitionController.should_launch_mounted(false, true, 400.0, 350.0, true),
		"refuses when the mount is already airborne (nothing to launch into)")
	t.check(
		not LandAirTransitionController.should_launch_mounted(true, true, 400.0, 350.0, false),
		"refuses a non-flight-capable mount (e.g. warhorse) regardless of hold duration")
	t.check(
		not LandAirTransitionController.should_launch_mounted(true, true, 100.0, 350.0, true),
		"refuses before the hold duration reaches the threshold")


static func _test_should_land_on_ground_contact_while_descending(t: TestUtils) -> void:
	t.check(
		LandAirTransitionController.should_land(true, -1.0, false),
		"lands on real ground contact while descending")
	t.check(
		LandAirTransitionController.should_land(true, 0.0, false),
		"lands at exactly zero vertical velocity while grounded (boundary case)")
	t.check(
		not LandAirTransitionController.should_land(true, 2.0, false),
		"does not land while still ascending off a slope, even if is_on_floor() momentarily true")
	t.check(
		not LandAirTransitionController.should_land(false, -1.0, false),
		"does not land while genuinely airborne and no pad is near")


static func _test_should_land_near_pad_even_while_ascending(t: TestUtils) -> void:
	# A pad grants an intentional early landing — mirrors takeoff's own
	# intentionality (should_launch_from_pad).
	t.check(
		LandAirTransitionController.should_land(false, 5.0, true),
		"a pad allows landing even while airborne and still ascending — deliberate pad approach")


static func _test_is_within_landing_pad_gating(t: TestUtils) -> void:
	t.check(
		LandAirTransitionController.is_within_landing_pad(Vector3(0, 0, 280), PLAZA_PAD),
		"exactly at the pad's authored position counts as within radius")
	t.check(
		LandAirTransitionController.is_within_landing_pad(Vector3(10, 0, 280), PLAZA_PAD),
		"10m off-center is within the pad's real 14m radius")
	t.check(
		not LandAirTransitionController.is_within_landing_pad(Vector3(20, 0, 280), PLAZA_PAD),
		"20m off-center is outside the pad's real 14m radius")
	t.check(
		not LandAirTransitionController.is_within_landing_pad(Vector3(0, 0, 0), {}),
		"an empty/malformed pad dict is honestly treated as not-near, never crashes")
	t.check(
		not LandAirTransitionController.is_within_landing_pad(
			Vector3(0, 0, 0), {"position": {"x": 0, "z": 0}, "radius_m": 0}),
		"a non-positive radius is honestly treated as not-near")


static func _test_nearest_landing_pad_picks_closest_and_handles_empty(t: TestUtils) -> void:
	var near_riverside := Vector3(0, 0, -290)
	var nearest := LandAirTransitionController.nearest_landing_pad(near_riverside, ALL_PADS)
	t.check_eq(
		nearest.get("id", ""), "landing-pad-riverside",
		"picks the geometrically closer of two real pads")

	var near_plaza := Vector3(5, 0, 275)
	var nearest2 := LandAirTransitionController.nearest_landing_pad(near_plaza, ALL_PADS)
	t.check_eq(
		nearest2.get("id", ""), "landing-pad-plaza-north",
		"picks the other pad when closer to it instead")

	t.check(
		LandAirTransitionController.nearest_landing_pad(Vector3.ZERO, []).is_empty(),
		"an empty pads array yields an empty dict, never a fabricated pad")
	t.check(
		LandAirTransitionController.nearest_landing_pad(Vector3.ZERO, [{"id": "malformed"}]).is_empty(),
		"a malformed pad entry (no position) is skipped, not crashed on")


static func _test_accumulate_ascend_ms_resets_on_interruption(t: TestUtils) -> void:
	var ms := LandAirTransitionController.accumulate_ascend_ms(0.0, 16.0, true)
	t.check_almost(ms, 16.0, "accumulates real elapsed time while the hold condition is true")

	ms = LandAirTransitionController.accumulate_ascend_ms(ms, 16.0, true)
	t.check_almost(ms, 32.0, "keeps accumulating across consecutive true frames")

	ms = LandAirTransitionController.accumulate_ascend_ms(ms, 16.0, false)
	t.check_almost(
		ms, 0.0, "resets to zero the instant the hold condition breaks (grounded/released/falling)")


static func _test_build_mode_request_payload_shape(t: TestUtils) -> void:
	var fly_payload := LandAirTransitionController.build_mode_request_payload("fly")
	t.check_eq(
		fly_payload, {"mode": "fly"},
		"fly request payload matches applyPlayerMode's expected {mode: 'fly'} shape (server.js:8992)")

	var walk_payload := LandAirTransitionController.build_mode_request_payload("walk")
	t.check_eq(
		walk_payload, {"mode": "walk"},
		"walk (landing) request payload matches applyPlayerMode's {mode: 'walk'} shape (server.js:8987)")


static func _test_resolve_mode_transition_ack_and_nack(t: TestUtils) -> void:
	# Ack confirms the optimistically-applied airborne transition — stays AIRBORNE.
	var acked := LandAirTransitionController.resolve_mode_transition(
		true, true, LandAirTransitionController.Mode.GROUND)
	t.check_eq(
		acked, LandAirTransitionController.Mode.AIRBORNE,
		"ack on a fly request confirms the optimistic AIRBORNE apply — quiet settle, no change")

	# Nack on the same request rolls back to whatever mode preceded it.
	var nacked := LandAirTransitionController.resolve_mode_transition(
		true, false, LandAirTransitionController.Mode.GROUND)
	t.check_eq(
		nacked, LandAirTransitionController.Mode.GROUND,
		"nack on a fly request rolls back to the real previous mode — visible, honest revert")

	# Symmetric case: a landing (walk) request nacked rolls back to AIRBORNE.
	var land_nacked := LandAirTransitionController.resolve_mode_transition(
		false, false, LandAirTransitionController.Mode.AIRBORNE)
	t.check_eq(
		land_nacked, LandAirTransitionController.Mode.AIRBORNE,
		"nack on a landing request rolls back to AIRBORNE — never pretends a rejected landing happened")

	var land_acked := LandAirTransitionController.resolve_mode_transition(
		false, true, LandAirTransitionController.Mode.AIRBORNE)
	t.check_eq(
		land_acked, LandAirTransitionController.Mode.GROUND,
		"ack on a landing request confirms the optimistic GROUND apply")
