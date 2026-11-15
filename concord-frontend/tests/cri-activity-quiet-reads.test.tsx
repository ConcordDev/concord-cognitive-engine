/**
 * FIX-cri-014 — opening the Quality Loop's Trend / Remediation /
 * Alerts tabs logged 'trend history', 'bulk remediate' and 'alerts'
 * in the Activity timeline as actions the operator took. Those tab
 * loads are reads: the activity layer's quiet table now covers cri
 * (the lens had no section at all), and bulkRemediate — a genuine
 * action for its mutating ops — is quiet only for its op:'list'
 * load, via a small quietOps extension to the shared layer.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM server module, no types
import { isQuietLensAction } from '../../server/lib/lens-activity-labels.js';

describe('FIX-cri-014 — view opens are not operator actions', () => {
  it('cri tab-load reads are quiet', () => {
    for (const a of ['trend-history', 'alerts', 'compare', 'scoreRules-get', 'rootCause']) {
      expect(isQuietLensAction('cri', a)).toBe(true);
    }
  });

  it('bulkRemediate is quiet for its list load and only that', () => {
    expect(isQuietLensAction('cri', 'bulkRemediate', { op: 'list' })).toBe(true);
    expect(isQuietLensAction('cri', 'bulkRemediate', { op: 'flag' })).toBe(false);
    expect(isQuietLensAction('cri', 'bulkRemediate', { op: 'resolve' })).toBe(false);
    expect(isQuietLensAction('cri', 'bulkRemediate')).toBe(false);
  });

  it('cri writes still record', () => {
    expect(isQuietLensAction('cri', 'scoreRules-set')).toBe(false);
    expect(isQuietLensAction('cri', 'trend-snapshot')).toBe(false);
  });
});
