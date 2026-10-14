/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * INC-SWEEP government F2 — CaseOpsPanel form statuses must be exactly the
 * government artifact enum (human labels, machine values for the API).
 */
import { describe, it, expect } from 'vitest';
import { GOVERNMENT_ARTIFACT_STATUSES } from '@/components/government/CaseOpsPanel';

describe('CaseOpsPanel government artifact statuses (F2)', () => {
  it('exports the server artifact enum the form must send', () => {
    expect([...GOVERNMENT_ARTIFACT_STATUSES]).toEqual([
      'draft',
      'proposed',
      'public-comment',
      'enacted',
      'repealed',
      'archived',
    ]);
  });

  it('does not include the old permit vocabulary that 422ed', () => {
    const old = [
      'submitted',
      'under_review',
      'inspection',
      'approved',
      'denied',
      'expired',
      'revoked',
    ];
    for (const s of old) {
      expect(GOVERNMENT_ARTIFACT_STATUSES).not.toContain(s);
    }
  });
});
