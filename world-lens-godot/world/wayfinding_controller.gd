class_name WayfindingController
extends Node
## WayfindingController — F27 thin engine-glue wrapper around
## `world/wayfinding_markers.gd`'s pure functions, mirroring every sibling
## controller's own DI convention (`wire_landing_pads_from_scene_bootstrap`,
## `wire_from_scene_bootstrap`). All real logic lives in the pure static
## module; this file only owns pulling the three real data sources from a
## live `SceneBootstrap`/`RooftopAccessController` and re-exposing them as
## one call a HUD would make each frame.

const WayfindingMarkers := preload("res://world/wayfinding_markers.gd")

var _pois: Array = []


## One-line DI hookup — pulls landing pads + districts (both already parsed
## by `scene_bootstrap`) and rooftop-accessible buildings (already parsed
## by `rooftop_controller`, F26) into one unified POI list. Call again
## whenever a fresh `scene:data` has landed (the same lifecycle every
## sibling `wire_*_from_scene_bootstrap` method already follows).
func wire_sources(scene_bootstrap: Node, rooftop_controller: Node) -> void:
	var landing_pads: Array = []
	var districts: Array = []
	var rooftop_buildings: Array = []
	if scene_bootstrap != null:
		if scene_bootstrap.has_method("get_landing_pads"):
			landing_pads = scene_bootstrap.get_landing_pads()
		if scene_bootstrap.has_method("get_districts"):
			districts = scene_bootstrap.get_districts()
	if rooftop_controller != null and "rooftop_buildings" in rooftop_controller:
		rooftop_buildings = rooftop_controller.rooftop_buildings

	_pois = WayfindingMarkers.collect_pois(landing_pads, rooftop_buildings, districts)


## The real, ready-to-render marker set for `player_pos` — see
## `WayfindingMarkers.nearby_markers` for the full contract. A future HUD
## calls this once per frame (or on a slower timer) with the player's real
## world position; nothing here spawns UI (see class doc on
## `world/wayfinding_markers.gd`).
func markers_for(player_pos: Vector3, max_count: int = 5, max_distance_m: float = INF) -> Array:
	return WayfindingMarkers.nearby_markers(player_pos, _pois, max_count, max_distance_m)


func poi_count() -> int:
	return _pois.size()
