extends Node3D
## Boot — Phase 1 entry point.
##
## Instantiates the GatewayClient, wires its signals to log lines, and (once
## authenticated) requests the scene for a world. This is deliberately thin:
## it exercises the net stack without asserting anything about visuals.
## All visual claims are queued in VISUAL_QA.md — nothing here has been rendered.

const GatewayClient := preload("res://net/gateway_client.gd")
const SceneBootstrap := preload("res://world/scene_bootstrap.gd")
const AerialTrafficController := preload("res://world/aerial_traffic_controller.gd")
const ConKayPresence := preload("res://conkay/conkay_presence.gd")

## Runtime config — override via project settings or env at integration time.
@export var gateway_url: String = "ws://127.0.0.1:5050/godot-ws"
@export var auth_token: String = ""
@export var world_id: String = "concordia-hub"

var _gateway: GatewayClient
var _bootstrap: SceneBootstrap
var _aerial_traffic: AerialTrafficController
var _conkay: ConKayPresence


func _ready() -> void:
	_bootstrap = SceneBootstrap.new()
	add_child(_bootstrap)

	# C16 — ambient aerial traffic. Same "mount + let boot.gd's _on_event
	# dispatch to it" pattern as SceneBootstrap; see that file's own class
	# doc for why no visible geometry is spawned here yet (data layer only).
	_aerial_traffic = AerialTrafficController.new()
	_aerial_traffic.world_id = world_id
	add_child(_aerial_traffic)

	# R5/E22 — ConKay spatial mode. Same identity as the web widget, given a
	# presence here; see conkay/conkay_presence.gd's class doc. `user:<id>`
	# is auto-joined by the gateway on successful auth (no room:join needed
	# for its two real event types below). Placeholder position — a design
	# dial, not measured against any real spawn point yet (VISUAL_QA.md).
	_conkay = ConKayPresence.new()
	_conkay.position = Vector3(0.0, 1.6, 0.0)
	add_child(_conkay)

	_gateway = GatewayClient.new()
	_gateway.gateway_url = gateway_url
	_gateway.auth_token = auth_token
	add_child(_gateway)

	_gateway.connected.connect(_on_connected)
	_gateway.authenticated.connect(_on_authenticated)
	_gateway.disconnected.connect(_on_disconnected)
	_gateway.event_received.connect(_on_event)

	_gateway.connect_to_gateway()


func _on_connected() -> void:
	print("[boot] gateway socket open")


func _on_authenticated(user_id: String) -> void:
	print("[boot] authenticated as ", user_id)
	_gateway.send_event("room:join", {"room": "world:%s" % world_id})
	_gateway.send_event("scene:request", {"worldId": world_id})


func _on_disconnected(reason: String) -> void:
	print("[boot] disconnected: ", reason)


func _on_event(evt: String, data: Dictionary) -> void:
	match evt:
		"scene:data":
			_bootstrap.apply_scene(data)
		"world:aerial-traffic":
			_aerial_traffic.apply_snapshot(data, Time.get_ticks_msec())
		"macro:started", "macro:completed", "conkay:verdict":
			# R5/E22 — ConKay spatial mode. Real facts only: an in-flight
			# macro call (busy) and the last verdict's capability tier. See
			# conkay/conkay_presence_state.gd's header for why voice/overlay
			# state is deliberately NOT included here.
			_conkay.handle_event(evt, data)
		"room:joined":
			print("[boot] joined room ", data.get("room", "?"))
		_:
			# Unhandled events are logged, not fatal.
			pass
