// PR #868 Residual 1 — combo-step sequencing. Pins buildComboStepPlan's
// cumulative offsets, 300ms spacing floor, offensive/defensive classification,
// stepIndex integrity, and animation-token mapping.

import { describe, it, expect } from 'vitest';
import {
  buildComboStepPlan,
  isOffensiveComboAction,
  animationTokenForComboAction,
} from '@/lib/combat/combo-player';

describe('buildComboStepPlan', () => {
  it('lays steps at cumulative offsets from the persisted timing_ms', () => {
    const plan = buildComboStepPlan([
      { action: 'attack-light', timing_ms: 350 },
      { action: 'attack-heavy', timing_ms: 400 },
      { action: 'kick', timing_ms: 350 },
    ]);
    expect(plan.map((p) => p.atMs)).toEqual([0, 350, 750]);
    expect(plan.map((p) => p.stepIndex)).toEqual([0, 1, 2]);
  });

  it('floors spacing at 300ms so steps stay above the server cooldown', () => {
    const plan = buildComboStepPlan([
      { action: 'attack-light', timing_ms: 50 },
      { action: 'attack-light', timing_ms: 10 },
      { action: 'attack-light', timing_ms: 350 },
    ]);
    // first two intervals floored to 300, not 50/10
    expect(plan.map((p) => p.atMs)).toEqual([0, 300, 600]);
  });

  it('defaults missing/invalid timing_ms to 350', () => {
    const plan = buildComboStepPlan([
      { action: 'attack-light' },
      { action: 'attack-light', timing_ms: 0 },
      { action: 'attack-light', timing_ms: -5 },
      { action: 'attack-light' },
    ]);
    expect(plan.map((p) => p.atMs)).toEqual([0, 350, 700, 1050]);
  });

  it('classifies offensive vs defensive steps correctly', () => {
    const plan = buildComboStepPlan([
      { action: 'attack-light' },
      { action: 'parry' },
      { action: 'spell' },
      { action: 'block' },
      { action: 'throw' },
      { action: 'dodge' },
      { action: 'combo-step' },
    ]);
    expect(plan.map((p) => p.offensive)).toEqual([true, false, true, false, true, false, true]);
  });

  it('maps animation tokens: tiered pass-through, combo-step→attack-light, dodge→dodge-back', () => {
    const plan = buildComboStepPlan([
      { action: 'attack-light' },
      { action: 'spell' },
      { action: 'ranged' },
      { action: 'throw' },
      { action: 'combo-step' },
      { action: 'dodge' },
      { action: 'parry' },
    ]);
    expect(plan.map((p) => p.animation)).toEqual([
      'attack-light', 'spell', 'ranged', 'throw', 'attack-light', 'dodge-back', 'parry',
    ]);
  });

  it('marks only attack-heavy as heavy', () => {
    const plan = buildComboStepPlan([{ action: 'attack-heavy' }, { action: 'attack-light' }]);
    expect(plan.map((p) => p.heavy)).toEqual([true, false]);
  });

  it('returns an empty plan for empty/nullish steps', () => {
    expect(buildComboStepPlan([])).toEqual([]);
    expect(buildComboStepPlan(undefined)).toEqual([]);
    expect(buildComboStepPlan(null)).toEqual([]);
  });

  it('exposes the classification/mapping helpers directly', () => {
    expect(isOffensiveComboAction('grapple')).toBe(true);
    expect(isOffensiveComboAction('block')).toBe(false);
    expect(animationTokenForComboAction('combo-step')).toBe('attack-light');
    expect(animationTokenForComboAction('kick')).toBe('kick');
  });
});
