class_name TestArtStyle
extends RefCounted
## Pure-logic tests for world/art_style.gd — the Godot client's reader for the
## LOCKED art-direction constants (docs/ART_STYLE_GUIDE.md).
##
## These assert the SPEC PLUMBING and the colour maths: that the generated
## `res://art_style.json` really is being read (not a hardcoded copy drifting
## from concordia-theme.ts), that the per-world saturation dial resolves to the
## documented values, and that `apply_saturation` moves saturation only.
##
## What these DO NOT assert: that any of it reaches pixels. That claim needs a
## real rasterizer and belongs to `scripts/visual-qa.mjs`, which renders these
## same materials under Xvfb/llvmpipe and measures the frame. Both halves are
## needed — this one would happily pass if the shader silently no-opped.

const ArtStyle := preload("res://world/art_style.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_spec_loads_with_the_locked_constants(t)
	_test_saturation_dial_matches_the_documented_table(t)
	_test_unknown_world_falls_back_without_fabricating(t)
	_test_apply_saturation_touches_only_saturation(t)
	_test_band_index_quantises(t)
	_test_outline_derives_from_the_shadow_band(t)
	_test_production_value_dials_read_from_spec(t)
	_test_make_environment_wires_gi_and_post_processing(t)
	_test_make_environment_respects_per_world_saturation_in_adjustment(t)
	_test_rim_dials_read_from_spec(t)
	_test_make_outline_material_uses_the_locked_outline_constants(t)
	_test_make_outline_material_is_honest_for_unknown_world(t)
	_test_make_toon_material_carries_a_real_outline_next_pass(t)
	_test_make_toon_material_from_stays_outline_free_for_palette_isolation(t)
	return t


static func _test_spec_loads_with_the_locked_constants(t: TestUtils) -> void:
	var spec := ArtStyle.load_spec()
	t.check(not spec.is_empty(), "art_style.json loads (run scripts/gen-art-style-spec.mjs)")
	# The four locked ART_STYLE constants, read from the generated spec — if the
	# TS source changes these, the generator's --check gate fails first.
	t.check_almost(ArtStyle.outline_width_m(), 0.018, "OUTLINE_WIDTH_M")
	t.check_eq(ArtStyle.ramp_bands(), 3, "RAMP_BANDS")
	t.check_almost(ArtStyle.grounded_dial(), 0.45, "GROUNDED_DIAL")
	t.check_almost(ArtStyle.outline_darken(), 0.35, "OUTLINE_DARKEN")
	t.check_eq(ArtStyle.canon_worlds().size(), 9, "9 canon worlds in the spec")


static func _test_saturation_dial_matches_the_documented_table(t: TestUtils) -> void:
	t.check_almost(ArtStyle.saturation_for_world("crime"), 0.62, "crime is the noir floor")
	t.check_almost(ArtStyle.saturation_for_world("cyber"), 1.35, "cyber is the neon ceiling")
	t.check_almost(ArtStyle.saturation_for_world("concordia-hub"), 1.0, "hub is the baseline")
	# The legacy 'concordia' alias must resolve like themeForWorldId() does.
	t.check_almost(ArtStyle.saturation_for_world("concordia"), 1.0, "legacy alias resolves to hub")
	t.check_eq(ArtStyle.theme_id_for_world("concordia"), "concordia-hub", "alias -> hub theme")


static func _test_unknown_world_falls_back_without_fabricating(t: TestUtils) -> void:
	var id := ArtStyle.theme_id_for_world("no-such-world")
	t.check_eq(id, String(ArtStyle.load_spec().get("defaultThemeId", "")), "unknown -> default theme")
	t.check_almost(ArtStyle.saturation_for_world("no-such-world"), 1.0, "unknown world -> 1.0 dial")
	# A palette is never invented for a world: the fallback is a REAL registered
	# theme's gradient, and it has the same 3 stops as every other.
	t.check_eq(ArtStyle.toon_gradient("no-such-world").size(), 3, "fallback gradient is real, 3 stops")


static func _test_apply_saturation_touches_only_saturation(t: TestUtils) -> void:
	var base := Color.from_hsv(0.33, 0.5, 0.8)
	var up := ArtStyle.apply_saturation(base, 1.35)
	var down := ArtStyle.apply_saturation(base, 0.62)
	t.check_almost(up.h, base.h, "hue unchanged going up")
	t.check_almost(up.v, base.v, "value unchanged going up")
	t.check_almost(up.s, 0.5 * 1.35, "saturation scaled up")
	t.check_almost(down.s, 0.5 * 0.62, "saturation scaled down")
	# Clamped, never wrapped — a 1.35x dial on an already-vivid colour must not
	# roll over into a different-looking colour.
	var vivid := ArtStyle.apply_saturation(Color.from_hsv(0.1, 0.95, 1.0), 1.35)
	t.check_almost(vivid.s, 1.0, "saturation clamps at 1.0")


static func _test_band_index_quantises(t: TestUtils) -> void:
	t.check_eq(ArtStyle.band_index(0.0, 3), 0, "darkest term -> shadow band")
	t.check_eq(ArtStyle.band_index(0.5, 3), 1, "mid term -> mid band")
	t.check_eq(ArtStyle.band_index(1.0, 3), 2, "brightest term -> light band")
	t.check_eq(ArtStyle.band_index(2.0, 3), 2, "out-of-range clamps, never overflows")
	t.check_eq(ArtStyle.band_index(0.9, 1), 0, "single band degenerates safely")


static func _test_outline_derives_from_the_shadow_band(t: TestUtils) -> void:
	var grad := ArtStyle.toon_gradient("cyber")
	t.check_eq(grad.size(), 3, "cyber has a 3-stop gradient")
	var outline := ArtStyle.outline_color("cyber")
	t.check_almost(outline.r, grad[0].r * 0.35, "outline R = shadow x OUTLINE_DARKEN")
	t.check_almost(outline.g, grad[0].g * 0.35, "outline G = shadow x OUTLINE_DARKEN")
	t.check_almost(outline.b, grad[0].b * 0.35, "outline B = shadow x OUTLINE_DARKEN")


static func _test_production_value_dials_read_from_spec(t: TestUtils) -> void:
	# Pins the generated spec's current values — if concordia-theme.ts changes
	# these, gen-art-style-spec.mjs's --check gate fails first (same discipline
	# as the four locked ART_STYLE constants above).
	t.check(ArtStyle.sdfgi_enabled(), "SDFGI on by default")
	t.check(ArtStyle.glow_enabled(), "glow on by default")
	t.check_almost(ArtStyle.glow_strength(), 0.6, "GLOW_STRENGTH")
	t.check(ArtStyle.ssao_enabled(), "SSAO on by default")
	t.check_almost(ArtStyle.ssao_intensity(), 1.0, "SSAO_INTENSITY")
	t.check(ArtStyle.color_adjustment_enabled(), "color adjustment on by default")


static func _test_make_environment_wires_gi_and_post_processing(t: TestUtils) -> void:
	var env := ArtStyle.make_environment("concordia-hub")
	t.check(env != null, "make_environment returns a real Environment for a known world")
	if env == null:
		return
	t.check_eq(env.sdfgi_enabled, true, "SDFGI is actually enabled on the Environment resource")
	t.check_eq(env.glow_enabled, true, "glow is actually enabled on the Environment resource")
	t.check_almost(env.glow_strength, 0.6, "glow_strength reaches the real Environment property")
	t.check_eq(env.ssao_enabled, true, "SSAO is actually enabled on the Environment resource")
	t.check_almost(env.ssao_intensity, 1.0, "ssao_intensity reaches the real Environment property")
	t.check_eq(env.adjustment_enabled, true, "color adjustment is actually enabled")


static func _test_make_environment_respects_per_world_saturation_in_adjustment(t: TestUtils) -> void:
	# The adjustment pass's saturation must be the SAME per-world dial every
	# other pass reads — never a second, independently-drifting number.
	var crime_env := ArtStyle.make_environment("crime")
	var cyber_env := ArtStyle.make_environment("cyber")
	t.check(crime_env != null and cyber_env != null, "both worlds resolve a real Environment")
	if crime_env == null or cyber_env == null:
		return
	t.check_almost(crime_env.adjustment_saturation, 0.62, "crime's adjustment_saturation matches its WORLD_SATURATION entry")
	t.check_almost(cyber_env.adjustment_saturation, 1.35, "cyber's adjustment_saturation matches its WORLD_SATURATION entry")


static func _test_rim_dials_read_from_spec(t: TestUtils) -> void:
	t.check_almost(ArtStyle.rim_strength(), 0.35, "RIM_STRENGTH")
	t.check_almost(ArtStyle.rim_power(), 2.5, "RIM_POWER")


static func _test_make_outline_material_uses_the_locked_outline_constants(t: TestUtils) -> void:
	var mat := ArtStyle.make_outline_material("crime")
	t.check(mat != null, "make_outline_material returns a real material for a known world")
	if mat == null:
		return
	t.check_eq(mat.shader, ArtStyle.outline_shader(), "outline material uses the real cached outline shader")
	t.check_almost(float(mat.get_shader_parameter("outline_width")), ArtStyle.outline_width_m(), "outline_width reaches the shader param")
	var expected := ArtStyle.outline_color("crime")
	var actual: Vector3 = mat.get_shader_parameter("outline_color")
	t.check_almost(actual.x, expected.r, "outline_color.r matches ArtStyle.outline_color")
	t.check_almost(actual.y, expected.g, "outline_color.g matches ArtStyle.outline_color")
	t.check_almost(actual.z, expected.b, "outline_color.b matches ArtStyle.outline_color")


static func _test_make_outline_material_is_honest_for_unknown_world(t: TestUtils) -> void:
	ArtStyle.reset_cache()
	var mat := ArtStyle.make_outline_material("not-a-real-world-and-no-spec-loaded-yet")
	# Falls to the default theme (same as every other make_* constructor) once
	# the spec loads -- never null for a spec that's actually present, since
	# theme_id_for_world() always resolves to SOME real theme.
	t.check(mat != null, "an unknown world still resolves via the default theme, not a hard failure")


static func _test_make_toon_material_carries_a_real_outline_next_pass(t: TestUtils) -> void:
	var mat := ArtStyle.make_toon_material("fantasy")
	t.check(mat != null, "make_toon_material returns a real material for a known world")
	if mat == null:
		return
	t.check(mat.next_pass != null, "the outline pass is attached via Material.next_pass")
	t.check(mat.next_pass is ShaderMaterial, "next_pass is a real ShaderMaterial")
	if mat.next_pass is ShaderMaterial:
		t.check_eq(mat.next_pass.shader, ArtStyle.outline_shader(), "next_pass uses the real outline shader, not a copy")


static func _test_make_toon_material_from_stays_outline_free_for_palette_isolation(t: TestUtils) -> void:
	# scripts/visual-qa.mjs's saturation-ordering assertion holds the palette
	# FIXED and varies only saturation via this exact entry point -- an
	# outline pass has nothing to do with that isolation and must not sneak
	# in here (see make_toon_material's own class doc for why the outline
	# wiring lives one level up, in make_toon_material, instead).
	var mat := ArtStyle.make_toon_material_from(Color.BLACK, Color.GRAY, Color.WHITE, 1.0)
	t.check_eq(mat.next_pass, null, "make_toon_material_from never attaches an outline pass")
