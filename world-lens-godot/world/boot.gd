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

## Runtime config — override via project settings or env at integration time.
@export var gateway_url: String = "ws://127.0.0.1:5050/godot-ws"
@export var auth_token: String = ""
@export var world_id: String = "concordia-hub"

var _gateway: GatewayClient
var _bootstrap: SceneBootstrap
var _aerial_traffic: AerialTrafficController


func _ready() -> void:
	_bootstrap = SceneBootstrap.new()
	add_child(_bootstrap)

	# C16 — ambient aerial traffic. Same "mount + let boot.gd's _on_event
	# dispatch to it" pattern as SceneBootstrap; see that file's own class
	# doc for why no visible geometry is spawned here yet (data layer only).
	_aerial_traffic = AerialTrafficController.new()
	_aerial_traffic.world_id = world_id
	add_child(_aerial_traffic)

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
		"room:joined":
			print("[boot] joined room ", data.get("room", "?"))
		_:
			# Unhandled events are logged, not fatal.
			pass
