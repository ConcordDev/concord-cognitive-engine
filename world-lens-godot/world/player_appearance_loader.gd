class_name PlayerAppearanceLoader
extends Node
## PlayerAppearanceLoader — Character archetype signal (2026-08-08).
##
## One real, one-shot `POST /api/lens/run {domain:"appearance",
## name:"load_for_user"}` fetch (the SAME macro `app/onboarding/character/
## page.tsx` and the world page both already call) for the LOCAL player's
## saved RichAppearanceConfig, resolved into a real hero-mesh archetype via
## `avatar/appearance_archetype.gd`. See that file's class doc for why this
## reads the macro directly rather than porting the web client's own
## (confirmed lossy) local merge.
##
## Bounded, never blocks world entry: `settled` fires EXACTLY ONCE, either
## from a real HTTP response or from `TIMEOUT_S` elapsing first — whichever
## comes first. A timed-out/failed/no-saved-appearance outcome emits `""`
## (honest empty — `world/boot.gd` falls back to AvatarRig's own default
## "warrior"), never a fabricated archetype.
##
## Remote avatars are explicitly OUT OF SCOPE here: `city:positions` (the
## only live per-player broadcast) carries no appearance/archetype field at
## all — adding one would be a real new backend-surface decision, the same
## class of call Phase N's own class doc flags before building rather than
## silently assuming. This unit is local-player-only, same "smallest
## honest slice" scoping as every other phase this session.

signal settled(archetype: String)

const AppearanceArchetype := preload("res://avatar/appearance_archetype.gd")

@export var base_url: String = "http://127.0.0.1:5050"
@export var auth_token: String = ""
## Bounded wait so a slow/hung backend can never delay world entry
## indefinitely — the appearance signal is a nicety, not a blocker.
const TIMEOUT_S := 4.0

var _settled_flag: bool = false
var _timer: Timer = null


func fetch() -> void:
	if _settled_flag:
		return

	_timer = Timer.new()
	_timer.wait_time = TIMEOUT_S
	_timer.one_shot = true
	add_child(_timer)
	_timer.timeout.connect(_on_timeout)
	_timer.start()

	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_request_completed.bind(req))

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth_token != "":
		headers.append("Authorization: Bearer %s" % auth_token)

	var body := JSON.stringify(build_request_body())
	var err := req.request("%s/api/lens/run" % base_url, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		req.queue_free()
		_settle("")


func _on_timeout() -> void:
	_settle("")


func _on_request_completed(
		result: int, code: int, _headers: PackedStringArray,
		response_body: PackedByteArray, req: HTTPRequest) -> void:
	req.queue_free()
	if _settled_flag:
		return  # the timeout already fired first — honest, don't double-emit.

	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_settle("")
		return

	var parsed = JSON.parse_string(response_body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY or not bool(parsed.get("ok", false)):
		_settle("")
		return

	# Double-`ok` envelope — see creature_poller.gd's class doc for the full
	# reasoning. `appearance.load_for_user` returns `{ok, appearance}`
	# directly (not pre-wrapped), so the real wire shape here is
	# `{ok:true, result:{ok:true, appearance:{...}|null}}`.
	var inner = parsed.get("result", {})
	var inner_dict: Dictionary = inner if typeof(inner) == TYPE_DICTIONARY else {}
	if not bool(inner_dict.get("ok", false)):
		# A real macro-level failure (e.g. `no_actor` on an unauthenticated
		# request) — honest empty, not a fabricated archetype.
		_settle("")
		return

	var archetype := AppearanceArchetype.resolve_from_dict(inner_dict.get("appearance"))
	_settle(archetype)


func _settle(archetype: String) -> void:
	if _settled_flag:
		return
	_settled_flag = true
	if _timer != null and is_instance_valid(_timer):
		_timer.stop()
		_timer.queue_free()
		_timer = null
	settled.emit(archetype)


## Body for `POST /api/lens/run` — matches the exact envelope every macro
## caller in this codebase uses (mirrors CreaturePoller.build_for_world_
## request_body / DtuPropRenderer.build_list_request_body).
static func build_request_body() -> Dictionary:
	return {"domain": "appearance", "name": "load_for_user", "input": {}}
