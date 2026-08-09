class_name AvatarRig
extends Node3D
## AvatarRig — presentation-layer puppet for one player or NPC avatar.
##
## Decoupled from movement/physics on purpose: the LOCAL player's
## CharacterBody3D (player/character_controller.gd) can mount one of these as
## a child for its visuals, and avatar_manager.gd drives one directly (no
## physics body — position is set from interpolated snapshot data) for every
## REMOTE player/NPC. Either owner calls the same small public API:
## `apply_transform()`, `set_locomotion()`, `get_locomotion_state()`.
##
## ── Asset strategy (honest-by-construction) ─────────────────────────────────
## 1. PREFERRED: resolve a real humanoid GLB via assets/asset_resolver.gd
##    (kind "player"/"npc", id = rig_id) + assets/glb_loader.gd. On success the
##    downloaded scene replaces the primitive placeholder as this node's
##    child, and `_skeleton` is repointed at whatever Skeleton3D the GLB
##    itself contains (if any) — that skeleton is real, ours is not touched.
## 2. FALLBACK: a primitive placeholder (CapsuleMesh limbs positioned per
##    BONE_SPECS) is shown immediately and stays up if the GLB never resolves
##    or 404s. This file NEVER claims a GLB loaded when it didn't — a failed
##    resolve/load just leaves the primitive in place (see
##    `_on_glb_loaded`/`_on_glb_failed`).
##
## The primitive is plain Node3D "sockets" positioned by summed BONE_SPECS
## offsets, each holding one MeshInstance3D — it is NOT skinned to a
## Skeleton3D (building a procedurally-authored, correctly-bound Skeleton3D
## bone hierarchy by hand, with no engine available in this container to load
## and visually confirm it, would be exactly the kind of fabricated-looking-
## but-unverifiable config the project's honesty invariant warns against —
## see world-lens-godot/player/character_controller.gd's own comment on the
## same tradeoff for InputMap). The empty `Skeleton3D` node this file DOES
## create is a real hookup point for a future GLB's skinned mesh, not a
## placeholder claiming to be rigged itself.
##
## Bone naming mirrors the Three.js client's gait-pose target list exactly —
## concord-frontend/lib/concordia/gait-synthesis.ts:54-71 (`GaitPose` fields)
## and concord-frontend/components/world-lens/AvatarSystem3D.tsx:199-219
## (`BONE_HIERARCHY`) — this is what lets Migration M2's `apply_gait()`
## (below) address leg sockets/bones by the same names with no renaming pass.
##
## ── Migration M2 — procedural gait + foot IK ─────────────────────────────────
## `apply_gait(state, speed, delta)` drives the two leg joints per frame: it
## advances a per-rig gait phase from real distance travelled
## (gait_solver.gd#gait_phase), derives a per-foot effector target
## (gait_solver.gd#foot_targets), solves hip/knee angles analytically
## (two_bone_ik.gd#solve_two_bone), and applies them to whatever REAL leg
## geometry exists right now — a matching Skeleton3D bone (once a GLB has
## resolved) or the primitive placeholder's flat Node3D socket, via
## `_apply_bone_angle()`. All gait/IK MATH is pure and lives in the two
## sibling files; this class only does the engine-gated lookup + apply, and
## — like everything else in this file — that application has never been
## seen on a real skeleton (see VISUAL_QA.md).

signal rig_ready(source: String)  # "glb" or "primitive"
signal glb_load_failed(reason: String)
signal weapon_ready()
signal weapon_load_failed(reason: String)

## Passed to AssetResolver as the `kind` query param.
@export var rig_id: String = ""
@export var kind: String = "npc"  # "player" | "npc"
@export var base_url: String = "http://127.0.0.1:5050"
@export var prefer_glb: bool = true
## Threaded to AssetResolver.resolve()'s per-world hero-mesh variant
## preference (assets/asset_resolver.gd#fallback_url) — see that function's
## own comment. Blank is legal (falls to the universal archetype file).
@export var world_id: String = ""
## Threaded to AssetResolver as the body-mesh + weapon archetype (Phase M1).
## Defaults to "warrior" — the honest default. As of the character-
## archetype-signal unit (2026-08-08), `world/boot.gd` overrides this for
## the LOCAL player's own rig with a real signal resolved from their saved
## RichAppearanceConfig (see world/player_appearance_loader.gd +
## avatar/appearance_archetype.gd) — no saved appearance / auth failure /
## timeout honestly falls through to this default. REMOTE avatars (NPCs and
## other players, via avatar_manager.gd) still carry no such signal — the
## wire (`city:positions`) has no archetype field for anyone but the local
## player, who resolves their own via a direct authenticated fetch instead
## of the broadcast; see asset_resolver.gd#fallback_url for the resolve
## chain this feeds.
@export var archetype: String = "warrior"
## Weapon meshes are optional dressing on top of an already-real body mesh —
## off by default so a caller that only wants the body (e.g. a future
## non-combat spectator-only render path) doesn't pay for a second HTTP
## fetch it never asked for. `world/avatar_manager.gd`/local-player spawn
## turn this on explicitly.
@export var attach_weapon: bool = false

var _skeleton: Skeleton3D = null
var _primitive_root: Node3D = null
var _glb_root: Node3D = null
var _current_state: String = "idle"
var _current_blend: Dictionary = {}
var _resolver: Node = null
var _loader: Node = null
var _weapon_loader: Node = null
var _weapon_root: Node3D = null

## The real, engine-verified right-hand bone name inside the hero-mesh GLBs
## (`tools/avatar_bone_probe.gd`, run against a real `.glb` under a real
## Godot 4.4 + Xvfb — see VISUAL_QA.md). These are Microsoft Rocketbox/3ds-Max
## Biped rigs, NOT Mixamo naming despite the "Mixamo humanoid" shorthand
## elsewhere in this file's own docs — "Bip01 R Hand" is the real name found
## on disk, not a guessed convention.
const HAND_BONE_GLB := "Bip01 R Hand"
## Primitive-placeholder fallback attach point — `bone_specs()` has no
## explicit hand joint (stops at the forearm, see that function's own
## comment), so the weapon rides the forearm socket with a small offset
## rather than inventing a new bone the placeholder was never designed to
## carry (same "don't fabricate rig detail beyond what's verified" posture
## the class doc states for why the primitive isn't a real Skeleton3D bind).
const HAND_SOCKET_PRIMITIVE := "rightForearm"

## Cumulative horizontal distance (metres) fed into gait_solver.gd's
## distance-driven phase advance. Reset is never needed — gait_phase() wraps
## via fposmod, so an ever-growing accumulator is harmless (matches
## advanceGaitPhase's own phase-only wraparound in the TS source; this rig
## just accumulates distance instead of phase directly, which is equivalent
## and lets gait_phase() stay a pure function of total distance rather than
## needing a running phase argument threaded through every call).
var _gait_distance: float = 0.0


func _ready() -> void:
	_skeleton = Skeleton3D.new()
	_skeleton.name = "Skeleton3D"
	add_child(_skeleton)

	_build_primitive()
	rig_ready.emit("primitive")

	if prefer_glb:
		_try_resolve_glb()

	if attach_weapon:
		_try_resolve_weapon()


## Set world position + Y-axis rotation (radians). Engine-gated (Node3D
## transform), but trivial — no math to hide behind a pure func.
func apply_transform(pos: Vector3, rotation_y: float) -> void:
	position = pos
	rotation.y = rotation_y


## Combat, remote-target hit feedback (2026-08-08) — a brief scale "punch"
## on THIS rig's root, deliberately independent of `position`/`rotation`:
## a remote rig's transform is entirely owned by snapshot interpolation
## (avatar_manager.gd applies the next incoming `city:positions` sample
## every frame), so a positional knockback nudge here would just be
## overwritten by the very next sample — see this file's own class doc and
## player/character_controller.gd's "Combat Phase C" note for the fuller
## explanation of why remote-target feedback was deferred until this unit.
## Scaling the whole Node3D instead works uniformly whether this rig is
## currently showing its real GLB body or the honest primitive-box
## placeholder — it needs no knowledge of what mesh/material is underneath.
## HIT_FLASH_PUNCH/_DURATION_S are first-draft, run-and-looked-at constants
## (same honesty class as CLAUDE.md's "Phase D first-draft constants"),
## not a closed-form fit.
const HIT_FLASH_DURATION_S := 0.16
const HIT_FLASH_PUNCH := 1.28

var _hit_flash_tween: Tween = null

func flash_hit() -> void:
	if _hit_flash_tween != null and _hit_flash_tween.is_valid():
		_hit_flash_tween.kill()
	scale = Vector3.ONE
	_hit_flash_tween = create_tween()
	_hit_flash_tween.set_trans(Tween.TRANS_QUAD)
	_hit_flash_tween.tween_property(
		self, "scale", Vector3.ONE * HIT_FLASH_PUNCH, HIT_FLASH_DURATION_S * 0.35)
	_hit_flash_tween.tween_property(
		self, "scale", Vector3.ONE, HIT_FLASH_DURATION_S * 0.65)


## Record the current locomotion/override decision (from
## animation_state_machine.select_state()). This unit does not yet wire real
## AnimationPlayer clips onto the primitive or a loaded GLB — that lands with
## the actual gait-synthesis port — so this just stores state for
## `get_locomotion_state()`/`get_locomotion_blend()` to expose a ready hook.
func set_locomotion(state: String, blend: Dictionary) -> void:
	_current_state = state
	_current_blend = blend


func get_locomotion_state() -> String:
	return _current_state


func get_locomotion_blend() -> Dictionary:
	return _current_blend


## Look up a placeholder bone socket by name (e.g. "hips", "chest"). Returns
## null if not built yet or name unknown. Useful to a future gait-synthesis
## port that wants to rotate/position individual sockets directly.
func get_bone_node(bone_name: String) -> Node3D:
	if _primitive_root == null:
		return null
	return _primitive_root.get_node_or_null(NodePath(bone_name)) as Node3D


## Advance procedural leg gait for this frame and apply it to whatever real
## leg geometry currently exists. `state` is an animation_state_machine.gd
## locomotion/override label; `speed` is horizontal m/s; `delta` is the
## frame time in seconds.
##
## Idle plants both feet — no phase advance, no swing, no lift (the neutral
## standing pose from bone_specs() is used as the effector target directly).
## Any other state (walk/run/jump/fall/land, or a one-shot override action)
## advances the SAME ground-gait cycle; this unit does not author distinct
## airborne leg poses for jump/fall — an honest simplification, not a claim
## that a jumping avatar's legs look correct, see VISUAL_QA.md.
func apply_gait(state: String, speed: float, delta: float) -> void:
	var left_offset := Vector3.ZERO
	var right_offset := Vector3.ZERO

	if state != "idle":
		var gait_solver := load("res://avatar/gait_solver.gd")
		_gait_distance += speed * delta
		var phase: float = gait_solver.gait_phase(_gait_distance, speed)
		var stride_len: float = gait_solver.stride_length_for_speed(speed)
		var targets: Dictionary = gait_solver.foot_targets(phase, speed, stride_len)
		left_offset = targets["left"]
		right_offset = targets["right"]

	_solve_and_apply_leg("leftUpperLeg", "leftLowerLeg", "leftFoot", left_offset)
	_solve_and_apply_leg("rightUpperLeg", "rightLowerLeg", "rightFoot", right_offset)


## Solve one leg's hip/knee angles via two_bone_ik.gd and apply them.
## Segment lengths are DERIVED from bone_specs()'s own offsets (never
## hardcoded separately) so they can never drift out of sync with the
## placeholder's actual joint spacing.
func _solve_and_apply_leg(
		hip_name: String, knee_name: String, foot_name: String, foot_offset: Vector3) -> void:
	var two_bone_ik := load("res://avatar/two_bone_ik.gd")
	var specs := AvatarRig.bone_specs()

	var hip_pos: Vector3 = AvatarRig.bone_world_offset(specs, hip_name)
	var knee_pos: Vector3 = AvatarRig.bone_world_offset(specs, knee_name)
	var neutral_foot_pos: Vector3 = AvatarRig.bone_world_offset(specs, foot_name)

	var upper_len: float = (knee_pos - hip_pos).length()
	var lower_len: float = (neutral_foot_pos - knee_pos).length()
	var target: Vector3 = neutral_foot_pos + foot_offset

	var solved: Dictionary = two_bone_ik.solve_two_bone(hip_pos, upper_len, lower_len, target)

	_apply_bone_angle(hip_name, float(solved["hip_angle"]))
	_apply_bone_angle(knee_name, float(solved["knee_angle"]))


## Set a bone/socket's local sagittal-plane (X-axis) rotation to `angle`
## radians. Prefers a real named Skeleton3D bone (once a GLB has resolved
## and repointed `_skeleton` — see `_on_glb_loaded`); falls back to the
## primitive placeholder's flat Node3D socket (`get_bone_node`) so the
## immediately-visible capsule rig moves too. No-op if neither exists yet
## (e.g. mid-resolve) — never fabricates a bone that isn't really there.
func _apply_bone_angle(bone_name: String, angle: float) -> void:
	if _skeleton != null:
		var idx := _skeleton.find_bone(bone_name)
		if idx >= 0:
			_skeleton.set_bone_pose_rotation(idx, Quaternion(Vector3.RIGHT, angle))
			return
	var socket := get_bone_node(bone_name)
	if socket != null:
		socket.rotation.x = angle


func _build_primitive() -> void:
	var root := Node3D.new()
	root.name = "PrimitivePlaceholder"
	add_child(root)
	_primitive_root = root

	# Phase S1 (2026-08-07) — one shared toon material for every limb capsule,
	# built once per rig rather than per-bone (14 bones would otherwise mean
	# 14 separate ShaderMaterial instances of the IDENTICAL world palette).
	# Degrades to null honestly if the generated spec is unavailable — the
	# capsules keep Godot's default material, never a fabricated colour.
	var ArtStyle := load("res://world/art_style.gd")
	var toon_mat = ArtStyle.make_toon_material(world_id)

	var specs := AvatarRig.bone_specs()
	for spec in specs:
		var socket := Node3D.new()
		socket.name = String(spec["name"])
		socket.position = AvatarRig.bone_world_offset(specs, String(spec["name"]))
		root.add_child(socket)

		var mesh_instance := MeshInstance3D.new()
		var capsule := CapsuleMesh.new()
		capsule.radius = float(spec["radius"])
		capsule.height = float(spec["height"])
		mesh_instance.mesh = capsule
		if toon_mat != null:
			mesh_instance.material_override = toon_mat
		socket.add_child(mesh_instance)


func _try_resolve_glb() -> void:
	var AssetResolver := load("res://assets/asset_resolver.gd")
	var GlbLoader := load("res://assets/glb_loader.gd")
	_resolver = AssetResolver.new()
	_resolver.base_url = base_url
	_resolver.world_id = world_id
	_resolver.archetype = archetype
	add_child(_resolver)
	_resolver.resolved.connect(_on_resolved)
	_resolver.resolve_failed.connect(_on_resolve_failed)

	_loader = GlbLoader.new()
	add_child(_loader)
	_loader.loaded.connect(_on_glb_loaded)
	_loader.load_failed.connect(_on_glb_failed)

	_resolver.resolve(kind, rig_id)


func _on_resolved(_kind: String, _id: String, url: String) -> void:
	_loader.load_glb(url)


func _on_resolve_failed(_kind: String, _id: String, reason: String) -> void:
	# Honest: no fabricated URL guess beyond the resolver's own static
	# fallback convention (already tried inside AssetResolver itself). Stay
	# on the primitive.
	glb_load_failed.emit(reason)


func _on_glb_loaded(_url: String, root: Node3D) -> void:
	if root == null:
		return
	_glb_root = root
	add_child(_glb_root)
	var found := _find_skeleton(_glb_root)
	if found != null:
		_skeleton = found
	if _primitive_root != null:
		_primitive_root.visible = false
	# Phase S3 — the resolved body GLB carries its own baked materials
	# (Mixamo/Rocketbox textures), completely bypassing the primitive's toon
	# material_override above. "Toon-shading reach" (2026-08-08) upgraded
	# this from outline-only to the texture-preserving banded-lighting
	# treatment (real skin/clothing texture kept, only the lighting response
	# bands) wherever a surface carries a real albedo texture — see
	# ArtStyle.apply_textured_toon_to_tree's own doc; anything else honestly
	# falls back to outline-only, never skipped or given a fabricated look.
	var ArtStyleOutline := load("res://world/art_style.gd")
	ArtStyleOutline.apply_textured_toon_to_tree(_glb_root, world_id)
	# Weapon resolution races body-GLB resolution (both fire from `_ready()`
	# as independent HTTP requests) — if a weapon already attached to the
	# now-hidden primitive's forearm socket, re-home it onto the real
	# skeleton's hand bone so it doesn't silently vanish with the primitive.
	if _weapon_root != null:
		var new_attach := _hand_attach_point()
		if new_attach != null and _weapon_root.get_parent() != new_attach:
			_weapon_root.get_parent().remove_child(_weapon_root)
			new_attach.add_child(_weapon_root)
	rig_ready.emit("glb")


func _on_glb_failed(_url: String, reason: String) -> void:
	# Honest: the primitive placeholder stays visible; nothing is fabricated.
	glb_load_failed.emit(reason)


## ── Phase M1 — weapon-in-hand ────────────────────────────────────────────────
## A weapon is separate dressing from the body mesh above, resolved and
## attached independently: an archetype that carries no weapon
## (asset_resolver.gd#ARCHETYPE_WEAPON — scholar/trader today) is not a
## failure case, it's a real "no weapon" answer, and this never blocks or
## depends on whether the body itself resolved to a real GLB or stayed on
## the primitive — both attach points exist as soon as `_build_primitive()`
## has run (which `_ready()` guarantees before this is ever called).
func _try_resolve_weapon() -> void:
	var AssetResolver := load("res://assets/asset_resolver.gd")
	var weapon_url: String = AssetResolver.weapon_url_for_archetype(base_url, archetype)
	if weapon_url == "":
		return  # honest: this archetype carries no weapon, not an error

	var GlbLoader := load("res://assets/glb_loader.gd")
	_weapon_loader = GlbLoader.new()
	add_child(_weapon_loader)
	_weapon_loader.loaded.connect(_on_weapon_glb_loaded)
	_weapon_loader.load_failed.connect(_on_weapon_glb_failed)
	_weapon_loader.load_glb(weapon_url)


func _on_weapon_glb_loaded(_url: String, root: Node3D) -> void:
	if root == null:
		return
	var attach := _hand_attach_point()
	if attach == null:
		# Honest: no real attach point exists yet (shouldn't happen post-
		# _build_primitive, but never fabricate a placement if it does) —
		# drop the loaded weapon rather than parent it somewhere wrong.
		root.queue_free()
		return
	_weapon_root = root
	attach.add_child(_weapon_root)
	# Phase S3 / "Toon-shading reach" — same texture-preserving treatment as
	# the body GLB above, so a weapon's real baked texture (see weapon-
	# archetypes.ts's CC0 GLB sourcing) reads with the same coherent look as
	# everything else, not styleless.
	var ArtStyleOutline := load("res://world/art_style.gd")
	ArtStyleOutline.apply_textured_toon_to_tree(_weapon_root, world_id)
	weapon_ready.emit()


func _on_weapon_glb_failed(_url: String, reason: String) -> void:
	# Honest: no weapon is shown; nothing is fabricated in its place.
	weapon_load_failed.emit(reason)


## Real Skeleton3D hand bone (once a body GLB has resolved) if present,
## else the primitive placeholder's forearm socket — mirrors
## `_apply_bone_angle`'s own dual-path lookup so weapon attachment follows
## exactly the same "prefer real skeleton, fall back to primitive socket"
## rule the leg-IK code already established. Never fabricates a third
## fallback: if neither exists (shouldn't happen after `_ready()`), returns
## null and the caller drops the weapon rather than guessing a placement.
func _hand_attach_point() -> Node3D:
	if _skeleton != null:
		var idx := _skeleton.find_bone(HAND_BONE_GLB)
		if idx >= 0:
			var attachment := BoneAttachment3D.new()
			attachment.bone_name = HAND_BONE_GLB
			_skeleton.add_child(attachment)
			return attachment
	return get_bone_node(HAND_SOCKET_PRIMITIVE)


func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D:
		return node
	for child in node.get_children():
		var found := _find_skeleton(child)
		if found != null:
			return found
	return null


# ── Pure static bone layout (no engine calls) ────────────────────────────────

## Placeholder skeleton layout: name, parent name ("" = root-relative), local
## offset relative to the parent, and a capsule radius/height. Field names
## mirror gait-synthesis.ts's `GaitPose` targets (hips/spine/chest/neck +
## left/right upper/lower leg + foot + upper arm/forearm) plus a `head` socket
## for the name-tag/camera anchor that the Three.js client also carries
## (BONE_HIERARCHY, AvatarSystem3D.tsx:199-219). PURE DATA — no Node/Vector3
## engine dependency beyond the Vector3 value type, which is available to
## GDScript scripts outside a running scene tree, so this is testable without
## an engine boot.
static func bone_specs() -> Array:
	return [
		{
			"name": "hips", "parent": "",
			"offset": Vector3(0, 0.9, 0), "radius": 0.14, "height": 0.22,
		},
		{
			"name": "spine", "parent": "hips",
			"offset": Vector3(0, 0.18, 0), "radius": 0.13, "height": 0.20,
		},
		{
			"name": "chest", "parent": "spine",
			"offset": Vector3(0, 0.20, 0), "radius": 0.15, "height": 0.22,
		},
		{
			"name": "neck", "parent": "chest",
			"offset": Vector3(0, 0.14, 0), "radius": 0.06, "height": 0.06,
		},
		{
			"name": "head", "parent": "neck",
			"offset": Vector3(0, 0.10, 0), "radius": 0.12, "height": 0.12,
		},
		{
			"name": "leftUpperLeg", "parent": "hips",
			"offset": Vector3(-0.09, -0.05, 0), "radius": 0.07, "height": 0.40,
		},
		{
			"name": "leftLowerLeg", "parent": "leftUpperLeg",
			"offset": Vector3(0, -0.42, 0), "radius": 0.06, "height": 0.38,
		},
		{
			"name": "leftFoot", "parent": "leftLowerLeg",
			"offset": Vector3(0, -0.40, 0.05), "radius": 0.05, "height": 0.08,
		},
		{
			"name": "rightUpperLeg", "parent": "hips",
			"offset": Vector3(0.09, -0.05, 0), "radius": 0.07, "height": 0.40,
		},
		{
			"name": "rightLowerLeg", "parent": "rightUpperLeg",
			"offset": Vector3(0, -0.42, 0), "radius": 0.06, "height": 0.38,
		},
		{
			"name": "rightFoot", "parent": "rightLowerLeg",
			"offset": Vector3(0, -0.40, 0.05), "radius": 0.05, "height": 0.08,
		},
		{
			"name": "leftUpperArm", "parent": "chest",
			"offset": Vector3(-0.20, 0.08, 0), "radius": 0.05, "height": 0.30,
		},
		{
			"name": "leftForearm", "parent": "leftUpperArm",
			"offset": Vector3(0, -0.32, 0), "radius": 0.045, "height": 0.28,
		},
		{
			"name": "rightUpperArm", "parent": "chest",
			"offset": Vector3(0.20, 0.08, 0), "radius": 0.05, "height": 0.30,
		},
		{
			"name": "rightForearm", "parent": "rightUpperArm",
			"offset": Vector3(0, -0.32, 0), "radius": 0.045, "height": 0.28,
		},
	]


## Sum a bone's offset chain up to the root ("" parent) so a flat Node3D
## socket tree (no true parent/child nesting per bone) can still be placed at
## the correct cumulative local position. Pure; guards against a cyclic
## `parent` reference with a hop-count cap.
static func bone_world_offset(specs: Array, bone_name: String) -> Vector3:
	var by_name := {}
	for spec in specs:
		by_name[spec["name"]] = spec

	var offset := Vector3.ZERO
	var current := bone_name
	var guard := 0
	while current != "" and by_name.has(current) and guard < 32:
		var spec: Dictionary = by_name[current]
		offset += spec["offset"]
		current = String(spec["parent"])
		guard += 1
	return offset
