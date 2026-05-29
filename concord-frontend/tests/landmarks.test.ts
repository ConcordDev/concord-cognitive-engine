// I3 — per-world landmark layout (pure, headless).
import { describe, it, expect } from 'vitest';
import { landmarkSpecsForWorld } from '@/lib/world-lens/landmarks';

describe('landmarkSpecsForWorld', () => {
  it('gives tunya its authored multi-landmark layout', () => {
    const specs = landmarkSpecsForWorld('tunya');
    expect(specs.length).toBeGreaterThanOrEqual(3);
    expect(specs.map((s) => s.kind)).toContain('spire'); // the Resonance Choir
    for (const s of specs) {
      expect(['spire', 'arch', 'ring', 'monolith', 'dome']).toContain(s.kind);
      expect(s.scale).toBeGreaterThan(0);
      expect([0, 1, 2]).toContain(s.paletteIdx);
    }
  });

  it('every canon world has at least one landmark', () => {
    for (const w of ['concordia-hub', 'sovereign-ruins', 'cyber', 'fantasy']) {
      expect(landmarkSpecsForWorld(w).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('falls back to a single monument for unknown / null worlds', () => {
    expect(landmarkSpecsForWorld('nonexistent').length).toBe(1);
    expect(landmarkSpecsForWorld(null).length).toBe(1);
    expect(landmarkSpecsForWorld(null)[0].kind).toBe('monolith');
  });
});
