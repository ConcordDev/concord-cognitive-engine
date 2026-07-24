class_name DesignPlaytestClient
extends Node
## DesignPlaytestClient — Phase 4 (D21), the design ⇄ playtest mode toggle
## for a Game Design Lens scene. Sends a `design:mode` frame over an
## existing GatewayClient connection and surfaces the server's real
## `design:mode:ack` / `design:mode:nack` response.
##
## This is a SEPARATE, sibling node to DesignCommandClient (design_command_
## client.gd) — not a replacement. `design_command` stays the generic
## curated macro-dispatch channel (game-create/entity-add/level-create/
## building-publish/scene-save/scene-load); `design:mode` is its own small
## evt because the mode toggle follows the ack/nack descriptor shape
## server.js's applyPlayerMode already established for player:mode, not
## design_command's raw {ok,result} envelope — see server/server.js's
## `_onGodotClientMessage` "design:mode" case.
##
## Server side: entering playtest compiles the level through the REAL
## game-design.runtime-compile engine (via game-design.playtest-enter) and
## opens one session for this user; exiting closes it. The underlying level
## design is never mutated by either call — it stays fully editable in
## design mode both before and after a playtest round-trip.
##
## Honest handling: a `design:mode:nack` (unknown_mode / not_in_playtest /
## "level not found" / any other real rejection) is forwarded verbatim via
## `mode_rejected` — never reinterpreted as success.
##
## STATUS: parse/lint validated only — see world-lens-godot/VISUAL_QA.md.
## This has never sent a frame to a live server or a real Godot engine.

signal mode_requested(mode: String)
signal mode_entered(level_id: String, game_id: String, scene: Dictionary)
signal mode_exited(level_id: String, game_id: String)
signal mode_rejected(requested_mode: String, reason: String)

@export var gateway_path: NodePath

var _gateway: Node = null


func _ready() -> void:
	if gateway_path != NodePath():
		_gateway = get_node_or_null(gateway_path)
		if _gateway != null and _gateway.has_signal("event_received"):
			_gateway.event_received.connect(_on_event_received)


## Enter playtest mode for the given level. The server compiles the level's
## real runtime scene (spawn/collision/actors) and replies with it via
## `mode_entered` — the caller swaps its rendering path to play-mode using
## THIS scene payload, not a locally-fabricated one.
func enter_playtest(level_id: String) -> void:
	_send_mode("playtest", level_id)


## Return to design mode. The level stays exactly as edited — nothing is
## reset or reverted; this only closes the server-tracked playtest session.
func exit_playtest() -> void:
	_send_mode("design", "")


func _send_mode(mode: String, level_id: String) -> void:
	if _gateway == null or not _gateway.has_method("send_event"):
		mode_rejected.emit(mode, "no_gateway")
		return
	var envelope := DesignPlaytestClient.build_mode_data(mode, level_id)
	_gateway.send_event("design:mode", envelope)
	mode_requested.emit(mode)


func _on_event_received(evt: String, data: Dictionary) -> void:
	if evt == "design:mode:ack":
		var mode := String(data.get("mode", ""))
		if mode == "playtest":
			mode_entered.emit(
				String(data.get("levelId", "")),
				String(data.get("gameId", "")),
				data.get("scene", {}))
		else:
			mode_exited.emit(String(data.get("levelId", "")), String(data.get("gameId", "")))
		return
	if evt == "design:mode:nack":
		mode_rejected.emit(String(data.get("requested", "")), String(data.get("reason", "unknown")))


# ── Pure static helpers ──────────────────────────────────────────────────────

## Body for the `design:mode` gateway frame's `data` field:
## { "mode": String, "levelId": String }. Mirrors server/server.js's
## `_onGodotClientMessage` "design:mode" case, which reads exactly these two
## fields off the incoming frame ("levelId" is only consulted when
## mode == "playtest").
static func build_mode_data(mode: String, level_id: String = "") -> Dictionary:
	return {"mode": mode, "levelId": level_id}


## True only for the two modes the server actually recognizes. A caller
## building UI around this (e.g. a toggle button) can use this to validate
## before ever sending a frame — the server itself independently re-checks
## and nacks "unknown_mode" regardless, so this is a convenience, not the
## authority.
static func is_valid_mode(mode: String) -> bool:
	return mode == "playtest" or mode == "design"
