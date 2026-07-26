class_name TestAirLegibility
extends RefCounted
## Pure-logic tests for world/air_legibility.gd (C15 — air legibility).
##
## ENGINE-EXECUTED (2026-07-25). The parenthetical that used to sit here —
## "no engine available in this container" — is superseded: a real Godot 4.4
## headless binary now lives at `./.godot-runtime/bin/godot` (see
## docs/GODOT_RUNTIME.md), and `--script tests/run_all.gd` compiles and RUNS
## this suite — its 30 checks are asserted on every run.
##
## Verified: the color-math transform itself — hex parsing of the real
## authored district `palette.primary` strings, relative luminance, the
## contrast boost, and the altitude→descriptor selection. No output is
## invented from nothing; every color derives from the district's own data,
## and that now holds under execution rather than under inspection.
##
## NOT verified — and for THIS unit the gap is the substance of the feature,
## not a footnote: whether the boosted colors are actually LEGIBLE from
## altitude under real lighting. C15 is a readability claim, and readability
## cannot be asserted by arithmetic. The original header's distinction ("the
## real color-math transform, never how it actually renders") was correct and
## still stands; only its reason has changed. Queued in
## world-lens-godot/VISUAL_QA.md.

const AirLegibility := preload("res://world/air_legibility.gd")
const TestUtils := preload("res://tests/test_utils.gd")

## Real palette from server/lib/districts.js's DEFAULT_DISTRICTS — the
## Concord Plaza entry — used verbatim so this test exercises the actual
## authored data shape, not an invented one.
const PLAZA_PALETTE := {
	"primary": "#d9c9a3", "secondary": "#8b7355", "accent": "#f2c14e",
}
const INDUSTRIAL_PALETTE := {
	"primary": "#5c5c5c", "secondary": "#8a6d3b", "accent": "#d9534f",
}


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_parse_hex_color_happy_path(t)
	_test_parse_hex_color_malformed_degrades_honestly(t)
	_test_luminance_ordering(t)
	_test_boost_contrast_zero_strength_is_identity(t)
	_test_boost_contrast_increases_saturation(t)
	_test_legibility_ground_level_is_full_detail(t)
	_test_legibility_ramps_through_simplified_band(t)
	_test_legibility_flattened_above_threshold(t)
	_test_legibility_never_invents_a_color(t)
	_test_legibility_missing_palette_is_honest_gray_not_crash(t)
	return t


static func _test_parse_hex_color_happy_path(t: TestUtils) -> void:
	var parsed := AirLegibility.parse_hex_color("#d9c9a3")
	t.check(parsed["ok"], "well-formed 6-digit hex parses ok")
	var c: Color = parsed["color"]
	t.check_almost(c.r, 0xd9 / 255.0, "red channel decodes correctly")
	t.check_almost(c.g, 0xc9 / 255.0, "green channel decodes correctly")
	t.check_almost(c.b, 0xa3 / 255.0, "blue channel decodes correctly")

	var no_hash := AirLegibility.parse_hex_color("d9c9a3")
	t.check(no_hash["ok"], "a leading '#' is optional")


static func _test_parse_hex_color_malformed_degrades_honestly(t: TestUtils) -> void:
	var too_short := AirLegibility.parse_hex_color("#fff")
	t.check_eq(too_short["ok"], false, "a 3-digit shorthand is not silently accepted")
	t.check_eq(
		too_short["color"], Color(0.5, 0.5, 0.5),
		"malformed input degrades to neutral gray, never a guess")

	var empty := AirLegibility.parse_hex_color("")
	t.check_eq(empty["ok"], false, "empty string is honestly rejected")


static func _test_luminance_ordering(t: TestUtils) -> void:
	t.check(
		AirLegibility.luminance(Color(1, 1, 1)) > AirLegibility.luminance(Color(0, 0, 0)),
		"white must have higher luminance than black")
	t.check_almost(AirLegibility.luminance(Color(0, 0, 0)), 0.0, "black luminance is ~0")
	t.check_almost(AirLegibility.luminance(Color(1, 1, 1)), 1.0, "white luminance is ~1")


static func _test_boost_contrast_zero_strength_is_identity(t: TestUtils) -> void:
	var c := Color(0.85, 0.79, 0.64)  # ~#d9c9a3
	var boosted := AirLegibility.boost_contrast(c, 0.0)
	t.check_almost(boosted.r, c.r, "strength 0 leaves red unchanged")
	t.check_almost(boosted.g, c.g, "strength 0 leaves green unchanged")
	t.check_almost(boosted.b, c.b, "strength 0 leaves blue unchanged")


static func _test_boost_contrast_increases_saturation(t: TestUtils) -> void:
	var parsed := AirLegibility.parse_hex_color(PLAZA_PALETTE["primary"])
	var primary: Color = parsed["color"]
	var boosted := AirLegibility.boost_contrast(primary, 1.0)
	t.check(
		boosted.s >= primary.s,
		"maximum boost must never REDUCE saturation relative to the real authored color")


static func _test_legibility_ground_level_is_full_detail(t: TestUtils) -> void:
	var district := {"id": "concordia-hub:plaza", "palette": PLAZA_PALETTE}
	var desc := AirLegibility.legibility_for_altitude(district, 0.0)
	t.check_eq(desc["detail_level"], "full", "ground level (0m) is full detail")
	t.check_eq(
		desc["secondary_visible"], true,
		"full detail keeps secondary/accent colors visible")
	t.check_eq(
		desc["district_id"], "concordia-hub:plaza",
		"district id is passed through verbatim")
	t.check_eq(desc["palette_ok"], true, "a real authored hex parses ok")


static func _test_legibility_ramps_through_simplified_band(t: TestUtils) -> void:
	var district := {"id": "concordia-hub:plaza", "palette": PLAZA_PALETTE}
	var below_alt: float = AirLegibility.ALTITUDE_SIMPLIFY_M - 1.0
	var just_below := AirLegibility.legibility_for_altitude(district, below_alt)
	t.check_eq(
		just_below["detail_level"], "full",
		"just below the simplify threshold is still full detail")

	var mid_band := AirLegibility.legibility_for_altitude(district, 80.0)
	t.check_eq(
		mid_band["detail_level"], "simplified",
		"80m (between the two dials) is the simplified band")
	t.check_eq(
		mid_band["secondary_visible"], false,
		"simplified band hides secondary/accent detail")

	var higher := AirLegibility.legibility_for_altitude(district, 110.0)
	# Monotonic ramp: for a light source color (plaza primary's luminance is
	# well above 0.5), boost_contrast pushes value UP as strength increases,
	# so a higher altitude within the band must never read as LESS boosted
	# than a lower one (no non-monotonic wobble in the ramp).
	var higher_lum := AirLegibility.luminance(higher["silhouette_color"])
	var mid_lum := AirLegibility.luminance(mid_band["silhouette_color"])
	t.check(
		higher_lum >= mid_lum,
		"higher altitude in the ramp band boosts contrast at least as much, never less")


static func _test_legibility_flattened_above_threshold(t: TestUtils) -> void:
	var district := {"id": "concordia-hub:plaza", "palette": PLAZA_PALETTE}
	var flatten_alt: float = AirLegibility.ALTITUDE_FLATTEN_M
	var at_threshold := AirLegibility.legibility_for_altitude(district, flatten_alt)
	t.check_eq(
		at_threshold["detail_level"], "flattened",
		"exactly at the flatten threshold is flattened")
	t.check_eq(at_threshold["secondary_visible"], false, "flattened has no secondary detail")

	var way_above := AirLegibility.legibility_for_altitude(district, 5000.0)
	t.check_eq(
		way_above["detail_level"], "flattened",
		"arbitrarily high altitude stays flattened, never errors")

	var parsed := AirLegibility.parse_hex_color(PLAZA_PALETTE["primary"])
	var max_boost := AirLegibility.boost_contrast(parsed["color"], 1.0)
	t.check_eq(
		at_threshold["silhouette_color"], max_boost,
		"flattened silhouette color equals max-strength boost of the real primary color")


static func _test_legibility_never_invents_a_color(t: TestUtils) -> void:
	# A district whose palette differs must yield a genuinely different
	# band color — proof the transform is actually reading the real input,
	# not returning a hardcoded constant regardless of what's passed in.
	var plaza := {"id": "concordia-hub:plaza", "palette": PLAZA_PALETTE}
	var industrial := {"id": "concordia-hub:industrial", "palette": INDUSTRIAL_PALETTE}
	var d1 := AirLegibility.legibility_for_altitude(plaza, 200.0)
	var d2 := AirLegibility.legibility_for_altitude(industrial, 200.0)
	t.check(
		d1["band_color"] != d2["band_color"],
		"two districts with different real palettes yield different band colors")


static func _test_legibility_missing_palette_is_honest_gray_not_crash(t: TestUtils) -> void:
	var district := {"id": "no-palette-world:x"}
	var desc := AirLegibility.legibility_for_altitude(district, 10.0)
	t.check_eq(
		desc["palette_ok"], false,
		"a district with no real palette data is flagged, not silently faked")
	t.check_eq(
		desc["district_id"], "no-palette-world:x",
		"id is still passed through even when palette is missing")
