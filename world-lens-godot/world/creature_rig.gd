class_name CreatureRig
extends Node3D
## CreatureRig — Phase M3. Presentation-layer puppet for ONE live creature
## (`server/lib/fauna-spawner.js`/`creature-behaviors.js` population, read
## via world/creature_poller.gd). Deliberately NOT built on
## avatar/avatar_rig.gd's humanoid machinery (14-bone `bone_specs()`/gait/
## two-bone-IK/weapon-attach) — see world/creature_manager.gd's own class
## doc for the full reasoning: a fox/bird/fish is architecturally nothing
## like a humanoid player/NPC. Mirrors world/dtu_prop_renderer.gd's asset
## strategy instead: a real GLB when one resolves, else a tinted placeholder
## primitive that stays up forever on failure — never fabricates.

signal rig_ready(source: String)  # "glb" or "primitive"
signal glb_load_failed(reason: String)

@export var creature_id: String = ""
@export var topology: String = "quadruped"
@export var species_id: String = ""
@export var coat_color: String = ""
## Frontend static-asset origin (creature GLBs live in
## concord-frontend/public/models/creature/*.glb) — distinct from
## CreatureManager's backend-origin data fetch and CreaturePoller's
## `base_url`. See world/boot.gd's dual-origin wiring comment.
@export var base_url: String = "http://127.0.0.1:3000"

var _placeholder: MeshInstance3D = null
var _glb_root: Node3D = null
var _resolver: Node = null
var _loader: Node = null

## Real on-disk creature GLBs, ported verbatim from the Three.js client's own
## `REAL_ASSET_TOPOLOGIES` table (concord-frontend/lib/world-lens/
## creature-renderer.ts) — keyed by TOPOLOGY, not species id: many species
## share one topology's mesh pool (a wolf and a steam_drake both resolve
## against "quadruped" if that's their taxonomy topology). Any topology not
## in this table (serpentine/eel/shark/fish/cephalopod/polyped/amorphous/
## humanoid, per server/lib/species-taxonomy.js) honestly has no real asset
## yet — stays on the placeholder, never a guessed substitute.
const REAL_ASSET_TOPOLOGIES := {
	"quadruped": ["quadruped_01", "quadruped_02", "quadruped_03"],
	"winged_biped": ["winged_biped_01"],
}


func _ready() -> void:
	_build_placeholder()
	rig_ready.emit("primitive")
	_try_resolve_glb()


## Position-only — `for_world`'s creature objects carry no rotation/heading
## field at all (creature_poller.gd's own class doc); a fixed default facing
## is an honest simplification, not a fabricated one.
func apply_transform(pos: Vector3) -> void:
	position = pos


func _build_placeholder() -> void:
	var mesh_instance := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.3
	capsule.height = 0.9
	mesh_instance.mesh = capsule
	var mat := StandardMaterial3D.new()
	mat.albedo_color = placeholder_color(coat_color)
	mesh_instance.material_override = mat
	add_child(mesh_instance)
	_placeholder = mesh_instance


func _try_resolve_glb() -> void:
	# Bare-name call, not `CreatureRig.real_asset_id_for_topology(...)` — see
	# net/gateway_client.gd's class doc for the real, engine-reproduced
	# "Identifier not found" bug this pattern avoids (a same-class
	# `class_name`-qualified static call from inside its own file).
	var asset_id := real_asset_id_for_topology(topology, creature_id)
	if asset_id == "":
		return  # honest: no real asset for this topology yet — stay on the placeholder

	var AssetResolver := load("res://assets/asset_resolver.gd")
	var GlbLoader := load("res://assets/glb_loader.gd")
	_resolver = AssetResolver.new()
	_resolver.base_url = base_url
	add_child(_resolver)
	_resolver.resolved.connect(_on_resolved)
	_resolver.resolve_failed.connect(_on_resolve_failed)

	_loader = GlbLoader.new()
	add_child(_loader)
	_loader.loaded.connect(_on_glb_loaded)
	_loader.load_failed.connect(_on_glb_failed)

	_resolver.resolve("creature", asset_id)


func _on_resolved(_kind: String, _id: String, url: String) -> void:
	_loader.load_glb(url)


func _on_resolve_failed(_kind: String, _id: String, reason: String) -> void:
	glb_load_failed.emit(reason)


func _on_glb_loaded(_url: String, root: Node3D) -> void:
	if root == null:
		return
	_glb_root = root
	add_child(_glb_root)
	if _placeholder != null:
		_placeholder.visible = false
	rig_ready.emit("glb")


func _on_glb_failed(_url: String, reason: String) -> void:
	glb_load_failed.emit(reason)


# ── Pure static helpers ──────────────────────────────────────────────────────

## Deterministic variant pick from `topology` + `creature_id`. Returns "" for
## an uncovered topology — an honest "no real asset" answer, never a guessed
## substitute. The same creature_id always resolves to the same variant.
static func real_asset_id_for_topology(topology: String, creature_id: String) -> String:
	var variants: Array = REAL_ASSET_TOPOLOGIES.get(topology, [])
	if variants.is_empty():
		return ""
	var idx := int(floor(_hash_unit(creature_id + ":variant") * variants.size()))
	return variants[clampi(idx, 0, variants.size() - 1)]


## A hex-string coat colour when one is real and well-formed, else a neutral
## earthy default — mirrors dtu_prop_renderer.gd's slot_color's
## "distinguishing tint, not final art" posture.
static func placeholder_color(coat_color: String) -> Color:
	if coat_color.begins_with("#") and Color.html_is_valid(coat_color):
		return Color.html(coat_color)
	return Color(0.5, 0.42, 0.32)


## Deterministic unit float [0,1) from a string seed. Uses GDScript's
## built-in String.hash() (a real, stable-within-one-running-client 32-bit
## hash) rather than porting a bespoke algorithm — this only needs to be
## stable CLIENT-SIDE across repeated calls within one running client,
## unlike the server's hashSeed() which needs cross-process reproducibility.
static func _hash_unit(s: String) -> float:
	return float(absi(s.hash()) % 1000000) / 1000000.0
