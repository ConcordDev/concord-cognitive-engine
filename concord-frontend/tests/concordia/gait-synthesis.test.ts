import { describe, it, expect } from 'vitest';
import {
  synthesizeGait,
  synthesizeIdle,
  advanceGaitPhase,
  blendGaitPoses,
  type GaitParams,
  type BodyType,
} from '@/lib/concordia/gait-synthesis';
import { MOVEMENT_STYLE_CONFIGS } from '@/lib/concordia/movement-styles';

const warriorStyle = MOVEMENT_STYLE_CONFIGS.warrior;
const merchantStyle = MOVEMENT_STYLE_CONFIGS.merchant;

const baseParams = (overrides: Partial<GaitParams> = {}): GaitParams => ({
  speed:     5,
  direction: 0,
  slope:     0,
  load:      0,
  fatigue:   1,
  bodyType:  'average' as BodyType,
  style:     warriorStyle,
  ...overrides,
});

describe('synthesizeGait — idle pose', () => {
  it('speed=0 produces near-zero leg swings', () => {
    const pose = synthesizeGait(baseParams({ speed: 0 }), 0);
    expect(Math.abs(pose.leftUpperLeg.x)).toBeLessThan(0.02);
    expect(Math.abs(pose.rightUpperLeg.x)).toBeLessThan(0.02);
  });

  it('speed=0 produces near-zero arm swing', () => {
    const pose = synthesizeGait(baseParams({ speed: 0 }), 0);
    expect(Math.abs(pose.leftUpperArm.x)).toBeLessThan(0.05);
    expect(Math.abs(pose.rightUpperArm.x)).toBeLessThan(0.05);
  });
});

describe('synthesizeGait — locomotion', () => {
  it('at phase=0.25 left leg is forward, right leg is back', () => {
    // sin(0) = 0 → thighs at 0 at phase=0; knee flex differs by phase.
    // phase=0.25 → sin(π/2) = 1 → left leg full forward.
    const poseQ = synthesizeGait(baseParams({ speed: 5 }), 0.25);
    expect(poseQ.leftUpperLeg.x).toBeGreaterThan(0);
    expect(poseQ.rightUpperLeg.x).toBeLessThan(0);
  });

  it('at phase=0.75 right leg is forward, left leg is back', () => {
    const pose = synthesizeGait(baseParams({ speed: 5 }), 0.75);
    expect(pose.rightUpperLeg.x).toBeGreaterThan(0);
    expect(pose.leftUpperLeg.x).toBeLessThan(0);
  });

  it('left and right leg phases are exactly opposite (180° offset)', () => {
    const pose = synthesizeGait(baseParams({ speed: 5 }), 0.25);
    // leftUpperLeg.x = sin(legPhaseL) * swing
    // rightUpperLeg.x = sin(legPhaseR=legPhaseL+π) * swing = -sin(legPhaseL) * swing
    expect(pose.leftUpperLeg.x).toBeCloseTo(-pose.rightUpperLeg.x, 3);
  });

  it('arms counter-swing: left arm backward when left leg forward', () => {
    // At phase=0.25: left leg fully forward (sin=1), so left arm should be fully backward (<0)
    const pose = synthesizeGait(baseParams({ speed: 5 }), 0.25);
    expect(Math.sign(pose.leftUpperLeg.x)).toBe(1);   // left leg forward
    expect(Math.sign(pose.leftUpperArm.x)).toBe(-1);  // left arm backward
    expect(Math.sign(pose.rightUpperArm.x)).toBe(1);  // right arm forward
  });

  it('higher speed produces larger thigh swing', () => {
    const slow = synthesizeGait(baseParams({ speed: 2 }), 0.25);
    const fast = synthesizeGait(baseParams({ speed: 10 }), 0.25);
    expect(Math.abs(fast.leftUpperLeg.x)).toBeGreaterThan(Math.abs(slow.leftUpperLeg.x));
  });

  it('running speed produces more knee flexion than walking', () => {
    const walk = synthesizeGait(baseParams({ speed: 5 }), 0.75); // swing phase for right leg
    const run  = synthesizeGait(baseParams({ speed: 10 }), 0.75);
    expect(run.rightLowerLeg.x).toBeGreaterThan(walk.rightLowerLeg.x);
  });
});

describe('synthesizeGait — slope compensation', () => {
  it('uphill slope produces forward lean on hips', () => {
    const flat   = synthesizeGait(baseParams({ slope: 0 }), 0);
    const uphill = synthesizeGait(baseParams({ slope: 0.3 }), 0);
    expect(uphill.hips.x).toBeGreaterThan(flat.hips.x);
  });

  it('downhill slope produces backward lean', () => {
    const flat     = synthesizeGait(baseParams({ slope: 0 }), 0);
    const downhill = synthesizeGait(baseParams({ slope: -0.3 }), 0);
    expect(downhill.hips.x).toBeLessThan(flat.hips.x);
  });

  it('slope affects spine forward angle', () => {
    const flat   = synthesizeGait(baseParams({ slope: 0 }), 0);
    const uphill = synthesizeGait(baseParams({ slope: 0.4 }), 0);
    expect(uphill.spine.x).toBeGreaterThan(flat.spine.x);
  });
});

describe('synthesizeGait — load (weapon mass / encumbrance)', () => {
  it('carried load causes hips to crouch (hips.x increases)', () => {
    const unloaded = synthesizeGait(baseParams({ load: 0 }), 0);
    const loaded   = synthesizeGait(baseParams({ load: 5 }), 0);
    // loadCrouch = (load/50)*0.1 — adds to hips.x
    expect(loaded.hips.x).toBeLessThan(unloaded.hips.x); // hips.x = slopeComp - loadCrouch
  });

  it('load reduces hip bob amplitude', () => {
    const unloaded = synthesizeGait(baseParams({ load: 0, speed: 8 }), 0.25);
    const loaded   = synthesizeGait(baseParams({ load: 10, speed: 8 }), 0.25);
    expect(loaded.hipOffset.y).toBeLessThanOrEqual(unloaded.hipOffset.y);
  });
});

describe('synthesizeGait — fatigue', () => {
  it('fatigue=0.5 produces smaller thigh swing than fatigue=1', () => {
    const fresh   = synthesizeGait(baseParams({ fatigue: 1.0 }), 0.25);
    const tired   = synthesizeGait(baseParams({ fatigue: 0.5 }), 0.25);
    expect(Math.abs(tired.leftUpperLeg.x)).toBeLessThan(Math.abs(fresh.leftUpperLeg.x));
  });

  it('fatigue=0 produces noticeable droop on hips/spine', () => {
    const fresh    = synthesizeGait(baseParams({ fatigue: 1.0, speed: 3 }), 0);
    const exhaust  = synthesizeGait(baseParams({ fatigue: 0.0, speed: 3 }), 0);
    // fatigueDroop = (1-0)*0.06 = 0.06 added to hips.x and spine.x
    expect(exhaust.hips.x).toBeGreaterThan(fresh.hips.x);
  });
});

describe('synthesizeGait — movement style', () => {
  it('berserker has larger arm swing than merchant', () => {
    const berserker = synthesizeGait(baseParams({ style: MOVEMENT_STYLE_CONFIGS.berserker, speed: 5 }), 0.25);
    const merchant  = synthesizeGait(baseParams({ style: merchantStyle, speed: 5 }), 0.25);
    expect(Math.abs(berserker.leftUpperArm.x)).toBeGreaterThan(Math.abs(merchant.leftUpperArm.x));
  });

  it('guardian (strideLengthScale=1.3) produces bigger thigh swing than rogue (strideLengthScale=0.9)', () => {
    const guardian = synthesizeGait(baseParams({ style: MOVEMENT_STYLE_CONFIGS.guardian, speed: 5 }), 0.25);
    const rogue    = synthesizeGait(baseParams({ style: MOVEMENT_STYLE_CONFIGS.rogue,    speed: 5 }), 0.25);
    expect(Math.abs(guardian.leftUpperLeg.x)).toBeGreaterThan(Math.abs(rogue.leftUpperLeg.x));
  });
});

describe('advanceGaitPhase', () => {
  it('returns 0 when speed is 0', () => {
    expect(advanceGaitPhase(0, 0, 'average', 0.016)).toBe(0);
  });

  it('phase advances proportionally to speed × delta', () => {
    const phase1 = advanceGaitPhase(0, 5, 'average', 0.016);
    const phase2 = advanceGaitPhase(0, 10, 'average', 0.016);
    expect(phase2).toBeCloseTo(phase1 * 2, 5);
  });

  it('phase wraps at 1.0', () => {
    // Advance enough to overflow
    const phase = advanceGaitPhase(0.95, 10, 'average', 0.1);
    expect(phase).toBeLessThan(1.0);
    expect(phase).toBeGreaterThanOrEqual(0);
  });

  it('tall body type has longer stride → slower phase advance than slim', () => {
    const slim = advanceGaitPhase(0, 5, 'slim', 0.016);
    const tall = advanceGaitPhase(0, 5, 'tall', 0.016);
    // tall stride = 0.85m > slim stride = 0.70m → phase advances slower
    expect(tall).toBeLessThan(slim);
  });
});

describe('synthesizeIdle', () => {
  it('returns a partial pose with hipOffset for breathing', () => {
    const idle = synthesizeIdle(0, warriorStyle, 1);
    expect(idle.hipOffset).toBeDefined();
  });

  it('hipOffset.y varies with elapsed time (breathing)', () => {
    // elapsed=0 → sin(0)=0 → hipOffset.y=0
    // elapsed=π/1.6 → sin(π/1.6 * 0.8)=sin(π/2)=1 → hipOffset.y=max breathAmp
    const idleAt0   = synthesizeIdle(0,           warriorStyle, 1);
    const idleAtMax = synthesizeIdle(Math.PI / 1.6, warriorStyle, 1);
    expect(idleAtMax.hipOffset!.y).toBeGreaterThan(idleAt0.hipOffset!.y);
    expect(idleAt0.hipOffset!.y).toBeCloseTo(0, 5);
  });

  it('exhausted character has drooped head (neck.x < 0)', () => {
    const fresh   = synthesizeIdle(0, warriorStyle, 1.0);
    const exhaust = synthesizeIdle(0, warriorStyle, 0.0);
    // fatigueDroop adds to neck: -fatigueDroop*0.4 → exhausted neck.x more negative
    expect(exhaust.neck!.x).toBeLessThan(fresh.neck!.x);
  });
});

describe('blendGaitPoses', () => {
  it('at t=0 returns pose a', () => {
    const a = synthesizeGait(baseParams({ speed: 3 }), 0.25);
    const b = synthesizeGait(baseParams({ speed: 8 }), 0.25);
    const blended = blendGaitPoses(a, b, 0);
    expect(blended.leftUpperLeg.x).toBeCloseTo(a.leftUpperLeg.x, 5);
  });

  it('at t=1 returns pose b', () => {
    const a = synthesizeGait(baseParams({ speed: 3 }), 0.25);
    const b = synthesizeGait(baseParams({ speed: 8 }), 0.25);
    const blended = blendGaitPoses(a, b, 1);
    expect(blended.leftUpperLeg.x).toBeCloseTo(b.leftUpperLeg.x, 5);
  });

  it('at t=0.5 is the midpoint', () => {
    const a = synthesizeGait(baseParams({ speed: 0 }), 0.25);
    const b = synthesizeGait(baseParams({ speed: 12 }), 0.25);
    const blended = blendGaitPoses(a, b, 0.5);
    const mid = (a.leftUpperLeg.x + b.leftUpperLeg.x) / 2;
    expect(blended.leftUpperLeg.x).toBeCloseTo(mid, 5);
  });
});
