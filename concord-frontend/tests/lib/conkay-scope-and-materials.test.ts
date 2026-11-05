/**
 * ConKay F6 + F15 (build(conkay)):
 *  - Out-of-scope solver requests decline BY NAME: the detector fires on
 *    an analysis ask (buckling, modal, thermal stress…), cites the
 *    solver's stated out-of-scope list, and never substitutes a bending
 *    solve. Questions ABOUT the scope stay conversation.
 *  - formatModulus: one precision for the shared materials library at
 *    both doors (PLA 3,500 MPa reads "3.5 GPa", never "4 GPa").
 */
import { describe, it, expect } from 'vitest';
import { detectOutOfScopeRequest, outOfScopeDecline } from '@/lib/conkay/workspace-commands';
import { formatModulus } from '@/lib/material-format';

describe('detectOutOfScopeRequest (F6)', () => {
  it('catches the filed buckling ask', () => {
    const hit = detectOutOfScopeRequest('Run a buckling check and give me the critical buckling load');
    expect(hit?.receipt).toBe('buckling_eigen');
  });
  it('catches modal and thermal-stress asks', () => {
    expect(detectOutOfScopeRequest('What is the natural frequency — do a modal analysis')?.receipt).toBe('modal');
    expect(detectOutOfScopeRequest('Calculate the thermal stress for a 40 degree swing')?.receipt).toBe('thermal_stress');
  });
  it('leaves ordinary study talk alone', () => {
    expect(detectOutOfScopeRequest('t_w = 8 mm and re-run')).toBeNull();
    expect(detectOutOfScopeRequest('cantilever, 50 kN, A36')).toBeNull();
    expect(detectOutOfScopeRequest('Review the stress results of this study')).toBeNull();
  });
  it('leaves questions ABOUT the scope to the agent', () => {
    expect(detectOutOfScopeRequest('Why is buckling not checked by the sweep?')).toBeNull();
  });
  it('the decline names the scope and refuses substitution', () => {
    const text = outOfScopeDecline({ receipt: 'buckling_eigen', label: 'buckling / eigenvalue analysis' }, ['buckling_eigen', 'modal']);
    expect(text).toContain('does not run buckling');
    expect(text).toContain('modal / vibration analysis');
    expect(text).toContain('not substituted a bending solve');
  });
});

describe('formatModulus (F15)', () => {
  it('states the library value at one precision', () => {
    expect(formatModulus(3500)).toBe('3.5 GPa');
    expect(formatModulus(68900)).toBe('68.9 GPa');
    expect(formatModulus(200000)).toBe('200 GPa');
    expect(formatModulus(113800)).toBe('113.8 GPa');
  });
  it('never rounds 3.5 up to 4', () => {
    expect(formatModulus(3500)).not.toBe('4 GPa');
  });
});
