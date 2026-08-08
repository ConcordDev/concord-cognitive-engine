class_name CreaturePoller
extends Node
## CreaturePoller — Phase M3 (creature spawner). Feeds live creature
## positions into `creature_manager.gd` via the existing, already-working
## `creatures.for_world` macro — zero backend changes needed for this unit.
##
## ── Why POST /api/lens/run, not GET /api/worlds/:worldId/npcs ───────────────
## `server/domains/creatures.js#for_world` reads `world_npcs` rows with
## `archetype LIKE 'creature:%'` straight off their dedicated `x`/`y`/`z`
## columns (migration 185). Phase N's NPC route (`GET /api/worlds/:worldId
## /npcs`) parses position from the OLDER `current_location` JSON column
## instead — a column `creatures.for_world`'s own writers (fauna-spawner.js/
## creature-behaviors.js) never touch — so creature rows through THAT route
## would render at an undefined position. `creatures.for_world` is reached
## through the macro dispatch envelope instead:
## `POST /api/lens/run {domain:"creatures", name:"for_world",
## input:{worldId, limit}}` — the SAME call
## `concord-frontend/lib/world-lens/creature-renderer.ts` already makes every
## 4 seconds (`pollMs` default 4000) — ported here, not invented.
##
## ── The double-`ok` envelope ─────────────────────────────────────────────────
## `/api/lens/run` wraps a MACROS-table handler's raw return in
## `{ok:true, result:<raw>}` (server.js's `/api/lens/run` route,
## `_unwrapLensEnvelope` only strips a nesting the handler introduced itself,
## which `creatures.for_world` does not — it returns `{ok, creatures, count}`
## directly). So the real wire shape is
## `{ok:true, result:{ok:true, creatures:[...], count}}` — BOTH `ok` flags
## must be checked; trusting only the outer one would silently treat a
## macro-level failure (`result.ok === false`) as success.
##
## ── No heading field ──────────────────────────────────────────────────────
## `for_world`'s creature objects carry no rotation/heading/direction field
## at all (confirmed by reading the handler) — an honest absence, not a bug:
## `creature_rig.gd` faces a fixed default orientation rather than
## fabricating one.

signal poll_succeeded(count: int)
signal poll_failed(reason: String)

## Backend origin (matches npc_poller.gd's own convention — data fetch, not
## asset serving; see creature_manager.gd for the separate frontend-origin
## `base_url` its spawned CreatureRigs resolve GLBs against).
@export var base_url: String = "http://127.0.0.1:5050"
@export var world_id: String = ""
@export var auth_token: String = ""
## Mirrors creature-renderer.ts's own tuned `pollMs` (4000ms) — port, don't
## invent, same reasoning npc_poller.gd's header gives for its 10s interval.
@export var poll_interval_sec: float = 4.0
@export var limit: int = 500

## Injected CreatureManager (world/creature_manager.gd) — DI slot, same
## convention as npc_poller.gd's `avatar_manager` slot.
var creature_manager: Node = null

var _timer: Timer = null
var _in_flight: bool = false


func _ready() -> void:
	_timer = Timer.new()
	_timer.wait_time = poll_interval_sec
	_timer.autostart = true
	_timer.one_shot = false
	add_child(_timer)
	_timer.timeout.connect(_on_timer_timeout)
	_poll()


func _on_timer_timeout() -> void:
	_poll()


func _poll() -> void:
	if _in_flight or world_id.is_empty():
		return
	_in_flight = true

	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_request_completed.bind(req))

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth_token != "":
		headers.append("Authorization: Bearer %s" % auth_token)

	var body := JSON.stringify(build_for_world_request_body(world_id, limit))
	var err := req.request("%s/api/lens/run" % base_url, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		req.queue_free()
		_in_flight = false
		poll_failed.emit("request_error_%d" % err)


func _on_request_completed(
		result: int, code: int, _headers: PackedStringArray,
		response_body: PackedByteArray, req: HTTPRequest) -> void:
	req.queue_free()
	_in_flight = false

	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		poll_failed.emit("http_%d_%d" % [result, code])
		return

	var parsed = JSON.parse_string(response_body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY or not bool(parsed.get("ok", false)):
		poll_failed.emit("malformed_response")
		return

	var inner = parsed.get("result", {})
	var inner_dict: Dictionary = inner if typeof(inner) == TYPE_DICTIONARY else {}
	if not bool(inner_dict.get("ok", false)):
		# The outer envelope said ok:true, but the macro's OWN result did not
		# — a real macro-level failure (e.g. missing_world_id/no_db). Honest
		# skip, not a fabricated success.
		poll_failed.emit("macro_failed_%s" % String(inner_dict.get("reason", "unknown")))
		return

	var creatures: Array = inner_dict.get("creatures", [])
	var entities := creatures_array_to_entities(creatures)
	if entities.is_empty() and not creatures.is_empty():
		poll_failed.emit("all_entries_malformed")
		return

	if creature_manager != null and creature_manager.has_method("ingest_snapshot") and not entities.is_empty():
		creature_manager.ingest_snapshot(Time.get_ticks_msec(), entities, "creature")
	# A genuinely empty world is real data, not a failure.
	poll_succeeded.emit(entities.size())


## Body for `POST /api/lens/run` — the exact envelope every macro call in
## this codebase uses. Mirrors `DtuPropRenderer.build_list_request_body`.
static func build_for_world_request_body(world_id: String, limit: int = 500) -> Dictionary:
	return {"domain": "creatures", "name": "for_world", "input": {"worldId": world_id, "limit": limit}}


## Real `creatures.for_world` response.result.creatures
## (server/domains/creatures.js:176) -> the Dictionary-keyed-by-id shape
## CreatureManager.ingest_snapshot expects. Flat x/y/z (no nested `position`
## object, unlike the NPC case) — drops blank-id/non-Dictionary entries,
## never fabricates. `topology` defaults to "quadruped" (a real, covered
## topology — see creature_rig.gd's REAL_ASSET_TOPOLOGIES) rather than an
## empty string, which would otherwise honestly-but-uselessly degrade every
## malformed entry straight to the placeholder.
static func creatures_array_to_entities(creatures: Array) -> Dictionary:
	var out := {}
	for c in creatures:
		if typeof(c) != TYPE_DICTIONARY:
			continue
		var id := String(c.get("id", ""))
		if id.is_empty():
			continue
		out[id] = {
			"x": float(c.get("x", 0.0)),
			"y": float(c.get("y", 0.0)),
			"z": float(c.get("z", 0.0)),
			"topology": String(c.get("topology", "quadruped")),
			"species_id": String(c.get("species_id", "")),
			"coatColor": String(c.get("coatColor", "")),
		}
	return out
