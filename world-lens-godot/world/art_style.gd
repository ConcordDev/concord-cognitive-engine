class_name ArtStyle
extends RefCounted
## ArtStyle — the Godot client's reader for the LOCKED art-direction constants.
##
## docs/ART_STYLE_GUIDE.md's thesis: coherence > fidelity. Every render pass
## reads ONE set of constants (one outline weight, one ramp-band count, one
## grounded<->cartoon dial), and worlds differ ONLY by palette + saturation.
## The single source of truth is
## `concord-frontend/lib/world-lens/concordia-theme.ts`; `res://art_style.json`
## is GENERATED from it by `scripts/gen-art-style-spec.mjs` (with a `--check`
## drift gate). This file never hardcodes a constant the TS owns — a hardcoded
## copy here IS the per-component drift the guide exists to prevent.
##
## Honest failure: if the generated spec is missing or malformed, `load_spec()`
## returns an empty Dictionary and every accessor returns an explicit fallback.
## Nothing here fabricates a palette for an unknown world — it resolves to the
## spec's own `defaultThemeId`, exactly like `themeForWorldId()` does in TS.
##
## Scope of what this file is: the material/environment construction that
## `world/air_legibility.gd`'s header calls "Step 3 — real engine-VISUAL work",
## which was previously not written because there was no engine to verify it
## against. There is now: `scripts/visual-qa.mjs` renders the output of this
## file under a real rasterizer and asserts on the pixels. As of Phase S1
## (2026-08-07) `make_toon_material()`'s output IS wired into
## `scene_bootstrap.gd`'s and `avatar/avatar_rig.gd`'s live spawn paths — see
## VISUAL_QA.md for exactly what is and is not claimed, and for which spawn
## paths (ground plane, real GLB meshes) still aren't covered.

const SPEC_PATH := "res://art_style.json"

const TOON_SHADER := """
shader_type spatial;
render_mode diffuse_lambert, specular_disabled;

uniform vec3 band_shadow;
uniform vec3 band_mid;
uniform vec3 band_light;
uniform int bands = 3;
uniform float grounded_dial = 0.45;
uniform vec3 rim_color;
uniform float rim_strength = 0.35;
uniform float rim_power = 2.5;

void light() {
	float ndotl = clamp(dot(normalize(NORMAL), normalize(LIGHT)), 0.0, 1.0);
	// Quantise into exactly `bands` steps — the ramp the art guide locks at 3.
	float step_i = floor(clamp(ndotl, 0.0, 0.999999) * float(bands));
	float t = step_i / max(float(bands - 1), 1.0);
	vec3 ramp = t < 0.5
		? mix(band_shadow, band_mid, t * 2.0)
		: mix(band_mid, band_light, (t - 0.5) * 2.0);
	// GROUNDED_DIAL blends the hard ramp toward a smoother real-ish term.
	vec3 grounded = mix(band_shadow, band_light, ndotl);
	DIFFUSE_LIGHT += mix(ramp, grounded, grounded_dial) * ATTENUATION;
}

void fragment() {
	// Fresnel rim light — "rim light fakes subsurface" (ART_STYLE_GUIDE.md
	// rule 3). Grazing-angle term only, additive on top of the banded ramp
	// light() already wrote — never replaces it, so RAMP_BANDS stays the
	// single source of truth for shading, this only adds an edge highlight.
	float fresnel = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), rim_power);
	EMISSION = rim_color * fresnel * rim_strength;
}
"""

## Inverted-hull outline (Phase S2) — the standard toon-outline technique:
## expand the mesh outward along its own vertex normals by `outline_width`
## (metres — `OUTLINE_WIDTH_M`), then render ONLY the back-facing side of
## that expanded shell (`cull_front` — Godot's normal front-face culling
## inverted, so the shell's far side is what's left visible). From the
## camera, the expanded shell's back faces poke out past the real mesh's
## silhouette on every edge, reading as a solid outline ring; `unshaded` so
## it's a flat colour, never lit/shadowed like the surface it outlines.
## Applied via `Material.next_pass`, Godot's own built-in mechanism for a
## second full render pass over the same mesh — not a second MeshInstance3D,
## so it can never drift out of transform-sync with the surface it outlines.
const OUTLINE_SHADER := """
shader_type spatial;
render_mode cull_front, unshaded;

uniform vec3 outline_color;
uniform float outline_width;

void vertex() {
	VERTEX += NORMAL * outline_width;
}

void fragment() {
	ALBEDO = outline_color;
}
"""

static var _spec_cache: Dictionary = {}
static var _spec_loaded := false
static var _toon_shader: Shader = null
static var _outline_shader: Shader = null


## Loads (and caches) the generated art spec. Returns {} honestly if absent.
static func load_spec() -> Dictionary:
	if _spec_loaded:
		return _spec_cache
	_spec_loaded = true
	if not FileAccess.file_exists(SPEC_PATH):
		push_warning("[art_style] %s missing — run scripts/gen-art-style-spec.mjs" % SPEC_PATH)
		return _spec_cache
	var text := FileAccess.get_file_as_string(SPEC_PATH)
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_warning("[art_style] %s is not a JSON object" % SPEC_PATH)
		return _spec_cache
	_spec_cache = parsed
	return _spec_cache


## Test seam — forces the next load_spec() to re-read from disk.
static func reset_cache() -> void:
	_spec_cache = {}
	_spec_loaded = false


## ART_STYLE constant by name (OUTLINE_WIDTH_M / RAMP_BANDS / GROUNDED_DIAL /
## OUTLINE_DARKEN). `fallback` is returned when the spec is unavailable.
static func constant(name: String, fallback: float) -> float:
	var spec := load_spec()
	var art = spec.get("artStyle", {})
	if typeof(art) != TYPE_DICTIONARY or not art.has(name):
		return fallback
	return float(art[name])


static func ramp_bands() -> int:
	return int(constant("RAMP_BANDS", 3.0))


static func outline_width_m() -> float:
	return constant("OUTLINE_WIDTH_M", 0.018)


static func outline_darken() -> float:
	return constant("OUTLINE_DARKEN", 0.35)


static func grounded_dial() -> float:
	return constant("GROUNDED_DIAL", 0.45)


## ── Production-value pass (2026-08-07) ───────────────────────────────────────
## Real-time GI / post-processing dials — same spec-driven, never-hardcoded
## contract as the four constants above. See ART_STYLE_GUIDE.md + this
## session's VISUAL_QA.md entry for why these composite on TOP of the toon
## material rather than forking away from it.
static func sdfgi_enabled() -> bool:
	return constant("SDFGI_ENABLED", 1.0) > 0.5


static func glow_enabled() -> bool:
	return constant("GLOW_ENABLED", 1.0) > 0.5


static func glow_strength() -> float:
	return constant("GLOW_STRENGTH", 0.6)


static func ssao_enabled() -> bool:
	return constant("SSAO_ENABLED", 1.0) > 0.5


static func ssao_intensity() -> float:
	return constant("SSAO_INTENSITY", 1.0)


static func color_adjustment_enabled() -> bool:
	return constant("COLOR_ADJUSTMENT_ENABLED", 1.0) > 0.5


static func rim_strength() -> float:
	return constant("RIM_STRENGTH", 0.35)


static func rim_power() -> float:
	return constant("RIM_POWER", 2.5)


## Mirrors `themeForWorldId()` in the TS: direct id match, the 'concordia'
## legacy alias, else the spec's own default theme.
static func theme_id_for_world(world_id: String) -> String:
	var spec := load_spec()
	var themes = spec.get("themes", {})
	var default_id := String(spec.get("defaultThemeId", "neon-punk"))
	if typeof(themes) != TYPE_DICTIONARY:
		return default_id
	if world_id == "concordia":
		world_id = "concordia-hub"
	if themes.has(world_id):
		return world_id
	return default_id


## Mirrors `saturationForWorld()` in the TS — 1.0 for un-tabled themes.
static func saturation_for_world(world_id: String) -> float:
	var spec := load_spec()
	var table = spec.get("worldSaturation", {})
	if typeof(table) != TYPE_DICTIONARY:
		return 1.0
	var id := theme_id_for_world(world_id)
	if not table.has(id):
		return 1.0
	return float(table[id])


## The world's 3-stop toon gradient (shadow / mid / light) as Colors.
## Returns an empty array when the spec is unavailable — callers must not
## fabricate a palette.
static func toon_gradient(world_id: String) -> Array[Color]:
	var out: Array[Color] = []
	var theme := theme_for_world(world_id)
	var grad = theme.get("toonGradient", [])
	if typeof(grad) != TYPE_ARRAY:
		return out
	for entry in grad:
		out.append(Color.html(String(entry)))
	return out


static func theme_for_world(world_id: String) -> Dictionary:
	var spec := load_spec()
	var themes = spec.get("themes", {})
	if typeof(themes) != TYPE_DICTIONARY:
		return {}
	var id := theme_id_for_world(world_id)
	var theme = themes.get(id, {})
	return theme if typeof(theme) == TYPE_DICTIONARY else {}


static func canon_worlds() -> Array:
	var spec := load_spec()
	var list = spec.get("canonWorlds", [])
	return list if typeof(list) == TYPE_ARRAY else []


# ── Pure colour maths (unit-testable without a scene tree) ──────────────────

## Applies a world's saturation dial to a colour, in HSV. This is the ONE place
## the dial reaches pixels — value/hue are untouched, saturation scales and
## clamps to [0,1]. Kept pure + static so `tests/test_art_style.gd` can pin it
## and `scripts/visual-qa.mjs` can assert the rendered result tracks it.
static func apply_saturation(c: Color, saturation: float) -> Color:
	var out := Color.from_hsv(c.h, clampf(c.s * saturation, 0.0, 1.0), c.v, c.a)
	return out


## Quantises a 0..1 light term into `bands` steps — the CPU-side mirror of the
## toon shader's ramp, so a test can predict which band a given lambert term
## lands in without rendering.
static func band_index(light_term: float, bands: int) -> int:
	if bands <= 1:
		return 0
	var t := clampf(light_term, 0.0, 0.999999)
	return int(t * float(bands))


## Outline colour = shadow band x OUTLINE_DARKEN (shared across all worlds so
## silhouettes read alike — ART_STYLE_GUIDE rule 1).
static func outline_color(world_id: String) -> Color:
	var grad := toon_gradient(world_id)
	if grad.is_empty():
		return Color(0, 0, 0)
	var d := outline_darken()
	var shadow := grad[0]
	return Color(shadow.r * d, shadow.g * d, shadow.b * d, 1.0)


# ── Engine-side construction ────────────────────────────────────────────────


static func toon_shader() -> Shader:
	if _toon_shader == null:
		_toon_shader = Shader.new()
		_toon_shader.code = TOON_SHADER
	return _toon_shader


static func outline_shader() -> Shader:
	if _outline_shader == null:
		_outline_shader = Shader.new()
		_outline_shader.code = OUTLINE_SHADER
	return _outline_shader


## The inverted-hull outline pass for a world — `outline_color(world_id)` x
## `outline_width_m()`, the same two ART_STYLE_GUIDE-locked constants every
## silhouette in the game already shares. Returns null (never a fabricated
## colour) when the spec/palette is unavailable, matching every other
## `make_*` constructor in this file.
static func make_outline_material(world_id: String) -> ShaderMaterial:
	var grad := toon_gradient(world_id)
	if grad.is_empty():
		return null
	var mat := ShaderMaterial.new()
	mat.shader = outline_shader()
	mat.set_shader_parameter("outline_color", _v3(outline_color(world_id)))
	mat.set_shader_parameter("outline_width", outline_width_m())
	return mat


## A cel material for a world: the world's own toonGradient, each stop passed
## through that world's saturation dial, sampled at ART_STYLE.RAMP_BANDS steps.
## Returns null (never a fabricated grey material) when the spec is missing.
##
## Carries the world's outline pass (Phase S2) via `Material.next_pass` —
## Godot's own built-in second-render-pass mechanism, so every existing
## caller (scene_bootstrap.gd's placeholder boxes, avatar_rig.gd's primitive
## capsules — see VISUAL_QA.md's Phase S1 entry) gets the inverted-hull
## outline automatically, no call-site changes needed. `make_toon_material_
## from` below stays outline-free on purpose — it's the palette-isolated
## primitive `scripts/visual-qa.mjs`'s saturation-ordering assertion uses,
## and an outline pass has nothing to do with that isolation.
static func make_toon_material(world_id: String) -> ShaderMaterial:
	var grad := toon_gradient(world_id)
	if grad.size() < 3:
		return null
	var mat := make_toon_material_from(grad[0], grad[1], grad[2], saturation_for_world(world_id))
	mat.next_pass = make_outline_material(world_id)
	return mat


## Same, from an explicit gradient — lets a caller hold the palette FIXED and
## vary only the saturation dial (which is how visual-qa.mjs isolates the dial
## from palette confounds).
static func make_toon_material_from(
	shadow: Color, mid: Color, light: Color, saturation: float
) -> ShaderMaterial:
	var mat := ShaderMaterial.new()
	mat.shader = toon_shader()
	mat.set_shader_parameter("band_shadow", _v3(apply_saturation(shadow, saturation)))
	mat.set_shader_parameter("band_mid", _v3(apply_saturation(mid, saturation)))
	mat.set_shader_parameter("band_light", _v3(apply_saturation(light, saturation)))
	mat.set_shader_parameter("bands", ramp_bands())
	mat.set_shader_parameter("grounded_dial", grounded_dial())
	# Rim light (Phase S2) — keyed off the palette's own light band, so a
	# warm/cold world's rim reads warm/cold too, never a separately-tunable
	# colour that could drift from the palette.
	mat.set_shader_parameter("rim_color", _v3(apply_saturation(light, saturation)))
	mat.set_shader_parameter("rim_strength", rim_strength())
	mat.set_shader_parameter("rim_power", rim_power())
	return mat


static func _v3(c: Color) -> Vector3:
	return Vector3(c.r, c.g, c.b)


## The world's environment: sky gradient (skyTop -> skyHorizon) + ambient, both
## saturation-dialled. Returns null honestly when the spec is unavailable.
static func make_environment(world_id: String) -> Environment:
	var theme := theme_for_world(world_id)
	if theme.is_empty():
		return null
	var sat := saturation_for_world(world_id)
	var env := Environment.new()
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = apply_saturation(_hex(theme.get("skyTop", 0)), sat)
	sky_mat.sky_horizon_color = apply_saturation(_hex(theme.get("skyHorizon", 0)), sat)
	sky_mat.ground_bottom_color = apply_saturation(_hex(theme.get("skyTop", 0)), sat)
	sky_mat.ground_horizon_color = apply_saturation(_hex(theme.get("skyHorizon", 0)), sat)
	sky_mat.sun_angle_max = 1.0
	sky.sky_material = sky_mat
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	var amb = theme.get("ambientLight", {})
	if typeof(amb) == TYPE_DICTIONARY:
		env.ambient_light_color = apply_saturation(_hex(amb.get("color", 0)), sat)
		env.ambient_light_energy = float(amb.get("intensity", 1.0))
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR

	# ── Production-value pass — real-time GI + restrained post-processing,
	# composited on top of the toon material (see the spec-driven dials
	# above; nothing here is a hardcoded fork of ART_STYLE_GUIDE.md's rules).
	# SDFGI is a real Godot 4 Forward+ feature — it degrades to "no bounce
	# light" harmlessly under a renderer that doesn't support it (e.g. the
	# gl_compatibility/opengl3 software path this repo's own headless QA
	# tooling uses — see VISUAL_QA.md), it does not error or fabricate light.
	env.sdfgi_enabled = ArtStyle.sdfgi_enabled()
	env.glow_enabled = ArtStyle.glow_enabled()
	if env.glow_enabled:
		env.glow_strength = ArtStyle.glow_strength()
		env.glow_bloom = 0.0  # bloom stays additive-only; no blown highlights on a flat toon ramp
	env.ssao_enabled = ArtStyle.ssao_enabled()
	if env.ssao_enabled:
		env.ssao_intensity = ArtStyle.ssao_intensity()
	env.adjustment_enabled = ArtStyle.color_adjustment_enabled()
	if env.adjustment_enabled:
		# Reuses the SAME per-world saturation dial every other pass in this
		# file reads — never a second, competing saturation number.
		env.adjustment_saturation = sat
	return env


## A DirectionalLight3D carrying the world's sun colour + intensity.
static func make_sun(world_id: String) -> DirectionalLight3D:
	var theme := theme_for_world(world_id)
	if theme.is_empty():
		return null
	var sun := DirectionalLight3D.new()
	var s = theme.get("sunLight", {})
	if typeof(s) == TYPE_DICTIONARY:
		sun.light_color = apply_saturation(_hex(s.get("color", 0xffffff)), saturation_for_world(world_id))
		sun.light_energy = float(s.get("intensity", 1.0))
	return sun


static func _hex(v) -> Color:
	var i := int(v)
	return Color8((i >> 16) & 0xFF, (i >> 8) & 0xFF, i & 0xFF)
