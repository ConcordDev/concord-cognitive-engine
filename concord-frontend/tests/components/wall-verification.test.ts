import { describe, it, expect } from 'vitest';
import { getWallVerification } from '@/components/masonry/wall-verification';

/**
 * getWallVerification — the honest three-state classifier for a REAL
 * `masonry.wallStrength` computation result. Fixtures mirror the real shape
 * server/domains/masonry.js's `wallStrength` macro returns (confirmed by
 * reading that file directly): `slendernessRatio`, `maxAllowedRatio`, and a
 * boolean `passesSlenderness` — there is no `ok:false` failure path for this
 * macro (non-finite inputs fall back to safe defaults), so `no_data` here
 * means "no check has been submitted yet."
 */

describe('getWallVerification — pure classification', () => {
  it('classifies a genuinely-passing slenderness check as verified', () => {
    const v = getWallVerification({ slendernessRatio: 12, maxAllowedRatio: 25, passesSlenderness: true });
    expect(v.state).toBe('verified');
    expect(v.label).toBe('Wall OK');
    expect(v.detail).toMatch(/within the allowed 25/);
  });

  it('classifies a genuinely-failing slenderness check as failed, never verified', () => {
    const v = getWallVerification({ slendernessRatio: 31, maxAllowedRatio: 25, passesSlenderness: false });
    expect(v.state).toBe('failed');
    expect(v.label).toBe('Wall Fails Check');
    expect(v.detail).toMatch(/EXCEEDS the allowed 25/);
  });

  it('classifies no result / a malformed result as no_data — the honest default', () => {
    expect(getWallVerification(undefined).state).toBe('no_data');
    expect(getWallVerification(null).state).toBe('no_data');
    expect(getWallVerification({}).state).toBe('no_data');
    // passesSlenderness present but not boolean (malformed) never counts as a
    // real check either.
    expect(getWallVerification({ passesSlenderness: undefined }).state).toBe('no_data');
  });
});
