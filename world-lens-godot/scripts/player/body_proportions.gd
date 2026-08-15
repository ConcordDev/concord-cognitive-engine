class_name BodyProportions
extends RefCounted
## BodyProportions — pure ports of the Three.js body-dimension tables.
##
## Sources (read, not guessed):
##   1. character-schema.ts#proportionsFor — anatomical head-count math used by
##      enhanced-avatar-builder.ts for the local-player / hero path.
##   2. AvatarSystem3D.tsx#BODY_DIMENSIONS — the narrower legacy table used by
##      createAvatarMesh for the flat primitive path (and exported for tests).
##   3. character-schema.ts heightBand table (generateAppearance) — canonical
##      totalHeight per bodyArchetype when no explicit height is supplied.
##
## No engine calls. Unit-testable via preload + static funcs.


## Canonical totalHeight (metres) per bodyArchetype — character-schema.ts
## generateAppearance heightBand table, verbatim.
const HEIGHT_BAND := {
	"slim": 1.74,
	"average": 1.75,
	"stocky": 1.65,
	"tall": 1.92,
	"broad": 1.80,
	"petite": 1.55,
	"legend": 2.10,
}

## Head-count per archetype — proportionsFor.
const HEAD_COUNT := {
	"slim": 7.5,
	"average": 7.5,
	"stocky": 7.0,
	"tall": 8.0,
	"broad": 7.5,
	"petite": 7.0,
	"legend": 8.5,
}

const SHOULDER_FACTOR := {
	"slim": 1.6,
	"average": 1.9,
	"stocky": 2.2,
	"tall": 1.9,
	"broad": 2.2,
	"petite": 1.7,
	"legend": 2.3,
}

const HIP_FACTOR := {
	"slim": 1.5,
	"average": 1.7,
	"stocky": 1.9,
	"tall": 1.7,
	"broad": 1.8,
	"petite": 1.6,
	"legend": 1.9,
}

## AvatarSystem3D.tsx BODY_DIMENSIONS — legacy primitive path. Keys match the
## narrower AppearanceConfig bodyType set (no broad/petite there).
const BODY_DIMENSIONS := {
	"slim": {
		"torsoWidth": 0.35, "torsoHeight": 0.55, "torsoDepth": 0.2,
		"limbRadius": 0.06, "headRadius": 0.14,
		"legLength": 0.8, "armLength": 0.6, "totalHeight": 1.75,
	},
	"average": {
		"torsoWidth": 0.4, "torsoHeight": 0.55, "torsoDepth": 0.25,
		"limbRadius": 0.07, "headRadius": 0.15,
		"legLength": 0.8, "armLength": 0.6, "totalHeight": 1.75,
	},
	"stocky": {
		"torsoWidth": 0.5, "torsoHeight": 0.5, "torsoDepth": 0.3,
		"limbRadius": 0.09, "headRadius": 0.15,
		"legLength": 0.75, "armLength": 0.55, "totalHeight": 1.65,
	},
	"tall": {
		"torsoWidth": 0.4, "torsoHeight": 0.6, "torsoDepth": 0.25,
		"limbRadius": 0.07, "headRadius": 0.15,
		"legLength": 0.9, "armLength": 0.7, "totalHeight": 1.9,
	},
	## Sprint B.6 — 1.5× of tall, for immortal NPCs / The Three.
	"legend": {
		"torsoWidth": 0.6, "torsoHeight": 0.9, "torsoDepth": 0.375,
		"limbRadius": 0.105, "headRadius": 0.225,
		"legLength": 1.35, "armLength": 1.05, "totalHeight": 2.85,
	},
}


## Normalize an incoming bodyArchetype / bodyType string. Unknown values
## honestly fall through to "average" — same default character-schema.ts uses
## when a field is absent — never a fabricated archetype name.
static func normalize_archetype(arch: String) -> String:
	var key := arch.strip_edges().to_lower()
	if HEIGHT_BAND.has(key):
		return key
	# Legacy bodyType aliases that the rich schema folds elsewhere.
	match key:
		"":
			return "average"
		_:
			return "average"


## Default totalHeight (m) for an archetype when the caller has no saved
## measurement. Pure lookup of HEIGHT_BAND.
static func default_height(arch: String) -> float:
	var key := normalize_archetype(arch)
	return float(HEIGHT_BAND[key])


## Port of character-schema.ts#proportionsFor. Returns a Dictionary with the
## same field names as BodyProportions so GDScript callers can read them by
## key without a typed resource.
static func proportions_for(arch: String, total_height: float = -1.0) -> Dictionary:
	var key := normalize_archetype(arch)
	var height := total_height if total_height > 0.0 else default_height(key)
	var head_count := float(HEAD_COUNT[key])
	var head := height / head_count
	var leg_heads := 3.7
	match key:
		"legend":
			leg_heads = 4.2
		"tall":
			leg_heads = 4.0
		"stocky":
			leg_heads = 3.4
	return {
		"totalHeight": height,
		"headHeight": head,
		"headWidth": head * 0.7,
		"headDepth": head * 0.85,
		"shoulderWidth": head * float(SHOULDER_FACTOR[key]),
		"hipWidth": head * float(HIP_FACTOR[key]),
		"torsoLength": head * 2.5,
		"legLength": head * leg_heads,
		"armLength": head * 3.0,
		"handLength": head * 0.95,
		"footLength": head * 1.0,
		"neckLength": head * 0.45,
		"bodyArchetype": key,
	}


## Port of AvatarSystem3D.tsx BODY_DIMENSIONS lookup. broad/petite (rich-only)
## map onto the nearest legacy bucket so a RichAppearanceConfig bodyArchetype
## still resolves without inventing new legacy rows:
##   broad → stocky (same shoulder bias), petite → slim (smaller frame).
static func body_dimensions(arch: String) -> Dictionary:
	var key := normalize_archetype(arch)
	match key:
		"broad":
			key = "stocky"
		"petite":
			key = "slim"
	if BODY_DIMENSIONS.has(key):
		return (BODY_DIMENSIONS[key] as Dictionary).duplicate()
	return (BODY_DIMENSIONS["average"] as Dictionary).duplicate()


## Collision capsule height/radius derived from proportions — matches the
## 1.8m × 0.35r capsule boot.gd already mounts on CharacterController for the
## average adult, scaled by totalHeight/1.75 so petite/legend stay honest.
static func collision_capsule(arch: String, total_height: float = -1.0) -> Dictionary:
	var p := proportions_for(arch, total_height)
	var h := float(p["totalHeight"])
	var scale := h / 1.75
	return {
		"height": 1.8 * scale,
		"radius": 0.35 * clampf(scale, 0.75, 1.35),
		"totalHeight": h,
	}
