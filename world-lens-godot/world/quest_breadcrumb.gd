class_name QuestBreadcrumb
extends RefCounted
## QuestBreadcrumb — Phase Q. Pure port of
## concord-frontend/components/world/QuestTracker.tsx's `pickBreadcrumb`/
## `VERB_FOR`/breadcrumb-line logic — the "default to one line, J toggles
## the full list" design this whole client's Combat/NPC/creature phases have
## followed (port the real, already-shipped design; don't invent new UX).
## No engine/UI code here — see world/quest_breadcrumb_hud.gd for the
## Control node that renders this.
##
## One deliberate deviation from the TS source, noted for honesty:
## `obj.description ?? fallback` in TS uses nullish coalescing, so an
## explicit empty-string description would still win over the fallback verb
## (rendering a blank line). `breadcrumb_text` below treats an empty
## description the same as a missing one and falls back to the verb text —
## more robust for a plain single Label, and no authored quest content
## anywhere in content/quests/*.json actually ships an empty description,
## so this never changes real behavior today.

const VERB_FOR := {
	"kill": "Defeat",
	"gather": "Gather",
	"talk_to": "Speak with",
	"deliver": "Deliver to",
	"reach_location": "Travel to",
}


## Mirrors QuestTracker.tsx#pickBreadcrumb exactly: prefer a quest whose
## `progress` is non-empty AND every objective is complete (so the player
## gets the "claim reward" cue), pointing at its LAST progress entry;
## otherwise the first quest with an incomplete objective, pointing at that
## objective. `{}` when `quests` is empty or no quest has any resolvable
## progress at all (mirrors the TS `null` return).
static func pick_breadcrumb(quests: Array) -> Dictionary:
	for q in quests:
		if typeof(q) != TYPE_DICTIONARY:
			continue
		var progress = q.get("progress", null)
		if typeof(progress) != TYPE_ARRAY or progress.is_empty():
			continue
		if quest_all_done(q):
			return {"quest": q, "obj": progress[progress.size() - 1]}

	for q in quests:
		if typeof(q) != TYPE_DICTIONARY:
			continue
		var progress = q.get("progress", null)
		if typeof(progress) != TYPE_ARRAY:
			continue
		for o in progress:
			if typeof(o) == TYPE_DICTIONARY and not o.get("obj_completed_at", null):
				return {"quest": q, "obj": o}
	return {}


## Whether every objective in `quest.progress` is complete (drives the
## amber "reward ready" styling / text in the TS component). False for an
## empty/missing progress array — mirrors `quest.progress.length > 0 &&
## quest.progress.every(...)`.
static func quest_all_done(quest: Dictionary) -> bool:
	var progress = quest.get("progress", null)
	if typeof(progress) != TYPE_ARRAY or progress.is_empty():
		return false
	for o in progress:
		if typeof(o) != TYPE_DICTIONARY or not o.get("obj_completed_at", null):
			return false
	return true


## The single breadcrumb line's text, mirroring the TS template: "$title —
## Reward ready" when the whole quest is done, else the objective's own
## description, or "$Verb: $target" (VERB_FOR, falling back to "Do" for an
## unrecognized type — same fallback the TS `?? 'Do'` uses) with a
## "(cur/req)" suffix when `required_count > 1` (the TS renders that as a
## separate span; collapsed into the one line here for a plain Label).
static func breadcrumb_text(quest: Dictionary, objective: Dictionary) -> String:
	if quest.is_empty() or objective.is_empty():
		return ""
	if quest_all_done(quest):
		return "%s — Reward ready" % String(quest.get("title", ""))
	var desc := String(objective.get("description", ""))
	var verb: String
	if not desc.is_empty():
		verb = desc
	else:
		var obj_type := String(objective.get("type", ""))
		var v: String = VERB_FOR.get(obj_type, "Do")
		verb = "%s: %s" % [v, String(objective.get("target", ""))]
	var required := int(objective.get("required_count", 1))
	if required > 1:
		var current := int(objective.get("current_count", 0))
		verb += " (%d/%d)" % [current, required]
	return verb
