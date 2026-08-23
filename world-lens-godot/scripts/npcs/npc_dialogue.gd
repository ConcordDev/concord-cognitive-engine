class_name NpcDialogue
extends RefCounted
## NpcDialogue — pure walker for authored dialogue-tree.json files.
##
## Tree shape matches content/dialogues/* (greeting + nodes[] with
## id/npcText/playerOptions[{text,leadsTo}]/isTerminal).
## Files may be a single tree or a map of quest-phase keys → trees.

var raw: Dictionary = {}
var active: Dictionary = {}
var nodes_by_id: Dictionary = {}
var current_node_id: String = ""
var history: Array = []


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
	raw = data.duplicate(true)
	if data.has("nodes"):
		return _set_active(data)
	# keyed map — prefer idle / first
	for key in data.keys():
		var sk := str(key)
		if sk.find("idle") != -1 and typeof(data[key]) == TYPE_DICTIONARY:
			return _set_active(data[key])
	for key2 in data.keys():
		if typeof(data[key2]) == TYPE_DICTIONARY and data[key2].has("nodes"):
			return _set_active(data[key2])
	return false


func _set_active(tree: Dictionary) -> bool:
	active = tree.duplicate(true)
	nodes_by_id.clear()
	history.clear()
	current_node_id = ""
	var nodes = active.get("nodes", [])
	if typeof(nodes) != TYPE_ARRAY or nodes.is_empty():
		return false
	for n in nodes:
		if typeof(n) != TYPE_DICTIONARY:
			continue
		var id := str(n.get("id", ""))
		if id != "":
			nodes_by_id[id] = n
	if nodes_by_id.is_empty():
		return false
	# open node preference
	for cand in ["node_open", "node_1", "node_1_open", str(nodes[0].get("id", ""))]:
		if nodes_by_id.has(cand):
			current_node_id = cand
			break
	if current_node_id == "":
		current_node_id = str(nodes_by_id.keys()[0])
	history.append(current_node_id)
	return true


func greeting() -> String:
	return str(active.get("greeting", ""))


func current_node() -> Dictionary:
	if nodes_by_id.has(current_node_id):
		return (nodes_by_id[current_node_id] as Dictionary).duplicate(true)
	return {}


func current_text() -> String:
	var n := current_node()
	return str(n.get("npcText", n.get("text", "")))


func current_options() -> Array:
	var n := current_node()
	var opts = n.get("playerOptions", n.get("options", []))
	return opts if typeof(opts) == TYPE_ARRAY else []


func is_terminal() -> bool:
	var n := current_node()
	if bool(n.get("isTerminal", false)):
		return true
	return current_options().is_empty()


func choose(option_index: int) -> Dictionary:
	var opts := current_options()
	if option_index < 0 or option_index >= opts.size():
		return current_node()
	var opt = opts[option_index]
	if typeof(opt) != TYPE_DICTIONARY:
		return current_node()
	var leads := str(opt.get("leadsTo", opt.get("next", "")))
	if leads != "" and nodes_by_id.has(leads):
		current_node_id = leads
		history.append(leads)
	return current_node()


func choose_leads_to(node_id: String) -> Dictionary:
	if nodes_by_id.has(node_id):
		current_node_id = node_id
		history.append(node_id)
	return current_node()


func node_count() -> int:
	return nodes_by_id.size()


func reset() -> void:
	if not raw.is_empty():
		load_from_dict(raw)
