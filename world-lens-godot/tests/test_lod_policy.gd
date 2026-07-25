class_name TestLodPolicy
extends RefCounted
## Pure-logic tests for world/lod_policy.gd.
##
## ENGINE-EXECUTED (2026-07-25). The prior "`gdparse` only confirms valid
## syntax" caveat is superseded: a real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 23 checks
## are asserted on every run.
##
## Verified: the pure distance→band decisions (`band_for_distance`,
## `visibility_range_for_band`, `band_name`) and their parity with the
## Three.js client's STANDARD_LOD_BANDS constants. NOT verified: whether
## those band distances actually look right in motion — detail pop-in is
## precisely the kind of claim a headless run cannot make, since
## RasterizerDummy draws nothing. `apply_to_instance`'s real
## GeometryInstance3D.visibility_range wiring is likewise unexercised here.
## Both stay queued in world-lens-godot/VISUAL_QA.md.

const LodPolicy := preload("res://world/lod_policy.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()

	t.check_eq(LodPolicy.band_for_distance(0.0), LodPolicy.Band.HIGH, "distance 0 is HIGH")
	t.check_eq(
		LodPolicy.band_for_distance(49.9), LodPolicy.Band.HIGH,
		"just under highMax stays HIGH")
	t.check_eq(
		LodPolicy.band_for_distance(50.0), LodPolicy.Band.MEDIUM,
		"highMax boundary rolls to MEDIUM")
	t.check_eq(
		LodPolicy.band_for_distance(199.9), LodPolicy.Band.MEDIUM,
		"just under mediumMax stays MEDIUM")
	t.check_eq(
		LodPolicy.band_for_distance(200.0), LodPolicy.Band.LOW,
		"mediumMax boundary rolls to LOW")
	t.check_eq(
		LodPolicy.band_for_distance(499.9), LodPolicy.Band.LOW,
		"just under lowMax stays LOW")
	t.check_eq(
		LodPolicy.band_for_distance(500.0), LodPolicy.Band.BILLBOARD,
		"lowMax boundary rolls to BILLBOARD")
	t.check_eq(
		LodPolicy.band_for_distance(599.9), LodPolicy.Band.BILLBOARD,
		"just under cullAt stays BILLBOARD")
	t.check_eq(
		LodPolicy.band_for_distance(600.0), LodPolicy.Band.CULLED,
		"cullAt boundary is CULLED")
	t.check_eq(
		LodPolicy.band_for_distance(-5.0), LodPolicy.Band.HIGH,
		"negative distance clamps to 0 (HIGH), never crashes")

	var high_range := LodPolicy.visibility_range_for_band(LodPolicy.Band.HIGH)
	t.check_eq(high_range["begin"], 0.0, "HIGH begins at 0")
	t.check_eq(high_range["end"], 50.0, "HIGH ends at highMax")

	var medium_range := LodPolicy.visibility_range_for_band(LodPolicy.Band.MEDIUM)
	t.check_eq(
		medium_range["begin"], 50.0,
		"MEDIUM begins exactly where HIGH ends (no gap)")
	t.check_eq(medium_range["end"], 200.0, "MEDIUM ends at mediumMax")

	var low_range := LodPolicy.visibility_range_for_band(LodPolicy.Band.LOW)
	t.check_eq(
		low_range["begin"], 200.0,
		"LOW begins exactly where MEDIUM ends (no gap)")
	t.check_eq(low_range["end"], 500.0, "LOW ends at lowMax")

	var billboard_range := LodPolicy.visibility_range_for_band(LodPolicy.Band.BILLBOARD)
	t.check_eq(
		billboard_range["begin"], 500.0,
		"BILLBOARD begins exactly where LOW ends (no gap)")
	t.check_eq(billboard_range["end"], 600.0, "BILLBOARD ends at cullAt")

	t.check_eq(LodPolicy.band_name(LodPolicy.Band.HIGH), "high", "band_name(HIGH) == 'high'")
	t.check_eq(
		LodPolicy.band_name(LodPolicy.Band.MEDIUM), "medium",
		"band_name(MEDIUM) == 'medium'")
	t.check_eq(LodPolicy.band_name(LodPolicy.Band.LOW), "low", "band_name(LOW) == 'low'")
	t.check_eq(
		LodPolicy.band_name(LodPolicy.Band.BILLBOARD), "billboard",
		"band_name(BILLBOARD) == 'billboard'")
	t.check_eq(
		LodPolicy.band_name(LodPolicy.Band.CULLED), "culled",
		"band_name(CULLED) == 'culled'")

	return t
