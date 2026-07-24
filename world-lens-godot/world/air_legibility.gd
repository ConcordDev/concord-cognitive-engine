class_name AirLegibility
extends RefCounted
## AirLegibility — C15 (master-spec "air legibility: silhouettes + per-
## district lighting readable from altitude").
##
## Pure, testable transform of REAL per-district data (server/lib/
## districts.js, migration 374 — palette hex strings + lightingTag +
## elevationHint, carried in every `scene:data` payload's `districts` array
## per server/lib/scene-export.js, parsed client-side by
## `world/scene_bootstrap.gd#parse_districts`/`get_districts()`, this unit's
## other change) into an altitude-appropriate visual descriptor. Nothing
## here invents a color: every output is derived from the district's own
## authored `palette.primary` hex string.
##
## ── Why simplify, not just fade ────────────────────────────────────────────
## Real cartography/game-rendering precedent for "read a busy scene from far
## away": aeronautical sectional charts and impostor/LOD rendering both drop
## secondary detail and boost contrast as viewing distance increases, rather
## than uniformly fading everything — a silhouette needs to stay legible,
## not just dimly visible. This module ports that principle as a
## deterministic function of altitude: near ground level, the district's
## full 3-color palette (primary/secondary/accent) is available for
## detailed surface rendering; above `ALTITUDE_SIMPLIFY_M`, output ramps
## toward ONE boosted-contrast "band" color per district, sourced from
## `palette.primary`; above `ALTITUDE_FLATTEN_M`, the boost saturates at
## maximum ("flattened" — sectional-chart-style single silhouette color).
##
## ── The two altitude dials are Godot-side rendering config, not physics ───
## `ALTITUDE_SIMPLIFY_M` / `ALTITUDE_FLATTEN_M` are authored design dials
## (same posture as aerial-traffic-cycle.js's own `CRUISE_ALTITUDE_M`
## design-dial precedent — see that file's header) — never claimed to be
## measured or server-derived. They sit in the same order of magnitude as
## the ambient air-traffic cruise altitude (60m) so that background traffic
## flying its real routes is roughly where district silhouettes start
## simplifying, which is the whole point of "air legibility": readable
## FROM roughly where a flying viewer would actually be.
##
## ── Where this plugs into rendering (NOT built by this unit) ──────────────
## `world/scene_bootstrap.gd#_spawn_node` currently gives every building
## node a plain unit `BoxMesh` placeholder with no material override (see
## that function). A future renderer would, on an altitude-band change (not
## every frame — detail_level only has 3 discrete values, so recomputation
## is a threshold-crossing event, not continuous):
##   1. Read the local camera/player altitude.
##   2. For each district currently in view (matched via each spawned
##      node's `extras.district_id`, already carried by scene-export.js —
##      see server/lib/scene-export.js:79 `extras.district_id =
##      purposeInfo.district_id`), call
##      `AirLegibility.legibility_for_altitude(district, altitude_m)`.
##   3. Apply the returned `band_color`/`silhouette_color` to that
##      district's building MeshInstance3D materials — a real
##      StandardMaterial3D swap, and possibly an outline/rim-light shader
##      for `silhouette_color` specifically.
## Step 3 is real engine-visual work this container cannot render or verify
## — there is no Godot binary available here (docs/GODOT_INTEGRATION.md's
## "Validation achieved" section), so writing untested material/shader code
## and calling it done would be exactly the kind of unverified visual claim
## CLAUDE.md's honesty invariant warns against. What IS built and tested
## here is the real, deterministic data transform a renderer would call —
## queued for visual verification in VISUAL_QA.md.

## Design dial — see class doc "The two altitude dials" section. Above this
## altitude, a district's rendering starts ramping from full palette detail
## toward a single boosted-contrast band color.
const ALTITUDE_SIMPLIFY_M: float = 45.0

## Design dial — above this altitude the boost has fully saturated
## ("flattened": single silhouette color, no secondary/accent detail at
## all — the sectional-chart-style extreme).
const ALTITUDE_FLATTEN_M: float = 120.0


## Parses a `#rrggbb` (or `rrggbb`) hex string into a Color. Never throws —
## malformed input degrades to a neutral gray with `ok:false` rather than a
## fabricated color, so a caller can detect and surface the degradation
## instead of silently rendering a wrong hue.
static func parse_hex_color(hex: String) -> Dictionary:
	var h := hex.strip_edges()
	if h.begins_with("#"):
		h = h.substr(1)
	if h.length() != 6:
		return {"color": Color(0.5, 0.5, 0.5), "ok": false}
	var r := h.substr(0, 2).hex_to_int() / 255.0
	var g := h.substr(2, 2).hex_to_int() / 255.0
	var b := h.substr(4, 2).hex_to_int() / 255.0
	return {"color": Color(r, g, b), "ok": true}


## Standard perceptual-luminance weighting (0.299/0.587/0.114) — used to
## decide whether a boosted silhouette should push toward white or black
## for maximum contrast against open sky, rather than always brightening
## (which would wash out an already-light district color to invisibility).
static func luminance(c: Color) -> float:
	return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b


## Boosts a real color toward a high-contrast silhouette variant: saturation
## pushed up, and value pushed toward whichever extreme increases contrast
## against a bright sky (light colors get brighter, dark colors get
## darker). `strength` in [0,1] — 0 returns the input unchanged, 1 is
## maximum boost. Pure color math on the real input color; no lookup table,
## no invented palette.
static func boost_contrast(c: Color, strength: float) -> Color:
	var s := clampf(strength, 0.0, 1.0)
	var boosted := c
	boosted.s = clampf(c.s + (1.0 - c.s) * s * 0.6, 0.0, 1.0)
	if AirLegibility.luminance(c) >= 0.5:
		boosted.v = clampf(c.v + (1.0 - c.v) * s, 0.0, 1.0)
	else:
		boosted.v = clampf(c.v * (1.0 - s * 0.6), 0.0, 1.0)
	return boosted


## The real per-altitude visual descriptor for one district. `district` is
## the parsed shape `scene_bootstrap.gd#parse_districts` produces (a
## `palette` dict with `primary`/`secondary`/`accent` hex strings, plus
## `id`/`name`/`lightingTag`/`elevationHint`). Deterministic pure function
## of (district, altitude_m) — same inputs always produce the same output.
##
## Returns:
##   district_id:       the district's real id, passed through
##   detail_level:       "full" | "simplified" | "flattened"
##   band_color:         Color — the single flat fill color a silhouette/
##                        impostor render would use, always derived from
##                        `palette.primary`
##   silhouette_color:    Color — further boost_contrast'd for outline/edge
##                        rendering; boost strength ramps with altitude
##   secondary_visible:  bool — whether ground-detail secondary/accent
##                        colors should still be drawn (false once past
##                        ALTITUDE_SIMPLIFY_M)
##   palette_ok:         bool — false if `palette.primary` failed to parse
##                        as a real hex color (degraded-gray fallback used)
static func legibility_for_altitude(district: Dictionary, altitude_m: float) -> Dictionary:
	var palette: Dictionary = district.get("palette", {})
	var primary_hex := String(palette.get("primary", "#808080"))
	var parsed := AirLegibility.parse_hex_color(primary_hex)
	var primary: Color = parsed["color"]

	var detail_level := "full"
	var strength := 0.0
	var secondary_visible := true

	if altitude_m >= AirLegibility.ALTITUDE_FLATTEN_M:
		detail_level = "flattened"
		strength = 1.0
		secondary_visible = false
	elif altitude_m >= AirLegibility.ALTITUDE_SIMPLIFY_M:
		detail_level = "simplified"
		# Linear ramp across the simplify→flatten band so the transition is
		# a gradual boost, not a jarring pop at the threshold.
		var band_span: float = AirLegibility.ALTITUDE_FLATTEN_M - AirLegibility.ALTITUDE_SIMPLIFY_M
		var span: float = maxf(band_span, 0.001)
		strength = clampf((altitude_m - AirLegibility.ALTITUDE_SIMPLIFY_M) / span, 0.0, 1.0)
		secondary_visible = false

	return {
		"district_id": district.get("id", ""),
		"detail_level": detail_level,
		"band_color": AirLegibility.boost_contrast(primary, strength * 0.6),
		"silhouette_color": AirLegibility.boost_contrast(primary, strength),
		"secondary_visible": secondary_visible,
		"palette_ok": parsed["ok"],
	}
