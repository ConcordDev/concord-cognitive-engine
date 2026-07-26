class_name GatewayClient
extends Node
## GatewayClient — WebSocketPeer client for the Concord Godot gateway.
##
## Mirrors server/lib/godot-gateway.js:
##   * envelope: { "evt": String, "data": Dictionary }
##   * auth-first handshake (send `auth` on open), `hello` on success
##   * honest close codes surfaced to the `disconnected` signal
##
## The envelope codec is exposed as PURE STATIC funcs (encode_envelope /
## decode_envelope) so it can be unit-tested without a scene tree or a live
## socket. Everything engine-dependent stays in the _process poll loop.

signal connected
signal authenticated(user_id: String)
signal disconnected(reason: String)
signal event_received(evt: String, data: Dictionary)

enum State { DISCONNECTED, CONNECTING, AUTHENTICATING, READY }

const BACKOFF_MIN_S: float = 1.0
const BACKOFF_MAX_S: float = 30.0

@export var gateway_url: String = "ws://127.0.0.1:5050/godot-ws"
@export var auth_token: String = ""
@export var auto_reconnect: bool = true

var _peer: WebSocketPeer = null
var _state: int = State.DISCONNECTED
var _backoff_s: float = BACKOFF_MIN_S
var _reconnect_at_ms: int = -1


func connect_to_gateway() -> void:
	_open_socket()


func _open_socket() -> void:
	_peer = WebSocketPeer.new()
	var err := _peer.connect_to_url(gateway_url)
	if err != OK:
		_schedule_reconnect("connect_error_%d" % err)
		return
	_state = State.CONNECTING


func _process(_delta: float) -> void:
	# Reconnect timer.
	if _state == State.DISCONNECTED:
		if auto_reconnect and _reconnect_at_ms >= 0 and Time.get_ticks_msec() >= _reconnect_at_ms:
			_reconnect_at_ms = -1
			_open_socket()
		return

	if _peer == null:
		return

	_peer.poll()
	var ready_state := _peer.get_ready_state()

	match ready_state:
		WebSocketPeer.STATE_OPEN:
			if _state == State.CONNECTING:
				_state = State.AUTHENTICATING
				_backoff_s = BACKOFF_MIN_S
				connected.emit()
				_send_auth()
			# Drain inbound frames.
			while _peer.get_available_packet_count() > 0:
				var pkt := _peer.get_packet()
				_handle_text(pkt.get_string_from_utf8())
		WebSocketPeer.STATE_CLOSING:
			pass
		WebSocketPeer.STATE_CLOSED:
			var code := _peer.get_close_code()
			var reason := _peer.get_close_reason()
			_state = State.DISCONNECTED
			_peer = null
			var label := "close_%d_%s" % [code, reason]
			disconnected.emit(label)
			if auto_reconnect:
				_schedule_reconnect(label)


func _send_auth() -> void:
	send_event("auth", {"token": auth_token})


func send_event(evt: String, data: Dictionary) -> void:
	if _peer == null or _peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	_peer.send_text(GatewayClient.encode_envelope(evt, data))


func _handle_text(text: String) -> void:
	var msg := GatewayClient.decode_envelope(text)
	if msg.is_empty():
		return
	var evt: String = msg.get("evt", "")
	var data: Dictionary = msg.get("data", {})

	match evt:
		"hello":
			_state = State.READY
			authenticated.emit(String(data.get("userId", "")))
		"auth:error":
			# Server will close after this; surface the reason.
			disconnected.emit("auth_error_%s" % String(data.get("reason", "unknown")))
		_:
			event_received.emit(evt, data)


func _schedule_reconnect(_reason: String) -> void:
	_state = State.DISCONNECTED
	# Exponential backoff with jitter, capped.
	var jitter := randf() * 0.5 * _backoff_s
	var wait := _backoff_s + jitter
	_reconnect_at_ms = Time.get_ticks_msec() + int(wait * 1000.0)
	_backoff_s = minf(_backoff_s * 2.0, BACKOFF_MAX_S)


# ── Pure static envelope codec (engine-independent; JSON only) ────────────────

static func encode_envelope(evt: String, data: Dictionary) -> String:
	return JSON.stringify({"evt": evt, "data": data})


## Returns {} on any parse failure or shape violation (never throws).
static func decode_envelope(text: String) -> Dictionary:
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	if not parsed.has("evt"):
		return {}
	var out := {"evt": String(parsed["evt"])}
	var d = parsed.get("data", {})
	out["data"] = d if typeof(d) == TYPE_DICTIONARY else {}
	return out
