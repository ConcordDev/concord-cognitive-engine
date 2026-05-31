// Parametric world audio — the pure signal→synth-directive mapping.
import { describe, it, expect } from 'vitest';
import { worldAudioDirectiveFor } from '@/lib/concordia/world-audio';

describe('worldAudioDirectiveFor', () => {
  it('a building creaks louder as structural stress rises; timbre by material', () => {
    const low = worldAudioDirectiveFor('world:building-state', { structuralStress: 0.2, material: 'wood' });
    const high = worldAudioDirectiveFor('world:building-state', { structuralStress: 0.9, material: 'wood' });
    expect(high!.gain).toBeGreaterThan(low!.gain);
    expect(low!.layer).toBe('creak');
    // steel groans lower than thatch rustles
    const steel = worldAudioDirectiveFor('world:building-state', { structuralStress: 0.5, material: 'steel' })!;
    const thatch = worldAudioDirectiveFor('world:building-state', { structuralStress: 0.5, material: 'thatch' })!;
    expect(steel.freqHz).toBeLessThan(thatch.freqHz);
  });

  it('a sound building (near-zero stress) is silent', () => {
    expect(worldAudioDirectiveFor('world:building-state', { structuralStress: 0.01, material: 'stone' })).toBeNull();
  });

  it('an explosion scales with magnitude and varies timbre by element', () => {
    const fire = worldAudioDirectiveFor('combat:hit', { magnitude: 0.8, element: 'fire' })!;
    const lightning = worldAudioDirectiveFor('combat:hit', { magnitude: 0.8, element: 'lightning' })!;
    expect(fire.layer).toBe('explosion');
    expect(fire.freqHz).toBeLessThan(lightning.freqHz); // fire roar low, lightning crack high
    expect(worldAudioDirectiveFor('combat:hit', { magnitude: 0, element: 'fire' })).toBeNull();
  });

  it('a thriving ecosystem thickens the ambient hum', () => {
    const lush = worldAudioDirectiveFor('world:ambient', { ecosystem: 1 })!;
    const dead = worldAudioDirectiveFor('world:ambient', { ecosystem: 0 })!;
    expect(lush.gain).toBeGreaterThan(dead.gain);
    expect(lush.layer).toBe('ambient-hum');
  });

  it('unknown events make no sound', () => {
    expect(worldAudioDirectiveFor('whatever')).toBeNull();
  });
});
