/**
 * Allometric scaling — Sprint D / T3
 *
 * Single ScaleParams type drives all size-dependent animation knobs
 * via biology-correct Froude scaling laws:
 *
 *   strideFreq         = base / sqrt(scale)        (1/√L)
 *   walkSpeed          = base * sqrt(scale)        (Froude — √L)
 *   jointStiffness     = base * scale^2            (mass × √L²)
 *   reactionTime       = base * sqrt(scale)        (perceptual time dilation)
 *   boneThickness      = base * scale^1.1          (positive allometry)
 *   groundContactDur   = base * sqrt(scale)        (heavy feet plant longer)
 *   timeDilation       = sqrt(scale)               (visual perception of slowness)
 *
 * Reference: Alexander 1989 "Optimization and gaits in the locomotion of
 * vertebrates"; Hill 1950 "Dimensions of animals and their muscular
 * dynamics"; March 2026 Stanford bipedal-robot scaling paper confirmed
 * walking velocity ~ L^(1/2) and torque ~ mL across designs.
 *
 * Wire points:
 *   - gait-synthesis.ts: stride length & frequency from baseStride * sqrt
 *   - joint-motors.ts: stiffness multiplier per creature
 *   - fabrik-ik.ts: iteration count (large creatures need more iterations)
 *   - global time-scale: visual perception (giants look slow even though
 *     their absolute movement is fast)
 */

export interface ScaleParams {
  /** Linear scale factor relative to baseline humanoid (1.0). */
  scale: number;
  /** Stride frequency multiplier (1/sqrt(scale)). */
  strideFreq: number;
  /** Walk-speed multiplier (sqrt(scale)). */
  walkSpeed: number;
  /** Joint-stiffness multiplier (scale^2). */
  jointStiffness: number;
  /** Reaction-time multiplier (sqrt(scale)). */
  reactionTime: number;
  /** Bone-thickness multiplier (scale^1.1). */
  boneThickness: number;
  /** Ground-contact-duration multiplier (sqrt(scale)). */
  groundContactDuration: number;
  /** Visual time-dilation multiplier (sqrt(scale)). */
  timeDilation: number;
}

export interface ComputeScaleOpts {
  /** Optional caps to keep the math stable at extremes. */
  minScale?: number;
  maxScale?: number;
}

/**
 * Compute an allometric ScaleParams from a linear scale factor.
 * Caller passes scale (e.g. 0.5 for child, 1.0 for adult, 1.5 for "legend"
 * body type from Sprint B, 5.0 for giant boss, 0.2 for procgen rabbit).
 */
export function computeScaleParams(scale: number, opts: ComputeScaleOpts = {}): ScaleParams {
  const { minScale = 0.05, maxScale = 50 } = opts;
  const s = Math.max(minScale, Math.min(maxScale, scale));
  const sqrtS = Math.sqrt(s);
  return {
    scale: s,
    strideFreq:            1 / sqrtS,
    walkSpeed:             sqrtS,
    jointStiffness:        s * s,
    reactionTime:          sqrtS,
    boneThickness:         Math.pow(s, 1.1),
    groundContactDuration: sqrtS,
    timeDilation:          sqrtS,
  };
}

/**
 * Body-type lookup for humanoids. Extends the existing slim/avg/stocky/
 * tall/legend with allometric scale factors so the Sprint B legend body
 * type's 1.5× linear becomes the correct gait math.
 */
export const HUMANOID_BODY_SCALE: Record<string, number> = {
  slim:    0.95,
  average: 1.00,
  stocky:  0.98,    // wider but not taller
  tall:    1.10,
  legend:  1.50,    // Sprint B legend is 1.5× scale
};

/**
 * Mount size class scale factors (matches MountAvatar3D.tsx BODY_DIMS).
 */
export const MOUNT_SIZE_SCALE: Record<string, number> = {
  small:  0.6,
  medium: 1.0,
  large:  1.5,
  huge:   2.5,
};

/**
 * Aquatic creature scale (very rough — eel ~0.4, cephalopod 0.6–1.2,
 * shark 1.5–3.0, depending on individual seed).
 */
export const AQUATIC_SCALE_DEFAULTS: Record<string, number> = {
  fish:       0.3,
  eel:        0.4,
  cephalopod: 0.8,
  shark:      1.8,
};

/**
 * Convenience: pick a sensible scale for an entity given an appearance
 * config. Pure helper; falls back to 1.0 when nothing matches.
 */
export interface ScaleAppearance {
  bodyType?: string;
  mountSize?: string;
  topology?: string;
  scaleOverride?: number;
}

export function scaleForAppearance(a: ScaleAppearance): number {
  if (a.scaleOverride !== undefined) return a.scaleOverride;
  if (a.bodyType && HUMANOID_BODY_SCALE[a.bodyType] !== undefined) return HUMANOID_BODY_SCALE[a.bodyType];
  if (a.mountSize && MOUNT_SIZE_SCALE[a.mountSize] !== undefined) return MOUNT_SIZE_SCALE[a.mountSize];
  if (a.topology && AQUATIC_SCALE_DEFAULTS[a.topology] !== undefined) return AQUATIC_SCALE_DEFAULTS[a.topology];
  return 1.0;
}

export const SCALE_CONSTANTS = Object.freeze({
  HUMANOID_BODY_SCALE,
  MOUNT_SIZE_SCALE,
  AQUATIC_SCALE_DEFAULTS,
});
