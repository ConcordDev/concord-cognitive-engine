// Track 3 (onboarding ceremony) — Concordia's First-Cycle voice lines. Pins the
// pure phase→line composer the FirstWinWizard speaks in-world, and that every
// authored First-Cycle / First-Win step has a line (no silent phase).
//
// Run: npx vitest run tests/onboarding-voice.test.ts

import { describe, it, expect } from 'vitest';
import { phaseVoiceLine, hasVoiceLine, ARRIVAL_LINE } from '../lib/concordia/onboarding-voice';

describe('phaseVoiceLine', () => {
  it('has a line for every First-Cycle phase', () => {
    for (const id of ['first_cycle_cook', 'first_cycle_eat', 'first_cycle_fight', 'first_cycle_commune']) {
      expect(phaseVoiceLine(id)).toBeTruthy();
      expect(hasVoiceLine(id)).toBe(true);
    }
  });

  it('has a line for the First-Win follow-on steps', () => {
    for (const id of ['create_dtu', 'create_artifact', 'view_global']) {
      expect(phaseVoiceLine(id)).toBeTruthy();
    }
  });

  it('returns null for unknown / empty ids (total, never throws)', () => {
    expect(phaseVoiceLine('nope')).toBeNull();
    expect(phaseVoiceLine(null)).toBeNull();
    expect(phaseVoiceLine(undefined)).toBeNull();
    expect(phaseVoiceLine('')).toBeNull();
    expect(hasVoiceLine('nope')).toBe(false);
  });

  it('the fight line reassures (no-fall promise) and cook leads with warmth', () => {
    expect(phaseVoiceLine('first_cycle_fight')!.toLowerCase()).toContain('fall');
    expect(phaseVoiceLine('first_cycle_cook')!.toLowerCase()).toContain('cook');
  });

  it('exports a non-empty arrival line', () => {
    expect(ARRIVAL_LINE.length).toBeGreaterThan(10);
  });
});
