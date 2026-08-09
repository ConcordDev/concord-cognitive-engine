class_name LockOnState
extends RefCounted
## LockOnState — pure port of `LockOnController.tsx`'s Tab-cycle / T-hard-
## lock / release rules, decoupled from the engine so the state machine is
## unit-testable without a scene tree (same split as `AvatarManager`'s
## `nearest_target_id`/`candidates_in_radius`: this class owns the RULE,
## `player/character_controller.gd` owns reading real candidate data and
## polling real key state).
##
## Deliberately radius-only, no facing-cone filter — see
## `AvatarManager.candidates_in_radius`'s own doc comment for why: this
## client's local player `rotation.y` isn't currently driven by movement or
## camera look at all, so a cone check would be filtering against a yaw
## value that doesn't track where the player is actually looking. An
## honest, documented simplification, not a fabricated facing signal.
##
## `DEFAULT_LOCK_RADIUS_M`/`DEFAULT_CONE_HALF_ANGLE_RAD`'s value mirrors the
## TS reference's own `DEFAULT_LOCK_RADIUS = 25`; `HARD_LOCK_RELEASE_
## MULTIPLIER` mirrors its hard-lock release check (`dist > lockRadius * 2`).

const DEFAULT_LOCK_RADIUS_M := 25.0
const HARD_LOCK_RELEASE_MULTIPLIER := 2.0

var locked_id: String = ""
var lock_mode: String = ""  # "" | "soft" | "hard"
var _cycle_index: int = -1


## Cycle to the next candidate (Tab). `candidates`: Array of
## `{"id": String, ...}`, already radius-filtered + sorted nearest-first
## (`AvatarManager.candidates_in_radius`'s exact contract). Honest empty:
## clears the lock when there are no candidates — mirrors the TS
## reference's own `if (candidates.length === 0) { clearLockOnTarget();
## return; }` exactly, rather than leaving a stale lock on a now-empty list.
func cycle(candidates: Array) -> void:
	if candidates.is_empty():
		clear()
		return
	_cycle_index = (_cycle_index + 1) % candidates.size()
	locked_id = String(candidates[_cycle_index].get("id", ""))
	lock_mode = "soft"


## Toggle hard lock (T). Mirrors the TS reference's toggle semantics
## exactly: if ANY lock (soft or hard) is currently active, T clears it;
## otherwise it hard-locks the nearest candidate (index 0 of the already-
## sorted list).
func toggle_hard(candidates: Array) -> void:
	if not locked_id.is_empty():
		clear()
		return
	if candidates.is_empty():
		return
	locked_id = String(candidates[0].get("id", ""))
	lock_mode = "hard"


func clear() -> void:
	locked_id = ""
	lock_mode = ""
	_cycle_index = -1


## Per-frame release-rule check, mirroring the TS reference's own effect:
## a SOFT lock auto-releases the instant its target leaves the radius
## (`still_in_range` — the caller's THIS-frame `candidates_in_radius`
## membership check); a HARD lock holds through that but releases once the
## target is genuinely gone (`distance < 0.0` — the target no longer
## resolves to a live rig at all, e.g. despawned) or beyond
## `radius * HARD_LOCK_RELEASE_MULTIPLIER` (mirrors the TS `dist >
## lockRadius * 2` check). A no-op when nothing is locked.
func update_release(still_in_range: bool, distance: float, radius: float) -> void:
	if locked_id.is_empty():
		return
	if distance < 0.0:
		clear()
		return
	if lock_mode == "soft":
		if not still_in_range:
			clear()
	else:
		if distance > radius * HARD_LOCK_RELEASE_MULTIPLIER:
			clear()
