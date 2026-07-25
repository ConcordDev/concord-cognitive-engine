class_name TestDistrictStreamingPolicy
extends RefCounted
## Pure-logic tests for world/district_streaming_policy.gd — F25 (district
## streaming policy: dense enterable city tuning).
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 18 checks
## are asserted on every run.
##
## Verified: `density_per_m2`, the point-in-polygon test, `district_at` and
## `radius_for_district`/`radius_for_position` — run against the real
## authored concordia-hub district rects, so the classification of each real
## district as dense or sparse is genuinely computed, not asserted on paper.
##
## NOT verified, and worth separating from the visual gap the rest of this
## directory carries: correctness of the CODE is not correctness of the
## DIAL. DENSITY_HIGH_THRESHOLD_PER_M2 sits in a real gap in the real data,
## but whether that cut produces good streaming behaviour is a play-and-perf
## question — district_streaming_policy.gd's own header flags it as a
## first-draft constant queued for a balance pass, and that stands. Whether
## the resulting radii avoid visible pop-in additionally needs a display;
## headless installs RasterizerDummy and draws nothing. Queued in
## world-lens-godot/VISUAL_QA.md.

const DistrictStreamingPolicy := preload("res://world/district_streaming_policy.gd")
const TestUtils := preload("res://tests/test_utils.gd")

## Real authored concordia-hub district rects (districts.js#DEFAULT_
## DISTRICTS), used verbatim as test fixtures so the geometry tests exercise
## the real shape, not an invented one.
const PLAZA_BOUNDARY := [
	{"x": -70.0, "z": -70.0}, {"x": 70.0, "z": -70.0},
	{"x": 70.0, "z": 70.0}, {"x": -70.0, "z": 70.0},
]
const MARKET_BOUNDARY := [
	{"x": 90.0, "z": -70.0}, {"x": 250.0, "z": -70.0},
	{"x": 250.0, "z": 70.0}, {"x": 90.0, "z": 70.0},
]

## Real computed density values from the actual authored city-layout.json
## (see district_streaming_policy.gd's own header for the derivation) —
## used verbatim, not invented numbers.
const INDUSTRIAL_DISTRICT := {
	"id": "concordia-hub:industrial", "buildingCount": 16, "areaM2": 25600.0,
}
const RIVERSIDE_DISTRICT := {
	"id": "concordia-hub:riverside", "buildingCount": 5, "areaM2": 22400.0,
}


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_density_per_m2(t)
	_test_density_honest_zero_on_missing_fields(t)
	_test_radius_for_district_thresholding(t)
	_test_radius_for_district_honest_default_on_empty(t)
	_test_point_in_polygon_matches_server_semantics(t)
	_test_district_at_resolves_and_falls_through(t)
	_test_radius_for_position_end_to_end(t)
	return t


static func _test_density_per_m2(t: TestUtils) -> void:
	# 16 buildings / 25600 m^2 = 0.000625 /m^2 (real industrial district).
	t.check_almost(
		DistrictStreamingPolicy.density_per_m2(INDUSTRIAL_DISTRICT), 0.000625,
		"industrial density matches the real authored buildingCount/areaM2", 0.000001)
	# 5 / 22400 = 0.0002232... (real riverside district — the sparsest).
	t.check_almost(
		DistrictStreamingPolicy.density_per_m2(RIVERSIDE_DISTRICT), 0.00022321,
		"riverside density matches the real authored buildingCount/areaM2", 0.000001)


static func _test_density_honest_zero_on_missing_fields(t: TestUtils) -> void:
	t.check_eq(
		DistrictStreamingPolicy.density_per_m2({}), 0.0,
		"a district with no buildingCount/areaM2 is honestly 0.0, never guessed")
	t.check_eq(
		DistrictStreamingPolicy.density_per_m2({"buildingCount": 5}), 0.0,
		"missing areaM2 alone is still honest 0.0")
	t.check_eq(
		DistrictStreamingPolicy.density_per_m2({"buildingCount": 5, "areaM2": 0}), 0.0,
		"a zero area never divides-by-zero into garbage")


static func _test_radius_for_district_thresholding(t: TestUtils) -> void:
	t.check_eq(
		DistrictStreamingPolicy.radius_for_district(INDUSTRIAL_DISTRICT),
		DistrictStreamingPolicy.DENSE_RADIUS,
		"the real densest authored district (industrial) gets the wider radius")
	t.check_eq(
		DistrictStreamingPolicy.radius_for_district(RIVERSIDE_DISTRICT),
		DistrictStreamingPolicy.BASE_RADIUS,
		"the real sparsest authored district (riverside) keeps the base radius")


static func _test_radius_for_district_honest_default_on_empty(t: TestUtils) -> void:
	t.check_eq(
		DistrictStreamingPolicy.radius_for_district({}), DistrictStreamingPolicy.BASE_RADIUS,
		"an unknown/empty district gets the honest default, never a fabricated boost")


static func _test_point_in_polygon_matches_server_semantics(t: TestUtils) -> void:
	# Mirrors server/tests/districts.test.js's own pointInPolygon assertions
	# so both implementations agree on the same real square.
	var square := [
		{"x": 0.0, "z": 0.0}, {"x": 10.0, "z": 0.0},
		{"x": 10.0, "z": 10.0}, {"x": 0.0, "z": 10.0},
	]
	t.check(
		DistrictStreamingPolicy.point_in_polygon(5.0, 5.0, square),
		"a clearly-inside point resolves inside")
	t.check(
		not DistrictStreamingPolicy.point_in_polygon(50.0, 50.0, square),
		"a clearly-outside point resolves outside")
	t.check(
		DistrictStreamingPolicy.point_in_polygon(0.0, 5.0, square),
		"an on-edge point counts as inside")
	t.check(
		DistrictStreamingPolicy.point_in_polygon(0.0, 0.0, square),
		"a vertex counts as inside")
	t.check(
		not DistrictStreamingPolicy.point_in_polygon(1.0, 1.0, []),
		"a malformed polygon (<3 vertices) is honestly outside")


static func _test_district_at_resolves_and_falls_through(t: TestUtils) -> void:
	var districts := [
		{"id": "concordia-hub:plaza", "boundary": PLAZA_BOUNDARY},
		{"id": "concordia-hub:market", "boundary": MARKET_BOUNDARY},
	]
	var hit := DistrictStreamingPolicy.district_at(Vector3(0.0, 0.0, 0.0), districts)
	t.check_eq(
		hit.get("id", ""), "concordia-hub:plaza",
		"the plaza centroid resolves to the plaza district")

	var hit2 := DistrictStreamingPolicy.district_at(Vector3(170.0, 0.0, 0.0), districts)
	t.check_eq(
		hit2.get("id", ""), "concordia-hub:market",
		"the market centroid resolves to the market district")

	var miss := DistrictStreamingPolicy.district_at(Vector3(10000.0, 0.0, 10000.0), districts)
	t.check(miss.is_empty(), "a point outside every district resolves to {} — never guessed")


static func _test_radius_for_position_end_to_end(t: TestUtils) -> void:
	var industrial_with_boundary := INDUSTRIAL_DISTRICT.duplicate(true)
	industrial_with_boundary["boundary"] = [
		{"x": 90.0, "z": -250.0}, {"x": 250.0, "z": -250.0},
		{"x": 250.0, "z": -90.0}, {"x": 90.0, "z": -90.0},
	]
	var districts := [industrial_with_boundary]
	t.check_eq(
		DistrictStreamingPolicy.radius_for_position(Vector3(170.0, 0.0, -170.0), districts),
		DistrictStreamingPolicy.DENSE_RADIUS,
		"a position inside the real dense industrial footprint gets the wider radius")
	t.check_eq(
		DistrictStreamingPolicy.radius_for_position(Vector3(10000.0, 0.0, 10000.0), districts),
		DistrictStreamingPolicy.BASE_RADIUS,
		"a position outside every known district falls back to the base radius")
