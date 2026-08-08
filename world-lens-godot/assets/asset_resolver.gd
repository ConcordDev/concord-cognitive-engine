class_name AssetResolver
extends Node
## AssetResolver — maps a (kind, id) pair to a downloadable .glb URL.
##
## Strategy:
##   1. Try the dynamic resolve endpoint (evo-asset promotions can supply a
##      real, per-instance model URL): GET {base}/api/evo-asset/resolve?source&sourceId
##      → JSON { url }.
##   2. Fall back to the static convention: {base}/models/{kind}/{id}.glb
##
## `?source=&sourceId=` (2026-08-08, was `?kind=&id=`) — the real route
## (server/routes/evo-asset.js#GET /resolve) reads `source`/`sourceId`, not
## `kind`/`id`; the mismatched names meant this call always failed its own
## `source and sourceId required` check, so the dynamic-promotion lookup has
## never actually worked — only ever fell through to the static convention
## below. Found by an actual cross-origin Godot browser load (also surfaced
## a second, independent bug: `/api/evo-asset` was missing from server.js's
## publicReadPaths/`_safeReadPaths`, now fixed too).
##
## Honest failure: if the resolve endpoint errors AND the caller wants strict
## resolution, `resolve_failed` fires. The `fallback_url` static func is always
## available as a pure, deterministic path — but it is a CONVENTION, not a promise
## the file exists; the GlbLoader surfaces a 404 honestly downstream.

signal resolved(kind: String, id: String, url: String)
signal resolve_failed(kind: String, id: String, reason: String)

@export var base_url: String = "http://127.0.0.1:5050"
## Default flipped false (2026-08-08, was true) — found by an actual browser
## load of a real scene with ~50 NPCs + buildings + vegetation + the local
## player all resolving at once: the dynamic-lookup round trip is a GUARANTEED
## miss today (confirmed by direct grep of server/lib/evo-asset/*.js and
## domains/evo-asset.js — nothing anywhere registers an evo_assets row under
## source "npc"/"vegetation"/"building"/"player", only "polyhaven"/"kenney"/
## "ambientcg"/"os3a"/"github"/"authored"/"concordia"/"evolved" — a real,
## separate CC0-asset-ingestion pipeline that has never been wired to feed
## these specific kinds), so every entity was paying a real HTTP round trip
## for a `not_registered` answer it always gets. Measured impact: a real
## Chromium load showed 50/50 of these lookups landing on the shared per-
## origin connection pool at once, queuing behind each other and starving
## the LOCAL PLAYER's own (much more important) body-mesh fetch — the avatar
## stayed on its primitive placeholder for 35+ real seconds while NPC lookups
## it was queued behind slowly failed one by one. Skipping the round trip by
## default restores instant static-fallback resolution (matching what
## effectively already happened before the auth-gate fix above, when every
## call 401'd near-instantly) without losing any real functionality — the
## toggle stays real and available for a caller that specifically wants to
## try the dynamic path once a registration pipeline for these kinds exists.
@export var use_resolve_endpoint: bool = false
## Threaded through to `fallback_url` for kind "player"/"npc" so a
## per-world hero-mesh variant can be preferred over the universal one —
## see that function's own comment for why. Blank is a legal, honest value
## (no per-world variant preference; falls to the universal archetype file).
@export var world_id: String = ""
## Threaded through to `fallback_url` for kind "player"/"npc" — which of the
## 7 real archetype meshes to resolve. Defaults to "warrior", matching the
## honest default every caller used before this field existed (no per-avatar
## archetype signal exists on the wire yet — see that function's own
## comment). Set explicitly once a real signal exists; an unset/empty value
## here still resolves correctly (falls to "warrior" inside `fallback_url`).
@export var archetype: String = "warrior"


## Async resolve: try the endpoint, fall back to the static path.
func resolve(kind: String, id: String) -> void:
	if not use_resolve_endpoint:
		resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id, world_id, archetype))
		return

	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_completed.bind(kind, id, req))
	var endpoint := "%s/api/evo-asset/resolve?source=%s&sourceId=%s" % [
		base_url, kind.uri_encode(), id.uri_encode()]
	var err := req.request(endpoint)
	if err != OK:
		req.queue_free()
		# Endpoint unreachable → static fallback (honest: may still 404 at load).
		resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id, world_id, archetype))


func _on_completed(
		result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray, kind: String, id: String, req: HTTPRequest) -> void:
	req.queue_free()
	if result == HTTPRequest.RESULT_SUCCESS and code == 200:
		var parsed = JSON.parse_string(body.get_string_from_utf8())
		if typeof(parsed) == TYPE_DICTIONARY and parsed.has("url"):
			resolved.emit(kind, id, String(parsed["url"]))
			return
	# Any failure → static fallback path (never fabricate a resolved asset).
	resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id, world_id, archetype))


## Pure static convention path. Deterministic; existence not guaranteed.
##
## kind "player"/"npc" is special-cased onto the REAL hero-mesh convention
## the Three.js client already uses and ships real files for
## (concord-frontend/lib/concordia/hero-mesh-registry.ts's
## ARCHETYPE_FALLBACK_PATH + its per-world "archetype-world" candidate) —
## NOT the building convention's `{base}/models/{kind}/{id}.glb`, which has
## no `player`/`npc` files on disk and would always 404. There is no
## per-user bespoke rig today (id is a session/user id, not an authored
## hero id), so this resolves to `archetype` (defaulting to the shared
## "warrior" archetype — the same universal default every remote/spectated
## player renders as in the web client absent a more specific occupation
## signal, which the `city:positions` wire payload this resolves from
## doesn't carry). An empty/unrecognised `archetype` value also falls to
## "warrior" rather than building a 404-guaranteed URL. A non-empty
## `world_id` prefers that world's palette variant
## (`_archetype_<archetype>__{world_id}.glb`, one of 6 authored today per
## archetype); GlbLoader honestly 404s and the caller's primitive
## placeholder stays up if a given world/archetype pair has no variant —
## never fabricated, never guessed beyond this documented convention.
static func fallback_url(
		base: String, kind: String, id: String, world_id: String = "", archetype: String = "warrior"
) -> String:
	if kind == "player" or kind == "npc":
		var arch := archetype if ARCHETYPE_WEAPON.has(archetype) else "warrior"
		if not world_id.is_empty():
			return "%s/meshes/heroes/_archetype_%s__%s.glb" % [base, arch, world_id]
		return "%s/meshes/heroes/_archetype_%s.glb" % [base, arch]
	return "%s/models/%s/%s.glb" % [base, kind, id]


## ── Weapon resolution (Phase M1 — mesh library wiring) ───────────────────────
##
## Maps each of the 7 real hero archetypes to a real weapon GLB id from
## `concord-frontend/public/models/weapon/*.glb` (the same 15-file library
## `concord-frontend/lib/concordia/weapon-archetypes.ts` uses). This table is
## authored fresh, not ported — the Three.js client's own weapon selection
## (`enhanced-avatar-builder.ts`) keys off `accessories.carry` lists driven by
## body-shape/faction-style presets (`character-schema.ts`'s `BodyArchetype` —
## slim/average/stocky/tall/broad/petite/legend), a DIFFERENT axis from the 7
## occupation-flavoured hero archetypes (warrior/guard/scholar/mystic/hunter/
## trader/legend) this file resolves bodies against; there is no existing
## direct mapping between the two to port. `enhanced-avatar-builder.ts` has
## exactly one place where the two axes touch (`bodyArchetype === 'legend' ?
## 'greatsword' : 'longsword'`), reused verbatim below for the one archetype
## name shared by both systems. The rest is a small, deliberately
## conservative table using only real on-disk weapon ids: not every
## archetype carries a weapon (scholar/trader carry no combat weapon in the
## Three.js carryDefault presets either — tome/satchel/pouch, none of which
## have a real GLB on disk today, so they correctly resolve to "no weapon"
## here rather than a fabricated blade). An archetype with no entry, or an
## empty string value, means "no weapon" — not a failure.
const ARCHETYPE_WEAPON := {
	"warrior": "longsword",
	"guard": "spear",
	"hunter": "bow",
	"mystic": "staff",
	"legend": "greatsword",
	"scholar": "",
	"trader": "",
	# Undead archetypes (2026-08-08) — see hero-mesh-registry.ts's matching
	# table for why these 4 keys exist and which real mesh backs each.
	# `lich` reuses the already-wired real `staff` asset (a spellcaster boss
	# thematically carries one); the other 3 stay weaponless like
	# scholar/trader above rather than sourcing 4 more assets this pass —
	# an honest scope boundary, not an oversight.
	"undead": "",
	"zombie": "",
	"wraith": "",
	"lich": "staff",
}


## Resolve the weapon GLB URL for an archetype, or "" when that archetype
## carries no weapon (honest — not a failure, callers should skip loading).
## Pure and deterministic like `fallback_url`; existence on disk is still
## not guaranteed (GlbLoader surfaces a 404 honestly downstream).
static func weapon_url_for_archetype(base: String, archetype: String) -> String:
	var weapon_id: String = ARCHETYPE_WEAPON.get(archetype, "")
	if weapon_id == "":
		return ""
	return "%s/models/weapon/%s.glb" % [base, weapon_id]
