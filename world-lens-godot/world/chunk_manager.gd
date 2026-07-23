class_name ChunkManager
extends Node
## ChunkManager — grid-keyed chunk streaming.
##
## Computes the set of chunks that should be loaded around the player and
## diffs it against the currently-tracked "loaded" set to emit load/unload
## requests. The coordinate math (world_to_chunk / chunk_load_set /
## diff_chunk_sets) is PURE STATIC so it is unit-testable without a scene
## tree. Only the actual async scene loading
## (ResourceLoader.load_threaded_request/get_status/get) touches the engine.
##
## CHUNK_SIZE mirrors server/lib/city-presence.js's own `CHUNK_SIZE = 100`
## (metres per chunk edge) so the client's streaming grid lines up with the
## same grid the server already uses to detect chunk-crossing (surfaced as
## `chunkCrossed` on the `player:move:ack` frame — see
## docs/GODOT_INTEGRATION.md's Phase-2 section).
##
## Honest-by-construction: the actual chunk scenes referenced by
## `scene_path_template` do not exist yet in this skeleton. `poll()` reports
## a failed load via `push_warning`, never a fabricated "loaded" chunk.

signal chunk_load_requested(coord: Vector2i, path: String)
signal chunk_unload_requested(coord: Vector2i)
signal chunk_ready(coord: Vector2i, resource: Resource)

const CHUNK_SIZE: float = 100.0
const DEFAULT_LOAD_RADIUS: int = 2  # chunks; square ring around the player's chunk

## Placeholder convention — no chunk scenes exist on disk yet in this
## skeleton (Phase 3+ concern). Overridable so a real asset pipeline can
## point elsewhere without touching this class.
@export var scene_path_template: String = "res://world/chunks/chunk_%d_%d.tscn"

## Vector2i chunk coord -> true, for every chunk considered loaded or in-flight.
var _loaded: Dictionary = {}
## Resource path -> Vector2i, for every threaded load currently in flight.
var _pending_paths: Dictionary = {}


## Recompute the desired chunk set for `player_pos` and emit load/unload
## requests for the diff against what is currently tracked as loaded.
func update(player_pos: Vector3, radius: int = DEFAULT_LOAD_RADIUS) -> void:
	var player_chunk := ChunkManager.world_to_chunk(player_pos, CHUNK_SIZE)
	var desired := ChunkManager.chunk_load_set(player_chunk, radius)
	var diff := ChunkManager.diff_chunk_sets(_loaded.keys(), desired)

	for coord in diff["to_unload"]:
		_loaded.erase(coord)
		chunk_unload_requested.emit(coord)

	for coord in diff["to_load"]:
		_loaded[coord] = true
		var path: String = scene_path_template % [coord.x, coord.y]
		_pending_paths[path] = coord
		chunk_load_requested.emit(coord, path)
		var err := ResourceLoader.load_threaded_request(path)
		if err != OK:
			push_warning("[chunk_manager] load_threaded_request failed for %s: %d" % [path, err])


## Poll in-flight threaded loads. Call once per frame (e.g. from `_process`).
func poll() -> void:
	var done: Array[String] = []
	for path in _pending_paths.keys():
		var status := ResourceLoader.load_threaded_get_status(path)
		match status:
			ResourceLoader.THREAD_LOAD_LOADED:
				var coord: Vector2i = _pending_paths[path]
				var res := ResourceLoader.load_threaded_get(path)
				chunk_ready.emit(coord, res)
				done.append(path)
			ResourceLoader.THREAD_LOAD_FAILED, ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
				push_warning("[chunk_manager] threaded load failed: %s" % path)
				done.append(path)
			_:
				pass  # THREAD_LOAD_IN_PROGRESS — keep waiting.
	for path in done:
		_pending_paths.erase(path)


## Snapshot of coords currently tracked as loaded (loaded or in-flight).
func currently_loaded() -> Array:
	return _loaded.keys()


# ── Pure static coordinate math ──────────────────────────────────────────────

## Map a world position to its integer chunk coordinate. Uses floor
## (not truncation) so negative coordinates bucket toward -infinity the same
## way the server's `Math.floor(coord / CHUNK_SIZE)` does.
static func world_to_chunk(pos: Vector3, chunk_size: float = CHUNK_SIZE) -> Vector2i:
	return Vector2i(int(floor(pos.x / chunk_size)), int(floor(pos.z / chunk_size)))


## Square-ring load set: every chunk coord within Chebyshev distance
## `radius` of `center`. A square ring (rather than a circular radius) is a
## deliberately cheap streaming-grid convention — it avoids popping corner
## chunks in/out at a different distance than edge chunks. Negative radius
## yields an empty set (never throws).
static func chunk_load_set(center: Vector2i, radius: int) -> Array:
	var out: Array = []
	if radius < 0:
		return out
	for dx in range(-radius, radius + 1):
		for dz in range(-radius, radius + 1):
			out.append(Vector2i(center.x + dx, center.y + dz))
	return out


## Diff two chunk-coord arrays. Returns
## `{ "to_load": Array[Vector2i], "to_unload": Array[Vector2i] }`.
static func diff_chunk_sets(current: Array, desired: Array) -> Dictionary:
	var current_set := {}
	for c in current:
		current_set[c] = true
	var desired_set := {}
	for d in desired:
		desired_set[d] = true

	var to_load: Array = []
	for d in desired:
		if not current_set.has(d):
			to_load.append(d)

	var to_unload: Array = []
	for c in current:
		if not desired_set.has(c):
			to_unload.append(c)

	return {"to_load": to_load, "to_unload": to_unload}
