import { describe, it, expect } from 'vitest';
import { parseFieldInput, parseNumberText } from '@/lib/conkay/field-units';

const v = (t: string, d: 'length' | 'force', u: string) => { const r = parseFieldInput(t, d, u); if (!r.ok) throw new Error(r.error); return r.value; };

describe('any-unit number boxes', () => {
  it('numbers and fractions', () => {
    expect(parseNumberText('1 1/2')).toBe(1.5);
    expect(parseNumberText('¾')).toBe(0.75);
    expect(parseNumberText('1,200')).toBe(1200);
  });
  it('lengths into a mm box', () => {
    expect(v('250', 'length', 'mm')).toBe(250);
    expect(v('3/4 in', 'length', 'mm')).toBeCloseTo(19.05, 6);
    expect(v('2 ft 3 in', 'length', 'mm')).toBeCloseTo(685.8, 6);
    expect(v(`5'6"`, 'length', 'mm')).toBeCloseTo(1676.4, 6);
    expect(v('1.2 m', 'length', 'mm')).toBeCloseTo(1200, 6);
  });
  it('forces and weights into a kN box', () => {
    expect(v('500 lbf', 'force', 'kN')).toBeCloseTo(2.224111, 5);
    expect(v('2 kip', 'force', 'kN')).toBeCloseTo(8.896443, 5);
    const kg = parseFieldInput('50 kg', 'force', 'kN');
    expect(kg.ok && kg.value).toBeCloseTo(0.4903325, 6);
    expect(kg.ok && kg.note).toMatch(/weighs/);
  });
  it('refuses what it cannot read', () => {
    expect(parseFieldInput('3 furlongs', 'length', 'mm').ok).toBe(false);
    expect(parseFieldInput('5 m', 'force', 'kN').ok).toBe(false);
    expect(parseFieldInput('lots', 'length', 'mm').ok).toBe(false);
  });
});
