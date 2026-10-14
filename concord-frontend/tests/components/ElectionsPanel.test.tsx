/// <reference types="@testing-library/jest-dom/vitest" />
/** INC-SWEEP government F7 — voter row is a Concord-local record, not a filing. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ElectionsPanel } from '@/components/government/ElectionsPanel';

describe('ElectionsPanel (F7)', () => {
  beforeEach(() => { lensRunMock.mockReset(); });
  afterEach(() => { cleanup(); });

  it('shows local-record wording, not "filed" with an election office', async () => {
    lensRunMock.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'voter-registration-status') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              registration: {
                id: 'voter_test',
                fullName: 'QA Sweep',
                residentialAddress: '1 QA Lane',
                dateOfBirth: '1990-01-01',
                stateCode: 'ZZ',
                partyPreference: 'unaffiliated',
                mailInRequested: false,
                status: 'submitted',
                submittedAt: '2026-10-14T12:00:00.000Z',
              },
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<ElectionsPanel />);
    await waitFor(() => expect(screen.getByText(/QA Sweep/i)).toBeInTheDocument());
    const statusLine = screen.getByText(/recorded in Concord/i);
    expect(statusLine.textContent).toMatch(/not filed with any election office/i);
    // Old dishonest wording was "Status: submitted · filed {date}"
    expect(statusLine.textContent).not.toMatch(/· filed /i);
  });
});
