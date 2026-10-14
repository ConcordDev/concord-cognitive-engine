/**
 * F8 — MediatorControls clears draft id/name when the selected case changes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MediatorControls } from '@/components/disputes/CaseWorkbench';

const baseCase = {
  id: 'dispute_case_1',
  caseNumber: 1,
  title: 'Case one',
  dispute_type: 'other',
  status: 'open',
  disputeAmount: 0,
  claimantId: 'u_a',
  respondentId: 'u_b',
  mediatorId: null as string | null,
  escrowFrozen: false,
  escrowAmount: 0,
  evidenceCount: 0,
  messageCount: 0,
  offerCount: 0,
  slaDeadline: null,
  slaBreached: false,
  outcome: null,
  openedAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:00:00.000Z',
  resolvedAt: null,
};

describe('disputes F8 mediator form reset', () => {
  it('select case 2 after typing on case 1 -> form empty', () => {
    const run = vi.fn(async () => true);
    const { rerender } = render(
      <MediatorControls c={baseCase as any} busy={null} run={run} />,
    );
    const idInput = screen.getByPlaceholderText(/mediator user id/i);
    const nameInput = screen.getByPlaceholderText(/name \(optional\)/i);
    fireEvent.change(idInput, { target: { value: 'med_sdpmv832qzv' } });
    fireEvent.change(nameInput, { target: { value: 'Mediator sdpmv832qzv' } });
    expect(idInput).toHaveValue('med_sdpmv832qzv');
    expect(nameInput).toHaveValue('Mediator sdpmv832qzv');

    rerender(
      <MediatorControls
        c={{ ...baseCase, id: 'dispute_case_2', caseNumber: 2, title: 'Case two', mediatorId: null } as any}
        busy={null}
        run={run}
      />,
    );
    expect(screen.getByPlaceholderText(/mediator user id/i)).toHaveValue('');
    expect(screen.getByPlaceholderText(/name \(optional\)/i)).toHaveValue('');
  });
});
