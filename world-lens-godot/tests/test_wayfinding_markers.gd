class_name TestWayfindingMarkers
extends RefCounted
## Pure-logic tests for world/wayfinding_markers.gd — F27 (multi-altitude
## navigation aids: ground + air wayfinding markers).
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 35 checks
## are asserted on every run.
##
## Verified: `polygon_centroid`, the three `poi_from_*` adapters,
## `collect_pois`, `detail_level_for_altitude`, `marker_for_poi` and
## `nearby_markers` — i.e. that the three real data sources fold into one POI
## list correctly and that altitude selects the detail level it claims.
##
## NOT verified, and it is the whole purpose of a navigation aid: whether the
## markers are actually READABLE — at ground level, at altitude, and against
## the district colors AirLegibility hands them. A marker that computes to
## the right position and detail level can still be invisible, cluttered, or
## unreadable in flight, and only a human at a real display can say;
## headless installs RasterizerDummy and draws nothing. Queued in
## world-lens-godot/VISUAL_QA.md.

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


## Angles are equal modulo 2*PI: +PI and -PI denote the SAME heading. Raw
## float comparison is the wrong equivalence relation for an angle, and
## `atan2` — whose range is (-PI, +PI] — puts the exactly-behind case right on
## its branch cut, where the returned sign is decided purely by the sign of a
## zero (`atan2(-0.0, -1.0) == -PI` but `atan2(+0.0, -1.0) == +PI`). This
## wraps the difference into [-PI, PI] before comparing, so the assertion
## tests the heading rather than which side of the cut it landed on. Note the
## tolerance is NOT widened — `eps` stays as tight as the caller asks; only
## the comparison operator is corrected.
static func _check_angle_eq(t: TestUtils, actual: float, expected: float, label: String,
		eps: float = 0.001) -> void:
	var delta: float = wrapf(actual - expected, -PI, PI)
	t.check(absf(delta) <= eps,
		"%s (expected ~%s modulo 2PI, got %s)" % [label, str(expected), str(actual)])


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_polygon_centroid(t)
	_test_poi_mappers_and_honest_drops(t)
	_test_collect_pois_combines_all_three_sources(t)
	_test_detail_level_reuses_air_legibility_thresholds(t)
	_test_marker_for_poi_direction_and_distance(t)
	_test_nearby_markers_sorts_filters_and_caps(t)
	_test_quest_objective_pois(t)
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
	# (`atan2(-d.x, -d.z)`, zero when d == Vector3.FORWARD == -Z) puts a +Z
	# target exactly half a turn away. That is the atan2 branch cut, so the
	# engine may legitimately report it as either +PI or -PI — the same
	# heading. Compare modulo 2PI.
	_check_angle_eq(
		t, marker["yaw"], PI, "yaw matches ConKayPointing.yaw_pitch_to's own convention", 0.01)

	# A non-degenerate bearing, to pin the convention's actual SIGN rather
	# than only its branch-cut-ambiguous antipode. For a target due +X,
	# d == (1,0,0), so yaw = atan2(-1, -0) = -PI/2: turning toward Godot's
	# +X (Vector3.RIGHT) from a -Z facing is a negative yaw under this
	# convention. If the convention ever flipped, this check fails while the
	# modulo comparison above would not.
	var east_poi := {
		"id": "east-target", "kind": "landing_pad", "name": "East Target",
		"x": 10.0, "y": 0.0, "z": 0.0,
	}
	var east_marker := WayfindingMarkers.marker_for_poi(Vector3.ZERO, east_poi)
	_check_angle_eq(
		t, east_marker["yaw"], -PI / 2.0,
		"a due-+X target yaws negative, pinning the convention's sign", 0.01)
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


## Phase Q — quest objectives as a 4th POI source. Real fixture shapes: the
## `/quests/active` `progress` array (quest_objectives row + current_count/
## obj_completed_at), and an id->Vector3 npc_positions dict matching
## AvatarManager.npc_positions_snapshot()'s real return shape.
static func _test_quest_objective_pois(t: TestUtils) -> void:
	var talk_obj := {
		"id": "obj1", "type": "talk_to", "target": "gatekeeper_orin",
		"required_count": 1, "description": "Speak with the gatekeeper",
		"current_count": 0, "obj_completed_at": null,
	}
	var npc_positions := {"gatekeeper_orin": Vector3(12.0, 0.0, -5.0)}

	t.check_eq(
		WayfindingMarkers.next_incomplete_objective({"progress": [talk_obj]}),
		talk_obj, "the one incomplete objective is returned verbatim")

	var done_obj := talk_obj.duplicate(true)
	done_obj["obj_completed_at"] = 1234
	t.check(
		WayfindingMarkers.next_incomplete_objective({"progress": [done_obj]}).is_empty(),
		"every objective complete yields an honest empty result")
	t.check(
		WayfindingMarkers.next_incomplete_objective({}).is_empty(),
		"a quest with no progress array yields an honest empty result")

	var poi := WayfindingMarkers.poi_from_quest_objective("q1", "Meet the Gatekeeper", talk_obj, npc_positions)
	t.check_eq(poi["kind"], WayfindingMarkers.KIND_QUEST_OBJECTIVE, "quest-objective POI carries the real kind tag")
	t.check_almost(poi["x"], 12.0, "POI x resolves from the real live NPC position")
	t.check_almost(poi["z"], -5.0, "POI z resolves from the real live NPC position")
	t.check_eq(poi["name"], "Speak with the gatekeeper", "POI name prefers the real authored description")

	# Honest omissions — every reason a quest objective must NOT get a pin.
	var gather_obj := {"id": "obj2", "type": "gather", "target": "wildroot", "current_count": 0, "obj_completed_at": null}
	t.check(
		WayfindingMarkers.poi_from_quest_objective("q1", "T", gather_obj, npc_positions).is_empty(),
		"a non-talk_to objective type honestly gets no map pin (no location resolver exists for it)")
	var unresolved_obj := {"id": "obj3", "type": "talk_to", "target": "wanderer_kael", "current_count": 0, "obj_completed_at": null}
	t.check(
		WayfindingMarkers.poi_from_quest_objective("q1", "T", unresolved_obj, npc_positions).is_empty(),
		"a talk_to target that isn't currently a live NPC honestly gets no map pin, never a guessed position")

	# quest_pois — the end-to-end real-shaped array.
	var quests := [
		{"id": "q1", "title": "Meet the Gatekeeper", "progress": [talk_obj]},
		{"id": "q2", "title": "No NPC yet", "progress": [unresolved_obj]},
		{"id": "q3", "title": "All done", "progress": [done_obj]},
		"not-a-dict",
	]
	var pois := WayfindingMarkers.quest_pois(quests, npc_positions)
	t.check_eq(pois.size(), 1, "only the one quest with a resolvable talk_to objective yields a POI")
	t.check_eq(pois[0]["id"], "quest:q1:obj1", "quest-objective POI id is namespaced by quest and objective id")
