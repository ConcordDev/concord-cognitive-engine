class_name CreatureManager
extends Node
## CreatureManager — Phase M3. Spawns/updates CreatureRig puppets for the
## live creature population (server/lib/fauna-spawner.js /
## server/emergent/creature-behaviors.js, read via world/creature_poller.gd's
## 4s poll of the `creatures.for_world` macro).
##
## ── Why a SEPARATE manager, not AvatarManager.ingest_snapshot(..., "creature") ──
## `avatar/avatar_manager.gd#_spawn_rig` COLLAPSES any non-"player" kind down
## to "npc" (`rig.kind = "player" if ... == "player" else "npc"`) — so
## feeding creatures through it would silently route them through
## `AvatarRig`'s HUMANOID pipeline: hero-mesh archetype resolution
## (`assets/asset_resolver.gd#fallback_url`'s `kind == "player" or kind ==
## "npc"` branch), the 14-bone `bone_specs()` capsule chain, two-bone-IK
## gait, and (if `attach_weapon` were ever true on this path) weapon-in-hand
## — every one of which is architecturally wrong for a fox/bird/fish (real
## creature fields — topology/clade/diet/aquatic — confirm these are fauna,
## not humanoids). That would be a SILENT rendering bug (creatures reading
## as generic humanoid NPCs), not an honest failure. This class and
## world/creature_rig.gd exist specifically so that never happens —
## `AvatarManager`/`AvatarRig` are deliberately left untouched by this unit,
## and creatures never pass through them.
##
## Reuses net/snapshot_buffer.gd for interpolation (same class
## AvatarManager uses — it's kind-agnostic RefCounted, safe to instantiate a
## second independent instance with zero coupling to AvatarManager's own).

const SnapshotBuffer := preload("res://net/snapshot_buffer.gd")
const CreatureRig := preload("res://world/creature_rig.gd")

## ~3x creature_poller.gd's 4s poll interval — generous enough to absorb one
## dropped/slow poll cycle. A SEPARATE, independent constant from
## AvatarManager.STALE_TIMEOUT_MS_NPC/_PLAYER on purpose — adding a third
## branch there would re-couple the two systems this split exists to keep
## apart.
const STALE_TIMEOUT_MS_CREATURE: int = 12000

## Backend-origin (unused directly by this class — kept for symmetry/
## threading to spawned rigs' own asset-fetch base_url, mirroring
## AvatarManager.base_url's own role).
@export var base_url: String = "http://127.0.0.1:3000"
@export var world_id: String = ""

var _buffer := SnapshotBuffer.new()
var _rigs: Dictionary = {}          # id -> CreatureRig
var _last_seen_ms: Dictionary = {}  # id -> ms of last snapshot mention


## Ingest one `creatures.for_world` payload, already translated by
## creature_poller.gd#creatures_array_to_entities into
## `{id -> {x,y,z,topology,species_id,coatColor}}`. `kind` is accepted for
## signature symmetry with AvatarManager.ingest_snapshot (always "creature"
## here — no second kind is expected through this manager).
func ingest_snapshot(now_ms: int, entities: Dictionary, _kind: String) -> void:
	var states := {}
	for id in entities.keys():
		var e: Dictionary = entities[id]
		states[id] = [float(e.get("x", 0.0)), float(e.get("y", 0.0)), float(e.get("z", 0.0)), 0.0]
		_last_seen_ms[id] = now_ms
		if not _rigs.has(id):
			_spawn_rig(id, e)
	_buffer.ingest(now_ms, states)


func _process(_delta: float) -> void:
	var now_ms := Time.get_ticks_msec()
	var sampled := _buffer.sample(now_ms)
	for id in sampled.keys():
		if not _rigs.has(id):
			continue
		var state: Array = sampled[id]
		var rig: CreatureRig = _rigs[id]
		rig.apply_transform(Vector3(state[0], state[1], state[2]))
	_despawn_stale(now_ms)


func _spawn_rig(id: String, entity: Dictionary) -> void:
	var rig := CreatureRig.new()
	rig.creature_id = id
	rig.topology = String(entity.get("topology", "quadruped"))
	rig.species_id = String(entity.get("species_id", ""))
	rig.coat_color = String(entity.get("coatColor", ""))
	rig.base_url = base_url
	add_child(rig)
	_rigs[id] = rig


func _despawn_stale(now_ms: int) -> void:
	var stale: Array = []
	for id in _rigs.keys():
		var seen: int = _last_seen_ms.get(id, 0)
		if now_ms - seen > STALE_TIMEOUT_MS_CREATURE:
			stale.append(id)
	for id in stale:
		var rig = _rigs[id]
		if is_instance_valid(rig):
			rig.queue_free()
		_rigs.erase(id)
		_last_seen_ms.erase(id)
