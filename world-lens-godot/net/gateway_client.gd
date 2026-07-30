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
##
## Real-machine finding (2026-07-26): calling a static func of THIS SAME
## class via its own `class_name` prefix (e.g. `GatewayClient.encode_envelope(...)`
## from inside gateway_client.gd itself) reproduced "Identifier not found"
## at GDScript::reload on a real windowed boot with an existing
## `.godot/` cache (an incremental-reload path a fresh `--import` never
## exercises, which is why headless CI validation missed it). Call same-class
## static funcs by their bare name instead (encode_envelope(...), not
## GatewayClient.encode_envelope(...)) — functionally identical, and immune
## to this reload ordering issue.

signal connected
signal authenticated(user_id: String)
signal disconnected(reason: String)
signal event_received(evt: String, data: Dictionary)
## R6 — `_seq` anomaly (duplicate/out-of-order frame delivery within THIS
## connection, or a shared server-side counter that reset mid-connection —
## e.g. a server restart). See the class doc section below for why this is
## a diagnostic signal only, never the resync trigger.
signal sequence_anomaly(seq: int, last_seen: int)

enum State { DISCONNECTED, CONNECTING, AUTHENTICATING, READY }

const BACKOFF_MIN_S: float = 1.0
const BACKOFF_MAX_S: float = 30.0

## ── R6 — `_seq` gap detection, and why it is NOT the resync trigger ─────────
## server/lib/godot-gateway.js stamps `_seq` from a single module-instance-
## global counter (`gatewaySeq`), incremented once per `send()` CALL — not
## once per logical event. A broadcast to N clients in a room, or N clients
## sharing one process, burns N sequence numbers for what is logically one
## event instant, and different event types interleave on the same counter.
## So `_seq` is real, monotonically increasing for the process's lifetime,
## but genuinely NON-CONTIGUOUS from any single client's point of view —
## a client cannot assume the next frame's `_seq` is `last + 1`, and large
## jumps are the NORMAL case, not evidence of a missed frame. There is also
## no server-side "give me everything since seq N" verb to request even if
## a gap size could be computed (it can't, from a shared counter alone).
##
## What `_seq` genuinely IS good for: a per-connection monotonicity check.
## Within one open WebSocket connection, delivery is already ordered and
## reliable — so a frame arriving with `_seq <= _last_seq_seen` is a real
## protocol anomaly (duplicate delivery, a misbehaving intermediary, or the
## server process having restarted — resetting its counter to 0 — while this
## socket happened to stay open across the restart). `sequence_anomaly` is
## emitted purely for observability/telemetry on that case; nothing in this
## client gates behavior on it, because it is expected to fire rarely if
## ever and provides no "how much did I miss" information regardless.
##
## The one genuinely actionable resync trigger is the RECONNECT itself — see
## world/boot.gd's `_on_authenticated`, which already re-requests a full
## scene snapshot (`scene:request`) on every successful auth including
## reconnects, and (R6) now also replays every room this client had joined
## and resets any one-shot-derived state (ConKay) that has no periodic
## self-heal. `city:positions`'s own ~100ms broadcast cadence self-heals
## without any client action at all — see boot.gd's `_on_event` for that
## wiring.

@export var gateway_url: String = "ws://127.0.0.1:5050/godot-ws"
@export var auth_token: String = ""
## Long-lived API-key auth, for non-interactive launches (bare-metal boot,
## CI smoke) where a short-lived bearer token isn't practical to mint ahead
## of time. server/lib/godot-gateway.js#tryAuth accepts EITHER data.token OR
## data.apiKey in the same auth frame (checking token first if both happen
## to be present) — this client only ever sends one, preferring api_key
## when set since it's the intentional long-lived credential for automated
## launches; see _send_auth below.
@export var api_key: String = ""
@export var auto_reconnect: bool = true

var _peer: WebSocketPeer = null
var _state: int = State.DISCONNECTED
var _backoff_s: float = BACKOFF_MIN_S
var _reconnect_at_ms: int = -1

## Highest `_seq` seen THIS connection. Reset on every new socket open
## (`_open_socket`) — a previous connection's counter context is meaningless
## after a reconnect, and the server's own counter may itself have reset (a
## server restart). `-1` means "no frame received yet this connection,"
## which is never treated as an anomaly.
var _last_seq_seen: int = -1


func connect_to_gateway() -> void:
	_open_socket()


func _open_socket() -> void:
	_last_seq_seen = -1
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
	send_event("auth", build_auth_payload(api_key, auth_token))


## Pure static so it's unit-testable without a live socket (same rationale
## as the envelope codec below). Prefers api_key over auth_token when both
## are configured — see the api_key export's doc comment for why.
static func build_auth_payload(p_api_key: String, p_auth_token: String) -> Dictionary:
	if not p_api_key.is_empty():
		return {"apiKey": p_api_key}
	return {"token": p_auth_token}


func send_event(evt: String, data: Dictionary) -> void:
	if _peer == null or _peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	_peer.send_text(encode_envelope(evt, data))


func _handle_text(text: String) -> void:
	var msg := decode_envelope(text)
	if msg.is_empty():
		return
	var evt: String = msg.get("evt", "")
	var data: Dictionary = msg.get("data", {})

	# R6 — per-connection `_seq` monotonicity check (see class doc above).
	# `data.get("_seq", -1)` degrades honestly to "no seq present" (-1,
	# never an anomaly) rather than assuming 0 for a malformed/older frame.
	if data.has("_seq"):
		var seq := int(data["_seq"])
		if GatewayClient.detect_seq_anomaly(_last_seq_seen, seq):
			sequence_anomaly.emit(seq, _last_seq_seen)
		_last_seq_seen = maxi(_last_seq_seen, seq)

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


# ── Pure static seq-anomaly detection (see class doc's R6 section) ──────────

## `last_seen == -1` means "no frame received yet this connection" — never
## an anomaly (there is nothing to compare against). Otherwise, a `seq` that
## is not strictly greater than the highest one already seen is genuinely
## out of order/duplicated for THIS connection, regardless of how large or
## small the gap to the previous value was (large gaps are normal — see
## class doc; only non-increasing is an anomaly).
static func detect_seq_anomaly(last_seen: int, seq: int) -> bool:
	return last_seen >= 0 and seq <= last_seen


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
