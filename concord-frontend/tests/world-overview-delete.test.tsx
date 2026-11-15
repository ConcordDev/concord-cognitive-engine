// FIX-entity-010 (FE half) — WorldOverview snapshot rows and simulation
// history rows carry a two-step delete wired to the worldmodel
// delete_snapshot / delete_simulation actions.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { WorldOverview } from '@/components/entity/WorldOverview';

function renderOverview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorldOverview entityCount={3} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, name: string) => {
    if (name === 'list_snapshots') return { data: { ok: true, result: { ok: true, snapshots: [{ id: 'snap-1', label: 'Baseline', entityCount: 3, relationCount: 2, takenAt: new Date().toISOString() }] } } };
    if (name === 'list_simulations') return { data: { ok: true, result: { ok: true, simulations: [{ id: 'sim-1', type: 'evolution', status: 'complete', hypothesis: 'Grow', insightCount: 2, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }], total: 1 } } };
    return { data: { ok: true, result: { ok: true } } };
  });
});
afterEach(() => cleanup());

describe('WorldOverview history deletes', () => {
  it('snapshot delete is two-step and calls delete_snapshot', async () => {
    renderOverview();
    const trash = await screen.findByRole('button', { name: 'Delete snapshot snap-1' });
    await act(async () => { fireEvent.click(trash); });
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'delete_snapshot')).toBe(false);
    const confirm = await screen.findByRole('button', { name: 'Confirm delete snapshot snap-1' });
    await act(async () => { fireEvent.click(confirm); });
    const del = lensRunMock.mock.calls.find((c) => c[1] === 'delete_snapshot');
    expect(del?.[2]).toMatchObject({ snapshotId: 'snap-1' });
  });

  it('simulation delete is two-step and calls delete_simulation', async () => {
    renderOverview();
    const trash = await screen.findByRole('button', { name: 'Delete simulation sim-1' });
    await act(async () => { fireEvent.click(trash); });
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'delete_simulation')).toBe(false);
    const confirm = await screen.findByRole('button', { name: 'Confirm delete simulation sim-1' });
    await act(async () => { fireEvent.click(confirm); });
    const del = lensRunMock.mock.calls.find((c) => c[1] === 'delete_simulation');
    expect(del?.[2]).toMatchObject({ simId: 'sim-1' });
  });
});
