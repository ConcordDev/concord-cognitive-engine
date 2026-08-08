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
## Phase Q — quest-objective POIs, held SEPARATELY from `_pois`. Landing
## pads/rooftops/districts only change on a fresh `scene:data` (rare —
## `wire_sources` is the right place to recompute those); quest state and
## NPC positions change independently and far more often (quest_poller.gd's
## 30s poll, avatar_manager.gd's live rig positions), so recomputing this
## subset on its own cadence via `set_quest_pois` avoids re-running the
## pad/rooftop/district work on every quest tick for no reason.
var _quest_pois: Array = []


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


## Phase Q — recomputes just the quest-objective POI subset from a real
## quest snapshot (`world/quest_poller.gd#get_quests()`) and real live NPC
## positions (`avatar/avatar_manager.gd#npc_positions_snapshot()`). Callers
## re-invoke this on their own cadence (a quest poll landing, an NPC
## despawning) — see the class-level comment on `_quest_pois` for why this
## is split from `wire_sources`.
func set_quest_pois(quests: Array, npc_positions: Dictionary) -> void:
	_quest_pois = WayfindingMarkers.quest_pois(quests, npc_positions)


## The real, ready-to-render marker set for `player_pos` — see
## `WayfindingMarkers.nearby_markers` for the full contract. A future HUD
## calls this once per frame (or on a slower timer) with the player's real
## world position; nothing here spawns UI (see class doc on
## `world/wayfinding_markers.gd`).
func markers_for(player_pos: Vector3, max_count: int = 5, max_distance_m: float = INF) -> Array:
	return WayfindingMarkers.nearby_markers(player_pos, _pois + _quest_pois, max_count, max_distance_m)


func poi_count() -> int:
	return _pois.size() + _quest_pois.size()
