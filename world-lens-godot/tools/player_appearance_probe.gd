extends SceneTree
## player_appearance_probe.gd — real-engine verification for the Character
## archetype signal unit (2026-08-08): does a REAL PlayerAppearanceLoader,
## pointed at an ALREADY-RUNNING real backend, actually complete a real
## `POST /api/lens/run {domain:"appearance", name:"load_for_user"}` round
## trip and settle with a real archetype string (or a real, honest ""
## on auth failure / no saved appearance)? Exercises the real HTTPRequest
## POST + auth-header path + double-`ok` envelope unwrap +
## AppearanceArchetype.resolve_from_dict translation together — not mocks
## of any of them (test_player_appearance_loader.gd pins the pure request-
## body builder in isolation; test_appearance_archetype.gd pins the
## translator in isolation; this proves the WIRING actually fires against a
## real server, mirroring npc_poller_probe.gd's own framing).
##
## Requires an ALREADY-RUNNING server.js (this probe does not spawn/migrate
## one itself — same division of labor as every other probe in this
## directory). `appearance.load_for_user` reads `ctx?.actor?.userId`
## (server/domains/appearance.js) — an unset/wrong bearer token honestly
## settles with "" (a real macro-level `no_actor` failure, not a fabricated
## archetype), which this probe reports as a real, valid outcome rather
## than a probe failure; only a genuine timeout/transport error is treated
## as inconclusive.
##
## Headless is sufficient — no rendering claim, only real object-state
## settlement from a real HTTP round trip:
##   CONCORD_BACKEND_URL=http://127.0.0.1:5050 \
##   CONCORD_APPEARANCE_PROBE_AUTH_TOKEN=<a real bearer token, optional> \
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/player_appearance_probe.gd

const PlayerAppearanceLoader := preload("res://world/player_appearance_loader.gd")

var _loader: PlayerAppearanceLoader
var _frame := 0
var _max_frames := 400  # real network I/O + the loader's own 4s bounded timeout
var _settled := false
var _settled_archetype := ""
var _got_signal := false


func _initialize() -> void:
	var backend_url := OS.get_environment("CONCORD_BACKEND_URL")
	if backend_url == "":
		push_error("[player_appearance_probe] CONCORD_BACKEND_URL not set")
		print("[player_appearance_probe] RESULT ", JSON.stringify({"ok": false, "reason": "no_backend_url"}))
		quit(2)
		return
	var auth_token := OS.get_environment("CONCORD_APPEARANCE_PROBE_AUTH_TOKEN")

	_loader = PlayerAppearanceLoader.new()
	_loader.base_url = backend_url
	_loader.auth_token = auth_token
	_loader.settled.connect(_on_settled)
	get_root().add_child(_loader)
	_loader.fetch()


func _on_settled(archetype: String) -> void:
	_got_signal = true
	_settled = true
	_settled_archetype = archetype


func _process(_delta: float) -> bool:
	_frame += 1
	if not _settled and _frame < _max_frames:
		return false

	var result := {
		# A real settle (even to "") within the frame budget is success —
		# the CLAIM under test is "the loader genuinely reaches a real
		# terminal state from a real round trip," not "a specific archetype
		# string comes back" (that depends on the probe's own account
		# having a saved character, which this probe doesn't control).
		"ok": _got_signal,
		"settled_archetype": _settled_archetype,
		"timed_out_in_probe": not _got_signal,
		"frames_waited": _frame,
	}
	print("[player_appearance_probe] RESULT ", JSON.stringify(result))
	return true
