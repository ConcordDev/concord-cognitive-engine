extends Node3D
## Boot — Phase 1 entry point, now (R5/E24) also the scene-switcher shell.
##
## Instantiates the GatewayClient, wires its signals to log lines, and (once
## authenticated) requests the scene for a world. This is deliberately thin:
## it exercises the net stack without asserting anything about visuals.
## All visual claims are queued in VISUAL_QA.md — nothing here has been rendered.
##
## ── R5/E24 — unified session/camera/input management ────────────────────────
## Before this unit, World play (SceneBootstrap/AerialTrafficController),
## Game Design (DesignPlaytestClient/DesignCommandClient), and FEA
## visualization (FeaSceneBuilder) were each independent, uncomposed
## components — none of them were even mounted here together, so nothing
## coordinated which one owned the camera/movement input at a given moment.
## `session/session_manager.gd` is now the single source of truth for that
## ("what mode is the client in") and `session/camera_rig.gd` is the ONE
## shared Camera3D every mode configures instead of building its own — see
## both files' class docs for the full state-machine/rig design. ConKay
## (`_conkay` below) is deliberately NOT wired into SessionManager at all —
## it is an always-on overlay regardless of mode, per its own class doc, and
## never competes for camera/input.
##
## `_design_playtest` is the ONE real server-tracked state transition this
## file brokers (design ⇄ playtest, via SessionManager); `_fea_scene` is
## mounted so the FEA overlay has something real to show/hide + a real
## focus point for the orbit camera — see `_on_fea_overlay_opened`/`_closed`.
##
## Deliberately NOT mounted here: a live CharacterController/
## LandAirTransitionController body. Both gained an optional
## `session_manager` input-ownership gate as part of this unit (see either
## file's own class doc), but actually spawning a physically-simulated
## avatar needs real collision geometry / a spawn point this skeleton
## doesn't have yet (no ground mesh under `scene_bootstrap.gd`'s placeholder
## boxes) — mounting one here would silently fall through the world forever,
## which is worse than not mounting it at all. That is separate, already
## in-flight movement/character work, not this unit's scope. This is also
## exactly why a camera-only SPECTATE mode (R6, below) is a safe first
## shippable milestone: it needs none of that missing collision geometry.
##
## ── R6 — reconnect resync + remote-avatar rendering + spectator mode ───────
## Three additions, all client-side (no new server protocol needed — see
## net/gateway_client.gd's class doc for why `_seq` itself can't drive a
## "since-N" resync, and why the reconnect (`_on_authenticated` firing again)
## is the real trigger instead):
##   1. `_on_authenticated` now replays EVERY room this client had joined
##      (not just the one hardcoded world room) and resets ConKay's one-shot
##      presence state — a `macro:completed` missed while disconnected would
##      otherwise leave a stuck "busy" indicator with nothing left to ever
##      clear it.
##   2. `AvatarManager` (avatar/avatar_manager.gd) is now mounted and fed
##      from `city:positions` — it existed, fully built and tested, with NO
##      live caller anywhere in this tree until this unit (see that file's
##      own header and city-presence.js's DET-C batch 8 comment for the
##      history). `city:npcs` is NOT wired here: that broadcast was
##      DELIBERATELY RETIRED server-side (city-presence.js, same comment) —
##      re-adding a client subscriber for an event the server no longer
##      emits would be dead code, not a fix.
##   3. `spectator_mode` (env `CONCORD_GODOT_SPECTATOR`) requests
##      SessionManager.Mode.SPECTATE once authenticated — a free-fly,
##      no-character-input camera anyone can point at a running world
##      without needing a spawn point or collision geometry. This is the
##      "first shippable milestone" read-only spectator viewer: static
##      geometry (scene:request), other players moving (AvatarManager, this
##      unit), and ambient air traffic (already wired) are all real,
##      already-broadcast state — nothing here fabricates a frame of it.

const GatewayClient := preload("res://net/gateway_client.gd")
const SceneBootstrap := preload("res://world/scene_bootstrap.gd")
const AerialTrafficController := preload("res://world/aerial_traffic_controller.gd")
const AvatarManager := preload("res://avatar/avatar_manager.gd")
const ConKayPresence := preload("res://conkay/conkay_presence.gd")
const SessionManager := preload("res://session/session_manager.gd")
const CameraRig := preload("res://session/camera_rig.gd")
const DesignPlaytestClient := preload("res://design/design_playtest_client.gd")
const FeaSceneBuilder := preload("res://engineering/fea_scene_builder.gd")

## Runtime config — override via project settings or env at integration time.
## The env override (CONCORD_GATEWAY_URL / CONCORD_GODOT_API_KEY /
## CONCORD_GODOT_AUTH_TOKEN / CONCORD_WORLD_ID) is what actually makes this
## usable from a non-interactive launch (bare-metal boot script, CI) — the
## @export defaults alone only ever changed via the editor inspector. See
## resolve_runtime_config below and scripts/launch-godot-client.sh.
@export var gateway_url: String = "ws://127.0.0.1:5050/godot-ws"
@export var auth_token: String = ""
@export var api_key: String = ""
@export var world_id: String = "concordia-hub"
## R6 — CONCORD_GODOT_SPECTATOR. A literal "true"/"1" opts into the
## read-only spectator viewer milestone (SessionManager.Mode.SPECTATE) the
## moment auth succeeds; any other value (including unset/blank) leaves the
## client in ordinary WORLD mode, matching the string/bool convention
## resolve_runtime_config already established for the other three vars.
@export var spectator_mode: bool = false

var _gateway: GatewayClient
var _bootstrap: SceneBootstrap
var _aerial_traffic: AerialTrafficController
var _avatar_manager: AvatarManager
var _conkay: ConKayPresence
var _session: SessionManager
var _camera_rig: CameraRig
var _design_playtest: DesignPlaytestClient
var _fea_scene: FeaSceneBuilder

## R6 — every room this client has asked to join, replayed in full on every
## successful (re)auth by `_on_authenticated` (see this file's class doc).
var _joined_rooms: Array[String] = []


## Pure static so it's unit-testable without a scene tree (same rationale as
## GatewayClient.build_auth_payload). `env` is the already-read environment
## values — real callers pass real OS.get_environment() results, tests pass
## a fake Dictionary — which keeps this resolution logic decoupled from the
## engine API it reads from. Only a non-empty env value overrides its
## matching default; an unset/blank env var leaves the export-default (or
## editor-inspector value) untouched.
static func resolve_runtime_config(env: Dictionary, defaults: Dictionary) -> Dictionary:
	var resolved := defaults.duplicate()
	if not String(env.get("CONCORD_GATEWAY_URL", "")).is_empty():
		resolved["gateway_url"] = env["CONCORD_GATEWAY_URL"]
	if not String(env.get("CONCORD_GODOT_API_KEY", "")).is_empty():
		resolved["api_key"] = env["CONCORD_GODOT_API_KEY"]
	if not String(env.get("CONCORD_GODOT_AUTH_TOKEN", "")).is_empty():
		resolved["auth_token"] = env["CONCORD_GODOT_AUTH_TOKEN"]
	if not String(env.get("CONCORD_WORLD_ID", "")).is_empty():
		resolved["world_id"] = env["CONCORD_WORLD_ID"]
	# R6 — a literal "true" or "1" only; anything else (including unset,
	# blank, or a typo like "yes") leaves `spectator_mode` at its default
	# rather than guessing at truthiness, matching the honest-default
	# convention every other override here already follows.
	var spectator_env := String(env.get("CONCORD_GODOT_SPECTATOR", ""))
	if spectator_env == "true" or spectator_env == "1":
		resolved["spectator_mode"] = true
	return resolved


func _ready() -> void:
	var _env := {
		"CONCORD_GATEWAY_URL": OS.get_environment("CONCORD_GATEWAY_URL"),
		"CONCORD_GODOT_API_KEY": OS.get_environment("CONCORD_GODOT_API_KEY"),
		"CONCORD_GODOT_AUTH_TOKEN": OS.get_environment("CONCORD_GODOT_AUTH_TOKEN"),
		"CONCORD_WORLD_ID": OS.get_environment("CONCORD_WORLD_ID"),
		"CONCORD_GODOT_SPECTATOR": OS.get_environment("CONCORD_GODOT_SPECTATOR"),
	}
	var _defaults := {
		"gateway_url": gateway_url, "api_key": api_key,
		"auth_token": auth_token, "world_id": world_id,
		"spectator_mode": spectator_mode,
	}
	var _cfg := resolve_runtime_config(_env, _defaults)
	gateway_url = _cfg["gateway_url"]
	api_key = _cfg["api_key"]
	auth_token = _cfg["auth_token"]
	world_id = _cfg["world_id"]
	spectator_mode = _cfg["spectator_mode"]

	_bootstrap = SceneBootstrap.new()
	add_child(_bootstrap)

	# C16 — ambient aerial traffic. Same "mount + let boot.gd's _on_event
	# dispatch to it" pattern as SceneBootstrap; see that file's own class
	# doc for why no visible geometry is spawned here yet (data layer only).
	_aerial_traffic = AerialTrafficController.new()
	_aerial_traffic.world_id = world_id
	add_child(_aerial_traffic)

	# R6 — remote player avatars (avatar/avatar_manager.gd's own class doc
	# explains why this had never been mounted anywhere before this unit).
	# `base_url` isn't consulted for `city:positions`-driven puppets today
	# (only used by AvatarRig's optional GLB-asset resolution), set for
	# parity with the other REST-touching nodes mounted below regardless.
	_avatar_manager = AvatarManager.new()
	_avatar_manager.base_url = "http://127.0.0.1:5050"
	add_child(_avatar_manager)

	# R5/E22 — ConKay spatial mode. Same identity as the web widget, given a
	# presence here; see conkay/conkay_presence.gd's class doc. `user:<id>`
	# is auto-joined by the gateway on successful auth (no room:join needed
	# for its two real event types below). Placeholder position — a design
	# dial, not measured against any real spawn point yet (VISUAL_QA.md).
	# NOT wired into SessionManager — see this file's own class doc.
	_conkay = ConKayPresence.new()
	_conkay.position = Vector3(0.0, 1.6, 0.0)
	add_child(_conkay)

	_gateway = GatewayClient.new()
	_gateway.name = "Gateway"
	_gateway.gateway_url = gateway_url
	_gateway.auth_token = auth_token
	_gateway.api_key = api_key
	add_child(_gateway)

	# R5/E24 — the FEA overlay's real geometry, mounted hidden. Opened only
	# via SessionManager.open_fea_overlay() (see _on_fea_overlay_opened);
	# never fetches or shows a structure on its own.
	_fea_scene = FeaSceneBuilder.new()
	_fea_scene.base_url = "http://127.0.0.1:5050"
	_fea_scene.auth_token = auth_token
	_fea_scene.visible = false
	add_child(_fea_scene)
	# Real orbit-camera focus, re-derived every time the fetched structure
	# actually finishes loading — not just once at overlay-open time (a
	# fetch is async; the overlay can open before the model arrives).
	_fea_scene.scene_ready.connect(_on_fea_scene_ready)

	# R5/E24 — the Game Design Lens's real design<->playtest round trip.
	# `gateway_path` is set BEFORE add_child so its own `_ready()` (which
	# resolves the NodePath once) sees an already-connected Gateway sibling.
	_design_playtest = DesignPlaytestClient.new()
	_design_playtest.name = "DesignPlaytestClient"
	_design_playtest.gateway_path = NodePath("../Gateway")
	add_child(_design_playtest)

	# R5/E24 — the shared camera rig (session/camera_rig.gd's class doc) and
	# the session-state authority that drives it (session/
	# session_manager.gd's class doc). Wired last so both real dependents
	# (DesignPlaytestClient, CameraRig) already exist in the tree.
	_camera_rig = CameraRig.new()
	add_child(_camera_rig)

	_session = SessionManager.new()
	add_child(_session)
	_session.set_camera_rig(_camera_rig)
	_session.set_design_playtest_client(_design_playtest)
	_session.fea_overlay_opened.connect(_on_fea_overlay_opened)
	_session.fea_overlay_closed.connect(_on_fea_overlay_closed)
	_session.mode_transition_rejected.connect(_on_mode_transition_rejected)
	_session.fea_overlay_rejected.connect(_on_fea_overlay_rejected)

	_gateway.connected.connect(_on_connected)
	_gateway.authenticated.connect(_on_authenticated)
	_gateway.disconnected.connect(_on_disconnected)
	_gateway.event_received.connect(_on_event)
	_gateway.sequence_anomaly.connect(_on_sequence_anomaly)

	_gateway.connect_to_gateway()


func _on_connected() -> void:
	print("[boot] gateway socket open")


func _on_authenticated(user_id: String) -> void:
	print("[boot] authenticated as ", user_id)
	# R6 — every successful auth (including a reconnect, since `authenticated`
	# fires again on each one) is treated as a full resync point: re-join
	# every room this client had joined (not just the world room this method
	# used to hardcode), re-request the world's full scene snapshot, and let
	# ConKay's one-shot-derived presence state start clean rather than risk
	# showing a stuck "busy" indicator from a macro:completed that was missed
	# entirely while offline. `city:positions`/`world:aerial-traffic` need no
	# equivalent action here — their own ~100ms/~15s broadcast cadence
	# self-heals on the very next tick with no special-casing (see
	# net/gateway_client.gd's class doc for the full reasoning on why `_seq`
	# itself cannot drive this instead).
	var world_room := "world:%s" % world_id
	if not _joined_rooms.has(world_room):
		_joined_rooms.append(world_room)
	for room in _joined_rooms:
		_gateway.send_event("room:join", {"room": room})
	_gateway.send_event("scene:request", {"worldId": world_id})
	_conkay.reset()
	if spectator_mode:
		_session.request_mode(SessionManager.Mode.SPECTATE)


func _on_disconnected(reason: String) -> void:
	print("[boot] disconnected: ", reason)


func _on_sequence_anomaly(seq: int, last_seen: int) -> void:
	# R6 — diagnostic only, see gateway_client.gd's class doc: this can only
	# fire on genuine out-of-order/duplicate delivery, never on an ordinary
	# large jump (which is the normal case for this shared counter).
	print("[boot] gateway _seq anomaly: got ", seq, " after ", last_seen)


func _on_event(evt: String, data: Dictionary) -> void:
	match evt:
		"scene:data":
			_bootstrap.apply_scene(data)
		"world:aerial-traffic":
			_aerial_traffic.apply_snapshot(data, Time.get_ticks_msec())
		"city:positions":
			# R6 — see avatar/avatar_manager.gd's own header for why this had
			# no live caller before this unit. Filters to THIS world only:
			# the server broadcasts city:positions globally across every
			# active city/world (city-presence.js#broadcastPositions has no
			# room/world scoping), so an unfiltered ingest would spawn
			# puppets for players in a completely different world. Uses
			# `cityId` (server's own fallback name for worldId when a
			# movement path only ever set the former — see
			# city-presence.js's updateUserPosition). `city:npcs` is
			# deliberately NOT handled here — that broadcast was retired
			# server-side (no listener existed anywhere, ever); see this
			# file's own class doc.
			if event_matches_world(data, world_id):
				_avatar_manager.ingest_snapshot(
					Time.get_ticks_msec(), users_array_to_dict(data.get("users", [])), "player")
		"macro:started", "macro:completed", "conkay:verdict":
			# R5/E22 — ConKay spatial mode. Real facts only: an in-flight
			# macro call (busy) and the last verdict's capability tier. See
			# conkay/conkay_presence_state.gd's header for why voice/overlay
			# state is deliberately NOT included here. Always processed,
			# regardless of SessionManager's current mode/overlay state.
			_conkay.handle_event(evt, data)
		"room:joined":
			print("[boot] joined room ", data.get("room", "?"))
		_:
			# Unhandled events are logged, not fatal.
			pass


## R6 — pure translation, no engine calls, so it's testable without a scene
## tree (same rationale as resolve_runtime_config above).
## `city:positions.users` ships as an ARRAY of {userId, x, y, z, ...}
## (server/lib/city-presence.js#broadcastPositions) but
## AvatarManager.ingest_snapshot expects a Dictionary keyed by id — the shape
## `city:npcs` used to ship before it was retired server-side. Any entry
## missing/blank `userId`, or that isn't itself a Dictionary, is dropped
## rather than guessed at.
static func users_array_to_dict(users: Array) -> Dictionary:
	var out := {}
	for u in users:
		if typeof(u) != TYPE_DICTIONARY:
			continue
		var uid := String(u.get("userId", ""))
		if uid.is_empty():
			continue
		out[uid] = u
	return out


## R6 — pure predicate, testable without a scene tree. `city:positions`
## carries `cityId` (see users_array_to_dict's doc); falls back to a
## `worldId` field too in case a future server revision ever sends one
## directly, matching city-presence.js's own `worldId ?? cityId` fallback
## convention.
static func event_matches_world(data: Dictionary, expected_world_id: String) -> bool:
	return String(data.get("cityId", data.get("worldId", ""))) == expected_world_id


## Real trigger for the FEA overlay — call with a real `{nodes, members,
## loads, supports}` model (e.g. from a Game Design Lens building the caller
## already holds). No-ops honestly (via SessionManager's own
## `fea_overlay_rejected` signal) if the overlay can't legally open right
## now (PLAYTEST) or is already open.
func request_fea_overlay(model: Dictionary) -> void:
	if _session.open_fea_overlay():
		_fea_scene.request_scene(model)


func close_fea_overlay() -> void:
	_session.close_fea_overlay()


func _on_fea_overlay_opened() -> void:
	_fea_scene.visible = true
	# Best-effort initial focus from whatever is already spawned (possibly
	# stale/empty on a fresh open) — corrected for real by
	# _on_fea_scene_ready once the actual fetch completes.
	_camera_rig.set_orbit_focus(_fea_scene.get_bounds_center())


func _on_fea_overlay_closed() -> void:
	_fea_scene.visible = false


func _on_fea_scene_ready(_node_count: int, _member_count: int) -> void:
	_camera_rig.set_orbit_focus(_fea_scene.get_bounds_center())


func _on_mode_transition_rejected(requested_mode: int, reason: String) -> void:
	print("[boot] mode transition to ", requested_mode, " rejected: ", reason)


func _on_fea_overlay_rejected(reason: String) -> void:
	print("[boot] fea overlay rejected: ", reason)
