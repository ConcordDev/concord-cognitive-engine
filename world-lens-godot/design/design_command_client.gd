class_name DesignCommandClient
extends Node
## DesignCommandClient — Phase 4 (D17), first slice of the master-spec §5
## Game Design Lens. Sends a `design_command` frame over an existing
## GatewayClient connection and surfaces the server's real
## `design_command:result` response.
##
## This is the PROTOCOL ROUND-TRIP only — construct a command, send it,
## receive the real ack/result. There is no visual placement/authoring UI
## here; that is D18's (larger) scope, per docs/GODOT_PROTOCOL.md §11 and
## docs/NEXT_ARC_PLAN.md / the durable plan's Phase-4 sequencing.
##
## Server side: `server/server.js`'s `_onGodotClientMessage` (case
## "design_command") resolves `action` against a curated allow-list
## (`DESIGN_COMMAND_ACTIONS`) and dispatches it through the SAME
## LENS_ACTIONS/MACROS resolution `/api/lens/run` uses, targeting real
## `server/domains/gamedesign.js` macros — never a parallel/invented data
## model. Supported actions today: "game-create", "entity-add",
## "level-create", "building-publish".
##
## Honest handling: `unsupported_action` / `unknown_macro` / any `ok:false`
## from the server is forwarded verbatim via `command_failed` — never
## reinterpreted as success. A response missing an explicit `ok:true` is
## treated as a failure, not assumed successful.
##
## STATUS: parse/lint validated only — see world-lens-godot/VISUAL_QA.md.
## This has never sent a frame to a live server or a real Godot engine.

signal command_sent(action: String, params: Dictionary)
signal command_result(action: String, result: Dictionary)
signal command_failed(action: String, reason: String)

@export var gateway_path: NodePath

var _gateway: Node = null


func _ready() -> void:
	if gateway_path != NodePath():
		_gateway = get_node_or_null(gateway_path)
		if _gateway != null and _gateway.has_signal("event_received"):
			_gateway.event_received.connect(_on_event_received)


## Send a `design_command` frame. `action` must be one of the server's
## allow-listed game-design macros (see DESIGN_COMMAND_ACTIONS in
## server/server.js's _onGodotClientMessage) — an action the server doesn't
## recognize gets an honest `unsupported_action` result back over the wire,
## never a fabricated local success.
func send_command(action: String, params: Dictionary = {}) -> void:
	if _gateway == null or not _gateway.has_method("send_event"):
		command_failed.emit(action, "no_gateway")
		return
	var envelope := DesignCommandClient.build_command_data(action, params)
	_gateway.send_event("design_command", envelope)
	command_sent.emit(action, params)


func _on_event_received(evt: String, data: Dictionary) -> void:
	if evt != "design_command:result":
		return
	var action := String(data.get("action", ""))
	if DesignCommandClient.is_success(data):
		command_result.emit(action, data.get("result", {}))
	else:
		# Forward the server's own honest reason (e.g. "unsupported_action",
		# "unknown_macro", "invalid_dimensions", "overlap") — never paper
		# over a real rejection as success.
		command_failed.emit(action, String(data.get("error", "unknown")))


# ── Pure static helpers ──────────────────────────────────────────────────────

## Body for the `design_command` gateway frame's `data` field:
## { "action": String, "params": Dictionary }. Mirrors
## server/server.js's `_onGodotClientMessage` "design_command" case, which
## reads exactly these two fields off the incoming frame.
static func build_command_data(action: String, params: Dictionary = {}) -> Dictionary:
	return {"action": action, "params": params}


## True only when a decoded `design_command:result` frame's `data` dict
## carries an explicit `ok: true`. A response with `ok` missing or falsy is
## a failure — never assumed successful by default.
static func is_success(data: Dictionary) -> bool:
	return bool(data.get("ok", false))
