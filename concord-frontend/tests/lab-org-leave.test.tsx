/**
 * LabOrgPanel — org-leave wiring (HANDOFF-3 batch L15a).
 *
 * A member could create and join lab organizations but never leave
 * one from the UI: the backend `org-leave` macro had no caller.
 * This pins the Leave flow on the selected lab: clicking "Leave lab"
 * dispatches org-leave for that org and refreshes the roster list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ lensRun: mocks.lensRun }));

import { LabOrgPanel } from '@/components/lab/LabOrgPanel';

const LAB = {
  orgId: 'org-1', name: 'Genomics Core', description: '', memberCount: 3,
  orgRole: 'member', tier: 'tech', createdAt: '2026-01-01T00:00:00.000Z',
};

describe('LabOrgPanel leave flow', () => {
  beforeEach(() => {
    mocks.lensRun.mockReset();
    mocks.lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'org-list-mine') return Promise.resolve({ data: { ok: true, result: { labs: [LAB] } } });
      if (action === 'org-members') return Promise.resolve({ data: { ok: true, result: { members: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
  });

  it('leaves the selected lab through the real org-leave macro', async () => {
    render(<LabOrgPanel />);
    const leaveBtn = await screen.findByRole('button', { name: /Leave lab/ });
    fireEvent.click(leaveBtn);
    await waitFor(() => {
      expect(mocks.lensRun).toHaveBeenCalledWith('lab', 'org-leave', { orgId: 'org-1' });
    });
  });
});
