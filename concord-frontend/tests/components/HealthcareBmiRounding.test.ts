/**
 * GB-1538 / FIX-healthcare-015 — evidence pin for a verdict closure.
 * The ticket reports a metric BMI of 22.8 where 22.9 was expected, with
 * no repro steps. Both in-tree implementations round identically
 * (Math.round(bmi*10)/10 — here, and server/domains/healthcare.js's
 * vitals BMI), and no metric (kg/cm) input surface exists in-tree.
 * Feeding the full-precision metric conversion of 70 kg / 175 cm
 * through the shipped imperial function yields exactly 22.9; the
 * observed 22.8 is the signature of a whole-pound-truncated input
 * (154 lb → 22.807 → 22.8), not of either implementation. This pin
 * documents the arithmetic; the ticket closes as a verdict.
 */
import { describe, it, expect } from 'vitest';
import { calculateBMI } from '@/components/healthcare/HealthcareVitals';

describe('calculateBMI metric equivalence (FIX-healthcare-015 evidence)', () => {
  it('70 kg / 175 cm at full conversion precision yields 22.9', () => {
    const lbs = 70 * 2.20462;
    const inches = 175 / 2.54;
    expect(calculateBMI(lbs, inches).value).toBe(22.9);
    expect(calculateBMI(lbs, inches).category).toBe('Normal');
  });

  it('the same person entered as a truncated 154 lb yields 22.8 — the reported figure', () => {
    expect(calculateBMI(154, 175 / 2.54).value).toBe(22.8);
  });

  it('rounding is one-decimal half-up on a clean imperial case', () => {
    // 180 lb / 70 in → 25.82… → Overweight at 25.8
    const r = calculateBMI(180, 70);
    expect(r.value).toBe(25.8);
    expect(r.category).toBe('Overweight');
  });
});
