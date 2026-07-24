class_name TestWayfindingMarkers
extends RefCounted
## Pure-logic tests for world/wayfinding_markers.gd — F27 (multi-altitude
## navigation aids: ground + air wayfinding markers). ENGINE-GATED
## execution — see world-lens-godot/VISUAL_QA.md.

const WayfindingMarkers := preload("res://world/wayfinding_markers.gd")
const AirLegibility := preload("res://world/air_legibility.gd")
const TestUtils := preload("res://tests/test_utils.gd")

## Real authored fixtures — same pads test_land_air_transition_controller.gd
## already cites (content/world/concordia-hub/city-layout.json's
## `landingPads` array).
const PLAZA_PAD := {
	"id": "landing-pad-plaza-north", "name": "Plaza Skydock",
	"position": {"x": 0.0, "z": 280.0}, "radius_m": 14.0, "elevation_m": 0.0,
}
## Real authored rect for the plaza district (districts.js#DEFAULT_DISTRICTS).
const PLAZA_DISTRICT := {
	"id": "concordia-hub:plaza", "name": "The Concord Plaza", "elevationHint": 0.0,
	"boundary": [
		{"x": -70.0, "z": -70.0}, {"x": 70.0, "z": -70.0},
		{"x": 70.0, "z": 70.0}, {"x": -70.0, "z": 70.0},
	],
}
## Same fixture shape as test_rooftop_access_controller.gd's OBSERVATORY.
const OBSERVATORY_ROOFTOP := {
	"id": "station-observatory", "name": "The Observatory",
	"x": -192.0, "z": 4.0, "roof_y": 12.0,
}


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_polygon_centroid(t)
	_test_poi_mappers_and_honest_drops(t)
	_test_collect_pois_combines_all_three_sources(t)
	_test_detail_level_reuses_air_legibility_thresholds(t)
	_test_marker_for_poi_direction_and_distance(t)
	_test_nearby_markers_sorts_filters_and_caps(t)
	return t


static func _test_polygon_centroid(t: TestUtils) -> void:
	var centroid := WayfindingMarkers.polygon_centroid(PLAZA_DISTRICT["boundary"])
	t.check_almost(centroid["x"], 0.0, "plaza rect centroid x is the real vertex average (0)")
	t.check_almost(centroid["z"], 0.0, "plaza rect centroid z is the real vertex average (0)")

	var offset_rect := [
		{"x": 90.0, "z": -70.0}, {"x": 250.0, "z": -70.0},
		{"x": 250.0, "z": 70.0}, {"x": 90.0, "z": 70.0},
	]
	var centroid2 := WayfindingMarkers.polygon_centroid(offset_rect)
	t.check_almost(centroid2["x"], 170.0, "market rect centroid x matches the real authored geometry")
	t.check_almost(centroid2["z"], 0.0, "market rect centroid z matches the real authored geometry")

	t.check(
		WayfindingMarkers.polygon_centroid([{"x": 0.0, "z": 0.0}]).is_empty(),
		"a degenerate (<3 vertex) boundary yields an honest empty centroid, never guessed")


static func _test_poi_mappers_and_honest_drops(t: TestUtils) -> void:
	var pad_poi := WayfindingMarkers.poi_from_landing_pad(PLAZA_PAD)
	t.check_eq(
		pad_poi["kind"], WayfindingMarkers.KIND_LANDING_PAD,
		"landing pad POI carries the real kind tag")
	t.check_eq(pad_poi["x"], 0.0, "landing pad POI x comes from the real position")
	t.check_eq(pad_poi["z"], 280.0, "landing pad POI z comes from the real position")
	t.check(
		WayfindingMarkers.poi_from_landing_pad({"id": "no-position"}).is_empty(),
		"a malformed pad honestly drops rather than fabricating a position")

	var rooftop_poi := WayfindingMarkers.poi_from_rooftop_building(OBSERVATORY_ROOFTOP)
	t.check_eq(
		rooftop_poi["kind"], WayfindingMarkers.KIND_ROOFTOP,
		"rooftop POI carries the real kind tag")
	t.check_eq(
		rooftop_poi["y"], 12.0,
		"rooftop POI y is the real roofline height, not the ground position")
	t.check(
		WayfindingMarkers.poi_from_rooftop_building({}).is_empty(),
		"an empty rooftop building honestly drops")

	var district_poi := WayfindingMarkers.poi_from_district(PLAZA_DISTRICT)
	t.check_eq(
		district_poi["kind"], WayfindingMarkers.KIND_DISTRICT,
		"district POI carries the real kind tag")
	t.check_almost(district_poi["x"], 0.0, "district POI is anchored at the real polygon centroid")
	t.check(
		WayfindingMarkers.poi_from_district({"id": "no-boundary"}).is_empty(),
		"a district with no usable boundary honestly drops")


static func _test_collect_pois_combines_all_three_sources(t: TestUtils) -> void:
	var pois := WayfindingMarkers.collect_pois(
		[PLAZA_PAD], [OBSERVATORY_ROOFTOP], [PLAZA_DISTRICT])
	t.check_eq(pois.size(), 3, "one POI from each of the three real sources")
	var kinds := {}
	for p in pois:
		kinds[p["kind"]] = true
	t.check(kinds.has(WayfindingMarkers.KIND_LANDING_PAD), "landing pad kind present")
	t.check(kinds.has(WayfindingMarkers.KIND_ROOFTOP), "rooftop kind present")
	t.check(kinds.has(WayfindingMarkers.KIND_DISTRICT), "district kind present")

	var mixed := WayfindingMarkers.collect_pois(
		[PLAZA_PAD, "not-a-dict", {"id": "malformed"}], [], [])
	t.check_eq(
		mixed.size(), 1,
		"malformed entries in the raw source arrays are dropped, never crash the whole list")


static func _test_detail_level_reuses_air_legibility_thresholds(t: TestUtils) -> void:
	t.check_eq(
		WayfindingMarkers.detail_level_for_altitude(0.0), "full",
		"ground level (well under ALTITUDE_SIMPLIFY_M) is full detail")
	t.check_eq(
		WayfindingMarkers.detail_level_for_altitude(AirLegibility.ALTITUDE_SIMPLIFY_M),
		"simplified",
		"exactly at ALTITUDE_SIMPLIFY_M crosses into simplified — same boundary AirLegibility uses")
	t.check_eq(
		WayfindingMarkers.detail_level_for_altitude(AirLegibility.ALTITUDE_FLATTEN_M),
		"minimal",
		"exactly at ALTITUDE_FLATTEN_M crosses into minimal — same boundary AirLegibility uses")


static func _test_marker_for_poi_direction_and_distance(t: TestUtils) -> void:
	var poi := {
		"id": "north-target", "kind": "landing_pad", "name": "North Target",
		"x": 0.0, "y": 0.0, "z": 10.0,
	}
	var marker := WayfindingMarkers.marker_for_poi(Vector3.ZERO, poi)
	t.check_almost(
		marker["distance_m"], 10.0,
		"distance matches the real straight-line distance to the target")
	# Player at origin facing a target due +Z: ConKayPointing's yaw convention
	# (unrotated Node3D faces -Z) puts a +Z target at yaw == PI.
	t.check_almost(marker["yaw"], PI, "yaw matches ConKayPointing.yaw_pitch_to's own convention", 0.01)
	t.check_eq(marker["detail_level"], "full", "ground-level player position yields full detail")


static func _test_nearby_markers_sorts_filters_and_caps(t: TestUtils) -> void:
	var pois := [
		{"id": "near", "kind": "landing_pad", "name": "Near", "x": 10.0, "y": 0.0, "z": 0.0},
		{"id": "mid", "kind": "landing_pad", "name": "Mid", "x": 50.0, "y": 0.0, "z": 0.0},
		{"id": "far", "kind": "landing_pad", "name": "Far", "x": 500.0, "y": 0.0, "z": 0.0},
	]
	var all_markers := WayfindingMarkers.nearby_markers(Vector3.ZERO, pois)
	t.check_eq(
		all_markers.size(), 3,
		"all three real POIs returned when under max_count and no distance cap")
	t.check_eq(all_markers[0]["id"], "near", "sorted nearest-first")
	t.check_eq(all_markers[1]["id"], "mid", "sorted nearest-first")
	t.check_eq(all_markers[2]["id"], "far", "sorted nearest-first")

	var capped := WayfindingMarkers.nearby_markers(Vector3.ZERO, pois, 2)
	t.check_eq(capped.size(), 2, "max_count caps the marker list to the nearest N")
	t.check_eq(capped[1]["id"], "mid", "the capped set keeps the nearest, drops the farthest")

	var filtered := WayfindingMarkers.nearby_markers(Vector3.ZERO, pois, 5, 100.0)
	t.check_eq(filtered.size(), 2, "max_distance_m drops POIs beyond real range")

	t.check(
		WayfindingMarkers.nearby_markers(Vector3.ZERO, []).is_empty(),
		"an empty POI list yields an empty marker list, never a crash")
