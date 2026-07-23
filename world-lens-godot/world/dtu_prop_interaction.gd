class_name DtuPropInteraction
extends Node
## DtuPropInteraction — master-spec §3.3 (units B6-B9): raycast-select a
## DTU-prop node spawned by DtuPropRenderer and dispatch a real
## inspect/take/leave/arrange call to the backend (`dtu_props.interact`
## macro via `POST /api/lens/run`).
##
## Selection walks up the clicked collider's ancestor chain looking for the
## `dtu_id` metadata DtuPropRenderer stamps on each prop's holder node — this
## walk (`find_prop_ancestor`) is a pure function over plain Node references,
## so it's unit-testable without a physics/camera setup. The actual raycast
## (`_process`/`_unhandled_input` querying `get_viewport().world_3d`) is the
## only engine-dependent part.
##
## Honest handling: every interact response is forwarded verbatim via
## `interacted`/`interact_failed` — an `{ok:false, reason:...}` from the
## server is never reinterpreted as success.
##
## STATUS: parse/lint validated only — see VISUAL_QA.md and the STATUS note
## in dtu_prop_renderer.gd (this also needs the `dtu_props` macro domain
## wired server-side to do anything beyond an honest HTTP error).

signal prop_selected(dtu_id: String, title: String)
signal interacted(dtu_id: String, action: String, result: Dictionary)
signal interact_failed(dtu_id: String, action: String, reason: String)

@export var base_url: String = "http://127.0.0.1:5050"
@export var auth_token: String = ""
@export var camera_path: NodePath

var _camera: Camera3D
var _selected_dtu_id: String = ""
var _selected_title: String = ""


func _ready() -> void:
	if camera_path != NodePath():
		_camera = get_node_or_null(camera_path)


## Call from an `_unhandled_input(event)` handler with a mouse-click event.
## Performs a physics raycast from the camera through the click position and
## selects the DTU prop hit, if any. No-ops honestly if no camera is wired.
func handle_click(event: InputEventMouseButton) -> void:
	if _camera == null or not event.pressed:
		return
	var from := _camera.project_ray_origin(event.position)
	var to := from + _camera.project_ray_normal(event.position) * 100.0

	var space_state := get_viewport().world_3d.direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from, to)
	var hit := space_state.intersect_ray(query)
	if hit.is_empty():
		return

	var collider = hit.get("collider")
	var prop_node := DtuPropInteraction.find_prop_ancestor(collider)
	if prop_node == null:
		return

	_selected_dtu_id = String(prop_node.get_meta("dtu_id", ""))
	_selected_title = String(prop_node.get_meta("title", ""))
	if _selected_dtu_id != "":
		prop_selected.emit(_selected_dtu_id, _selected_title)


## Dispatch `action` ("inspect" | "take" | "leave" | "arrange") against the
## currently selected prop. `placement` is only used for "arrange".
func interact(action: String, placement: Dictionary = {}) -> void:
	if _selected_dtu_id == "":
		interact_failed.emit("", action, "no_selection")
		return
	send_interact(_selected_dtu_id, action, placement)


## Dispatch an interact call for an explicit dtu_id (bypassing selection —
## useful for a UI list/inventory view, not just raycast pick).
func send_interact(dtu_id: String, action: String, placement: Dictionary = {}) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_interact_completed.bind(req, dtu_id, action))

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth_token != "":
		headers.append("Authorization: Bearer %s" % auth_token)

	var payload := DtuPropInteraction.build_interact_request_body(dtu_id, action, placement)
	var body := JSON.stringify(payload)
	var err := req.request("%s/api/lens/run" % base_url, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		req.queue_free()
		interact_failed.emit(dtu_id, action, "request_error_%d" % err)


func _on_interact_completed(
		result: int, code: int, _headers: PackedStringArray,
		response_body: PackedByteArray, req: HTTPRequest, dtu_id: String, action: String) -> void:
	req.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		interact_failed.emit(dtu_id, action, "http_%d_%d" % [result, code])
		return

	var parsed = JSON.parse_string(response_body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY:
		interact_failed.emit(dtu_id, action, "malformed_response")
		return

	if bool(parsed.get("ok", false)):
		interacted.emit(dtu_id, action, parsed)
	else:
		# Forward the server's own honest reason (e.g.
		# "citation_consent_not_granted", "not_owner", "not_holding") —
		# never paper over a real rejection as success.
		interact_failed.emit(dtu_id, action, String(parsed.get("reason", "unknown")))


# ── Pure static helpers ──────────────────────────────────────────────────────

## Body for `POST /api/lens/run`. `placement` is included only for
## "arrange" (and only when non-empty) so inspect/take/leave calls stay
## minimal.
static func build_interact_request_body(
		dtu_id: String, action: String, placement: Dictionary = {}) -> Dictionary:
	var input := {"dtuId": dtu_id, "action": action}
	if action == "arrange" and not placement.is_empty():
		input["placement"] = placement
	return {"domain": "dtu_props", "name": "interact", "input": input}


## Walk up from `node` looking for the first ancestor carrying a non-empty
## `dtu_id` meta key (DtuPropRenderer stamps this on each prop's holder).
## Returns null if none is found (including when `node` is null) — never
## fabricates a match.
static func find_prop_ancestor(node: Node) -> Node:
	var current := node
	var hops := 0
	while current != null and hops < 32:  # bounded walk — never infinite-loop on a cyclic/odd tree
		if current.has_meta("dtu_id") and String(current.get_meta("dtu_id")) != "":
			return current
		current = current.get_parent()
		hops += 1
	return null
