/**
 * /lenses/repair-telemetry — four-UX-state contract.
 *
 * Pins that the Repair Telemetry dashboard renders genuine loading / error
 * (with a working Retry) / empty / populated states against the real macro
 * surface (lensRun('repair', …) → POST /api/lens/run → server/domains/repair.js),
 * plus a11y (loading is role=status; error is role=alert). It also pins the
 * operator decision path (resolve_escalation fires + re-refreshes) and the
 * admin-forbidden fallback.
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, in exactly the flat shape repair.js returns
 * ({ ok, entries } / { ok, escalations } / { ok, stats }). The headless
 * LensShell + AdminRequiredState are stubbed so the test stays on the page's
 * state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── api/client mock — the page's single backend channel + forbidden check ──
const lensRun = vi.fn();
let forbiddenFlag = false;
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  isForbidden: () => forbiddenFlag,
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/common/EmptyState', () => ({
  AdminRequiredState: () =>
    React.createElement('div', { 'data-testid': 'admin-required' }, 'Admin required'),
}));

// Import AFTER mocks are registered.
import RepairTelemetryPage from '@/app/lenses/repair-telemetry/page';

// lensRun returns an axios-shaped { data: { ok, result } } where result is the
// FLAT macro payload repair.js returns (no inner result wrapper).
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const ENTRY = { id: 'h1', pathology: 'negative_balance', category: 'economy', disposition: 'healed', subject_id: 'wallet_7', checked_at: 100 };
const ESC = { id: 'e1', message: 'refused to retire an arc', priority: 'high', status: 'pending', created_at: '2026-01-01' };
const STATS = { totalPatterns: 4, totalRepairs: 9, avgSuccessRate: 0.75, deprecatedFixes: 1 };

function wire(map: Record<string, () => Promise<unknown>>) {
  lensRun.mockImplementation((_d: string, name: string) =>
    (map[name] ? map[name]() : reply({ ok: true })));
}

beforeEach(() => { lensRun.mockReset(); forbiddenFlag = false; });

describe('repair-telemetry lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the reads are in flight', async () => {
    wire({
      health_log: () => new Promise(() => {}),       // never resolves → stays loading
      escalations: () => reply({ ok: true, escalations: [] }),
      memory: () => reply({ ok: true, stats: STATS }),
    });
    const { getByText, container } = render(<RepairTelemetryPage />);
    await waitFor(() => expect(getByText(/Loading repair telemetry/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('ERROR: an ok:false read shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    wire({
      health_log: () => fail ? Promise.resolve({ data: { ok: false, result: null } }) : reply({ ok: true, entries: [ENTRY] }),
      escalations: () => reply({ ok: true, escalations: [] }),
      memory: () => reply({ ok: true, stats: STATS }),
    });
    const { getByText, container } = render(<RepairTelemetryPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Couldn't load repair telemetry/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'health_log').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'health_log').length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText('negative_balance')).toBeInTheDocument());
  });

  it('ERROR: a thrown read also shows role=alert', async () => {
    wire({
      health_log: () => Promise.reject(new Error('network down')),
      escalations: () => reply({ ok: true, escalations: [] }),
      memory: () => reply({ ok: true, stats: STATS }),
    });
    const { container } = render(<RepairTelemetryPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
  });

  it('EMPTY: shows the honest "all quiet" state when every read is empty', async () => {
    wire({
      health_log: () => reply({ ok: true, entries: [] }),
      escalations: () => reply({ ok: true, escalations: [] }),
      memory: () => reply({ ok: true, stats: { totalPatterns: 0, totalRepairs: 0, avgSuccessRate: 0, deprecatedFixes: 0 } }),
    });
    const { getByText } = render(<RepairTelemetryPage />);
    await waitFor(() => expect(getByText(/All quiet/i)).toBeInTheDocument());
  });

  it('POPULATED: renders the memory KPIs, escalation inbox, and homeostasis ledger', async () => {
    wire({
      health_log: () => reply({ ok: true, entries: [ENTRY] }),
      escalations: () => reply({ ok: true, escalations: [ESC] }),
      memory: () => reply({ ok: true, stats: STATS }),
    });
    const { getByText } = render(<RepairTelemetryPage />);
    await waitFor(() => expect(getByText('negative_balance')).toBeInTheDocument());

    // memory KPI strip
    expect(getByText('Patterns learned')).toBeInTheDocument();
    expect(getByText('75%')).toBeInTheDocument(); // avgSuccessRate 0.75 → 75%
    // escalation inbox
    expect(getByText(/Escalation inbox \(1\)/)).toBeInTheDocument();
    expect(getByText(/refused to retire an arc/)).toBeInTheDocument();
    // ledger disposition
    expect(getByText('healed')).toBeInTheDocument();
  });

  it('OPERATOR: Approve fires resolve_escalation(approved) and re-refreshes', async () => {
    let resolved = false;
    wire({
      health_log: () => reply({ ok: true, entries: [ENTRY] }),
      escalations: () => reply({ ok: true, escalations: resolved ? [] : [ESC] }),
      memory: () => reply({ ok: true, stats: STATS }),
      resolve_escalation: () => { resolved = true; return reply({ ok: true, resolution: 'approved' }); },
    });
    const { getByText, queryByText } = render(<RepairTelemetryPage />);
    await waitFor(() => expect(getByText('Approve')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText('Approve')); });
    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => c[1] === 'resolve_escalation' && (c[2] as { resolution?: string }).resolution === 'approved')).toBe(true));
    // inbox empties after the operator decision
    await waitFor(() => expect(queryByText(/refused to retire an arc/)).toBeNull());
  });

  it('FORBIDDEN: a 403 surfaces the AdminRequired fallback', async () => {
    forbiddenFlag = true;
    wire({
      health_log: () => reply({ ok: true, entries: [] }),
      escalations: () => reply({ ok: true, escalations: [] }),
      memory: () => reply({ ok: true, stats: STATS }),
    });
    const { getByTestId } = render(<RepairTelemetryPage />);
    await waitFor(() => expect(getByTestId('admin-required')).toBeInTheDocument());
  });
});
