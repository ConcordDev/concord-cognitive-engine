class_name NpcFactionAffinity
extends RefCounted
## NpcFactionAffinity — pure loader for faction-affinity.json.
##
## Scores are -1.0..+1.0 (hostile..devoted), matching the frontend demeanor
## ladder in concord-frontend/lib/concordia/npc-demeanor.ts.

var npc_id: String = ""
var primary_faction: String = ""
var default_score: float = 0.0
var affinities: Dictionary = {}  # faction_id -> float
var notes: Dictionary = {}       # faction_id -> String


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
	primary_faction = str(data.get("primary_faction", data.get("faction_id", "")))
	default_score = float(data.get("default", data.get("default_score", 0.0)))
	affinities.clear()
	notes.clear()
	var table = data.get("affinities", data.get("factions", {}))
	if typeof(table) != TYPE_DICTIONARY:
		return primary_faction != ""
	for k in table.keys():
		var fk := str(k)
		var v = table[k]
		if typeof(v) == TYPE_DICTIONARY:
			affinities[fk] = float(v.get("value", v.get("score", 0.0)))
			if v.has("note") or v.has("notes"):
				notes[fk] = str(v.get("note", v.get("notes", "")))
		else:
			affinities[fk] = float(v)
	return not affinities.is_empty() or primary_faction != ""


func score(faction: String) -> float:
	if affinities.has(faction):
		return float(affinities[faction])
	if faction == primary_faction and primary_faction != "":
		return 0.85
	return default_score


func note_for(faction: String) -> String:
	return str(notes.get(faction, ""))


func demeanor_for(faction: String) -> String:
	## Mirrors resolveDemeanor net bands at a glance (no grudge/gratitude here).
	var s := score(faction)
	if s <= -0.75:
		return "hostile"
	if s <= -0.35:
		return "wary"
	if s < -0.1:
		return "cold"
	if s >= 0.75:
		return "devoted"
	if s >= 0.35:
		return "warm"
	return "neutral"


func as_dict() -> Dictionary:
	return {
		"npc_id": npc_id,
		"primary_faction": primary_faction,
		"default": default_score,
		"affinities": affinities.duplicate(true),
		"notes": notes.duplicate(true),
	}
