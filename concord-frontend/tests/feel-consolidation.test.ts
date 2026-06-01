// Game-feel consolidation (2026-06) — pins the three POLISH_AUDIT fixes:
//   T2.7  one trauma authority (screen-trauma.ts) for both shake surfaces
//   T2.10 dodge/parry cancel window wired into CombatInputController
//   #8    shared motion-duration tokens in juice.ts
//
// The shake + cancel paths are render-loop / event integrations (verified to
// compile + run live); these pins guard the WIRING so it can't silently regress
// back into the three-systems / dead-canCancel state the audit found.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOTION, durationMs } from '@/lib/concordia/juice';
import { cancelState, canCancel, CANCEL_THRESHOLD } from '@/lib/concordia/combat-input-buffer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('T2.7 — single trauma authority for screen shake', () => {
  const scene = read('components/world-lens/ConcordiaScene.tsx');
  const juice = read('components/world-lens/GameJuice.tsx');

  it('ConcordiaScene drives the 3D camera shake from the shared trauma engine', () => {
    expect(scene).toMatch(/from '@\/lib\/concordia\/screen-trauma'/);
    expect(scene).toMatch(/createTraumaShake\(/);
    expect(scene).toMatch(/traumaShakeRef/);
    expect(scene).toMatch(/\.addTrauma\(/);
  });

  it('no longer re-implements its own inline shake-noise channels', () => {
    expect(scene).not.toMatch(/_camShakeNX/);
  });

  it('GameJuice 2D HUD shake scales by the shared severity curve', () => {
    expect(juice).toMatch(/from '@\/lib\/concordia\/screen-trauma'/);
    expect(juice).toMatch(/traumaForSeverity\(/);
  });
});

describe('T2.10 — dodge/parry cancel window wired', () => {
  const src = read('components/world-lens/CombatInputController.tsx');

  it('imports + uses cancelState (no longer dead-exported)', () => {
    expect(src).toMatch(/import \{[^}]*cancelState[^}]*\} from '@\/lib\/concordia\/combat-input-buffer'/);
    expect(src).toMatch(/cancelState\(/);
  });

  it('tracks an offensive recovery window + a pending defensive press', () => {
    expect(src).toMatch(/lastOffenseRef/);
    expect(src).toMatch(/pendingDefensiveRef/);
    expect(src).toMatch(/tryDefensiveCancel/);
  });

  it('only offensive actions stamp the commitment', () => {
    expect(src).toMatch(/const isOffense =/);
  });
});

describe('cancelState contract the wiring relies on', () => {
  it('blocks a defensive cancel before the threshold, allows it after', () => {
    // Light attack, 200ms recovery: a dodge at 60ms (30%) is too early.
    expect(cancelState(60, 200).cancellable).toBe(false);
    // At/after 50% (100ms) the window is open.
    expect(cancelState(100, 200).cancellable).toBe(true);
    expect(cancelState(180, 200).cancellable).toBe(true);
  });
  it('threshold is the documented 50%', () => {
    expect(CANCEL_THRESHOLD).toBe(0.5);
    expect(canCancel(0.49)).toBe(false);
    expect(canCancel(0.5)).toBe(true);
  });
  it('no commitment (recoveryMs 0) reports fully cancellable', () => {
    expect(cancelState(0, 0).cancellable).toBe(true);
  });
});

describe('Chunk-1 combat polish (T2.2/T2.3/T2.6/T2.11)', () => {
  it('T2.2 — swing/whiff SFX voices exist + fire on the swing', () => {
    const sound = read('components/world-lens/SoundscapeEngine.tsx');
    expect(sound).toMatch(/'combat-swing'/);
    expect(sound).toMatch(/'combat-swing-heavy'/);
    const ctrl = read('components/world-lens/CombatInputController.tsx');
    expect(ctrl).toMatch(/from '@\/lib\/concordia\/juice'/);
    expect(ctrl).toMatch(/combat-swing/);
  });

  it('T2.3 — lock-on reticle uses the real projector, not the yaw approximation', () => {
    const lock = read('components/world-lens/LockOnController.tsx');
    expect(lock).toMatch(/concordia:projector-ready/);
    expect(lock).toMatch(/__concordiaProject/);
    // the broken atan2 yaw approximation is gone
    expect(lock).not.toMatch(/Math\.atan2\(dy, dx\) - cameraYaw/);
    const scene = read('components/world-lens/ConcordiaScene.tsx');
    // camera biases lookAt toward the locked target
    expect(scene).toMatch(/lockedTargetId \? cameraLookState\.lockedTargetPos/);
    expect(scene).toMatch(/__concordiaProject/);
  });

  it('T2.6 — dead AnimationManager is deleted + unmounted', () => {
    expect(() => read('components/world-lens/AnimationManager.tsx')).toThrow();
    const page = read('app/lenses/world/page.tsx');
    expect(page).not.toMatch(/<AnimationManager>/);
    expect(page).not.toMatch(/import\('@\/components\/world-lens\/AnimationManager'\)/);
  });

  it('T2.11 — GameJuice 2D shake renders a visible vignette (not a transparent div)', () => {
    const gj = read('components/world-lens/GameJuice.tsx');
    expect(gj).toMatch(/radial-gradient\(ellipse at center, transparent 55%, rgba\(220,40,40/);
  });
});

describe('#8 — shared motion-duration tokens', () => {
  it('exposes the industry-convergent tier table', () => {
    expect(MOTION.instant).toBe(80);
    expect(MOTION.fast).toBe(160);
    expect(MOTION.base).toBe(240);
    expect(MOTION.slow).toBe(360);
    // entrances run a touch longer than exits
    expect(MOTION.enter).toBeGreaterThan(MOTION.exit);
  });
  it('durationMs resolves a token or passes a raw number through', () => {
    expect(durationMs('fast')).toBe(160);
    expect(durationMs(500)).toBe(500);
  });
});
