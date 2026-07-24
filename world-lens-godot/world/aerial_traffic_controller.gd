class_name AerialTrafficController
extends Node
## AerialTrafficController — Godot client for C16 (master-spec "ambient
## aerial traffic — non-empty sky").
##
## Consumes `world:aerial-traffic` frames (server/emergent/
## aerial-traffic-cycle.js + server/lib/aerial-traffic.js; shape pinned at
## server/lib/event-shapes.js's `"world:aerial-traffic"` entry) — a small,
## real, server-scheduled population of unowned background air entities
## (the `crosswind-courier` flavor, grounded in the real Crosswind Couriers
## faction/NPC already authored in content/world/concordia-hub/{factions,
## npcs}.json — see aerial-traffic.js's own header) flying real routes
## between the world's real landing pads.
##
## ── Composition, not reinvention: reuses SnapshotBuffer verbatim ──────────
## `net/snapshot_buffer.gd` is imported UNCHANGED — same class every other
## interpolated-entity consumer in this repo uses (avatar/avatar_manager.gd
## for city:positions/city:npcs). This controller does not add a second
## interpolation scheme; `ingest`/`sample` are called exactly as
## avatar_manager.gd already calls them.
##
## ── Wire-shape note (deliberately different from AvatarManager's) ─────────
## `avatar_manager.gd#ingest_snapshot` takes `entities: Dictionary`
## (pre-keyed by id) because ITS callers reshape the raw `users`/`npcs`
## arrays before calling in (that reshape is not yet wired anywhere in this
## repo — see VISUAL_QA.md, AvatarManager has no live caller today). This
## controller's own wire payload (`data.entities`) is a real Array of
## `{id, kind, x, y, z, heading}` dicts — the exact shape
## aerial-traffic-cycle.js emits — so `apply_snapshot` consumes the Array
## directly via the pure static `entities_to_states` below, rather than
## requiring a pre-keying step that doesn't reflect the actual wire shape.
##
## ── No separate despawn wire message — same convention as city:positions ──
## docs/GODOT_PROTOCOL.md marks `despawn_entity` PLANNED (no general Concord
## event names "this entity is gone" yet). This controller follows the SAME
## implicit-despawn convention `avatar_manager.gd` already established for
## city:positions/city:npcs: an id absent from STALE_TIMEOUT_MS worth of
## snapshots is treated as gone. Not a new pattern.
##
## ── Honest cadence caveat ──────────────────────────────────────────────────
## The server broadcasts on every due governor tick (~15s — the tightest
## granularity `registerHeartbeat` offers; see aerial-traffic-cycle.js's own
## header), far coarser than city:positions' ~100ms cadence SnapshotBuffer
## was originally tuned for (RENDER_DELAY_MS=120 / MAX_HORIZON_MS=250).
## Between two ~15s snapshots, `sample()`'s documented "hold last, never
## extrapolate" behavior means an entity visually holds its position for
## most of the interval rather than gliding continuously — an honest
## degrade (never fabricated smoothness), plausible for slow, distant,
## background sky traffic, but a genuine visual read that needs a real
## Godot binary to judge. Queued in VISUAL_QA.md, not guessed at.
##
## ── What this file does NOT build ──────────────────────────────────────────
## No mesh/MultiMesh/model spawn per entity — same "pure data layer, engine
## glue is a separate concern" split as SceneBootstrap's placeholder boxes.
## A future unit wiring visible geometry would read `sample()` + `kind_for()`
## each frame (exactly like AvatarManager's `_process` reads its own buffer)
## and instantiate/move a real mesh per id — not built here, no renderer to
## verify it against in this container.

const SnapshotBuffer := preload("res://net/snapshot_buffer.gd")

## Generous relative to the ~15s server broadcast cadence — several missed
## broadcasts in a row (not one slow tick) before an id is treated as gone.
const STALE_TIMEOUT_MS: int = 90_000

@export var world_id: String = "concordia-hub"

var _buffer: SnapshotBuffer
var _kind_by_id: Dictionary = {}
var _last_seen_ms: Dictionary = {}


func _ready() -> void:
	_buffer = SnapshotBuffer.new()


## Wire this to a live GatewayClient (same call boot.gd already makes for
## SceneBootstrap's scene:data path):
##   aerial_traffic.wire_gateway_events(gateway_client)
func wire_gateway_events(gateway: Node) -> void:
	if gateway.has_signal("event_received"):
		gateway.event_received.connect(_on_event)


func _on_event(evt: String, data: Dictionary) -> void:
	if evt == "world:aerial-traffic":
		apply_snapshot(data, Time.get_ticks_msec())


## Ingests one `world:aerial-traffic` payload. Ignores frames for a
## different world — a client only cares about the world it actually joined
## (same scoping boot.gd relies on by only ever requesting its own world's
## scene via `scene:request {worldId}`). Bookkeeping only, mirrors
## AvatarManager#ingest_snapshot's split: no engine calls happen here.
func apply_snapshot(data: Dictionary, now_ms: int) -> void:
	if String(data.get("worldId", "")) != world_id:
		return
	var entities: Array = data.get("entities", [])
	if entities.is_empty():
		return

	var parsed := AerialTrafficController.entities_to_states(entities)
	var states: Dictionary = parsed["states"]
	var kinds: Dictionary = parsed["kinds"]
	for id in states.keys():
		_kind_by_id[id] = kinds[id]
		_last_seen_ms[id] = now_ms

	_buffer.ingest(now_ms, states)


## Render-ready interpolated poses at `now_ms` — {id: [x,y,z,heading]}.
## Same call shape as AvatarManager's own `_buffer.sample(now_ms)`. A future
## renderer samples this once per frame; not built here (see class doc).
func sample(now_ms: int) -> Dictionary:
	return _buffer.sample(now_ms)


func kind_for(id: String) -> String:
	return String(_kind_by_id.get(id, ""))


## Drops ids that have not appeared in ANY snapshot for STALE_TIMEOUT_MS —
## the implicit-despawn convention documented above. Call once per frame
## (or on a slower timer) from a real _process once this is mounted.
func prune_stale(now_ms: int) -> void:
	var stale: Array = []
	for id in _last_seen_ms.keys():
		if AerialTrafficController.should_prune(int(_last_seen_ms[id]), now_ms, STALE_TIMEOUT_MS):
			stale.append(id)
	for id in stale:
		_last_seen_ms.erase(id)
		_kind_by_id.erase(id)


func active_ids() -> Array:
	return _last_seen_ms.keys()


# ── Pure static helpers (tested without a scene tree — tests/
#    test_aerial_traffic_controller.gd) ──────────────────────────────────────

## Splits a raw `entities` Array (server wire shape: [{id, kind, x, y, z,
## heading}, ...]) into the two Dictionaries this controller keeps:
## `states` (id -> [x,y,z,heading], the exact shape SnapshotBuffer.ingest
## expects) and `kinds` (id -> kind string). Entries missing an `id` are
## dropped — never fabricates an id. Never throws on malformed input.
static func entities_to_states(entities: Array) -> Dictionary:
	var states := {}
	var kinds := {}
	for e in entities:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		var id := String(e.get("id", ""))
		if id.is_empty():
			continue
		states[id] = [
			float(e.get("x", 0.0)),
			float(e.get("y", 0.0)),
			float(e.get("z", 0.0)),
			float(e.get("heading", 0.0)),
		]
		kinds[id] = String(e.get("kind", ""))
	return {"states": states, "kinds": kinds}


## Pure gate: has `last_seen_ms` aged past `timeout_ms` as of `now_ms`?
static func should_prune(last_seen_ms: int, now_ms: int, timeout_ms: int) -> bool:
	return (now_ms - last_seen_ms) > timeout_ms
