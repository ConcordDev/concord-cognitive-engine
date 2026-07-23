class_name LodPolicy
extends RefCounted
## LodPolicy — pure distance-to-band decisions mirroring Godot's own
## GeometryInstance3D.visibility_range_begin/end model.
##
## The four bands mirror concord-frontend/lib/world-lens/lod.ts's
## STANDARD_LOD_BANDS EXACTLY (highMax=50, mediumMax=200, lowMax=500) plus
## its distanceCullMeshes cullAt=600, so a Godot-rendered chunk pops detail
## at the same distances the Three.js client does. All functions here are
## pure/static — no scene tree, no engine singletons — except
## `apply_to_instance`, which is a thin engine-touching wrapper around the
## decision the pure funcs already made.

enum Band { HIGH, MEDIUM, LOW, BILLBOARD, CULLED }

const HIGH_MAX: float = 50.0
const MEDIUM_MAX: float = 200.0
const LOW_MAX: float = 500.0
const CULL_AT: float = 600.0


## Which band applies at `distance` from the camera. Negative distances
## clamp to 0 rather than producing an undefined band.
static func band_for_distance(
		distance: float,
		high_max: float = HIGH_MAX,
		medium_max: float = MEDIUM_MAX,
		low_max: float = LOW_MAX,
		cull_at: float = CULL_AT) -> int:
	var d := maxf(distance, 0.0)
	if d >= cull_at:
		return Band.CULLED
	if d < high_max:
		return Band.HIGH
	if d < medium_max:
		return Band.MEDIUM
	if d < low_max:
		return Band.LOW
	return Band.BILLBOARD


## Godot's visibility_range_begin/end window for a given band, expressed so
## it never contradicts `band_for_distance`'s own boundaries (bands are
## contiguous — no gaps, no overlaps). `end == 0.0` for CULLED is a sentinel
## meaning "never visible in practice" (this policy never assigns a real
## instance to a permanently-culled range; the caller should free/hide it
## instead of relying on this value alone).
static func visibility_range_for_band(
		band: int,
		high_max: float = HIGH_MAX,
		medium_max: float = MEDIUM_MAX,
		low_max: float = LOW_MAX,
		cull_at: float = CULL_AT) -> Dictionary:
	match band:
		Band.HIGH:
			return {"begin": 0.0, "end": high_max}
		Band.MEDIUM:
			return {"begin": high_max, "end": medium_max}
		Band.LOW:
			return {"begin": medium_max, "end": low_max}
		Band.BILLBOARD:
			return {"begin": low_max, "end": cull_at}
		_:
			return {"begin": cull_at, "end": 0.0}


## Human-readable band name for logging/debug UI. Pure.
static func band_name(band: int) -> String:
	match band:
		Band.HIGH:
			return "high"
		Band.MEDIUM:
			return "medium"
		Band.LOW:
			return "low"
		Band.BILLBOARD:
			return "billboard"
		_:
			return "culled"


## Engine-side helper: apply the computed visibility range to a
## GeometryInstance3D-derived node (MeshInstance3D, MultiMeshInstance3D,
## etc.). This is the ONLY engine-touching function in this file — the
## decision itself is made by the pure funcs above.
static func apply_to_instance(instance: GeometryInstance3D, band: int) -> void:
	var r := LodPolicy.visibility_range_for_band(band)
	instance.visibility_range_begin = r["begin"]
	instance.visibility_range_end = r["end"]
