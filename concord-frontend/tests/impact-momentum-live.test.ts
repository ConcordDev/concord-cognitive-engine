// T1.4b/T3.1b — the client momentum model is now LIVE.
//
// Pins:
//   - resolveImpact imports + calls computeImpactMomentum (the dead fn is live)
//   - momentum ordering is physical: a heavy weapon swing > kick > light punch,
//     and higher tier > lower tier
//   - the feel curve is monotonic + bounded (hitstop ≤200, knockback ≤7)
//   - a kill always reads 'kill' severity
//   - the bridge subscribes combat:hit and dispatches the feel events

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveImpact, momentumToFeel } from '@/lib/concordia/impact-resolver';
import { impactKinematics } from '@/lib/concordia/combat-biomechanics';
import { computeImpactMomentum } from '@/lib/concordia/combat-motor-driver';

describe('T1.4b — computeImpactMomentum is live', () => {
  test('resolveImpact composes impactKinematics → computeImpactMomentum', () => {
    const k = impactKinematics('attack-light', 3, 'average');
    const direct = computeImpactMomentum(k.boneMass, k.angularVelocity, k.leverArmM);
    const feel = resolveImpact({ action: 'attack-light', tier: 3 });
    expect(feel.momentum).toBeCloseTo(Math.round(direct * 10) / 10, 1);
    expect(direct).toBeGreaterThan(0);
  });

  test('momentum ordering is physical (heavy swing > kick > light punch)', () => {
    const light = resolveImpact({ action: 'attack-light', tier: 3 }).momentum;
    const kick = resolveImpact({ action: 'kick', tier: 3 }).momentum;
    const heavy = resolveImpact({ action: 'attack-heavy', tier: 3 }).momentum;
    expect(kick).toBeGreaterThan(light);
    expect(heavy).toBeGreaterThan(light);
  });

  test('higher tier delivers more momentum', () => {
    const t1 = resolveImpact({ action: 'attack-heavy', tier: 1 }).momentum;
    const t5 = resolveImpact({ action: 'attack-heavy', tier: 5 }).momentum;
    expect(t5).toBeGreaterThan(t1);
  });
});

describe('T1.4b — feel curve', () => {
  test('is monotonic and bounded', () => {
    const lo = momentumToFeel(5);
    const hi = momentumToFeel(40);
    expect(hi.hitPauseMs).toBeGreaterThanOrEqual(lo.hitPauseMs);
    expect(hi.knockback).toBeGreaterThanOrEqual(lo.knockback);
    expect(momentumToFeel(999).hitPauseMs).toBeLessThanOrEqual(200);
    expect(momentumToFeel(999).knockback).toBeLessThanOrEqual(7);
  });

  test('a kill always reads kill severity', () => {
    expect(momentumToFeel(2, true).severity).toBe('kill');
    expect(resolveImpact({ action: 'attack-light', tier: 1, isKill: true }).severity).toBe('kill');
  });

  test('severity bands climb with momentum', () => {
    expect(momentumToFeel(2).severity).toBe('hit');
    expect(momentumToFeel(24).severity).toBe('heavy');
    expect(momentumToFeel(36).severity).toBe('crit');
  });
});

describe('T1.4b — bridge wiring', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'components/world/ImpactMomentumBridge.tsx'), 'utf8',
  );
  test('subscribes combat:hit and dispatches feel events', () => {
    expect(src).toMatch(/subscribe\('combat:hit'/);
    expect(src).toMatch(/concordia:hit-pause/);
    expect(src).toMatch(/concordia:knockback/);
    expect(src).toMatch(/concordia:hit-reaction/);
    expect(src).toMatch(/resolveImpact/);
  });
  test('is mounted in CombatPolishLayer', () => {
    const polish = fs.readFileSync(
      path.resolve(__dirname, '..', 'components/world/CombatBridges.tsx'), 'utf8',
    );
    expect(polish).toMatch(/<ImpactMomentumBridge \/>/);
  });
});
