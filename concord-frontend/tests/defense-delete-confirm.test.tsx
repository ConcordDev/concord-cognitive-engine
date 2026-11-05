import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// C1 — a persisted record is never destroyed by a single click, and a
// completed delete leaves a receipt. Driven end-to-end on AssetReadiness
// (the completion pass's own exhibit: "Delete asset" executed immediately,
// unconfirmed, with no receipt). The other six delete sites in this lens
// ride the same ConfirmDeleteButton contract.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  MapView: () => null,
}));

import { AssetReadiness } from '@/components/defense/AssetReadiness';

const ASSET = {
  id: 'asset_1', designation: 'TEST-TRUCK-1', type: 'vehicle',
  status: 'operational', readiness: 80, assignedUnit: 'Test Unit', lat: null, lon: null,
};
const ROLLUP = {
  assets: [ASSET], total: 1, inService: 1,
  byStatus: { operational: 1, maintenance: 0, deployed: 0, decommissioned: 0 },
  byType: { vehicle: 1 }, fleetReadiness: 80, availabilityPct: 100,
  meanReadiness: 80, lowReadiness: [], rollupStatus: 'green',
};

function mockPanel() {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'asset-rollup') return Promise.resolve({ data: { ok: true, result: ROLLUP } });
    if (action === 'asset-delete') return Promise.resolve({ data: { ok: true, result: { deleted: ASSET.id } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

function deleteCalls() {
  return lensRun.mock.calls.filter((c) => c[1] === 'asset-delete');
}

beforeEach(() => { lensRun.mockReset(); });

describe('defense delete confirmation (C1)', () => {
  it('the first click only arms a confirmation naming the record — nothing is deleted', async () => {
    mockPanel();
    render(<AssetReadiness />);
    await waitFor(() => expect(screen.getByText('TEST-TRUCK-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }));
    expect(screen.getByText('Delete asset "TEST-TRUCK-1"?')).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('cancel disarms the confirmation and still nothing is deleted', async () => {
    mockPanel();
    render(<AssetReadiness />);
    await waitFor(() => expect(screen.getByText('TEST-TRUCK-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete asset "TEST-TRUCK-1"?')).not.toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('confirm runs the delete once and the panel receipts it by name', async () => {
    mockPanel();
    render(<AssetReadiness />);
    await waitFor(() => expect(screen.getByText('TEST-TRUCK-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText('Deleted asset — TEST-TRUCK-1')).toBeInTheDocument());
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0][2]).toEqual({ id: 'asset_1' });
  });
});
