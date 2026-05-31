// WS-CONSEQUENCE — the world's memory made visible at a glance. Pins the
// demeanor resolution: grudge sinks regard louder than gratitude lifts, an active
// enemy / high grudge reads hostile, helping enough reads warm→devoted, and the
// neutral default carries no tell.

import { describe, it, expect } from 'vitest';
import { resolveDemeanor } from '@/lib/concordia/npc-demeanor';

describe('NPC demeanor (visible consequence)', () => {
  it('a high grudge reads hostile (the world remembers being wronged)', () => {
    expect(resolveDemeanor({ grudge: 9 }).demeanor).toBe('hostile');
    expect(resolveDemeanor({ hostile: true }).demeanor).toBe('hostile');
  });

  it('strong faction reputation + gratitude reads devoted/warm', () => {
    expect(resolveDemeanor({ reputation: 1, gratitude: 8 }).demeanor).toBe('devoted');
    expect(resolveDemeanor({ reputation: 0.4, gratitude: 3 }).demeanor).toBe('warm');
  });

  it('grudge outweighs equal gratitude (wronged is louder than helped)', () => {
    const d = resolveDemeanor({ grudge: 5, gratitude: 5 });
    expect(['cold', 'wary']).toContain(d.demeanor);
  });

  it('neutral carries no tell (icon empty)', () => {
    const d = resolveDemeanor({});
    expect(d.demeanor).toBe('neutral');
    expect(d.icon).toBe('');
  });

  it('every demeanor has a tint + posture', () => {
    for (const s of [{ grudge: 9 }, { reputation: -0.8 }, { gratitude: 9, reputation: 1 }, {}]) {
      const d = resolveDemeanor(s);
      expect(d.tint).toMatch(/^#/);
      expect(d.posture).toBeTruthy();
    }
  });
});
