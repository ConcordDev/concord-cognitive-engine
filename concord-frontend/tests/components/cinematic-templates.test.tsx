/**
 * Concordia Phase 15 — extended cinematic AUTO_TEMPLATES coverage.
 *
 * Pins:
 *   - Phase 1 scheme:complete template registered
 *   - Phase 12 dynasty:heir_acceded template registered
 *   - combat:hero_kill + bloodline_fire_cast templates registered
 *   - refusal:compound template registered (compound-refusal goddess)
 *   - ark:archive_unlocked + vela:reveal templates registered
 *   - every template has at least one shot
 *   - every shot has a camera + duration_ms
 */

import { describe, it, expect } from 'vitest';
import { DIRECTOR_CONSTANTS } from '@/lib/world-lens/cinematic-director';

describe('Phase 15 / cinematic — extended trigger coverage', () => {
  const T = DIRECTOR_CONSTANTS.AUTO_TEMPLATES;

  it('scheme:complete registered', () => {
    expect(T['scheme:complete']).toBeDefined();
  });

  it('dynasty:heir_acceded registered', () => {
    expect(T['dynasty:heir_acceded']).toBeDefined();
  });

  it('combat:hero_kill registered', () => {
    expect(T['combat:hero_kill']).toBeDefined();
  });

  it('combat:bloodline_fire_cast registered', () => {
    expect(T['combat:bloodline_fire_cast']).toBeDefined();
  });

  it('refusal:compound registered (Concordia deep-cold)', () => {
    expect(T['refusal:compound']).toBeDefined();
  });

  it('ark:archive_unlocked registered', () => {
    expect(T['ark:archive_unlocked']).toBeDefined();
  });

  it('vela:reveal registered', () => {
    expect(T['vela:reveal']).toBeDefined();
  });

  it('every template has at least one shot', () => {
    for (const [name, shots] of Object.entries(T)) {
      expect((shots as unknown[]).length).toBeGreaterThan(0);
      if ((shots as unknown[]).length === 0) console.error(`empty template: ${name}`);
    }
  });

  it('every shot has camera + duration_ms', () => {
    for (const [name, shots] of Object.entries(T)) {
      for (const s of shots as Array<Record<string, unknown>>) {
        expect(typeof s.camera).toBe('string');
        expect(typeof s.duration_ms).toBe('number');
        expect((s.duration_ms as number) > 0).toBe(true);
        if (!s.camera || !s.duration_ms) {
          console.error(`bad shot in ${name}:`, s);
        }
      }
    }
  });
});
