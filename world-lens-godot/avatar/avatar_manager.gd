class_name AvatarManager
extends Node
## AvatarManager — spawns/updates AvatarRig puppets for every REMOTE user
## (`city:positions`) and NPC (`city:npcs`) frame, interpolated through the
## existing net/snapshot_buffer.gd (same now-120ms sampling the Three.js
## client uses — see that file's own header comment), and drives each rig's
## locomotion via animation_state_machine.gd fed by BOTH a velocity INFERRED
## from consecutive interpolated samples AND (R5 continuation) a
## server-authoritative `.locomotion` label when the snapshot carries one.
##
## Velocity inference used to be the ONLY signal available (documented here
## as an honest gap): the wire protocol carried no run/walk signal for a
## remote entity at all — every ordinary `player:move` frame hardcoded
## `action: 'walk'` and server/lib/city-presence.js's `broadcastPositions`
## just relayed whatever `action` string the sender supplied. That gap is now
## closed server-side: `city-presence.js#classifyLocomotion` derives a real
## idle/walk/run label from the server's own authoritative per-packet speed
## (position delta / server wall-clock dt) and broadcasts it as an additive
## `.locomotion` field, ingested here into `_locomotion_hints` and passed to
## `AnimationStateMachine.select_state` as `locomotion_hint`, which prefers it
## over its own inference. NPC snapshots (`city:npcs`) carry no `.locomotion`
## field, so NPCs still animate off pure velocity inference — see
## animation_state_machine.gd's header comment for the full contract and the
## boundary constants this feeds into.
##
## The LOCAL player is NOT managed here. player/character_controller.gd
## predicts its own movement every physics tick (uncapped local framerate)
## and streams intent at <=30Hz; this manager only ever touches OTHER
## entities, sampled at whatever cadence their snapshots arrive
## (~100ms/10Hz for players per docs/GODOT_INTEGRATION.md, ~2Hz for NPCs
## mirroring AvatarSystem3D.tsx's `NPC_UPDATE_RATE`).

const SnapshotBuffer := preload("res://net/snapshot_buffer.gd")
const AnimationStateMachine := preload("res://avatar/animation_state_machine.gd")
const AvatarRig := preload("res://avatar/avatar_rig.gd")

## Despawn an entity's rig after this many ms with no fresh snapshot mention.
const STALE_TIMEOUT_MS: int = 3000

## m/s of interpolated-position vertical rate-of-change beyond which an
## entity is considered airborne. Godot-native heuristic (see header comment
## on infer_kinematics) — there is no server-sent airborne flag for remote
## entities to mirror instead; small enough to catch a real jump/fall arc,
## large enough that normal terrain-follow height correction doesn't false-
## trigger it.
const AIRBORNE_VY_EPS: float = 0.3

@export var base_url: String = "http://127.0.0.1:5050"
## Threaded to every spawned AvatarRig -> AssetResolver's per-world
## hero-mesh variant preference. See avatar_rig.gd/asset_resolver.gd.
@export var world_id: String = ""

var _buffer := SnapshotBuffer.new()
var _rigs: Dictionary = {}          # id -> AvatarRig
var _kinds: Dictionary = {}         # id -> "player" | "npc"
var _actions: Dictionary = {}       # id -> last known action/currentAnimation string
## R5 continuation — id -> last known server-authoritative locomotion label
## (`city:positions.users[].locomotion`, city-presence.js#classifyLocomotion).
## "" means absent (an NPC snapshot, or an older server): AnimationStateMachine
## falls back to its own inferred-speed classification in that case.
var _locomotion_hints: Dictionary = {}
var _last_seen_ms: Dictionary = {}  # id -> ms of last snapshot mention
var _prev_sample: Dictionary = {}   # id -> {"pos": Vector3, "ts": int}
var _grounded_since_ms: Dictionary = {}  # id -> ms of last airborne->grounded transition
var _was_airborne: Dictionary = {}       # id -> bool (previous frame)


## Ingest one `city:positions` (kind "player") or `city:npcs` (kind "npc")
## payload. `entities` maps id -> a Dictionary carrying at least x/y/z and
## (direction|rotation), optionally `action`/`currentAnimation`/`locomotion`.
## Pure data-in bookkeeping only — no engine calls happen here; `_process`
## (engine-gated) reacts to what this stages into the SnapshotBuffer.
func ingest_snapshot(now_ms: int, entities: Dictionary, kind: String) -> void:
	var states := {}
	for id in entities.keys():
		var e: Dictionary = entities[id]
		states[id] = [
			float(e.get("x", 0.0)),
			float(e.get("y", 0.0)),
			float(e.get("z", 0.0)),
			float(e.get("direction", e.get("rotation", 0.0))),
		]
		_kinds[id] = kind
		_actions[id] = String(e.get("action", e.get("currentAnimation", "")))
		_locomotion_hints[id] = String(e.get("locomotion", ""))
		_last_seen_ms[id] = now_ms
	_buffer.ingest(now_ms, states)


func _process(_delta: float) -> void:
	var now_ms := Time.get_ticks_msec()
	var sampled := _buffer.sample(now_ms)

	for id in sampled.keys():
		var state: Array = sampled[id]
		var pos := Vector3(state[0], state[1], state[2])
		var heading: float = state[3]

		if not _rigs.has(id):
			_spawn_rig(id)
		var rig: AvatarRig = _rigs[id]

		var prev = _prev_sample.get(id, {})
		var kin := AvatarManager.infer_kinematics(pos, prev, now_ms, AIRBORNE_VY_EPS)
		_prev_sample[id] = {"pos": pos, "ts": now_ms}

		var was_air: bool = _was_airborne.get(id, false)
		var is_air: bool = kin["is_airborne"]
		if not is_air and was_air:
			_grounded_since_ms[id] = now_ms
		elif is_air:
			_grounded_since_ms.erase(id)
		_was_airborne[id] = is_air

		var ms_since_grounded := -1
		if _grounded_since_ms.has(id):
			ms_since_grounded = now_ms - int(_grounded_since_ms[id])

		var decision := AnimationStateMachine.select_state({
			"speed": kin["speed"],
			"vertical_velocity": kin["vertical_velocity"],
			"is_airborne": is_air,
			"action": _actions.get(id, ""),
			"locomotion_hint": _locomotion_hints.get(id, ""),
			"ms_since_grounded": ms_since_grounded,
		})

		rig.apply_transform(pos, heading)
		rig.set_locomotion(decision["state"], decision["blend"])

	_despawn_stale(now_ms)


func _spawn_rig(id: String) -> void:
	var rig := AvatarRig.new()
	rig.rig_id = id
	rig.kind = "player" if _kinds.get(id, "npc") == "player" else "npc"
	rig.base_url = base_url
	rig.world_id = world_id
	# Phase M1 — every remote/spectated avatar carries its (today: always
	# "warrior", see AssetResolver's own honest-default comment) archetype's
	# real weapon, same as the local player below.
	rig.attach_weapon = true
	add_child(rig)
	_rigs[id] = rig


func _despawn_stale(now_ms: int) -> void:
	var stale: Array = []
	for id in _rigs.keys():
		var seen: int = _last_seen_ms.get(id, 0)
		if now_ms - seen > STALE_TIMEOUT_MS:
			stale.append(id)
	for id in stale:
		var rig = _rigs[id]
		if is_instance_valid(rig):
			rig.queue_free()
		_rigs.erase(id)
		_kinds.erase(id)
		_actions.erase(id)
		_locomotion_hints.erase(id)
		_last_seen_ms.erase(id)
		_prev_sample.erase(id)
		_grounded_since_ms.erase(id)
		_was_airborne.erase(id)


## Combat Phase C1 — nearest in-range remote avatar to `from_pos`, for the
## local player's target-selection input (see player/character_controller.gd).
## Reads the SAME `_rigs` dictionary avatar_manager.gd already maintains from
## live `city:positions` snapshots — no new tracking system, just a query
## over data already kept current every frame. Delegates to the pure static
## `nearest_target_id` below so the selection RULE itself is testable without
## a scene tree; this wrapper only does the engine-gated bit (reading
## `rig.global_position` from real spawned nodes).
func nearest_target(from_pos: Vector3, max_range: float) -> String:
	var candidates := []
	for id in _rigs.keys():
		var rig = _rigs[id]
		if not is_instance_valid(rig):
			continue
		candidates.append({"id": id, "position": rig.global_position})
	return AvatarManager.nearest_target_id(candidates, from_pos, max_range)


# ── Pure static kinematics inference ─────────────────────────────────────────

## Nearest entry in `candidates` (Array of {"id": String, "position": Vector3})
## to `from_pos`, within `max_range` (inclusive). Returns "" honestly when
## nothing qualifies — an empty candidate list, or every candidate beyond
## range, is a real "no target" answer, never a fabricated id. Ties (equal
## distance) break by array iteration order — deterministic given a
## deterministic candidate order, not a claim of a meaningful tiebreak rule.
static func nearest_target_id(candidates: Array, from_pos: Vector3, max_range: float) -> String:
	var best_id := ""
	var best_dist := INF
	for c in candidates:
		var id := String(c.get("id", ""))
		if id.is_empty():
			continue
		var pos: Vector3 = c.get("position", Vector3.ZERO)
		var dist := from_pos.distance_to(pos)
		if dist <= max_range and dist < best_dist:
			best_dist = dist
			best_id = id
	return best_id


## Derive {speed, vertical_velocity, is_airborne} from two consecutive
## INTERPOLATED position samples. `prev` is `{}` on an entity's first
## sighting — reported as motionless (never fabricates a velocity from
## nothing). `vy_eps` is AIRBORNE_VY_EPS by default; exposed as a param so
## the threshold itself stays testable independent of the class constant.
static func infer_kinematics(
		pos: Vector3, prev: Dictionary, now_ms: int, vy_eps: float) -> Dictionary:
	if prev.is_empty():
		return {"speed": 0.0, "vertical_velocity": 0.0, "is_airborne": false}

	var prev_pos: Vector3 = prev["pos"]
	var dt_ms: int = now_ms - int(prev["ts"])
	if dt_ms <= 0:
		return {"speed": 0.0, "vertical_velocity": 0.0, "is_airborne": false}

	var dt: float = dt_ms / 1000.0
	var delta: Vector3 = pos - prev_pos
	var speed: float = Vector2(delta.x, delta.z).length() / dt
	var vy: float = delta.y / dt
	return {"speed": speed, "vertical_velocity": vy, "is_airborne": absf(vy) > vy_eps}
