class_name QuestActions
extends Node
## QuestActions — Quest interaction slice (2026-08-08). Wires the existing,
## already-real `/:worldId/quests/:questId/{accept,complete,claim-reward}`
## routes (server/routes/worlds.js) through a single context-sensitive K-key
## interaction, deliberately scoped to ONE action at a time rather than a
## full quest-log/dialogue UI:
##   - an ALREADY-ACCEPTED quest with every objective done -> claim reward
##   - NO active quests at all, but a real offerable quest exists -> accept
##     the first one
##   - anything else (mid-quest, nothing offered) -> honest no-op
##
## `resolve_action` is pure and unit-testable (no HTTP/scene-tree
## dependency); `try_action()` is the thin dispatcher that actually POSTs.
## Reuses `QuestBreadcrumb.quest_all_done` rather than re-deriving the same
## rule a second time.
##
## Deliberately does NOT build a quest-giver-NPC dialogue/offer UI — that's
## real, separate follow-up scope (see VISUAL_QA.md). "Accept" here always
## means "the single first available quest, by the poller's own listing
## order" — an honest, minimal first slice, not a claim that NPC-driven
## quest offers are wired.

signal action_succeeded(kind: String, quest_id: String, result: Dictionary)
signal action_failed(kind: String, quest_id: String, reason: String)

const QuestBreadcrumb := preload("res://world/quest_breadcrumb.gd")

@export var base_url: String = "http://127.0.0.1:5050"
@export var world_id: String = "concordia-hub"
@export var auth_token: String = ""

## Injected pollers (DI, matching this client's established convention).
## Null-safe: `try_action()` no-ops honestly with neither wired.
@export var quest_poller: Node = null
@export var available_poller: Node = null

var _in_flight: bool = false


## Decide what the K-key should do right now. Pure — no HTTP, no scene
## tree, testable with plain Arrays. Returns `{}` (never a fabricated
## action) when there is genuinely nothing to do.
static func resolve_action(active_quests: Array, available_quests: Array) -> Dictionary:
	for q in active_quests:
		if typeof(q) != TYPE_DICTIONARY:
			continue
		if QuestBreadcrumb.quest_all_done(q):
			return {
				"kind": "claim",
				"questId": String(q.get("id", "")),
				"label": "Claim Reward: %s" % String(q.get("title", "Quest")),
			}

	if active_quests.is_empty():
		for q in available_quests:
			if typeof(q) != TYPE_DICTIONARY:
				continue
			var id := String(q.get("id", ""))
			if id.is_empty():
				continue
			return {
				"kind": "accept",
				"questId": id,
				"label": "Accept: %s" % String(q.get("title", "Quest")),
			}

	return {}


## Compute the current action (from the two injected pollers) and dispatch
## the matching POST. Honest no-op when no pollers are wired, or when
## `resolve_action` finds nothing to do, or while a prior request is still
## in flight (never double-fires).
func try_action() -> void:
	if _in_flight:
		return
	if quest_poller == null or not quest_poller.has_method("get_quests"):
		return
	if available_poller == null or not available_poller.has_method("get_available_quests"):
		return

	var active: Array = quest_poller.get_quests()
	var available: Array = available_poller.get_available_quests()
	var action := QuestActions.resolve_action(active, available)
	if action.is_empty():
		return

	var kind := String(action["kind"])
	var quest_id := String(action["questId"])
	var path := "accept" if kind == "accept" else "claim-reward"
	_post(kind, quest_id, path)


func _post(kind: String, quest_id: String, path: String) -> void:
	_in_flight = true

	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_completed.bind(req, kind, quest_id))

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth_token != "":
		headers.append("Authorization: Bearer %s" % auth_token)

	var url := "%s/api/worlds/%s/quests/%s/%s" % [base_url, world_id, quest_id, path]
	var err := req.request(url, headers, HTTPClient.METHOD_POST, "{}")
	if err != OK:
		req.queue_free()
		_in_flight = false
		action_failed.emit(kind, quest_id, "request_error_%d" % err)


func _on_completed(
		result: int, code: int, _headers: PackedStringArray,
		response_body: PackedByteArray, req: HTTPRequest, kind: String, quest_id: String) -> void:
	req.queue_free()
	_in_flight = false

	if result != HTTPRequest.RESULT_SUCCESS:
		action_failed.emit(kind, quest_id, "http_transport_%d" % result)
		return

	var parsed = JSON.parse_string(response_body.get_string_from_utf8())
	var ok := typeof(parsed) == TYPE_DICTIONARY and bool(parsed.get("ok", false))
	if code != 200 or not ok:
		var reason := "http_%d" % code
		if typeof(parsed) == TYPE_DICTIONARY and parsed.has("error"):
			reason = String(parsed["error"])
		action_failed.emit(kind, quest_id, reason)
		return

	action_succeeded.emit(kind, quest_id, parsed)
