class_name SnapshotBuffer
extends RefCounted
## SnapshotBuffer — interpolation buffer for entity position/heading snapshots.
##
## Mirrors the Three.js client's netcode: the server streams ~100ms position
## snapshots (`city:positions`), and the client renders at `now - RENDER_DELAY_MS`
## so there is always a pair of snapshots to interpolate between. This smooths
## over jitter without inventing motion.
##
## PURE LOGIC — no scene tree, no engine singletons in the sampling path — so it
## is unit-testable. States are plain [x, y, z, heading] arrays; the math funcs
## (lerp_pos / lerp_heading) are static.

const RENDER_DELAY_MS: int = 120
const MAX_BUFFER: int = 32
## Never extrapolate beyond this past the newest snapshot — hold last instead.
const MAX_HORIZON_MS: int = 250

## Ring buffer of { "ts": int, "states": { id: [x,y,z,heading] } }, sorted by ts.
var _frames: Array = []


## Ingest a snapshot. `states` maps entity id → [x, y, z, heading_radians].
func ingest(ts_ms: int, states: Dictionary) -> void:
	_frames.append({"ts": ts_ms, "states": states})
	# Keep sorted by ts (snapshots usually arrive in order; insertion-sort tail).
	var i := _frames.size() - 1
	while i > 0 and _frames[i]["ts"] < _frames[i - 1]["ts"]:
		var tmp = _frames[i]
		_frames[i] = _frames[i - 1]
		_frames[i - 1] = tmp
		i -= 1
	while _frames.size() > MAX_BUFFER:
		_frames.pop_front()


## Sample all entity states at `now_ms - RENDER_DELAY_MS`.
## Returns { id: [x, y, z, heading] }. Empty if no data.
func sample(now_ms: int) -> Dictionary:
	if _frames.is_empty():
		return {}
	var target := now_ms - RENDER_DELAY_MS

	# Before the oldest frame → hold oldest.
	if target <= _frames[0]["ts"]:
		return (_frames[0]["states"] as Dictionary).duplicate(true)

	# After the newest frame → hold newest (never extrapolate past horizon).
	var newest: Dictionary = _frames[_frames.size() - 1]
	if target >= newest["ts"]:
		return (newest["states"] as Dictionary).duplicate(true)

	# Find the bracketing pair [a, b] with a.ts <= target < b.ts.
	var a: Dictionary = _frames[0]
	var b: Dictionary = newest
	for k in range(_frames.size() - 1):
		if _frames[k]["ts"] <= target and target < _frames[k + 1]["ts"]:
			a = _frames[k]
			b = _frames[k + 1]
			break

	var span: float = float(b["ts"] - a["ts"])
	var t: float = 0.0 if span <= 0.0 else clampf(float(target - a["ts"]) / span, 0.0, 1.0)

	var a_states: Dictionary = a["states"]
	var b_states: Dictionary = b["states"]
	var out := {}
	for id in a_states.keys():
		var pa: Array = a_states[id]
		if b_states.has(id):
			var pb: Array = b_states[id]
			out[id] = SnapshotBuffer._interp_state(pa, pb, t)
		else:
			# Entity vanished in the newer frame — hold its last known pose.
			out[id] = pa.duplicate()
	return out


func clear() -> void:
	_frames.clear()


# ── Pure static math ─────────────────────────────────────────────────────────

static func _interp_state(a: Array, b: Array, t: float) -> Array:
	var pos := SnapshotBuffer.lerp_pos(a, b, t)
	var heading := SnapshotBuffer.lerp_heading(float(a[3]), float(b[3]), t)
	return [pos[0], pos[1], pos[2], heading]


## Linear interpolation of two [x,y,z,...] arrays; returns [x,y,z].
static func lerp_pos(a: Array, b: Array, t: float) -> Array:
	return [
		lerpf(float(a[0]), float(b[0]), t),
		lerpf(float(a[1]), float(b[1]), t),
		lerpf(float(a[2]), float(b[2]), t),
	]


## Shortest-arc heading interpolation (radians). Handles wrap across ±PI.
static func lerp_heading(a: float, b: float, t: float) -> float:
	var diff := fposmod(b - a + PI, TAU) - PI
	return a + diff * t
