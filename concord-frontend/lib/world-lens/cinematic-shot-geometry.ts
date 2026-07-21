/**
 * cinematic-shot-geometry.ts — World Lens Phase 4 ("Camera").
 *
 * lib/world-lens/cinematic-director.ts sequences real named camera shot
 * templates (over_shoulder, crane_pull, dolly_in, whip_pan, dutch_tilt,
 * match_cut, close_on, pull_back, ...) and dispatches
 * `concordia:cinematic-shot` with the shot's template id + subject — but
 * nothing ever moved the actual THREE.js camera through them (confirmed
 * live: zero listeners for that event before this fix). The director
 * choreographs time-scale + audio + a letterbox UI correctly; the camera
 * itself just sat wherever it already was.
 *
 * This module is the pure geometry half of the fix: given a shot template
 * id and the subject's world pose, compute the camera position + look-at
 * point (+ an optional dutch-tilt roll) that shot implies. ConcordiaScene.tsx
 * listens for the event and animates the real camera from its current
 * position to this target over the shot's duration — see the
 * `concordia:cinematic-shot` handler there.
 *
 * Scope: only `subject: 'player'` (or unset, which every currently-
 * registered AUTO_TEMPLATES shot in cinematic-director.ts uses) is
 * resolved — there is no NPC-position lookup accessible from
 * ConcordiaScene.tsx today, and fabricating one would mean guessing
 * positions instead of reading them. `target_npc`-addressed shots are a
 * natural follow-up once such a lookup exists, not something to fake here.
 */

export interface SubjectPose {
  x: number;
  y: number;
  z: number;
  /** Facing yaw in radians (0 = -Z, per this codebase's existing convention). */
  yaw: number;
}

export interface ShotFraming {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  /** Camera roll in radians, applied after lookAt (0 = level). */
  tiltRad: number;
}

const EYE_HEIGHT = 1.6;

function forward(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
}

function orbit(subject: SubjectPose, angleRad: number, dist: number, height: number): { x: number; y: number; z: number } {
  return {
    x: subject.x + Math.sin(angleRad) * dist,
    y: subject.y + height,
    z: subject.z + Math.cos(angleRad) * dist,
  };
}

/**
 * Compute the camera framing a named shot template implies for a subject.
 * `currentCameraPos` is only consulted by dolly_in/dolly_out, which push
 * toward/away from the subject along the camera's CURRENT approach line
 * rather than a fixed angle — every other template frames from a stable,
 * predictable angle so consecutive shots in a sequence read as deliberate
 * coverage, not a random camera flying around.
 */
export function computeShotFraming(
  template: string,
  subject: SubjectPose,
  currentCameraPos: { x: number; y: number; z: number },
): ShotFraming {
  const subjHead = { x: subject.x, y: subject.y + EYE_HEIGHT, z: subject.z };
  const fwd = forward(subject.yaw);

  switch (template) {
    case 'close_on':
      return {
        position: orbit(subject, subject.yaw, 2.2, EYE_HEIGHT),
        lookAt: subjHead,
        tiltRad: 0,
      };

    case 'pull_back':
      return {
        position: orbit(subject, subject.yaw, 13, 5.5),
        lookAt: subjHead,
        tiltRad: 0,
      };

    case 'dolly_in': {
      const dx = currentCameraPos.x - subject.x;
      const dz = currentCameraPos.z - subject.z;
      const len = Math.hypot(dx, dz) || 1;
      const dist = 3.5;
      return {
        position: { x: subject.x + (dx / len) * dist, y: subject.y + EYE_HEIGHT * 0.9, z: subject.z + (dz / len) * dist },
        lookAt: subjHead,
        tiltRad: 0,
      };
    }

    case 'dolly_out': {
      const dx = currentCameraPos.x - subject.x;
      const dz = currentCameraPos.z - subject.z;
      const len = Math.hypot(dx, dz) || 1;
      const dist = 10;
      return {
        position: { x: subject.x + (dx / len) * dist, y: subject.y + 4, z: subject.z + (dz / len) * dist },
        lookAt: subjHead,
        tiltRad: 0,
      };
    }

    case 'crane_pull':
      // Rises up and pulls back — a high, wide vantage.
      return {
        position: orbit(subject, subject.yaw + 0.4, 9, 10),
        lookAt: subjHead,
        tiltRad: 0,
      };

    case 'crane_drop':
      // Descends toward a close, moderate-height framing — reads as a
      // drop when the previous shot left the camera high (crane_pull,
      // pull_back), which is how it's used in every registered template.
      return {
        position: orbit(subject, subject.yaw - 0.4, 3.5, 2.2),
        lookAt: subjHead,
        tiltRad: 0,
      };

    case 'whip_pan':
      // Fast reorientation to a hard side angle at roughly the same
      // distance — the director's registered whip_pan shots are always
      // short-duration (400-600ms), so the interpolation itself reads as
      // the whip.
      return {
        position: orbit(subject, subject.yaw + Math.PI * 0.75, 4, EYE_HEIGHT + 0.5),
        lookAt: subjHead,
        tiltRad: 0,
      };

    case 'dutch_tilt':
      // Camera holds roughly in place but rolls — the canted, off-kilter
      // framing. Position barely moves so the roll itself reads as the
      // shot, not a reframe.
      return {
        position: orbit(subject, subject.yaw + 0.15, 5, EYE_HEIGHT + 1.2),
        lookAt: subjHead,
        tiltRad: 0.18,
      };

    case 'match_cut':
      // A hard cut to a new angle — ConcordiaScene.tsx gives this template
      // a near-zero interpolation time regardless of shot duration_ms, so
      // the target framing itself (opposite-side medium shot) is what
      // sells the cut.
      return {
        position: orbit(subject, subject.yaw + Math.PI, 5, EYE_HEIGHT + 0.4),
        lookAt: subjHead,
        tiltRad: 0,
      };

    case 'over_shoulder':
      // Behind and to one side of the subject, looking past their
      // shoulder in their facing direction.
      return {
        position: {
          x: subject.x - fwd.x * 1.4 + Math.sin(subject.yaw + Math.PI / 2) * 0.9,
          y: subject.y + EYE_HEIGHT + 0.15,
          z: subject.z - fwd.z * 1.4 + Math.cos(subject.yaw + Math.PI / 2) * 0.9,
        },
        lookAt: {
          x: subject.x + fwd.x * 6,
          y: subject.y + EYE_HEIGHT,
          z: subject.z + fwd.z * 6,
        },
        tiltRad: 0,
      };

    case 'reverse_over_shoulder':
      // The shot/reverse-shot counterpart — from in front of the subject,
      // looking back at them (mirrored side).
      return {
        position: {
          x: subject.x + fwd.x * 3.5 + Math.sin(subject.yaw - Math.PI / 2) * 0.9,
          y: subject.y + EYE_HEIGHT + 0.15,
          z: subject.z + fwd.z * 3.5 + Math.cos(subject.yaw - Math.PI / 2) * 0.9,
        },
        lookAt: subjHead,
        tiltRad: 0,
      };

    default:
      // Unknown template — hold a safe, generic medium shot rather than
      // throw or leave the camera in a stale position from a prior shot.
      return {
        position: orbit(subject, subject.yaw, 5, EYE_HEIGHT + 1),
        lookAt: subjHead,
        tiltRad: 0,
      };
  }
}

export const EASING_FNS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  ease_in_quad: (t) => t * t,
  ease_out_quad: (t) => t * (2 - t),
  ease_in_out_quad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  ease_in_cubic: (t) => t * t * t,
  ease_out_cubic: (t) => 1 - Math.pow(1 - t, 3),
  ease_in_out_cubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

export function applyEasing(name: string | undefined, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const fn = (name && EASING_FNS[name]) || EASING_FNS.linear;
  return fn(clamped);
}
