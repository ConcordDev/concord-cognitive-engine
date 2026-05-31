// Generative-adaptive scoring — the pure event→directive mapping.
import { describe, it, expect } from 'vitest';
import { scoreDirectivesFor } from '@/lib/concordia/adaptive-score';

describe('scoreDirectivesFor', () => {
  it('a war erupting raises combat intensity and shifts minor', () => {
    const d = scoreDirectivesFor('faction:war-declared');
    expect(d.find((x) => x.action === 'setMusicCombatIntensity')?.intensity).toBeGreaterThan(0.5);
    expect(d.find((x) => x.action === 'setMusicMode')?.mode).toBe('minor');
  });

  it('a crisis resolving returns to major and drops intensity', () => {
    const d = scoreDirectivesFor('world:crisis-resolved');
    expect(d.find((x) => x.action === 'setMusicMode')?.mode).toBe('major');
    expect(d.find((x) => x.action === 'setMusicCombatIntensity')?.intensity).toBe(0);
  });

  it('a landed scheme stings minor; a foiled one resolves major', () => {
    expect(scoreDirectivesFor('npc:scheme-resolved', { outcome: 'complete' })[0].mode).toBe('minor');
    expect(scoreDirectivesFor('npc:scheme-resolved', { outcome: 'exposed' })[0].mode).toBe('major');
  });

  it('compound refusal bends into a sustained minor', () => {
    const d = scoreDirectivesFor('refusal:compound-threshold');
    expect(d[0].mode).toBe('minor');
    expect(d[0].holdMs).toBeGreaterThan(10000);
  });

  it('unknown events produce no directive', () => {
    expect(scoreDirectivesFor('something:irrelevant')).toEqual([]);
  });
});
