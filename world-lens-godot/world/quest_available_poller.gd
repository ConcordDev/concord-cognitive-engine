class_name QuestAvailablePoller
extends Node
## QuestAvailablePoller — Quest interaction slice (2026-08-08). Polls
## `GET /api/worlds/:worldId/quests?status=available` — a DIFFERENT real
## route from `quest_poller.gd`'s `/quests/active` (that one reads
## `getActiveQuests`/`getQuestProgress` against the real `quest_objectives`/
## `player_quest_progress` tables; this one reads `getWorldQuests` against
## `world_quests`'s own `objectives_json`/`reward_json` blob columns — two
## real, distinct representations of the same underlying quest system, not
## a bug). This poller exists ONLY to discover quests a player could
## `accept` — `world_quests.status='available'` rows the player hasn't
## taken yet. It does NOT surface per-objective progress (that's what
## QuestPoller is for); `world/quest_actions.gd` composes both.
##
## Cadence 60s (available quests change far less often than active-quest
## progress) — a deliberately different cadence from QuestPoller's 30s, not
## a copy-paste oversight.
##
## Run (needs an already-running real server + a real bearer token — same
## division of labor as every other poller in this directory):
##   base_url / world_id / auth_token exported, mount + add_child, then read
##   get_available_quests().

signal poll_succeeded(count: int)
signal poll_failed(reason: String)

@export var base_url: String = "http://127.0.0.1:5050"
@export var world_id: String = "concordia-hub"
@export var auth_token: String = ""
@export var poll_interval_sec: float = 60.0

var _timer: Timer
var _in_flight: bool = false
var _quests: Array = []


func _ready() -> void:
	_timer = Timer.new()
	_timer.wait_time = poll_interval_sec
	_timer.autostart = true
	_timer.timeout.connect(_poll)
	add_child(_timer)
	_poll()


func get_available_quests() -> Array:
	return _quests


## Public re-poll trigger — see quest_poller.gd's `poll_now()` for why this
## exists (quest_actions.gd calls it after a real accept succeeds).
func poll_now() -> void:
	_poll()


func _poll() -> void:
	if _in_flight:
		return
	_in_flight = true

	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_completed.bind(req))

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth_token != "":
		headers.append("Authorization: Bearer %s" % auth_token)

	var url := "%s/api/worlds/%s/quests?status=available" % [base_url, world_id]
	var err := req.request(url, headers, HTTPClient.METHOD_GET)
	if err != OK:
		req.queue_free()
		_in_flight = false
		poll_failed.emit("request_error_%d" % err)


func _on_completed(
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

	var raw = parsed.get("quests", null)
	if typeof(raw) != TYPE_ARRAY:
		poll_failed.emit("malformed_response")
		return

	_quests = QuestAvailablePoller.quests_response_to_quests(raw)
	poll_succeeded.emit(_quests.size())


## Verbatim-passthrough-or-drop, mirroring quest_poller.gd's
## `quests_response_to_quests` discipline: keep any Dictionary entry with a
## real non-blank `id`; never fabricate a missing field.
static func quests_response_to_quests(raw: Array) -> Array:
	var out: Array = []
	for q in raw:
		if typeof(q) != TYPE_DICTIONARY:
			continue
		var id := String(q.get("id", ""))
		if id.is_empty():
			continue
		out.append(q)
	return out
