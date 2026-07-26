class_name DistrictStreamingPolicy
extends RefCounted
## DistrictStreamingPolicy — F25 (master-spec "district streaming policy:
## dense enterable city tuning").
##
## ── What already existed before this unit ──────────────────────────────────
## `world/chunk_manager.gd` (P2d) streams chunks at a single UNIFORM
## `DEFAULT_LOAD_RADIUS = 2` regardless of where the player is, and
## `world/lod_policy.gd` details buildings at fixed HIGH_MAX/MEDIUM_MAX/
## LOW_MAX/CULL_AT bands, also uniform world-wide. Neither has ever read a
## per-district signal — this is the first genuinely district-aware
## tuning knob in this client.
##
## ── Real data, not a guess ──────────────────────────────────────────────────
## `buildingCount` and `areaM2` are REAL, server-computed fields this unit
## added to every entry of `scene:data.districts` (server/lib/scene-export.js
## — buildingCount counts actual `world_buildings` rows via the same real
## polygon point-in-polygon test `districts.js#districtAt` already uses;
## areaM2 is a real shoelace-formula polygon area, `districts.js#
## polygonArea`, also added by this unit). `world/scene_bootstrap.gd#
## parse_districts` already passes unknown/additional district fields
## through VERBATIM (see that file's own docstring), so both new fields
## arrive over the wire with zero Godot-side parsing changes.
##
## `density_per_m2` is computed HERE, not pre-baked server-side: shipping a
## pre-rounded density ratio (~0.0002-0.0006/m²) through scene-export.js's
## existing `round()` helper (3 decimals) would silently truncate it to 0 —
## the two whole, precise inputs are the honest thing to ship over the
## wire.
##
## ── Threshold — derived from the real authored concordia-hub layout ───────
## Computing buildingCount/areaM2 for the 6 real concordia-hub districts
## (content/world/concordia-hub/city-layout.json, 60 buildings total) gives
## (buildings per m², descending):
##   industrial  16/25600 ≈ 0.625e-3
##   academy     13/22400 ≈ 0.580e-3
##   observatory 11/22400 ≈ 0.491e-3
##   plaza        9/19600 ≈ 0.459e-3
##   market       6/22400 ≈ 0.268e-3
##   riverside    5/22400 ≈ 0.223e-3
## There is a real, natural gap in that distribution between the sparse
## pair (market/riverside, ~0.22-0.27e-3) and the dense cluster of four
## (plaza/observatory/academy/industrial, ~0.46-0.63e-3).
## DENSITY_HIGH_THRESHOLD_PER_M2 sits in that gap (0.0004 == 0.4 per
## 1000m²) — a real cut derived from the actual authored data, not a
## number picked in isolation. This is a first-draft design dial (same
## posture as CLAUDE.md's "Phase D first-draft constants" table) —
## genuinely untested against real play, queued for a future balance pass
## alongside those.
const DENSITY_HIGH_THRESHOLD_PER_M2: float = 0.0004

const ChunkManager := preload("res://world/chunk_manager.gd")

## Districts at/under the threshold keep chunk_manager.gd's own existing
## default — this policy never LOWERS the baseline, only widens it for a
## real high-density district.
const BASE_RADIUS: int = ChunkManager.DEFAULT_LOAD_RADIUS
## One chunk-ring wider for a dense district — see header for why this is a
## first-draft design dial, not a measured value.
const DENSE_RADIUS: int = ChunkManager.DEFAULT_LOAD_RADIUS + 1


## Real per-m² building density for a district entry carrying the additive
## `buildingCount`/`areaM2` fields (server/lib/scene-export.js). Honest 0.0
## for a district missing either field (an older cached scene payload, or a
## world where this hasn't been computed) rather than a fabricated density.
static func density_per_m2(district: Dictionary) -> float:
	if not (district.has("buildingCount") and district.has("areaM2")):
		return 0.0
	var area := float(district["areaM2"])
	if area <= 0.0:
		return 0.0
	return float(district["buildingCount"]) / area


## The chunk-load radius for a district, given its real computed density.
## An empty/unknown district (`{}` — the honest "not inside any district"
## result from `district_at`) gets the plain default, never a fabricated
## boost.
static func radius_for_district(
		district: Dictionary,
		base_radius: int = BASE_RADIUS,
		dense_radius: int = DENSE_RADIUS,
		high_threshold: float = DENSITY_HIGH_THRESHOLD_PER_M2) -> int:
	if district.is_empty():
		return base_radius
	var density := DistrictStreamingPolicy.density_per_m2(district)
	return dense_radius if density >= high_threshold else base_radius


## Boundary-inclusive ray-casting point-in-polygon test — mirrors
## server/lib/districts.js#pointInPolygon exactly (same on-edge-counts-as-
## inside convention via `_on_segment`), so a client-computed "which
## district is the player in" answer never disagrees with the server's
## own. Pure; a malformed polygon (<3 vertices, or a vertex missing x/z) is
## honestly "not inside," never a crash.
static func point_in_polygon(x: float, z: float, polygon: Array) -> bool:
	if polygon.size() < 3:
		return false
	var eps := 0.000001

	for i in range(polygon.size()):
		var a = polygon[i]
		var b = polygon[(i + 1) % polygon.size()]
		if typeof(a) != TYPE_DICTIONARY or typeof(b) != TYPE_DICTIONARY:
			continue
		if not (a.has("x") and a.has("z") and b.has("x") and b.has("z")):
			continue
		if DistrictStreamingPolicy._on_segment(x, z, a, b, eps):
			return true

	var inside := false
	var j := polygon.size() - 1
	for i in range(polygon.size()):
		var pi = polygon[i]
		var pj = polygon[j]
		if typeof(pi) != TYPE_DICTIONARY or typeof(pj) != TYPE_DICTIONARY:
			j = i
			continue
		if not (pi.has("x") and pi.has("z") and pj.has("x") and pj.has("z")):
			j = i
			continue
		var xi := float(pi["x"])
		var zi := float(pi["z"])
		var xj := float(pj["x"])
		var zj := float(pj["z"])
		if (zi > z) != (zj > z):
			var x_intersect := (xj - xi) * (z - zi) / (zj - zi) + xi
			if x < x_intersect:
				inside = not inside
		j = i
	return inside


static func _on_segment(x: float, z: float, a: Dictionary, b: Dictionary, eps: float) -> bool:
	var ax := float(a["x"])
	var az := float(a["z"])
	var bx := float(b["x"])
	var bz := float(b["z"])
	var cross := (bx - ax) * (z - az) - (bz - az) * (x - ax)
	if absf(cross) > eps:
		return false
	var dot := (x - ax) * (bx - ax) + (z - az) * (bz - az)
	if dot < -eps:
		return false
	var len_sq := (bx - ax) * (bx - ax) + (bz - az) * (bz - az)
	if dot > len_sq + eps:
		return false
	return true


## Which district (if any) contains `position`, from a parsed districts
## array (`world/scene_bootstrap.gd#get_districts()`). `{}` (not null —
## GDScript has no nullable Dictionary) when the position falls outside
## every known district's boundary — never guessed.
static func district_at(position: Vector3, districts: Array) -> Dictionary:
	for d in districts:
		if typeof(d) != TYPE_DICTIONARY or not d.has("boundary"):
			continue
		var boundary = d["boundary"]
		if typeof(boundary) != TYPE_ARRAY:
			continue
		if DistrictStreamingPolicy.point_in_polygon(position.x, position.z, boundary):
			return d
	return {}


## One-call convenience: the real chunk-load radius for wherever `position`
## currently is, given the client's parsed districts array
## (`world/scene_bootstrap.gd#get_districts()`). A caller wires this into
## `ChunkManager.update(position, radius)`'s existing `radius` parameter —
## no change to ChunkManager itself was needed; this policy only supplies
## a smarter value for the parameter that already existed.
static func radius_for_position(position: Vector3, districts: Array) -> int:
	return DistrictStreamingPolicy.radius_for_district(
		DistrictStreamingPolicy.district_at(position, districts))
