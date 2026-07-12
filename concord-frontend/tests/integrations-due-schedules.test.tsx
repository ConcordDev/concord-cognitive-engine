/**
 * WorkflowsPanel — due-schedules indicator. Pins the previously-unsurfaced
 * `integrations.dueSchedules` macro (server/domains/integrations.js) now
 * wired in as a real "N due now" badge + a per-workflow due highlight, both
 * driven only by the macro's real response shape:
 *   integrations.dueSchedules -> { ok:true, result: { schedules: [{ zapId, zapName, kind, nextFireAt, isDue }], dueNow } }
 *
 * lensRun is the one mock surface — no fabricated data, no client-computed
 * "due" logic (isDue always comes straight from the mocked macro).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, waitFor, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// TimelineView pulls in a heavy chart lib; stub it (unreached in these tests
// anyway since no run is triggered).
vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
}));

import { WorkflowsPanel } from '@/components/integrations/WorkflowsPanel';

const ZAP = {
  id: 'zap_1', name: 'Slack alert', trigger: { event: 'dtu.created' }, steps: [{ kind: 'action' }],
  schedule: { kind: 'interval', intervalSeconds: 3600, nextFireAt: '2026-07-11T00:00:00.000Z' },
  runCount: 3, successCount: 3, failureCount: 0, lastRunAt: null, enabled: true,
};

type MacroResponse = { data: { ok: boolean; result: unknown; error: string | null } };
type MacroOverride = (input: Record<string, unknown>) => MacroResponse;

function baseImpl(overrides: Record<string, MacroOverride> = {}) {
  return (domain: string, action: string, input: Record<string, unknown>) => {
    if (domain !== 'integrations') return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    if (overrides[action]) return Promise.resolve(overrides[action](input));
    if (action === 'zapList') {
      return Promise.resolve({ data: { ok: true, result: { zaps: [ZAP] }, error: null } });
    }
    if (action === 'dueSchedules') {
      return Promise.resolve({ data: { ok: true, result: { schedules: [], dueNow: 0 }, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('WorkflowsPanel — integrations.dueSchedules', () => {
  it('shows no due badge when nothing is due', async () => {
    lensRunMock.mockImplementation(baseImpl());
    await act(async () => { render(<WorkflowsPanel />); });
    await waitFor(() => expect(screen.getByText('Slack alert')).toBeInTheDocument());
    expect(screen.queryByTestId('due-schedules-badge')).not.toBeInTheDocument();
  });

  it('renders the real due count + highlights the due workflow, from the macro response only', async () => {
    lensRunMock.mockImplementation(baseImpl({
      dueSchedules: () => ({
        data: {
          ok: true,
          result: {
            schedules: [{ zapId: 'zap_1', zapName: 'Slack alert', kind: 'interval', nextFireAt: '2026-07-11T00:00:00.000Z', isDue: true }],
            dueNow: 1,
          },
          error: null,
        },
      }),
    }));

    await act(async () => { render(<WorkflowsPanel />); });
    await waitFor(() => expect(screen.getByTestId('due-schedules-badge')).toBeInTheDocument());
    expect(screen.getByTestId('due-schedules-badge').textContent).toContain('1 due now');
    expect(screen.getByText('· due now')).toBeInTheDocument();

    const call = lensRunMock.mock.calls.find((c) => c[1] === 'dueSchedules');
    expect(call).toBeTruthy();
  });

  it('does not mark a scheduled workflow due when the macro says isDue:false', async () => {
    lensRunMock.mockImplementation(baseImpl({
      dueSchedules: () => ({
        data: {
          ok: true,
          result: {
            schedules: [{ zapId: 'zap_1', zapName: 'Slack alert', kind: 'interval', nextFireAt: '2026-07-11T00:00:00.000Z', isDue: false }],
            dueNow: 0,
          },
          error: null,
        },
      }),
    }));

    await act(async () => { render(<WorkflowsPanel />); });
    await waitFor(() => expect(screen.getByText('Slack alert')).toBeInTheDocument());
    expect(screen.queryByTestId('due-schedules-badge')).not.toBeInTheDocument();
    expect(screen.queryByText('· due now')).not.toBeInTheDocument();
  });
});
