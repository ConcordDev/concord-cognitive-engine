class_name NpcPoller
extends Node
## NpcPoller — Phase N (NPC visibility). Renders the "authored" NPC
## population (`world_npcs` DB table, driven by server/lib/npc-simulator.js)
## into the world via a periodic REST poll, feeding the exact same
## avatar/avatar_manager.gd pipeline remote players already use.
##
## ── Why REST, not a broadcast ────────────────────────────────────────────────
## `city:npcs` (the one broadcast that could have carried live NPC positions)
## was deliberately RETIRED server-side (server/lib/city-presence.js, "DET-C
## batch 8 investigation, 2026-07-23") — not for staleness/cost/correctness,
## but because it had ZERO consumers on every transport: the Three.js
## frontend never subscribed to it (it polls a REST route instead — see
## below), and this client's own AvatarManager.ingest_snapshot() was shaped
## for the payload but never wired to a dispatch case. Reviving it, or
## building a new purpose-built broadcast, would both be new backend
## surface for something that already has a working, already-used answer:
## `GET /api/worlds/:worldId/npcs` (server/routes/worlds.js:855), the EXACT
## route the Three.js client already polls every 10s
## (concord-frontend/app/lenses/world/page.tsx's
## `useSmartPolling(loadNPCs, 10_000, ...)`). This poller ports that same
## design — same route, same cadence — rather than inventing a new one.
## Zero backend changes were needed for this unit.
##
## ── Scope: the "authored" population only ────────────────────────────────────
## `world_npcs` is a SEPARATE population from the small, mechanic-spawned
## patrol NPCs `city-presence.js`'s `_npcState` still simulates (unaffected
## by the `city:npcs` retirement, ticked every 1000ms) — that population has
## zero REST exposure and stays fully unaddressed by this file. Do not
## conflate the two; `_npcState` is not read here at all.
##
## ── Pipeline reuse ────────────────────────────────────────────────────────────
## `AvatarManager` is already kind-agnostic (`_spawn_rig` already branches on
## `kind == "player"` vs everything else) — feeding NPCs through
## `ingest_snapshot(now_ms, entities, "npc")` gets the full existing rig/GLB/
## weapon(Phase M1)/outline(Phase S1-S3)/interpolation stack for free. No new
## render path exists in this file; it is a feed, not a renderer.
##
## ── Honest failure ────────────────────────────────────────────────────────────
## A failed/malformed poll cycle is skipped — never fabricates NPC positions
## and never despawns existing NPCs on a bad cycle (AvatarManager's own
## stale-timeout, not this file, is what eventually ages out an id that
## really did stop being reported). An empty `npcs: []` on a *successful*
## response is a real "no NPCs right now" answer, not a failure.

signal poll_succeeded(count: int)
signal poll_failed(reason: String)

## Backend origin (NOT frontend_asset_base_url, which is reserved for
## GLB-asset serving — see world/boot.gd's own comment on `_avatar_manager
## .base_url` for why conflating the two was a real, previously-fixed bug).
## Matches `_fea_scene.base_url`'s convention, the other component in this
## tree that does a real authenticated backend REST fetch.
@export var base_url: String = "http://127.0.0.1:5050"
@export var world_id: String = ""
@export var auth_token: String = ""
## Mirrors the Three.js client's own already-tuned interval
## (`useSmartPolling(loadNPCs, 10_000, ...)`) — port, don't invent.
@export var poll_interval_sec: float = 10.0

## Injected AvatarManager (avatar/avatar_manager.gd), same DI convention as
## player/character_controller.gd's `avatar_manager` slot — set externally
## by world/boot.gd after construction, never preloaded/instantiated here.
var avatar_manager: Node = null

var _timer: Timer = null
var _in_flight: bool = false


func _ready() -> void:
	_timer = Timer.new()
	_timer.wait_time = poll_interval_sec
	_timer.autostart = true
	_timer.one_shot = false
	add_child(_timer)
	_timer.timeout.connect(_on_timer_timeout)
	# Fire one immediate poll too, so NPCs don't wait a full poll_interval_sec
	# after world load to first appear.
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

	var url := "%s/api/worlds/%s/npcs" % [base_url, world_id]
	var err := req.request(url, headers, HTTPClient.METHOD_GET)
	if err != OK:
		req.queue_free()
		_in_flight = false
		poll_failed.emit("request_error_%d" % err)


func _on_request_completed(
		result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray, req: HTTPRequest) -> void:
	req.queue_free()
	_in_flight = false

	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		poll_failed.emit("http_%d_%d" % [result, code])
		return

	var parsed = JSON.parse_string(body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY or not bool(parsed.get("ok", false)):
		poll_failed.emit("malformed_response")
		return

	var npcs: Array = parsed.get("npcs", [])
	# Bare-name call, not `NpcPoller.npcs_array_to_entities(...)` — calling a
	# same-class static func via its own `class_name` prefix from inside its
	# own file is a real, engine-reproduced "Identifier not found" bug on
	# incremental reload (see net/gateway_client.gd's class doc for the full
	# finding). Functionally identical, immune to the reload ordering issue.
	var entities := npcs_array_to_entities(npcs)
	if entities.is_empty() and not npcs.is_empty():
		# Every entry was malformed — an honest "nothing usable this cycle,"
		# not a crash and not a silent fabricated success.
		poll_failed.emit("all_entries_malformed")
		return

	if avatar_manager != null and avatar_manager.has_method("ingest_snapshot") and not entities.is_empty():
		avatar_manager.ingest_snapshot(Time.get_ticks_msec(), entities, "npc")
	# A genuinely empty world (or every NPC momentarily filtered by the
	# server's own `is_dead = 0` clause) is real data, not a failure.
	poll_succeeded.emit(entities.size())


## Real `GET /api/worlds/:worldId/npcs` response.npcs (server/routes/
## worlds.js:855) -> the Dictionary-keyed-by-id shape
## AvatarManager.ingest_snapshot expects — the REST analogue of
## world/boot.gd#users_array_to_dict's existing `city:positions` translator,
## same "drop malformed/blank-id entries, never fabricate" discipline. The
## route has no `action`/`currentAnimation`/`locomotion` field (its
## `currentActivity` is a semantic label like "working", not an animation
## state `AnimationStateMachine` understands) — left absent on purpose, so
## NPCs animate off pure velocity inference, matching what AvatarManager's
## own class doc already documents for the pre-retirement `city:npcs` case.
static func npcs_array_to_entities(npcs: Array) -> Dictionary:
	var out := {}
	for n in npcs:
		if typeof(n) != TYPE_DICTIONARY:
			continue
		var id := String(n.get("id", ""))
		if id.is_empty():
			continue
		var pos = n.get("position", {})
		var pos_dict: Dictionary = pos if typeof(pos) == TYPE_DICTIONARY else {}
		out[id] = {
			"x": float(pos_dict.get("x", 0.0)),
			"y": float(pos_dict.get("y", 0.0)),
			"z": float(pos_dict.get("z", 0.0)),
			"rotation": float(n.get("rotation", 0.0)),
		}
	return out
