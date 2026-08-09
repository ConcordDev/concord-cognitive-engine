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
	_test_apply_outline_to_tree_reaches_every_mesh_surface(t)
	_test_apply_outline_to_tree_preserves_the_original_material(t)
	_test_apply_outline_to_tree_never_mutates_the_shared_source_material(t)
	_test_apply_outline_to_tree_is_honest_on_an_empty_tree(t)
	_test_make_toon_material_textured_null_for_non_base_material(t)
	_test_make_toon_material_textured_null_without_albedo_texture(t)
	_test_make_toon_material_textured_builds_real_material_with_texture(t)
	_test_apply_textured_toon_to_tree_routes_textured_and_untextured_correctly(t)
	_test_apply_textured_toon_to_tree_is_honest_on_an_empty_tree(t)
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


## Builds a small synthetic tree shaped like a resolved GLB: a root Node3D
## with two child MeshInstance3D nodes, each carrying one surface with a
## real baked material (a StandardMaterial3D with a distinct albedo, same
## as how an imported .glb's own mesh resource carries its material —
## simulated here since this repo has no committed .glb fixture, matching
## `tests/test_dtu_prop_renderer.gd`'s own synthetic-fixture convention).
static func _build_fake_glb_tree() -> Dictionary:
	var root := Node3D.new()
	var mesh_instances: Array[MeshInstance3D] = []
	var original_materials: Array[StandardMaterial3D] = []
	for i in range(2):
		var mi := MeshInstance3D.new()
		var box := BoxMesh.new()
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.2 + i * 0.1, 0.4, 0.6)
		box.material = mat
		mi.mesh = box
		root.add_child(mi)
		mesh_instances.append(mi)
		original_materials.append(mat)
	return {"root": root, "mesh_instances": mesh_instances, "original_materials": original_materials}


static func _test_apply_outline_to_tree_reaches_every_mesh_surface(t: TestUtils) -> void:
	var built := _build_fake_glb_tree()
	var touched := ArtStyle.apply_outline_to_tree(built["root"], "cyber")
	t.check_eq(touched, 2, "one surface per mesh instance x 2 instances")
	for mi in built["mesh_instances"]:
		var active := (mi as MeshInstance3D).get_active_material(0)
		t.check(active != null, "each surface has an active material after the pass")
		if active != null:
			t.check(active.next_pass != null, "the active material now carries an outline next_pass")
			if active.next_pass is ShaderMaterial:
				t.check_eq(active.next_pass.shader, ArtStyle.outline_shader(), "next_pass uses the real cached outline shader")


static func _test_apply_outline_to_tree_preserves_the_original_material(t: TestUtils) -> void:
	var built := _build_fake_glb_tree()
	ArtStyle.apply_outline_to_tree(built["root"], "cyber")
	var mesh_instances: Array = built["mesh_instances"]
	var originals: Array = built["original_materials"]
	for i in range(mesh_instances.size()):
		var active := (mesh_instances[i] as MeshInstance3D).get_active_material(0)
		t.check(active is StandardMaterial3D, "the override is still a StandardMaterial3D, not replaced by a flat toon material")
		if active is StandardMaterial3D:
			t.check_almost(active.albedo_color.r, originals[i].albedo_color.r, "albedo is preserved, not discarded")
			t.check_almost(active.albedo_color.g, originals[i].albedo_color.g, "albedo is preserved, not discarded")
			t.check_almost(active.albedo_color.b, originals[i].albedo_color.b, "albedo is preserved, not discarded")


static func _test_apply_outline_to_tree_never_mutates_the_shared_source_material(t: TestUtils) -> void:
	var built := _build_fake_glb_tree()
	var originals: Array = built["original_materials"]
	ArtStyle.apply_outline_to_tree(built["root"], "cyber")
	for original in originals:
		t.check_eq((original as StandardMaterial3D).next_pass, null,
			"the ORIGINAL mesh-resource material is never mutated -- only a per-instance duplicate carries next_pass (so a shared/cached GLB resource can't leak an outline onto unrelated instances)")


static func _test_apply_outline_to_tree_is_honest_on_an_empty_tree(t: TestUtils) -> void:
	var empty_root := Node3D.new()
	var touched := ArtStyle.apply_outline_to_tree(empty_root, "cyber")
	t.check_eq(touched, 0, "an empty tree touches zero surfaces, never fabricates work done")


## "Toon-shading reach" (2026-08-08) — a 1x1 real ImageTexture, standing in
## for a real GLB's baked albedo texture. Real Image/ImageTexture objects,
## not mocks — `make_toon_material_textured` genuinely reads `.albedo_
## texture` off a real BaseMaterial3D.
static func _make_fake_albedo_texture() -> ImageTexture:
	var img := Image.create(1, 1, false, Image.FORMAT_RGB8)
	img.set_pixel(0, 0, Color(0.8, 0.5, 0.2))
	return ImageTexture.create_from_image(img)


static func _test_make_toon_material_textured_null_for_non_base_material(t: TestUtils) -> void:
	var not_base := ShaderMaterial.new()
	var result := ArtStyle.make_toon_material_textured("cyber", not_base)
	t.check_eq(result, null, "a source that isn't a BaseMaterial3D (e.g. an already-custom ShaderMaterial) honestly returns null, never a fabricated texture")


static func _test_make_toon_material_textured_null_without_albedo_texture(t: TestUtils) -> void:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.5, 0.5, 0.5)  # a real color, but no texture
	var result := ArtStyle.make_toon_material_textured("cyber", mat)
	t.check_eq(result, null, "a BaseMaterial3D with no albedo_texture returns null, so the caller falls back to outline-only rather than a fabricated flat swap")


static func _test_make_toon_material_textured_builds_real_material_with_texture(t: TestUtils) -> void:
	var mat := StandardMaterial3D.new()
	var tex := _make_fake_albedo_texture()
	mat.albedo_texture = tex
	var result := ArtStyle.make_toon_material_textured("cyber", mat)
	t.check(result != null, "a BaseMaterial3D with a real albedo_texture builds a real textured toon material")
	if result != null:
		t.check_eq(result.shader, ArtStyle.toon_textured_shader(), "uses the real cached texture-preserving shader")
		t.check_eq(result.get_shader_parameter("albedo_tex"), tex, "the REAL source texture is bound, not a fabricated substitute")
		t.check(result.next_pass != null, "carries the same outline next_pass as the flat toon material")
		if result.next_pass is ShaderMaterial:
			t.check_eq(result.next_pass.shader, ArtStyle.outline_shader(), "next_pass uses the real cached outline shader")


static func _test_apply_textured_toon_to_tree_routes_textured_and_untextured_correctly(t: TestUtils) -> void:
	var root := Node3D.new()
	# One surface WITH a real albedo texture, one WITHOUT.
	var mi_textured := MeshInstance3D.new()
	var box1 := BoxMesh.new()
	var mat_textured := StandardMaterial3D.new()
	mat_textured.albedo_texture = _make_fake_albedo_texture()
	box1.material = mat_textured
	mi_textured.mesh = box1
	root.add_child(mi_textured)

	var mi_plain := MeshInstance3D.new()
	var box2 := BoxMesh.new()
	var mat_plain := StandardMaterial3D.new()
	mat_plain.albedo_color = Color(0.3, 0.3, 0.3)
	box2.material = mat_plain
	mi_plain.mesh = box2
	root.add_child(mi_plain)

	var result := ArtStyle.apply_textured_toon_to_tree(root, "cyber")
	t.check_eq(int(result.get("textured", -1)), 1, "the surface with a real albedo texture gets the textured treatment")
	t.check_eq(int(result.get("outline_only", -1)), 1, "the surface without one honestly falls back to outline-only, not skipped")

	var textured_active := mi_textured.get_active_material(0)
	t.check(textured_active is ShaderMaterial, "the textured surface's active material is the real textured toon ShaderMaterial")

	var plain_active := mi_plain.get_active_material(0)
	t.check(plain_active is StandardMaterial3D, "the untextured surface keeps its original material TYPE (outline-only never replaces it with a flat toon material)")
	if plain_active is StandardMaterial3D:
		t.check_almost((plain_active as StandardMaterial3D).albedo_color.r, 0.3, "the untextured surface's real albedo colour is preserved")


static func _test_apply_textured_toon_to_tree_is_honest_on_an_empty_tree(t: TestUtils) -> void:
	var empty_root := Node3D.new()
	var result := ArtStyle.apply_textured_toon_to_tree(empty_root, "cyber")
	t.check_eq(int(result.get("textured", -1)), 0, "an empty tree textures zero surfaces, never fabricates work done")
	t.check_eq(int(result.get("outline_only", -1)), 0, "an empty tree outlines zero surfaces either")
