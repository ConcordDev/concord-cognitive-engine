// WAVE EXPR keystone — the state-bias block (pure, headless).
import { describe, it, expect } from 'vitest';
import { stateBias, moodToEmotion, BIAS_PARTS } from '@/lib/concordia/mood-bias-pose';

describe('stateBias', () => {
  it('neutral is a near-zero bias (off == today)', () => {
    const b = stateBias({ mood: 'neutral' });
    for (const k of Object.keys(b.posture) as (keyof typeof b.posture)[]) expect(Math.abs(b.posture[k])).toBeLessThan(0.02);
    expect(b.gazePolicy).toBe('direct');
    expect(b.exaggerationGain).toBeCloseTo(1.0, 1);
  });

  it('grief slumps the body forward/down and flattens motion', () => {
    const calm = stateBias({ mood: 'neutral' });
    const grief = stateBias({ mood: 'grieving', grief: 0.9 });
    expect(grief.posture.headPitch).toBeGreaterThan(calm.posture.headPitch); // head down
    expect(grief.posture.torsoPitch).toBeGreaterThan(calm.posture.torsoPitch); // slump fwd
    expect(grief.exaggerationGain).toBeLessThan(calm.exaggerationGain);        // flat
    expect(grief.gazePolicy).toBe('avoid');
  });

  it('hostility leans forward + raises breathing + tightens timing', () => {
    const h = stateBias({ mood: 'hostile', hostility: 0.9 });
    expect(h.posture.torsoPitch).toBeGreaterThan(0.1); // forward lean
    expect(h.breathingRate).toBeGreaterThan(0.35);
    expect(h.exaggerationGain).toBeGreaterThan(1.0);
  });

  it('threat → fearful crouch + rapid breath + wary/avoid gaze', () => {
    const f = stateBias({ mood: 'fearful', threat: 0.9 });
    expect(f.posture.hipDrop).toBeGreaterThan(0.05);     // crouch
    expect(f.breathingRate).toBeGreaterThan(0.5);        // rapid
    expect(['wary', 'avoid']).toContain(f.gazePolicy);
  });

  it('fatigue lowers stance, slows timing, deepens breath', () => {
    const e = stateBias({ fatigue: 0.9 });
    expect(e.posture.hipDrop).toBeGreaterThan(0.08);
    expect(e.timingScalar).toBeLessThan(0.85);           // sluggish
    expect(e.breathingDepth).toBeGreaterThan(0.5);       // deep
  });

  it('posture stays bounded (readable, never broken)', () => {
    const x = stateBias({ mood: 'grieving', grief: 1, hostility: 1, fatigue: 1, threat: 1 });
    for (const k of Object.keys(x.posture) as (keyof typeof x.posture)[]) expect(Math.abs(x.posture[k])).toBeLessThanOrEqual(0.42);
  });

  it('avoidEyeContact / hostile relationship forces avert gaze', () => {
    expect(stateBias({ avoidEyeContact: true }).gazePolicy).toBe('avoid');
    expect(stateBias({ relationship: -0.8 }).gazePolicy).toBe('avoid');
  });
});

describe('moodToEmotion (fixes frozen-neutral)', () => {
  it('maps moods + axes onto the facial rig', () => {
    expect(moodToEmotion({ mood: 'grieving' })).toBe('sad');
    expect(moodToEmotion({ mood: 'hostile' })).toBe('angry');
    expect(moodToEmotion({ mood: 'fearful' })).toBe('fearful');
    expect(moodToEmotion({ mood: 'friendly' })).toBe('happy');
    expect(moodToEmotion({ mood: 'wary' })).toBe('focused');
    expect(moodToEmotion({ mood: 'neutral' })).toBe('neutral');
    expect(moodToEmotion({ grief: 0.8 })).toBe('sad');          // axis overrides bare mood
    expect(moodToEmotion({ relationship: 0.7 })).toBe('happy');
  });
  it('exposes the spine-up bias parts (legs stay procedural)', () => {
    expect(BIAS_PARTS).toEqual(['head', 'neck', 'torso', 'spine', 'hips']);
  });
});
