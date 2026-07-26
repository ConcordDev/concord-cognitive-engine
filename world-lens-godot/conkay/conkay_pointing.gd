class_name ConKayPointing
extends RefCounted
## ConKayPointing — R5/E22 "point at buildings/props" geometry.
##
## Scope, deliberately narrow: given ConKay's current position and a target
## position (a landing pad from content/world/*/city-layout.json, an
## authored building from `scene:data`'s `concord-scene/v1` payload —
## world/scene_bootstrap.gd already parses these — or a DTU prop from
## world/dtu_prop_renderer.gd), compute the real direction/orientation to
## visually indicate "ConKay is pointing at that thing." This is
## ATTENTION-DIRECTION only: rotating ConKay's presence node (or an attached
## pointer/arrow mesh) to face a target.
##
## ── Explicitly OUT OF SCOPE (the master spec's "lead/follow" clause) ───────
## This module does NOT move ConKay, path around obstacles, avoid collisions,
## or walk it toward anything. "Lead/follow" in the master-spec's CK-World
## framing implies real navigation (pathfinding around buildings, a
## walk/run gait, staying a fixed distance ahead of/behind the player) — a
## substantially larger system (a NavigationServer3D mesh bake off the real
## scene geometry, a steering behavior, gait blending) that would need its
## own unit, its own tests, and — per this container's honest constraint —
## its own real-engine visual QA to judge whether it reads as "leading" at
## all. Building a half-version of that here (e.g. a naive lerp-toward-target
## with no obstacle awareness) would look like navigation while not being
## navigation, which is exactly the kind of "looks real, isn't" gap this
## codebase's honesty invariant exists to prevent. So: pointing/attention-
## direction is built for real below; walk-to/follow is named here as a
## clearly-scoped follow-on, not attempted.
##
## All pure geometry, no scene-tree dependency — testable without a live
## Godot instance (tests/test_conkay_pointing.gd).

const EPSILON := 0.0001


## Normalized direction from `from` to `target`. The degenerate case
## (from == target, or within EPSILON of it) returns Vector3.FORWARD
## (Godot's default -Z "facing" direction) rather than a NaN/zero vector —
## an honest, harmless default instead of propagating garbage into a caller
## that then tries to build a basis or rotation out of it.
static func direction_to(from: Vector3, target: Vector3) -> Vector3:
	var delta := target - from
	if delta.length() < ConKayPointing.EPSILON:
		return Vector3.FORWARD
	return delta.normalized()


## Straight-line distance from `from` to `target`. Pure convenience so a
## caller deciding "is this prop close enough to bother pointing at" doesn't
## hand-roll `from.distance_to(target)` inline.
static func distance_to(from: Vector3, target: Vector3) -> float:
	return from.distance_to(target)


## Yaw (rotation around the world Y axis, radians) + pitch (elevation angle,
## radians, positive = looking upward) to face `target` from `from`. This is
## the cheap, minimal representation a simple orb/marker needs when it only
## has to "turn to face" a target — e.g. driving `rotation.y` directly, or
## tilting a small pointer/arrow mesh — without requiring a full 3-axis
## orthonormal basis. Yaw follows Godot's own convention that an unrotated
## Node3D faces -Z (`atan2(-d.x, -d.z)` is 0 when `d == Vector3.FORWARD`).
static func yaw_pitch_to(from: Vector3, target: Vector3) -> Dictionary:
	var d := ConKayPointing.direction_to(from, target)
	var yaw := atan2(-d.x, -d.z)
	var horiz := Vector2(d.x, d.z).length()
	var pitch := atan2(d.y, horiz)
	return {"yaw": yaw, "pitch": pitch}


## Full orthonormal look-at basis toward `target` from `from`. Guards
## Godot's own `Basis.looking_at()` degenerate case — a view direction
## (near-)parallel to `up` has no well-defined "right" axis and Godot pushes
## an error/undefined result in that situation — by falling back to a
## secondary reference axis, the SAME defensive singularity-guard pattern
## `engineering/fea_scene_builder.gd`'s `beam_transform` already uses for its
## own axis-alignment edge case (see that file). Never throws; always
## returns a valid orthonormal Basis.
static func look_at_basis(from: Vector3, target: Vector3, up: Vector3 = Vector3.UP) -> Basis:
	var d := ConKayPointing.direction_to(from, target)
	var use_up := up
	if absf(d.dot(up.normalized())) > 0.999:
		use_up = Vector3.RIGHT
	return Basis.looking_at(d, use_up)
