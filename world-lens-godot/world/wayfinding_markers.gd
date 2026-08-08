class_name WayfindingMarkers
extends RefCounted
## WayfindingMarkers — F27 (master-spec "multi-altitude navigation aids:
## ground + air wayfinding markers").
##
## ── Composition, not reinvention ────────────────────────────────────────────
## This unit invents no new geometry math. It combines three ALREADY-REAL,
## already-client-available data sources into one unified point-of-interest
## list, then reuses two already-shipped, already-tested pure-geometry
## modules to turn "player position + a POI" into a marker:
##
##   - Landing pads — `world/scene_bootstrap.gd#get_landing_pads()` (C11/
##     C12), the 3 real authored touch-down markers in
##     content/world/concordia-hub/city-layout.json.
##   - Rooftop-accessible buildings — `world/scene_bootstrap.gd#
##     get_rooftop_buildings()` (F26, this session), real footprint +
##     roofline geometry for every building whose authored `levels` names a
##     `rooftop` entry.
##   - Districts — `world/scene_bootstrap.gd#get_districts()` (C15), the 6
##     real authored district regions; this unit computes each district's
##     real polygon centroid (plain vertex average — the SAME technique
##     server/tests/districts.test.js's own "districts don't overlap at
##     their sampled centers" test already uses to probe a district,
##     generalized here to every district, not just plaza) as its
##     way-finding anchor point.
##
##   - Direction/distance — `conkay/conkay_pointing.gd#direction_to`/
##     `distance_to`/`yaw_pitch_to` (R5/E22), used VERBATIM, not
##     reimplemented. A marker's yaw/pitch is exactly what ConKay's own
##     pointing math would compute if it were asked to face the same
##     target.
##   - Altitude-appropriate fidelity — `world/air_legibility.gd`'s
##     `ALTITUDE_SIMPLIFY_M`/`ALTITUDE_FLATTEN_M` design dials (C15) are
##     read directly (not re-declared) to bucket a marker's `detail_level`
##     the SAME way a district's own rendering simplifies at altitude —
##     "readable from the air" is one design intent, applied here to
##     marker fidelity instead of building-silhouette fidelity.
##
## ── Honest scope ─────────────────────────────────────────────────────────
## This produces the real DATA a wayfinding HUD would render (id, kind,
## name, distance, yaw, pitch, detail_level) — not the HUD itself. Same
## "pure data layer, engine glue is a separate concern" split every other
## data-only module in this client takes (see `world/scene_bootstrap.gd`'s
## placeholder-box posture, or `world/aerial_traffic_controller.gd`'s own
## "no mesh/MultiMesh spawn" note) — there is no real Godot binary
## available in this container to build or verify a rendered compass/
## marker overlay against (docs/GODOT_INTEGRATION.md).

const ConKayPointing := preload("res://conkay/conkay_pointing.gd")
const AirLegibility := preload("res://world/air_legibility.gd")

const KIND_LANDING_PAD := "landing_pad"
const KIND_ROOFTOP := "rooftop"
const KIND_DISTRICT := "district"


## Plain vertex average of a polygon's vertices — the same technique
## `server/tests/districts.test.js`'s own centroid probe uses, generalized
## to any well-shaped boundary array. Pure. Returns `{}` for <3 vertices or
## a malformed boundary (never a guessed centroid).
static func polygon_centroid(boundary: Array) -> Dictionary:
	if boundary.size() < 3:
		return {}
	var sx := 0.0
	var sz := 0.0
	var n := 0
	for v in boundary:
		if typeof(v) != TYPE_DICTIONARY or not (v.has("x") and v.has("z")):
			continue
		sx += float(v["x"])
		sz += float(v["z"])
		n += 1
	if n == 0:
		return {}
	return {"x": sx / float(n), "z": sz / float(n)}


## Maps one real landing-pad entry (`scene_bootstrap.gd#get_landing_pads()`
## shape) to a unified POI. `{}` for a malformed pad — never fabricated.
static func poi_from_landing_pad(pad: Dictionary) -> Dictionary:
	if not (pad.has("position") and pad.has("id")):
		return {}
	var pos = pad["position"]
	if typeof(pos) != TYPE_DICTIONARY or not (pos.has("x") and pos.has("z")):
		return {}
	return {
		"id": String(pad["id"]),
		"kind": KIND_LANDING_PAD,
		"name": String(pad.get("name", pad["id"])),
		"x": float(pos["x"]),
		"z": float(pos["z"]),
		"y": float(pad.get("elevation_m", 0.0)),
	}


## Maps one real rooftop-building entry (`scene_bootstrap.gd#
## get_rooftop_buildings()` shape, F26) to a unified POI. `{}` for a
## malformed entry.
static func poi_from_rooftop_building(building: Dictionary) -> Dictionary:
	if not (building.has("id") and building.has("x") and building.has("z") and building.has("roof_y")):
		return {}
	return {
		"id": String(building["id"]),
		"kind": KIND_ROOFTOP,
		"name": String(building.get("name", building["id"])),
		"x": float(building["x"]),
		"z": float(building["z"]),
		"y": float(building["roof_y"]),
	}


## Maps one real district entry (`scene_bootstrap.gd#get_districts()`
## shape, C15) to a unified POI, anchored at its real polygon centroid.
## `{}` when the district has no id or an unusable boundary.
static func poi_from_district(district: Dictionary) -> Dictionary:
	if not district.has("id"):
		return {}
	var boundary = district.get("boundary", null)
	if typeof(boundary) != TYPE_ARRAY:
		return {}
	var centroid := WayfindingMarkers.polygon_centroid(boundary)
	if centroid.is_empty():
		return {}
	return {
		"id": String(district["id"]),
		"kind": KIND_DISTRICT,
		"name": String(district.get("name", district["id"])),
		"x": float(centroid["x"]),
		"z": float(centroid["z"]),
		"y": float(district.get("elevationHint", 0.0)),
	}


## Combines all three real sources into one unified POI array. Malformed/
## unusable entries from any source are silently dropped (never
## fabricated) rather than failing the whole list.
static func collect_pois(landing_pads: Array, rooftop_buildings: Array, districts: Array) -> Array:
	var out: Array = []
	for pad in landing_pads:
		if typeof(pad) != TYPE_DICTIONARY:
			continue
		var poi := WayfindingMarkers.poi_from_landing_pad(pad)
		if not poi.is_empty():
			out.append(poi)
	for building in rooftop_buildings:
		if typeof(building) != TYPE_DICTIONARY:
			continue
		var poi := WayfindingMarkers.poi_from_rooftop_building(building)
		if not poi.is_empty():
			out.append(poi)
	for district in districts:
		if typeof(district) != TYPE_DICTIONARY:
			continue
		var poi := WayfindingMarkers.poi_from_district(district)
		if not poi.is_empty():
			out.append(poi)
	return out


# ── Phase Q — quest objectives as a 4th POI source ──────────────────────────
#
# Real quest data (GET /api/worlds/:worldId/quests/active — the SAME route
# concord-frontend/components/world/QuestTracker.tsx already polls) has no
# coordinate of its own: an objective's `target` is a semantic id, not a
# position — `talk_to` targets a real authored NPC id (verified against
# content/quests/*.json — e.g. "concordia_first_breath", "gatekeeper_orin"),
# but `kill`/`gather`/`deliver`/`cook` target archetype/item ids with no
# spatial meaning, and `reach_location` targets a semantic location string
# ("first_cycle_glade") that NO location-id-to-position table exists for
# anywhere in this codebase (checked directly, not assumed — server/lib and
# content/world were searched for a resolver and found none). So only
# `talk_to` objectives can be honestly turned into a POI today, by resolving
# the target NPC id against `npc_positions` — the SAME live id->Vector3-like
# dict Phase N's NPC feed already produces (AvatarManager._rigs, keyed by
# the real NPC id). An objective whose target isn't currently a visible NPC
# (not yet spawned, or a non-talk_to type) is honestly OMITTED, never
# guessed. Kill/gather/deliver/reach_location remain in the breadcrumb TEXT
# (players still read "Gather 2 Wildroot") — they just don't get a map pin.

const KIND_QUEST_OBJECTIVE := "quest_objective"


## The first NOT-YET-COMPLETE entry in a quest's `progress` array (the same
## `progress` shape /quests/active returns — each entry a `quest_objectives`
## row joined with `current_count`/`obj_completed_at`), in `order_index`
## order (the route already orders by it). `{}` when every objective is
## complete (nothing left to point at) or `progress` is missing/malformed.
## Mirrors QuestTracker.tsx's `pickBreadcrumb` inner loop exactly — same
## "first incomplete, in given order" rule — so the map pin and the HUD text
## always agree on which objective is "next."
static func next_incomplete_objective(quest: Dictionary) -> Dictionary:
	var progress = quest.get("progress", null)
	if typeof(progress) != TYPE_ARRAY:
		return {}
	for o in progress:
		if typeof(o) != TYPE_DICTIONARY:
			continue
		if not o.get("obj_completed_at", null):
			return o
	return {}


## Maps one quest's next-incomplete `talk_to` objective to a POI, resolved
## against `npc_positions` (id -> Vector3, or any object with .x/.y/.z —
## AvatarRig's own `global_position` works directly). `{}` for every other
## honest reason: objective isn't `talk_to`, quest/objective is malformed,
## or the target NPC isn't currently a live, positioned entity.
static func poi_from_quest_objective(
		quest_id: String, quest_title: String, objective: Dictionary, npc_positions: Dictionary) -> Dictionary:
	if objective.is_empty() or quest_id.is_empty():
		return {}
	if String(objective.get("type", "")) != "talk_to":
		return {}
	var target_id := String(objective.get("target", ""))
	if target_id.is_empty() or not npc_positions.has(target_id):
		return {}
	var pos = npc_positions[target_id]
	var x: float; var y: float; var z: float
	if pos is Vector3:
		x = pos.x; y = pos.y; z = pos.z
	elif typeof(pos) == TYPE_DICTIONARY and pos.has("x") and pos.has("y") and pos.has("z"):
		x = float(pos["x"]); y = float(pos["y"]); z = float(pos["z"])
	else:
		return {}
	var desc := String(objective.get("description", ""))
	return {
		"id": "quest:%s:%s" % [quest_id, String(objective.get("id", target_id))],
		"kind": KIND_QUEST_OBJECTIVE,
		"name": desc if not desc.is_empty() else ("%s — Speak with %s" % [quest_title, target_id]),
		"x": x, "y": y, "z": z,
	}


## The real, ready-to-append quest-objective POI list: one per active quest
## that has a resolvable `talk_to` next-step, honestly empty otherwise.
## `quests` is the raw `/quests/active` array (each `{id, title, progress}`,
## verbatim server shape — malformed entries dropped, nothing fabricated).
static func quest_pois(quests: Array, npc_positions: Dictionary) -> Array:
	var out: Array = []
	for q in quests:
		if typeof(q) != TYPE_DICTIONARY:
			continue
		var qid := String(q.get("id", ""))
		if qid.is_empty():
			continue
		var obj := WayfindingMarkers.next_incomplete_objective(q)
		if obj.is_empty():
			continue
		var poi := WayfindingMarkers.poi_from_quest_objective(qid, String(q.get("title", "")), obj, npc_positions)
		if not poi.is_empty():
			out.append(poi)
	return out


## Altitude-appropriate marker fidelity — reuses `AirLegibility`'s own two
## design dials directly (not re-declared) so "how much detail is legible
## from here" stays defined in exactly one place across the whole client.
## Below ALTITUDE_SIMPLIFY_M: "full" (show the real name). Between
## SIMPLIFY and FLATTEN: "simplified" (name only for the nearest few, an
## icon otherwise — the caller's call, not this module's). At/above
## FLATTEN: "minimal" (a directional pip only).
static func detail_level_for_altitude(altitude_m: float) -> String:
	if altitude_m >= AirLegibility.ALTITUDE_FLATTEN_M:
		return "minimal"
	if altitude_m >= AirLegibility.ALTITUDE_SIMPLIFY_M:
		return "simplified"
	return "full"


## The real directional marker for one POI, from `player_pos`. Direction
## (yaw/pitch) comes verbatim from `ConKayPointing.yaw_pitch_to` — the same
## math ConKay itself uses to face a target — and distance from
## `ConKayPointing.distance_to`. `detail_level` reflects the PLAYER's
## current altitude (how much detail a viewer at this height can
## legitimately resolve), not the POI's own elevation.
static func marker_for_poi(player_pos: Vector3, poi: Dictionary) -> Dictionary:
	var target := Vector3(float(poi.get("x", 0.0)), float(poi.get("y", 0.0)), float(poi.get("z", 0.0)))
	var yaw_pitch := ConKayPointing.yaw_pitch_to(player_pos, target)
	return {
		"id": poi.get("id", ""),
		"kind": poi.get("kind", ""),
		"name": poi.get("name", ""),
		"distance_m": ConKayPointing.distance_to(player_pos, target),
		"yaw": yaw_pitch["yaw"],
		"pitch": yaw_pitch["pitch"],
		"detail_level": WayfindingMarkers.detail_level_for_altitude(player_pos.y),
	}


## The real, ready-to-render marker set: every POI turned into a marker,
## filtered to `max_distance_m`, sorted nearest-first, capped at
## `max_count`. `max_distance_m = INF` (default) means "no distance
## filter" — every POI in range. Never throws on an empty `pois` array.
static func nearby_markers(
		player_pos: Vector3, pois: Array, max_count: int = 5, max_distance_m: float = INF) -> Array:
	var markers: Array = []
	for poi in pois:
		if typeof(poi) != TYPE_DICTIONARY:
			continue
		var marker := WayfindingMarkers.marker_for_poi(player_pos, poi)
		if float(marker["distance_m"]) <= max_distance_m:
			markers.append(marker)

	markers.sort_custom(func(a, b): return float(a["distance_m"]) < float(b["distance_m"]))

	if markers.size() > max_count:
		markers = markers.slice(0, max_count)
	return markers
