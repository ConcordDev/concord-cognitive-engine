class_name RooftopAccessController
extends Node
## RooftopAccessController — F26 (master-spec "rooftop as first-class
## space").
##
## ── What already existed before this unit ──────────────────────────────────
## Building verticality was ALREADY modeled in the authored data: every
## entry in `content/world/concordia-hub/city-layout.json`'s `buildings`
## array carries a `levels` object (e.g. `{"ground": "...", "mid": "..."}`),
## and "station-observatory" already authors a third level,
## `"rooftop": "The Observatory — rooftop deck."`. That field was already
## threaded server-side through `server/lib/building-purpose.js#
## buildingPurposeForType` into `server/lib/scene-export.js`'s
## `extras.levels` on every `concord-scene/v1` node — but nothing on the
## client ever READ it. A rooftop was a text description with no
## reachability or interaction hook: real data, zero consumer. This unit is
## that consumer.
##
## ── Composition, not reinvention ────────────────────────────────────────────
## `world/scene_bootstrap.gd#parse_rooftop_buildings` (added alongside this
## unit) does the wire-parsing — reducing `scene:data.nodes` down to the
## rooftop-tagged subset with real footprint + roofline geometry already
## computed. This controller only owns the GAMEPLAY decision on top of that
## real geometry: "is the player currently standing on one of these
## roofs," reusing `avatar/land_air_transition_controller.gd`'s
## landing-pad-proximity pattern (a real target zone + a state-transition
## signal pair) adapted from a circular pad at a fixed elevation to a
## rectangular building footprint plus a roofline height band.
##
## `nearest_rooftop_building` mirrors `land_air_transition_controller.gd#
## nearest_landing_pad`'s exact call shape (closest by horizontal distance,
## `{}` for none) on purpose — F27's `world/wayfinding_markers.gd` reuses
## it so a rooftop points at the same as any other real point of interest.
##
## ── Honest scope: reachability + a real event hook, not a UI ───────────────
## This controller makes the rooftop a genuine reachable, detectable space
## (a flight-capable player who lands on the Observatory's roof gets a
## real `rooftop_entered` signal carrying the building's real id/name/
## lens/purpose) and stops there — same "data layer is real, rendering the
## resulting UI/interaction-menu is a separate concern with no engine here
## to verify it against" posture as `world/air_legibility.gd`'s own header.
## A future unit would connect `rooftop_entered` to whatever prompt/menu
## surface the client eventually builds (the Three.js web client's
## `StationInteractionRouter` is the closest existing analog — see
## CLAUDE.md's "Building interaction is proximity-gated via DA2 router").

signal rooftop_entered(building: Dictionary)
signal rooftop_exited(building: Dictionary)

## Vertical tolerance for "standing on the roof" — the player's altitude
## must be within this many meters of the building's real roofline
## (translation.y + scale.y) to count as landed-on-roof rather than flying
## past it or still climbing toward it. REASONED ADDITION (client-feel
## only, no TS/JS/server source to cite — same honest posture as
## `land_air_transition_controller.gd`'s own ASCEND_LAUNCH_THRESHOLD_MS):
## a real avatar's vertical extent (~1.8m) plus a small margin for
## landing-frame jitter.
const STANDING_TOLERANCE_M: float = 2.0

## Real per-building rooftop descriptors from the most recent scene:data —
## see `wire_from_scene_bootstrap`. Empty by default (an unwired controller
## never fabricates a rooftop).
var rooftop_buildings: Array = []

var _on_rooftop: bool = false
var _current_building_id: String = ""


## One-line DI hookup, same convention as `land_air_transition_controller.
## gd#wire_landing_pads_from_scene_bootstrap` — pulls the real rooftop-
## tagged buildings a `scene:request` already delivered, once
## `scene_bootstrap.gd` (extended by this unit) has parsed them.
func wire_from_scene_bootstrap(bootstrap: Node) -> void:
	if bootstrap != null and bootstrap.has_method("get_rooftop_buildings"):
		rooftop_buildings = bootstrap.get_rooftop_buildings()


## Call once per frame (or per physics tick) with the player's/avatar's
## real world position. Emits `rooftop_entered`/`rooftop_exited` exactly on
## a state transition — never re-fires every frame while already standing
## on the same roof, and correctly re-fires `rooftop_entered` if the
## player jumps directly from one rooftop to another without leaving
## rooftop-state in between.
func update(position: Vector3) -> void:
	var state := RooftopAccessController.rooftop_state(
		position, rooftop_buildings, STANDING_TOLERANCE_M)
	var now_on: bool = state["on_rooftop"]
	var building: Dictionary = state["building"]
	var building_id := String(building.get("id", ""))

	if now_on and (not _on_rooftop or building_id != _current_building_id):
		_on_rooftop = true
		_current_building_id = building_id
		rooftop_entered.emit(building)
	elif not now_on and _on_rooftop:
		var left := {"id": _current_building_id}
		_on_rooftop = false
		_current_building_id = ""
		rooftop_exited.emit(left)


# ── Pure static helpers (no engine calls beyond Vector3/Dictionary math;
#    tested without a scene tree — tests/test_rooftop_access_controller.gd) ──

## Horizontal AABB test — is (x, z) within this rooftop building's real
## footprint (`half_w`/`half_d`, from `scene_bootstrap.gd#
## parse_rooftop_buildings`)? A malformed/degenerate building (missing
## fields, or a non-positive half-extent) is honestly "not over it," never
## a crash or a guessed footprint.
static func is_over_footprint(x: float, z: float, building: Dictionary) -> bool:
	var has_fields := (
		building.has("x") and building.has("z")
		and building.has("half_w") and building.has("half_d"))
	if not has_fields:
		return false
	var hw := float(building["half_w"])
	var hd := float(building["half_d"])
	if hw <= 0.0 or hd <= 0.0:
		return false
	var bx := float(building["x"])
	var bz := float(building["z"])
	return absf(x - bx) <= hw and absf(z - bz) <= hd


## The real rooftop-occupancy state for `position` against the known
## rooftop-accessible buildings: on the roof requires BOTH standing over
## the real footprint (horizontal, `is_over_footprint`) AND altitude
## within `standing_tolerance_m` of the real roofline height (vertical) —
## landed ON the roof, not merely flying past it or standing in the
## building's interior below it. Returns the first matching building
## (buildings don't overlap footprints by construction) or an honest
## `{on_rooftop: false, building: {}}`.
static func rooftop_state(
		position: Vector3, buildings: Array, standing_tolerance_m: float) -> Dictionary:
	for b in buildings:
		if typeof(b) != TYPE_DICTIONARY:
			continue
		if not RooftopAccessController.is_over_footprint(position.x, position.z, b):
			continue
		var roof_y := float(b.get("roof_y", 0.0))
		if absf(position.y - roof_y) <= standing_tolerance_m:
			return {"on_rooftop": true, "building": b}
	return {"on_rooftop": false, "building": {}}


## Nearest rooftop-accessible building to `position` (horizontal-only
## distance, matching `land_air_transition_controller.gd#
## nearest_landing_pad`'s exact convention) — reused by F27's wayfinding
## markers, or for a "closest roof" HUD prompt. `{}` when `buildings` is
## empty or entirely malformed.
static func nearest_rooftop_building(position: Vector3, buildings: Array) -> Dictionary:
	var best: Dictionary = {}
	var best_dist_sq: float = INF
	for b in buildings:
		if typeof(b) != TYPE_DICTIONARY or not (b.has("x") and b.has("z")):
			continue
		var dx: float = position.x - float(b["x"])
		var dz: float = position.z - float(b["z"])
		var dist_sq: float = dx * dx + dz * dz
		if dist_sq < best_dist_sq:
			best_dist_sq = dist_sq
			best = b
	return best
