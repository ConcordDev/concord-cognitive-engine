import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

const RAW_ID = '496291b0-7c3a-4e1d-9f20-deadbeef0001';

function teamPayload(member: Record<string, unknown>) {
  return {
    data: {
      ok: true,
      result: {
        crisisId: 'cr_1',
        team: [member],
        byRole: { logistics_chief: [member] },
        roles: ['logistics_chief', 'responder'],
        count: 1,
      },
      error: null,
    },
  };
}

const MEMBER = {
  id: 'entry-1',
  responder: 'r59 watchdog-test responder',
  role: 'logistics_chief',
  assignedAt: 1_700_000_000_000,
  assignedByName: 'Ada Lovelace',
  assignedByIsMe: false,
  canUnassign: false,
};

describe('Crisis Ops roster and timeline refusals', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('shows the assigner by name, hides a removal the caller cannot make, and never renders a raw user id', async () => {
    lensRun.mockResolvedValue(teamPayload(MEMBER));
    const { TeamPanel } = await import('@/components/crisis-ops/TeamPanel');
    render(React.createElement(TeamPanel, { crisisId: 'cr_1' }));
    await waitFor(() => {
      expect(screen.getByText('r59 watchdog-test responder')).toBeInTheDocument();
    });
    expect(screen.getByText(/assigned by Ada Lovelace/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW_ID);
  });

  it('marks the caller on their own assignment', async () => {
    lensRun.mockResolvedValue(teamPayload({ ...MEMBER, assignedByIsMe: true, canUnassign: true }));
    const { TeamPanel } = await import('@/components/crisis-ops/TeamPanel');
    render(React.createElement(TeamPanel, { crisisId: 'cr_1' }));
    await waitFor(() => {
      expect(screen.getByText(/\(you\)/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Remove')).toBeInTheDocument();
  });

  it('shows an unassign refusal as a failure and leaves the roster in place', async () => {
    lensRun.mockImplementation((domain: string, name: string) => {
      if (name === 'team') return Promise.resolve(teamPayload({ ...MEMBER, canUnassign: true }));
      if (name === 'unassign') {
        return Promise.resolve({ data: { ok: false, result: null, error: 'not_authorized' } });
      }
      return Promise.resolve({ data: { ok: false, result: null, error: 'unexpected' } });
    });
    const { TeamPanel } = await import('@/components/crisis-ops/TeamPanel');
    render(React.createElement(TeamPanel, { crisisId: 'cr_1' }));
    const remove = await screen.findByLabelText('Remove');
    fireEvent.click(remove);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/cannot remove this assignment/i);
    expect(screen.getByText('r59 watchdog-test responder')).toBeInTheDocument();
    const teamCalls = lensRun.mock.calls.filter((c) => c[1] === 'team');
    expect(teamCalls).toHaveLength(1);
  });

  it('shows an assign refusal for an unknown crisis and keeps the typed name', async () => {
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'team') {
        return Promise.resolve({
          data: { ok: true, result: { crisisId: 'missing', team: [], byRole: {}, roles: ['responder'], count: 0 }, error: null },
        });
      }
      return Promise.resolve({ data: { ok: false, result: null, error: 'crisis_not_found' } });
    });
    const { TeamPanel } = await import('@/components/crisis-ops/TeamPanel');
    render(React.createElement(TeamPanel, { crisisId: 'missing' }));
    const input = await screen.findByPlaceholderText('Responder name');
    fireEvent.change(input, { target: { value: 'Lee' } });
    fireEvent.click(screen.getByRole('button', { name: /assign/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not on the board/i);
    expect((input as HTMLInputElement).value).toBe('Lee');
  });

  it('shows the timeline author by name and a log refusal as a failure', async () => {
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'timeline') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              crisisId: 'cr_1',
              count: 1,
              events: [{
                id: 'ev-1',
                kind: 'update',
                note: 'Shelter opened',
                at: 1_700_000_000_000,
                byName: 'Grace Hopper',
                byIsMe: false,
              }],
            },
            error: null,
          },
        });
      }
      return Promise.resolve({ data: { ok: false, result: null, error: 'crisis_not_found' } });
    });
    const { TimelinePanel } = await import('@/components/crisis-ops/TimelinePanel');
    render(React.createElement(TimelinePanel, { crisisId: 'cr_1' }));
    await waitFor(() => {
      expect(screen.getByText('Shelter opened')).toBeInTheDocument();
    });
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW_ID);

    const note = screen.getByPlaceholderText('Log a status update…');
    fireEvent.change(note, { target: { value: 'roads closed' } });
    fireEvent.click(screen.getByRole('button', { name: /log/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not on the board/i);
    expect((note as HTMLInputElement).value).toBe('roads closed');
  });
});
