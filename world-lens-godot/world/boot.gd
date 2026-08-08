extends Node3D
## Boot — Phase 1 entry point, now (R5/E24) also the scene-switcher shell.
##
## Instantiates the GatewayClient, wires its signals to log lines, and (once
## authenticated) requests the scene for a world. This is deliberately thin:
## it exercises the net stack without asserting anything about visuals.
## All visual claims are queued in VISUAL_QA.md — nothing here has been rendered.
##
## ── R5/E24 — unified session/camera/input management ────────────────────────
## Before this unit, World play (SceneBootstrap/AerialTrafficController),
## Game Design (DesignPlaytestClient/DesignCommandClient), and FEA
## visualization (FeaSceneBuilder) were each independent, uncomposed
## components — none of them were even mounted here together, so nothing
## coordinated which one owned the camera/movement input at a given moment.
## `session/session_manager.gd` is now the single source of truth for that
## ("what mode is the client in") and `session/camera_rig.gd` is the ONE
## shared Camera3D every mode configures instead of building its own — see
## both files' class docs for the full state-machine/rig design. ConKay
## (`_conkay` below) is deliberately NOT wired into SessionManager at all —
## it is an always-on overlay regardless of mode, per its own class doc, and
## never competes for camera/input.
##
## `_design_playtest` is the ONE real server-tracked state transition this
## file brokers (design ⇄ playtest, via SessionManager); `_fea_scene` is
## mounted so the FEA overlay has something real to show/hide + a real
## focus point for the orbit camera — see `_on_fea_overlay_opened`/`_closed`.
##
## Deliberately NOT mounted here: a live CharacterController/
## LandAirTransitionController body. Both gained an optional
## `session_manager` input-ownership gate as part of this unit (see either
## file's own class doc), but actually spawning a physically-simulated
## avatar needs real collision geometry / a spawn point this skeleton
## doesn't have yet (no ground mesh under `scene_bootstrap.gd`'s placeholder
## boxes) — mounting one here would silently fall through the world forever,
## which is worse than not mounting it at all. That is separate, already
## in-flight movement/character work, not this unit's scope. This is also
## exactly why a camera-only SPECTATE mode (R6, below) is a safe first
## shippable milestone: it needs none of that missing collision geometry.
##
## ── R6 — reconnect resync + remote-avatar rendering + spectator mode ───────
## Three additions, all client-side (no new server protocol needed — see
## net/gateway_client.gd's class doc for why `_seq` itself can't drive a
## "since-N" resync, and why the reconnect (`_on_authenticated` firing again)
## is the real trigger instead):
##   1. `_on_authenticated` now replays EVERY room this client had joined
##      (not just the one hardcoded world room) and resets ConKay's one-shot
##      presence state — a `macro:completed` missed while disconnected would
##      otherwise leave a stuck "busy" indicator with nothing left to ever
##      clear it.
##   2. `AvatarManager` (avatar/avatar_manager.gd) is now mounted and fed
##      from `city:positions` — it existed, fully built and tested, with NO
##      live caller anywhere in this tree until this unit (see that file's
##      own header and city-presence.js's DET-C batch 8 comment for the
##      history). `city:npcs` is NOT wired here: that broadcast was
##      DELIBERATELY RETIRED server-side (city-presence.js, same comment) —
##      re-adding a client subscriber for an event the server no longer
##      emits would be dead code, not a fix. **Phase N (below) does NOT
##      change this** — NPCs are now genuinely visible, but via a REST poll
##      (`world/npc_poller.gd`), not via a revived `city:npcs`. If you see
##      NPCs rendering, that is Phase N, not this broadcast coming back.
##
## ── Phase N — NPC visibility (world_npcs / npc-simulator.js) ────────────────
## `_npc_poller` (world/npc_poller.gd) is a `Timer`-driven REST poller
## against `GET /api/worlds/:worldId/npcs` — the SAME route the Three.js
## client already polls every 10s — feeding the SAME `AvatarManager.
## ingest_snapshot(..., "npc")` pipeline `city:positions` above already
## uses. Zero new backend code. See `npc_poller.gd`'s own class doc for the
## full rationale (including why this is a strictly better answer than
## either of `city:npcs`'s two original options — reviving it, or building
## a new broadcast). This is a SEPARATE population from the small,
## mechanic-spawned patrol NPCs `city-presence.js`'s `_npcState` still
## simulates — that population remains fully unaddressed.
##   3. `spectator_mode` (env `CONCORD_GODOT_SPECTATOR`) requests
##      SessionManager.Mode.SPECTATE once authenticated — a free-fly,
##      no-character-input camera anyone can point at a running world
##      without needing a spawn point or collision geometry. This is the
##      "first shippable milestone" read-only spectator viewer: static
##      geometry (scene:request), other players moving (AvatarManager, this
##      unit), and ambient air traffic (already wired) are all real,
##      already-broadcast state — nothing here fabricates a frame of it.

const GatewayClient := preload("res://net/gateway_client.gd")
const SceneBootstrap := preload("res://world/scene_bootstrap.gd")
const ArtStyle := preload("res://world/art_style.gd")
const AerialTrafficController := preload("res://world/aerial_traffic_controller.gd")
const AvatarManager := preload("res://avatar/avatar_manager.gd")
const ConKayPresence := preload("res://conkay/conkay_presence.gd")
const SessionManager := preload("res://session/session_manager.gd")
const CameraRig := preload("res://session/camera_rig.gd")
const DesignPlaytestClient := preload("res://design/design_playtest_client.gd")
const FeaSceneBuilder := preload("res://engineering/fea_scene_builder.gd")
const CharacterController := preload("res://player/character_controller.gd")
const AvatarRig := preload("res://avatar/avatar_rig.gd")
const TerrainTextureLoader := preload("res://assets/terrain_texture_loader.gd")
const NpcPoller := preload("res://world/npc_poller.gd")
const CreatureManager := preload("res://world/creature_manager.gd")
const CreaturePoller := preload("res://world/creature_poller.gd")
const VegetationRenderer := preload("res://world/vegetation_renderer.gd")
const QuestPoller := preload("res://world/quest_poller.gd")
const QuestAvailablePoller := preload("res://world/quest_available_poller.gd")
const QuestActions := preload("res://world/quest_actions.gd")
const QuestBreadcrumb := preload("res://world/quest_breadcrumb.gd")
const WayfindingMarkers := preload("res://world/wayfinding_markers.gd")
const WayfindingController := preload("res://world/wayfinding_controller.gd")
const RooftopAccessController := preload("res://world/rooftop_access_controller.gd")
const SfxPlayer := preload("res://audio/sfx_player.gd")
const PauseMenu := preload("res://ui/pause_menu.gd")
const PlayerAppearanceLoader := preload("res://world/player_appearance_loader.gd")
const TouchControls := preload("res://ui/touch_controls.gd")

## Runtime config — override via project settings or env at integration time.
## The env override (CONCORD_GATEWAY_URL / CONCORD_GODOT_API_KEY /
## CONCORD_GODOT_AUTH_TOKEN / CONCORD_WORLD_ID) is what actually makes this
## usable from a non-interactive launch (bare-metal boot script, CI) — the
## @export defaults alone only ever changed via the editor inspector. See
## resolve_runtime_config below and scripts/launch-godot-client.sh.
@export var gateway_url: String = "ws://127.0.0.1:5050/godot-ws"
@export var auth_token: String = ""
@export var api_key: String = ""
@export var world_id: String = "concordia-hub"
## R6 — CONCORD_GODOT_SPECTATOR. A literal "true"/"1" opts into the
## read-only spectator viewer milestone (SessionManager.Mode.SPECTATE) the
## moment auth succeeds; any other value (including unset/blank) leaves the
## client in ordinary WORLD mode, matching the string/bool convention
## resolve_runtime_config already established for the other three vars.
@export var spectator_mode: bool = false
## Origin serving the frontend's static `public/` dir — where the real
## building GLBs actually live (`concord-frontend/public/models/building/
## *.glb`), distinct from the backend gateway/API origin above. Override via
## CONCORD_FRONTEND_URL for a non-default deploy (e.g. behind a tunnel).
## This @export default (a concrete local dev host) is what NATIVE builds
## use; `_ready()` overrides it to "" (relative/same-origin) for Web builds
## specifically — see that override's comment for why: the app's CSP
## `connect-src` only allows `'self' https: wss: ws:`, so a Web build
## fetching from a DIFFERENT plain-http origin than the page itself is
## refused outright (verified with a real browser load — see VISUAL_QA.md).
## A real deployment serves the Godot page and `public/models/` from the
## SAME origin (both come out of the one Next.js app), so the relative form
## is not just CSP-compatible, it is the actually-correct default.
@export var frontend_asset_base_url: String = "http://127.0.0.1:3000"
## The backend REST/macro API origin — where `POST /api/lens/run`,
## `GET /api/worlds/:id/npcs`, `/quests/*`, `/api/fea/*` etc. actually live.
## Distinct from `gateway_url` (the WebSocket gateway) even though a real
## deployment usually serves both from the same host, because Godot's own
## `HTTPRequest` needs a plain http(s) origin, not a `ws://.../godot-ws`
## URL. Override via CONCORD_BACKEND_URL. Found missing entirely by an
## actual browser load (2026-08-08): every REST poller/loader below
## (`_npc_poller`, `_creature_poller`, `_quest_poller`,
## `_quest_available_poller`, `_quest_actions`, `_fea_scene`,
## `_player_appearance_loader`) was hardcoded to this exact literal with no
## override path at all — silently unreachable the instant the backend
## wasn't literally at `127.0.0.1:5050` from the browser's point of view,
## which is true of essentially every real deployment (the browser runs on
## the visitor's machine, not the server). `app/godot-client/index.html/
## route.ts` now defaults this the same way it already defaults
## `CONCORD_FRONTEND_URL` — to the request's own resolved origin — since a
## real deployment proxies `/api/*` through the same public origin as the
## page.
@export var backend_api_base_url: String = "http://127.0.0.1:5050"

var _gateway: GatewayClient
var _bootstrap: SceneBootstrap
var _aerial_traffic: AerialTrafficController
var _avatar_manager: AvatarManager
var _conkay: ConKayPresence
var _session: SessionManager
var _camera_rig: CameraRig
var _design_playtest: DesignPlaytestClient
var _fea_scene: FeaSceneBuilder
## The LOCAL player's real physics body (player/character_controller.gd).
## Null until the first `scene:data` gives it a real spawn point to fall
## onto -- spawning before that would mean guessing a position instead of
## deriving one from the world's own real geometry. Spawned exactly once
## per client session (see `_on_event`'s `scene:data` branch) -- this
## client has no world-switch flow that would need a re-spawn.
var _character: CharacterController = null
## Phase N — NPC visibility (world/npc_poller.gd's own class doc has the
## full rationale for why this is a REST poller, not a revived `city:npcs`
## broadcast).
var _npc_poller: NpcPoller
## Phase M3 — creature spawner. Deliberately SEPARATE from
## _avatar_manager/AvatarRig — see world/creature_manager.gd's own class
## doc for why (a fox is not a humanoid; routing it through AvatarManager
## would silently mis-render it through the player/NPC pipeline).
var _creature_manager: CreatureManager
var _creature_poller: CreaturePoller
## Phase M2 — deterministic, district-bounded vegetation (server/lib/
## vegetation-scatter.js), delivered on the same one-shot scene:data payload
## buildings/districts/landing pads already arrive on — see
## world/scene_bootstrap.gd#parse_vegetation/vegetation_ready. No poller: it
## rides the existing scene fetch.
var _vegetation_renderer: VegetationRenderer

## Audio (2026-08-08) — ported SFX_MAP synthesis engine (audio/sfx_synth.gd
## + audio/sfx_player.gd — see sfx_synth.gd's own header for why this is
## procedural synthesis, not sample playback). Mounted unconditionally in
## `_ready()` (audio has no scene-data dependency, unlike `_character`),
## then handed to `_character` as its `sfx_player` DI slot once the local
## player spawns, and to `_quest_actions` for accept/claim feedback.
var _sfx_player: SfxPlayer

## UI (2026-08-08) — the pause overlay. Mounted unconditionally in
## `_ready()` alongside `_sfx_player` (no scene-data dependency, and it's
## the one thing here Escape must always be able to reach even before the
## local player has spawned). `world/boot.gd` itself is the reactive
## consumer of `SessionManager.pause_overlay_opened`/`_closed` — see
## `_on_pause_overlay_opened`/`_closed` below, mirroring the existing FEA-
## overlay pattern (`_on_fea_overlay_opened`/`_closed`).
var _pause_menu: PauseMenu

## Gamepad + touch input (2026-08-08) — see ui/touch_controls.gd's own
## class doc for the full design (virtual joystick + scoped action-button
## subset). Mounted unconditionally alongside `_sfx_player`/`_pause_menu`
## above (no scene-data dependency, and it's a harmless, invisible-cost
## overlay when nobody touches it — this client has no device-detection
## heuristic to gate it behind, and building one would be a separate,
## real, and currently unjustified feature).
var _touch_controls: TouchControls

## Character archetype signal (2026-08-08) — see player_appearance_loader.gd's
## own class doc for the full rationale. Mounted + fetched unconditionally in
## `_ready()` (needs only `auth_token`, already resolved by then — no
## scene-data dependency, same posture as `_sfx_player`/`_pause_menu` above).
var _player_appearance_loader: PlayerAppearanceLoader
## The resolved archetype ("" = not yet settled, or genuinely no signal —
## AvatarRig's own "warrior" default applies either way). Read exactly once,
## at `_spawn_local_player_if_needed` time — see `_try_spawn_local_player()`.
var _resolved_player_archetype: String = ""
var _appearance_settled: bool = false
## The local player's spawn point, known once `world:data` resolves camera
## bounds. Held here (rather than spawning immediately) so spawn can wait on
## BOTH real prerequisites — see `_try_spawn_local_player()`.
var _has_pending_spawn_center: bool = false
var _pending_spawn_center: Vector3 = Vector3.ZERO

## R6 — every room this client has asked to join, replayed in full on every
## successful (re)auth by `_on_authenticated` (see this file's class doc).
var _joined_rooms: Array[String] = []

## Combat Phase C — the LOCAL player's real user id, known from
## `GatewayClient.authenticated` (see `_on_authenticated`). Cached here (not
## just written straight into `_character`) because `_character` may not
## exist yet at first auth — it's spawned later, once `scene:data` gives it a
## real spawn point (see `_spawn_local_player_if_needed`) — and a reconnect's
## `authenticated` should still update an already-spawned `_character` too.
var _local_user_id: String = ""
## Minimal target-health HUD (Combat Phase C4) — a bare Label, not a port of
## the Three.js CombatHUD. Null until `_setup_target_hud()` runs (right after
## the local player spawns, since it wires signals off `_character`).
var _target_hud: Label = null
## Phase Q — quest fetch + breadcrumb HUD. Unlike `_target_hud`, does not
## depend on `_character` existing (quests are account/world state, not
## avatar state), so it's set up unconditionally in `_ready()`.
var _quest_poller: QuestPoller = null
var _quest_available_poller: QuestAvailablePoller = null
var _quest_actions: QuestActions = null
var _quest_hud: Label = null
## Mirrors QuestTracker.tsx's `TrackerMode` ('breadcrumb' | 'list'), toggled
## by the J key — see `_unhandled_input`. No localStorage-equivalent
## persistence yet (deliberate first-slice scope; matches this session's
## other "port the design, not every persistence detail" calls).
var _quest_tracker_mode: String = "breadcrumb"
## F26/F27 — real modules with their own tests since Sprint F, but never
## previously mounted anywhere in this file (a real, checked finding from
## the Phase Q pass, not an assumption — see VISUAL_QA.md's "Quests" entry).
## Wired here so the quest-objective POI layer (and the pre-existing pad/
## rooftop/district POIs) finally has a live path from real scene data to
## real, queryable markers.
var _rooftop_controller: RooftopAccessController = null
var _wayfinding: WayfindingController = null


## Pure static so it's unit-testable without a scene tree (same rationale as
## GatewayClient.build_auth_payload). `env` is the already-read environment
## values — real callers pass real OS.get_environment() results, tests pass
## a fake Dictionary — which keeps this resolution logic decoupled from the
## engine API it reads from. Only a non-empty env value overrides its
## matching default; an unset/blank env var leaves the export-default (or
## editor-inspector value) untouched.
static func resolve_runtime_config(env: Dictionary, defaults: Dictionary) -> Dictionary:
	var resolved := defaults.duplicate()
	if not String(env.get("CONCORD_GATEWAY_URL", "")).is_empty():
		resolved["gateway_url"] = env["CONCORD_GATEWAY_URL"]
	if not String(env.get("CONCORD_GODOT_API_KEY", "")).is_empty():
		resolved["api_key"] = env["CONCORD_GODOT_API_KEY"]
	if not String(env.get("CONCORD_GODOT_AUTH_TOKEN", "")).is_empty():
		resolved["auth_token"] = env["CONCORD_GODOT_AUTH_TOKEN"]
	if not String(env.get("CONCORD_WORLD_ID", "")).is_empty():
		resolved["world_id"] = env["CONCORD_WORLD_ID"]
	# R6 — a literal "true" or "1" only; anything else (including unset,
	# blank, or a typo like "yes") leaves `spectator_mode` at its default
	# rather than guessing at truthiness, matching the honest-default
	# convention every other override here already follows.
	var spectator_env := String(env.get("CONCORD_GODOT_SPECTATOR", ""))
	if spectator_env == "true" or spectator_env == "1":
		resolved["spectator_mode"] = true
	return resolved


## Pure — parses a flat array of "KEY=VALUE" strings (as delivered by
## `OS.get_cmdline_user_args()` — everything after a `--` separator, both
## natively and on Web, see `is_web_build()`'s comment below for why this
## replaced an earlier `window.location.search` + JavaScriptBridge.eval
## approach) into a Dictionary of decoded key/value strings.
## `["CONCORD_WORLD_ID=tunya", "CONCORD_GODOT_SPECTATOR=1"]` ->
## {"CONCORD_WORLD_ID":"tunya","CONCORD_GODOT_SPECTATOR":"1"}. An entry with
## no `=` yields an empty-string value, same as a blank env var —
## downstream `resolve_runtime_config` already treats a blank value as "not
## set" and leaves the default in place, so this never needs special-casing
## here. Malformed/empty entries are skipped, never thrown on.
static func parse_key_value_args(args: PackedStringArray) -> Dictionary:
	var out := {}
	for entry in args:
		if entry.is_empty():
			continue
		var eq := entry.find("=")
		var key: String
		var value: String
		if eq == -1:
			key = entry
			value = ""
		else:
			key = entry.substr(0, eq)
			value = entry.substr(eq + 1)
		if key.is_empty():
			continue
		out[key] = value
	return out


## True only for a real HTML5/Web export at runtime (never true for the
## native editor/headless/desktop builds this project also ships) — gates
## the query-string config path below. `OS.get_name()` returns "Web" for
## the Web export target; this is the documented, stable way to detect it
## (there is no `OS.has_feature("web")` shortcut for this in Godot 4).
static func is_web_build() -> bool:
	return OS.get_name() == "Web"


func _ready() -> void:
	# Native env vars do not exist inside a browser tab — `OS.get_environment`
	# always returns "" on the Web export target (confirmed by Godot's own
	# HTML5 platform docs; there is no host process to inherit a shell
	# environment from). A page embedding this client therefore configures it
	# via engine cmdline args instead: `app/godot-client/index.html/route.ts`
	# (the same route that injects the CSP nonce) also reads the page's own
	# query string SERVER-SIDE and splices "KEY=VALUE" entries into the
	# exported GODOT_CONFIG.args array, after a literal "--" separator, so
	# `OS.get_cmdline_user_args()` returns exactly those entries here.
	#
	# An earlier version of this used `window.location.search` read via
	# `JavaScriptBridge.eval` — that was tried and REJECTED after an actual
	# browser load: the app's CSP has `wasm-unsafe-eval` (needed for the WASM
	# runtime itself) but deliberately not the much broader `unsafe-eval`
	# (arbitrary JS eval/Function-string execution anywhere in the app), so
	# `JavaScriptBridge.eval` was refused outright
	# ("EvalError: Refused to evaluate a string as JavaScript..."), silently
	# leaving every query param unread. The cmdline-args path needs no CSP
	# relaxation at all — GODOT_CONFIG.args is a plain JSON array Godot's own
	# generated bootstrap script already passes to the WASM module's argv,
	# same code path as native cmdline args, not JS eval.
	#
	# Same key names as the native env-var path
	# (CONCORD_GATEWAY_URL=...=CONCORD_GODOT_AUTH_TOKEN=...) so
	# `resolve_runtime_config` (already pinned by tests/test_boot_runtime_
	# config.gd) is reused byte-for-byte rather than forked into a second,
	# web-only config surface.
	var _env: Dictionary
	if is_web_build():
		_env = parse_key_value_args(OS.get_cmdline_user_args())
	else:
		_env = {
			"CONCORD_GATEWAY_URL": OS.get_environment("CONCORD_GATEWAY_URL"),
			"CONCORD_GODOT_API_KEY": OS.get_environment("CONCORD_GODOT_API_KEY"),
			"CONCORD_GODOT_AUTH_TOKEN": OS.get_environment("CONCORD_GODOT_AUTH_TOKEN"),
			"CONCORD_WORLD_ID": OS.get_environment("CONCORD_WORLD_ID"),
			"CONCORD_GODOT_SPECTATOR": OS.get_environment("CONCORD_GODOT_SPECTATOR"),
			"CONCORD_FRONTEND_URL": OS.get_environment("CONCORD_FRONTEND_URL"),
			"CONCORD_BACKEND_URL": OS.get_environment("CONCORD_BACKEND_URL"),
		}
	var _defaults := {
		"gateway_url": gateway_url, "api_key": api_key,
		"auth_token": auth_token, "world_id": world_id,
		"spectator_mode": spectator_mode,
	}
	var _cfg := resolve_runtime_config(_env, _defaults)
	gateway_url = _cfg["gateway_url"]
	api_key = _cfg["api_key"]
	auth_token = _cfg["auth_token"]
	world_id = _cfg["world_id"]
	spectator_mode = _cfg["spectator_mode"]
	var _frontend_env := String(_env.get("CONCORD_FRONTEND_URL", ""))
	if _frontend_env != "":
		frontend_asset_base_url = _frontend_env
	var _backend_env := String(_env.get("CONCORD_BACKEND_URL", ""))
	if _backend_env != "":
		backend_api_base_url = _backend_env
	# No web-specific fallback here — an earlier version tried defaulting to
	# "" on Web (relative URLs, resolved by the browser against the page's
	# own origin) to dodge the app's strict connect-src CSP. That was WRONG,
	# found by an actual browser load: Godot's own `HTTPRequest._parse_url`
	# rejects a schemeless/hostless URL outright ("Error parsing URL:
	# '/models/building/tavern.glb'") before the request ever reaches the
	# browser's fetch() bridge — unlike a raw JS fetch(), Godot's HTTPRequest
	# requires an absolute URL on every platform, Web included. The real fix
	# lives server-side instead: `app/godot-client/index.html/route.ts`
	# defaults CONCORD_FRONTEND_URL to the page's OWN absolute origin
	# (`request.nextUrl.origin`) whenever the embedding page didn't specify
	# one, so this env value is normally already a same-origin absolute URL
	# by the time it gets here — both CSP-safe AND Godot-HTTPRequest-safe.
	# The native @export default above is what's actually used if that
	# server-side default is somehow bypassed (e.g. a hand-built HTML host).

	# The per-world sky/sun/ambient/toon palette (ArtStyle) is already built,
	# tested, and pixel-verified (VISUAL_QA.md's "art_world" shots) -- but
	# was ONLY ever applied by the synthetic tools/visual_probe.gd harness,
	# never by the real client boot path. Without it the live scene has no
	# light at all, so real spawned geometry renders as flat black
	# silhouettes against the engine's default clear color. Wiring it here
	# is reusing ArtStyle's existing static functions verbatim (same call
	# shape visual_probe.gd already proved draws real, correctly-ordered
	# pixels for all 9 canon worlds) -- not new rendering logic.
	var _world_env := ArtStyle.make_environment(world_id)
	if _world_env != null:
		var _we := WorldEnvironment.new()
		_we.environment = _world_env
		add_child(_we)
	var _sun := ArtStyle.make_sun(world_id)
	if _sun != null:
		_sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
		add_child(_sun)

	# Flat ground plane. Real terrain textures exist (concord-frontend/
	# public/models/terrain/*.jpg — grass/dirt/cobblestone/asphalt/etc.);
	# per-district textured ground geometry (UV-mapped biome/district-
	# boundary selection) is still separate, unbuilt work, but a real
	# tiled grass texture now replaces the flat placeholder color below
	# (2026-08-07) — see `_apply_ground_texture`. Still a single flat
	# PlaneMesh, not sculpted terrain — an honest texture upgrade, not a
	# claim of real terrain geometry.
	var _ground := MeshInstance3D.new()
	var _ground_mesh := PlaneMesh.new()
	_ground_mesh.size = Vector2(4000, 4000)
	_ground.mesh = _ground_mesh
	var _ground_mat := StandardMaterial3D.new()
	_ground_mat.albedo_color = Color(0.36, 0.40, 0.32)
	_ground.material_override = _ground_mat
	add_child(_ground)
	_apply_ground_texture(_ground_mat)

	# Real ground collision (2026-08-07) — a StaticBody3D/CollisionShape3D
	# sized to match the visual PlaneMesh exactly (BoxShape3D is a real,
	# simple, and correct choice for a perfectly flat ground -- a thin slab
	# whose top face sits at y=0, same as the visual plane). Before this,
	# nothing in the scene could physically collide with anything: a real
	# CharacterController spawned here would have fallen through the world
	# forever (this file's own prior class-doc comment named exactly this
	# as the reason no local player was ever spawned). `enable_collision`
	# on `_bootstrap` below adds the matching per-building collision.
	const GROUND_COLLISION_THICKNESS := 2.0
	var _ground_body := StaticBody3D.new()
	var _ground_cs := CollisionShape3D.new()
	var _ground_shape := BoxShape3D.new()
	_ground_shape.size = Vector3(4000.0, GROUND_COLLISION_THICKNESS, 4000.0)
	_ground_cs.shape = _ground_shape
	_ground_body.add_child(_ground_cs)
	_ground_body.position = Vector3(0.0, -GROUND_COLLISION_THICKNESS / 2.0, 0.0)
	add_child(_ground_body)

	# Audio (2026-08-08) — mounted unconditionally here, unlike `_character`,
	# since it has no scene-data dependency: a synthesized SFX pool needs
	# only a real SceneTree/AudioServer, which already exist by this point
	# in _ready(). Handed to `_character` (once spawned) and `_quest_actions`
	# below as their `sfx_player` DI slot.
	_sfx_player = SfxPlayer.new()
	add_child(_sfx_player)

	_pause_menu = PauseMenu.new()
	_pause_menu.sfx_player = _sfx_player
	add_child(_pause_menu)
	_pause_menu.resume_requested.connect(func(): _session.close_pause_overlay())

	_touch_controls = TouchControls.new()
	add_child(_touch_controls)

	# Character archetype signal (2026-08-08) — kicked off as early as
	# possible (needs only `auth_token`, already resolved a few lines above)
	# so the real customization signal is very likely to have settled well
	# before the local player's own spawn happens later (gated on
	# `world:data`'s camera bounds — a much heavier round trip). See
	# `_try_spawn_local_player()` for the actual gate; `player_appearance_
	# loader.gd`'s own class doc for why this is bounded and never blocks
	# world entry.
	_player_appearance_loader = PlayerAppearanceLoader.new()
	_player_appearance_loader.base_url = backend_api_base_url
	_player_appearance_loader.auth_token = auth_token
	add_child(_player_appearance_loader)
	_player_appearance_loader.settled.connect(_on_player_appearance_settled)
	_player_appearance_loader.fetch()

	_bootstrap = SceneBootstrap.new()
	_bootstrap.enable_real_building_meshes = true
	_bootstrap.enable_collision = true
	_bootstrap.frontend_asset_base_url = frontend_asset_base_url
	_bootstrap.world_id = world_id
	add_child(_bootstrap)

	# Phase M2 — real, district-bounded deterministic vegetation. Rides the
	# same one-shot scene:data payload _bootstrap already parses; no new
	# poller. `frontend_asset_base_url` matches _bootstrap's own asset origin
	# above (vegetation GLBs live alongside building GLBs under
	# concord-frontend/public/models/).
	_vegetation_renderer = VegetationRenderer.new()
	_vegetation_renderer.frontend_asset_base_url = frontend_asset_base_url
	_vegetation_renderer.world_id = world_id
	add_child(_vegetation_renderer)
	_bootstrap.vegetation_ready.connect(_vegetation_renderer.spawn)

	# C16 — ambient aerial traffic. Same "mount + let boot.gd's _on_event
	# dispatch to it" pattern as SceneBootstrap; see that file's own class
	# doc for why no visible geometry is spawned here yet (data layer only).
	_aerial_traffic = AerialTrafficController.new()
	_aerial_traffic.world_id = world_id
	add_child(_aerial_traffic)

	# R6 — remote player avatars (avatar/avatar_manager.gd's own class doc
	# explains why this had never been mounted anywhere before this unit).
	# `base_url` here MUST be the frontend static-asset origin, not the
	# backend gateway origin: hero-mesh GLBs
	# (concord-frontend/public/meshes/heroes/*.glb) are served by the
	# Next.js app's public/ dir, same as SceneBootstrap's building meshes
	# just above — AvatarRig -> AssetResolver's static fallback convention
	# (assets/asset_resolver.gd#fallback_url) resolves against this URL.
	# An earlier version of this line pointed at the backend gateway origin
	# instead (a latent bug that went unnoticed because nothing had wired
	# real avatar-mesh resolution yet — every remote puppet silently stayed
	# on AvatarRig's honest capsule-placeholder fallback regardless of
	# which origin it 404'd against).
	_avatar_manager = AvatarManager.new()
	_avatar_manager.base_url = frontend_asset_base_url
	_avatar_manager.world_id = world_id
	add_child(_avatar_manager)

	# Phase N — authored NPC visibility (world_npcs / npc-simulator.js). Polls
	# the SAME REST route the Three.js client already polls every 10s
	# (concord-frontend/app/lenses/world/page.tsx's
	# useSmartPolling(loadNPCs, 10_000, ...) against
	# GET /api/worlds/:worldId/npcs) rather than reviving the deliberately-
	# retired city:npcs broadcast (see this file's R6 class doc above and
	# npc_poller.gd's own class doc) — zero new backend code. Feeds
	# AvatarManager.ingest_snapshot(..., "npc") directly: AvatarManager is
	# already kind-agnostic, so NPCs get the full existing rig/animation/GLB
	# pipeline for free. `base_url` is the BACKEND origin (matches
	# `_fea_scene.base_url` below, NOT `frontend_asset_base_url` — that
	# export is for GLB-asset serving only, see `_avatar_manager.base_url`'s
	# own comment just above for why that distinction matters). Mounted
	# right after `_avatar_manager` so the DI reference is ready immediately.
	_npc_poller = NpcPoller.new()
	_npc_poller.base_url = backend_api_base_url
	_npc_poller.world_id = world_id
	_npc_poller.auth_token = auth_token
	_npc_poller.avatar_manager = _avatar_manager
	add_child(_npc_poller)

	# Phase M3 — creature spawner. Deliberately SEPARATE from
	# _avatar_manager (see world/creature_manager.gd's own class doc). Two
	# distinct base URLs, same dual-origin split as everywhere else in this
	# file: `_creature_manager.base_url` is the FRONTEND asset origin
	# (threaded to each spawned CreatureRig's own GLB fetch), while
	# `_creature_poller.base_url` is the BACKEND origin (the macro POST
	# that fetches live positions).
	_creature_manager = CreatureManager.new()
	_creature_manager.base_url = frontend_asset_base_url
	_creature_manager.world_id = world_id
	add_child(_creature_manager)

	_creature_poller = CreaturePoller.new()
	_creature_poller.base_url = backend_api_base_url
	_creature_poller.world_id = world_id
	_creature_poller.auth_token = auth_token
	_creature_poller.creature_manager = _creature_manager
	add_child(_creature_poller)

	# Phase Q — quest fetch. Same backend-origin convention as every other
	# poller above. `poll_succeeded` re-renders the breadcrumb/list HUD from
	# the fresh snapshot; a failed cycle leaves the HUD showing its last-known
	# real state rather than clearing to blank (QuestPoller's own class doc:
	# never fabricates, never clears real state on a transient error).
	_quest_poller = QuestPoller.new()
	_quest_poller.base_url = backend_api_base_url
	_quest_poller.world_id = world_id
	_quest_poller.auth_token = auth_token
	add_child(_quest_poller)
	_quest_poller.poll_succeeded.connect(_on_quest_poll_succeeded)

	# Quest interaction slice (2026-08-08) — discovers quests offerable via
	# a DIFFERENT real route (`?status=available`) than the active-quest
	# poller above; QuestActions composes both into the single K-key
	# accept/claim interaction. See quest_actions.gd's own class doc for why
	# this is deliberately ONE action at a time, not a quest-log UI.
	_quest_available_poller = QuestAvailablePoller.new()
	_quest_available_poller.base_url = backend_api_base_url
	_quest_available_poller.world_id = world_id
	_quest_available_poller.auth_token = auth_token
	add_child(_quest_available_poller)
	_quest_available_poller.poll_succeeded.connect(func(_c): _render_quest_hud())

	_quest_actions = QuestActions.new()
	_quest_actions.base_url = backend_api_base_url
	_quest_actions.world_id = world_id
	_quest_actions.auth_token = auth_token
	_quest_actions.quest_poller = _quest_poller
	_quest_actions.available_poller = _quest_available_poller
	add_child(_quest_actions)
	# On a real success, re-poll both quest feeds immediately rather than
	# waiting up to 60s for the next scheduled cycle — the player just took
	# a real action and the HUD should reflect it promptly.
	_quest_actions.action_succeeded.connect(func(_kind, _qid, _result):
		_quest_poller.poll_now()
		_quest_available_poller.poll_now()
		# Audio (2026-08-08) — a real quest action deserves real feedback.
		# 'claim' uses the layered victory cue (mirrors ui_hack_complete's
		# real alias -> 'victory-sting' in sfx_synth.gd's SFX_ALIASES); a
		# bare 'accept' gets the same success chime the rest of this client
		# already uses for a completed action.
		if _sfx_player != null:
			_sfx_player.play_sfx("victory-sting" if _kind == "claim" else "gather-success")
	)

	_setup_quest_hud()

	# F26/F27, wired for real here — see the class-level comment on
	# `_rooftop_controller`/`_wayfinding` above. `wire_sources`/
	# `wire_from_scene_bootstrap` are re-callable (both classes' own
	# doc comments say so) and are re-invoked from `_on_event`'s
	# "scene:data" case below on every fresh scene payload.
	_rooftop_controller = RooftopAccessController.new()
	add_child(_rooftop_controller)
	_wayfinding = WayfindingController.new()
	add_child(_wayfinding)

	# R5/E22 — ConKay spatial mode. Same identity as the web widget, given a
	# presence here; see conkay/conkay_presence.gd's class doc. `user:<id>`
	# is auto-joined by the gateway on successful auth (no room:join needed
	# for its two real event types below). Placeholder position — a design
	# dial, not measured against any real spawn point yet (VISUAL_QA.md).
	# NOT wired into SessionManager — see this file's own class doc.
	_conkay = ConKayPresence.new()
	_conkay.position = Vector3(0.0, 1.6, 0.0)
	add_child(_conkay)

	_gateway = GatewayClient.new()
	_gateway.name = "Gateway"
	_gateway.gateway_url = gateway_url
	_gateway.auth_token = auth_token
	_gateway.api_key = api_key
	add_child(_gateway)

	# R5/E24 — the FEA overlay's real geometry, mounted hidden. Opened only
	# via SessionManager.open_fea_overlay() (see _on_fea_overlay_opened);
	# never fetches or shows a structure on its own.
	_fea_scene = FeaSceneBuilder.new()
	_fea_scene.base_url = backend_api_base_url
	_fea_scene.auth_token = auth_token
	_fea_scene.visible = false
	add_child(_fea_scene)
	# Real orbit-camera focus, re-derived every time the fetched structure
	# actually finishes loading — not just once at overlay-open time (a
	# fetch is async; the overlay can open before the model arrives).
	_fea_scene.scene_ready.connect(_on_fea_scene_ready)

	# R5/E24 — the Game Design Lens's real design<->playtest round trip.
	# `gateway_path` is set BEFORE add_child so its own `_ready()` (which
	# resolves the NodePath once) sees an already-connected Gateway sibling.
	_design_playtest = DesignPlaytestClient.new()
	_design_playtest.name = "DesignPlaytestClient"
	_design_playtest.gateway_path = NodePath("../Gateway")
	add_child(_design_playtest)

	# R5/E24 — the shared camera rig (session/camera_rig.gd's class doc) and
	# the session-state authority that drives it (session/
	# session_manager.gd's class doc). Wired last so both real dependents
	# (DesignPlaytestClient, CameraRig) already exist in the tree.
	_camera_rig = CameraRig.new()
	add_child(_camera_rig)

	_session = SessionManager.new()
	add_child(_session)
	_session.set_camera_rig(_camera_rig)
	_session.set_design_playtest_client(_design_playtest)
	_session.fea_overlay_opened.connect(_on_fea_overlay_opened)
	_session.fea_overlay_closed.connect(_on_fea_overlay_closed)
	_session.mode_transition_rejected.connect(_on_mode_transition_rejected)
	_session.fea_overlay_rejected.connect(_on_fea_overlay_rejected)
	_session.pause_overlay_opened.connect(_on_pause_overlay_opened)
	_session.pause_overlay_closed.connect(_on_pause_overlay_closed)

	_gateway.connected.connect(_on_connected)
	_gateway.authenticated.connect(_on_authenticated)
	_gateway.disconnected.connect(_on_disconnected)
	_gateway.event_received.connect(_on_event)
	_gateway.sequence_anomaly.connect(_on_sequence_anomaly)

	_gateway.connect_to_gateway()


## Fetches a real grass texture from the frontend static-asset origin and
## tiles it across the ground plane. Honest degradation, same shape every
## other real-asset-first path in this file already uses (real building
## meshes, real hero-mesh avatars): the solid `albedo_color` the caller
## already set stays visible and correct-looking on its own until/unless
## this succeeds, and stays as the permanent fallback on any failure —
## `TerrainTextureLoader` never fabricates a broken or partial texture.
## `GROUND_TEXTURE_TILE_REPEAT` is a design dial, not a measurement: the
## grass photo tiles visibly at any repeat count on a perfectly flat
## 4000x4000 plane with no normal-mapping to break up the repetition —
## chosen large enough that individual tiles read at ordinary player-eye
## viewing distance instead of one enormous stretched image.
const GROUND_TEXTURE_TILE_REPEAT := 400.0
var _terrain_loader: TerrainTextureLoader = null


func _apply_ground_texture(ground_material: StandardMaterial3D) -> void:
	_terrain_loader = TerrainTextureLoader.new()
	add_child(_terrain_loader)
	_terrain_loader.loaded.connect(func(_url: String, tex: ImageTexture) -> void:
		ground_material.albedo_texture = tex
		ground_material.uv1_scale = Vector3(GROUND_TEXTURE_TILE_REPEAT, GROUND_TEXTURE_TILE_REPEAT, 1.0)
	)
	_terrain_loader.load_failed.connect(func(_url: String, reason: String) -> void:
		push_warning("[boot] ground texture failed to load (%s) — staying on the solid placeholder color" % reason)
	)
	_terrain_loader.load_texture("%s/models/terrain/grass.jpg" % frontend_asset_base_url)


## Spawns the local player's real physics body exactly once, at a real
## measured position (the same robust camera-framing center computed
## above — the dense heart of whatever world actually spawned, never a
## fabricated/guessed coordinate), then hands the shared camera off to it.
## `SPAWN_DROP_HEIGHT_M` is a deliberate, honestly-documented design
## choice, not a measurement: dropped in from well above anything spawned
## (concordia-hub's tallest placeholder box is a few tens of metres) and
## let `move_and_slide()`'s real gravity integration settle it onto
## whatever real collision — ground or a building roof — is actually
## there, rather than trying to compute an exact "empty ground" spot near
## a cluster of ~50 buildings (a real, if less common, honest outcome is
## landing on a roof at the city center, not a bug).
const SPAWN_DROP_HEIGHT_M := 80.0


## Character archetype signal (2026-08-08) — `_spawn_local_player_if_needed`
## must not construct the local player's AvatarRig (which immediately kicks
## off its GLB resolve with whatever `archetype` is set at that moment) until
## BOTH real prerequisites are known: where to spawn (`world:data`'s camera
## bounds) AND the real per-player archetype signal (`_player_appearance_
## loader`, bounded so a slow/failed fetch can never block world entry — see
## that file's own class doc). Gating spawn here, rather than re-resolving an
## already-mounted AvatarRig's GLB after the fact, keeps avatar_rig.gd's
## already-verified resolve flow completely untouched.
func _try_spawn_local_player() -> void:
	if _character != null or not _has_pending_spawn_center or not _appearance_settled:
		return
	_spawn_local_player_if_needed(_pending_spawn_center)


func _on_player_appearance_settled(archetype: String) -> void:
	_resolved_player_archetype = archetype
	_appearance_settled = true
	_try_spawn_local_player()


func _spawn_local_player_if_needed(cluster_center: Vector3) -> void:
	if _character != null:
		return

	_character = CharacterController.new()
	_character.world_id = world_id
	_character.gateway = _gateway
	_character.session_manager = _session
	# Combat Phase C — target selection + hit-feel identity. `avatar_manager`
	# is already mounted above (R6); `_local_user_id` may already be known
	# (auth typically completes before the first scene:data round trip) or
	# still blank (a slow/first-ever auth) — either way this is the correct
	# value AT SPAWN TIME, and `_on_authenticated` backfills it on a later
	# reconnect (see that method).
	_character.avatar_manager = _avatar_manager
	_character.local_user_id = _local_user_id
	_character.sfx_player = _sfx_player
	_character.touch_controls = _touch_controls
	_character.position = cluster_center + Vector3(0.0, SPAWN_DROP_HEIGHT_M, 0.0)

	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.35
	capsule.height = 1.8
	shape.shape = capsule
	_character.add_child(shape)

	# Real humanoid visual for the LOCAL player too, via the exact same
	# resolve chain remote players already use (avatar/avatar_rig.gd's own
	# class doc names this as its intended mount point: "the LOCAL player's
	# CharacterBody3D ... can mount one of these as a child for its
	# visuals"). `rig_id` has no bearing on the resolved URL for kind
	# "player" (see assets/asset_resolver.gd#fallback_url) — "local-player"
	# is just a readable label, not a lookup key.
	var rig := AvatarRig.new()
	rig.kind = "player"
	rig.rig_id = "local-player"
	rig.base_url = frontend_asset_base_url
	rig.world_id = world_id
	# Character archetype signal (2026-08-08) — a real per-player signal now
	# exists for the LOCAL player (see `_player_appearance_loader`/
	# `_try_spawn_local_player` above); an empty string means the loader
	# genuinely settled with no signal (no saved appearance / auth failure /
	# timeout), and `rig.archetype`'s own "warrior" default (avatar/
	# avatar_rig.gd) applies honestly, same as it always has. Remote avatars
	# still carry no such signal — see this rig's `kind`/`archetype` doc.
	if _resolved_player_archetype != "":
		rig.archetype = _resolved_player_archetype
	# Phase M1 — the local player carries a real weapon mesh too, same
	# archetype-driven resolve chain as the body above.
	rig.attach_weapon = true
	_character.add_child(rig)

	add_child(_character)
	_camera_rig.set_follow_target(_character)
	_setup_target_hud()


## Combat Phase C4 — a bare Label showing the currently-tracked target's id
## and (once a `combat:hit` arrives for it) health. Honest empty state: no
## target in range means no HUD text at all, never a stale/fabricated
## "Target: —" placeholder.
func _setup_target_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	_target_hud = Label.new()
	_target_hud.position = Vector2(16.0, 16.0)
	_target_hud.visible = false
	layer.add_child(_target_hud)
	_character.target_acquired.connect(_on_target_acquired)
	_character.target_lost.connect(_on_target_lost)
	_character.target_health_updated.connect(_on_target_health_updated)


## Combat, lock-on (2026-08-08) — a minimal, real HUD extension: appends the
## real lock mode (soft/hard) when one is active. Deliberately NOT a full
## screen-projected reticle (LockOnController.tsx's own rendered overlay) —
## that needs a real world-to-screen projector this HUD's plain `Label`
## doesn't have; a real, honest text suffix is the small, verified slice
## for this pass, with the full reticle flagged as a named follow-up.
func _lock_suffix() -> String:
	if _character == null:
		return ""
	match _character.get_lock_mode():
		"hard": return "  [HARD LOCK]"
		"soft": return "  [LOCK]"
		_: return ""


func _on_target_acquired(target_id: String) -> void:
	_target_hud.visible = true
	_target_hud.text = "Target: %s%s" % [target_id, _lock_suffix()]


func _on_target_lost() -> void:
	_target_hud.visible = false
	_target_hud.text = ""


func _on_target_health_updated(target_id: String, health: float, max_health: float) -> void:
	# A `combat:hit` for a target we've since lost track of (e.g. it moved out
	# of range between the attack landing and this event arriving) is real
	# data, just stale for THIS HUD — ignored silently rather than flashing a
	# health number for a target no longer shown as selected.
	if _character == null or target_id != _character.get_current_target_id():
		return
	_target_hud.text = "Target: %s  HP %d/%d%s" % [target_id, int(health), int(max_health), _lock_suffix()]


## Phase Q — top-center breadcrumb Label, mirroring QuestTracker.tsx's
## default "one line, J toggles the full list" UX (see that file's own
## Theme-4 comment: "hide UI in the world"). A bare Label, same minimal
## posture as `_target_hud` above — not a port of the TS component's pill/
## icon/claim-button chrome, which is real, separate follow-up UI work.
func _setup_quest_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	_quest_hud = Label.new()
	_quest_hud.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_quest_hud.position = Vector2(-200.0, 12.0)
	_quest_hud.size = Vector2(400.0, 80.0)
	_quest_hud.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_quest_hud.autowrap_mode = TextServer.AUTOWRAP_WORD
	_quest_hud.visible = false
	layer.add_child(_quest_hud)


func _on_quest_poll_succeeded(_count: int) -> void:
	_render_quest_hud()
	# F27 — recompute just the quest-POI subset (see WayfindingController's
	# own class-level comment on `_quest_pois` for why this is split from
	# `wire_sources`). `npc_positions_snapshot()` is a real, live read —
	# an NPC not yet spawned or aged out is honestly absent, never guessed.
	if _wayfinding != null and _avatar_manager != null:
		_wayfinding.set_quest_pois(_quest_poller.get_quests(), _avatar_manager.npc_positions_snapshot())


## Renders `_quest_poller`'s current snapshot into `_quest_hud` per
## `_quest_tracker_mode`, plus a trailing `[K] ...` action hint line when
## `QuestActions.resolve_action` finds something to do (claim/accept) — see
## quest_actions.gd's own class doc. Honest empty state: zero active quests
## AND no offerable action means no HUD text at all (mirrors
## QuestTracker.tsx's `if (quests.length === 0) return null`, extended by
## this slice's own accept case), never a stale/fabricated line.
func _render_quest_hud() -> void:
	if _quest_hud == null or _quest_poller == null:
		return
	var quests := _quest_poller.get_quests()
	var action_hint := _quest_action_hint()

	if quests.is_empty():
		if action_hint.is_empty():
			_quest_hud.visible = false
			_quest_hud.text = ""
			return
		_quest_hud.text = action_hint
		_quest_hud.visible = true
		return

	if _quest_tracker_mode == "list":
		var lines := PackedStringArray()
		for q in quests:
			var obj := WayfindingMarkers.next_incomplete_objective(q)
			var line: String
			if obj.is_empty():
				line = "%s — Reward ready" % String(q.get("title", ""))
			else:
				line = "%s: %s" % [String(q.get("title", "")), QuestBreadcrumb.breadcrumb_text(q, obj)]
			lines.append(line)
		if not action_hint.is_empty():
			lines.append(action_hint)
		_quest_hud.text = "\n".join(lines)
		_quest_hud.visible = true
		return

	# Breadcrumb (default) mode.
	var breadcrumb := QuestBreadcrumb.pick_breadcrumb(quests)
	if breadcrumb.is_empty():
		if action_hint.is_empty():
			_quest_hud.visible = false
			_quest_hud.text = ""
			return
		_quest_hud.text = action_hint
		_quest_hud.visible = true
		return
	var line := QuestBreadcrumb.breadcrumb_text(breadcrumb["quest"], breadcrumb["obj"])
	if not action_hint.is_empty():
		line += "\n" + action_hint
	_quest_hud.text = line
	_quest_hud.visible = true


## Resolves the current K-key action (via QuestActions.resolve_action) into
## a display line, or "" when there's nothing to do. Honest: reads directly
## from both pollers' real last-fetched snapshots, never a cached guess.
func _quest_action_hint() -> String:
	if _quest_actions == null or _quest_poller == null or _quest_available_poller == null:
		return ""
	var action := QuestActions.resolve_action(
		_quest_poller.get_quests(), _quest_available_poller.get_available_quests())
	if action.is_empty():
		return ""
	return "[K] %s" % String(action.get("label", ""))


## J toggles breadcrumb <-> list mode, matching QuestTracker.tsx's own J
## binding exactly (`e.key !== 'j' && e.key !== 'J'`). No input-field guard
## is needed here (unlike the TS version, which checks for a focused
## INPUT/TEXTAREA) — this client has no text-input UI mounted anywhere yet.
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_J:
		_quest_tracker_mode = "list" if _quest_tracker_mode == "breadcrumb" else "breadcrumb"
		_render_quest_hud()
	# Quest interaction slice — K accepts the first offerable quest (when no
	# quest is active) or claims the reward for the currently-tracked quest
	# (when it's all-done). See quest_actions.gd's own class doc for the
	# exact one-action-at-a-time resolution rule; a K press with nothing to
	# do is an honest no-op (QuestActions.try_action() itself guards this).
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_K:
		if _quest_actions != null:
			_quest_actions.try_action()

	# UI (2026-08-08) — Escape toggles the pause overlay. SessionManager
	# stays the single source of truth for whether the game is paused (see
	# its own `pause_overlay_active` doc comment); this handler only ever
	# calls its open/close methods, never touches `_pause_menu` directly —
	# `_on_pause_overlay_opened`/`_closed` above are what actually show/hide
	# it, reacting to the real state change.
	#
	# Combat, lock-on (2026-08-08) — a real, active lock takes Escape
	# PRIORITY over opening the pause menu: pressing Escape first clears the
	# lock (mirrors common third-person action-game convention — "back out
	# of the more immediate state first"), and only opens/closes pause when
	# no lock is active. This client's own precedence call — see
	# character_controller.gd#has_active_lock's own doc comment for why no
	# existing reference resolves this conflict (LockOnController.tsx and
	# this client's pause menu are independent systems).
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_ESCAPE:
		if _character != null and _character.has_active_lock():
			_character.clear_lock()
		elif _session != null:
			if _session.pause_overlay_active:
				_session.close_pause_overlay()
			else:
				_session.open_pause_overlay()


## F26 — feeds the local player's real position into `_rooftop_controller`
## every frame once a local player exists, so `rooftop_entered`/
## `rooftop_exited` genuinely fire on real state transitions rather than
## sitting wired-but-never-called. No consumer for those two signals exists
## yet (see `rooftop_access_controller.gd`'s own class doc: "a future unit
## would connect rooftop_entered to whatever prompt/menu surface the client
## eventually builds") — this only makes the controller's own internal
## state genuinely live and queryable via `nearest_rooftop_building`, which
## F27's wayfinding markers already consume.
func _process(_delta: float) -> void:
	if _rooftop_controller != null and _character != null:
		_rooftop_controller.update(_character.global_position)


func _on_connected() -> void:
	print("[boot] gateway socket open")


func _on_authenticated(user_id: String) -> void:
	print("[boot] authenticated as ", user_id)
	_local_user_id = user_id
	if _character != null:
		_character.local_user_id = user_id
	# R6 — every successful auth (including a reconnect, since `authenticated`
	# fires again on each one) is treated as a full resync point: re-join
	# every room this client had joined (not just the world room this method
	# used to hardcode), re-request the world's full scene snapshot, and let
	# ConKay's one-shot-derived presence state start clean rather than risk
	# showing a stuck "busy" indicator from a macro:completed that was missed
	# entirely while offline. `city:positions`/`world:aerial-traffic` need no
	# equivalent action here — their own ~100ms/~15s broadcast cadence
	# self-heals on the very next tick with no special-casing (see
	# net/gateway_client.gd's class doc for the full reasoning on why `_seq`
	# itself cannot drive this instead).
	var world_room := "world:%s" % world_id
	if not _joined_rooms.has(world_room):
		_joined_rooms.append(world_room)
	for room in _joined_rooms:
		_gateway.send_event("room:join", {"room": room})
	_gateway.send_event("scene:request", {"worldId": world_id})
	_conkay.reset()
	if spectator_mode:
		_session.request_mode(SessionManager.Mode.SPECTATE)


func _on_disconnected(reason: String) -> void:
	print("[boot] disconnected: ", reason)


func _on_sequence_anomaly(seq: int, last_seen: int) -> void:
	# R6 — diagnostic only, see gateway_client.gd's class doc: this can only
	# fire on genuine out-of-order/duplicate delivery, never on an ordinary
	# large jump (which is the normal case for this shared counter).
	print("[boot] gateway _seq anomaly: got ", seq, " after ", last_seen)


func _on_event(evt: String, data: Dictionary) -> void:
	match evt:
		"scene:data":
			_bootstrap.apply_scene(data)
			# F26/F27 — real modules with real tests since Sprint F, wired
			# for the first time here (see the class-level comment on
			# `_rooftop_controller`/`_wayfinding` above). Both re-pull from
			# `_bootstrap`/`_rooftop_controller`'s freshly-parsed state, so
			# a later `scene:data` (a reconnect, a world switch) keeps them
			# current rather than stuck on stale first-load geometry.
			_rooftop_controller.wire_from_scene_bootstrap(_bootstrap)
			_wayfinding.wire_sources(_bootstrap, _rooftop_controller)
			# Frame the real spawned world instead of leaving the camera at
			# whatever the FOLLOW-mode-with-no-target fallback shows before
			# this (session/camera_rig.gd's own honest Vector3.ZERO/tiny-
			# distance default). get_camera_bounds() (world/scene_bootstrap.gd
			# -- NOT get_bounds_center()/get_bounds_radius(), a different,
			# deliberately-unrelated pair) is a real measurement, robust to
			# a small number of far-outlying buildings: concordia-hub has a
			# genuinely authored "outlying district" ~1000m from its main
			# cluster, and get_bounds_radius() there reported 1114m (a
			# single farthest-node max) -- which crammed the real dense
			# 50-building core into a tiny corner of the frame behind a wall
			# of empty ground plane, a real defect found by measuring the
			# actual per-node distance distribution against a real running
			# server, not assumed. See that function's own doc comment for
			# the full method. The 0.3 MULTIPLIER on the resulting radius is
			# still an empirically-tuned constant, not a closed-form fit —
			# a straightforward "radius / tan(halfFov)"
			# projection predicted ~1.15-1.3 would fill the frame, but that
			# consistently rendered as a small cluster under 15% of frame
			# height when actually run and screenshotted against the live
			# server (tools/live_probe.gd); 0.3 is the value that was
			# ACTUALLY tested and produces individually-distinguishable
			# buildings -- re-tested against the new robust-bounds radius
			# (now ~230m for concordia-hub's dense core instead of the
			# outlier-inflated 1114m) and still holds. Floored at 10.0 so a
			# one-or-two-building world doesn't zoom in absurdly close.
			# First-draft, run-and-looked-at dial, same honesty class as
			# this repo's other Phase-D constants (CLAUDE.md's "Phase D
			# first-draft constants" table) — may need revisiting for a very
			# differently-shaped world.
			if _bootstrap.get_child_count() > 0:
				var _cam_bounds := _bootstrap.get_camera_bounds()
				_camera_rig.set_orbit_focus(_cam_bounds["center"])
				_camera_rig.set_orbit_distance(maxf(float(_cam_bounds["radius"]) * 0.3, 10.0))
				# A wide, mostly-flat authored world (buildings a few metres
				# tall spread over hundreds of metres) viewed at the rig's
				# shallow default pitch (~17 deg, tuned for close-up FEA
				# beam-model inspection) puts almost everything near the
				# horizon line — measured, not guessed: at the shallow
				# default this rendered as a small horizon-hugging cluster.
				# A steeper aerial look-down (~40 deg) is the standard
				# "overview map" angle real city/strategy games use for
				# exactly this shape of scene.
				_camera_rig.set_orbit_pitch(0.7)
				# yaw=0 (the rig's own default) looks straight down world -Z
				# — for concordia-hub specifically that axis happens to be
				# the city's LONGER extent (measured: z spans ~1200m vs x's
				# ~980m), so most of the real spread got foreshortened
				# toward the vanishing point instead of spreading across the
				# frame (measured, not guessed — this was tried first and
				# produced a small horizon-hugging cluster despite a
				# correctly-computed distance). PI/4 is the standard
				# three-quarter/isometric-style establishing angle real
				# strategy/city-builder cameras use specifically because it
				# has no "dominant axis" blind spot: it puts BOTH world
				# axes partially side-on to the camera regardless of which
				# one a given authored world happens to be longer along, so
				# it doesn't need to be re-tuned per world.
				_camera_rig.set_orbit_yaw(PI / 4.0)
				_has_pending_spawn_center = true
				_pending_spawn_center = _cam_bounds["center"]
				_try_spawn_local_player()
		"world:aerial-traffic":
			_aerial_traffic.apply_snapshot(data, Time.get_ticks_msec())
		"city:positions":
			# R6 — see avatar/avatar_manager.gd's own header for why this had
			# no live caller before this unit. Filters to THIS world only:
			# the server broadcasts city:positions globally across every
			# active city/world (city-presence.js#broadcastPositions has no
			# room/world scoping), so an unfiltered ingest would spawn
			# puppets for players in a completely different world. Uses
			# `cityId` (server's own fallback name for worldId when a
			# movement path only ever set the former — see
			# city-presence.js's updateUserPosition). `city:npcs` is
			# deliberately NOT handled here — that broadcast was retired
			# server-side (no listener existed anywhere, ever); see this
			# file's own class doc.
			if event_matches_world(data, world_id):
				_avatar_manager.ingest_snapshot(
					Time.get_ticks_msec(), users_array_to_dict(data.get("users", [])), "player")
		"combat:hit":
			# Combat, remote-target hit feedback (2026-08-08) — the LOCAL
			# player's OWN combat:hit handling (HUD text, hit-confirm SFX) is
			# a SEPARATE listener on the same `gateway.event_received` signal
			# (player/character_controller.gd's `_on_gateway_event` — Godot
			# signals support multiple subscribers). This is the other half:
			# when WE are the attacker and the target is a remote,
			# currently-spawned AvatarRig (never our own body, which
			# AvatarManager doesn't track), play its real flash_hit(). Honest
			# no-op via AvatarManager.flash_hit()'s own return when the rig
			# isn't currently tracked (despawned/stale/nonexistent).
			if not _local_user_id.is_empty() and String(data.get("attackerId", "")) == _local_user_id:
				var hit_target_id := String(data.get("targetId", ""))
				if not hit_target_id.is_empty() and hit_target_id != _local_user_id:
					_avatar_manager.flash_hit(hit_target_id)
		"macro:started", "macro:completed", "conkay:verdict":
			# R5/E22 — ConKay spatial mode. Real facts only: an in-flight
			# macro call (busy) and the last verdict's capability tier. See
			# conkay/conkay_presence_state.gd's header for why voice/overlay
			# state is deliberately NOT included here. Always processed,
			# regardless of SessionManager's current mode/overlay state.
			_conkay.handle_event(evt, data)
		"room:joined":
			print("[boot] joined room ", data.get("room", "?"))
		_:
			# Unhandled events are logged, not fatal.
			pass


## R6 — pure translation, no engine calls, so it's testable without a scene
## tree (same rationale as resolve_runtime_config above).
## `city:positions.users` ships as an ARRAY of {userId, x, y, z, ...}
## (server/lib/city-presence.js#broadcastPositions) but
## AvatarManager.ingest_snapshot expects a Dictionary keyed by id — the shape
## `city:npcs` used to ship before it was retired server-side. Any entry
## missing/blank `userId`, or that isn't itself a Dictionary, is dropped
## rather than guessed at.
static func users_array_to_dict(users: Array) -> Dictionary:
	var out := {}
	for u in users:
		if typeof(u) != TYPE_DICTIONARY:
			continue
		var uid := String(u.get("userId", ""))
		if uid.is_empty():
			continue
		out[uid] = u
	return out


## R6 — pure predicate, testable without a scene tree. `city:positions`
## carries `cityId` (see users_array_to_dict's doc); falls back to a
## `worldId` field too in case a future server revision ever sends one
## directly, matching city-presence.js's own `worldId ?? cityId` fallback
## convention.
static func event_matches_world(data: Dictionary, expected_world_id: String) -> bool:
	return String(data.get("cityId", data.get("worldId", ""))) == expected_world_id


## Real trigger for the FEA overlay — call with a real `{nodes, members,
## loads, supports}` model (e.g. from a Game Design Lens building the caller
## already holds). No-ops honestly (via SessionManager's own
## `fea_overlay_rejected` signal) if the overlay can't legally open right
## now (PLAYTEST) or is already open.
func request_fea_overlay(model: Dictionary) -> void:
	if _session.open_fea_overlay():
		_fea_scene.request_scene(model)


func close_fea_overlay() -> void:
	_session.close_fea_overlay()


func _on_fea_overlay_opened() -> void:
	_fea_scene.visible = true
	# Best-effort initial focus from whatever is already spawned (possibly
	# stale/empty on a fresh open) — corrected for real by
	# _on_fea_scene_ready once the actual fetch completes.
	_camera_rig.set_orbit_focus(_fea_scene.get_bounds_center())


func _on_fea_overlay_closed() -> void:
	_fea_scene.visible = false


func _on_fea_scene_ready(_node_count: int, _member_count: int) -> void:
	_camera_rig.set_orbit_focus(_fea_scene.get_bounds_center())


func _on_mode_transition_rejected(requested_mode: int, reason: String) -> void:
	print("[boot] mode transition to ", requested_mode, " rejected: ", reason)


func _on_fea_overlay_rejected(reason: String) -> void:
	print("[boot] fea overlay rejected: ", reason)


func _on_pause_overlay_opened() -> void:
	_pause_menu.open()


func _on_pause_overlay_closed() -> void:
	_pause_menu.close()
