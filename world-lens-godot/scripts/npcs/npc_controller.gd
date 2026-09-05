class_name NpcController
extends Node3D
## NpcController — authored hub NPC root.
##
## Each scenes/npcs/<id>.tscn specializes this controller with identity
## exports, palette, spawn pose, and paths to
## data/npcs/<id>/{dialogue-tree,schedule,faction-affinity}.json.
##
## Presentation: ProceduralNpcMesh (capsule humanoid). Locomotion clip
## selection reuses avatar/animation_state_machine.gd (pure). Schedule is
## pure via NpcSchedule. No network I/O — NpcPoller remains the live
## population feed; these scenes are authored set-dressing / interact
## anchors for the Concordia hub tableau and dialogue system.

const ProceduralNpcMeshScript := preload("res://scripts/npcs/procedural_npc_mesh.gd")
const NpcScheduleScript := preload("res://scripts/npcs/npc_schedule.gd")
const AnimSM := preload("res://avatar/animation_state_machine.gd")

@export var npc_id: String = ""
@export var display_name: String = ""
@export var title: String = ""
@export var faction_id: String = ""
@export var archetype: String = "scholar"
@export var world_id: String = "concordia-hub"
@export var body_color: Color = Color(0.45, 0.42, 0.40, 1.0)
@export var accent_color: Color = Color(0.55, 0.50, 0.45, 1.0)
@export var body_height: float = 1.8
@export var dialogue_path: String = ""
@export var schedule_path: String = ""
@export var faction_affinity_path: String = ""
@export var default_segment: String = "morning"
@export var idle_bob: bool = true

signal dialogue_ready(tree: Dictionary)
signal schedule_changed(segment: String, entry: Dictionary)
signal affinity_ready(affinity: Dictionary)

var schedule: RefCounted = null
var dialogue_tree: Dictionary = {}
var faction_affinity: Dictionary = {}
var current_segment: String = "morning"
var current_anim_state: String = "idle"
var _mesh: Node3D = null
var _label: Label3D = null
var _bob_t: float = 0.0
var _data_loaded: bool = false


func _ready() -> void:
	_ensure_paths()
	_build_visual()
	_load_all_data()
	current_segment = default_segment
	apply_segment(current_segment)


func _ensure_paths() -> void:
	if npc_id == "":
		return
	var base := "res://data/npcs/%s" % npc_id
	if dialogue_path == "":
		dialogue_path = "%s/dialogue-tree.json" % base
	if schedule_path == "":
		schedule_path = "%s/schedule.json" % base
	if faction_affinity_path == "":
		faction_affinity_path = "%s/faction-affinity.json" % base


func _build_visual() -> void:
	_mesh = ProceduralNpcMeshScript.new()
	_mesh.name = "Mesh"
	_mesh.body_color = body_color
	_mesh.accent_color = accent_color
	_mesh.height = body_height
	add_child(_mesh)

	_label = Label3D.new()
	_label.name = "Nameplate"
	_label.text = _nameplate_text()
	_label.font_size = 22
	_label.modulate = accent_color.lightened(0.25)
	_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label.position = Vector3(0.0, body_height + 0.55, 0.0)
	add_child(_label)

	set_meta("npc_id", npc_id)
	set_meta("display_name", display_name)
	set_meta("faction_id", faction_id)
	set_meta("archetype", archetype)
	set_meta("world_id", world_id)
	set_meta("hub_feature", "authored_npc")


func _nameplate_text() -> String:
	if title != "":
		return "%s\n%s" % [display_name, title]
	return display_name if display_name != "" else npc_id


func _load_all_data() -> void:
	schedule = NpcScheduleScript.new()
	var sched_ok := false
	if schedule_path != "":
		sched_ok = schedule.load_from_path(schedule_path)
	if not sched_ok:
		schedule.load_from_dict({
			"npc_id": npc_id,
			"home_location": "hub_great_plaza",
			"default_behavior": "idle",
			"schedule": {"morning": {"behavior": "work", "location": "hub_great_plaza"}},
		})

	dialogue_tree = _load_json_dict(dialogue_path)
	if not dialogue_tree.is_empty():
		dialogue_ready.emit(dialogue_tree)

	faction_affinity = _load_json_dict(faction_affinity_path)
	if not faction_affinity.is_empty():
		affinity_ready.emit(faction_affinity)

	_data_loaded = true


func _load_json_dict(path: String) -> Dictionary:
	if path == "" or not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var parsed = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	return parsed


func apply_segment(segment: String) -> Dictionary:
	current_segment = segment
	var entry: Dictionary = schedule.entry_for_segment(segment) if schedule else {}
	var behavior := str(entry.get("behavior", "idle"))
	current_anim_state = _behavior_to_anim(behavior)
	schedule_changed.emit(segment, entry)
	return entry


func apply_hour(hour: int) -> Dictionary:
	if schedule == null:
		return {}
	var seg: String = schedule.segment_for_hour(hour)
	return apply_segment(seg)


func _behavior_to_anim(behavior: String) -> String:
	match behavior:
		"travel", "patrol":
			return "walk"
		"rest":
			return "idle"
		_:
			return "idle"


func get_dialogue_tree() -> Dictionary:
	return dialogue_tree.duplicate(true)


func get_primary_dialogue() -> Dictionary:
	## Prefer idle tree; fall back to first value if keyed map.
	if dialogue_tree.has("nodes"):
		return dialogue_tree.duplicate(true)
	for k in dialogue_tree.keys():
		var v = dialogue_tree[k]
		if typeof(v) == TYPE_DICTIONARY and v.has("nodes"):
			return (v as Dictionary).duplicate(true)
	return {}


func get_affinity(faction: String) -> float:
	var table = faction_affinity.get("affinities", faction_affinity.get("factions", {}))
	if typeof(table) != TYPE_DICTIONARY:
		return 0.0
	if table.has(faction):
		var v = table[faction]
		if typeof(v) == TYPE_DICTIONARY:
			return float(v.get("value", v.get("score", 0.0)))
		return float(v)
	return float(faction_affinity.get("default", 0.0))


func get_current_location() -> String:
	if schedule == null:
		return ""
	return schedule.location_for_segment(current_segment)


func get_current_behavior() -> String:
	if schedule == null:
		return "idle"
	return schedule.behavior_for_segment(current_segment)


func is_interactable_now() -> bool:
	if schedule == null:
		return true
	return schedule.is_interactable(current_segment)


func select_locomotion(speed: float = 0.0) -> Dictionary:
	## Thin wrapper over AnimationStateMachine for idle/walk bobbing.
	var input := {"speed": speed if speed > 0.0 else (1.4 if current_anim_state == "walk" else 0.0)}
	return AnimSM.select_state(input)


func _process(delta: float) -> void:
	if not idle_bob or _mesh == null:
		return
	_bob_t += delta
	var amp := 0.012 if current_anim_state == "idle" else 0.03
	var freq := 1.6 if current_anim_state == "idle" else 6.0
	_mesh.position.y = sin(_bob_t * freq) * amp
