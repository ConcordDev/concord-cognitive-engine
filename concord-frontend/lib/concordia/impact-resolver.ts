// concord-frontend/lib/concordia/impact-resolver.ts
//
// T1.4b / T3.1b — the live call site for computeImpactMomentum.
//
// computeImpactMomentum (combat-motor-driver.ts) was defined but never called —
// the bone-mass × angular-velocity impact model the pitch describes was dead on
// the client. This module makes it live: it derives real kinematics for a
// strike (impactKinematics, published Dempster/Winter ratios), computes the
// momentum scalar, and maps it to the four feel channels the existing window
// events consume — hit-pause, knockback, reflex wince, damage-billboard scale.
//
// Division of labour with the server (T1.4b impact-feel.js):
//   - NPC hits (HTTP path) ship a server-authoritative `feel` block on
//     `combat:impact` — that's the source of truth there.
//   - PvP hits (socket `combat:hit`, BUG-B-enriched with element/skillId/
//     weapon/tier) ship NO feel block, so the client computes momentum locally
//     here using the SAME physics. One model, two transports.
//
// Pure + deterministic (no RNG). serverDamage stays the *displayed* number;
// momentum drives *feel* only — the anti-cheat damage cap is untouched.

import { impactKinematics, type CombatAction, type BodyType } from './combat-biomechanics';
import { computeImpactMomentum } from './combat-motor-driver';

export type ImpactSeverity = 'hit' | 'heavy' | 'crit' | 'kill';

export interface ImpactFeel {
  momentum: number;        // raw kg·m/s scalar (real physics)
  hitPauseMs: number;      // mixer-freeze window for the target
  knockback: number;       // kinematic impulse magnitude
  reflexIntensity: number; // 0..1 wince/stagger amplitude
  billboardScale: number;  // damage-number scale multiplier
  severity: ImpactSeverity;
}

// A heavy tier-5 kick lands near this momentum; used to normalise the real
// scalar (~8–40 kg·m/s across tiers/kinds) into the 0..1 feel band.
const MOMENTUM_NORM = 40;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Map a raw momentum scalar to the feel channels. Exported for testing. */
export function momentumToFeel(momentum: number, isKill = false): ImpactFeel {
  const mNorm = clamp(momentum / MOMENTUM_NORM, 0, 1.2);
  const severity: ImpactSeverity = isKill
    ? 'kill'
    : mNorm >= 0.85 ? 'crit'
    : mNorm >= 0.5 ? 'heavy'
    : 'hit';
  return {
    momentum: Math.round(momentum * 10) / 10,
    hitPauseMs: Math.round(clamp(mNorm * 180, 0, 200)),
    knockback: Math.round(clamp(mNorm * 6.5, 0, 7) * 10) / 10,
    reflexIntensity: Math.round(clamp(mNorm, 0, 1) * 100) / 100,
    billboardScale: Math.round((1 + clamp(mNorm, 0, 1) * 0.6) * 100) / 100,
    severity,
  };
}

export interface ResolveImpactInput {
  action?: CombatAction;   // resolved from weapon/heavy hint
  weapon?: string | null;
  tier?: number;
  body?: BodyType;
  isCrit?: boolean;
  isKill?: boolean;
}

/** Resolve a weapon/skill string + heavy/crit hints into a CombatAction. */
function actionFor(input: ResolveImpactInput): CombatAction {
  if (input.action) return input.action;
  const w = String(input.weapon || '').toLowerCase();
  if (/kick|leg|shin|foot|capoeira/.test(w)) return 'kick';
  // A bladed/blunt weapon or an explicit crit reads as a committed heavy swing.
  if (/sword|blade|spear|staff|axe|hammer|mace/.test(w) || input.isCrit) return 'attack-heavy';
  return 'attack-light';
}

/**
 * The headline call: derive real kinematics → computeImpactMomentum → feel.
 * This is the importer that makes computeImpactMomentum live.
 */
export function resolveImpact(input: ResolveImpactInput): ImpactFeel {
  const action = actionFor(input);
  const tier = clamp(Number(input.tier) || 2, 1, 5);
  const { boneMass, angularVelocity, leverArmM } = impactKinematics(action, tier, input.body || 'average');
  const momentum = computeImpactMomentum(boneMass, angularVelocity, leverArmM);
  return momentumToFeel(momentum, !!input.isKill);
}
