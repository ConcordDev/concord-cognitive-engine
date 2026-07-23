class_name AnimationStateMachine
extends RefCounted
## AnimationStateMachine — PURE-LOGIC locomotion state selection.
##
## Given a kinematic snapshot (speed, airborne/vertical velocity, an optional
## server-supplied action override) this returns which of six states
## (idle/walk/run/jump/fall/land) an avatar should play, plus a blend-weight
## Dictionary so a caller can crossfade rather than pop between clips. There
## is no scene-tree or engine call anywhere in this file — every func is
## `static`, so it is callable and testable via `preload(...).select_state(...)`
## with no live node required (see tests/test_animation_state_machine.gd).
##
## ── Where the thresholds come from (parity with the Three.js client) ───────
##
## IDLE_MAX_SPEED mirrors player/character_controller.gd:194's own
## locomotion-action cutoff (`"action": "idle" if velocity.length() < 0.05
## else "walk"`) — the LOCAL Godot player already used 0.05 m/s as the
## idle/walk boundary; this file reuses the same number so every avatar this
## state machine drives (remote players + NPCs, via avatar_manager.gd) agrees
## with the local player on the same cutoff.
##
## RUN_MIN_SPEED is grounded in concord-frontend/components/world-lens/
## AvatarSystem3D.tsx:190-191 (`const MOVE_SPEED = 5.0; // m/s walking` /
## `const RUN_SPEED = 12.0; // m/s running`) — the only two horizontal speeds
## the Three.js client's WASD+shift path ever actually produces
## (`baseSpeed = isRunning ? RUN_SPEED : MOVE_SPEED`, AvatarSystem3D.tsx:2531,
## with `isRunning = keys.has('shift')` at :2523). BUT — and this is the
## honest caveat this file is built around — the wire protocol never carries
## which of the two a REMOTE player used: every outbound `player:move` frame
## for ordinary locomotion hardcodes `action: 'walk'`
## (concord-frontend/app/lenses/world/page.tsx:4703), and
## server/lib/city-presence.js's `broadcastPositions` (:1031-1046) just
## relays whatever `action` string the client sent — it never re-derives
## walk-vs-run itself either. So for any avatar OTHER than the local player,
## there is no server-sent run/walk signal to mirror; RUN_MIN_SPEED here is
## the honest inference boundary — the midpoint of the two known discrete
## speeds ((MOVE_SPEED + RUN_SPEED) / 2 = 8.5) — used by avatar_manager.gd to
## classify a remote avatar's INTERPOLATED velocity. It is a Godot-native
## decision, not a literally-mirrored constant, and is documented as such.
##
## JUMP / FALL / LAND have no Three.js equivalent at all: the browser client's
## `AnimationClip` union (AvatarSystem3D.tsx:101-123) contains no jump/fall/
## land entry — airborne motion there is a continuous procedural Y-offset
## (physics-world.ts's kinematic integration), never a discrete clip switch.
## The three-way airborne split here (ascending vertical velocity = "jump",
## descending = "fall", plus a short post-landing "land" hold) is a Godot-
## native animation-quality addition on top of the airborne boolean that
## DOES already exist on both clients (`is_airborne` in
## player/character_controller.gd:62-63,128-141 mirrors
## physicsWorld.isAirborne('player') in AvatarSystem3D.tsx:2577). See
## VISUAL_QA.md — nobody has watched this on a real skeleton yet.

## Canonical locomotion labels. Anything outside this set arriving via the
## `action` input key is treated as a one-shot override (combat swing, emote,
## gather, etc.) that REPLACES the locomotion clip for its duration — mirrors
## how the Three.js client's own hit-reaction / emote clips work: a single
## crossfade to the override clip, then a crossfade back
## (AvatarSystem3D.tsx's `handleHitReaction`/`handleActionAnim`), not an
## additive second layer.
const LOCOMOTION_STATES = ["idle", "walk", "run", "jump", "fall", "land"]

## m/s. See the header comment — mirrors character_controller.gd:194 exactly.
const IDLE_MAX_SPEED: float = 0.05

## m/s. See the header comment — the honest midpoint inference boundary
## between the Three.js client's two discrete WASD/shift speeds.
const RUN_MIN_SPEED: float = 8.5

## m/s of crossfade band on either side of a locomotion boundary, so a caller
## can lerp two clip weights instead of popping between them.
const BLEND_BAND: float = 1.5

## ms. How long the transient "land" state holds after touchdown before
## yielding back to idle/walk/run, keyed off the airborne->grounded edge (the
## same edge player/character_controller.gd's `_update_grounded_state`
## (:128-141) already detects via `last_grounded_at_ms`). Godot-native; see
## the header comment on why there is no Three.js clip to mirror here.
const LAND_HOLD_MS: int = 150


## Select the current animation state + blend weights.
##
## `input` keys (all optional except one speed source):
##   "velocity"           Vector3 — horizontal (x,z) speed + vertical (y)
##                         velocity are derived from this if present.
##   "speed"              float — horizontal speed in m/s. Used when
##                         "velocity" is absent.
##   "vertical_velocity"  float — m/s, +up. Used when "velocity" is absent.
##   "is_airborne"        bool (also accepts "isAirborne").
##   "ms_since_grounded"  int — ms since the last airborne->grounded
##                         transition; omit/negative means "not recently
##                         landed" (never enters the "land" state).
##   "action"             String — server/local one-shot override. Anything
##                         not in LOCOMOTION_STATES takes over immediately,
##                         full weight, regardless of kinematics.
##
## Returns { "state": String, "blend": Dictionary, "is_override": bool }.
## `blend` always carries the six canonical keys at minimum (0.0 where
## irrelevant); an override adds its own key at weight 1.0 alongside them.
static func select_state(input: Dictionary) -> Dictionary:
	var action := String(input.get("action", ""))
	if action != "" and not LOCOMOTION_STATES.has(action):
		return {"state": action, "blend": _single(action), "is_override": true}

	var kin := _extract_kinematics(input)
	var speed: float = kin["speed"]
	var vertical_velocity: float = kin["vertical_velocity"]
	var is_airborne: bool = kin["is_airborne"]
	var ms_since_grounded: int = int(input.get("ms_since_grounded", -1))

	if is_airborne:
		var air_state := "jump" if vertical_velocity > 0.0 else "fall"
		return {"state": air_state, "blend": _single(air_state), "is_override": false}

	if ms_since_grounded >= 0 and ms_since_grounded < LAND_HOLD_MS:
		return {"state": "land", "blend": _single("land"), "is_override": false}

	return {
		"state": _locomotion_label(speed),
		"blend": _locomotion_blend(speed),
		"is_override": false,
	}


## Pure kinematics extraction: prefers a `velocity` Vector3 (horizontal speed
## = the xz-plane length, vertical velocity = y); falls back to separate
## "speed"/"vertical_velocity" scalars. Never fabricates motion — a missing
## source of either just reads as 0.
static func _extract_kinematics(input: Dictionary) -> Dictionary:
	var is_airborne := bool(input.get("is_airborne", input.get("isAirborne", false)))
	if input.has("velocity"):
		var v: Vector3 = input["velocity"]
		return {
			"speed": Vector2(v.x, v.z).length(),
			"vertical_velocity": v.y,
			"is_airborne": is_airborne,
		}
	return {
		"speed": maxf(0.0, float(input.get("speed", 0.0))),
		"vertical_velocity": float(input.get("vertical_velocity", 0.0)),
		"is_airborne": is_airborne,
	}


static func _locomotion_label(speed: float) -> String:
	if speed < IDLE_MAX_SPEED:
		return "idle"
	if speed < RUN_MIN_SPEED:
		return "walk"
	return "run"


## Crossfade weights across the idle/walk/run continuum. Ramps linearly over
## BLEND_BAND either side of each boundary instead of a hard pop.
static func _locomotion_blend(speed: float) -> Dictionary:
	var idle_w := 0.0
	var walk_w := 0.0
	var run_w := 0.0

	var walk_band_end: float = IDLE_MAX_SPEED + BLEND_BAND
	var run_band_start: float = RUN_MIN_SPEED - BLEND_BAND

	if speed <= IDLE_MAX_SPEED:
		idle_w = 1.0
	elif speed < walk_band_end:
		var t: float = (speed - IDLE_MAX_SPEED) / BLEND_BAND
		idle_w = 1.0 - t
		walk_w = t
	elif speed <= run_band_start:
		walk_w = 1.0
	elif speed < RUN_MIN_SPEED:
		var t2: float = (speed - run_band_start) / BLEND_BAND
		walk_w = 1.0 - t2
		run_w = t2
	else:
		run_w = 1.0

	return {
		"idle": idle_w, "walk": walk_w, "run": run_w,
		"jump": 0.0, "fall": 0.0, "land": 0.0,
	}


## A blend Dictionary carrying the six canonical keys (all 0.0) plus `state`
## at weight 1.0 — `state` may be a locomotion label or an override action
## name (in which case it is added as a 7th key, not one of the six).
static func _single(state: String) -> Dictionary:
	var out := {"idle": 0.0, "walk": 0.0, "run": 0.0, "jump": 0.0, "fall": 0.0, "land": 0.0}
	out[state] = 1.0
	return out
