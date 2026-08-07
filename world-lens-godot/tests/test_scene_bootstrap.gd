class_name TestSceneBootstrap
extends RefCounted
## Pure-logic tests for world/scene_bootstrap.gd's `parse_landing_pads`
## (added by C14 — land↔air transition — so
## avatar/land_air_transition_controller.gd has a real source of pad data
## from a `scene:data` payload instead of requiring pads to be hand-wired).
## Does NOT re-test `node_to_transform` (no change made to it by this unit).
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 22 checks
## are asserted on every run.
##
## What that covers is genuinely complete for what it covers: parsing a
## `concord-scene/v1` payload's pads/districts/rooftop nodes is a pure data
## transform with no visual component of its own, so these checks — including
## that unknown/additional fields pass through VERBATIM rather than being
## dropped or invented — fully verify that half.
##
## NOT verified: `apply_scene`/`_spawn_node`, the engine half that actually
## instantiates a MeshInstance3D + BoxMesh per node. Those placeholder boxes
## were never a visual-quality claim to begin with (see scene_bootstrap.gd's
## own header), and headless installs RasterizerDummy and draws nothing, so
## nothing here says a scene renders. Queued in
## world-lens-godot/VISUAL_QA.md.

const SceneBootstrap := preload("res://world/scene_bootstrap.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_parses_well_shaped_pads_verbatim(t)
	_test_drops_malformed_entries_without_crashing(t)
	_test_empty_or_missing_field_yields_empty_array(t)
	_test_parses_well_shaped_districts_verbatim(t)
	_test_drops_malformed_districts_without_crashing(t)
	_test_parses_rooftop_buildings_from_nodes(t)
	_test_rooftop_parsing_drops_non_rooftop_and_malformed_nodes(t)
	_test_node_basis_rotates_the_footprint(t)
	_test_centroid_averages_positions_honestly_empty(t)
	_test_bounds_center_and_radius_from_spawned_nodes(t)
	_test_robust_cluster_bounds_small_n_matches_plain_bounds(t)
	_test_robust_cluster_bounds_no_trim_without_a_real_gap(t)
	_test_robust_cluster_bounds_trims_a_clear_outlier_cluster(t)
	_test_robust_cluster_bounds_concordia_hub_shaped_data(t)
	return t


## Regression pin for the basis-composition defect that `scripts/visual-qa.mjs`
## found by RENDERING a rotated node and measuring its footprint in pixels.
## The old `Basis().rotated(UP, r).scaled(s)` scales along the PARENT axes
## after rotating, so an 8 x 2 footprint at rotationY = PI/2 came back out as
## 8 wide x 2 deep — the footprint of a rotated building never rotated. The
## correct composition scales in the node's own frame first (`R * from_scale`).
static func _test_node_basis_rotates_the_footprint(t: TestUtils) -> void:
	var scale := Vector3(8.0, 1.0, 2.0)

	var b0 := SceneBootstrap.node_basis(0.0, scale)
	t.check_almost(b0.x.length(), 8.0, "unrotated: local X keeps the width")
	t.check_almost(b0.z.length(), 2.0, "unrotated: local Z keeps the depth")

	var b90 := SceneBootstrap.node_basis(PI / 2.0, scale)
	t.check_almost(b90.x.length(), 8.0, "rotated 90deg: local X still 8 long")
	t.check_almost(b90.z.length(), 2.0, "rotated 90deg: local Z still 2 long")
	# +rotationY takes world +X toward world -Z (Y-up, right-handed).
	t.check_almost(b90.x.z, -8.0, "rotated 90deg: width now lies along -Z")
	t.check(absf(b90.x.x) < 0.001, "rotated 90deg: no width left along +X")

	var b30 := SceneBootstrap.node_basis(PI / 6.0, scale)
	t.check_almost(b30.x.length(), 8.0, "rotated 30deg: scale magnitude preserved")
	t.check_almost(b30.x.x, 8.0 * cos(PI / 6.0), "rotated 30deg: X component")
	t.check_almost(b30.x.z, -8.0 * sin(PI / 6.0), "rotated 30deg: Z component sign")


static func _test_parses_well_shaped_pads_verbatim(t: TestUtils) -> void:
	var raw := [
		{
			"id": "landing-pad-plaza-north", "district_id": "concordia-hub:plaza",
			"name": "Plaza Skydock", "position": {"x": 0, "z": 280}, "radius_m": 14, "elevation_m": 0,
		},
	]
	var parsed := SceneBootstrap.parse_landing_pads(raw)
	t.check_eq(parsed.size(), 1, "one well-shaped pad entry parses to one output entry")
	t.check_eq(parsed[0]["id"], "landing-pad-plaza-north", "id is passed through verbatim")
	t.check_eq(parsed[0]["radius_m"], 14, "radius_m is passed through verbatim, not recomputed")
	t.check_eq(
		parsed[0]["position"], {"x": 0, "z": 280},
		"position dict is passed through verbatim, real server-authored coordinates")


static func _test_drops_malformed_entries_without_crashing(t: TestUtils) -> void:
	var raw := [
		{"id": "no-position", "radius_m": 14},
		{"id": "no-radius", "position": {"x": 0, "z": 0}},
		{"id": "position-missing-z", "position": {"x": 0}, "radius_m": 14},
		"not-even-a-dict",
		{"id": "well-shaped", "position": {"x": 1, "z": 2}, "radius_m": 5},
	]
	var parsed := SceneBootstrap.parse_landing_pads(raw)
	t.check_eq(
		parsed.size(), 1,
		"only the one well-shaped entry survives — malformed entries are dropped, never fabricated")
	t.check_eq(parsed[0]["id"], "well-shaped", "the surviving entry is the genuinely well-shaped one")


static func _test_empty_or_missing_field_yields_empty_array(t: TestUtils) -> void:
	t.check(
		SceneBootstrap.parse_landing_pads([]).is_empty(),
		"an empty raw array yields an empty result — honest 'no pads' for worlds with none authored")


## C15 — same verbatim-passthrough-or-drop coverage as the pad tests above,
## for the additive `districts` field (server/lib/districts.js,
## migration 374, consumed downstream by world/air_legibility.gd).
static func _test_parses_well_shaped_districts_verbatim(t: TestUtils) -> void:
	var raw := [
		{
			"id": "concordia-hub:plaza", "worldId": "concordia-hub", "name": "The Concord Plaza",
			"boundary": [{"x": -70, "z": -70}, {"x": 70, "z": -70}, {"x": 70, "z": 70}, {"x": -70, "z": 70}],
			"palette": {"primary": "#d9c9a3", "secondary": "#8b7355", "accent": "#f2c14e"},
			"lightingTag": "warm_day", "elevationHint": 0,
		},
	]
	var parsed := SceneBootstrap.parse_districts(raw)
	t.check_eq(parsed.size(), 1, "one well-shaped district entry parses to one output entry")
	t.check_eq(parsed[0]["id"], "concordia-hub:plaza", "id is passed through verbatim")
	t.check_eq(
		parsed[0]["palette"], {"primary": "#d9c9a3", "secondary": "#8b7355", "accent": "#f2c14e"},
		"palette dict is passed through verbatim, real server-authored hex colors")


static func _test_drops_malformed_districts_without_crashing(t: TestUtils) -> void:
	var raw := [
		{"id": "no-palette", "name": "X"},
		{"palette": {"primary": "#ffffff"}},  # no id
		{"id": "empty-palette", "palette": {}},  # palette present but no primary
		"not-even-a-dict",
		{"id": "well-shaped", "palette": {"primary": "#5c5c5c"}},
	]
	var parsed := SceneBootstrap.parse_districts(raw)
	t.check_eq(
		parsed.size(), 1,
		"only the one well-shaped entry survives — malformed entries are dropped, never fabricated")
	t.check_eq(parsed[0]["id"], "well-shaped", "the surviving entry is the genuinely well-shaped one")


## F26 — real node shape from server/lib/scene-export.js (`extras.levels`
## naming a "rooftop" entry, exactly like "station-observatory" in
## content/world/concordia-hub/city-layout.json), reduced to the flat
## descriptor `rooftop_access_controller.gd` consumes.
static func _test_parses_rooftop_buildings_from_nodes(t: TestUtils) -> void:
	var nodes := [
		{
			"id": "station-observatory", "name": "The Observatory",
			"transform": {"translation": [-192.0, 0.0, 4.0], "rotationY": 0.0, "scale": [16.0, 12.0, 16.0]},
			"extras": {
				"lens": "astronomy",
				"levels": {"ground": "main floor", "mid": "gallery", "rooftop": "rooftop deck"},
			},
		},
	]
	var parsed := SceneBootstrap.parse_rooftop_buildings(nodes)
	t.check_eq(parsed.size(), 1, "one rooftop-tagged node parses to one rooftop descriptor")
	t.check_eq(parsed[0]["id"], "station-observatory", "id is passed through")
	t.check_eq(parsed[0]["x"], -192.0, "x comes from the real transform.translation")
	t.check_eq(parsed[0]["z"], 4.0, "z comes from the real transform.translation")
	t.check_eq(parsed[0]["half_w"], 8.0, "half_w is HALF of the real transform.scale.x (16/2)")
	t.check_eq(parsed[0]["half_d"], 8.0, "half_d is HALF of the real transform.scale.z (16/2)")
	t.check_eq(
		parsed[0]["roof_y"], 12.0,
		"roof_y is translation.y + scale.y (0 + 12) — the real roofline")
	t.check_eq(
		parsed[0]["purpose"], "rooftop deck",
		"purpose is the real authored levels.rooftop string")


static func _test_rooftop_parsing_drops_non_rooftop_and_malformed_nodes(t: TestUtils) -> void:
	var nodes := [
		{
			"id": "no-rooftop-level",
			"transform": {"translation": [0.0, 0.0, 0.0], "scale": [10.0, 8.0, 10.0]},
			"extras": {"levels": {"ground": "main floor"}},
		},
		{
			"id": "no-extras",
			"transform": {"translation": [0.0, 0.0, 0.0], "scale": [10.0, 8.0, 10.0]},
		},
		{
			"id": "no-transform",
			"extras": {"levels": {"rooftop": "roof"}},
		},
		"not-even-a-dict",
		{
			"id": "well-shaped-rooftop",
			"transform": {"translation": [1.0, 2.0, 3.0], "scale": [4.0, 5.0, 6.0]},
			"extras": {"levels": {"rooftop": "a real roof"}},
		},
	]
	var parsed := SceneBootstrap.parse_rooftop_buildings(nodes)
	t.check_eq(
		parsed.size(), 1,
		"only the one genuinely rooftop-tagged, well-shaped node survives")
	t.check_eq(
		parsed[0]["id"], "well-shaped-rooftop",
		"the surviving entry is the genuinely well-shaped one")


## Added alongside wiring get_bounds_center()/get_bounds_radius() into
## world/boot.gd's default camera framing (2026-08-07 — see VISUAL_QA.md's
## "Camera framing — closed" entry). Mirrors
## engineering/fea_scene_builder.gd's `centroid` pure-average contract
## exactly, including the same honest Vector3.ZERO-for-empty behavior.
static func _test_centroid_averages_positions_honestly_empty(t: TestUtils) -> void:
	var empty: Array[Vector3] = []
	t.check(
		SceneBootstrap.centroid(empty).is_equal_approx(Vector3.ZERO),
		"an empty position array yields Vector3.ZERO, never a fabricated center")

	var single: Array[Vector3] = [Vector3(10.0, 2.0, -4.0)]
	t.check(
		SceneBootstrap.centroid(single).is_equal_approx(Vector3(10.0, 2.0, -4.0)),
		"a single position IS the centroid")

	var three: Array[Vector3] = [Vector3(0.0, 0.0, 0.0), Vector3(6.0, 0.0, 0.0), Vector3(3.0, 0.0, 9.0)]
	t.check(
		SceneBootstrap.centroid(three).is_equal_approx(Vector3(3.0, 0.0, 3.0)),
		"centroid is the plain average, not a weighted or clamped one")


## get_bounds_center/get_bounds_radius read the REAL spawned MeshInstance3D
## children after a real apply_scene() call — not the raw input payload —
## so this exercises the actual engine-instantiated node positions, the
## same nodes `world/boot.gd`'s default camera framing reads from.
static func _test_bounds_center_and_radius_from_spawned_nodes(t: TestUtils) -> void:
	var bootstrap := SceneBootstrap.new()

	# Empty (nothing spawned yet) — same honest zero-fallback as
	# FeaSceneBuilder.get_bounds_center(), never an assumed origin claim.
	t.check(
		bootstrap.get_bounds_center().is_equal_approx(Vector3.ZERO),
		"no scene applied yet -> honest Vector3.ZERO center")
	t.check_eq(
		bootstrap.get_bounds_radius(), 0.0,
		"no scene applied yet -> honest zero radius, not a fabricated spread")

	var payload := {
		"ok": true,
		"format": "concord-scene/v1",
		"nodes": [
			{"id": "a", "transform": {"translation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}},
			{"id": "b", "transform": {"translation": [20.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}},
			{"id": "c", "transform": {"translation": [-20.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}},
		],
	}
	bootstrap.apply_scene(payload)

	t.check(
		bootstrap.get_bounds_center().is_equal_approx(Vector3.ZERO),
		"three nodes symmetric about the origin -> centroid IS the origin")
	t.check_almost(
		bootstrap.get_bounds_radius(), 20.0,
		"radius is the REAL max distance to a spawned node (20m), not the node count or a guess")

	# Re-applying clears the prior spawn (SceneBootstrap._clear()) — bounds
	# must reflect the CURRENT scene, never a stale one from a prior world.
	bootstrap.apply_scene({
		"ok": true,
		"format": "concord-scene/v1",
		"nodes": [
			{"id": "solo", "transform": {"translation": [5.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}},
		],
	})
	t.check(
		bootstrap.get_bounds_center().is_equal_approx(Vector3(5.0, 0.0, 0.0)),
		"re-applying a scene recomputes bounds from the NEW spawn, not the old one")
	t.check_almost(
		bootstrap.get_bounds_radius(), 0.0,
		"a single spawned node has zero radius (it IS the centroid)")

	bootstrap.free()


## robust_cluster_bounds(): added alongside get_camera_bounds() to fix a
## real, measured camera-framing defect (see world/scene_bootstrap.gd's own
## doc comment on MIN_NODES_FOR_TRIM for the full story and the real
## concordia-hub distance data that motivated it).

## Below MIN_NODES_FOR_TRIM there's no meaningful "majority" to detect an
## outlier against, so this must be byte-identical to plain centroid + max
## distance -- even with a lone far-away point present.
static func _test_robust_cluster_bounds_small_n_matches_plain_bounds(t: TestUtils) -> void:
	var positions: Array[Vector3] = [
		Vector3(0.0, 0.0, 0.0), Vector3(10.0, 0.0, 0.0), Vector3(-10.0, 0.0, 0.0),
		Vector3(500.0, 0.0, 0.0),  # a lone "outlier" -- still only 4 nodes total
	]
	var result := SceneBootstrap.robust_cluster_bounds(positions)
	var plain_center := SceneBootstrap.centroid(positions)
	t.check(
		(result["center"] as Vector3).is_equal_approx(plain_center),
		"below MIN_NODES_FOR_TRIM, center is the untouched plain centroid")
	t.check_almost(
		float(result["radius"]), plain_center.distance_to(Vector3(500.0, 0.0, 0.0)),
		"below MIN_NODES_FOR_TRIM, radius is the untouched true max distance")


## A continuously, evenly spread-out world (no real cluster/outlier
## separation) must NOT get clipped -- this is exactly the shape a fixed
## percentile cutoff would get wrong (it would always trim SOMETHING),
## which is why this is gap-detection, not a percentile.
static func _test_robust_cluster_bounds_no_trim_without_a_real_gap(t: TestUtils) -> void:
	var positions: Array[Vector3] = []
	for i in range(10):
		positions.append(Vector3(float(i) * 20.0, 0.0, 0.0))  # evenly spaced, 0..180
	var result := SceneBootstrap.robust_cluster_bounds(positions)
	var plain_center := SceneBootstrap.centroid(positions)
	var plain_max := 0.0
	for p in positions:
		plain_max = maxf(plain_max, p.distance_to(plain_center))
	t.check(
		(result["center"] as Vector3).is_equal_approx(plain_center),
		"evenly-spread positions: no gap large enough to trim, center unchanged")
	t.check_almost(
		float(result["radius"]), plain_max,
		"evenly-spread positions: radius unchanged, nothing excluded")


## The core case this was built for: a tight cluster plus a handful of
## nodes clearly separated from it. Mirrors the REAL shape measured live
## against concordia-hub (50 buildings within ~140-360m, then a hard jump
## to ~980-1100m for 12 more) at a smaller scale for a fast, exact test.
static func _test_robust_cluster_bounds_trims_a_clear_outlier_cluster(t: TestUtils) -> void:
	var positions: Array[Vector3] = []
	# Tight cluster: 8 nodes within 10-80 of the origin.
	for i in range(8):
		positions.append(Vector3(10.0 + float(i) * 10.0, 0.0, 0.0))
	# Clear outlier cluster: 3 nodes far past a huge gap.
	positions.append(Vector3(500.0, 0.0, 0.0))
	positions.append(Vector3(520.0, 0.0, 0.0))
	positions.append(Vector3(540.0, 0.0, 0.0))

	var result := SceneBootstrap.robust_cluster_bounds(positions)
	var refined_center := result["center"] as Vector3
	var refined_radius := float(result["radius"])

	t.check(
		refined_center.x < 100.0,
		"trimmed center stays near the dense cluster, not dragged toward the outliers")
	t.check(
		refined_radius < 100.0,
		"trimmed radius reflects only the dense cluster's own tight spread")

	var plain_center := SceneBootstrap.centroid(positions)
	var plain_max := 0.0
	for p in positions:
		plain_max = maxf(plain_max, p.distance_to(plain_center))
	t.check(
		refined_radius < plain_max,
		"trimmed radius is strictly smaller than the untrimmed max (the real bug being fixed)")


## Reproduces the real SHAPE of concordia-hub's measured distance-from-
## centroid distribution (tools/live_probe.gd against a real running
## server, see VISUAL_QA.md/CLAUDE.md: ~50 buildings within a ~140-360m
## band, then a hard jump straight to a ~980-1100m band for ~12 more) at
## the real node counts, to pin the exact bug this was written to fix:
## get_bounds_radius() there reported 1114m (a single farthest-outlier
## max); the trimmed radius must land near the dense core's own tight
## span, nowhere close to 1114m.
static func _test_robust_cluster_bounds_concordia_hub_shaped_data(t: TestUtils) -> void:
	var positions: Array[Vector3] = []
	# 50 nodes forming a tight core cluster, spread across ~220 units.
	for i in range(50):
		positions.append(Vector3(140.0 + float(i) * 4.4, 0.0, 0.0))
	# 12 nodes forming a clearly separated distant cluster, past a huge gap.
	for i in range(12):
		positions.append(Vector3(980.0 + float(i) * 12.0, 0.0, 0.0))

	var result := SceneBootstrap.robust_cluster_bounds(positions)
	var refined_radius := float(result["radius"])
	t.check(
		refined_radius < 400.0,
		"concordia-hub-shaped data: trimmed radius stays near the dense core's own span (~220 units), nowhere close to the outlier-inflated ~1100")
