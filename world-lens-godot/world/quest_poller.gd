class_name QuestPoller
extends Node
## QuestPoller — Phase Q (quests). Periodically fetches the local player's
## active quests via the SAME REST route
## `concord-frontend/components/world/QuestTracker.tsx` already polls
## (`GET /api/worlds/:worldId/quests/active`, server/routes/worlds.js:387),
## and the SAME "emit-on-change + slow backstop poll" cadence that
## component's `useRealtimeRefresh` uses as its backstop (`backstopMs =
## 30000` default) — this client has no socket-event-driven quest refresh
## yet, so a plain 30s poll (the backstop's own cadence, not a re-guessed
## number) is the honest first slice, matching the self-timered,
## not-gateway-event-driven posture `npc_poller.gd`/`creature_poller.gd`
## both took for their own first slices.
##
## Zero backend changes needed or made — the route already exists and
## already returns exactly the shape this file consumes.
##
## Consumers (world/wayfinding_markers.gd#quest_pois,
## world/quest_breadcrumb.gd) read the raw quest array via `get_quests()`;
## this file owns fetching + honest parsing only, no POI/text logic — same
## split every other poller in this client keeps.
##
## Honest failure: a failed/malformed poll cycle leaves the previous
## `_quests` snapshot in place (never clears real state on a transient
## error) and emits `poll_failed`. A genuinely empty `quests: []` on a
## *successful* response is a real "no active quests" answer, not a
## failure, and DOES replace the snapshot (an accepted/completed quest
## should disappear from the tracker).

signal poll_succeeded(count: int)
signal poll_failed(reason: String)

## Backend origin — matches `_fea_scene.base_url`/`_npc_poller.base_url`'s
## convention, NOT `frontend_asset_base_url` (reserved for GLB-asset
## serving).
@export var base_url: String = "http://127.0.0.1:5050"
@export var world_id: String = ""
@export var auth_token: String = ""
## Matches QuestTracker.tsx's `useRealtimeRefresh` backstop default
## (`backstopMs = 30000`) — port, don't invent.
@export var poll_interval_sec: float = 30.0

var _timer: Timer = null
var _in_flight: bool = false
var _quests: Array = []


func _ready() -> void:
	_timer = Timer.new()
	_timer.wait_time = poll_interval_sec
	_timer.autostart = true
	_timer.one_shot = false
	add_child(_timer)
	_timer.timeout.connect(_on_timer_timeout)
	# Fire one immediate poll too, so the tracker doesn't wait a full
	# poll_interval_sec after world load to first show anything.
	_poll()


## The most recent successfully-fetched quest snapshot — real server rows,
## verbatim-passed-through per `quests_response_to_quests`. Callers must
## never mutate the returned array in place (duplicate first if needed).
func get_quests() -> Array:
	return _quests


func _on_timer_timeout() -> void:
	_poll()


## Public re-poll trigger — used by quest_actions.gd to refresh immediately
## after a real accept/claim succeeds, rather than reaching into the
## private `_poll()` or waiting up to `poll_interval_sec` for the next
## scheduled cycle.
func poll_now() -> void:
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

	var url := "%s/api/worlds/%s/quests/active" % [base_url, world_id]
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

	var raw: Array = parsed.get("quests", [])
	# Bare-name call, not `QuestPoller.quests_response_to_quests(...)` — the
	# same-class `class_name`-qualified static-call compile bug this session
	# has hit twice already (net/gateway_client.gd's class doc; caught again
	# in npc_poller.gd and creature_rig.gd) — avoided from the start here.
	_quests = quests_response_to_quests(raw)
	poll_succeeded.emit(_quests.size())


## Real `GET /api/worlds/:worldId/quests/active` response.quests
## (server/routes/worlds.js:387, `{...q, progress: getQuestProgress(...)}`
## per quest) -> a verbatim-passthrough-or-drop array. A quest with no real
## `id` is dropped (nothing to key a POI or HUD line on); `progress`
## defaults to `[]` when missing/malformed rather than fabricating
## objective rows — `quest_breadcrumb.gd`/`wayfinding_markers.gd` both
## already treat an empty/absent `progress` as "nothing to show," honestly.
static func quests_response_to_quests(raw: Array) -> Array:
	var out: Array = []
	for q in raw:
		if typeof(q) != TYPE_DICTIONARY:
			continue
		var id := String(q.get("id", ""))
		if id.is_empty():
			continue
		var entry: Dictionary = q.duplicate(true)
		if typeof(entry.get("progress", null)) != TYPE_ARRAY:
			entry["progress"] = []
		out.append(entry)
	return out
