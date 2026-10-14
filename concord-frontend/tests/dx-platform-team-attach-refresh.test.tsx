/**
 * F2 — after attaching a codebase, the team aggregate must refresh even when
 * teamId is already set (owner create → attach: setTeamId is a no-op).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: () => null,
}));

import { DxWorkbench } from '@/components/dx-platform/DxWorkbench';

const CB = {
  id: 'cb_1',
  name: 'Auth service',
  fileCount: 2,
  totalLines: 8,
  teamId: null as string | null,
  indexedAt: '2026-06-01T00:00:00.000Z',
};

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('dx-platform Team tab — attach refreshes aggregate (F2)', () => {
  it('calls teamDashboard again after Join when teamId is already set', async () => {
    let dashCalls = 0;
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'listCodebases') {
        return Promise.resolve({
          data: { ok: true, result: { codebases: [CB], count: 1 }, error: null },
        });
      }
      if (action === 'createTeam') {
        return Promise.resolve({
          data: {
            ok: true,
            result: { teamId: 'team_1', name: 'T', inviteCode: 'inv_1', memberCount: 1, members: [] },
            error: null,
          },
        });
      }
      if (action === 'joinTeam') {
        return Promise.resolve({
          data: { ok: true, result: { teamId: 'team_1', name: 'T', memberCount: 1, members: [] }, error: null },
        });
      }
      if (action === 'teamDashboard') {
        dashCalls += 1;
        const attached = dashCalls >= 2;
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              teamId: 'team_1',
              teamName: 'T',
              memberCount: 1,
              codebaseCount: attached ? 1 : 0,
              totalFiles: attached ? 2 : 0,
              totalFindings: 0,
              severityTotals: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
              topDetectors: [],
              perCodebase: attached
                ? [{ codebaseId: 'cb_1', name: 'Auth service', fileCount: 2, findingCount: 0, riskScore: 0, bySeverity: {} }]
                : [],
            },
            error: null,
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<DxWorkbench />); });
    await waitFor(() => expect(view!.getByRole('tab', { name: /Team/i })).toBeInTheDocument());

    await act(async () => { fireEvent.click(view!.getByRole('tab', { name: /Team/i })); });

    const nameInput = view!.getByPlaceholderText('Team name');
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'Sweep team' } });
      fireEvent.click(view!.getByRole('button', { name: /^Create$/i }));
    });

    await waitFor(() => expect(view!.getByText(/No codebases attached to this team yet/i)).toBeInTheDocument());

    const beforeAttach = lensRunMock.mock.calls.filter((c) => c[1] === 'teamDashboard').length;
    expect(beforeAttach).toBeGreaterThanOrEqual(1);

    // Select codebase + Join (teamId already set — this is the F2 case).
    const picker = view!.getByLabelText('Select codebase');
    await act(async () => {
      fireEvent.change(picker, { target: { value: 'cb_1' } });
      fireEvent.click(view!.getByRole('button', { name: /^Join$/i }));
    });

    await waitFor(() => {
      const after = lensRunMock.mock.calls.filter((c) => c[1] === 'teamDashboard').length;
      expect(after).toBeGreaterThan(beforeAttach);
    });

    await waitFor(() => {
      expect(view!.queryByText(/No codebases attached to this team yet/i)).toBeNull();
      expect(view!.getByText(/Per-codebase risk/i)).toBeInTheDocument();
      expect(view!.getAllByText(/Auth service/).length).toBeGreaterThanOrEqual(1);
    });
  });
});
