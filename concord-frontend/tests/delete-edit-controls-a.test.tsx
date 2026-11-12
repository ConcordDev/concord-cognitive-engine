/**
 * FIX-worldmodel-001 (audit sweep CB-0447, cluster A) — snapshots and
 * simulation runs gain a delete control. Pins the FE contract:
 *  - each snapshot row carries a sticky delete that NAMES the snapshot;
 *    arming fires nothing, the confirm fires delete_snapshot once;
 *  - each recent-simulation row carries the same sticky delete firing
 *    delete_sim;
 *  - the pre-existing restore confirm on the snapshot row is untouched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { SnapshotsPanel } from '@/components/worldmodel/SnapshotsPanel';
import { SimulatePanel } from '@/components/worldmodel/SimulatePanel';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'list_snapshots_full') {
      return { data: { ok: true, result: { snapshots: [{ id: 'snap1', label: 'Baseline', entityCount: 2, relationCount: 1, capturedAt: '2026-11-01T10:00:00.000Z' }], total: 1 } } };
    }
    if (action === 'wm_list_entities') {
      return { data: { ok: true, result: { entities: [] } } };
    }
    if (action === 'list_sims') {
      return { data: { ok: true, result: { simulations: [{ id: 'sim1', name: 'forward run', mode: 'scenario', total: 42, createdAt: '2026-11-01T11:00:00.000Z' }], total: 1 } } };
    }
    return { data: { ok: true, result: {} } };
  });
});

describe('worldmodel delete controls (FIX-worldmodel-001)', () => {
  it('snapshot row: arming the delete fires nothing; the confirm fires delete_snapshot naming the snapshot', async () => {
    wrap(<SnapshotsPanel />);
    const arm = await screen.findByRole('button', { name: 'Delete snapshot Baseline' });
    fireEvent.click(arm);
    expect(calls('delete_snapshot')).toHaveLength(0);
    const confirm = await screen.findByRole('button', { name: 'Confirm delete snapshot Baseline' });
    expect(confirm.textContent).toContain('Delete "Baseline"?');
    fireEvent.click(confirm);
    await waitFor(() => expect(calls('delete_snapshot')).toHaveLength(1));
    expect(calls('delete_snapshot')[0][2]).toEqual({ id: 'snap1' });
    // the restore confirm still stands beside it
    expect(screen.getByRole('button', { name: 'Restore Baseline' })).toBeTruthy();
  });

  it('simulation row: the sticky delete fires delete_sim only from the confirm', async () => {
    wrap(<SimulatePanel />);
    const arm = await screen.findByRole('button', { name: 'Delete simulation forward run' });
    fireEvent.click(arm);
    expect(calls('delete_sim')).toHaveLength(0);
    const confirm = await screen.findByRole('button', { name: 'Confirm delete simulation forward run' });
    expect(confirm.textContent).toContain('Delete "forward run"?');
    fireEvent.click(confirm);
    await waitFor(() => expect(calls('delete_sim')).toHaveLength(1));
    expect(calls('delete_sim')[0][2]).toEqual({ id: 'sim1' });
  });
});
