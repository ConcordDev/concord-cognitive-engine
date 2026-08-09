extends SceneTree
## sfx_gameplay_wiring_probe.gd — real-engine verification that the audio
## wiring landed in player/character_controller.gd (2026-08-08) actually
## fires on a REAL SfxPlayer, not just that the source compiles. Exercises:
## _try_attack/_try_kick/_try_parry/_try_dodge's immediate-on-input SFX,
## _update_footsteps' stride-accumulator trigger, and _on_combat_hit's
## layered light/heavy/crit/kill severity selection (ported from
## GameJuice.tsx's real rule) — each against a real
## `CharacterController` + real `SfxPlayer` inside a real SceneTree, with a
## minimal fake gateway (records `send_event` calls; this probe is about
## the AUDIO wiring, the `combat:attack` transport itself is already
## covered by tests/test_character_controller.gd's pure-function suite and
## the Combat Phase C probes).
##
## Severity tiers share their first (0ms-delay) layer step
## ('hit-transient'), so verifying heavy/crit/kill can't just check "did
## the cache grow right after the call" — their DISTINCTIVE later voices
## ('hit-heavy'/'bone-crack'+'hit-crit'/'kill-blow'+'rumble') are on real,
## async `SceneTree.create_timer` delays (mirrors the TS reference's own
## setTimeout-based layering) and only get generated+cached once those
## timers actually fire. This probe waits real frames (same pattern
## tools/sfx_player_probe.gd already proved works for a layered SFX) and
## then checks for the EXACT expected cache key, not just "cache grew".
##
## Run:
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/sfx_gameplay_wiring_probe.gd

const CharacterController := preload("res://player/character_controller.gd")
const SfxPlayer := preload("res://audio/sfx_player.gd")

## Minimal fake gateway — real `has_method("send_event")` contract,
## records calls instead of touching a real network (this probe verifies
## the AUDIO side effect, not the transport).
class FakeGateway extends Node:
	var sent: Array = []
	func send_event(evt: String, data: Dictionary) -> void:
		sent.append({"evt": evt, "data": data})


var _controller: CharacterController
var _sfx: SfxPlayer
var _gateway: FakeGateway
var _frame := 0
var _result := {}


## The controller is a real CharacterBody3D driving its own physics-tick
## `player:move` telemetry independently of these direct method calls (it's
## genuinely in the tree), so `_gateway.sent` can carry an interleaved
## `player:move` alongside whatever this probe triggered — search for the
## expected event rather than assuming array size/order.
func _find_sent(evt: String) -> Variant:
	for s in _gateway.sent:
		if s["evt"] == evt:
			return s
	return null


func _any_pool_player_playing() -> bool:
	for p in _sfx._pool:
		if p.playing:
			return true
	return false


func _initialize() -> void:
	_gateway = FakeGateway.new()
	get_root().add_child(_gateway)

	_sfx = SfxPlayer.new()
	get_root().add_child(_sfx)

	_controller = CharacterController.new()
	_controller.gateway = _gateway
	_controller.sfx_player = _sfx
	# Real hand-body collision isn't needed for these calls — none of
	# _try_attack/_try_kick/_try_parry/_try_dodge/_on_combat_hit touch
	# physics state, only gateway + sfx_player + `_current_target_id`.
	get_root().add_child(_controller)
	# Set directly (GDScript has no real privacy enforcement on `_`-prefixed
	# members) — mirrors what `_update_target()` would do once a real
	# AvatarManager reports a target in range; not re-deriving that
	# selection logic here since it's already covered elsewhere.
	_controller._current_target_id = "npc-probe-target"


func _process(_delta: float) -> bool:
	_frame += 1

	if _frame == 2:
		# 1. E-attack — immediate 'combat-swing' on a real pool player.
		_controller._try_attack()
		var sent = _find_sent("combat:attack")
		_result["attack_sent"] = sent != null and sent["data"].get("style") == "attack-light"
		_result["attack_sfx_played"] = _any_pool_player_playing()
		return false

	if _frame == 3:
		# 2. F-parry — 'block-clang', untargeted (works even though a target
		# is set — parry never reads _current_target_id).
		_gateway.sent.clear()
		for p in _sfx._pool:
			p.stop()
		_controller._try_parry()
		var parry_sent = _find_sent("combat:dodge")
		_result["parry_sent"] = parry_sent != null and parry_sent["data"].get("wasParry") == true
		_result["parry_sfx_played"] = _any_pool_player_playing()
		return false

	if _frame == 4:
		# 3. Q-dodge — 'dodge-whoosh', untargeted, wasParry:false.
		_gateway.sent.clear()
		for p in _sfx._pool:
			p.stop()
		_controller._try_dodge()
		var dodge_sent = _find_sent("combat:dodge")
		_result["dodge_sent"] = dodge_sent != null and dodge_sent["data"].get("wasParry") == false
		_result["dodge_sfx_played"] = _any_pool_player_playing()
		return false

	if _frame == 5:
		# 4. R-kick — targeted (needs _current_target_id, already set),
		# 'combat-swing-heavy'.
		_gateway.sent.clear()
		for p in _sfx._pool:
			p.stop()
		_controller._try_kick()
		var kick_sent = _find_sent("combat:attack")
		_result["kick_sent"] = kick_sent != null and kick_sent["data"].get("style") == "kick"
		_result["kick_sfx_played"] = _any_pool_player_playing()
		return false

	if _frame == 6:
		# 5. R-kick with NO target — honest no-op, zero gateway calls, zero
		# SFX (never a fabricated request/sound).
		_gateway.sent.clear()
		for p in _sfx._pool:
			p.stop()
		_controller._current_target_id = ""
		_controller._try_kick()
		_result["kick_no_target_honest_noop"] = _find_sent("combat:attack") == null
		_result["kick_no_target_sfx_played"] = _any_pool_player_playing()
		_controller._current_target_id = "npc-probe-target"
		return false

	if _frame == 7:
		# 6. _on_combat_hit severity selection. All four tiers share a
		# 0ms-delay 'hit-transient' first step (already cached by frame's
		# end regardless of tier), so what actually distinguishes a tier is
		# its LATER, distinctive voice(s) — checked at frame 200 below,
		# once their real async timers have had time to fire.
		_controller._on_combat_hit({
			"targetId": "npc-probe-target", "targetHealth": 40.0,
			"targetMaxHealth": 100.0, "damage": 8.0, "isCrit": false,
			"targetKilled": false,
		})  # light
		_controller._on_combat_hit({
			"targetId": "npc-probe-target", "targetHealth": 10.0,
			"targetMaxHealth": 100.0, "damage": 40.0, "isCrit": false,
			"targetKilled": false,
		})  # heavy
		_controller._on_combat_hit({
			"targetId": "npc-probe-target", "targetHealth": 5.0,
			"targetMaxHealth": 100.0, "damage": 8.0, "isCrit": true,
			"targetKilled": false,
		})  # crit
		_controller._on_combat_hit({
			"targetId": "npc-probe-target", "targetHealth": 0.0,
			"targetMaxHealth": 100.0, "damage": 8.0, "isCrit": false,
			"targetKilled": true,
		})  # kill
		_result["hit_transient_cached_immediately"] = _sfx._stream_cache.has("hit-transient@100")

		# Wrong target — must NOT trigger anything (real filter, not a
		# fabricated always-play). Checked immediately: a real no-op leaves
		# no new cache entries and starts no new pool player.
		var cache_before: int = _sfx._stream_cache.size()
		var pool_before: Array = []
		for p in _sfx._pool:
			pool_before.append(p.playing)
		_controller._on_combat_hit({
			"targetId": "someone-else", "damage": 999.0, "targetKilled": true,
		})
		var any_new := false
		for i in range(_sfx._pool.size()):
			if _sfx._pool[i].playing and not pool_before[i]:
				any_new = true
		_result["hit_wrong_target_ignored"] = (_sfx._stream_cache.size() == cache_before) and not any_new
		return false

	if _frame == 200:
		# Real async timer delays (10-90ms) have had ~193 real frames
		# (headless idle processing) to fire — mirrors sfx_player_probe.gd's
		# proven ~65-frame wait for a 90ms last layer step, generously
		# widened since this probe fires four overlapping layered SFX at
		# once rather than one. Check for each tier's DISTINCTIVE voice —
		# proves the real severity-selection branch in _on_combat_hit
		# picked the right LAYER_MAP entry, not just "something cached".
		_result["hit_heavy_distinct_voice_cached"] = _sfx._stream_cache.has("hit-heavy@100")
		_result["hit_crit_distinct_voice_cached"] = (
			_sfx._stream_cache.has("hit-crit@100") and _sfx._stream_cache.has("bone-crack@100"))
		_result["hit_kill_distinct_voice_cached"] = (
			_sfx._stream_cache.has("kill-blow@100") and _sfx._stream_cache.has("rumble@100"))
		# 'hit-light' (light tier's OWN distinctive 8ms-delay voice) also
		# real-fires on this same timeline.
		_result["hit_light_distinct_voice_cached"] = _sfx._stream_cache.has("hit-light@100")

		# 7. Footsteps — simulate real grounded horizontal motion across
		# enough physics steps to cross FOOTSTEP_STRIDE_M, confirm a real
		# footstep SFX fires. _update_footsteps reads `velocity`/
		# `is_airborne`/`swimming` — set them directly (same "no real
		# privacy enforcement" note as `_current_target_id` above) rather
		# than driving full move_and_slide() physics, since this probe is
		# about the SFX trigger, not locomotion (already covered by
		# test_character_controller.gd's pure-function suite).
		_controller.is_airborne = false
		_controller.swimming = false
		_controller.velocity = Vector3(2.0, 0.0, 0.0)  # 2 m/s horizontal
		for p in _sfx._pool:
			p.stop()
		var steps := 0
		var accumulated := 0.0
		# FOOTSTEP_STRIDE_M = 1.4m at 2 m/s needs 0.7s of travel; step in
		# 1/30s chunks past that with real margin (2.0m total > 1.4m stride).
		while accumulated < 2.0 and steps < 120:
			_controller._update_footsteps(1.0 / 30.0)
			accumulated += 2.0 / 30.0
			steps += 1
		_result["footstep_sfx_played"] = _any_pool_player_playing()
		_result["ok"] = true
		print("[sfx_gameplay_wiring_probe] RESULT ", JSON.stringify(_result))
		return true

	return false
