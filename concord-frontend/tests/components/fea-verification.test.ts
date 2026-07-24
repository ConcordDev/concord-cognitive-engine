import { describe, it, expect } from 'vitest';
import { getFeaVerification } from '@/components/engineering/fea-verification';

/**
 * getFeaVerification — the honest three-state classifier for the OVERALL
 * `engineering.runFEA` computation result (the analysis itself, not a
 * marketplace listing of it). Fixtures mirror the REAL shape
 * server/lib/simulation/fea-solver.js#runFEA returns, confirmed by reading
 * that file directly (fea-solver.js:385-399): a passing/failing solve always
 * carries `{ ok: true, summary: { maxDisplacement, maxUtilization, allPass,
 * memberCount, nodeCount }, ... }`; an unsolvable model (no nodes/members)
 * returns `{ ok: false, error: string }` with no `summary` at all.
 */

describe('getFeaVerification — pure classification', () => {
  it('classifies a genuinely-passed FEA solve as verified', () => {
    const v = getFeaVerification({
      ok: true,
      summary: { maxDisplacement: 0.012, maxUtilization: 0.62, allPass: true, memberCount: 3, nodeCount: 4 },
    });
    expect(v.state).toBe('verified');
    expect(v.label).toBe('FEA Verified');
    expect(v.detail).toMatch(/passed/);
    expect(v.detail).toMatch(/62%|62\.0%/); // real utilization surfaced, not invented
  });

  it('classifies a real solve where at least one member fails allowable stress as failed, never verified', () => {
    const v = getFeaVerification({
      ok: true,
      summary: { maxDisplacement: 0.9, maxUtilization: 1.35, allPass: false, memberCount: 3, nodeCount: 4 },
    });
    expect(v.state).toBe('failed');
    expect(v.label).toBe('FEA Failed');
    expect(v.detail).toMatch(/did NOT pass/);
  });

  it('classifies a missing result as no_data — the honest default', () => {
    expect(getFeaVerification(undefined).state).toBe('no_data');
    expect(getFeaVerification(null).state).toBe('no_data');
    expect(getFeaVerification({}).state).toBe('no_data');
  });

  it('classifies a real solver failure (ok:false, empty model) as no_data, not "failed"', () => {
    // ok:false means the solve never completed — there is no structural
    // check result to grade "failed", so this is honestly "no check ran",
    // matching runFEA's real early-return shape (fea-solver.js:305).
    const v = getFeaVerification({ ok: false, error: 'Model must have at least one node and one member' });
    expect(v.state).toBe('no_data');
    expect(v.detail).toMatch(/did not complete/);
    expect(v.detail).toMatch(/at least one node and one member/);
  });

  it('never treats a malformed summary (missing allPass) as verified', () => {
    const v = getFeaVerification({ ok: true, summary: { maxUtilization: 0.4 } });
    expect(v.state).toBe('no_data');
  });
});
