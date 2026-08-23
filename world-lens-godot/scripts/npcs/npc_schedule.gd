class_name NpcSchedule
extends RefCounted
## NpcSchedule — pure loader/query for authored per-NPC schedule.json.
##
## Schedule files live at res://data/npcs/<npc_id>/schedule.json and use the
## same day-segment vocabulary as server/lib/npc-schedules.js
## (dawn/morning/midday/afternoon/dusk/night), plus optional hub phase labels
## (Dominus/Stratus/Freeus/Quartus/Penanus/Solnus) for concordia-hub NPCs.
##
## No engine calls — unit-testable via preload + new().

const SEGMENTS := ["dawn", "morning", "midday", "afternoon", "dusk", "night"]

## Hub diurnal phases (content/world/concordia-hub/npcs.json) → day segment.
const HUB_PHASE_TO_SEGMENT := {
	"Dominus": "dawn",
	"Stratus": "morning",
	"Freeus": "midday",
	"Quartus": "afternoon",
	"Penanus": "dusk",
	"Solnus": "night",
}

var npc_id: String = ""
var home_location: String = ""
var default_behavior: String = "idle"
## segment -> {behavior, location, activity, interactable}
var _by_segment: Dictionary = {}
## raw blocks for debugging / UI
var blocks: Array = []


func load_from_path(path: String) -> bool:
	if path == "" or not FileAccess.file_exists(path):
		return false
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return false
	var parsed = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		return false
	return load_from_dict(parsed)


func load_from_dict(data: Dictionary) -> bool:
	npc_id = str(data.get("npc_id", data.get("id", "")))
	home_location = str(data.get("home_location", data.get("home", "")))
	default_behavior = str(data.get("default_behavior", "idle"))
	_by_segment.clear()
	blocks.clear()

	# Compact map form: {"morning": {"behavior":"work","location":"archive"}, ...}
	var compact = data.get("schedule", null)
	if typeof(compact) == TYPE_DICTIONARY:
		for seg in SEGMENTS:
			if compact.has(seg):
				_by_segment[seg] = _normalize_entry(compact[seg], seg)

	# Block list form (hub daily_schedule / authored blocks)
	var raw_blocks = data.get("blocks", data.get("daily_schedule", []))
	if typeof(raw_blocks) == TYPE_ARRAY:
		for item in raw_blocks:
			if typeof(item) != TYPE_DICTIONARY:
				continue
			var entry := _normalize_entry(item, str(item.get("phase", item.get("segment", ""))))
			blocks.append(entry)
			var seg2 := str(entry.get("segment", ""))
			if seg2 != "":
				_by_segment[seg2] = entry

	# locations map (server schedule_locations style)
	var locs = data.get("schedule_locations", null)
	if typeof(locs) == TYPE_DICTIONARY:
		for seg in _by_segment.keys():
			var beh := str(_by_segment[seg].get("behavior", ""))
			if str(_by_segment[seg].get("location", "")) == "" and locs.has(beh):
				_by_segment[seg]["location"] = str(locs[beh])

	return not _by_segment.is_empty() or not blocks.is_empty()


func _normalize_entry(raw, phase_hint: String) -> Dictionary:
	var out := {
		"segment": "",
		"behavior": default_behavior,
		"location": home_location,
		"activity": "",
		"interactable": true,
	}
	if typeof(raw) == TYPE_STRING:
		out["behavior"] = str(raw)
		out["segment"] = _phase_to_segment(phase_hint)
		return out
	if typeof(raw) != TYPE_DICTIONARY:
		out["segment"] = _phase_to_segment(phase_hint)
		return out
	var d: Dictionary = raw
	var phase := str(d.get("phase", d.get("segment", phase_hint)))
	out["segment"] = _phase_to_segment(phase)
	out["behavior"] = str(d.get("behavior", d.get("activity_kind", default_behavior)))
	out["location"] = str(d.get("location", home_location))
	out["activity"] = str(d.get("activity", d.get("activity_kind", "")))
	if d.has("interactable_by_player"):
		out["interactable"] = bool(d.get("interactable_by_player"))
	elif d.has("interactable"):
		out["interactable"] = bool(d.get("interactable"))
	# If behavior still looks like prose activity, keep a coarse token.
	if out["behavior"] == default_behavior and out["activity"] != "":
		out["behavior"] = _activity_to_behavior(str(out["activity"]))
	return out


func _phase_to_segment(phase: String) -> String:
	if phase in SEGMENTS:
		return phase
	if HUB_PHASE_TO_SEGMENT.has(phase):
		return str(HUB_PHASE_TO_SEGMENT[phase])
	# hour-range fallbacks not handled here — caller passes named phases.
	return phase.to_lower() if phase != "" else ""


func _activity_to_behavior(activity: String) -> String:
	var a := activity.to_lower()
	if "sleep" in a or "rest" in a:
		return "rest"
	if "patrol" in a or "watch" in a or "guard" in a:
		return "patrol"
	if "trade" in a or "market" in a or "sell" in a:
		return "trade"
	if "social" in a or "supper" in a or "inn" in a or "greet" in a:
		return "socialize"
	if "train" in a or "practice" in a:
		return "train"
	if "travel" in a or "crossing" in a or "errand" in a or "walk" in a:
		return "travel"
	if "work" in a or "audit" in a or "catalog" in a or "index" in a \
			or "round" in a or "clinic" in a or "dispatch" in a or "sort" in a \
			or "feed" in a or "brush" in a or "journal" in a or "track" in a \
			or "mix" in a or "audience" in a or "letter" in a:
		return "work"
	return "work"


func entry_for_segment(segment: String) -> Dictionary:
	if _by_segment.has(segment):
		return (_by_segment[segment] as Dictionary).duplicate(true)
	return {
		"segment": segment,
		"behavior": default_behavior,
		"location": home_location,
		"activity": "",
		"interactable": true,
	}


func behavior_for_segment(segment: String) -> String:
	return str(entry_for_segment(segment).get("behavior", default_behavior))


func location_for_segment(segment: String) -> String:
	return str(entry_for_segment(segment).get("location", home_location))


func is_interactable(segment: String) -> bool:
	return bool(entry_for_segment(segment).get("interactable", true))


func segment_for_hour(hour: int) -> String:
	## Local civil-hour helper (0..23). Matches common CRPG day splits.
	var h := posmod(hour, 24)
	if h >= 5 and h < 7:
		return "dawn"
	if h >= 7 and h < 11:
		return "morning"
	if h >= 11 and h < 14:
		return "midday"
	if h >= 14 and h < 17:
		return "afternoon"
	if h >= 17 and h < 21:
		return "dusk"
	return "night"
