class_name GaitSolver
extends RefCounted
## GaitSolver — PURE-LOGIC procedural gait cycle for foot-target IK.
##
## No engine calls anywhere in this file — every func is `static` and works
## on plain `float`/`Vector3`/`Dictionary` values, callable and testable via
## `preload(...).gait_phase(...)` etc. with no live node required (see
## tests/test_gait_solver.gd).
##
## ── Why this port takes an IK-target approach, not FK rotation ─────────────
##
## concord-frontend/lib/concordia/gait-synthesis.ts drives the Three.js
## client's legs by setting hip/knee/foot bone ROTATIONS directly as
## trigonometric functions of phase (`synthesizeGait`, gait-synthesis.ts:101-
## 236) — there is no foot-target position anywhere in that file; ground
## clearance during swing is an EMERGENT side-effect of composing thigh +
## knee + foot Euler rotations down the bone chain, never an authored target.
## This migration instead solves for a literal foot-effector target per phase
## and hands it to two_bone_ik.gd for an analytic hip/knee solve — see that
## file's header for why an IK-target approach is the right Godot-side
## choice. Because of that, this file mirrors the TS source's LOAD-BEARING
## NUMBERS (stride length, the phase-advance formula, the 180-degree leg
## phase offset) exactly, but authors its own foot-height/swing-vs-stance
## curve, since the TS source has no equivalent value to mirror there.
##
## ── Constants mirrored from gait-synthesis.ts (cite lines) ──────────────────
##
## PHASE_STRIDE_LEN_M mirrors BODY_STRIDE_LENGTHS.average = 0.75
## (gait-synthesis.ts:25-30) as used by advanceGaitPhase's distance-driven
## phase advance (gait-synthesis.ts:82-91: `advance = (speed*delta)/strideLen;
## phase = (phase+advance) % 1.0` — "no skating regardless of speed change",
## gait-synthesis.ts:77-79). That phase-advance strideLen is FIXED per body
## type, not speed-dependent; avatar_rig.gd's bone_specs() build a single
## generic rig with no bodyType variance, so this file uses the "average"
## constant unconditionally, matching the TS default fallback
## (`BODY_STRIDE_LENGTHS[bodyType] ?? 0.75`, gait-synthesis.ts:88).
##
## SPEED_NORM_MAX mirrors gait-synthesis.ts:104's
## `speedNorm = Math.min(Math.max(speed/12, 0), 1)` — the 0..1 normalisation
## ceiling used everywhere speed is scaled in that file. Also matches
## animation_state_machine.gd's own RUN_SPEED=12.0 citation
## (AvatarSystem3D.tsx:190-191).
##
## STRIDE_SWING_MIN / STRIDE_SWING_RANGE mirror the ratio in
## gait-synthesis.ts:107 — `strideLen = style.strideLengthScale *
## (0.4 + speedNorm * 0.6)`. IMPORTANT NAMING COLLISION IN THE SOURCE: that
## line's "strideLen" is a DIFFERENT quantity from BODY_STRIDE_LENGTHS above
## — it's a dimensionless amplitude scale applied to an ANGLE (thighSwing,
## gait-synthesis.ts:108), not a metre distance; the TS source reuses the
## same variable name for two different concepts. This file disambiguates:
## PHASE_STRIDE_LEN_M drives gait_phase()'s cadence, while the
## (0.4 + speedNorm*0.6) RATIO is reapplied — in stride_length_for_speed() —
## to PHASE_STRIDE_LEN_M to produce a literal metre stride used by
## foot_targets()'s horizontal swing. `style.strideLengthScale` is omitted
## (treated as 1.0) since this rig has no per-character MovementStyleConfig
## yet.
##
## Leg phase offset: gait-synthesis.ts:111-112 —
## `legPhaseL = phase * Math.PI * 2; legPhaseR = legPhaseL + Math.PI` — legs
## exactly 180 degrees out of phase. Mirrored in foot_targets() as
## `right_phase = left_phase + PI`.
##
## Implied cadence (not a named TS variable, but the arithmetic consequence
## of the phase-advance formula above, noted here for completeness): one full
## gait CYCLE (both feet) covers PHASE_STRIDE_LEN_M metres, i.e. cadence in
## cycles/sec = speed / PHASE_STRIDE_LEN_M, or footfalls/sec (2 per cycle) =
## 2 * speed / PHASE_STRIDE_LEN_M.
##
## LIFT_HEIGHT_M has NO Three.js equivalent — see the header note above. It
## is this port's own reasoned value (typical human swing-phase toe
## clearance is roughly 3-15cm; Winter 2009, already cited by
## gait-synthesis.ts's own file header for the FK approach this file departs
## from).

const TWO_PI: float = PI * 2.0

## Metres. Fixed distance travelled per full gait cycle, independent of
## speed. See header — gait-synthesis.ts:25-30 / :82-91.
const PHASE_STRIDE_LEN_M: float = 0.75

## m/s. gait-synthesis.ts:104's speedNorm normalisation ceiling.
const SPEED_NORM_MAX: float = 12.0

## Dimensionless. gait-synthesis.ts:107's `(0.4 + speedNorm * 0.6)` ratio,
## split into its two terms.
const STRIDE_SWING_MIN: float = 0.4
const STRIDE_SWING_RANGE: float = 0.6

## Metres. Peak vertical foot clearance during the swing half of the cycle.
## Own value — see header note; no TS source line to cite.
const LIFT_HEIGHT_M: float = 0.12


## Stride length (metres) for the given speed. Reapplies the SHAPE of
## gait-synthesis.ts:107's ratio (0.4 + speedNorm*0.6) — originally an
## angular-swing-amplitude scale there — to the fixed PHASE_STRIDE_LEN_M
## distance instead, since this port needs a literal metre stride for
## foot_targets()'s IK-effector horizontal swing. See the class header's
## "naming collision" note for why this is NOT simply reading
## BODY_STRIDE_LENGTHS again.
static func stride_length_for_speed(speed: float) -> float:
	var speed_norm: float = clampf(speed / SPEED_NORM_MAX, 0.0, 1.0)
	var swing_scale: float = STRIDE_SWING_MIN + speed_norm * STRIDE_SWING_RANGE
	return PHASE_STRIDE_LEN_M * swing_scale


## Gait cycle position in [0, 1) for a given cumulative horizontal distance
## travelled (metres) since gait start. Mirrors advanceGaitPhase's
## distance-driven phase advance exactly (gait-synthesis.ts:82-91): the
## cycle completes once every PHASE_STRIDE_LEN_M metres of travel,
## regardless of instantaneous speed. `speed` is accepted for call-site
## parity with the caller's per-frame kinematics sample (and so a future
## body-type/style-scaled stride can be substituted here without changing
## call sites) but — exactly as in advanceGaitPhase, whose `strideLen`
## divisor does not vary with the `speed` parameter it also receives — it is
## NOT part of the phase formula itself.
static func gait_phase(distance_travelled: float, _speed: float) -> float:
	var raw: float = distance_travelled / PHASE_STRIDE_LEN_M
	return fposmod(raw, 1.0)


## Per-foot effector-target OFFSETS (metres, in the rig-local forward(+Z)/
## up(+Y) frame, relative to that foot's own neutral standing position —
## x is always 0, since lateral foot placement is the rig's per-leg hip-
## socket anchor, not this solver's concern) for one gait cycle.
##
## `phase` is the LEFT leg's phase in [0, 1); the right leg is always PI
## radians out of phase, mirroring gait-synthesis.ts:112 exactly
## (`legPhaseR = legPhaseL + Math.PI`).
##
## Horizontal (z) swings forward/back as sin(2*pi*phase) * stride_len/2 —
## the same sinusoidal SHAPE gait-synthesis.ts uses for thigh swing
## (`Math.sin(legPhaseL) * thighSwing`, gait-synthesis.ts:169/190), applied
## here to a literal foot-position target instead of a thigh rotation.
##
## Vertical (y) lift is a NEW curve with no TS equivalent (see LIFT_HEIGHT_M's
## doc): a half-sine bump, active only while sin(leg_phase) > 0 (the
## "forward-swing" half of the cycle), so the foot lifts off the ground
## during swing and is fully planted (y=0) through the other half (stance —
## bearing weight, moving backward relative to the hip as the body advances
## over it). Lift height itself scales with the same (0.4+speedNorm*0.6)
## ratio as the horizontal stride (own choice, for internal consistency: a
## faster gait lifts the foot higher, same as it takes a longer stride).
static func foot_targets(phase: float, speed: float, stride_len: float) -> Dictionary:
	var speed_norm: float = clampf(speed / SPEED_NORM_MAX, 0.0, 1.0)
	var lift_scale: float = STRIDE_SWING_MIN + speed_norm * STRIDE_SWING_RANGE
	var lift_height: float = LIFT_HEIGHT_M * lift_scale

	var left_phase: float = fposmod(phase, 1.0) * TWO_PI
	var right_phase: float = left_phase + PI

	return {
		"left": _one_foot_target(left_phase, stride_len, lift_height),
		"right": _one_foot_target(right_phase, stride_len, lift_height),
	}


static func _one_foot_target(leg_phase: float, stride_len: float, lift_height: float) -> Vector3:
	var half_stride: float = stride_len * 0.5
	var swing: float = sin(leg_phase)
	var z: float = swing * half_stride
	var lift: float = maxf(0.0, swing) * lift_height
	return Vector3(0.0, lift, z)
