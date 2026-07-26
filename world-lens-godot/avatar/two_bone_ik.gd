class_name TwoBoneIK
extends RefCounted
## TwoBoneIK — PURE analytic (law-of-cosines) two-bone IK solver for one leg.
##
## No engine calls anywhere in this file — every func is `static` and works
## on plain `Vector3`/`float`/`Dictionary` values, callable and testable via
## `preload(...).solve_two_bone(...)` with no live node required (see
## tests/test_gait_solver.gd).
##
## ── Why analytic 2-bone instead of the TS client's FABRIK ───────────────────
##
## concord-frontend/lib/concordia/fabrik-ik.ts solves arbitrary-length bone
## chains (legs, arms, spine) with an ITERATIVE forward-and-backward-reaching
## solver plus a published-ROM clamp applied after every iteration
## (`JOINT_CONSTRAINTS`, fabrik-ik.ts:27-38) — that generality (and the
## clamp-every-iteration cost) exists because FABRIK doesn't know anything
## about the chain's shape; it needs the constraint table to keep an
## arbitrary N-bone chain anatomically plausible.
##
## A leg's hip-knee-ankle chain is exactly TWO bones with a SINGLE bend
## (a knee doesn't twist), which is the textbook case where a closed-form
## law-of-cosines solve is both simpler and exact in one step: no iteration,
## no convergence tolerance, and no risk of FABRIK's forward/backward-pass
## jitter for what is structurally the simplest possible chain. This is not
## a downgrade from the TS client's approach — fabrik-ik.ts's own leg-chain
## builders (`buildLeftLegChain`/`buildRightLegChain`, fabrik-ik.ts:197-217)
## feed FABRIK exactly this 2-segment shape; an analytic solve for that
## specific shape is the correct simpler equivalent, not a reduced one.
## (fabrik-ik.ts's segment-length ratios — upper 0.5x / lower 0.48x of total
## leg length, fabrik-ik.ts:202-203 — inform this file's own leg-length
## reasoning in avatar_rig.gd, which derives real segment lengths from
## bone_specs() rather than hardcoding a ratio.)
##
## Signature note: the migration brief sketched
## `solve_two_bone(root, mid_target_len, effector_target)`. This
## implementation takes the two segment lengths explicitly (`upper_len`,
## `lower_len`) rather than one bundled length, because the law-of-cosines
## solve needs both independently — they are rarely equal (see the
## fabrik-ik.ts ratio cited above) and collapsing them into a single value
## would discard information the math requires.

const EPS: float = 0.0005


## Solve hip pitch + knee flex (radians, in the sagittal Y-Z plane relative
## to `root` — Y up, Z forward, X ignored: a leg's hip-knee-ankle bend lives
## in the forward/vertical plane, the same simplification
## gait_solver.gd#foot_targets() makes by always returning x=0) that place
## the effector at `effector_target`, given `root` and rigid segment lengths
## `upper_len` (hip->knee) and `lower_len` (knee->foot).
##
## Angle convention: 0 radians = straight down (leg fully extended, hanging
## from the hip); positive rotates the knee forward (+Z). `knee_angle` is a
## flex-from-straight magnitude (0 = fully extended), always >= 0 — a knee
## only bends one way.
##
## Returns:
##   hip_angle         (float)   — see convention above.
##   knee_angle         (float)   — flex from straight, radians, >= 0.
##   reachable          (bool)    — false when the raw target distance was
##                                  outside [|upper_len-lower_len|,
##                                  upper_len+lower_len]; the chain was
##                                  clamped to its nearest reachable distance
##                                  along the SAME direction (full extension
##                                  toward a too-far target, full fold toward
##                                  a too-close one) — mirrors the "stretch
##                                  straight toward it" behaviour
##                                  fabrik-ik.ts:81-89 documents for its own
##                                  unreachable-target case.
##   clamped_distance   (float)   — the root-to-target distance actually
##                                  solved against, after clamping.
static func solve_two_bone(
		root: Vector3, upper_len: float, lower_len: float, effector_target: Vector3) -> Dictionary:
	var to_target: Vector3 = effector_target - root
	# planar.x = forward (Z) component; planar.y = "downward-positive"
	# component (-Y), so angle 0 along this pair means straight down.
	var planar := Vector2(to_target.z, -to_target.y)
	var raw_dist: float = planar.length()

	var max_reach: float = upper_len + lower_len - EPS
	var min_reach: float = absf(upper_len - lower_len) + EPS
	var dist: float = clampf(raw_dist, min_reach, max_reach)
	var reachable: bool = raw_dist >= min_reach and raw_dist <= max_reach

	# Law of cosines — interior angle at the knee, opposite the root-target
	# side (length `dist`). A straight (fully extended) leg has interior
	# angle PI, i.e. knee_angle (flex-from-straight) of 0.
	var cos_knee_interior: float = (
		(upper_len * upper_len + lower_len * lower_len - dist * dist)
		/ (2.0 * upper_len * lower_len)
	)
	cos_knee_interior = clampf(cos_knee_interior, -1.0, 1.0)
	var knee_interior: float = acos(cos_knee_interior)
	var knee_angle: float = PI - knee_interior

	# Law of cosines — angle at the hip between the root->target line and
	# the root->knee (upper-leg) direction.
	var cos_hip_offset: float = (
		(upper_len * upper_len + dist * dist - lower_len * lower_len)
		/ (2.0 * upper_len * dist)
	)
	cos_hip_offset = clampf(cos_hip_offset, -1.0, 1.0)
	var hip_offset: float = acos(cos_hip_offset)

	var base_angle: float = atan2(planar.x, planar.y)
	var hip_angle: float = base_angle + hip_offset

	return {
		"hip_angle": hip_angle,
		"knee_angle": knee_angle,
		"reachable": reachable,
		"clamped_distance": dist,
	}


## Forward-kinematics companion to solve_two_bone() — given a `hip_angle`/
## `knee_angle` pair (as it returns) plus the same segment lengths, computes
## where the knee and foot actually land. Paired with solve_two_bone() this
## is the round-trip check used by tests/test_gait_solver.gd (solve, then
## reconstruct, then compare to the original target within tolerance) and
## is also useful to a future caller that wants the knee joint's own world
## position for skeleton application.
static func effector_position(
		root: Vector3, upper_len: float, lower_len: float,
		hip_angle: float, knee_angle: float) -> Dictionary:
	var knee_pos: Vector3 = root + Vector3(
		0.0, -cos(hip_angle) * upper_len, sin(hip_angle) * upper_len)
	var lower_angle: float = hip_angle - knee_angle
	var foot_pos: Vector3 = knee_pos + Vector3(
		0.0, -cos(lower_angle) * lower_len, sin(lower_angle) * lower_len)
	return {"knee": knee_pos, "foot": foot_pos}
