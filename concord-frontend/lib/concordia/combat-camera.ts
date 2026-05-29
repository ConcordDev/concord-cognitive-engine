// concord-frontend/lib/concordia/combat-camera.ts
//
// POLISH_AUDIT T2.8 — camera FOV punch on a heavy combat outcome, scoped to the
// LOCAL player. Pure decision function so the gating is unit-testable.
//
// Game-feel literature (Clavier "Super Game Feel", MoreMountains Feel docs, CG
// Cookie camera guides) is unanimous: juice like camera punch/shake must be
// scoped to the player, kept brief, severity-scaled, and suppressed under
// reduced-motion — otherwise it destroys readability and induces nausea. So we
// punch ONLY when the local player is the attacker or target, never on an
// NPC-vs-NPC strike the player merely witnesses.
//
// Output values stay within the concordia:camera-punch consumer's clamps
// (ConcordiaScene: shake≤12, fov i.e. zoom-1 ≤0.25, duration 120–2000ms).

export interface ImpactForCamera {
  severity?: 'none' | 'flinch' | 'rocked' | 'knockdown';
  isKill?: boolean;
  attackerId?: string;
  targetId?: string;
}

export interface CameraPunch {
  duration_ms: number;
  zoom: number;
  shake: number;
  targetId?: string;
  attackerId?: string;
  local_relevance: true;
}

/**
 * Decide the camera punch for a combat:impact event. Returns null when it
 * should NOT punch: no local relevance, reduced-motion, or a light/none
 * outcome (a flinch carries only hitstop, no camera move).
 */
export function computeImpactCameraPunch(
  ev: ImpactForCamera,
  ctx: { userId: string | null; reducedMotion: boolean },
): CameraPunch | null {
  if (!ev) return null;
  if (ctx.reducedMotion) return null;
  const localRelevant = !!ctx.userId && (ev.attackerId === ctx.userId || ev.targetId === ctx.userId);
  if (!localRelevant) return null;

  let base: { zoom: number; shake: number; duration_ms: number } | null = null;
  if (ev.isKill)                         base = { zoom: 1.08, shake: 8, duration_ms: 320 };
  else if (ev.severity === 'knockdown')  base = { zoom: 1.06, shake: 7, duration_ms: 260 };
  else if (ev.severity === 'rocked')     base = { zoom: 1.04, shake: 5, duration_ms: 200 };
  if (!base) return null; // flinch / none → hitstop only, no camera move

  return { ...base, targetId: ev.targetId, attackerId: ev.attackerId, local_relevance: true };
}
